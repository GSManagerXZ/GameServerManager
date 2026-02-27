import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'
import logger from '../utils/logger.js'
import { Server as SocketIOServer } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { createWriteStream, createReadStream } from 'fs'
import { pipeline } from 'stream/promises'
import { zipToolsManager } from '../utils/zipToolsManager.js'

const router = Router()
let io: SocketIOServer
let configManager: ConfigManager

// 设置依赖
export function setOnlineDeployDependencies(socketIO: SocketIOServer, config: ConfigManager) {
  io = socketIO
  configManager = config
}

// 平台类型枚举
export enum Platform {
  WINDOWS = 'windows',
  LINUX = 'linux',
  MACOS = 'macos'
}

// 在线游戏信息接口
export interface OnlineGameInfo {
  id: string
  name: string
  description?: string
  image?: string
  downloadUrl?: string
  type?: string[] // 添加type字段
  category?: string
  supportedPlatforms: Platform[]
  deploymentScript?: string
  version?: string
}

// 部署选项接口
export interface OnlineDeploymentOptions {
  gameId: string
  installPath: string
  options?: any
}

// 部署结果接口
export interface OnlineDeploymentResult {
  success: boolean
  message: string
  data?: any
}

// 活动部署映射
const activeDeployments = new Map<string, any>()

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
      return Platform.LINUX
  }
}

// 检查游戏是否支持当前平台
function isGameSupportedOnCurrentPlatform(game: OnlineGameInfo): boolean {
  const currentPlatform = getCurrentPlatform()
  return game.supportedPlatforms.includes(currentPlatform)
}

