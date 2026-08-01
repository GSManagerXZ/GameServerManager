import { execFile } from 'child_process'
import dgram from 'dgram'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import net from 'net'
import path from 'path'
import { promisify } from 'util'
import { getCurrentUsername } from '../../utils/currentUser.js'
import type {
  CreateInstanceRequest,
  Instance,
  InstanceManager
} from '../instance/InstanceManager.js'
import { EasyTierInstaller } from './EasyTierInstaller.js'
import { getDefaultEasyTierDataRoot } from './easytierPaths.js'
import {
  EasyTierInstallation,
  EasyTierWebConfigProtocol,
  EasyTierWebSettings,
  EasyTierWebSettingsInput,
  EasyTierWebStatus
} from './easytierTypes.js'

const execFileAsync = promisify(execFile)
const WEB_SETTINGS_SCHEMA_VERSION = 1 as const
const WEB_INSTANCE_TAG = '[easytier-web-manager]'
const WEB_SETTINGS_FILE = 'settings.json'
const DEFAULT_API_PORT = 11211
const DEFAULT_CONFIG_PORT = 22020
const STARTUP_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 15_000

interface EasyTierWebManagerOptions {
  instanceManager: InstanceManager
  installer: EasyTierInstaller
  dataRoot?: string
  logger?: any
}

interface ManagedInstanceSyncResult {
  instance: Instance
  settings: EasyTierWebSettings
  created: boolean
  restarted: boolean
  operationToken: string
  release: () => void
  rollback: () => Promise<void>
}

export class EasyTierWebError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'EASYTIER_WEB_ERROR', status = 422) {
    super(message)
    this.name = 'EasyTierWebError'
    this.code = code
    this.status = status
  }
}

const normalizePort = (value: unknown, field: string, fallback: number): number => {
  const normalized = value === undefined || value === null || value === '' ? fallback : Number(value)
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw new EasyTierWebError(`${field} 必须是 1-65535 的整数`, 'EASYTIER_WEB_PORT_INVALID', 400)
  }
  return normalized
}

const normalizeBinaryPath = (value: unknown, fallback: string): string => {
  const normalized = String(value || fallback).trim()
  if (!normalized || normalized.length > 1024 || /[\r\n\0]/.test(normalized)) {
    throw new EasyTierWebError('EasyTier Web 程序路径无效', 'EASYTIER_WEB_BINARY_INVALID', 400)
  }
  return normalized
}

const normalizeApiHost = (value: unknown): string | undefined => {
  const normalized = String(value || '').trim()
  if (!normalized) return undefined
  if (normalized.length > 512) {
    throw new EasyTierWebError('API Host 过长', 'EASYTIER_WEB_API_HOST_INVALID', 400)
  }
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new EasyTierWebError('API Host 必须是有效的 HTTP(S) 地址', 'EASYTIER_WEB_API_HOST_INVALID', 400)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new EasyTierWebError('API Host 仅支持不含凭据的 HTTP(S) 地址', 'EASYTIER_WEB_API_HOST_INVALID', 400)
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new EasyTierWebError('API Host 只能填写站点根地址', 'EASYTIER_WEB_API_HOST_INVALID', 400)
  }
  return parsed.origin
}

const normalizeProtocol = (value: unknown): EasyTierWebConfigProtocol => {
  const normalized = String(value || 'udp').toLowerCase()
  if (!['udp', 'tcp', 'ws'].includes(normalized)) {
    throw new EasyTierWebError('配置服务协议仅支持 udp、tcp 或 ws', 'EASYTIER_WEB_PROTOCOL_INVALID', 400)
  }
  return normalized as EasyTierWebConfigProtocol
}

