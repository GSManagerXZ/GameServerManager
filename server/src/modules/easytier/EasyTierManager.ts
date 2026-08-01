import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { createRequire } from 'module'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import type winston from 'winston'
import { getCurrentUsername } from '../../utils/currentUser.js'
import {
  EasyTierValidationError,
  normalizeEasyTierProfile,
  normalizeEasyTierSecrets
} from './easytierConfig.js'
import { EasyTierCommandRunner } from './EasyTierCommandRunner.js'
import { EasyTierProfileStore } from './EasyTierProfileStore.js'
import { buildEasyTierRuntimeActionPlan } from './easytierRuntimeActions.js'
import {
  buildEasyTierRuntimeSnapshot,
  getEasyTierSettledWarning,
  safeEasyTierErrorMessage,
  toEasyTierRuntimeState
} from './easytierSnapshot.js'
import {
  EasyTierBinaryCapabilities,
  EasyTierBinarySelection,
  EasyTierLegacyMigrationResult,
  EasyTierProfile,
  EasyTierProfileDraft,
  EasyTierProfileSecrets,
  EasyTierRuntimeAction,
  EasyTierRuntimeActionResult,
  EasyTierRuntimeSnapshot
} from './easytierTypes.js'
import type {
  CreateInstanceRequest,
  Instance,
  InstanceManager
} from '../instance/InstanceManager.js'

export interface EasyTierManagerOptions {
  logger: winston.Logger
  instanceManager: InstanceManager
  store?: EasyTierProfileStore
  commandRunner?: EasyTierCommandRunner
}

export interface EasyTierProfileView {
  profile: EasyTierProfile
  instance?: Pick<Instance, 'id' | 'name' | 'status' | 'autoStart' | 'lastStarted' | 'lastStopped' | 'terminalSessionId'>
  paths: {
    directory: string
    configPath: string
  }
}

export interface EasyTierProfileSaveOptions {
  createInstance?: boolean
  preserveExistingSecrets?: boolean
}

export class EasyTierCompatibilityError extends Error {
  readonly code = 'EASYTIER_INCOMPATIBLE_BINARY'
  readonly capabilities: EasyTierBinaryCapabilities

  constructor(message: string, capabilities: EasyTierBinaryCapabilities) {
    super(message)
    this.name = 'EasyTierCompatibilityError'
    this.capabilities = { ...capabilities }
  }
}

export class EasyTierNotFoundError extends Error {
  readonly code = 'EASYTIER_PROFILE_NOT_FOUND'

  constructor(profileId: string) {
    super(`EasyTier profile 不存在: ${profileId}`)
    this.name = 'EasyTierNotFoundError'
  }
}

export class EasyTierManager extends EventEmitter {
  readonly store: EasyTierProfileStore
  readonly commandRunner: EasyTierCommandRunner

  private readonly logger: winston.Logger
  private readonly instanceManager: InstanceManager
  private subscriptions = new Map<string, Set<string>>()
  private subscriberProfiles = new Map<string, Set<string>>()
  private pollTimers = new Map<string, NodeJS.Timeout>()
  private pollInFlight = new Set<string>()
  private latestSnapshots = new Map<string, EasyTierRuntimeSnapshot>()
  private readonly pollIntervalMs = 3000
  private readonly maxSubscriptionsPerSubscriber = 8

  constructor(options: EasyTierManagerOptions) {
    super()
    this.logger = options.logger
    this.instanceManager = options.instanceManager
    this.store = options.store || new EasyTierProfileStore()
    this.commandRunner = options.commandRunner || new EasyTierCommandRunner()
  }