// 验证赞助者密钥
async function validateSponsorKey(): Promise<boolean> {
  try {
    const sponsorConfig = await configManager.getSponsorConfig()
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

// 获取在线游戏列表
router.get('/games', authenticateToken, async (req: Request, res: Response) => {
  try {
    // 验证赞助者密钥
    const isValidSponsor = await validateSponsorKey()
    if (!isValidSponsor) {
      return res.status(403).json({
        success: false,
        message: '需要有效的赞助者密钥才能访问在线部署功能'
      })
    }

    const currentPlatform = getCurrentPlatform()
    
    // 获取赞助者密钥
    const sponsorConfig = await configManager.getSponsorConfig()
    if (!sponsorConfig || !sponsorConfig.key) {
      return res.status(403).json({
        success: false,
        message: '未找到赞助者密钥'
      })
    }

    // 映射平台名称
    const systemName = currentPlatform === Platform.WINDOWS ? 'Windows' : 
                      currentPlatform === Platform.LINUX ? 'Linux' : 'Linux'

    try {
      // 向第三方API请求在线游戏列表
      const response = await axios.post('http://api.gsm.xiaozhuhouses.asia:10002/api/online-games', {
        system: systemName,
        key: sponsorConfig.key
      }, {
        timeout: 30000, // 30秒超时
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (response.data.status !== 'success') {
        throw new Error(response.data.message || '获取在线游戏列表失败')
      }

      // 转换API返回的数据格式
      const gameData = response.data.data || {}
      const supportedGames = Object.entries(gameData).map(([gameName, gameInfo]: [string, any]) => ({
        id: gameName.toLowerCase().replace(/\s+/g, '-'),
        name: gameName,
        description: gameInfo.txt || '',
        image: gameInfo.image || '',
        downloadUrl: gameInfo.download || '',
        type: gameInfo.type || [], // 添加type字段
        supportedPlatforms: [currentPlatform], // 基于请求的系统类型
        supported: true,
        currentPlatform
      }))

      logger.info(`成功获取到 ${supportedGames.length} 个在线游戏`)
      
      res.json({
        success: true,
        data: supportedGames
      })
      
    } catch (apiError: any) {
      logger.error('请求第三方API失败:', apiError.message)
      
      // 如果API请求失败，返回空列表而不是错误
      res.json({
        success: true,
        data: [],
        message: '暂时无法获取在线游戏列表，请稍后重试'
      })
    }
  } catch (error) {
    logger.error('获取在线游戏列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取在线游戏列表失败'
    })
  }
})

// 部署在线游戏
router.post('/deploy', authenticateToken, async (req: Request, res: Response) => {
  try {
    // 验证赞助者密钥
    const isValidSponsor = await validateSponsorKey()
    if (!isValidSponsor) {
      return res.status(403).json({
        success: false,
        message: '需要有效的赞助者密钥才能使用在线部署功能'
      })
    }

    const { gameId, installPath, socketId } = req.body

    if (!gameId || !installPath) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    const deploymentId = uuidv4()
    
    // 模拟部署过程
    const deploymentProcess = {
      id: deploymentId,
      gameId,
      installPath,
      status: 'running',
      startTime: new Date()
    }

    activeDeployments.set(deploymentId, deploymentProcess)

    // 异步执行部署
    setImmediate(async () => {
      try {
        // 检查部署是否被取消
        if (deploymentProcess.status === 'cancelled') {
          return
        }

        // 发送开始部署消息
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-log', {
            deploymentId,
            message: `开始部署 ${gameId}...`,
            type: 'info',
            timestamp: new Date().toISOString()
          })
        }

        // 步骤1: 验证安装路径
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-log', {
            deploymentId,
            message: '正在验证安装路径...',
            type: 'info',
            timestamp: new Date().toISOString()
          })
          io.to(socketId).emit('online-deploy-progress', {
            deploymentId,
            percentage: 10,
            currentStep: '验证安装路径'
          })
        }

        // 确保安装目录存在
        await fs.mkdir(installPath, { recursive: true })
        
        // 步骤2: 获取游戏信息和下载链接
        if (deploymentProcess.status === 'cancelled') return
        
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-log', {
            deploymentId,
            message: '正在获取游戏下载信息...',
            type: 'info',
            timestamp: new Date().toISOString()
          })
          io.to(socketId).emit('online-deploy-progress', {
            deploymentId,
            percentage: 20,
            currentStep: '获取下载信息'
          })
        }

        // 重新获取游戏列表以获取下载链接
        const sponsorConfig = await configManager.getSponsorConfig()
        const currentPlatform = getCurrentPlatform()
        const systemName = currentPlatform === Platform.WINDOWS ? 'Windows' : 'Linux'
        
        const gameListResponse = await axios.post('http://api.gsm.xiaozhuhouses.asia:10002/api/online-games', {
          system: systemName,
          key: sponsorConfig.key
        })

        if (gameListResponse.data.status !== 'success') {
          throw new Error('无法获取游戏下载信息')
        }

        // 查找对应的游戏
        const gameData = gameListResponse.data.data || {}
        const gameEntry = Object.entries(gameData).find(([name]) => 
          name.toLowerCase().replace(/\s+/g, '-') === gameId
        ) as [string, { download?: string; [key: string]: any }] | undefined

        if (!gameEntry || !gameEntry[1].download) {
          throw new Error('未找到游戏下载链接')
        }

        const downloadUrl = gameEntry[1].download
        const gameName = gameEntry[0]
        
        // 步骤3: 下载游戏文件
        if (deploymentProcess.status === 'cancelled') return
        
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-log', {
            deploymentId,
            message: `正在下载 ${gameName}...`,
            type: 'info',
            timestamp: new Date().toISOString()
          })
        }

        const fileName = path.basename(downloadUrl) || `${gameId}.zip`
        const downloadPath = path.join(installPath, fileName)
        
        // 下载文件
        const response = await axios({
          method: 'GET',
          url: downloadUrl,
          responseType: 'stream',
          timeout: 300000 // 5分钟超时
        })

        const totalSize = parseInt(response.headers['content-length'] || '0')
        let downloadedSize = 0

        const writer = createWriteStream(downloadPath)
        
        response.data.on('data', (chunk: Buffer) => {
          if (deploymentProcess.status === 'cancelled') {
            response.data.destroy()
            writer.destroy()
            return
          }
          
          downloadedSize += chunk.length
          const percentage = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 50) + 20 : 30
          
          if (io && socketId) {
            io.to(socketId).emit('online-deploy-progress', {
              deploymentId,
              percentage,
              currentStep: `下载中... ${Math.round(downloadedSize / 1024 / 1024)}MB${totalSize > 0 ? `/${Math.round(totalSize / 1024 / 1024)}MB` : ''}`
            })
          }
        })

        await pipeline(response.data, writer)
        
        if (deploymentProcess.status === 'cancelled') {
          // 清理下载的文件
          try {
            await fs.unlink(downloadPath)
          } catch {}
          return
        }

        // 步骤4: 解压文件
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-log', {
            deploymentId,
            message: '正在解压游戏文件...',
            type: 'info',
            timestamp: new Date().toISOString()
          })
          io.to(socketId).emit('online-deploy-progress', {
            deploymentId,
            percentage: 80,
            currentStep: '解压文件'
          })
        }

        // 根据文件扩展名自动选择解压方法
        const ext = path.extname(downloadPath).toLowerCase()
        if (ext === '.7z') {
          await zipToolsManager.extract7z(downloadPath, installPath)
        } else {
          await zipToolsManager.extractZip(downloadPath, installPath)
        }
        
        // 删除下载的压缩文件
        await fs.unlink(downloadPath)
        
        if (deploymentProcess.status === 'cancelled') return

        // 步骤5: 完成部署
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-log', {
            deploymentId,
            message: '部署完成！',
            type: 'success',
            timestamp: new Date().toISOString()
          })
          io.to(socketId).emit('online-deploy-progress', {
            deploymentId,
            percentage: 100,
            currentStep: '部署完成'
          })
        }

        // 部署完成
        deploymentProcess.status = 'completed'
        
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-complete', {
            deploymentId,
            success: true,
            result: {
              installPath: installPath,
              gameId,
              gameName,
              message: `${gameName} 部署成功！`
            }
          })
        }

      } catch (error) {
        logger.error('在线游戏部署失败:', error)
        deploymentProcess.status = 'failed'
        
        if (io && socketId) {
          io.to(socketId).emit('online-deploy-complete', {
            deploymentId,
            success: false,
            error: error instanceof Error ? error.message : '部署失败'
          })
        }
      } finally {
        // 清理部署记录
        setTimeout(() => {
          activeDeployments.delete(deploymentId)
        }, 300000) // 5分钟后清理
      }
    })

    res.json({
      success: true,
      data: {
        deploymentId
      },
      message: '部署已开始'
    })

  } catch (error) {
    logger.error('启动在线游戏部署失败:', error)
    res.status(500).json({
      success: false,
      message: '启动部署失败'
    })
  }
})

