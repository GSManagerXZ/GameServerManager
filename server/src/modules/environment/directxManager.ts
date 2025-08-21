import path from 'path'
import fs from 'fs-extra'
import os from 'os'
import axios from 'axios'
import logger from '../../utils/logger.js'
import { spawn } from 'child_process'

export interface DirectXEnvironment {
  version: string
  platform: string
  downloadUrl: string
  installed: boolean
  installPath?: string
  installing?: boolean
  installProgress?: number
  installStage?: 'download' | 'install'
}

export class DirectXManager {
  private installDir: string

  constructor() {
    // 设置安装目录
    this.installDir = path.join(process.cwd(), 'data', 'directx')
  }

  /**
   * 确保安装目录存在
   */
  private async ensureInstallDir(): Promise<void> {
    await fs.ensureDir(this.installDir)
  }

  /**
   * 获取版本目录路径
   */
  private getVersionDir(version: string): string {
    return path.join(this.installDir, version)
  }

  /**
   * 检查DirectX 9.0c运行时组件是否已安装
   */
  private async checkDirectXInstalled(): Promise<boolean> {
    if (os.platform() !== 'win32') {
      return false
    }

    logger.info('开始检查DirectX 9.0c运行时组件...')

    // 方法1: 使用dxdiag获取系统信息（仅用于日志）
    await this.checkDirectXWithDxdiag()

    // 方法2: 检查DirectX 9.0c特有的DLL文件（唯一判断依据）
    const dllCheck = await this.checkDirectXDLLs()
    if (dllCheck) {
      logger.info('DirectX 9.0c运行时组件检测：已安装')
      return true
    }

    // 注意：不再使用注册表和通用DirectX文件检测
    // 因为系统可能有DirectX 12但缺少DirectX 9.0c运行时组件
    logger.info('DirectX 9.0c运行时组件检测：未安装')
    logger.info('说明：系统可能有DirectX 12，但缺少DirectX 9.0c特有的运行时文件')

    return false
  }

