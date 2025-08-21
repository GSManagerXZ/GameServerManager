import { Router, Request, Response } from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { deployTModLoaderServer, deployFactorioServer, cancelDeployment, getActiveDeployments, getTModLoaderInfo, searchMrpackModpacks, getMrpackProjectVersions, deployMrpackServer } from '../modules/game/othergame/unified-functions.js'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'
import { Server as SocketIOServer } from 'socket.io'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()
let io: SocketIOServer

// 设置Socket.IO依赖
export function setMoreGamesDependencies(socketIO: SocketIOServer) {
  io = socketIO
}

// 游戏类型枚举
export enum GameType {
  TMODLOADER = 'tmodloader',
  FACTORIO = 'factorio',
  MRPACK = 'mrpack'
}

// 平台类型枚举
export enum Platform {
  WINDOWS = 'windows',
  LINUX = 'linux',
  MACOS = 'macos'
}

// 游戏信息接口
export interface GameInfo {
  id: string
  name: string
  description: string
  icon: string
  category: string
  supported: boolean
  supportedPlatforms: Platform[]
}

// 部署选项接口
export interface DeploymentOptions {
  gameType: GameType
  installPath: string
  options?: any
}

// 部署结果接口
export interface DeploymentResult {
  success: boolean
  message: string
  data?: any
}

// 获取当前平台
function getCurrentPlatform(): Platform {
  const platform = process.platform
  switch (platform) {
    case 'win32':
      return Platform.WINDOWS
    case 'linux':
      return Platform.LINUX
    case 'darwin':
      return Platform.MACOS
    default:
      return Platform.LINUX // 默认为Linux
  }
}

// 检查游戏是否支持当前平台
function isGameSupportedOnCurrentPlatform(game: GameInfo): boolean {
  const currentPlatform = getCurrentPlatform()
  return game.supportedPlatforms.includes(currentPlatform)
}

// 支持的游戏列表
const supportedGames: GameInfo[] = [
  {
    id: 'tmodloader',
    name: 'tModLoader',
    description: 'Terraria模组加载器服务端',
    icon: '🎮',
    category: '沙盒游戏',
    supported: true,
    supportedPlatforms: [Platform.WINDOWS, Platform.LINUX, Platform.MACOS] // 全平台支持
  },
  {
    id: 'factorio',
    name: 'Factorio',
    description: 'Factorio工厂建造游戏服务端',
    icon: '🏭',
    category: '策略游戏',
    supported: true,
    supportedPlatforms: [Platform.LINUX] // 仅Linux平台支持
  }
]

// 获取活动部署列表
router.get('/active-deployments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const activeDeployments = getActiveDeployments()
    
    res.json({
      success: true,
      data: activeDeployments.map(deployment => ({
        id: deployment.id,
        game: deployment.game,
        targetDirectory: deployment.targetDirectory,
        startTime: deployment.startTime
      })),
      message: '获取活动部署列表成功'
    })
  } catch (error: any) {
    logger.error('获取活动部署列表失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '获取活动部署列表失败'
    })
  }
})

// 取消部署
router.post('/cancel-deployment', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deploymentId } = req.body
    
    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        message: '缺少部署ID参数'
      })
    }
    
    // 获取当前活动部署列表用于调试
    const activeDeployments = getActiveDeployments()
    logger.info(`尝试取消部署: ${deploymentId}`, {
      deploymentId,
      activeDeployments: activeDeployments.map(d => ({
        id: d.id,
        game: d.game,
        startTime: d.startTime
      }))
    })
    
    // 使用统一函数取消部署
    const success = await cancelDeployment(deploymentId)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的部署任务或取消失败',
        debug: {
          requestedId: deploymentId,
          activeDeployments: activeDeployments.map(d => d.id)
        }
      })
    }
    
    logger.info(`部署任务已取消: ${deploymentId}`)
    
    res.json({
      success: true,
      message: '部署已取消'
    })
    
  } catch (error: any) {
    logger.error('取消部署失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '取消部署失败'
    })
  }
})

// 获取支持的游戏列表
router.get('/games', authenticateToken, async (req: Request, res: Response) => {
  try {
    const currentPlatform = getCurrentPlatform()
    
    // 过滤出当前平台支持的游戏，并添加平台信息
    const filteredGames = supportedGames.map(game => ({
      ...game,
      currentPlatform,
      supportedOnCurrentPlatform: isGameSupportedOnCurrentPlatform(game)
    }))
    
    res.json({
      success: true,
      data: filteredGames,
      meta: {
        currentPlatform,
        totalGames: supportedGames.length,
        supportedGames: filteredGames.filter(g => g.supportedOnCurrentPlatform).length
      }
    })
  } catch (error: any) {
    logger.error('获取游戏列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取游戏列表失败',
      message: error.message
    })
  }
})

