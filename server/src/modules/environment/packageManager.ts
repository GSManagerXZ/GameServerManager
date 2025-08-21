import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import logger from '../../utils/logger.js'

const execAsync = promisify(exec)

export interface PackageInfo {
  name: string
  description: string
  category: string
  installed: boolean
  installing?: boolean
}

export interface PackageInstallTask {
  id: string
  packageName: string
  packageManager: string
  operation: 'install' | 'uninstall'
  status: 'preparing' | 'installing' | 'completed' | 'failed'
  startTime: Date
  endTime?: Date
  error?: string
}

export interface PackageManager {
  name: string
  displayName: string
  checkCommand: string
  installCommand: string
  uninstallCommand: string
  listCommand: string
  available: boolean
}

export class LinuxPackageManager {
  private packageManagers: PackageManager[] = [
    {
      name: 'apt',
      displayName: 'APT (Ubuntu/Debian)',
      checkCommand: 'which apt',
      installCommand: 'apt install -y',
      uninstallCommand: 'apt remove -y',
      listCommand: 'dpkg -l',
      available: false
    },
    {
      name: 'yum',
      displayName: 'YUM (CentOS/RHEL)',
      checkCommand: 'which yum',
      installCommand: 'yum install -y',
      uninstallCommand: 'yum remove -y',
      listCommand: 'yum list installed',
      available: false
    },
    {
      name: 'dnf',
      displayName: 'DNF (Fedora)',
      checkCommand: 'which dnf',
      installCommand: 'dnf install -y',
      uninstallCommand: 'dnf remove -y',
      listCommand: 'dnf list installed',
      available: false
    }
  ]