export class EasyTierWebManager {
  readonly dataRoot: string
  readonly webRoot: string
  readonly databasePath: string
  readonly logsDirectory: string
  private readonly settingsPath: string
  private readonly instanceManager: InstanceManager
  private readonly installer: EasyTierInstaller
  private readonly logger: any
  private settings: EasyTierWebSettings
  private isPersisted = false
  private binaryVersion?: string
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(options: EasyTierWebManagerOptions) {
    this.dataRoot = path.resolve(options.dataRoot || getDefaultEasyTierDataRoot())
    this.webRoot = path.join(this.dataRoot, 'web')
    this.databasePath = path.join(this.webRoot, 'et.db')
    this.logsDirectory = path.join(this.webRoot, 'logs')
    this.settingsPath = path.join(this.webRoot, WEB_SETTINGS_FILE)
    this.instanceManager = options.instanceManager
    this.installer = options.installer
    this.logger = options.logger || console
    this.settings = this.normalizeSettings({}, undefined, this.defaultExecutableName())
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.webRoot, { recursive: true, mode: 0o700 })
    await fs.mkdir(this.logsDirectory, { recursive: true, mode: 0o700 })
    const installationStatus = await this.installer.getStatus()
    const fallbackBinary = installationStatus.installation?.webEmbedPath || this.defaultExecutableName()

    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8')
      const stored = JSON.parse(content) as EasyTierWebSettingsInput & { managedInstanceId?: string; updatedAt?: string }
      this.settings = this.normalizeSettings(stored, stored, fallbackBinary)
      this.isPersisted = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`读取 EasyTier Web 配置失败，将使用默认值: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.settings = this.normalizeSettings({}, undefined, fallbackBinary)
      this.isPersisted = false
    }

    if (!this.isPersisted) return
    this.binaryVersion = await this.probeWebVersion(this.settings.binaryPath).catch(() => undefined)
    try {
      const syncResult = await this.syncManagedInstance(this.settings, false)
      if (syncResult.settings.managedInstanceId !== this.settings.managedInstanceId) {
        try {
          await this.writeSettings(syncResult.settings)
        } catch (error) {
          await this.rollbackManagedChange(syncResult.rollback, error)
        }
        this.settings = syncResult.settings
      }
      syncResult.release()
      if (syncResult.created && this.settings.autoStart) {
        await this.startUnlocked()
      }
    } catch (error) {
      this.logger.warn(`同步 EasyTier Web 托管实例失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async getStatus(): Promise<EasyTierWebStatus> {
    const instance = this.findOwnedInstance(this.settings)
    if (!this.binaryVersion) {
      this.binaryVersion = await this.probeWebVersion(this.settings.binaryPath).catch(() => undefined)
    }
    const healthy = instance?.status === 'running'
      ? await this.isPortReachable(this.probeHost(), this.settings.apiServerPort)
      : false
    const managementUrl = this.settings.apiHost
    const warnings = this.buildWarnings(instance, healthy)

    return {
      configured: this.isPersisted,
      binaryAvailable: Boolean(this.binaryVersion),
      ...(this.binaryVersion ? { version: this.binaryVersion } : {}),
      healthy,
      ...(managementUrl ? { managementUrl } : {}),
      configServerUri: this.buildConfigServerUri(),
      databasePath: this.databasePath,
      logsDirectory: this.logsDirectory,
      settings: { ...this.settings },
      ...(instance
        ? {
            instance: {
              id: instance.id,
              name: instance.name,
              status: instance.status,
              ...(instance.lastStarted ? { lastStarted: instance.lastStarted } : {}),
              ...(instance.lastStopped ? { lastStopped: instance.lastStopped } : {})
            }
          }
        : {}),
      warnings
    }
  }

  async adoptInstallation(installation: EasyTierInstallation): Promise<EasyTierWebStatus> {
    if (!this.isPersisted) {
      this.settings = this.normalizeSettings(
        { binaryPath: installation.webEmbedPath },
        this.settings,
        installation.webEmbedPath
      )
      this.binaryVersion = await this.probeWebVersion(installation.webEmbedPath)
      return this.getStatus()
    }
    const currentPath = path.resolve(this.settings.binaryPath)
    const managedBinRoot = path.resolve(this.installer.binRoot)
    const shouldAdopt = this.settings.binaryPath === this.defaultExecutableName() ||
      currentPath === managedBinRoot ||
      currentPath.startsWith(`${managedBinRoot}${path.sep}`)
    if (!shouldAdopt) return this.getStatus()
    return this.saveSettings({ binaryPath: installation.webEmbedPath }, true)
  }