// 获取游戏详细信息
router.get('/games/:gameId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params
    const game = supportedGames.find(g => g.id === gameId)
    
    if (!game) {
      return res.status(404).json({
        success: false,
        error: '游戏不存在',
        message: `未找到游戏: ${gameId}`
      })
    }
    
    res.json({
      success: true,
      data: game
    })
  } catch (error: any) {
    logger.error('获取游戏信息失败:', error)
    res.status(500).json({
      success: false,
      error: '获取游戏信息失败',
      message: error.message
    })
  }
})

// 部署tModLoader服务端
router.post('/deploy/tmodloader', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { installPath, options = {}, socketId } = req.body
    
    if (!installPath) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数',
        message: '安装路径为必填项'
      })
    }
    
    const deploymentId = `tmodloader-deploy-${Date.now()}`
    
    // 立即返回部署ID
    res.json({
      success: true,
      data: {
        deploymentId
      },
      message: '开始部署tModLoader服务端'
    })
    
    logger.info('开始部署tModLoader服务端', { installPath, options, deploymentId })
    
    // 异步执行部署
    ;(async () => {
      try {
        // 使用统一函数进行部署
        const result = await deployTModLoaderServer({
          targetDirectory: installPath,
          options,
          deploymentId, // 传递自定义的部署ID
          onProgress: (message, type = 'info') => {
            if (io && socketId) {
              io.to(socketId).emit('more-games-deploy-log', {
                deploymentId,
                message,
                type,
                timestamp: new Date().toISOString()
              })
            }
          }
        })
        
        if (result.success) {
          logger.info('tModLoader服务端部署成功', {
            installPath: result.targetDirectory,
            deploymentId: result.deploymentId
          })
          
          // 发送最终完成日志和进度
          if (io && socketId) {
            io.to(socketId).emit('more-games-deploy-log', {
              deploymentId,
              message: 'tModLoader服务端部署成功！'
            })
            io.to(socketId).emit('more-games-deploy-progress', {
              deploymentId,
              progress: { percentage: 100 },
              message: '部署完成'
            })
            io.to(socketId).emit('more-games-deploy-complete', {
              deploymentId,
              success: true,
              data: {
                installPath: result.targetDirectory,
                deploymentId: result.deploymentId
              },
              message: 'tModLoader服务端部署成功！'
            })
          }
        } else {
          logger.error('tModLoader部署失败:', result.message)
          
          // 发送错误事件
          if (io && socketId) {
            io.to(socketId).emit('more-games-deploy-error', {
              deploymentId,
              success: false,
              error: result.message || 'tModLoader部署失败'
            })
          }
        }
        
      } catch (error: any) {
        logger.error('tModLoader部署失败:', error)
        
        // 发送错误事件
        if (io && socketId) {
          io.to(socketId).emit('more-games-deploy-error', {
            deploymentId,
            success: false,
            error: error.message || 'tModLoader部署失败'
          })
        }
      }
    })()
    
  } catch (error: any) {
    logger.error('启动tModLoader部署失败:', error)
    res.status(500).json({
      success: false,
      error: 'tModLoader部署失败',
      message: error.message
    })
  }
})