  // APT包列表及其描述
  private aptPackages: Record<string, { description: string; category: string }> = {
    'libncurses5:i386': { description: '32位终端控制库，用于文本界面程序', category: '基础库' },
    'libbz2-1.0:i386': { description: '32位bzip2压缩库', category: '压缩库' },
    'libicu67:i386': { description: '32位Unicode国际化组件库', category: '国际化' },
    'libxml2:i386': { description: '32位XML解析库', category: '解析库' },
    'libstdc++6:i386': { description: '32位C++标准库', category: '基础库' },
    'lib32gcc-s1': { description: '32位GCC支持库', category: '编译器库' },
    'libc6-i386': { description: '32位GNU C库', category: '基础库' },
    'lib32stdc++6': { description: '32位C++标准库（兼容版本）', category: '基础库' },
    'libcurl4-gnutls-dev:i386': { description: '32位cURL开发库（GnuTLS版本）', category: '网络库' },
    'libcurl4-gnutls-dev': { description: 'cURL开发库（GnuTLS版本）', category: '网络库' },
    'libgl1-mesa-glx:i386': { description: '32位Mesa OpenGL库', category: '图形库' },
    'gcc-10-base:i386': { description: '32位GCC 10基础包', category: '编译器库' },
    'libssl1.1:i386': { description: '32位OpenSSL加密库', category: '安全库' },
    'libopenal1:i386': { description: '32位OpenAL音频库', category: '音频库' },
    'libtinfo6:i386': { description: '32位终端信息库', category: '终端库' },
    'libtcmalloc-minimal4:i386': { description: '32位TCMalloc内存分配器', category: '内存管理' },
    'libgdiplus': { description: '.NET GDI+图形库', category: '.NET/Mono' },
    'libc6-dev': { description: 'GNU C库开发文件', category: '开发库' },
    'libasound2': { description: 'ALSA音频库', category: '音频库' },
    'libpulse0': { description: 'PulseAudio客户端库', category: '音频库' },
    'libnss3': { description: 'Network Security Services库', category: '安全库' },
    'libgconf-2-4': { description: 'GConf配置系统库', category: '配置库' },
    'libcap2': { description: 'POSIX能力库', category: '系统库' },
    'libatk1.0-0': { description: 'ATK无障碍工具包', category: 'GUI库' },
    'libcairo2': { description: 'Cairo 2D图形库', category: '图形库' },
    'libcups2': { description: 'CUPS打印系统库', category: '打印库' },
    'libgtk-3-0': { description: 'GTK+ 3.0图形界面库', category: 'GUI库' },
    'libgdk-pixbuf2.0-0': { description: 'GDK-PixBuf图像加载库', category: '图形库' },
    'libpango-1.0-0': { description: 'Pango文本渲染库', category: '文本库' },
    'libx11-6': { description: 'X11客户端库', category: 'X11库' },
    'libxt6': { description: 'X Toolkit库', category: 'X11库' },
    'libsdl2-2.0-0:i386': { description: '32位SDL2多媒体库', category: 'Unity游戏' },
    'libsdl2-2.0-0': { description: 'SDL2多媒体库', category: 'Unity游戏' },
    'libpulse0:i386': { description: '32位PulseAudio客户端库', category: 'Unity游戏' },
    'libfontconfig1:i386': { description: '32位字体配置库', category: 'Unity游戏' },
    'libfontconfig1': { description: '字体配置库', category: 'Unity游戏' },
    'libudev1:i386': { description: '32位设备管理库', category: 'Unity游戏' },
    'libudev1': { description: '设备管理库', category: 'Unity游戏' },
    'libpugixml1v5': { description: 'PugiXML解析库', category: 'Unity游戏' },
    'libvulkan1': { description: 'Vulkan图形API库', category: 'Unity游戏' },
    'libvulkan1:i386': { description: '32位Vulkan图形API库', category: 'Unity游戏' },
    'libgconf-2-4:i386': { description: '32位GConf配置系统库', category: 'Unity游戏' },
    'libatk1.0-0:i386': { description: '32位ATK无障碍工具包', category: 'Unity游戏' },
    'libxcomposite1': { description: 'X Composite扩展库', category: 'Unity游戏' },
    'libxcomposite1:i386': { description: '32位X Composite扩展库', category: 'Unity游戏' },
    'libxcursor1': { description: 'X光标管理库', category: 'Unity游戏' },
    'libxcursor1:i386': { description: '32位X光标管理库', category: 'Unity游戏' },
    'libxrandr2': { description: 'X RandR扩展库', category: 'Unity游戏' },
    'libxrandr2:i386': { description: '32位X RandR扩展库', category: 'Unity游戏' },
    'libxss1': { description: 'X屏幕保护程序扩展库', category: 'Unity游戏' },
    'libxss1:i386': { description: '32位X屏幕保护程序扩展库', category: 'Unity游戏' },
    'libxtst6': { description: 'X测试扩展库', category: 'Unity游戏' },
    'libxtst6:i386': { description: '32位X测试扩展库', category: 'Unity游戏' },
    'libxi6': { description: 'X输入扩展库', category: 'Unity游戏' },
    'libxi6:i386': { description: '32位X输入扩展库', category: 'Unity游戏' },
    'libxkbfile1': { description: 'X键盘文件库', category: 'Unity游戏' },
    'libxkbfile1:i386': { description: '32位X键盘文件库', category: 'Unity游戏' },
    'libasound2:i386': { description: '32位ALSA音频库', category: 'Unity游戏' },
    'libgtk-3-0:i386': { description: '32位GTK+ 3.0图形界面库', category: 'Unity游戏' },
    'libdbus-1-3': { description: 'D-Bus消息系统库', category: 'Unity游戏' },
    'libdbus-1-3:i386': { description: '32位D-Bus消息系统库', category: 'Unity游戏' },
    'libelf1': { description: 'ELF文件处理库', category: 'ARK游戏' },
    'libelf1:i386': { description: '32位ELF文件处理库', category: 'ARK游戏' },
    'libatomic1': { description: '原子操作库', category: 'ARK游戏' },
    'libatomic1:i386': { description: '32位原子操作库', category: 'ARK游戏' },
    'xz-utils': { description: 'XZ压缩工具', category: 'ARK游戏' },
    'zlib1g:i386': { description: '32位zlib压缩库', category: 'ARK游戏' },
    'fonts-wqy-zenhei': { description: '文泉驿正黑字体', category: 'ARK游戏' },
    'fonts-wqy-microhei': { description: '文泉驿微米黑字体', category: 'ARK游戏' },
    'libc6': { description: 'GNU C库', category: 'ARK游戏' },
    'libc6:i386': { description: '32位GNU C库', category: 'ARK游戏' }
  }

