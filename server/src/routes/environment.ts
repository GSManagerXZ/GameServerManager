import express from 'express'
import os from 'os'
import logger from '../utils/logger.js'
import { JavaManager, VcRedistManager, DirectXManager } from '../modules/environment/index.js'
import { LinuxPackageManager } from '../modules/environment/packageManager.js'
import { authenticateToken } from '../middleware/auth.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'

// 存储Socket.IO实例的变量
let io: any = null
let configManager: ConfigManager

// 设置Socket.IO实例的函数
export const setEnvironmentSocketIO = (socketIO: any) => {
  io = socketIO
}

// 设置ConfigManager实例的函数
export const setEnvironmentConfigManager = (config: ConfigManager) => {
  configManager = config
}

const router = express.Router()
const javaManager = new JavaManager()
const vcRedistManager = new VcRedistManager()
const directxManager = new DirectXManager()
const packageManager = new LinuxPackageManager()

// 获取系统信息
router.get('/system-info', authenticateToken, async (req, res) => {
  try {
    const rawPlatform = os.platform()
    const systemInfo = {
      platform: rawPlatform,  // 保持原样，用于显示
      rawPlatform: rawPlatform,  // 原始平台标识，用于判断
      arch: os.arch(),
      type: os.type(),
      release: os.release()
    }

    res.json({
      success: true,
      data: systemInfo
    })
  } catch (error) {
    logger.error('获取系统信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取系统信息失败'
    })
  }
})

// 获取Java环境列表
router.get('/java', authenticateToken, async (req, res) => {
  try {
    const environments = await javaManager.getJavaEnvironments()

    res.json({
      success: true,
      data: environments
    })
  } catch (error) {
    logger.error('获取Java环境列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取Java环境列表失败'
    })
  }
})

// 验证赞助者密钥
function validateSponsorKey(): boolean {
  try {
    if (!configManager) {
      logger.warn('ConfigManager未初始化')
      return false
    }

    const sponsorConfig = configManager.getSponsorConfig()
    if (!sponsorConfig || !sponsorConfig.key || !sponsorConfig.isValid) {
      return false
    }

    // 检查密钥是否过期
    if (sponsorConfig.expiryTime && new Date() > new Date(sponsorConfig.expiryTime)) {
      return false
    }

    return true
  } catch (error) {
    logger.error('验证赞助者密钥失败:', error)
    return false
  }
}

// 获取赞助者专用下载链接
function getSponsorDownloadUrl(version: string, platform: string, arch?: string): string {
  const baseUrls = {
    windows: 'http://download.server.xiaozhuhouses.asia:8082/disk1/jdk/Windows/',
    linux: 'http://langlangy.server.xiaozhuhouses.asia:8082/disk1/jdk/Linux/',
    arm: 'http://langlangy.server.xiaozhuhouses.asia:8082/disk1/jdk/aarch64/'
  }

  const fileNames = {
    java8: {
      windows: 'openjdk-8u44-windows-i586.zip',
      linux: 'openjdk-8u44-linux-x64.tar.gz'
    },
    java11: {
      windows: 'openjdk-11.0.0.2_windows-x64.zip',
      linux: 'openjdk-11.0.0.2_linux-x64.tar.gz',
      arm: 'microsoft-jdk-11-linux-aarch64.tar.gz'
    },
    java17: {
      windows: 'openjdk-17.0.0.1+2_windows-x64_bin.zip',
      linux: 'openjdk-17.0.0.1+2_linux-x64_bin.tar.gz',
      arm: 'openjdk-17.0.2_macos-aarch64_bin.tar.gz'
    },
    java21: {
      windows: 'openjdk-21+35_windows-x64_bin.zip',
      linux: 'openjdk-17.0.0.1+2_linux-x64_bin.tar.gz',
      arm: 'openjdk-21_macos-aarch64_bin.tar.gz'
    },
    java25: {
      windows: 'openjdk-25+36_windows-x64_bin.zip',
      linux: 'openjdk-25+36_linux-x64_bin.tar.gz',
      arm: 'openjdk-25_macos-aarch64_bin.tar.gz'
    }
  }

  // 判断平台类型
  let platformKey: 'windows' | 'linux' | 'arm'
  if (platform === 'win32') {
    platformKey = 'windows'
  } else if (arch === 'arm64' || arch === 'aarch64') {
    platformKey = 'arm'
  } else {
    platformKey = 'linux'
  }

  const baseUrl = baseUrls[platformKey]
  const fileName = fileNames[version]?.[platformKey]

  if (!baseUrl || !fileName) {
    throw new Error(`不支持的版本或平台: ${version}, ${platform}, ${arch}`)
  }

  return baseUrl + fileName
}

