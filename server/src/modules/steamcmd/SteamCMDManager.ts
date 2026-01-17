import fs from 'fs/promises'
import path from 'path'
import https from 'https'
import { createWriteStream, createReadStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Extract } from 'unzipper'
import * as tar from 'tar'
import winston from 'winston'
import os from 'os'
import { ConfigManager } from '../config/ConfigManager.js'

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

export class SteamCMDManager {
  private logger: winston.Logger
  private configManager: ConfigManager
  private readonly WINDOWS_DOWNLOAD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
  private readonly LINUX_DOWNLOAD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz'

  constructor(logger: winston.Logger, configManager: ConfigManager) {
    this.logger = logger
    this.configManager = configManager
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
    return new Promise((resolve, reject) => {
      this.logger.info(`开始解压ZIP文件: ${zipPath} -> ${extractPath}`)

      const readStream = createReadStream(zipPath)
      const extractStream = Extract({ path: extractPath })

      readStream
        .pipe(extractStream)
        .on('close', () => {
          this.logger.info('ZIP文件解压完成')
          resolve()
        })
        .on('error', (error) => {
          this.logger.error('ZIP文件解压失败:', error)
          reject(error)
        })

      readStream.on('error', (error) => {
        this.logger.error('读取ZIP文件失败:', error)
        reject(error)
      })

      extractStream.on('entry', (entry) => {
        this.logger.debug(`解压文件: ${entry.path}`)
      })
    })
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
        onentry: (entry) => {
          this.logger.debug(`解压文件: ${entry.path}`)
        }
      })

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