  async saveSettings(input: EasyTierWebSettingsInput, restartIfRunning = false): Promise<EasyTierWebStatus> {
    return this.withOperation(() => this.saveSettingsUnlocked(input, restartIfRunning))
  }

  async start(): Promise<EasyTierWebStatus> {
    return this.withOperation(() => this.startUnlocked())
  }

  async stop(): Promise<EasyTierWebStatus> {
    return this.withOperation(() => this.stopUnlocked())
  }

  async restart(): Promise<EasyTierWebStatus> {
    return this.withOperation(() => this.restartUnlocked())
  }

  private async saveSettingsUnlocked(
    input: EasyTierWebSettingsInput,
    restartIfRunning: boolean
  ): Promise<EasyTierWebStatus> {
    const installationStatus = await this.installer.getStatus()
    const fallbackBinary = installationStatus.installation?.webEmbedPath || this.settings.binaryPath || this.defaultExecutableName()
    const nextSettings = this.normalizeSettings(input, this.settings, fallbackBinary)
    if (!path.isAbsolute(nextSettings.binaryPath)) {
      throw new EasyTierWebError('easytier-web-embed 必须使用绝对路径', 'EASYTIER_WEB_BINARY_PATH_INVALID', 400)
    }
    const version = await this.probeWebVersion(nextSettings.binaryPath)

    const syncResult = await this.syncManagedInstance(nextSettings, restartIfRunning)
    const committedSettings = {
      ...syncResult.settings,
      updatedAt: new Date().toISOString()
    }
    try {
      await this.writeSettings(committedSettings)
    } catch (error) {
      await this.rollbackManagedChange(syncResult.rollback, error)
    }

    this.settings = committedSettings
    this.binaryVersion = version
    this.isPersisted = true
    syncResult.release()
    return this.getStatus()
  }

  private async startUnlocked(): Promise<EasyTierWebStatus> {
    this.assertConfigured()
    const syncResult = await this.syncManagedInstance(this.settings, true)
    try {
      const instance = this.instanceManager.getInstance(syncResult.instance.id) || syncResult.instance
      if (instance.status === 'starting' || instance.status === 'stopping') {
        throw new EasyTierWebError('EasyTier Web 状态正在切换，请稍后重试', 'EASYTIER_WEB_STATE_TRANSITION', 409)
      }
      if (instance.status !== 'running') {
        await this.startManagedInstance(instance.id, syncResult.settings, syncResult.operationToken)
      }
      await this.persistManagedInstanceLink(syncResult.settings)
      syncResult.release()
    } catch (error) {
      await this.rollbackManagedChange(syncResult.rollback, error)
    }
    return this.getStatus()
  }

  private async stopUnlocked(): Promise<EasyTierWebStatus> {
    const instance = this.findOwnedInstance(this.settings)
    if (!instance || ['stopped', 'error'].includes(instance.status)) return this.getStatus()
    const operationToken = randomUUID()
    if (!this.instanceManager.acquireOperationLock(instance.id, operationToken, '停止 EasyTier Web')) {
      throw new EasyTierWebError('EasyTier Web 托管实例正在执行其他操作', 'EASYTIER_WEB_INSTANCE_BUSY', 409)
    }
    try {
      if (instance.status === 'starting') {
        throw new EasyTierWebError('EasyTier Web 正在启动，请稍后重试', 'EASYTIER_WEB_STATE_TRANSITION', 409)
      }
      if (instance.status === 'running') {
        await this.instanceManager.stopInstance(instance.id, operationToken)
      }
      await this.waitForInstanceStopped(instance.id)
    } finally {
      this.instanceManager.releaseOperationLock(instance.id, operationToken)
    }
    return this.getStatus()
  }

