import path from 'path'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import logger from './logger.js'

/**
 * 支持的操作系统平台列表
 */
const SUPPORTED_PLATFORMS = new Set(['win32', 'linux'])

/**
 * 支持的 CPU 架构列表
 */
const SUPPORTED_ARCHS = new Set(['x64', 'arm64'])

/**
 * PTY 二进制文件管理器
 * 负责 PTY 二进制文件的路径解析、检测、下载
 * 参照 ZipToolsManager 的设计模式
 */
class PtyManager {
  /** 自建镜像下载基础 URL（运行时使用，国内加速） */
  private readonly DOWNLOAD_BASE_URL =
    'https://download.xiaozhuhouses.asia/%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE/GSManager/GSManager3/%E8%BF%90%E8%A1%8C%E4%BE%9D%E8%B5%96/PTY/'

  /** GitHub Releases 备用下载 URL */
  private readonly FALLBACK_DOWNLOAD_URL =
    'https://github.com/MCSManager/PTY/releases/tag/latest/download/'

  /**
   * 获取当前平台对应的 PTY 二进制文件名
   * 命名规则：pty_{platform}_{arch}，Windows 追加 .exe
   *
   * 实际文件命名：
   *   - win32/x64   → pty_win32_x64.exe
   *   - linux/x64   → pty_linux_x64
   *   - linux/arm64  → pty_linux_arm64
   */
  getBinaryName(): string {
    const platform = process.platform
    const arch = process.arch

    if (!SUPPORTED_PLATFORMS.has(platform)) {
      throw new Error(`不支持的操作系统平台: ${platform}`)
    }
    if (!SUPPORTED_ARCHS.has(arch)) {
      throw new Error(`不支持的 CPU 架构: ${arch}`)
    }

    const name = `pty_${platform}_${arch}`
    return platform === 'win32' ? `${name}.exe` : name
  }

  /**
   * 获取 lib 目录的候选路径列表
   * 使用多路径尝试策略，兼容打包后环境和开发环境
   */
  private getLibDirCandidates(): string[] {
    const baseDir = process.cwd()
    return [
      path.join(baseDir, 'data', 'lib'),           // 打包后环境
      path.join(baseDir, 'server', 'data', 'lib'), // 开发环境
    ]
  }

  /**
   * 使用多路径尝试策略获取 PTY 二进制文件绝对路径
   * 依次尝试 data/lib/ 和 server/data/lib/ 目录
   */
  async getPtyPath(): Promise<string> {
    const binaryName = this.getBinaryName()
    const candidates = this.getLibDirCandidates()

    for (const libDir of candidates) {
      const fullPath = path.join(libDir, binaryName)
      try {
        await fs.access(fullPath)
        return fullPath
      } catch {
        // 该路径不存在，尝试下一个
      }
    }

    throw new Error(
      `未找到 PTY 二进制文件 (${binaryName})，已尝试路径: ${candidates.map(d => path.join(d, binaryName)).join(', ')}`
    )
  }

  /**
   * 检测 PTY 二进制文件是否存在
   */
  async isInstalled(): Promise<boolean> {
    try {
      await this.getPtyPath()
      return true
    } catch {
      return false
    }
  }

  /**
   * 从指定 URL 下载二进制文件到目标路径
   * 非 Windows 平台设置 chmod 0o755
   */
  private async downloadFromUrl(url: string, targetPath: string): Promise<void> {
    const axios = (await import('axios')).default
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000, // 60 秒超时
    })

    // 使用流式写入文件
    const writer = createWriteStream(targetPath)
    await pipeline(response.data, writer)

    // 检查文件大小，防止下载空文件
    const stat = await fs.stat(targetPath)
    if (stat.size === 0) {
      await fs.unlink(targetPath)
      throw new Error('下载的文件大小为 0，已删除')
    }

    // 非 Windows 平台设置可执行权限
    if (process.platform !== 'win32') {
      await fs.chmod(targetPath, 0o755)
    }
  }

  /**
   * 下载 PTY 二进制文件到第一个可写的 lib 目录
   * 优先从自建镜像下载，失败后回退到 GitHub Releases
   */
  async download(): Promise<void> {
    const binaryName = this.getBinaryName()
    const candidates = this.getLibDirCandidates()

    // 选择第一个可用的 lib 目录（优先打包后路径）
    let targetDir: string | null = null
    for (const dir of candidates) {
      try {
        await fs.mkdir(dir, { recursive: true })
        targetDir = dir
        break
      } catch {
        // 无法创建该目录，尝试下一个
      }
    }

    if (!targetDir) {
      throw new Error(`无法创建 lib 目录，已尝试: ${candidates.join(', ')}`)
    }

    const targetPath = path.join(targetDir, binaryName)
    const primaryUrl = `${this.DOWNLOAD_BASE_URL}${binaryName}`
    const fallbackUrl = `${this.FALLBACK_DOWNLOAD_URL}${binaryName}`

    // 优先从自建镜像下载
    logger.info(`正在从自建镜像下载 PTY: ${primaryUrl}`)
    try {
      await this.downloadFromUrl(primaryUrl, targetPath)
      logger.info(`PTY 下载完成: ${targetPath}`)
      return
    } catch (primaryError: any) {
      logger.warn(`自建镜像下载失败: ${primaryError.message || primaryError}，尝试 GitHub 备用地址...`)
      // 清理可能的残留文件
      try { await fs.unlink(targetPath) } catch { /* 忽略 */ }
    }

    // 回退到 GitHub Releases
    logger.info(`正在从 GitHub 下载 PTY: ${fallbackUrl}`)
    try {
      await this.downloadFromUrl(fallbackUrl, targetPath)
      logger.info(`PTY 下载完成（GitHub 备用）: ${targetPath}`)
    } catch (fallbackError: any) {
      // 清理可能的残留文件
      try { await fs.unlink(targetPath) } catch { /* 忽略 */ }
      const message = `PTY 下载失败（两个源均不可用）: ${fallbackError.message || fallbackError}`
      logger.error(message)
      throw new Error(message)
    }
  }

  /**
   * 确保 PTY 二进制文件可用（检测 + 自动下载）
   * 服务端启动时调用
   */
  async ensureInstalled(): Promise<void> {
    if (await this.isInstalled()) {
      logger.info('PTY 已存在，跳过下载')
      return
    }
    await this.download()
  }
}

/** 导出单例实例 */
export const ptyManager = new PtyManager()

/** 导出类本身（用于测试） */
export { PtyManager }