// 部署Factorio服务端
router.post('/deploy/factorio', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { installPath, options = {}, socketId } = req.body
    
    if (!installPath) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数',
        message: '安装路径为必填项'
      })
    }
    
    const deploymentId = `factorio-deploy-${Date.now()}`
    
    // 立即返回部署ID
    res.json({
      success: true,
      data: {
        deploymentId
      },
      message: '开始部署Factorio服务端'
    })
    
    logger.info('开始部署Factorio服务端', { installPath, options, deploymentId })
    
    // 异步执行部署
    ;(async () => {
      try {
        // 使用统一函数进行部署
        const result = await deployFactorioServer({
          targetDirectory: installPath,
          deploymentId, // 传递自定义的部署ID
          onProgress: (message, type = 'info') => {
            if (io && socketId) {
              io.to(socketId).emit('more-games-deploy-log', {
                deploymentId,
                message,
                type,
                timestamp: new Date().toISOString()
              })
            }
          }
        })
        
        if (result.success) {
          logger.info('Factorio服务端部署成功', {
            installPath: result.targetDirectory,
            deploymentId: result.deploymentId
          })
          
          // 发送最终完成日志和进度
          if (io && socketId) {
            io.to(socketId).emit('more-games-deploy-log', {
              deploymentId,
              message: 'Factorio服务端部署成功！'
            })
            io.to(socketId).emit('more-games-deploy-progress', {
              deploymentId,
              progress: { percentage: 100 },
              message: '部署完成'
            })
            io.to(socketId).emit('more-games-deploy-complete', {
              deploymentId,
              success: true,
              data: {
                installPath: result.targetDirectory,
                deploymentId: result.deploymentId
              },
              message: 'Factorio服务端部署成功！'
            })
          }
        } else {
          logger.error('Factorio部署失败:', result.message)
          
          // 发送错误事件
          if (io && socketId) {
            io.to(socketId).emit('more-games-deploy-error', {
              deploymentId,
              success: false,
              error: result.message || 'Factorio部署失败'
            })
          }
        }
        
      } catch (error: any) {
        logger.error('Factorio部署失败:', error)
        
        // 发送错误事件
        if (io && socketId) {
          io.to(socketId).emit('more-games-deploy-error', {
            deploymentId,
            success: false,
            error: error.message || 'Factorio部署失败'
          })
        }
      }
    })()
    
  } catch (error: any) {
    logger.error('启动Factorio部署失败:', error)
    res.status(500).json({
      success: false,
      error: 'Factorio部署失败',
      message: error.message
    })
  }
})

// 检查游戏部署状态
router.get('/status/:gameId/:installPath(*)', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId, installPath } = req.params
    
    if (!installPath) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数',
        message: '安装路径为必填项'
      })
    }
    
    let isDeployed = false
    let version: string | null = null
    
    switch (gameId) {
      case 'tmodloader': {
        // 检查tModLoader部署状态
        const tmodloaderPath = path.join(installPath, 'tModLoaderServer.exe')
        try {
          await fs.access(tmodloaderPath)
          isDeployed = true
          // 这里可以添加版本检测逻辑
        } catch {
          isDeployed = false
        }
        break
      }
      case 'factorio': {
        // 检查Factorio部署状态
        const factorioExecutable = path.join(installPath, 'factorio', 'bin', 'x64', 'factorio')
        try {
          await fs.access(factorioExecutable)
          isDeployed = true
          // 这里可以添加版本检测逻辑
        } catch {
          isDeployed = false
        }
        break
      }
      default:
        return res.status(400).json({
          success: false,
          error: '不支持的游戏类型',
          message: `不支持的游戏: ${gameId}`
        })
    }
    
    res.json({
      success: true,
      data: {
        gameId,
        installPath,
        isDeployed,
        version
      }
    })
    
  } catch (error: any) {
    logger.error('检查部署状态失败:', error)
    res.status(500).json({
      success: false,
      error: '检查部署状态失败',
      message: error.message
    })
  }
})

// 获取游戏版本信息
router.get('/version/:gameId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params
    
    let versionInfo: any = null
    
    switch (gameId) {
      case 'tmodloader': {
        versionInfo = await getTModLoaderInfo()
        break
      }
      case 'factorio': {
        // Factorio版本信息需要从其他来源获取
        versionInfo = {
          version: 'latest',
          downloadUrl: 'https://factorio.com/get-download/stable/headless/linux64'
        }
        break
      }
      default:
        return res.status(400).json({
          success: false,
          error: '不支持的游戏类型',
          message: `不支持的游戏: ${gameId}`
        })
    }
    
    res.json({
      success: true,
      data: versionInfo
    })
    
  } catch (error: any) {
    logger.error('获取版本信息失败:', error)
    res.status(500).json({
      success: false,
      error: '获取版本信息失败',
      message: error.message
    })
  }
})

// 搜索Minecraft整合包
router.get('/mrpack/search', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { query, limit = 20, offset = 0, categories, versions, loaders, apiSource = 'official' } = req.query

    const searchOptions = {
      query: query as string,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      categories: categories ? (categories as string).split(',') : undefined,
      versions: versions ? (versions as string).split(',') : undefined,
      loaders: loaders ? (loaders as string).split(',') : undefined
    }

    const result = await searchMrpackModpacks(searchOptions, apiSource as 'official' | 'mirror')
    
    res.json({
      success: true,
      data: result,
      message: '搜索整合包成功'
    })
    
  } catch (error: any) {
    logger.error('搜索整合包失败:', error)
    res.status(500).json({
      success: false,
      error: '搜索整合包失败',
      message: error.message
    })
  }
})

