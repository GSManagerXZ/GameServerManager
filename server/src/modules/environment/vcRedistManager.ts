import path from 'path'
import fs from 'fs-extra'
import os from 'os'
import axios from 'axios'
import logger from '../../utils/logger.js'
import { spawn } from 'child_process'

export interface VcRedistEnvironment {
  version: string
  platform: string
  downloadUrl: string
  installed: boolean
  installPath?: string
  architecture: 'x86' | 'x64' | 'arm64'
}

export class VcRedistManager {
  private installDir: string

  constructor() {
    // 设置安装目录
    this.installDir = path.join(process.cwd(), 'data', 'vcredist')
  }

  /**
   * 将可能包含“Visual C++”或“Microsoft Visual C++”前缀的版本名规范化为内部键（如：2015-2022、2013、2012、2010）
   */
  private normalizeVersion(input: string): string {
    if (!input) return input
    let v = input.replace(/^\s*Microsoft\s+Visual\s+C\+\+\s*/i, '')
                 .replace(/^\s*Visual\s+C\+\+\s*/i, '')
                 .trim()
    // 常见写法中可能混入“Redistributable”等，保留年份关键即可
    // 提取前四位数字或形如“2015-2022”的段
    const rangeMatch = v.match(/20\d{2}\s*-\s*20\d{2}/)
    if (rangeMatch) return rangeMatch[0].replace(/\s*/g, '')
    const yearMatch = v.match(/20\d{2}/)
    if (yearMatch) {
      const y = yearMatch[0]
      if (['2010','2012','2013'].includes(y)) return y
      if (['2015','2017','2019','2022'].includes(y)) return '2015-2022'
    }
    // 已是标准键或其他：直接返回去空格后的字符串
    return v.replace(/\s*/g, '')
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
  private getVersionDir(version: string, arch: string): string {
    return path.join(this.installDir, `${version}_${arch}`)
  }

  /**
   * 检查Visual C++运行库是否已安装（通过注册表）
   */
  private async checkVcRedistInstalled(version: string, arch: string): Promise<boolean> {
    if (os.platform() !== 'win32') {
      return false
    }

    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      // 使用更详细的检测方法：查询32/64位注册表视图
      const searchPatterns = this.getSearchPatterns(version, arch)
      const baseKey = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
      const regViews = [' /reg:64', ' /reg:32']

      for (const pattern of searchPatterns) {
        for (const view of regViews) {
          try {
            const { stdout } = await execAsync(`reg query "${baseKey}" /s /f "${pattern}" /d${view}`)
            if (stdout.includes('Microsoft Visual C++') && stdout.includes(pattern)) {
              logger.info(`检测到已安装: ${version} ${arch} (${view.trim()})`)
              return true
            }
          } catch (error) {
            continue
          }
        }
      }

      // 如果主要检测失败，尝试备用检测方法
      return await this.fallbackDetection(version, arch)
    } catch (error) {
      logger.error(`检查 ${version} ${arch} 安装状态失败:`, error)
      return false
    }
  }

  /**
   * 获取搜索模式
   */
  private getSearchPatterns(version: string, arch: string): string[] {
    const patterns: { [key: string]: string[] } = {
      '2015-2022': [
        `Microsoft Visual C++ 2015-2022 Redistributable (${arch})`,
        `Microsoft Visual C++ 2022 Redistributable (${arch})`,
        `Microsoft Visual C++ 2019 Redistributable (${arch})`,
        `Microsoft Visual C++ 2017 Redistributable (${arch})`,
        `Microsoft Visual C++ 2015 Redistributable (${arch})`
      ],
      '2013': [
        `Microsoft Visual C++ 2013 Redistributable (${arch})`
      ],
      '2012': [
        `Microsoft Visual C++ 2012 Redistributable (${arch})`
      ],
      '2010': [
        `Microsoft Visual C++ 2010 Redistributable Package (${arch})`
      ]
    }

    return patterns[version] || []
  }

