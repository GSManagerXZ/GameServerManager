import path from 'path'
import fs from 'fs-extra'
import os from 'os'
import axios from 'axios'
import AdmZip from 'adm-zip'
import * as tar from 'tar'
import logger from '../../utils/logger.js'

/**
 * 安全过滤器：防止 CVE-2026-23745 漏洞
 */
function createTarSecurityFilter(cwd: string) {
  return (filePath: string, stat: any): boolean => {
    // 阻止符号链接和硬链接的绝对路径或路径遍历
    if (stat.type === 'SymbolicLink' || stat.type === 'Link') {
      const linkpath = (stat as any).linkpath as string
      if (linkpath && (path.isAbsolute(linkpath) || linkpath.includes('..'))) {
        logger.warn(`[安全过滤] 阻止危险链接: ${filePath} -> ${linkpath}`)
        return false
      }
    }
    // 阻止绝对路径和路径遍历
    if (path.isAbsolute(filePath) || filePath.includes('..')) {
      logger.warn(`[安全过滤] 阻止危险路径: ${filePath}`)
      return false
    }
    return true
  }
}

export interface JavaEnvironment {
  version: string
  platform: string
  downloadUrl: string
  installed: boolean
  installPath?: string
  javaExecutable?: string
}

export class JavaManager {
  private readonly installDir: string

  constructor() {
    this.installDir = path.join(process.cwd(), 'data', 'environment', 'Java')
  }

  /**
   * 确保安装目录存在
   */
  private async ensureInstallDir(): Promise<void> {
    try {
      await fs.ensureDir(this.installDir)
    } catch (error) {
      logger.error('创建Java安装目录失败:', error)
      throw new Error('创建Java安装目录失败')
    }
  }

  /**
   * 获取Java版本目录路径
   */
  private getVersionDir(version: string): string {
    return path.join(this.installDir, version)
  }

  /**
   * 查找Java可执行文件
   */
  private async findJavaExecutable(versionDir: string): Promise<string | null> {
    const platform = os.platform()
    const javaExe = platform === 'win32' ? 'java.exe' : 'java'

    // 首先在bin目录中查找
    const binDir = path.join(versionDir, 'bin')
    const directJavaPath = path.join(binDir, javaExe)

    if (await fs.pathExists(directJavaPath)) {
      return directJavaPath
    }

    // 在子目录中查找
    try {
      const subDirs = await fs.readdir(versionDir)
      for (const subDir of subDirs) {
        const subDirPath = path.join(versionDir, subDir)
        const stat = await fs.stat(subDirPath)
        if (stat.isDirectory()) {
          const subBinDir = path.join(subDirPath, 'bin')
          const subJavaPath = path.join(subBinDir, javaExe)
          if (await fs.pathExists(subJavaPath)) {
            return subJavaPath
          }
        }
      }
    } catch (error) {
      logger.warn(`查找Java可执行文件失败:`, error)
    }

    return null
  }

  /**
   * 获取所有Java环境状态
   */
  async getJavaEnvironments(): Promise<JavaEnvironment[]> {
    await this.ensureInstallDir()

    const platform = os.platform()
    const javaVersions = ['java8', 'java11', 'java17', 'java21', 'java25']
    const environments: JavaEnvironment[] = []

    for (const version of javaVersions) {
      const versionDir = this.getVersionDir(version)
      const installed = await fs.pathExists(versionDir)

      let javaExecutable: string | undefined
      if (installed) {
        const executablePath = await this.findJavaExecutable(versionDir)
        if (executablePath) {
          javaExecutable = executablePath
        }
      }

      environments.push({
        version,
        platform,
        downloadUrl: '', // 前端会根据平台选择
        installed,
        installPath: installed ? versionDir : undefined,
        javaExecutable
      })
    }

    return environments
  }

  /**
   * 检查Java版本是否已安装
   */
  async isJavaInstalled(version: string): Promise<boolean> {
    const versionDir = this.getVersionDir(version)
    return await fs.pathExists(versionDir)
  }

