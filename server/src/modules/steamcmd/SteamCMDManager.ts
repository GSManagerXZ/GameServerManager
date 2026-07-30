import fs from 'fs/promises'
import path from 'path'
import https from 'https'
import { createWriteStream } from 'fs'
import * as tar from 'tar'
import winston from 'winston'
import os from 'os'
import { spawn, type ChildProcess } from 'child_process'
import { parse as parseVdf } from 'vdf-parser'
import { ConfigManager } from '../config/ConfigManager.js'
import { createTarSecurityFilter } from '../../utils/tarSecurityFilter.js'
import { zipToolsManager } from '../../utils/zipToolsManager.js'
import { StreamingRedactor } from '../../utils/streamingRedactor.js'
import {
  createSteamCMDRunScript,
  prepareSteamCMDLaunch,
  quoteSteamCMDConsoleArgument
} from '../../utils/steamcmdRunScript.js'

const STEAM_BRANCH_QUERY_TIMEOUT_MS = 2 * 60 * 1000

export interface SteamCMDInstallOptions {
  installPath: string
  onProgress?: (progress: number) => void
  onStatusChange?: (status: string) => void
}

export interface SteamCMDStatus {
  isInstalled: boolean
  version?: string
  installPath?: string
  lastChecked?: string
}

export interface SteamBranchInfo {
  name: string
  description?: string
  buildId?: string
  updatedAt?: string
  requiresPassword: boolean
  isDefault: boolean
}

export interface SteamBranchQueryOptions {
  forceRefresh?: boolean
  steamUsername?: string
  steamPassword?: string
}

export class SteamCMDManager {
  private logger: winston.Logger
  private configManager: ConfigManager
  private branchCache = new Map<string, { expiresAt: number; branches: SteamBranchInfo[] }>()
  private branchRequests = new Map<string, Promise<SteamBranchInfo[]>>()
  private branchQueryQueue: Promise<void> = Promise.resolve()
  private activeProcesses = new Set<ChildProcess>()
  private readonly WINDOWS_DOWNLOAD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
  private readonly LINUX_DOWNLOAD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz'

  constructor(logger: winston.Logger, configManager: ConfigManager) {
    this.logger = logger
    this.configManager = configManager
  }