  constructor() {
    this.initializePackageManagers()
  }

  /**
   * 初始化包管理器可用性检查
   */
  private async initializePackageManagers(): Promise<void> {
    if (os.platform() !== 'linux') {
      return
    }

    for (const pm of this.packageManagers) {
      try {
        await execAsync(pm.checkCommand)
        pm.available = true
        logger.info(`包管理器 ${pm.name} 可用`)
      } catch (error) {
        pm.available = false
        logger.debug(`包管理器 ${pm.name} 不可用`)
      }
    }
  }

  /**
   * 获取可用的包管理器列表
   */
  async getAvailablePackageManagers(): Promise<PackageManager[]> {
    await this.initializePackageManagers()
    return this.packageManagers.filter(pm => pm.available)
  }

  /**
   * 获取指定包管理器的包列表
   */
  async getPackageList(packageManagerName: string): Promise<PackageInfo[]> {
    if (packageManagerName === 'apt') {
      return this.getAptPackageList()
    }
    
    // 其他包管理器暂时返回空列表
    return []
  }

  /**
   * 获取APT包列表及安装状态
   */
  private async getAptPackageList(): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = []

    // 首先检查是否需要启用32位架构
    const has32BitPackages = Object.keys(this.aptPackages).some(name => name.includes(':i386'))
    if (has32BitPackages) {
      try {
        await this.enable32BitArchitecture()
      } catch (error) {
        logger.warn('启用32位架构失败，某些32位包可能无法安装:', error)
      }
    }

    for (const [packageName, info] of Object.entries(this.aptPackages)) {
      const installed = await this.checkPackageInstalled('apt', packageName)
      const available = await this.checkPackageAvailable('apt', packageName)

      // 只添加可用的包到列表中
      if (available || installed) {
        packages.push({
          name: packageName,
          description: info.description,
          category: info.category,
          installed
        })
      } else {
        logger.debug(`包 ${packageName} 在当前系统中不可用，跳过`)
      }
    }