  private async restartUnlocked(): Promise<EasyTierWebStatus> {
    this.assertConfigured()
    const syncResult = await this.syncManagedInstance(this.settings, true)
    try {
      const instance = this.instanceManager.getInstance(syncResult.instance.id) || syncResult.instance
      if (instance.status === 'starting' || instance.status === 'stopping') {
        throw new EasyTierWebError('EasyTier Web 状态正在切换，请稍后重试', 'EASYTIER_WEB_STATE_TRANSITION', 409)
      }
      if (!syncResult.restarted) {
        if (instance.status === 'running') {
          await this.instanceManager.stopInstance(instance.id, syncResult.operationToken)
          await this.waitForInstanceStopped(instance.id)
        }
        await this.startManagedInstance(instance.id, syncResult.settings, syncResult.operationToken)
      }
      await this.persistManagedInstanceLink(syncResult.settings)
      syncResult.release()
    } catch (error) {
      await this.rollbackManagedChange(syncResult.rollback, error)
    }
    return this.getStatus()
  }

  private normalizeSettings(
    input: EasyTierWebSettingsInput & { managedInstanceId?: string; updatedAt?: string },
    existing: EasyTierWebSettings | (EasyTierWebSettingsInput & { managedInstanceId?: string; updatedAt?: string }) | undefined,
    fallbackBinary: string
  ): EasyTierWebSettings {
    const source = { ...(existing || {}), ...(input || {}) }
    const apiServerAddress = String(source.apiServerAddress || '127.0.0.1').trim()
    if (!net.isIP(apiServerAddress)) {
      throw new EasyTierWebError('API 监听地址必须是有效的 IPv4 或 IPv6 地址', 'EASYTIER_WEB_ADDRESS_INVALID', 400)
    }
    const apiServerPort = normalizePort(source.apiServerPort, 'API 服务端口', DEFAULT_API_PORT)
    const configServerPort = normalizePort(source.configServerPort, '配置下发端口', DEFAULT_CONFIG_PORT)
    const configServerProtocol = normalizeProtocol(source.configServerProtocol)
    const apiHost = normalizeApiHost(source.apiHost)
    if (apiServerPort === configServerPort && configServerProtocol !== 'udp') {
      throw new EasyTierWebError('TCP/WS 配置服务端口不能与 API 服务端口相同', 'EASYTIER_WEB_PORT_CONFLICT', 400)
    }
    return {
      schemaVersion: WEB_SETTINGS_SCHEMA_VERSION,
      binaryPath: normalizeBinaryPath(source.binaryPath, fallbackBinary),
      apiServerAddress,
      apiServerPort,
      ...(apiHost ? { apiHost } : {}),
      configServerPort,
      configServerProtocol,
      disableRegistration: source.disableRegistration === undefined
        ? true
        : source.disableRegistration === true,
      allowAutoCreateUser: source.allowAutoCreateUser === true,
      autoStart: source.autoStart === true,
      ...(existing?.managedInstanceId ? { managedInstanceId: existing.managedInstanceId } : {}),
      updatedAt: new Date().toISOString()
    }
  }