  async initialize(): Promise<void> {
    await this.store.initialize()
    this.logger.info(`EasyTier 数据目录已初始化: ${this.store.dataRoot}`)

    let migrations: EasyTierLegacyMigrationResult[] = []
    try {
      migrations = await this.store.migrateLegacyProfiles(async (manifest, manifestPath) => {
        const expectedDirectory = path.resolve(manifest.workingDirectory || path.dirname(manifestPath))
        const match = this.instanceManager.getInstances().find(instance => (
          instance.description.includes('[tunnel-helper] EasyTier') &&
          path.resolve(instance.workingDirectory) === expectedDirectory
        ))
        return match?.id
      })
    } catch (error) {
      this.logger.error('EasyTier 旧配置迁移失败，服务将继续启动:', error)
    }

    for (const migration of migrations.filter(item => item.profileId && item.status === 'migrated')) {
      try {
        const profile = await this.getProfile(migration.profileId)
        const secrets = await this.store.getSecrets(profile.id)
        const linkedInstance = this.findOwnedInstance(profile)
        if (
          linkedInstance?.status === 'running' &&
          !this.hasSafeRpcConfiguration(profile)
        ) {
          this.logger.warn(
            `EasyTier 旧实例正在使用非回环 RPC portal，保留当前配置直到实例停止后再自动修复 (${profile.id})`
          )
          continue
        }
        const prepared = await this.prepareProfile(profile, secrets, {
          allowOccupiedRpcPortal: linkedInstance?.status === 'running',
          reassignUnsafeRpcPortal: true
        })
        await this.store.saveProfileInPlace({
          profile: prepared,
          secrets,
          preserveExistingSecrets: false
        })
        if (prepared.managedInstanceId) await this.upsertManagedInstance(prepared.id)
      } catch (error) {
        this.logger.warn(`EasyTier 旧实例迁移待处理 (${migration.profileId}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async detectCapabilities(selection: EasyTierBinarySelection): Promise<EasyTierBinaryCapabilities> {
    const capabilities = await this.commandRunner.detectCapabilities(selection)
    if (capabilities.compatibilityWarnings.length > 0) {
      this.logger.warn('EasyTier 二进制兼容性提醒:', capabilities.compatibilityWarnings)
    }
    return capabilities
  }

  async detectProfileCapabilities(profileId: string): Promise<EasyTierBinaryCapabilities> {
    const profile = await this.store.getProfile(profileId)
    return this.detectCapabilities(profile.binary)
  }

  async refreshProfileCapabilities(profileId: string): Promise<EasyTierBinaryCapabilities> {
    const profile = await this.store.getProfile(profileId)
    const capabilities = await this.detectCapabilities(profile.binary)
    await this.store.saveProfile({
      profile: { ...profile, capabilities },
      preserveExistingSecrets: true
    })

    return capabilities
  }

  assertManagedCompatibility(capabilities: EasyTierBinaryCapabilities): void {
    if (!capabilities.supportsConfigFile) {
      throw new EasyTierCompatibilityError('当前 easytier-core 不支持 --config-file，请升级后重试', capabilities)
    }
    if (!capabilities.cliPath || !capabilities.supportsJsonOutput) {
      throw new EasyTierCompatibilityError('当前 EasyTier 安装缺少可用的 JSON CLI 管理能力', capabilities)
    }
    const requiredRpcFlags = ['rpc-portal', 'rpc-portal-whitelist']
    const coreFlags = capabilities.coreFlags || capabilities.flags
    const missingRpcFlags = requiredRpcFlags.filter(flag => !coreFlags.includes(flag))
    if (missingRpcFlags.length > 0) {
      throw new EasyTierCompatibilityError(`当前 easytier-core 缺少管理参数: ${missingRpcFlags.join(', ')}`, capabilities)
    }
  }

  async listProfiles(): Promise<EasyTierProfile[]> {
    return this.store.listProfiles()
  }

  async getProfile(profileId: string): Promise<EasyTierProfile> {
    try {
      return await this.store.getProfile(profileId)
    } catch (error: any) {
      if (error?.code === 'ENOENT') throw new EasyTierNotFoundError(profileId)
      throw error
    }
  }

  async listProfileViews(): Promise<EasyTierProfileView[]> {
    return Promise.all((await this.listProfiles()).map(profile => this.getProfileView(profile.id)))
  }

  async getProfileView(profileId: string): Promise<EasyTierProfileView> {
    const profile = await this.getProfile(profileId)
    const instance = profile.managedInstanceId
      ? this.instanceManager.getInstance(profile.managedInstanceId)
      : undefined
    const paths = this.store.getProfilePaths(profile.id)
    return {
      profile,
      ...(instance
        ? {
            instance: {
              id: instance.id,
              name: instance.name,
              status: instance.status,
              autoStart: instance.autoStart,
              lastStarted: instance.lastStarted,
              lastStopped: instance.lastStopped,
              terminalSessionId: instance.terminalSessionId
            }
          }
        : {}),
      paths: {
        directory: paths.directory,
        configPath: paths.configPath
      }
    }
  }

  async createProfile(
    draft: EasyTierProfileDraft,
    secrets: EasyTierProfileSecrets = {},
    options: EasyTierProfileSaveOptions = {}
  ): Promise<EasyTierProfileView> {
    const normalizedSecrets = normalizeEasyTierSecrets(secrets)
    let profile = normalizeEasyTierProfile(draft, normalizedSecrets)
    if (await this.store.hasProfile(profile.id)) {
      throw new EasyTierValidationError(`EasyTier profile ID 已存在: ${profile.id}`, 'profile.id')
    }
    this.assertRequiredSecrets(profile, normalizedSecrets)
    profile = await this.prepareProfile(profile, normalizedSecrets)
    if (options.createInstance !== false) {
      this.assertManagedCompatibility(profile.capabilities as EasyTierBinaryCapabilities)
    }
    profile = await this.store.saveProfile({
      profile,
      secrets: normalizedSecrets,
      preserveExistingSecrets: false
    })

    if (options.createInstance !== false) {
      try {
        await this.upsertManagedInstance(profile.id)
      } catch (error) {
        const partiallyCreatedInstance = this.findOwnedInstance(profile)
        if (partiallyCreatedInstance) {
          try {
            await this.instanceManager.deleteInstance(partiallyCreatedInstance.id)
          } catch (rollbackError) {
            this.logger.error('回滚 EasyTier 托管实例失败，保留 profile 以便人工恢复:', rollbackError)
            const combinedError = new Error(
              `创建 EasyTier 托管实例失败，且自动回滚实例失败: ${rollbackError instanceof Error ? rollbackError.message : '未知错误'}`
            ) as Error & { cause?: unknown }
            combinedError.cause = error
            throw combinedError
          }
        }
        try {
          await this.store.discardProfileData(profile.id)
        } catch (rollbackError) {
          this.logger.error('回滚 EasyTier profile 数据失败:', rollbackError)
          const combinedError = new Error(
            `创建 EasyTier 托管实例失败，且自动回滚 profile 失败: ${rollbackError instanceof Error ? rollbackError.message : '未知错误'}`
          ) as Error & { cause?: unknown }
          combinedError.cause = error
          throw combinedError
        }
        throw error
      }
    }
    return this.getProfileView(profile.id)
  }

  async updateProfile(
    profileId: string,
    draft: EasyTierProfileDraft,
    secrets: EasyTierProfileSecrets = {},
    options: EasyTierProfileSaveOptions = {}
  ): Promise<EasyTierProfileView> {
    const existing = await this.getProfile(profileId)
    const existingInstance = existing.managedInstanceId
      ? this.instanceManager.getInstance(existing.managedInstanceId)
      : undefined
    if (existingInstance && ['running', 'starting', 'stopping'].includes(existingInstance.status)) {
      throw new EasyTierValidationError('请先停止 EasyTier 实例再修改配置', 'managedInstanceId')
    }

    const existingSecrets = options.preserveExistingSecrets === false ? {} : await this.store.getSecrets(profileId)
    const mergedSecrets = normalizeEasyTierSecrets({ ...existingSecrets, ...secrets })
    const mergedSettings = {
      ...existing.settings,
      ...draft.settings,
      ...(draft.settings.flags
        ? { flags: { ...existing.settings.flags, ...draft.settings.flags } }
        : {}),
      ...(draft.settings.logging
        ? {
            logging: {
              ...existing.settings.logging,
              ...draft.settings.logging,
              ...(draft.settings.logging.console
                ? { console: { ...existing.settings.logging.console, ...draft.settings.logging.console } }
                : {}),
              ...(draft.settings.logging.file
                ? { file: { ...existing.settings.logging.file, ...draft.settings.logging.file } }
                : {})
            }
          }
        : {}),
      ...(draft.settings.secureMode
        ? { secureMode: { ...existing.settings.secureMode, ...draft.settings.secureMode } }
        : {}),
      ...(draft.settings.vpnPortal
        ? { vpnPortal: { ...existing.settings.vpnPortal, ...draft.settings.vpnPortal } }
        : {})
    }
    const mergedDraft: EasyTierProfileDraft = {
      ...existing,
      ...draft,
      id: profileId,
      binary: { ...existing.binary, ...draft.binary },
      settings: mergedSettings,
      managedInstanceId: existing.managedInstanceId,
      createdAt: existing.createdAt
    }
    let profile = normalizeEasyTierProfile(mergedDraft, mergedSecrets)
    this.assertRequiredSecrets(profile, mergedSecrets)
    profile = await this.prepareProfile(profile, mergedSecrets)
    profile = await this.store.saveProfile({
      profile,
      secrets: mergedSecrets,
      preserveExistingSecrets: false
    })

    if (profile.managedInstanceId || options.createInstance) {
      await this.upsertManagedInstance(profile.id)
    }
    return this.getProfileView(profile.id)
  }

  async upsertManagedInstance(profileId: string): Promise<Instance> {
    let profile = await this.getProfile(profileId)
    const linkedBeforeRepair = this.findOwnedInstance(profile)
    if (
      !['running', 'starting', 'stopping'].includes(linkedBeforeRepair?.status || '') &&
      !this.hasSafeRpcConfiguration(profile)
    ) {
      const secrets = await this.store.getSecrets(profile.id)
      profile = await this.prepareProfile(profile, secrets, { reassignUnsafeRpcPortal: true })
      profile = await this.store.saveProfileInPlace({
        profile,
        secrets,
        preserveExistingSecrets: false
      })
    }

    const capabilities = await this.detectCapabilities(profile.binary)
    this.assertManagedCompatibility(capabilities)
    if (
      profile.binary.corePath !== capabilities.corePath ||
      profile.binary.cliPath !== capabilities.cliPath ||
      !this.capabilitiesMatch(profile.capabilities, capabilities)
    ) {
      profile = await this.store.saveProfile({
        profile: {
          ...profile,
          binary: {
            corePath: capabilities.corePath,
            ...(capabilities.cliPath ? { cliPath: capabilities.cliPath } : {})
          },
          capabilities
        },
        preserveExistingSecrets: true
      })
    }

    const request = this.buildInstanceRequest(profile)
    const linkedInstance = this.findOwnedInstance(profile)
    let instance: Instance

    if (linkedInstance) {
      if (!this.isOwnedInstance(linkedInstance, profile)) {
        throw new Error(`拒绝覆盖不属于 EasyTier profile ${profile.id} 的实例`)
      }
      if (['running', 'starting', 'stopping'].includes(linkedInstance.status)) {
        if (!this.instanceMatchesRequest(linkedInstance, request)) {
          throw new Error('EasyTier 实例正在运行且配置已变化，请先停止实例')
        }
        instance = linkedInstance
      } else {
        const updated = await this.instanceManager.updateInstance(linkedInstance.id, request)
        if (!updated) throw new Error('更新 EasyTier 托管实例失败')
        instance = updated
      }
    } else {
      instance = await this.instanceManager.createInstance(request)
    }

    if (profile.managedInstanceId !== instance.id) {
      await this.store.saveProfile({
        profile: { ...profile, managedInstanceId: instance.id, capabilities },
        preserveExistingSecrets: true
      })
    }
    return instance
  }

  async startProfile(profileId: string): Promise<EasyTierProfileView> {
    const instance = await this.upsertManagedInstance(profileId)
    if (instance.status !== 'running') await this.instanceManager.startInstance(instance.id)
    return this.getProfileView(profileId)
  }

  async stopProfile(profileId: string): Promise<EasyTierProfileView> {
    const profile = await this.getProfile(profileId)
    const instance = this.requireOwnedInstance(profile)
    if (instance.status === 'starting' || instance.status === 'stopping') throw new Error('EasyTier 实例状态正在切换，请稍后重试')
    if (instance.status === 'running') await this.instanceManager.stopInstance(instance.id)
    return this.getProfileView(profileId)
  }

  async restartProfile(profileId: string): Promise<EasyTierProfileView> {
    const profile = await this.getProfile(profileId)
    const existing = profile.managedInstanceId
      ? this.instanceManager.getInstance(profile.managedInstanceId)
      : undefined
    if (existing && (existing.status === 'starting' || existing.status === 'stopping')) {
      throw new Error('EasyTier 实例状态正在切换，请稍后重试')
    }
    if (!existing || existing.status === 'stopped' || existing.status === 'error') {
      await this.startProfile(profileId)
      return this.getProfileView(profileId)
    }
    const instance = this.requireOwnedInstance(profile)
    await this.instanceManager.restartInstance(instance.id)
    return this.getProfileView(profileId)
  }

  async deleteProfile(profileId: string, deleteInstance = true): Promise<{ archivedDirectory: string | null }> {
    const profile = await this.getProfile(profileId)
    const instance = profile.managedInstanceId
      ? this.instanceManager.getInstance(profile.managedInstanceId)
      : undefined
    if (instance && !this.isOwnedInstance(instance, profile)) {
      throw new Error('关联实例不属于当前 EasyTier profile，已拒绝删除')
    }
    if (instance && ['starting', 'stopping'].includes(instance.status)) throw new Error('EasyTier 实例状态正在切换，请稍后重试')
    if (instance?.status === 'running') await this.instanceManager.stopInstance(instance.id)

    const archivedDirectory = await this.store.deleteProfileData(profileId)
    try {
      if (instance && deleteInstance) {
        await this.instanceManager.deleteInstance(instance.id)
      } else if (instance && archivedDirectory) {
        await this.store.prepareDetachedArchive(profile, archivedDirectory)
        const detachedRequest = this.buildInstanceRequest(profile, archivedDirectory)
        await this.instanceManager.updateInstance(instance.id, {
          ...detachedRequest,
          description: `[easytier-manager detached] former-profile=${profile.id} ${profile.description}`.trim()
        })
      }
      this.dropProfileSubscriptions(profileId)
      return { archivedDirectory }
    } catch (error) {
      if (archivedDirectory) await this.store.restoreProfileData(profileId, archivedDirectory).catch(() => {})
      throw error
    }
  }

  async getRuntimeSnapshot(profileId: string): Promise<EasyTierRuntimeSnapshot> {
    const profile = await this.getProfile(profileId)
    const instance = profile.managedInstanceId
      ? this.instanceManager.getInstance(profile.managedInstanceId)
      : undefined
    const state = toEasyTierRuntimeState(instance?.status)
    const baseSnapshot: EasyTierRuntimeSnapshot = {
      profileId,
      state,
      capturedAt: new Date().toISOString(),
      peers: [],
      routes: [],
      warnings: []
    }
    if (state !== 'running') return baseSnapshot

    const capabilities = profile.capabilities || await this.detectCapabilities(profile.binary)
    if (!capabilities.cliPath || !capabilities.supportsJsonOutput || !profile.settings.rpcPortal) {
      return {
        ...baseSnapshot,
        warnings: ['当前 profile 缺少可用的 JSON CLI 或 RPC portal'],
        error: 'EasyTier 实时管理能力不可用'
      }
    }

    const baseArgs = this.buildCliBaseArgs(profile)
    const cwd = this.store.getProfilePaths(profile.id).directory
    const [nodeResult, peersResult, routesResult, statsResult] = await Promise.allSettled([
      this.commandRunner.runJson<unknown>(capabilities.cliPath, [...baseArgs, 'node', 'info'], { cwd }),
      this.commandRunner.runJson<unknown>(capabilities.cliPath, [...baseArgs, 'peer', 'list'], { cwd }),
      this.commandRunner.runJson<unknown>(capabilities.cliPath, [...baseArgs, 'route', 'list'], { cwd }),
      this.commandRunner.runJson<unknown>(capabilities.cliPath, [...baseArgs, 'stats', 'show'], { cwd })
    ])
    const warnings = [
      ...getEasyTierSettledWarning('node', nodeResult),
      ...getEasyTierSettledWarning('peer', peersResult),
      ...getEasyTierSettledWarning('route', routesResult),
      ...getEasyTierSettledWarning('stats', statsResult)
    ]
    const rawNode = nodeResult.status === 'fulfilled' ? nodeResult.value : undefined
    const rawPeers = peersResult.status === 'fulfilled' ? peersResult.value : undefined
    const rawRoutes = routesResult.status === 'fulfilled' ? routesResult.value : undefined
    const rawStats = statsResult.status === 'fulfilled' ? statsResult.value : undefined
    return buildEasyTierRuntimeSnapshot({
      profileId,
      state,
      capturedAt: baseSnapshot.capturedAt,
      raw: {
        ...(rawNode !== undefined ? { node: rawNode } : {}),
        ...(rawPeers !== undefined ? { peers: rawPeers } : {}),
        ...(rawRoutes !== undefined ? { routes: rawRoutes } : {}),
        ...(rawStats !== undefined ? { stats: rawStats } : {})
      },
      warnings
    })
  }

  async subscribe(profileId: string, subscriberId: string): Promise<EasyTierRuntimeSnapshot> {
    await this.getProfile(profileId)
    const existingProfileIds = new Set(this.subscriberProfiles.get(subscriberId) || [])
    if (existingProfileIds.has(profileId)) {
      const cachedSnapshot = this.latestSnapshots.get(profileId)
      if (cachedSnapshot) return cachedSnapshot
    } else if (existingProfileIds.size >= this.maxSubscriptionsPerSubscriber) {
      throw new EasyTierValidationError(
        `每个连接最多订阅 ${this.maxSubscriptionsPerSubscriber} 个 EasyTier profile`,
        'profileId'
      )
    }

    const profileSubscribers = new Set(this.subscriptions.get(profileId) || [])
    profileSubscribers.add(subscriberId)
    this.subscriptions = new Map(this.subscriptions).set(profileId, profileSubscribers)
    const subscriberProfileIds = new Set(existingProfileIds)
    subscriberProfileIds.add(profileId)
    this.subscriberProfiles = new Map(this.subscriberProfiles).set(subscriberId, subscriberProfileIds)

    try {
      const snapshot = this.latestSnapshots.get(profileId) || await this.getRuntimeSnapshot(profileId)
      this.latestSnapshots = new Map(this.latestSnapshots).set(profileId, snapshot)
      this.schedulePoll(profileId)
      return snapshot
    } catch (error) {
      this.unsubscribe(profileId, subscriberId)
      throw error
    }
  }

  unsubscribe(profileId: string, subscriberId: string): void {
    const profileSubscribers = new Set(this.subscriptions.get(profileId) || [])
    profileSubscribers.delete(subscriberId)
    const nextSubscriptions = new Map(this.subscriptions)
    if (profileSubscribers.size > 0) nextSubscriptions.set(profileId, profileSubscribers)
    else nextSubscriptions.delete(profileId)
    this.subscriptions = nextSubscriptions

    const subscriberProfileIds = new Set(this.subscriberProfiles.get(subscriberId) || [])
    subscriberProfileIds.delete(profileId)
    const nextSubscriberProfiles = new Map(this.subscriberProfiles)
    if (subscriberProfileIds.size > 0) nextSubscriberProfiles.set(subscriberId, subscriberProfileIds)
    else nextSubscriberProfiles.delete(subscriberId)
    this.subscriberProfiles = nextSubscriberProfiles

    if (profileSubscribers.size === 0) this.clearPollTimer(profileId)
  }

  unsubscribeAll(subscriberId: string): void {
    for (const profileId of this.subscriberProfiles.get(subscriberId) || []) {
      this.unsubscribe(profileId, subscriberId)
    }
  }

  cleanup(): void {
    for (const timer of this.pollTimers.values()) clearTimeout(timer)
    this.pollTimers = new Map()
    this.pollInFlight = new Set()
    this.subscriptions = new Map()
    this.subscriberProfiles = new Map()
    this.latestSnapshots = new Map()
    this.removeAllListeners()
  }

  async executeRuntimeAction(
    profileId: string,
    action: EasyTierRuntimeAction
  ): Promise<EasyTierRuntimeActionResult> {
    const profile = await this.getProfile(profileId)
    const instance = this.requireOwnedInstance(profile)
    if (instance.status !== 'running') {
      throw new EasyTierValidationError('运行时操作要求 EasyTier 实例处于运行状态', 'action')
    }
    const capabilities = profile.capabilities || await this.detectCapabilities(profile.binary)
    if (!capabilities.cliPath || !capabilities.supportsJsonOutput) {
      throw new EasyTierCompatibilityError('当前 EasyTier 安装不支持 CLI 运行时管理', capabilities)
    }
    const secrets = await this.store.getSecrets(profile.id)
    const plan = buildEasyTierRuntimeActionPlan(profile, secrets, action)
    const baseArgs = this.buildCliBaseArgs(profile)
    const cwd = this.store.getProfilePaths(profile.id).directory
    await this.commandRunner.run(capabilities.cliPath, [...baseArgs, ...plan.args], { cwd })

    let savedProfile: EasyTierProfile
    try {
      savedProfile = await this.store.saveProfileInPlace({
        profile: plan.profile,
        secrets,
        preserveExistingSecrets: false
      })
    } catch (error) {
      if (plan.rollbackArgs) {
        await this.commandRunner.run(capabilities.cliPath, [...baseArgs, ...plan.rollbackArgs], { cwd }).catch(rollbackError => {
          this.logger.error(`EasyTier 运行时操作回滚失败 (${profile.id}):`, rollbackError)
        })
      }
      throw error
    }

    const snapshot = await this.getRuntimeSnapshot(profile.id)
    this.latestSnapshots = new Map(this.latestSnapshots).set(profile.id, snapshot)
    this.emit('snapshot', snapshot)
    return { profile: savedProfile, snapshot }
  }

  private buildCliBaseArgs(profile: EasyTierProfile): string[] {
    if (!profile.settings.rpcPortal) throw new Error('EasyTier profile 缺少 RPC portal')
    return [
      '--rpc-portal',
      profile.settings.rpcPortal,
      '--output',
      'json',
      '--instance-name',
      profile.settings.instanceName
    ]
  }

  private schedulePoll(profileId: string, delayMs = this.pollIntervalMs): void {
    if (this.pollTimers.has(profileId) || (this.subscriptions.get(profileId)?.size || 0) === 0) return
    const timer = setTimeout(() => {
      const timers = new Map(this.pollTimers)
      timers.delete(profileId)
      this.pollTimers = timers
      void this.pollProfile(profileId)
    }, delayMs)
    this.pollTimers = new Map(this.pollTimers).set(profileId, timer)
  }

  private async pollProfile(profileId: string): Promise<void> {
    if ((this.subscriptions.get(profileId)?.size || 0) === 0) return
    if (this.pollInFlight.has(profileId)) {
      this.schedulePoll(profileId)
      return
    }
    this.pollInFlight = new Set(this.pollInFlight).add(profileId)
    try {
      const snapshot = await this.getRuntimeSnapshot(profileId)
      this.latestSnapshots = new Map(this.latestSnapshots).set(profileId, snapshot)
      this.emit('snapshot', snapshot)
    } catch (error) {
      this.logger.warn(`EasyTier 快照轮询失败 (${profileId}): ${safeEasyTierErrorMessage(error)}`)
      if (error instanceof EasyTierNotFoundError) this.dropProfileSubscriptions(profileId)
    } finally {
      const nextInFlight = new Set(this.pollInFlight)
      nextInFlight.delete(profileId)
      this.pollInFlight = nextInFlight
      this.schedulePoll(profileId)
    }
  }

  private clearPollTimer(profileId: string): void {
    const timer = this.pollTimers.get(profileId)
    if (timer) clearTimeout(timer)
    const timers = new Map(this.pollTimers)
    timers.delete(profileId)
    this.pollTimers = timers
  }

  private dropProfileSubscriptions(profileId: string): void {
    for (const subscriberId of this.subscriptions.get(profileId) || []) {
      const profiles = new Set(this.subscriberProfiles.get(subscriberId) || [])
      profiles.delete(profileId)
      const nextSubscriberProfiles = new Map(this.subscriberProfiles)
      if (profiles.size > 0) nextSubscriberProfiles.set(subscriberId, profiles)
      else nextSubscriberProfiles.delete(subscriberId)
      this.subscriberProfiles = nextSubscriberProfiles
    }
    const subscriptions = new Map(this.subscriptions)
    subscriptions.delete(profileId)
    this.subscriptions = subscriptions
    const snapshots = new Map(this.latestSnapshots)
    snapshots.delete(profileId)
    this.latestSnapshots = snapshots
    this.clearPollTimer(profileId)
  }

  private async prepareProfile(
    profile: EasyTierProfile,
    secrets: EasyTierProfileSecrets,
    options: {
      allowOccupiedRpcPortal?: boolean
      reassignUnsafeRpcPortal?: boolean
    } = {}
  ): Promise<EasyTierProfile> {
    const safeRpcWhitelist = ['127.0.0.1/32', '::1/128']
    const currentRpcWhitelist = profile.settings.rpcPortalWhitelist || []
    const hasExpectedRpcWhitelist = currentRpcWhitelist.length === safeRpcWhitelist.length &&
      safeRpcWhitelist.every(value => currentRpcWhitelist.includes(value))
    if (!hasExpectedRpcWhitelist && !options.reassignUnsafeRpcPortal) {
      throw new EasyTierValidationError(
        'RPC portal 白名单固定为本机回环地址，不能配置远程网段',
        'settings.rpcPortalWhitelist'
      )
    }
    const rpcPortal = await this.ensureRpcPortal(profile, options)
    const capabilities = await this.detectCapabilities(profile.binary)
    const prepared = normalizeEasyTierProfile({
      ...profile,
      binary: {
        corePath: capabilities.corePath,
        ...(capabilities.cliPath ? { cliPath: capabilities.cliPath } : {})
      },
      capabilities,
      settings: {
        ...profile.settings,
        rpcPortal,
        rpcPortalWhitelist: safeRpcWhitelist
      }
    }, secrets)
    return { ...prepared, createdAt: profile.createdAt }
  }

  private assertRequiredSecrets(profile: EasyTierProfile, secrets: EasyTierProfileSecrets): void {
    const hasCredential = Boolean(secrets.credentialFileContent)
    if (!secrets.networkSecret && !(profile.settings.secureMode.enabled && hasCredential)) {
      throw new EasyTierValidationError('必须提供 networkSecret，或在 Secure Mode 下提供凭据文件', 'secrets.networkSecret')
    }
  }

  private findOwnedInstance(profile: EasyTierProfile): Instance | undefined {
    if (profile.managedInstanceId) {
      const linked = this.instanceManager.getInstance(profile.managedInstanceId)
      if (linked) return linked
    }
    return this.instanceManager.getInstances().find(instance => this.isOwnedInstance(instance, profile))
  }

  private requireOwnedInstance(profile: EasyTierProfile): Instance {
    const instance = this.findOwnedInstance(profile)
    if (!instance || !this.isOwnedInstance(instance, profile)) {
      throw new Error('EasyTier 托管实例不存在')
    }
    return instance
  }

  private isOwnedInstance(instance: Instance, profile: EasyTierProfile): boolean {
    if (instance.description.includes(`[easytier-manager:${profile.id}]`)) return true
    return Boolean(
      profile.migration &&
      instance.description.includes('[tunnel-helper] EasyTier') &&
      path.resolve(instance.workingDirectory) === path.resolve(profile.migration.legacyDirectory)
    )
  }

  private buildInstanceRequest(profile: EasyTierProfile, workingDirectory?: string): CreateInstanceRequest {
    const paths = this.store.getProfilePaths(profile.id)
    const directory = workingDirectory || paths.directory
    const rpcPortal = profile.settings.rpcPortal
    if (!rpcPortal) throw new Error('EasyTier profile 缺少 RPC portal')
    const executable = this.quoteCommandArgument(process.execPath)
    const isTypeScriptRuntime = fileURLToPath(import.meta.url).endsWith('.ts')
    const launcherPath = fileURLToPath(new URL(
      isTypeScriptRuntime ? './easytierLauncher.ts' : './easytierLauncher.js',
      import.meta.url
    ))
    const argumentsList = [
      ...(isTypeScriptRuntime ? [createRequire(import.meta.url).resolve('tsx/cli')] : []),
      launcherPath,
      profile.id,
      this.store.dataRoot,
      directory
    ].map(value => this.quoteCommandArgument(value))
    const rawCommand = `${executable} ${argumentsList.join(' ')}`
    const command = process.platform === 'win32'
      ? `& ${rawCommand}; exit $LASTEXITCODE`
      : `exec ${rawCommand}`

    return {
      name: `EasyTier-${profile.name}`,
      description: `[easytier-manager:${profile.id}] ${profile.description}`.trim(),
      workingDirectory: directory,
      startCommand: command,
      autoStart: profile.autoStart,
      stopCommand: 'ctrl+c',
      enableStreamForward: false,
      programPath: profile.binary.corePath,
      terminalUser: getCurrentUsername(),
      instanceType: 'generic'
    }
  }

  private instanceMatchesRequest(instance: Instance, request: CreateInstanceRequest): boolean {
    return instance.name === request.name &&
      instance.description === request.description &&
      path.resolve(instance.workingDirectory) === path.resolve(request.workingDirectory) &&
      instance.startCommand === request.startCommand &&
      instance.autoStart === request.autoStart &&
      instance.stopCommand === request.stopCommand
  }

  private quoteCommandArgument(value: string): string {
    return process.platform === 'win32'
      ? `'${value.replace(/'/g, "''")}'`
      : `'${value.replace(/'/g, `'"'"'`)}'`
  }

  private async ensureRpcPortal(
    profile: EasyTierProfile,
    options: {
      allowOccupiedRpcPortal?: boolean
      reassignUnsafeRpcPortal?: boolean
    } = {}
  ): Promise<string> {
    const profiles = await this.store.listProfiles()
    const reservedPorts = new Set(profiles
      .filter(item => item.id !== profile.id)
      .map(item => this.parseRpcPortal(item.settings.rpcPortal)?.port)
      .filter((port): port is number => typeof port === 'number'))
    let configured: { port: number; loopback: boolean } | undefined
    try {
      configured = this.parseRpcPortal(profile.settings.rpcPortal)
    } catch (error) {
      if (!options.reassignUnsafeRpcPortal) throw error
    }
    if (configured) {
      if (!configured.loopback || reservedPorts.has(configured.port)) {
        if (!options.reassignUnsafeRpcPortal) {
          const message = configured.loopback
            ? 'RPC portal 端口已被其他 EasyTier profile 使用'
            : 'RPC portal 只能绑定本机回环地址'
          throw new EasyTierValidationError(message, 'settings.rpcPortal')
        }
      } else if (options.allowOccupiedRpcPortal || await this.isPortAvailable(configured.port)) {
        return `127.0.0.1:${configured.port}`
      } else if (!options.reassignUnsafeRpcPortal) {
        throw new EasyTierValidationError('RPC portal 端口已被其他进程占用', 'settings.rpcPortal')
      }
    }

    const rangeStart = 16000
    const rangeSize = 1000
    const seed = Number.parseInt(createHash('sha256').update(profile.id).digest('hex').slice(0, 8), 16)
    for (let offset = 0; offset < rangeSize; offset += 1) {
      const port = rangeStart + ((seed + offset) % rangeSize)
      if (reservedPorts.has(port)) continue
      if (await this.isPortAvailable(port)) return `127.0.0.1:${port}`
    }
    throw new Error('无法为 EasyTier profile 分配可用的 RPC 端口')
  }

  private parseRpcPortal(value?: string): { port: number; loopback: boolean } | undefined {
    if (!value) return undefined
    const match = value.trim().match(/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/)
    if (!match) throw new EasyTierValidationError('RPC portal 格式必须是 host:port', 'settings.rpcPortal')
    const host = (match[1] || match[2]).toLowerCase()
    const port = Number(match[3])
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new EasyTierValidationError('RPC portal 端口必须在 1-65535 之间', 'settings.rpcPortal')
    }
    return {
      port,
      loopback: ['127.0.0.1', 'localhost', '::1'].includes(host)
    }
  }