  /**
   * 使用dxdiag检查DirectX版本（仅用于信息收集，不作为安装判断依据）
   */
  private async checkDirectXWithDxdiag(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const tempFile = path.join(os.tmpdir(), `dxdiag_${Date.now()}.txt`)

        // 运行dxdiag并输出到临时文件
        const child = spawn('dxdiag', ['/t', tempFile], {
          windowsHide: true,
          stdio: 'pipe'
        })

        child.on('close', async (code) => {
          try {
            if (code === 0 && await fs.pathExists(tempFile)) {
              const content = await fs.readFile(tempFile, 'utf-8')

              // 检查DirectX版本
              const directxMatch = content.match(/DirectX Version:\s*DirectX\s*([\d.]+)/i)
              if (directxMatch) {
                const version = directxMatch[1]
                logger.info(`系统DirectX版本: ${version}`)

                // DirectX 12/11/10 不包含DirectX 9.0c的运行时组件
                // 我们需要检查具体的DirectX 9.0c组件，而不是系统DirectX版本
                logger.info('注意：即使系统有DirectX 12，仍可能缺少DirectX 9.0c运行时组件')
              }

              // 清理临时文件
              await fs.remove(tempFile).catch(() => {})
            }
            // dxdiag检查不作为安装判断依据，总是返回false让后续方法检查
            resolve(false)
          } catch (error) {
            logger.error('解析dxdiag输出失败:', error)
            resolve(false)
          }
        })

        child.on('error', (error) => {
          logger.warn('运行dxdiag失败:', error.message)
          resolve(false)
        })

        // 设置超时
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGTERM')
            resolve(false)
          }
        }, 30000) // 30秒超时
      } catch (error) {
        logger.error('dxdiag检查失败:', error)
        resolve(false)
      }
    })
  }

  /**
   * 检查DirectX注册表
   */
  private async checkDirectXRegistry(): Promise<boolean> {
    return new Promise((resolve) => {
      // 检查DirectX版本信息
      const child = spawn('reg', [
        'query',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX',
        '/v',
        'Version'
      ], { windowsHide: true })

      let output = ''
      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          // 检查是否包含DirectX 9.0c或更高版本
          const versionMatch = output.match(/4\.09\.00\.(\d+)/)
          if (versionMatch && parseInt(versionMatch[1]) >= 904) {
            resolve(true)
            return
          }
        }
        resolve(false)
      })

      child.on('error', () => {
        resolve(false)
      })
    })
  }

  /**
   * 检查DirectX核心文件
   */
  private async checkDirectXFiles(): Promise<boolean> {
    const systemDir = process.env.SYSTEMROOT ? path.join(process.env.SYSTEMROOT, 'System32') : 'C:\\Windows\\System32'

    const requiredFiles = [
      'ddraw.dll',
      'dsound.dll',
      'dinput.dll',
      'dinput8.dll'
    ]

    try {
      for (const file of requiredFiles) {
        const filePath = path.join(systemDir, file)
        if (!await fs.pathExists(filePath)) {
          return false
        }
      }
      return true
    } catch (error) {
      logger.error('检查DirectX文件失败:', error)
      return false
    }
  }

  /**
   * 检查DirectX 9.0c运行时DLL文件
   */
  private async checkDirectXDLLs(): Promise<boolean> {
    const systemDir = process.env.SYSTEMROOT ? path.join(process.env.SYSTEMROOT, 'System32') : 'C:\\Windows\\System32'

    // DirectX 9.0c运行时的关键DLL文件
    const requiredD3DX9Files = [
      'd3dx9_43.dll',  // DirectX 9.0c June 2010
      'd3dx9_42.dll',  // DirectX 9.0c February 2010
      'd3dx9_41.dll',  // DirectX 9.0c March 2009
      'd3dx9_40.dll',  // DirectX 9.0c March 2008
      'd3dx9_39.dll',  // DirectX 9.0c November 2007
      'd3dx9_38.dll',  // DirectX 9.0c August 2007
      'd3dx9_37.dll',  // DirectX 9.0c May 2007
      'd3dx9_36.dll'   // DirectX 9.0c April 2007
    ]

    // 其他重要的DirectX 9运行时文件
    const otherRequiredFiles = [
      'xinput1_3.dll',    // XInput 1.3
      'xaudio2_7.dll',    // XAudio2 7
      'd3dcompiler_43.dll' // D3D Compiler
    ]

    try {
      let foundD3DX9 = false
      let foundOthers = 0

      // 检查d3dx9文件（至少需要一个）
      for (const file of requiredD3DX9Files) {
        const filePath = path.join(systemDir, file)
        if (await fs.pathExists(filePath)) {
          logger.info(`找到DirectX 9.0c文件: ${file}`)
          foundD3DX9 = true
          break // 找到一个就够了
        }
      }

      // 检查其他重要文件
      for (const file of otherRequiredFiles) {
        const filePath = path.join(systemDir, file)
        if (await fs.pathExists(filePath)) {
          logger.info(`找到DirectX运行时文件: ${file}`)
          foundOthers++
        }
      }

      // 需要至少有d3dx9文件和一些其他运行时文件
      const isInstalled = foundD3DX9 && foundOthers >= 2

      if (!foundD3DX9) {
        logger.info('未找到DirectX 9.0c核心文件(d3dx9_*.dll)')
      }
      if (foundOthers < 2) {
        logger.info(`DirectX运行时文件不完整，仅找到 ${foundOthers} 个必需文件`)
      }

      return isInstalled
    } catch (error) {
      logger.error('检查DirectX DLL文件失败:', error)
      return false
    }
  }

  /**
   * 下载文件
   */
  private async downloadFile(
    url: string,
    filePath: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 300000, // 5分钟超时
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
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  }

  /**
   * 提取DirectX离线安装包
   */
  private async extractDirectXRedist(redistPath: string, extractDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`提取DirectX安装包: ${redistPath} 到 ${extractDir}`)

      // 使用 /Q /C /T 参数提取文件
      const child = spawn(redistPath, ['/Q', '/C', `/T:${extractDir}`], {
        windowsHide: true,
        stdio: 'pipe'
      })

      let output = ''
      let errorOutput = ''

      child.stdout?.on('data', (data) => {
        output += data.toString()
        logger.info(`DirectX提取输出: ${data.toString().trim()}`)
      })

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString()
        logger.warn(`DirectX提取警告: ${data.toString().trim()}`)
      })

      child.on('close', (code) => {
        logger.info(`DirectX提取程序退出，退出码: ${code}`)

        if (code === 0) {
          logger.info('DirectX安装包提取完成')
          resolve()
        } else {
          logger.error(`DirectX安装包提取失败，退出码: ${code}`)
          logger.error(`错误输出: ${errorOutput}`)
          reject(new Error(`提取失败，退出码: ${code}。${errorOutput || '可能需要管理员权限'}`))
        }
      })

      child.on('error', (error) => {
        logger.error('DirectX提取程序执行出错:', error)
        reject(new Error(`无法启动提取程序: ${error.message}`))
      })

      // 设置超时
      setTimeout(() => {
        if (!child.killed) {
          logger.warn('DirectX提取程序执行超时，强制终止')
          child.kill('SIGTERM')
          reject(new Error('提取超时，请检查文件或重试'))
        }
      }, 120000) // 2分钟超时
    })
  }

  /**
   * 执行DirectX安装程序（DXSETUP.exe）
   */
  private async executeDirectXSetup(dxsetupPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`执行DirectX安装程序: ${dxsetupPath}`)

      // 使用 /silent 参数进行静默安装
      const child = spawn(dxsetupPath, ['/silent'], {
        windowsHide: true,
        stdio: 'pipe'
      })

      let output = ''
      let errorOutput = ''

      child.stdout?.on('data', (data) => {
        output += data.toString()
        logger.info(`DirectX安装输出: ${data.toString().trim()}`)
      })

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString()
        logger.warn(`DirectX安装警告: ${data.toString().trim()}`)
      })

      child.on('close', (code) => {
        logger.info(`DirectX安装程序退出，退出码: ${code}`)

        // DXSETUP.exe 的退出码说明:
        // 0: 成功安装
        // 1: 需要重启
        // 其他: 错误
        if (code === 0 || code === 1) {
          logger.info('DirectX安装程序执行完成')
          if (code === 1) {
            logger.warn('DirectX安装完成，但可能需要重启系统以完全生效')
          }
          resolve()
        } else {
          logger.error(`DirectX安装程序执行失败，退出码: ${code}`)
          logger.error(`错误输出: ${errorOutput}`)
          reject(new Error(`安装失败，退出码: ${code}。${errorOutput || '可能需要管理员权限或系统不兼容'}`))
        }
      })

      child.on('error', (error) => {
        logger.error('DirectX安装程序执行出错:', error)
        reject(new Error(`无法启动安装程序: ${error.message}`))
      })

      // 设置超时
      setTimeout(() => {
        if (!child.killed) {
          logger.warn('DirectX安装程序执行超时，强制终止')
          child.kill('SIGTERM')
          reject(new Error('安装超时，请检查系统环境或手动安装'))
        }
      }, 300000) // 5分钟超时
    })
  }

  /**
   * 执行安装程序（旧方法，保留以防需要）
   */
  private async executeInstaller(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`执行DirectX安装程序: ${installerPath}`)

      // 使用静默安装参数
      const child = spawn(installerPath, ['/Q'], {
        windowsHide: true,
        stdio: 'pipe'
      })

      let output = ''
      let errorOutput = ''

      child.stdout?.on('data', (data) => {
        output += data.toString()
        logger.info(`DirectX安装输出: ${data.toString().trim()}`)
      })

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString()
        logger.warn(`DirectX安装警告: ${data.toString().trim()}`)
      })

      child.on('close', (code) => {
        logger.info(`DirectX安装程序退出，退出码: ${code}`)

        // DirectX Web Setup 的退出码说明:
        // 0: 成功安装或已是最新版本
        // 1: 需要重启
        // 2: 用户取消（但我们使用静默安装，不应该出现）
        // 其他: 错误
        if (code === 0 || code === 1) {
          logger.info('DirectX安装程序执行完成')
          if (code === 1) {
            logger.warn('DirectX安装完成，但可能需要重启系统以完全生效')
          }
          resolve()
        } else {
          logger.error(`DirectX安装程序执行失败，退出码: ${code}`)
          logger.error(`错误输出: ${errorOutput}`)
          reject(new Error(`安装失败，退出码: ${code}。${errorOutput || '可能需要管理员权限或系统不兼容'}`))
        }
      })

      child.on('error', (error) => {
        logger.error('DirectX安装程序执行出错:', error)
        reject(new Error(`无法启动安装程序: ${error.message}`))
      })

      // 设置超时，避免安装程序卡住
      setTimeout(() => {
        if (!child.killed) {
          logger.warn('DirectX安装程序执行超时，强制终止')
          child.kill('SIGTERM')
          reject(new Error('安装超时，请检查系统环境或手动安装'))
        }
      }, 300000) // 5分钟超时
    })
  }

  /**
   * 验证安装是否成功
   */
  private async verifyInstallation(): Promise<boolean> {
    // 等待系统更新文件
    await new Promise(resolve => setTimeout(resolve, 3000))

    // 重新检查安装状态
    const installed = await this.checkDirectXInstalled()

    if (!installed) {
      logger.warn('DirectX安装验证失败，可能需要更多时间或重启系统')
    } else {
      logger.info('DirectX安装验证成功')
    }

    return installed
  }

  /**
   * 获取DirectX环境状态
   */
  async getDirectXEnvironments(): Promise<DirectXEnvironment[]> {
    await this.ensureInstallDir()

    if (os.platform() !== 'win32') {
      return []
    }

    logger.info('检查DirectX安装状态...')
    const installed = await this.checkDirectXInstalled()
    const versionDir = this.getVersionDir('directx9')

    logger.info(`DirectX安装状态: ${installed ? '已安装' : '未安装'}`)

    // 检查是否有下载的安装程序
    const installerPath = path.join(versionDir, 'dxwebsetup.exe')
    const hasInstaller = await fs.pathExists(installerPath)

    return [{
      version: 'DirectX 9.0c',
      platform: 'win32',
      downloadUrl: 'https://www.microsoft.com/en-us/download/details.aspx?id=35',
      installed,
      installPath: hasInstaller ? versionDir : undefined
    }]
  }

  /**
   * 安装DirectX
   */
  async installDirectX(
    downloadUrl: string,
    onProgress?: (stage: 'download' | 'install', progress: number) => void
  ): Promise<void> {
    if (os.platform() !== 'win32') {
      throw new Error('DirectX只能在Windows系统上安装')
    }

    await this.ensureInstallDir()

    // 检查是否已安装
    const installed = await this.checkDirectXInstalled()
    if (installed) {
      logger.info('DirectX已经安装，跳过安装过程')
      throw new Error('DirectX 已经安装')
    }

    try {
      const versionDir = this.getVersionDir('directx9')
      await fs.ensureDir(versionDir)

      // 下载文件
      const fileName = 'directx_Jun2010_redist.exe'
      const downloadPath = path.join(versionDir, fileName)

      logger.info(`开始下载DirectX安装程序`)

      // 使用Microsoft官方的DirectX 9.0c离线安装包（推荐）
      // 这个包包含完整的DirectX 9.0c运行时组件
      const actualDownloadUrl = 'https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe'
      logger.info(`使用DirectX 9.0c离线安装包: ${actualDownloadUrl}`)
      logger.info(`传入的页面链接: ${downloadUrl}`)

      // 检查文件是否已存在
      if (await fs.pathExists(downloadPath)) {
        logger.info('DirectX安装程序已存在，跳过下载')
        onProgress?.('download', 100)
      } else {
        await this.downloadFile(actualDownloadUrl, downloadPath, (progress) => {
          onProgress?.('download', progress)
        })
        logger.info('DirectX安装程序下载完成')
      }

      // 验证下载的文件
      const stats = await fs.stat(downloadPath)
      if (stats.size < 100000) { // 文件太小，可能下载失败
        throw new Error('下载的安装程序文件异常，请重试')
      }

      // 提取DirectX安装文件
      logger.info('开始提取DirectX安装文件')
      onProgress?.('install', 10)

      const extractDir = path.join(versionDir, 'extracted')
      await this.extractDirectXRedist(downloadPath, extractDir)

      onProgress?.('install', 30)

      // 安装DirectX
      logger.info('开始安装DirectX')
      const dxsetupPath = path.join(extractDir, 'DXSETUP.exe')
      await this.executeDirectXSetup(dxsetupPath)

      onProgress?.('install', 80)

      // 验证安装
      logger.info('验证DirectX安装状态')
      const verifyResult = await this.verifyInstallation()

      onProgress?.('install', 100)

      if (verifyResult) {
        logger.info('DirectX安装并验证成功')
      } else {
        logger.warn('DirectX安装完成，但验证未通过。可能需要重启系统或手动检查')
      }

    } catch (error) {
      logger.error('DirectX安装失败:', error)
      throw error
    }
  }

  /**
   * 清理DirectX安装文件（注意：DirectX是系统组件，不能真正卸载）
   */
  async uninstallDirectX(): Promise<void> {
    if (os.platform() !== 'win32') {
      throw new Error('DirectX只能在Windows系统上操作')
    }

    // DirectX是系统核心组件，不能真正卸载
    // 这里我们只清理下载的安装文件和临时文件
    try {
      const versionDir = this.getVersionDir('directx9')
      let cleaned = false

      if (await fs.pathExists(versionDir)) {
        await fs.remove(versionDir)
        logger.info('DirectX安装文件已清理')
        cleaned = true
      }

      // 清理可能的临时文件
      const tempDir = os.tmpdir()
      const tempFiles = ['directx_Jun2010_redist.exe', 'dxwebsetup.exe', 'directx_temp']

      for (const tempFile of tempFiles) {
        const tempPath = path.join(tempDir, tempFile)
        if (await fs.pathExists(tempPath)) {
          await fs.remove(tempPath)
          logger.info(`清理临时文件: ${tempFile}`)
          cleaned = true
        }
      }

      if (!cleaned) {
        logger.info('没有找到需要清理的DirectX文件')
      }
    } catch (error) {
      logger.error('清理DirectX文件失败:', error)
      throw new Error(`清理失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 获取DirectX详细信息
   */
  async getDirectXInfo(): Promise<{ version?: string; installed: boolean; details: string }> {
    if (os.platform() !== 'win32') {
      return { installed: false, details: '仅支持Windows系统' }
    }

    const installed = await this.checkDirectXInstalled()

    if (!installed) {
      return {
        installed: false,
        details: 'DirectX 9.0c 未安装或版本过低。建议安装以确保游戏和多媒体应用正常运行。'
      }
    }

    // 尝试获取详细版本信息
    try {
      const versionInfo = await this.getDirectXVersion()
      return {
        version: versionInfo,
        installed: true,
        details: `DirectX ${versionInfo || '9.0c+'} 已安装`
      }
    } catch (error) {
      return {
        installed: true,
        details: 'DirectX 已安装，但无法获取详细版本信息'
      }
    }
  }

  /**
   * 获取DirectX版本信息
   */
  private async getDirectXVersion(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const child = spawn('reg', [
        'query',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX',
        '/v',
        'Version'
      ], { windowsHide: true })

      let output = ''
      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          const versionMatch = output.match(/4\.09\.00\.(\d+)/)
          if (versionMatch) {
            const build = versionMatch[1]
            resolve(`9.0c (${build})`)
            return
          }
        }
        resolve(undefined)
      })

      child.on('error', () => {
        resolve(undefined)
      })
    })
  }
}
