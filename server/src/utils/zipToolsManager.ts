import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import logger from './logger.js'

/**
 * 支持的操作系统平台列表
 * 二进制文件名直接使用 process.platform 值（win32, linux, darwin）
 */
const SUPPORTED_PLATFORMS = new Set(['win32', 'linux', 'darwin'])

/**
 * 支持的 CPU 架构列表
 */
const SUPPORTED_ARCHS = new Set(['x64', 'arm64'])

/**
 * Zip-Tools 二进制文件管理器
 * 负责 file_zip 二进制文件的路径解析、检测、下载和 ZIP 操作封装
 */
class ZipToolsManager {
  /** 自建镜像下载基础 URL（运行时使用，国内加速） */
  private readonly DOWNLOAD_BASE_URL =
    'https://download.xiaozhuhouses.asia/%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE/GSManager/GSManager3/%E8%BF%90%E8%A1%8C%E4%BE%9D%E8%B5%96/Zip-Tools/'

  /** GitHub Releases 备用下载 URL（始终使用最新版本） */
  private readonly FALLBACK_DOWNLOAD_URL =
    'https://github.com/MCSManager/Zip-Tools/releases/latest/download/'

  /**
   * 获取当前平台对应的二进制文件名
   * 规则: file_zip_{platform}_{arch}，Windows 追加 .exe
   * 
   * 实际 GitHub Release 资产命名规则：
   *   - win32/x64  → file_zip_win32_x64.exe
   *   - linux/x64  → file_zip_linux_x64
   *   - linux/arm64 → file_zip_linux_arm64
   *   - darwin/x64  → file_zip_darwin_amd64（特殊：x64 映射为 amd64）
   *   - darwin/arm64 → file_zip_darwin_arm64
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

    // darwin 平台 x64 架构使用 amd64 标识（Go 编译惯例）
    const archLabel = (platform === 'darwin' && arch === 'x64') ? 'amd64' : arch

    const name = `file_zip_${platform}_${archLabel}`
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
   * 使用多路径尝试策略获取二进制文件绝对路径
   * 依次尝试 data/lib/ 和 server/data/lib/ 目录
   */
  async getZipToolsPath(): Promise<string> {
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
      `未找到 Zip-Tools 二进制文件 (${binaryName})，已尝试路径: ${candidates.map(d => path.join(d, binaryName)).join(', ')}`
    )
  }

  /**
   * 检测二进制文件是否存在
   */
  async isInstalled(): Promise<boolean> {
    try {
      await this.getZipToolsPath()
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
   * 下载二进制文件到第一个可写的 lib 目录
   * 优先从自建镜像下载，失败后回退到 GitHub Releases
   * 非 Windows 平台设置 chmod 0o755
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
    logger.info(`正在从自建镜像下载 Zip-Tools: ${primaryUrl}`)
    try {
      await this.downloadFromUrl(primaryUrl, targetPath)
      logger.info(`Zip-Tools 下载完成: ${targetPath}`)
      return
    } catch (primaryError: any) {
      logger.warn(`自建镜像下载失败: ${primaryError.message || primaryError}，尝试 GitHub 备用地址...`)
      // 清理可能的残留文件
      try { await fs.unlink(targetPath) } catch { /* 忽略 */ }
    }

    // 回退到 GitHub Releases
    logger.info(`正在从 GitHub 下载 Zip-Tools: ${fallbackUrl}`)
    try {
      await this.downloadFromUrl(fallbackUrl, targetPath)
      logger.info(`Zip-Tools 下载完成（GitHub 备用）: ${targetPath}`)
    } catch (fallbackError: any) {
      // 清理可能的残留文件
      try { await fs.unlink(targetPath) } catch { /* 忽略 */ }
      const message = `Zip-Tools 下载失败（两个源均不可用）: ${fallbackError.message || fallbackError}`
      logger.error(message)
      throw new Error(message)
    }
  }

  /**
   * 确保二进制文件可用（检测 + 自动下载）
   * 服务端启动时调用
   */
  async ensureInstalled(): Promise<void> {
    if (await this.isInstalled()) {
      logger.info('Zip-Tools 已存在，跳过下载')
      return
    }
    await this.download()
  }

  /**
   * 执行 ZIP 解压操作
   * 命令: file_zip -mode 2 -zipPath {文件名} -distDirPath {目标目录} -code utf-8
   * cwd 设置为 ZIP 文件所在目录
   *
   * 注意参数格式（Go flag 包仅支持单横线前缀）：
   *   -mode / -zipPath / -distDirPath / -code 均使用单横线 + 空格分隔值
   */
  async extractZip(zipPath: string, targetDir: string): Promise<void> {
    const toolPath = await this.getZipToolsPath()
    const zipDir = path.dirname(zipPath)
    const zipFileName = path.basename(zipPath)

    // 确保目标目录存在
    await fs.mkdir(targetDir, { recursive: true })

    const args = [
      '-mode', '2',
      '-zipPath', zipFileName,
      '-distDirPath', path.resolve(targetDir),
      '-code', 'utf-8',
    ]

    await this.executeZipTools(toolPath, args, zipDir)
  }

  /**
   * 执行 ZIP 压缩操作
   * 命令: file_zip -mode 1 -file {文件1} -file {文件2} ... -zipPath {文件名} -code utf-8
   * cwd 设置为待压缩文件所在目录
   */
  async compressZip(zipPath: string, files: string[], cwd: string): Promise<void> {
    const toolPath = await this.getZipToolsPath()
    const zipFileName = path.basename(zipPath)

    const args = [
      '-mode', '1',
      ...files.flatMap(f => ['-file', f]),
      '-zipPath', zipFileName,
      '-code', 'utf-8',
    ]

    await this.executeZipTools(toolPath, args, cwd)
  }

  /**
   * 执行 file_zip 子进程并等待完成
   * 退出码为 0 表示成功，非 0 抛出包含 stderr 的异常
   */
  private executeZipTools(toolPath: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(toolPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

      let stderr = ''

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('error', (error: Error) => {
        reject(new Error(`Zip-Tools 进程启动失败: ${error.message}`))
      })

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve()
        } else {
          reject(
            new Error(
              `Zip-Tools 执行失败 (退出码: ${code}): ${stderr.trim() || '未知错误'}`
            )
          )
        }
      })
    })
  }
}

/** 导出单例实例 */
export const zipToolsManager = new ZipToolsManager()

/** 导出类本身（用于测试） */
export { ZipToolsManager }