// 安装Java环境
router.post('/java/install', authenticateToken, async (req, res) => {
  const { version, downloadUrl, socketId } = req.body

  if (!version || !downloadUrl) {
    return res.status(400).json({
      success: false,
      message: '缺少必要参数'
    })
  }

  try {
    // 检查是否为赞助者，如果是则使用赞助者专用下载链接
    let finalDownloadUrl = downloadUrl
    const isSponsor = validateSponsorKey()

    if (isSponsor) {
      try {
        const platform = process.platform
        const arch = os.arch()
        finalDownloadUrl = getSponsorDownloadUrl(version, platform, arch)
        logger.info(`检测到有效赞助者，使用赞助者专用下载链接: ${finalDownloadUrl}`)
      } catch (error) {
        logger.warn(`获取赞助者下载链接失败，使用默认链接: ${error instanceof Error ? error.message : '未知错误'}`)
        // 如果获取赞助者链接失败，继续使用原始链接
      }
    }

    // 立即返回响应，安装过程在后台进行
    res.json({
      success: true,
      message: `${version} 开始安装${isSponsor ? '（赞助者专用链接）' : ''}`
    })

    // 后台执行安装，通过WebSocket发送进度更新
    await javaManager.installJava(version, finalDownloadUrl, (stage, progress) => {
      if (io && socketId) {
        io.to(socketId).emit('java-install-progress', {
          version,
          stage,
          progress
        })
      }
    })

    // 发送最终进度更新，确保进度条到达100%
    if (io && socketId) {
      io.to(socketId).emit('java-install-progress', {
        version,
        stage: 'extract',
        progress: 100
      })
    }

    // 安装完成通知
    if (io && socketId) {
      io.to(socketId).emit('java-install-complete', {
        version,
        success: true,
        message: `${version} 安装成功${isSponsor ? '（赞助者专用链接）' : ''}`
      })
    }
  } catch (error) {
    logger.error(`安装 ${version} 失败:`, error)

    // 安装失败通知
    if (io && socketId) {
      io.to(socketId).emit('java-install-complete', {
        version,
        success: false,
        message: `${version} 安装失败: ${error instanceof Error ? error.message : '未知错误'}`
      })
    }
  }
})

// 卸载Java环境
router.delete('/java/:version', authenticateToken, async (req, res) => {
  const { version } = req.params

  try {
    await javaManager.uninstallJava(version)

    res.json({
      success: true,
      message: `${version} 卸载成功`
    })
  } catch (error) {
    logger.error(`卸载 ${version} 失败:`, error)

    const statusCode = error instanceof Error && error.message.includes('未安装') ? 404 : 500
    res.status(statusCode).json({
      success: false,
      message: `卸载 ${version} 失败: ${error instanceof Error ? error.message : '未知错误'}`
    })
  }
})

// 验证Java安装
router.get('/java/:version/verify', authenticateToken, async (req, res) => {
  const { version } = req.params

  try {
    const result = await javaManager.verifyJava(version)

    res.json({
      success: true,
      data: result
    })
  } catch (error) {
    logger.error(`验证 ${version} 失败:`, error)

    const statusCode = error instanceof Error && error.message.includes('未安装') ? 404 : 500
    res.status(statusCode).json({
      success: false,
      message: `验证 ${version} 失败: ${error instanceof Error ? error.message : '未知错误'}`
    })
  }
})

// 获取Visual C++运行库环境列表
router.get('/vcredist', authenticateToken, async (req, res) => {
  try {
    const environments = await vcRedistManager.getVcRedistEnvironments()

    res.json({
      success: true,
      data: environments
    })
  } catch (error) {
    logger.error('获取Visual C++运行库环境列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取Visual C++运行库环境列表失败'
    })
  }
})