  /**
   * 备用检测方法
   */
  private async fallbackDetection(version: string, arch: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      // 检查系统文件
      const systemFiles = this.getSystemFiles(version, arch)

      for (const file of systemFiles) {
        try {
          const { stdout } = await execAsync(`dir "${file}" 2>nul`)
          if (stdout.includes(path.basename(file))) {
            logger.info(`通过系统文件检测到: ${version} ${arch} - ${file}`)
            return true
          }
        } catch (error) {
          continue
        }
      }

      return false
    } catch (error) {
      logger.error(`备用检测失败:`, error)
      return false
    }
  }

  /**
   * 获取系统文件路径
   */
  private getSystemFiles(version: string, arch: string): string[] {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const system32 = path.join(systemRoot, 'System32')
    const sysWow64 = path.join(systemRoot, 'SysWOW64')

    const files: { [key: string]: { [key: string]: string[] } } = {
      '2015-2022': {
        'x64': [
          path.join(system32, 'msvcp140.dll'),
          path.join(system32, 'vcruntime140.dll'),
          path.join(system32, 'vcruntime140_1.dll')
        ],
        'x86': [
          path.join(sysWow64, 'msvcp140.dll'),
          path.join(sysWow64, 'vcruntime140.dll')
        ]
      },
      '2013': {
        'x64': [
          path.join(system32, 'msvcp120.dll'),
          path.join(system32, 'msvcr120.dll')
        ],
        'x86': [
          path.join(sysWow64, 'msvcp120.dll'),
          path.join(sysWow64, 'msvcr120.dll')
        ]
      },
      '2012': {
        'x64': [
          path.join(system32, 'msvcp110.dll'),
          path.join(system32, 'msvcr110.dll')
        ],
        'x86': [
          path.join(sysWow64, 'msvcp110.dll'),
          path.join(sysWow64, 'msvcr110.dll')
        ]
      },
      '2010': {
        'x64': [
          path.join(system32, 'msvcp100.dll'),
          path.join(system32, 'msvcr100.dll')
        ],
        'x86': [
          path.join(sysWow64, 'msvcp100.dll'),
          path.join(sysWow64, 'msvcr100.dll')
        ]
      }
    }

    return files[version]?.[arch] || []
  }



  /**
   * 获取所有Visual C++运行库环境状态
   */
  async getVcRedistEnvironments(): Promise<VcRedistEnvironment[]> {
    await this.ensureInstallDir()

    if (os.platform() !== 'win32') {
      return []
    }

    const environments: VcRedistEnvironment[] = []
    const versions = ['2015-2022', '2013', '2012', '2010']
    const architectures: ('x86' | 'x64')[] = ['x86', 'x64']

    for (const v of versions) {
      for (const arch of architectures) {
        const installed = await this.checkVcRedistInstalled(v, arch)
        const versionDir = this.getVersionDir(v, arch)

        environments.push({
          version: `Visual C++ ${v}`,
          platform: 'win32',
          downloadUrl: this.getDownloadUrl(v, arch),
          installed,
          installPath: installed ? versionDir : undefined,
          architecture: arch
        })
      }
    }

    return environments
  }

  /**
   * 获取下载URL
   */
  private getDownloadUrl(version: string, arch: string): string {
    const key = this.normalizeVersion(version)
    const urlMap: { [key: string]: { [key: string]: string } } = {
      '2015-2022': {
        'x86': 'https://aka.ms/vs/17/release/vc_redist.x86.exe',
        'x64': 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
      },
      '2013': {
        'x86': 'https://download.microsoft.com/download/2/E/6/2E61CFA4-993B-4DD4-91DA-3737CD5CD6E3/vcredist_x86.exe',
        'x64': 'https://download.microsoft.com/download/2/E/6/2E61CFA4-993B-4DD4-91DA-3737CD5CD6E3/vcredist_x64.exe'
      },
      '2012': {
        'x86': 'https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe',
        'x64': 'https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x64.exe'
      },
      '2010': {
        'x86': 'https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe',
        'x64': 'https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x64.exe'
      }
    }

    return urlMap[key]?.[arch] || ''
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
   * 安装Visual C++运行库
   */
  async installVcRedist(
    version: string,
    architecture: string,
    downloadUrl: string,
    onProgress?: (stage: 'download' | 'install', progress: number) => void
  ): Promise<void> {
    if (os.platform() !== 'win32') {
      throw new Error('Visual C++运行库只能在Windows系统上安装')
    }

    await this.ensureInstallDir()

    // 标准化版本键
    const versionKey = this.normalizeVersion(version)
    const versionDir = this.getVersionDir(versionKey, architecture)

    // 检查是否已安装
    const installed = await this.checkVcRedistInstalled(versionKey, architecture)
    if (installed) {
      throw new Error(`Visual C++ ${version} ${architecture} 已经安装`)
    }

    try {
      // 创建版本目录
      await fs.ensureDir(versionDir)

      // 下载文件
      const fileName = `vcredist_${architecture}.exe`
      const downloadPath = path.join(versionDir, fileName)

      await this.downloadFile(downloadUrl, downloadPath, (progress) => {
        onProgress?.('download', progress)
      })

      // 安装运行库
      onProgress?.('install', 0)
      await this.executeInstaller(downloadPath)
      onProgress?.('install', 100)

      // 等待一段时间让系统完成注册表更新
      await new Promise(resolve => setTimeout(resolve, 3000))

      // 验证安装是否成功
      const installed = await this.checkVcRedistInstalled(version, architecture)
      if (!installed) {
        logger.warn(`安装完成但检测不到 ${version} ${architecture}，可能需要等待系统更新`)
      }
    } catch (error) {
      logger.error(`安装 Visual C++ ${version} ${architecture} 失败:`, error)

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
   * 执行安装程序
   */
  private async executeInstaller(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 使用静默安装参数
      const process = spawn(installerPath, ['/quiet', '/norestart'], {
        stdio: 'pipe'
      })

      let stderr = ''

      process.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`安装失败，退出代码: ${code}, 错误信息: ${stderr}`))
        }
      })

      process.on('error', (error) => {
        reject(new Error(`启动安装程序失败: ${error.message}`))
      })
    })
  }

  /**
   * 卸载Visual C++运行库
   */
  async uninstallVcRedist(version: string, architecture: string): Promise<void> {
    if (os.platform() !== 'win32') {
      throw new Error('Visual C++运行库只能在Windows系统上卸载')
    }

    const versionKey = this.normalizeVersion(version)

    const installed = await this.checkVcRedistInstalled(versionKey, architecture)
    if (!installed) {
      throw new Error(`Visual C++ ${versionKey} ${architecture} 未安装`)
    }

    logger.info(`开始卸载 Visual C++ ${versionKey} ${architecture}`)

    try {
      const uninstallInfo = await this.getUninstallInfo(versionKey, architecture)
      if (!uninstallInfo) {
        throw new Error('未找到卸载程序')
      }

      // 优先使用QuietUninstallString，其次使用UninstallString（控制面板逻辑）
      const uninstallCommand = uninstallInfo.quietUninstallString || uninstallInfo.uninstallString
      if (!uninstallCommand) {
        throw new Error('未找到有效的卸载命令')
      }

      // logger.info(`找到程序: ${uninstallInfo.displayName}`)
      // logger.info(`卸载命令: ${uninstallCommand}`)

      await this.executeUninstaller(uninstallCommand)

      // 等待一段时间让系统完成卸载
      await new Promise(resolve => setTimeout(resolve, 2000))

      // 验证卸载是否成功
      const stillInstalled = await this.checkVcRedistInstalled(version, architecture)
      if (stillInstalled) {
        logger.warn(`卸载完成但仍检测到 ${version} ${architecture}`)
      }
    } catch (error) {
      logger.error(`卸载 Visual C++ ${version} ${architecture} 失败:`, error)
      throw error
    }
  }

  /**
   * 获取卸载信息（完全模拟控制面板"程序和功能"的逻辑）
   */
  private async getUninstallInfo(version: string, architecture: string): Promise<{
    uninstallString?: string
    quietUninstallString?: string
    displayName?: string
    keyPath?: string
  } | null> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      // 控制面板查询的注册表路径（64位和32位程序）
      const uninstallKeys = [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
      ]

      const searchPatterns = this.getSearchPatterns(version, architecture)

      for (const baseKey of uninstallKeys) {
        try {
          // 枚举所有子键
          const { stdout: subKeys } = await execAsync(`reg query "${baseKey}"`)
          const keyLines = subKeys.split('\n').filter(line => line.includes('HKEY_LOCAL_MACHINE'))

          for (const keyLine of keyLines) {
            const keyPath = keyLine.trim()
            if (!keyPath) continue

            try {
              // 读取该程序的所有信息
              const { stdout: keyInfo } = await execAsync(`reg query "${keyPath}"`)

              // 检查是否匹配我们要找的程序
              let displayName = ''
              const displayNameMatch = keyInfo.match(/DisplayName\s+REG_SZ\s+(.+)/i)
              if (displayNameMatch) {
                displayName = displayNameMatch[1].trim()
              }

              // 检查是否为我们要找的Visual C++运行库
              const isMatch = searchPatterns.some(pattern =>
                displayName.toLowerCase().includes(pattern.toLowerCase()) ||
                displayName.toLowerCase().includes('microsoft visual c++')
              )

              if (isMatch && this.isArchitectureMatch(displayName, architecture)) {
                // 提取卸载信息
                const uninstallMatch = keyInfo.match(/UninstallString\s+REG_SZ\s+(.+)/i)
                const quietUninstallMatch = keyInfo.match(/QuietUninstallString\s+REG_SZ\s+(.+)/i)

                // 检查SystemComponent标志（如果为1，则不在控制面板显示）
                const systemComponentMatch = keyInfo.match(/SystemComponent\s+REG_DWORD\s+0x1/i)
                if (systemComponentMatch) {
                  continue // 跳过系统组件
                }

                // 检查WindowsInstaller标志（MSI安装的程序）
                const windowsInstallerMatch = keyInfo.match(/WindowsInstaller\s+REG_DWORD\s+0x1/i)
                const isMsiInstall = !!windowsInstallerMatch

                // logger.info(`找到匹配的程序: ${displayName} (${keyPath})`)
                // logger.info(`MSI安装: ${isMsiInstall}, 卸载字符串: ${uninstallMatch?.[1] || '无'}`)

                return {
                  uninstallString: uninstallMatch?.[1]?.trim(),
                  quietUninstallString: quietUninstallMatch?.[1]?.trim(),
                  displayName: displayName,
                  keyPath: keyPath
                }
              }
            } catch (error) {
              // 跳过无法读取的键
              continue
            }
          }
        } catch (error) {
          // 跳过无法访问的注册表路径
          continue
        }
      }

      return null
    } catch (error) {
      logger.error('获取卸载信息失败:', error)
      return null
    }
  }

  /**
   * 检查架构是否匹配
   */
  private isArchitectureMatch(displayName: string, targetArch: string): boolean {
    const name = displayName.toLowerCase()

    if (targetArch === 'x64') {
      return name.includes('(x64)') || name.includes('64-bit') ||
             (!name.includes('(x86)') && !name.includes('32-bit'))
    } else if (targetArch === 'x86') {
      return name.includes('(x86)') || name.includes('32-bit')
    }

    return false
  }

  /**
   * 执行卸载程序（完全模拟控制面板"程序和功能"的卸载逻辑）
   */
  private async executeUninstaller(uninstallString: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const trimmed = uninstallString.trim()
      let command: string
      let args: string[] = []

      // logger.info(`原始卸载命令: ${trimmed}`)

      // 解析命令行（处理引号）
      if (trimmed.toLowerCase().startsWith('msiexec')) {
        // MSI卸载 - 控制面板使用的标准方式
        const parts = this.parseCommandLine(trimmed)
        command = parts.shift()!
        args = parts

        // 确保有静默参数（控制面板在后台卸载时使用）
        if (!args.some(a => a.toLowerCase() === '/quiet' || a.toLowerCase() === '/qn')) {
          args.push('/quiet')
        }
        if (!args.some(a => a.toLowerCase() === '/norestart')) {
          args.push('/norestart')
        }
      } else {
        // EXE卸载程序
        const parts = this.parseCommandLine(trimmed)
        command = parts.shift()!
        args = parts

        // 如果QuietUninstallString已经包含静默参数，不要重复添加
        const hasQuietParam = args.some(arg =>
          /\/quiet|\/silent|\/s|\/q|\-s|\-q|\/uninstall/i.test(arg)
        )

        if (!hasQuietParam) {
          // 尝试常见的静默参数
          args.push('/quiet')
        }
      }

      // logger.info(`解析后命令: ${command}`)
      // logger.info(`解析后参数: ${args.join(' ')}`)

      const proc = spawn(command, args, {
        stdio: 'pipe',
        shell: false
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        logger.info(`卸载程序退出，代码: ${code}`)
        if (stdout) logger.info(`标准输出: ${stdout}`)
        if (stderr) logger.info(`错误输出: ${stderr}`)

        // Windows Installer 退出代码
        // 0: 成功
        // 3010: 成功，需要重启
        // 1605: 产品未安装
        // 1641: 成功，安装程序启动了重启
        if (code === 0 || code === 3010 || code === 1641) {
          resolve()
        } else if (code === 1605) {
          reject(new Error('程序未安装或已被卸载'))
        } else {
          reject(new Error(`卸载失败，退出代码: ${code}${stderr ? ', 错误信息: ' + stderr : ''}`))
        }
      })

      proc.on('error', (error) => {
        reject(new Error(`启动卸载程序失败: ${error.message}`))
      })

      // 设置超时（10分钟）
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill()
          reject(new Error('卸载超时'))
        }
      }, 600000)
    })
  }

  /**
   * 解析命令行（正确处理引号）
   */
  private parseCommandLine(commandLine: string): string[] {
    const args: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''

    for (let i = 0; i < commandLine.length; i++) {
      const char = commandLine[i]

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true
        quoteChar = char
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false
        quoteChar = ''
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim())
          current = ''
        }
      } else {
        current += char
      }
    }

    if (current.trim()) {
      args.push(current.trim())
    }

    return args
  }

  /**
   * 验证Visual C++运行库安装
   */
  async verifyVcRedist(version: string, architecture: string): Promise<{ installed: boolean; registryInfo?: string }> {
    if (os.platform() !== 'win32') {
      throw new Error('Visual C++运行库只能在Windows系统上验证')
    }

    const installed = await this.checkVcRedistInstalled(version, architecture)

    if (installed) {
      // 获取注册表信息
      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)

        const searchPatterns = this.getSearchPatterns(version, architecture)

        for (const pattern of searchPatterns) {
          try {
            const { stdout } = await execAsync(`reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /f "${pattern}" /d`)
            if (stdout.includes('Microsoft Visual C++') && stdout.includes(pattern)) {
              return {
                installed: true,
                registryInfo: stdout
              }
            }
          } catch (error) {
            continue
          }
        }
      } catch (error) {
        logger.error(`获取注册表信息失败:`, error)
      }
    }

    return { installed }
  }
}