// 获取Minecraft整合包项目版本
router.get('/mrpack/project/:projectId/versions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params
    const { apiSource = 'official' } = req.query

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: '缺少项目ID参数',
        message: '项目ID为必填项'
      })
    }

    const versions = await getMrpackProjectVersions(projectId, apiSource as 'official' | 'mirror')
    
    res.json({
      success: true,
      data: versions,
      message: '获取项目版本成功'
    })
    
  } catch (error: any) {
    logger.error('获取项目版本失败:', error)
    res.status(500).json({
      success: false,
      error: '获取项目版本失败',
      message: error.message
    })
  }
})

// 部署Minecraft整合包
router.post('/deploy/mrpack', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId, versionId, installPath, options = {}, socketId, apiSource = 'official' } = req.body
    
    if (!projectId || !versionId || !installPath) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数',
        message: 'projectId、versionId和installPath为必填项'
      })
    }
    
    // 验证参数格式
    if (typeof projectId !== 'string' || typeof versionId !== 'string' || typeof installPath !== 'string') {
      return res.status(400).json({
        success: false,
        error: '参数类型错误',
        message: 'projectId、versionId和installPath必须是字符串类型'
      })
    }
    
    // 验证versionId格式（Modrinth版本ID格式）
    if (versionId.length < 8 || !/^[a-zA-Z0-9]+$/.test(versionId)) {
      return res.status(400).json({
        success: false,
        error: '版本ID格式错误',
        message: `无效的版本ID: ${versionId}。版本ID应该是至少8位的字母数字字符串。`
      })
    }
    
    const deploymentId = `mrpack-deploy-${Date.now()}`
    
    // 立即返回部署ID
    res.json({
      success: true,
      data: {
        deploymentId
      },
      message: '开始部署Minecraft整合包'
    })
    
    logger.info('开始部署Minecraft整合包', { projectId, versionId, installPath, options, deploymentId })
    
    // 异步执行部署
    ;(async () => {
      try {
        // 使用统一函数进行部署
        const result = await deployMrpackServer({
          projectId,
          versionId,
          targetDirectory: installPath,
          deploymentId,
          options,
          apiSource: apiSource as 'official' | 'mirror',
          apiSource: apiSource as 'official' | 'mirror',
          onProgress: (message, type = 'info') => {
            if (io && socketId) {
              io.to(socketId).emit('more-games-deploy-log', {
                deploymentId,
                message,
                type,
                timestamp: new Date().toISOString()
              })
            }
          }
        })
        
        if (result.success) {
          logger.info('Minecraft整合包部署成功', {
            installPath: result.targetDirectory,
            deploymentId: result.deploymentId
          })
          
          // 发送最终完成日志和进度
          if (io && socketId) {
            io.to(socketId).emit('more-games-deploy-log', {
              deploymentId,
              message: 'Minecraft整合包部署成功！'
            })
            io.to(socketId).emit('more-games-deploy-progress', {
              deploymentId,
              progress: { percentage: 100 },
              message: '部署完成'
            })
            io.to(socketId).emit('more-games-deploy-complete', {
              deploymentId,
              success: true,
              data: {
                installPath: result.targetDirectory,
                deploymentId: result.deploymentId
              },
              message: 'Minecraft整合包部署成功！'
            })
          }
        } else {
          logger.error('Minecraft整合包部署失败:', result.message)
          
          // 发送错误事件
          if (io && socketId) {
            io.to(socketId).emit('more-games-deploy-error', {
              deploymentId,
              success: false,
              error: result.message || 'Minecraft整合包部署失败'
            })
          }
        }
        
      } catch (error: any) {
        logger.error('Minecraft整合包部署失败:', error)
        
        // 发送错误事件
        if (io && socketId) {
          io.to(socketId).emit('more-games-deploy-error', {
            deploymentId,
            success: false,
            error: error.message || 'Minecraft整合包部署失败'
          })
        }
      }
    })()
    
  } catch (error: any) {
    logger.error('启动Minecraft整合包部署失败:', error)
    res.status(500).json({
      success: false,
      error: 'Minecraft整合包部署失败',
      message: error.message
    })
  }
})

export default router