  private async syncManagedInstance(
    settings: EasyTierWebSettings,
    restartIfRunning: boolean
  ): Promise<ManagedInstanceSyncResult> {
    const request = this.buildInstanceRequest(settings)
    const existing = this.findOwnedInstance(settings)
    if (!existing) {
      const operationToken = randomUUID()
      const instance = await this.instanceManager.createInstance(request, {
        token: operationToken,
        reason: '同步 EasyTier Web 配置'
      })
      const release = (): void => this.instanceManager.releaseOperationLock(instance.id, operationToken)
      return {
        instance,
        settings: { ...settings, managedInstanceId: instance.id, updatedAt: new Date().toISOString() },
        created: true,
        restarted: false,
        operationToken,
        release,
        rollback: async () => {
          try {
            const current = this.instanceManager.getInstance(instance.id)
            if (!current) return
            if (current.status === 'running') {
              await this.instanceManager.stopInstance(current.id, operationToken)
              await this.waitForInstanceStopped(current.id)
            } else if (current.status === 'starting' || current.status === 'stopping') {
              await this.waitForInstanceStopped(current.id)
            }
            await this.instanceManager.deleteInstance(current.id, operationToken)
          } finally {
            release()
          }
        }
      }
    }
    const operationToken = randomUUID()
    if (!this.instanceManager.acquireOperationLock(existing.id, operationToken, '同步 EasyTier Web 配置')) {
      throw new EasyTierWebError('EasyTier Web 托管实例正在执行其他操作', 'EASYTIER_WEB_INSTANCE_BUSY', 409)
    }
    const release = (): void => this.instanceManager.releaseOperationLock(existing.id, operationToken)
    if (this.instanceMatchesRequest(existing, request)) {
      return {
        instance: existing,
        settings: settings.managedInstanceId === existing.id ? settings : { ...settings, managedInstanceId: existing.id },
        created: false,
        restarted: false,
        operationToken,
        release,
        rollback: async () => { release() }
      }
    }
    if (existing.status === 'starting' || existing.status === 'stopping') {
      release()
      throw new EasyTierWebError('EasyTier Web 状态正在切换，请稍后重试', 'EASYTIER_WEB_STATE_TRANSITION', 409)
    }
    const wasRunning = existing.status === 'running'
    if (wasRunning && !restartIfRunning) {
      release()
      throw new EasyTierWebError(
        'EasyTier Web 正在运行；保存此配置需要允许自动重启',
        'EASYTIER_WEB_RESTART_REQUIRED',
        409
      )
    }
    const previousRequest = this.buildRequestFromInstance(existing)
    let hasUpdatedInstance = false
    try {
      if (wasRunning) {
        await this.instanceManager.stopInstance(existing.id, operationToken)
        await this.waitForInstanceStopped(existing.id)
      }
      const updated = await this.instanceManager.updateInstance(existing.id, request, operationToken)
      if (!updated) throw new EasyTierWebError('EasyTier Web 托管实例不存在', 'EASYTIER_WEB_INSTANCE_MISSING', 404)
      hasUpdatedInstance = true
      if (wasRunning) await this.startManagedInstance(updated.id, settings, operationToken)
      return {
        instance: updated,
        settings: settings.managedInstanceId === updated.id ? settings : { ...settings, managedInstanceId: updated.id },
        created: false,
      restarted: wasRunning,
        operationToken,
        release,
        rollback: async () => {
          try {
            await this.restoreManagedInstance(updated.id, previousRequest, wasRunning, this.settings, operationToken)
          } finally {
            release()
          }
        }
      }
    } catch (error) {
      try {
        if (hasUpdatedInstance) {
          await this.restoreManagedInstance(existing.id, previousRequest, wasRunning, this.settings, operationToken)
        } else if (wasRunning) {
          await this.startManagedInstance(existing.id, this.settings, operationToken)
        }
      } catch (rollbackError) {
        this.logger.error('回滚 EasyTier Web 托管实例失败:', rollbackError)
        release()
        throw new EasyTierWebError(
          `EasyTier Web 配置失败，且自动回滚失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          'EASYTIER_WEB_ROLLBACK_FAILED',
          500
        )
      }
      release()
      throw error
    }
  }

  private buildInstanceRequest(settings: EasyTierWebSettings): CreateInstanceRequest {
    const args = [
      '--db', this.databasePath,
      '--api-server-addr', settings.apiServerAddress,
      '--api-server-port', String(settings.apiServerPort),
      '--config-server-port', String(settings.configServerPort),
      '--config-server-protocol', settings.configServerProtocol,
      '--file-log-dir', this.logsDirectory,
      '--file-log-level', 'info',
      '--console-log-level', 'info',
      ...(settings.apiHost ? ['--api-host', settings.apiHost] : []),
      ...(settings.disableRegistration ? ['--disable-registration'] : []),
      ...(settings.allowAutoCreateUser ? ['--allow-auto-create-user'] : [])
    ]
    const executable = this.quoteCommandArgument(settings.binaryPath)
    const rawCommand = `${executable} ${args.map(value => this.quoteCommandArgument(value)).join(' ')}`
    const command = process.platform === 'win32'
      ? `& ${rawCommand}; exit $LASTEXITCODE`
      : `exec ${rawCommand}`
    return {
      name: 'EasyTier-Web-Console',
      description: `${WEB_INSTANCE_TAG} EasyTier Web 控制台`,
      workingDirectory: this.webRoot,
      startCommand: command,
      autoStart: settings.autoStart,
      stopCommand: 'ctrl+c',
      enableStreamForward: false,
      programPath: settings.binaryPath,
      terminalUser: getCurrentUsername(),
      instanceType: 'generic'
    }
  }

  private findOwnedInstance(settings: EasyTierWebSettings): Instance | undefined {
    const instances = this.instanceManager.getInstances()
    if (settings.managedInstanceId) {
      const linked = instances.find(instance => instance.id === settings.managedInstanceId)
      if (linked?.description.includes(WEB_INSTANCE_TAG)) return linked
    }
    return instances.find(instance => instance.description.includes(WEB_INSTANCE_TAG))
  }

  private instanceMatchesRequest(instance: Instance, request: CreateInstanceRequest): boolean {
    return instance.name === request.name &&
      instance.description === request.description &&
      instance.workingDirectory === request.workingDirectory &&
      instance.startCommand === request.startCommand &&
      instance.autoStart === request.autoStart &&
      instance.stopCommand === request.stopCommand &&
      instance.programPath === request.programPath &&
      instance.enableStreamForward === request.enableStreamForward &&
      instance.terminalUser === request.terminalUser
  }

  private buildRequestFromInstance(instance: Instance): CreateInstanceRequest {
    return {
      name: instance.name,
      description: instance.description,
      workingDirectory: instance.workingDirectory,
      startCommand: instance.startCommand,
      autoStart: instance.autoStart,
      stopCommand: instance.stopCommand,
      enableStreamForward: instance.enableStreamForward,
      programPath: instance.programPath,
      terminalUser: instance.terminalUser,
      instanceType: instance.instanceType,
      javaVersion: instance.javaVersion,
      steam: instance.steam
    }
  }

  private async restoreManagedInstance(
    instanceId: string,
    previousRequest: CreateInstanceRequest,
    wasRunning: boolean,
    previousSettings: EasyTierWebSettings,
    operationToken?: string
  ): Promise<void> {
    const current = this.instanceManager.getInstance(instanceId)
    if (!current) throw new Error('EasyTier Web 托管实例已不存在')
    if (current.status === 'running') {
      await this.instanceManager.stopInstance(instanceId, operationToken)
      await this.waitForInstanceStopped(instanceId)
    } else if (current.status === 'starting' || current.status === 'stopping') {
      await this.waitForInstanceStopped(instanceId)
    }
    const restored = await this.instanceManager.updateInstance(instanceId, previousRequest, operationToken)
    if (!restored) throw new Error('EasyTier Web 托管实例回滚失败')
    if (wasRunning) await this.startManagedInstance(instanceId, previousSettings, operationToken)
  }

  private async startManagedInstance(
    instanceId: string,
    settings: EasyTierWebSettings,
    operationToken?: string
  ): Promise<void> {
    await this.assertPortsAvailable(settings)
    await this.instanceManager.startInstance(instanceId, operationToken)
    try {
      await this.waitForApiServer(instanceId, settings)
    } catch (error) {
      const current = this.instanceManager.getInstance(instanceId)
      if (current?.status === 'running') {
        await this.instanceManager.stopInstance(instanceId, operationToken).catch(() => undefined)
        await this.waitForInstanceStopped(instanceId).catch(() => undefined)
      }
      throw error
    }
  }

  private async persistManagedInstanceLink(settings: EasyTierWebSettings): Promise<void> {
    if (settings.managedInstanceId === this.settings.managedInstanceId) return
    const committedSettings = { ...settings, updatedAt: new Date().toISOString() }
    await this.writeSettings(committedSettings)
    this.settings = committedSettings
  }

  private async rollbackManagedChange(rollback: () => Promise<void>, originalError: unknown): Promise<never> {
    try {
      await rollback()
    } catch (rollbackError) {
      this.logger.error('回滚 EasyTier Web 变更失败:', rollbackError)
      throw new EasyTierWebError(
        `EasyTier Web 操作失败，且自动回滚失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        'EASYTIER_WEB_ROLLBACK_FAILED',
        500
      )
    }
    throw originalError
  }

  private async withOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue
    let release: () => void = () => undefined
    this.operationQueue = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async probeWebVersion(binaryPath: string): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'], {
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      })
      const output = `${stdout || ''}\n${stderr || ''}`.trim()
      if (!/^easytier-web(?:-embed)?\s+/i.test(output)) {
        throw new Error('目标程序不是 easytier-web-embed')
      }
      return output.split(/\s+/)[1] || output
    } catch (error) {
      throw new EasyTierWebError(
        `无法执行 EasyTier Web 程序: ${error instanceof Error ? error.message : String(error)}`,
        'EASYTIER_WEB_BINARY_UNAVAILABLE',
        422
      )
    }
  }

  private async writeSettings(settings: EasyTierWebSettings): Promise<void> {
    await fs.mkdir(this.webRoot, { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.settingsPath}.${randomUUID()}.tmp`
    const replacementBackup = `${this.settingsPath}.${randomUUID()}.backup`
    let preserveBackup = false
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600
      })
      if (process.platform === 'win32' && await this.pathExists(this.settingsPath)) {
        await fs.rename(this.settingsPath, replacementBackup)
        try {
          await fs.rename(temporaryPath, this.settingsPath)
        } catch (error) {
          try {
            await fs.rename(replacementBackup, this.settingsPath)
          } catch (rollbackError) {
            preserveBackup = true
            throw new Error(
              `替换 EasyTier Web 配置失败，原配置保留在 ${replacementBackup}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            )
          }
          throw error
        }
      } else {
        await fs.rename(temporaryPath, this.settingsPath)
      }
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      if (!preserveBackup) await fs.rm(replacementBackup, { force: true }).catch(() => undefined)
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private buildWarnings(instance: Instance | undefined, healthy: boolean): string[] {
    return [
      ...(!this.isPersisted ? ['尚未保存 EasyTier Web 配置。'] : []),
      ...(!this.binaryVersion ? ['EasyTier Web 程序不可用，请先一键安装或填写有效路径。'] : []),
      ...(this.settings.apiServerAddress === '0.0.0.0' || this.settings.apiServerAddress === '::'
        ? ['Web 控制台监听所有网卡；请使用防火墙、反向代理或可信网络限制访问。']
        : []),
      ...(!this.settings.apiHost ? ['未配置 API Host；Web 前端将要求手动填写 API 地址。'] : []),
      ...(!this.settings.disableRegistration ? ['用户注册当前处于开放状态；完成首个账户注册后建议关闭。'] : []),
      ...(instance?.status === 'running' && !healthy ? ['托管实例已启动，但 API 端口尚未响应。'] : [])
    ]
  }

  private buildConfigServerUri(): string {
    let host = '127.0.0.1'
    if (this.settings.apiHost) {
      try {
        host = new URL(this.settings.apiHost).hostname
      } catch {
        host = '127.0.0.1'
      }
    }
    return `${this.settings.configServerProtocol}://${host}:${this.settings.configServerPort}/<用户名>`
  }

  private assertConfigured(): void {
    if (!this.isPersisted) {
      throw new EasyTierWebError('请先保存 EasyTier Web 配置', 'EASYTIER_WEB_NOT_CONFIGURED', 409)
    }
    if (!this.binaryVersion) {
      throw new EasyTierWebError('EasyTier Web 程序不可用', 'EASYTIER_WEB_BINARY_UNAVAILABLE', 422)
    }
    if (!path.isAbsolute(this.settings.binaryPath)) {
      throw new EasyTierWebError('easytier-web-embed 必须使用绝对路径，请重新保存配置', 'EASYTIER_WEB_BINARY_PATH_INVALID', 422)
    }
  }

  private async assertPortsAvailable(settings: EasyTierWebSettings): Promise<void> {
    const apiAvailable = await this.isTcpPortAvailable(settings.apiServerAddress, settings.apiServerPort)
    if (!apiAvailable) {
      throw new EasyTierWebError(`API 端口 ${settings.apiServerPort} 已被占用`, 'EASYTIER_WEB_API_PORT_OCCUPIED', 409)
    }
    const configAvailable = settings.configServerProtocol === 'udp'
      ? await this.isUdpPortAvailable(settings.apiServerAddress, settings.configServerPort)
      : await this.isTcpPortAvailable(settings.apiServerAddress, settings.configServerPort)
    if (!configAvailable) {
      throw new EasyTierWebError(`配置下发端口 ${settings.configServerPort} 已被占用`, 'EASYTIER_WEB_CONFIG_PORT_OCCUPIED', 409)
    }
  }

  private isTcpPortAvailable(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer()
      server.unref()
      server.once('error', () => resolve(false))
      server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)))
    })
  }

  private isUdpPortAvailable(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4')
      socket.unref()
      socket.once('error', () => {
        try {
          socket.close()
        } catch {
          // Socket may not have reached the bound state.
        }
        resolve(false)
      })
      socket.bind(port, host, () => {
        socket.close()
        resolve(true)
      })
    })
  }

  private isPortReachable(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = net.createConnection({ host, port })
      const finish = (reachable: boolean): void => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(reachable)
      }
      socket.setTimeout(1200)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(false))
    })
  }

  private async waitForApiServer(instanceId: string, settings: EasyTierWebSettings): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await this.isPortReachable(this.probeHost(settings), settings.apiServerPort)) return
      const instance = this.instanceManager.getInstance(instanceId)
      if (!instance || instance.status === 'stopped' || instance.status === 'error') {
        throw new EasyTierWebError(
          'EasyTier Web 进程在 API 就绪前退出，请查看实例终端或日志',
          'EASYTIER_WEB_PROCESS_EXITED',
          502
        )
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new EasyTierWebError(
      `EasyTier Web 启动超时，API 端口 ${settings.apiServerPort} 未响应`,
      'EASYTIER_WEB_START_TIMEOUT',
      504
    )
  }

  private async waitForInstanceStopped(instanceId: string): Promise<void> {
    const deadline = Date.now() + STOP_TIMEOUT_MS
    while (Date.now() < deadline) {
      const instance = this.instanceManager.getInstance(instanceId)
      if (!instance || instance.status === 'stopped' || instance.status === 'error') return
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new EasyTierWebError('EasyTier Web 停止超时', 'EASYTIER_WEB_STOP_TIMEOUT', 504)
  }

  private probeHost(settings: EasyTierWebSettings = this.settings): string {
    if (settings.apiServerAddress === '0.0.0.0') return '127.0.0.1'
    if (settings.apiServerAddress === '::') return '::1'
    return settings.apiServerAddress
  }

  private quoteCommandArgument(value: string): string {
    return process.platform === 'win32'
      ? `'${value.replace(/'/g, "''")}'`
      : `'${value.replace(/'/g, `'"'"'`)}'`
  }

  private defaultExecutableName(): string {
    return process.platform === 'win32' ? 'easytier-web-embed.exe' : 'easytier-web-embed'
  }
}
