import { EasyTierCommandRunner } from './EasyTierCommandRunner.js'
import type { EasyTierManager, EasyTierProfileView } from './EasyTierManager.js'
import { EasyTierCompatibilityError } from './EasyTierManager.js'
import { EasyTierValidationError } from './easytierConfig.js'
import {
  deriveX25519PublicKey,
  EasyTierCredentialGenerateInput,
  generateX25519KeyPair,
  normalizeAclRules,
  normalizeCredentialGenerateInput,
  normalizeCredentialList,
  normalizeGeneratedCredential,
  normalizeX25519PublicKey
} from './easytierSecurity.js'
import type {
  EasyTierAclRule,
  EasyTierCredentialCreateResult,
  EasyTierCredentialSummary,
  EasyTierPeerConfig
} from './easytierTypes.js'

export interface EasyTierSecurityUpdateInput {
  enabled: boolean
  localPrivateKey?: string
  peers?: EasyTierPeerConfig[]
  aclDefaultAction?: 'allow' | 'deny'
  acl?: EasyTierAclRule[]
}

export interface EasyTierSecurityOverview {
  enabled: boolean
  localPublicKey?: string
  localPrivateKeyConfigured: boolean
  credentialStoreConfigured: boolean
  peers: EasyTierPeerConfig[]
  aclDefaultAction: 'allow' | 'deny'
  acl: EasyTierAclRule[]
  supportsSecureMode: boolean
  supportsCredentials: boolean
  supportsAcl: boolean
  requiresRestart: boolean
}

const requireStopped = (view: EasyTierProfileView): void => {
  if (view.instance && ['running', 'starting', 'stopping'].includes(view.instance.status)) {
    throw new EasyTierValidationError('请先停止 EasyTier 实例再修改安全配置', 'managedInstanceId')
  }
}

const normalizePeers = (peers: EasyTierPeerConfig[] | undefined, fallback: EasyTierPeerConfig[]): EasyTierPeerConfig[] => (
  (peers || fallback).map((peer, index) => ({
    uri: String(peer.uri || '').trim(),
    ...(peer.peerPublicKey
      ? { peerPublicKey: normalizeX25519PublicKey(peer.peerPublicKey, `peers[${index}].peerPublicKey`) }
      : {})
  }))
)

export class EasyTierSecurityService {
  private readonly manager: EasyTierManager
  private readonly commandRunner: EasyTierCommandRunner

  constructor(manager: EasyTierManager, commandRunner = new EasyTierCommandRunner()) {
    this.manager = manager
    this.commandRunner = commandRunner
  }

  async getOverview(profileId: string): Promise<EasyTierSecurityOverview> {
    const view = await this.manager.getProfileView(profileId)
    const capabilities = view.profile.capabilities || await this.manager.detectProfileCapabilities(profileId)
    return {
      enabled: view.profile.settings.secureMode.enabled,
      ...(view.profile.settings.secureMode.localPublicKey
        ? { localPublicKey: view.profile.settings.secureMode.localPublicKey }
        : {}),
      localPrivateKeyConfigured: view.profile.secretPresence.localPrivateKey,
      credentialStoreConfigured: view.profile.secretPresence.credentialFile,
      peers: view.profile.settings.peers.map(peer => ({ ...peer })),
      aclDefaultAction: view.profile.settings.aclDefaultAction,
      acl: view.profile.settings.acl.map(rule => ({
        ...rule,
        ...(rule.sourceGroups ? { sourceGroups: [...rule.sourceGroups] } : {}),
        ...(rule.destinationGroups ? { destinationGroups: [...rule.destinationGroups] } : {})
      })),
      supportsSecureMode: capabilities.supportsSecureMode,
      supportsCredentials: capabilities.supportsCredentials,
      supportsAcl: capabilities.supportsAcl,
      requiresRestart: Boolean(view.instance?.status === 'running')
    }
  }

  async updateConfiguration(
    profileId: string,
    input: EasyTierSecurityUpdateInput
  ): Promise<EasyTierProfileView> {
    const view = await this.manager.getProfileView(profileId)
    requireStopped(view)
    const capabilities = view.profile.capabilities || await this.manager.detectProfileCapabilities(profileId)
    if (input.enabled && !capabilities.supportsSecureMode) {
      throw new EasyTierCompatibilityError('当前 EasyTier 版本不支持 Secure Mode', capabilities)
    }
    const aclDefaultAction = input.aclDefaultAction ?? view.profile.settings.aclDefaultAction
    if (((input.acl && input.acl.length > 0) || aclDefaultAction === 'deny') && !capabilities.supportsAcl) {
      throw new EasyTierCompatibilityError('当前 EasyTier 版本不支持 ACL', capabilities)
    }

    const keyPair = input.localPrivateKey
      ? deriveX25519PublicKey(input.localPrivateKey)
      : undefined
    const settings = {
      ...view.profile.settings,
      secureMode: {
        enabled: input.enabled,
        ...(keyPair?.publicKey
          ? { localPublicKey: keyPair.publicKey }
          : view.profile.settings.secureMode.localPublicKey
            ? { localPublicKey: view.profile.settings.secureMode.localPublicKey }
            : {})
      },
      peers: normalizePeers(input.peers, view.profile.settings.peers),
      aclDefaultAction,
      acl: input.acl
        ? normalizeAclRules(input.acl)
        : view.profile.settings.acl.map(rule => ({
            ...rule,
            ...(rule.sourceGroups ? { sourceGroups: [...rule.sourceGroups] } : {}),
            ...(rule.destinationGroups ? { destinationGroups: [...rule.destinationGroups] } : {})
          }))
    }
    return this.manager.updateProfile(
      profileId,
      { ...view.profile, settings },
      keyPair ? { localPrivateKey: keyPair.privateKey } : {},
      { preserveExistingSecrets: true }
    )
  }

