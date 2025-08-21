import path from 'path'
import fs from 'fs-extra'
import os from 'os'
import axios from 'axios'
import AdmZip from 'adm-zip'
import tar from 'tar'
import logger from '../../utils/logger.js'

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
    const javaVersions = ['java8', 'java17', 'java21']
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
        cwd: extractDir
      })
    } else {
      throw new Error(`不支持的文件格式: ${fileName}`)
    }

    logger.info(`文件解压完成: ${fileName}`)
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