  public async cleanup(): Promise<void> {
    const processes = Array.from(this.activeProcesses)
    await Promise.all(processes.map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) {
        this.activeProcesses.delete(child)
        resolve()
        return
      }

      let completed = false
      let forceKillTimer: NodeJS.Timeout | null = null
      let settleTimer: NodeJS.Timeout | null = null
      const finish = () => {
        if (completed) return
        completed = true
        if (forceKillTimer) clearTimeout(forceKillTimer)
        if (settleTimer) clearTimeout(settleTimer)
        child.removeListener('close', finish)
        child.removeListener('error', finish)
        this.activeProcesses.delete(child)
        resolve()
      }

      child.once('close', finish)
      child.once('error', finish)
      try {
        child.kill('SIGTERM')
      } catch (error) {
        this.logger.warn('终止SteamCMD查询进程失败', error)
      }

      forceKillTimer = setTimeout(() => {
        if (completed) return
        try {
          child.kill('SIGKILL')
        } catch (error) {
          this.logger.error('强制终止SteamCMD查询进程失败', error)
        }
      }, 1000)

      settleTimer = setTimeout(() => {
        this.logger.warn('等待SteamCMD查询进程退出超时', { pid: child.pid })
        finish()
      }, 3000)
    })))
  }

  /**
   * 获取当前SteamCMD状态
   */
  async getStatus(): Promise<SteamCMDStatus> {
    const config = this.configManager.getSteamCMDConfig()

    if (config.installMode === 'manual' && config.installPath) {
      const isInstalled = await this.checkSteamCMDExists(config.installPath)
      return {
        isInstalled,
        installPath: config.installPath,
        lastChecked: new Date().toISOString()
      }
    }

    return {
      isInstalled: config.isInstalled,
      version: config.version,
      installPath: config.installPath,
      lastChecked: config.lastChecked
    }
  }

  /**
   * 检查指定路径下是否存在SteamCMD可执行文件
   */
  async checkSteamCMDExists(installPath: string): Promise<boolean> {
    try {
      // 检查 steamcmd.exe (Windows)
      const exePath = path.join(installPath, 'steamcmd.exe')
      try {
        await fs.access(exePath)
        return true
      } catch { }

      // 检查 steamcmd.sh (Linux/Unix)
      const shPath = path.join(installPath, 'steamcmd.sh')
      try {
        await fs.access(shPath)
        return true
      } catch { }

      return false
    } catch {
      return false
    }
  }

  /**
   * 在线安装SteamCMD
   */
  async installOnline(options: SteamCMDInstallOptions): Promise<void> {
    const { installPath, onProgress, onStatusChange } = options

    try {
      onStatusChange?.('正在准备安装目录...')

      // 确保安装目录存在
      await fs.mkdir(installPath, { recursive: true })

      const isWindows = os.platform() === 'win32'
      const downloadUrl = isWindows ? this.WINDOWS_DOWNLOAD_URL : this.LINUX_DOWNLOAD_URL
      const fileName = isWindows ? 'steamcmd.zip' : 'steamcmd_linux.tar.gz'
      const downloadPath = path.join(installPath, fileName)

      onStatusChange?.('正在下载SteamCMD...')
      this.logger.info(`开始下载SteamCMD: ${downloadUrl}`)

      // 下载文件
      await this.downloadFile(downloadUrl, downloadPath, onProgress)

      // 验证下载的文件是否存在
      try {
        await fs.access(downloadPath)
        const stats = await fs.stat(downloadPath)
        this.logger.info(`下载完成，文件大小: ${stats.size} bytes`)

        if (stats.size === 0) {
          throw new Error('下载的文件为空')
        }
      } catch (error) {
        throw new Error(`下载的文件验证失败: ${error}`)
      }

      onStatusChange?.('正在解压文件...')
      this.logger.info('开始解压SteamCMD')

      // 解压文件
      try {
        if (isWindows) {
          await this.extractZip(downloadPath, installPath)
        } else {
          await this.extractTarGz(downloadPath, installPath)
        }
      } catch (error) {
        this.logger.error('解压过程中发生错误:', error)
        throw new Error(`解压失败: ${error}`)
      }

      // 删除下载的压缩包
      await fs.unlink(downloadPath)

      // 验证安装
      const isInstalled = await this.checkSteamCMDExists(installPath)
      if (!isInstalled) {
        throw new Error('SteamCMD安装验证失败')
      }

      // 更新配置
      await this.configManager.updateSteamCMDConfig({
        installMode: 'online',
        installPath,
        isInstalled: true,
        lastChecked: new Date().toISOString()
      })

      onStatusChange?.('安装完成')
      this.logger.info(`SteamCMD安装完成: ${installPath}`)

    } catch (error) {
      this.logger.error('SteamCMD安装失败:', error)
      throw error
    }
  }

  /**
   * 设置手动安装路径
   */
  async setManualPath(installPath: string): Promise<boolean> {
    try {
      const isInstalled = await this.checkSteamCMDExists(installPath)

      await this.configManager.updateSteamCMDConfig({
        installMode: 'manual',
        installPath,
        isInstalled,
        lastChecked: new Date().toISOString()
      })

      this.logger.info(`SteamCMD手动路径设置: ${installPath}, 状态: ${isInstalled ? '已安装' : '未找到'}`)
      return isInstalled
    } catch (error) {
      this.logger.error('设置SteamCMD手动路径失败:', error)
      throw error
    }
  }

  /**
   * 下载文件
   */
  private async downloadFile(url: string, filePath: string, onProgress?: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(filePath)

      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${response.statusCode}`))
          return
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedSize = 0

        response.on('data', (chunk) => {
          downloadedSize += chunk.length
          if (totalSize > 0 && onProgress) {
            const progress = Math.round((downloadedSize / totalSize) * 100)
            onProgress(progress)
          }
        })

        response.pipe(file)

        file.on('finish', () => {
          file.close()
          resolve()
        })

        file.on('error', (error) => {
          fs.unlink(filePath).catch(() => { })
          reject(error)
        })
      }).on('error', (error) => {
        reject(error)
      })
    })
  }

  /**
   * 解压ZIP文件
   */
  private async extractZip(zipPath: string, extractPath: string): Promise<void> {
    this.logger.info(`开始解压ZIP文件: ${zipPath} -> ${extractPath}`)
    await zipToolsManager.extractZip(zipPath, extractPath)
    this.logger.info('ZIP文件解压完成')
  }

  /**
   * 解压tar.gz文件
   */
  private async extractTarGz(tarPath: string, extractPath: string): Promise<void> {
    try {
      this.logger.info(`开始解压tar.gz文件: ${tarPath} -> ${extractPath}`)

      await tar.extract({
        file: tarPath,
        cwd: extractPath,
        filter: createTarSecurityFilter({ cwd: extractPath }),
        onentry: (entry) => {
          this.logger.debug(`解压文件: ${entry.path}`)
        }
      } as any)

      this.logger.info('tar.gz文件解压完成')
    } catch (error) {
      this.logger.error('tar.gz文件解压失败:', error)
      throw error
    }
  }

  /**
   * 获取SteamCMD可执行文件路径
   */
  async getSteamCMDExecutablePath(): Promise<string | null> {
    const config = this.configManager.getSteamCMDConfig()
    this.logger.info('Getting SteamCMD executable path with config:', { config })

    if (!config.isInstalled || !config.installPath) {
      this.logger.warn('SteamCMD not installed or path not set.', {
        isInstalled: config.isInstalled,
        installPath: config.installPath
      })
      return null
    }

    // 优先检查当前平台对应的可执行文件
    const isWindows = os.platform() === 'win32'
    const primaryExecutable = isWindows ? 'steamcmd.exe' : 'steamcmd.sh'
    const primaryPath = path.join(config.installPath, primaryExecutable)

    // 如果主要可执行文件存在，返回它
    try {
      await fs.access(primaryPath)
      return primaryPath
    } catch (error: any) {
      this.logger.warn('Primary executable not found, checking alternative.', {
        primaryPath,
        error: error.message
      })
    }

    // 否则检查另一个可执行文件
    const alternativeExecutable = isWindows ? 'steamcmd.sh' : 'steamcmd.exe'
    const alternativePath = path.join(config.installPath, alternativeExecutable)

    try {
      await fs.access(alternativePath)
      return alternativePath
    } catch (error: any) {
      this.logger.warn('Alternative executable not found.', {
        alternativePath,
        error: error.message
      })
    }

    return null
  }

  /**
   * 查询Steam应用可用分支
   */
  async getAppBranches(appId: string, options: SteamBranchQueryOptions = {}): Promise<SteamBranchInfo[]> {
    const normalizedAppId = appId.trim()
    if (!/^\d+$/.test(normalizedAppId) || normalizedAppId.length > 10 || Number(normalizedAppId) > 0xFFFFFFFF) {
      throw new Error('Steam AppID格式无效')
    }

    const credentials = this.normalizeBranchCredentials(options)
    if (credentials) {
      return this.enqueueBranchQuery(() => this.fetchAppBranches(normalizedAppId, credentials))
    }

    const now = Date.now()
    for (const [cachedAppId, entry] of this.branchCache) {
      if (entry.expiresAt <= now) this.branchCache.delete(cachedAppId)
    }

    const cached = this.branchCache.get(normalizedAppId)
    if (!options.forceRefresh && cached && cached.expiresAt > now) {
      return cached.branches.map(branch => ({ ...branch }))
    }

    const existingRequest = this.branchRequests.get(normalizedAppId)
    if (existingRequest) return existingRequest

    const request = this.enqueueBranchQuery(() => this.fetchAppBranches(normalizedAppId)).then(
      branches => branches.map(branch => ({ ...branch }))
    )
    this.branchRequests.set(normalizedAppId, request)
    try {
      const branches = await request
      this.branchCache.set(normalizedAppId, {
        expiresAt: Date.now() + 5 * 60 * 1000,
        branches
      })
      return branches.map(branch => ({ ...branch }))
    } finally {
      this.branchRequests.delete(normalizedAppId)
    }
  }

  private normalizeBranchCredentials(options: SteamBranchQueryOptions): { username: string; password: string } | undefined {
    const username = typeof options.steamUsername === 'string' ? options.steamUsername.trim() : ''
    const password = typeof options.steamPassword === 'string' ? options.steamPassword : ''

    if (!username && !password) return undefined
    if (!username || !password) {
      throw new Error('Steam账户信息不完整')
    }
    if (username.length > 128 || password.length > 256 || /[\r\n]/.test(username) || /[\r\n]/.test(password)) {
      throw new Error('Steam账户信息格式无效')
    }

    return { username, password }
  }

  private enqueueBranchQuery<T>(query: () => Promise<T>): Promise<T> {
    const result = this.branchQueryQueue.then(query, query)
    this.branchQueryQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async fetchAppBranches(
    appId: string,
    credentials?: { username: string; password: string }
  ): Promise<SteamBranchInfo[]> {
    const executablePath = await this.getSteamCMDExecutablePath()
    if (!executablePath) {
      throw new Error('SteamCMD未配置')
    }

    const loginCommand = credentials
      ? `login ${quoteSteamCMDConsoleArgument(credentials.username)} ${quoteSteamCMDConsoleArgument(credentials.password)}`
      : 'login anonymous'
    const attempts = [
      [
        loginCommand,
        `app_info_request ${appId}`,
        loginCommand,
        'app_info_update 1',
        `app_info_print ${appId} depots`,
        'logoff',
        'quit'
      ],
      [
        loginCommand,
        `app_info_request ${appId}`,
        loginCommand,
        `app_info_print ${appId}`,
        `app_info_print ${appId}`,
        'logoff',
        'quit'
      ],
      [
        loginCommand,
        'app_info_update 1',
        `app_info_print ${appId}`,
        'logoff',
        'quit'
      ]
    ]

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, attempt * 750))
        }
        const output = await this.runSteamCMDForOutput(
          executablePath,
          attempts[attempt],
          credentials?.password ? [credentials.password] : []
        )

        const branches = this.parseAppBranches(output, appId)
        if (branches.length > 0) {
          return branches
        }

        this.logger.warn(`第 ${attempt + 1} 次查询Steam应用 ${appId} 分支未返回有效数据`)
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error)
        const message = credentials?.password
          ? rawMessage.split(credentials.password).join('******')
          : rawMessage
        this.logger.warn(`第 ${attempt + 1} 次查询Steam应用 ${appId} 分支失败: ${message}`)
      }
    }

    throw new Error('未获取到Steam分支信息，部分游戏可能需要使用拥有该游戏的Steam账号查询')
  }

  private async runSteamCMDForOutput(
    executablePath: string,
    commands: string[],
    redactValues: string[] = []
  ): Promise<string> {
    const runScript = await createSteamCMDRunScript(commands)
    try {
      const workingDirectory = path.dirname(executablePath)
      await prepareSteamCMDLaunch(executablePath)
      return await new Promise((resolve, reject) => {
        const child = spawn(executablePath, [
          '-logdir', runScript.logDirectory,
          '+runscript', runScript.filePath
        ], {
          cwd: workingDirectory,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        this.activeProcesses.add(child)

        let stdout = ''
        let stderr = ''
        let settled = false
        let stopCapturingOutput = false
        let terminationError: Error | null = null
        let forceKillTimer: ReturnType<typeof setTimeout> | null = null
        const maxOutputLength = 10 * 1024 * 1024
        const stdoutRedactor = new StreamingRedactor(redactValues)
        const stderrRedactor = new StreamingRedactor(redactValues)

        const terminateAndWait = (error: Error) => {
          if (settled || terminationError) return

          terminationError = error
          stopCapturingOutput = true
          clearTimeout(timeout)

          try {
            child.kill()
          } catch {
            // The forced termination below remains the final fallback.
          }

          forceKillTimer = setTimeout(() => {
            if (settled) return
            try {
              child.kill('SIGKILL')
            } catch {
              // Keep waiting for close so the serialized queue cannot overlap processes.
            }
          }, 5000)
          forceKillTimer.unref?.()
        }

        const appendOutput = (target: 'stdout' | 'stderr', output: string) => {
          if (settled || stopCapturingOutput || !output) return
          if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + Buffer.byteLength(output) > maxOutputLength) {
            terminateAndWait(new Error('Steam分支查询输出过大'))
            return
          }

          if (target === 'stdout') stdout += output
          else stderr += output
        }

        const timeout = setTimeout(() => {
          terminateAndWait(new Error('查询Steam分支超时'))
        }, STEAM_BRANCH_QUERY_TIMEOUT_MS)
        timeout.unref?.()

        child.stdout.on('data', (data: Buffer) => {
          appendOutput('stdout', stdoutRedactor.write(data))
        })
        child.stdout.once('end', () => appendOutput('stdout', stdoutRedactor.end()))

        child.stderr.on('data', (data: Buffer) => {
          appendOutput('stderr', stderrRedactor.write(data))
        })
        child.stderr.once('end', () => appendOutput('stderr', stderrRedactor.end()))

        child.on('error', (error) => {
          if (settled) return
          terminateAndWait(error)
        })

        child.on('close', (code, signal) => {
          if (settled) return
          settled = true
          this.activeProcesses.delete(child)
          clearTimeout(timeout)
          if (forceKillTimer) clearTimeout(forceKillTimer)

          if (terminationError) {
            reject(terminationError)
            return
          }

          const output = [stdout, stderr].filter(value => value.trim()).join('\n')
          if (code !== 0 || signal) {
            const detail = stderr.trim().slice(-2000)
            reject(new Error(detail || `SteamCMD退出码: ${code ?? 'unknown'}${signal ? `，信号: ${signal}` : ''}`))
            return
          }

          resolve(output)
        })
      })
    } finally {
      await runScript.cleanup()
    }
  }

  private parseAppBranches(output: string, appId: string): SteamBranchInfo[] {
    const candidates = this.extractAppInfoVdfBlocks(output, appId)
    let lastParseError: unknown

    for (let index = candidates.length - 1; index >= 0; index--) {
      try {
        const parsed = parseVdf<Record<string, unknown>>(candidates[index], {
          types: false,
          arrayify: false
        })
        const appData = parsed?.[appId]
        const depots = this.getVdfObject(appData)?.depots
        const branchData = this.getVdfObject(this.getVdfObject(depots)?.branches)

        if (!branchData) continue

        const branches = Object.entries(branchData)
          .map(([name, value]) => {
            const data = this.getVdfObject(value) || {}
            const timestamp = Number(data.timeupdated ?? data.timebuildupdated)
            const timestampMilliseconds = timestamp * 1000

            return {
              name,
              description: typeof data.description === 'string' ? data.description : undefined,
              buildId: data.buildid !== undefined ? String(data.buildid) : undefined,
              updatedAt: Number.isFinite(timestampMilliseconds) && timestampMilliseconds > 0 && timestampMilliseconds <= 8.64e15
                ? new Date(timestampMilliseconds).toISOString()
                : undefined,
              requiresPassword: String(data.pwdrequired || '') === '1',
              isDefault: name === 'public'
            }
          })
          .sort((left, right) => {
            if (left.isDefault) return -1
            if (right.isDefault) return 1
            return left.name.localeCompare(right.name)
          })

        if (branches.length > 0) return branches
      } catch (error) {
        lastParseError = error
      }
    }

    if (lastParseError) {
      this.logger.warn(`解析Steam应用 ${appId} 分支信息失败:`, lastParseError)
    }
    return []
  }

  private getVdfObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as Record<string, unknown>
  }

  private extractAppInfoVdfBlocks(output: string, appId: string): string[] {
    const normalizedOutput = output
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\r\n/g, '\n')
    const key = `"${appId}"`
    const blocks: string[] = []
    let searchIndex = 0

    while (searchIndex < normalizedOutput.length) {
      const keyIndex = normalizedOutput.indexOf(key, searchIndex)
      if (keyIndex === -1) {
        break
      }

      let cursor = keyIndex + key.length
      while (/\s/.test(normalizedOutput[cursor] || '')) cursor++

      if (normalizedOutput[cursor] !== '{') {
        searchIndex = cursor + 1
        continue
      }

      let depth = 0
      let isQuoted = false
      let isEscaped = false
      let blockEnd = -1

      for (let index = cursor; index < normalizedOutput.length; index++) {
        const character = normalizedOutput[index]

        if (isQuoted) {
          if (isEscaped) {
            isEscaped = false
          } else if (character === '\\') {
            isEscaped = true
          } else if (character === '"') {
            isQuoted = false
          }
          continue
        }

        if (character === '"') {
          isQuoted = true
        } else if (character === '{') {
          depth++
        } else if (character === '}') {
          depth--
          if (depth === 0) {
            blockEnd = index + 1
            break
          }
        }
      }

      if (blockEnd !== -1) {
        blocks.push(normalizedOutput.slice(keyIndex, blockEnd))
        searchIndex = blockEnd
      } else {
        searchIndex = cursor + 1
      }
    }

    return blocks
  }

  /**
   * 重新检查SteamCMD状态
   */
  async refreshStatus(): Promise<SteamCMDStatus> {
    const config = this.configManager.getSteamCMDConfig()

    if (config.installPath) {
      const isInstalled = await this.checkSteamCMDExists(config.installPath)

      await this.configManager.updateSteamCMDConfig({
        isInstalled,
        lastChecked: new Date().toISOString()
      })

      return {
        isInstalled,
        installPath: config.installPath,
        lastChecked: new Date().toISOString()
      }
    }

    return {
      isInstalled: false
    }
  }
}