    return packages
  }

  /**
   * 检查包是否已安装
   */
  private async checkPackageInstalled(packageManagerName: string, packageName: string): Promise<boolean> {
    try {
      if (packageManagerName === 'apt') {
        const { stdout } = await execAsync(`dpkg -l ${packageName} 2>/dev/null | grep "^ii"`)
        return stdout.trim().length > 0
      }
      return false
    } catch (error) {
      return false
    }
  }

  /**
   * 检查包是否可用（可以被安装）
   */
  private async checkPackageAvailable(packageManagerName: string, packageName: string): Promise<boolean> {
    try {
      if (packageManagerName === 'apt') {
        // 检查包是否在仓库中可用
        const { stdout } = await execAsync(`apt-cache show ${packageName} 2>/dev/null`)
        return stdout.trim().length > 0
      }
      return false
    } catch (error) {
      return false
    }
  }

  /**
   * 启用32位架构支持（仅限APT）
   */
  private async enable32BitArchitecture(): Promise<void> {
    try {
      // 检查是否已经启用了i386架构
      const { stdout } = await execAsync('dpkg --print-foreign-architectures')
      if (stdout.includes('i386')) {
        logger.info('i386架构已启用')
        return
      }

      // 启用i386架构
      logger.info('正在启用i386架构支持...')
      await execAsync('sudo dpkg --add-architecture i386')
      await execAsync('sudo apt update')
      logger.info('i386架构支持已启用')
    } catch (error) {
      logger.error('启用i386架构失败:', error)
      throw new Error('启用32位架构支持失败')
    }
  }

  /**
   * 安装包
   */
  async installPackages(
    packageManagerName: string,
    packageNames: string[],
    onProgress?: (task: PackageInstallTask) => void
  ): Promise<void> {
    const pm = this.packageManagers.find(p => p.name === packageManagerName)
    if (!pm || !pm.available) {
      throw new Error(`包管理器 ${packageManagerName} 不可用`)
    }

    // 检查是否有32位包需要安装
    const has32BitPackages = packageNames.some(name => name.includes(':i386'))

    if (packageManagerName === 'apt' && has32BitPackages) {
      try {
        await this.enable32BitArchitecture()
      } catch (error) {
        logger.warn('启用32位架构失败，继续尝试安装:', error)
      }
    }

    // 并行处理所有包的安装
    const results: { package: string; success: boolean; error?: string }[] = []

    // 首先过滤出需要安装的包
    const packagesToInstall: string[] = []

    for (let i = 0; i < packageNames.length; i++) {
      const packageName = packageNames[i]
      const taskId = `${packageManagerName}-install-${Date.now()}-${i}`

      // 创建任务对象
      const task: PackageInstallTask = {
        id: taskId,
        packageName,
        packageManager: packageManagerName,
        operation: 'install',
        status: 'preparing',
        startTime: new Date()
      }

      try {
        // 发送准备安装状态
        if (onProgress) {
          onProgress(task)
        }

        // 检查包是否可用
        const available = await this.checkPackageAvailable(packageManagerName, packageName)
        if (!available) {
          logger.warn(`包 ${packageName} 在仓库中不可用，跳过安装`)
          task.status = 'failed'
          task.error = '包在仓库中不可用'
          task.endTime = new Date()
          if (onProgress) onProgress(task)
          results.push({ package: packageName, success: false, error: '包在仓库中不可用' })
          continue
        }

        // 检查是否已安装
        const installed = await this.checkPackageInstalled(packageManagerName, packageName)
        if (installed) {
          logger.info(`包 ${packageName} 已安装，跳过`)
          task.status = 'completed'
          task.endTime = new Date()
          if (onProgress) onProgress(task)
          results.push({ package: packageName, success: true })
          continue
        }

        // 添加到待安装列表
        packagesToInstall.push(packageName)

        // 更新为正在安装状态
        task.status = 'installing'
        if (onProgress) onProgress(task)
      } catch (error) {
        logger.error(`检查包 ${packageName} 失败:`, error)
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : '未知错误'
        task.endTime = new Date()
        if (onProgress) onProgress(task)
        results.push({
          package: packageName,
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        })
      }
    }

    // 如果有包需要安装，使用单个命令同时安装所有包
    if (packagesToInstall.length > 0) {
      try {
        const command = `sudo ${pm.installCommand} ${packagesToInstall.join(' ')}`
        logger.info(`执行批量安装命令: ${command}`)

        await execAsync(command, { timeout: 600000 }) // 10分钟超时
        logger.info(`成功安装所有包: ${packagesToInstall.join(', ')}`)

        // 更新所有包为完成状态
        for (const packageName of packagesToInstall) {
          const task: PackageInstallTask = {
            id: `${packageManagerName}-install-${Date.now()}-completed`,
            packageName,
            packageManager: packageManagerName,
            operation: 'install',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date()
          }
          if (onProgress) onProgress(task)
          results.push({ package: packageName, success: true })
        }
      } catch (error) {
        logger.error(`批量安装失败:`, error)

        // 更新所有包为失败状态
        for (const packageName of packagesToInstall) {
          const task: PackageInstallTask = {
            id: `${packageManagerName}-install-${Date.now()}-failed`,
            packageName,
            packageManager: packageManagerName,
            operation: 'install',
            status: 'failed',
            startTime: new Date(),
            endTime: new Date(),
            error: error instanceof Error ? error.message : '未知错误'
          }
          if (onProgress) onProgress(task)
          results.push({
            package: packageName,
            success: false,
            error: error instanceof Error ? error.message : '未知错误'
          })
        }
      }
    }

    // 检查结果
    const failedPackages = results.filter(r => !r.success)
    const successPackages = results.filter(r => r.success)

    if (failedPackages.length > 0) {
      const errorMessage = `部分包安装失败:\n${failedPackages.map(p => `- ${p.package}: ${p.error}`).join('\n')}`
      if (successPackages.length === 0) {
        throw new Error(errorMessage)
      } else {
        logger.warn(errorMessage)
        logger.info(`成功安装 ${successPackages.length} 个包，失败 ${failedPackages.length} 个包`)
      }
    } else {
      logger.info(`成功安装所有包: ${packageNames.join(', ')}`)
    }
  }

  /**
   * 卸载包
   */
  async uninstallPackages(
    packageManagerName: string,
    packageNames: string[],
    onProgress?: (task: PackageInstallTask) => void
  ): Promise<void> {
    const pm = this.packageManagers.find(p => p.name === packageManagerName)
    if (!pm || !pm.available) {
      throw new Error(`包管理器 ${packageManagerName} 不可用`)
    }

    // 并行处理所有包的卸载
    const results: { package: string; success: boolean; error?: string }[] = []

    // 首先过滤出需要卸载的包
    const packagesToUninstall: string[] = []

    for (let i = 0; i < packageNames.length; i++) {
      const packageName = packageNames[i]
      const taskId = `${packageManagerName}-uninstall-${Date.now()}-${i}`

      // 创建任务对象
      const task: PackageInstallTask = {
        id: taskId,
        packageName,
        packageManager: packageManagerName,
        operation: 'uninstall',
        status: 'preparing',
        startTime: new Date()
      }

      try {
        // 发送准备卸载状态
        if (onProgress) {
          onProgress(task)
        }

        // 检查是否已安装
        const installed = await this.checkPackageInstalled(packageManagerName, packageName)
        if (!installed) {
          logger.info(`包 ${packageName} 未安装，跳过卸载`)
          task.status = 'completed'
          task.endTime = new Date()
          if (onProgress) onProgress(task)
          results.push({ package: packageName, success: true })
          continue
        }

        // 添加到待卸载列表
        packagesToUninstall.push(packageName)

        // 更新为正在卸载状态
        task.status = 'installing'
        if (onProgress) onProgress(task)
      } catch (error) {
        logger.error(`检查包 ${packageName} 失败:`, error)
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : '未知错误'
        task.endTime = new Date()
        if (onProgress) onProgress(task)
        results.push({
          package: packageName,
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        })
      }
    }

    // 如果有包需要卸载，使用单个命令同时卸载所有包
    if (packagesToUninstall.length > 0) {
      try {
        const command = `sudo ${pm.uninstallCommand} ${packagesToUninstall.join(' ')}`
        logger.info(`执行批量卸载命令: ${command}`)

        await execAsync(command, { timeout: 600000 }) // 10分钟超时
        logger.info(`成功卸载所有包: ${packagesToUninstall.join(', ')}`)

        // 更新所有包为完成状态
        for (const packageName of packagesToUninstall) {
          const task: PackageInstallTask = {
            id: `${packageManagerName}-uninstall-${Date.now()}-completed`,
            packageName,
            packageManager: packageManagerName,
            operation: 'uninstall',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date()
          }
          if (onProgress) onProgress(task)
          results.push({ package: packageName, success: true })
        }
      } catch (error) {
        logger.error(`批量卸载失败:`, error)

        // 更新所有包为失败状态
        for (const packageName of packagesToUninstall) {
          const task: PackageInstallTask = {
            id: `${packageManagerName}-uninstall-${Date.now()}-failed`,
            packageName,
            packageManager: packageManagerName,
            operation: 'uninstall',
            status: 'failed',
            startTime: new Date(),
            endTime: new Date(),
            error: error instanceof Error ? error.message : '未知错误'
          }
          if (onProgress) onProgress(task)
          results.push({
            package: packageName,
            success: false,
            error: error instanceof Error ? error.message : '未知错误'
          })
        }
      }
    }

    // 检查结果
    const failedPackages = results.filter(r => !r.success)
    const successPackages = results.filter(r => r.success)

    if (failedPackages.length > 0) {
      const errorMessage = `部分包卸载失败:\n${failedPackages.map(p => `- ${p.package}: ${p.error}`).join('\n')}`
      if (successPackages.length === 0) {
        throw new Error(errorMessage)
      } else {
        logger.warn(errorMessage)
        logger.info(`成功卸载 ${successPackages.length} 个包，失败 ${failedPackages.length} 个包`)
      }
    } else {
      logger.info(`成功卸载所有包: ${packageNames.join(', ')}`)
    }
  }
}