// 取消部署
router.post('/cancel/:deploymentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deploymentId } = req.params
    
    const deployment = activeDeployments.get(deploymentId)
    if (!deployment) {
      return res.status(404).json({
        success: false,
        message: '部署任务不存在'
      })
    }

    // 标记为已取消
    deployment.status = 'cancelled'
    
    // 发送取消通知
    if (io) {
      io.emit('online-deploy-log', {
        deploymentId,
        message: '部署已被用户取消',
        type: 'warning',
        timestamp: new Date().toISOString()
      })
      
      io.emit('online-deploy-complete', {
        deploymentId,
        success: false,
        error: '部署已取消'
      })
    }
    
    // 延迟删除，给清理操作一些时间
    setTimeout(() => {
      activeDeployments.delete(deploymentId)
    }, 5000)

    res.json({
      success: true,
      message: '部署已取消'
    })

  } catch (error) {
    logger.error('取消在线游戏部署失败:', error)
    res.status(500).json({
      success: false,
      message: '取消部署失败'
    })
  }
})

// 获取活动部署列表
router.get('/deployments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const deployments = Array.from(activeDeployments.values())
    res.json({
      success: true,
      data: deployments
    })
  } catch (error) {
    logger.error('获取活动部署列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取部署列表失败'
    })
  }
})

export default router