  private hasSafeRpcConfiguration(profile: EasyTierProfile): boolean {
    try {
      const rpcPortal = this.parseRpcPortal(profile.settings.rpcPortal)
      const whitelist = profile.settings.rpcPortalWhitelist || []
      return Boolean(
        rpcPortal?.loopback &&
        whitelist.length === 2 &&
        whitelist.includes('127.0.0.1/32') &&
        whitelist.includes('::1/128')
      )
    } catch {
      return false
    }
  }

  private capabilitiesMatch(
    current: EasyTierBinaryCapabilities | undefined,
    detected: EasyTierBinaryCapabilities
  ): boolean {
    if (!current) return false
    return current.version === detected.version &&
      current.corePath === detected.corePath &&
      current.cliPath === detected.cliPath &&
      current.supportsConfigFile === detected.supportsConfigFile &&
      current.supportsJsonOutput === detected.supportsJsonOutput &&
      current.supportsSecureMode === detected.supportsSecureMode &&
      current.supportsCredentials === detected.supportsCredentials &&
      current.supportsAcl === detected.supportsAcl &&
      JSON.stringify(current.flags) === JSON.stringify(detected.flags) &&
      JSON.stringify(current.coreFlags) === JSON.stringify(detected.coreFlags) &&
      JSON.stringify(current.cliFlags) === JSON.stringify(detected.cliFlags) &&
      JSON.stringify(current.commands) === JSON.stringify(detected.commands) &&
      JSON.stringify(current.compatibilityWarnings) === JSON.stringify(detected.compatibilityWarnings)
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => server.close(() => resolve(true)))
      server.listen(port, '127.0.0.1')
    })
  }
}