  /**
   * 下载文件
   */
  private async downloadFile(
    url: string,
    filePath: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    logger.info(`正在下载文件: ${url}`)

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 300000, // 5分钟超时
      headers: {
        'User-Agent': 'GSManager3/1.0.0'
      }
    })

    const totalLength = parseInt(response.headers['content-length'] || '0', 10)
    let downloadedLength = 0

    const writer = fs.createWriteStream(filePath)

    response.data.on('data', (chunk: Buffer) => {
      downloadedLength += chunk.length
      if (totalLength > 0 && onProgress) {
        const progress = Math.round((downloadedLength / totalLength) * 100)
        onProgress(progress)
      }
    })

    response.data.pipe(writer)

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        logger.info(`文件下载完成: ${filePath}`)
        resolve()
      })
      writer.on('error', (error) => {
        logger.error(`文件下载失败: ${error.message}`)
        reject(error)
      })
    })
  }

  /**
   * 解压文件
   */
  private async extractFile(filePath: string, extractDir: string): Promise<void> {
    const fileName = path.basename(filePath)
    logger.info(`正在解压文件: ${fileName}`)

    if (fileName.endsWith('.zip')) {
      // 解压ZIP文件
      const zip = new AdmZip(filePath)
      zip.extractAllTo(extractDir, true)
    } else if (fileName.endsWith('.tar.gz')) {
      // 解压TAR.GZ文件
      await tar.x({
        file: filePath,
        cwd: extractDir,
        filter: createTarSecurityFilter(extractDir)
      })
    } else {
      throw new Error(`不支持的文件格式: ${fileName}`)
    }

    logger.info(`文件解压完成: ${fileName}`)
  }

  /**
   * 设置Java可执行文件权限 (Linux)
   */
  private async setExecutablePermissions(versionDir: string): Promise<void> {
    const platform = os.platform()

    // 只在Linux/Unix系统上设置权限
    if (platform !== 'linux' && platform !== 'darwin') {
      return
    }

    logger.info(`正在设置可执行权限: ${versionDir}`)

    try {
      // 递归查找所有bin目录
      const findBinDirs = async (dir: string): Promise<string[]> => {
        const binDirs: string[] = []
        const entries = await fs.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === 'bin') {
              binDirs.push(fullPath)
            }
            // 递归查找子目录
            const subBinDirs = await findBinDirs(fullPath)
            binDirs.push(...subBinDirs)
          }
        }

        return binDirs
      }

      const binDirs = await findBinDirs(versionDir)

      // 为每个bin目录中的文件设置可执行权限
      for (const binDir of binDirs) {
        const files = await fs.readdir(binDir)
        for (const file of files) {
          const filePath = path.join(binDir, file)
          const stat = await fs.stat(filePath)

          if (stat.isFile()) {
            // 设置为 755 权限 (rwxr-xr-x)
            await fs.chmod(filePath, 0o755)
            logger.info(`设置可执行权限: ${filePath}`)
          }
        }
      }

      logger.info(`可执行权限设置完成`)
    } catch (error) {
      logger.warn(`设置可执行权限失败 (非致命错误):`, error)
      // 不抛出错误，因为这不是致命问题
    }
  }

  /**
   * 安装Java环境
   */
  async installJava(
    version: string,
    downloadUrl: string,
    onProgress?: (stage: 'download' | 'extract', progress: number) => void
  ): Promise<void> {
    await this.ensureInstallDir()

    const versionDir = this.getVersionDir(version)

    // 检查是否已安装
    if (await fs.pathExists(versionDir)) {
      throw new Error(`${version} 已经安装`)
    }

    logger.info(`开始安装 ${version}，下载地址: ${downloadUrl}`)

    try {
      // 创建版本目录
      await fs.ensureDir(versionDir)

      // 下载文件
      const fileName = path.basename(downloadUrl)
      const downloadPath = path.join(versionDir, fileName)

      await this.downloadFile(downloadUrl, downloadPath, (progress) => {
        onProgress?.('download', progress)
      })

      // 解压文件
      onProgress?.('extract', 0)
      await this.extractFile(downloadPath, versionDir)
      onProgress?.('extract', 100)

      // 删除下载的压缩文件
      await fs.remove(downloadPath)

      // Linux系统下设置可执行权限
      await this.setExecutablePermissions(versionDir)

      // 验证安装
      const javaExecutable = await this.findJavaExecutable(versionDir)
      if (!javaExecutable) {
        throw new Error(`安装完成但未找到Java可执行文件`)
      }

      logger.info(`${version} 安装完成，Java路径: ${javaExecutable}`)
    } catch (error) {
      logger.error(`安装 ${version} 失败:`, error)

      // 清理失败的安装
      try {
        if (await fs.pathExists(versionDir)) {
          await fs.remove(versionDir)
        }
      } catch (cleanupError) {
        logger.error('清理失败的安装目录失败:', cleanupError)
      }

      throw error
    }
  }

  /**
   * 卸载Java环境
   */
  async uninstallJava(version: string): Promise<void> {
    const versionDir = this.getVersionDir(version)

    if (!(await fs.pathExists(versionDir))) {
      throw new Error(`${version} 未安装`)
    }

    logger.info(`正在卸载 ${version}...`)
    await fs.remove(versionDir)
    logger.info(`${version} 卸载完成`)
  }

  /**
   * 验证Java安装
   */
  async verifyJava(version: string): Promise<{ javaPath: string; versionInfo: string }> {
    const versionDir = this.getVersionDir(version)

    if (!(await fs.pathExists(versionDir))) {
      throw new Error(`${version} 未安装`)
    }

    const javaPath = await this.findJavaExecutable(versionDir)
    if (!javaPath) {
      throw new Error(`未找到 ${version} 的Java可执行文件`)
    }

    // 验证Java版本
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      const { stdout, stderr } = await execAsync(`"${javaPath}" -version`)
      const versionInfo = stderr || stdout // Java版本信息通常输出到stderr

      logger.info(`${version} 验证成功:`, versionInfo)

      return {
        javaPath,
        versionInfo
      }
    } catch (execError) {
      logger.error(`验证 ${version} 失败:`, execError)
      throw new Error(`验证 ${version} 失败`)
    }
  }

  /**
   * 获取Java环境的详细信息
   */
  async getJavaInfo(version: string): Promise<JavaEnvironment | null> {
    const versionDir = this.getVersionDir(version)
    const installed = await fs.pathExists(versionDir)

    if (!installed) {
      return null
    }

    const javaExecutable = await this.findJavaExecutable(versionDir)

    return {
      version,
      platform: os.platform(),
      downloadUrl: '',
      installed: true,
      installPath: versionDir,
      javaExecutable: javaExecutable || undefined
    }
  }
}