  async generateStaticKey(profileId: string): Promise<{
    profile: EasyTierProfileView
    publicKey: string
  }> {
    const keyPair = generateX25519KeyPair()
    const profile = await this.updateConfiguration(profileId, {
      enabled: true,
      localPrivateKey: keyPair.privateKey
    })
    return { profile, publicKey: keyPair.publicKey }
  }

  async listCredentials(profileId: string): Promise<EasyTierCredentialSummary[]> {
    const context = await this.getCliContext(profileId, 'credentials')
    const output = await this.commandRunner.runJson<unknown>(
      context.cliPath,
      [...context.baseArgs, 'credential', 'list'],
      { cwd: context.cwd }
    )
    return normalizeCredentialList(output)
  }

  async generateCredential(
    profileId: string,
    request: EasyTierCredentialGenerateInput
  ): Promise<EasyTierCredentialCreateResult> {
    const input = normalizeCredentialGenerateInput(request)
    const context = await this.getCliContext(profileId, 'credentials')
    const args = [
      ...context.baseArgs,
      'credential',
      'generate',
      '--ttl',
      String(input.ttlSeconds),
      ...(input.credentialId ? ['--credential-id', input.credentialId] : []),
      ...(input.groups.length > 0 ? ['--groups', input.groups.join(',')] : []),
      ...(input.allowRelay ? ['--allow-relay'] : []),
      ...(input.allowedProxyCidrs.length > 0
        ? ['--allowed-proxy-cidrs', input.allowedProxyCidrs.join(',')]
        : []),
      '--reusable',
      String(input.reusable)
    ]
    const output = await this.commandRunner.runJson<unknown>(context.cliPath, args, { cwd: context.cwd })
    return normalizeGeneratedCredential(output, input)
  }

  async revokeCredential(profileId: string, credentialId: string): Promise<{ revoked: true }> {
    const id = credentialId.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new EasyTierValidationError('credentialId 必须是有效 UUID', 'credentialId')
    }
    const context = await this.getCliContext(profileId, 'credentials')
    await this.commandRunner.runJson<unknown>(
      context.cliPath,
      [...context.baseArgs, 'credential', 'revoke', id],
      { cwd: context.cwd }
    )
    return { revoked: true }
  }

  async getAclStats(profileId: string): Promise<unknown> {
    const context = await this.getCliContext(profileId, 'acl')
    return this.commandRunner.runJson<unknown>(
      context.cliPath,
      [...context.baseArgs, 'acl', 'stats'],
      { cwd: context.cwd }
    )
  }

  private async getCliContext(profileId: string, capability: 'credentials' | 'acl'): Promise<{
    cliPath: string
    baseArgs: string[]
    cwd: string
  }> {
    const view = await this.manager.getProfileView(profileId)
    if (view.instance?.status !== 'running') {
      throw new EasyTierValidationError('安全运行时操作要求 EasyTier 实例处于运行状态', 'managedInstanceId')
    }
    if (!view.profile.settings.secureMode.enabled) {
      throw new EasyTierValidationError('请先启用 Secure Mode', 'settings.secureMode.enabled')
    }
    const capabilities = view.profile.capabilities || await this.manager.detectProfileCapabilities(profileId)
    const isSupported = capability === 'credentials' ? capabilities.supportsCredentials : capabilities.supportsAcl
    if (!capabilities.cliPath || !capabilities.supportsJsonOutput || !isSupported) {
      throw new EasyTierCompatibilityError(`当前 EasyTier 安装不支持 ${capability}`, capabilities)
    }
    if (!view.profile.settings.rpcPortal) throw new Error('EasyTier profile 缺少 RPC portal')
    return {
      cliPath: capabilities.cliPath,
      cwd: view.paths.directory,
      baseArgs: [
        '--rpc-portal',
        view.profile.settings.rpcPortal,
        '--output',
        'json',
        '--instance-name',
        view.profile.settings.instanceName
      ]
    }
  }
}