// 安装Visual C++运行库
router.post('/vcredist/install', authenticateToken, async (req, res) => {
  const { version, architecture, downloadUrl, socketId } = req.body

  if (!version || !architecture || !downloadUrl) {
    return res.status(400).json({
      success: false,
      message: '缺少必要参数'
    })
  }

  try {
    // 立即返回响应，安装过程在后台进行
    res.json({
      success: true,
      message: `Visual C++ ${version} ${architecture} 开始安装`
    })

    // 后台执行安装，通过WebSocket发送进度更新
    await vcRedistManager.installVcRedist(
      version,
      architecture,
      downloadUrl,
      (stage, progress) => {
        if (io && socketId) {
          io.to(socketId).emit('vcredist-install-progress', {
            version,
            architecture,
            stage,
            progress
          })
        }
      }
    )

    // 安装完成通知
    if (io && socketId) {
      io.to(socketId).emit('vcredist-install-complete', {
        version,
        architecture,
        success: true,
        message: `Visual C++ ${version} ${architecture} 安装成功`
      })
    }
  } catch (error) {
    logger.error(`安装 Visual C++ ${version} ${architecture} 失败:`, error)

    // 安装失败通知
    if (io && socketId) {
      io.to(socketId).emit('vcredist-install-complete', {
        version,
        architecture,
        success: false,
        message: `Visual C++ ${version} ${architecture} 安装失败: ${error instanceof Error ? error.message : '未知错误'}`
      })
    }
  }
})

// 卸载Visual C++运行库
router.delete('/vcredist/:version/:architecture', authenticateToken, async (req, res) => {
  const { version, architecture } = req.params
  const { socketId } = req.body

  try {
    // 立即返回响应，卸载过程在后台进行
    res.json({
      success: true,
      message: `Visual C++ ${version} ${architecture} 卸载命令已下发`
    })

    // 后台执行卸载
    await vcRedistManager.uninstallVcRedist(version, architecture)

    // 卸载完成通知
    if (io && socketId) {
      io.to(socketId).emit('vcredist-uninstall-complete', {
        version,
        architecture,
        success: true,
        message: `Visual C++ ${version} ${architecture} 卸载成功`
      })
    }
  } catch (error) {
    logger.error(`卸载 Visual C++ ${version} ${architecture} 失败:`, error)

    // 卸载失败通知
    if (io && socketId) {
      io.to(socketId).emit('vcredist-uninstall-complete', {
        version,
        architecture,
        success: false,
        message: `Visual C++ ${version} ${architecture} 卸载失败: ${error instanceof Error ? error.message : '未知错误'}`
      })
    }
  }
})

// 验证Visual C++运行库安装
router.get('/vcredist/:version/:architecture/verify', authenticateToken, async (req, res) => {
  const { version, architecture } = req.params

  try {
    const result = await vcRedistManager.verifyVcRedist(version, architecture)

    res.json({
      success: true,
      data: result
    })
  } catch (error) {
    logger.error(`验证 Visual C++ ${version} ${architecture} 失败:`, error)

    res.status(500).json({
      success: false,
      message: `验证 Visual C++ ${version} ${architecture} 失败: ${error instanceof Error ? error.message : '未知错误'}`
    })
  }
})

// 获取DirectX环境列表
router.get('/directx', authenticateToken, async (req, res) => {
  try {
    const environments = await directxManager.getDirectXEnvironments()

    res.json({
      success: true,
      data: environments
    })
  } catch (error) {
    logger.error('获取DirectX环境列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取DirectX环境列表失败'
    })
  }
})

// 安装DirectX
router.post('/directx/install', authenticateToken, async (req, res) => {
  const { downloadUrl, socketId } = req.body

  if (!downloadUrl) {
    return res.status(400).json({
      success: false,
      message: '缺少必要参数'
    })
  }

  try {
    // 立即返回响应，安装过程在后台进行
    res.json({
      success: true,
      message: 'DirectX 开始安装'
    })

    // 后台执行安装，通过WebSocket发送进度更新
    await directxManager.installDirectX(downloadUrl, (stage, progress) => {
      if (io && socketId) {
        io.to(socketId).emit('directx-install-progress', {
          stage,
          progress
        })
      }
    })

    // 安装完成通知
    if (io && socketId) {
      io.to(socketId).emit('directx-install-complete', {
        success: true,
        message: 'DirectX 安装成功'
      })
    }
  } catch (error) {
    logger.error('安装 DirectX 失败:', error)

    // 安装失败通知
    if (io && socketId) {
      io.to(socketId).emit('directx-install-complete', {
        success: false,
        message: `DirectX 安装失败: ${error instanceof Error ? error.message : '未知错误'}`
      })
    }
  }
})

// 卸载DirectX
router.delete('/directx', authenticateToken, async (req, res) => {
  try {
    await directxManager.uninstallDirectX()

    res.json({
      success: true,
      message: 'DirectX 安装文件已清理'
    })
  } catch (error) {
    logger.error('清理 DirectX 安装文件失败:', error)

    res.status(500).json({
      success: false,
      message: `清理 DirectX 安装文件失败: ${error instanceof Error ? error.message : '未知错误'}`
    })
  }
})

// 获取可用的包管理器列表
router.get('/package-managers', authenticateToken, async (req, res) => {
  try {
    const managers = await packageManager.getAvailablePackageManagers()

    res.json({
      success: true,
      data: managers
    })
  } catch (error) {
    logger.error('获取包管理器列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取包管理器列表失败'
    })
  }
})

// 获取指定包管理器的包列表
router.get('/packages/:packageManager', authenticateToken, async (req, res) => {
  const { packageManager: pmName } = req.params

  try {
    const packages = await packageManager.getPackageList(pmName)

    res.json({
      success: true,
      data: packages
    })
  } catch (error) {
    logger.error(`获取 ${pmName} 包列表失败:`, error)
    res.status(500).json({
      success: false,
      message: `获取 ${pmName} 包列表失败`
    })
  }
})

// 安装包
router.post('/packages/:packageManager/install', authenticateToken, async (req, res) => {
  const { packageManager: pmName } = req.params
  const { packages, socketId } = req.body

  if (!packages || !Array.isArray(packages) || packages.length === 0) {
    return res.status(400).json({
      success: false,
      message: '缺少必要参数或包列表为空'
    })
  }

  try {
    // 立即返回响应，安装过程在后台进行
    res.json({
      success: true,
      message: '操作命令已下发'
    })

    // 后台执行安装，通过WebSocket发送进度更新
    await packageManager.installPackages(pmName, packages, (task) => {
      if (io && socketId) {
        io.to(socketId).emit('package-task-progress', task)
      }
    })

    // 安装完成通知
    if (io && socketId) {
      io.to(socketId).emit('package-install-complete', {
        packageManager: pmName,
        packages,
        success: true,
        message: `成功安装 ${packages.length} 个包`
      })
    }
  } catch (error) {
    logger.error(`安装包失败:`, error)

    // 安装失败通知
    if (io && socketId) {
      io.to(socketId).emit('package-install-complete', {
        packageManager: pmName,
        packages,
        success: false,
        message: `安装包失败: ${error instanceof Error ? error.message : '未知错误'}`
      })
    }
  }
})

// 卸载包
router.post('/packages/:packageManager/uninstall', authenticateToken, async (req, res) => {
  const { packageManager: pmName } = req.params
  const { packages, socketId } = req.body

  if (!packages || !Array.isArray(packages) || packages.length === 0) {
    return res.status(400).json({
      success: false,
      message: '缺少必要参数或包列表为空'
    })
  }

  try {
    // 立即返回响应，卸载过程在后台进行
    res.json({
      success: true,
      message: '操作命令已下发'
    })

    // 后台执行卸载，通过WebSocket发送进度更新
    await packageManager.uninstallPackages(pmName, packages, (task) => {
      if (io && socketId) {
        io.to(socketId).emit('package-task-progress', task)
      }
    })

    // 卸载完成通知
    if (io && socketId) {
      io.to(socketId).emit('package-uninstall-complete', {
        packageManager: pmName,
        packages,
        success: true,
        message: `成功卸载 ${packages.length} 个包`
      })
    }
  } catch (error) {
    logger.error(`卸载包失败:`, error)

    // 卸载失败通知
    if (io && socketId) {
      io.to(socketId).emit('package-uninstall-complete', {
        packageManager: pmName,
        packages,
        success: false,
        message: `卸载包失败: ${error instanceof Error ? error.message : '未知错误'}`
      })
    }
  }
})

export default router
