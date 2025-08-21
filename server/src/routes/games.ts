import { Router, Request, Response } from 'express'
import { GameManager } from '../modules/game/GameManager.js'
import logger from '../utils/logger.js'
import Joi from 'joi'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const router = Router()

// 注意：这里需要在实际使用时注入GameManager实例
let gameManager: GameManager

// 设置GameManager实例的函数
export function setGameManager(manager: GameManager) {
  gameManager = manager
}

// 游戏配置验证模式
const gameConfigSchema = Joi.object({
  name: Joi.string().required().min(1).max(100),
  type: Joi.string().valid('minecraft', 'terraria', 'custom').required(),
  executable: Joi.string().required(),
  args: Joi.array().items(Joi.string()),
  workingDirectory: Joi.string().required(),
  autoStart: Joi.boolean().default(false),
  autoRestart: Joi.boolean().default(false),
  maxMemory: Joi.string().optional(),
  minMemory: Joi.string().optional(),
  javaPath: Joi.string().optional(),
  port: Joi.number().integer().min(1).max(65535).optional(),
  maxPlayers: Joi.number().integer().min(1).optional(),
  description: Joi.string().max(500).optional(),
  icon: Joi.string().optional()
})

// 获取游戏模板列表
router.get('/templates', (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const templates = gameManager.getTemplates()
    res.json({
      success: true,
      data: templates
    })
  } catch (error) {
    logger.error('获取游戏模板失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取模板失败'
    })
  }
})

// 获取游戏列表
router.get('/', (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const games = gameManager.getGames()
    res.json({
      success: true,
      data: games
    })
  } catch (error) {
    logger.error('获取游戏列表失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取游戏列表失败'
    })
  }
})

// 创建新游戏
router.post('/', async (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    // 验证请求数据
    const { error, value } = gameConfigSchema.validate(req.body)
    if (error) {
      return res.status(400).json({
        success: false,
        error: '配置验证失败',
        details: error.details.map(d => d.message)
      })
    }
    
    // 创建游戏（这里需要模拟socket）
    const mockSocket = {
      emit: (event: string, data: any) => {
        logger.info(`Socket事件: ${event}`, data)
      }
    } as any
    
    await gameManager.createGame(mockSocket, value)
    
    res.json({
      success: true,
      message: '游戏创建成功'
    })
  } catch (error) {
    logger.error('创建游戏失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '创建游戏失败'
    })
  }
})

// 获取单个游戏信息
router.get('/:gameId', (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const { gameId } = req.params
    const games = gameManager.getGames()
    const game = games.find(g => g.id === gameId)
    
    if (!game) {
      return res.status(404).json({
        success: false,
        error: '游戏不存在'
      })
    }
    
    res.json({
      success: true,
      data: game
    })
  } catch (error) {
    logger.error('获取游戏信息失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取游戏信息失败'
    })
  }
})

// 启动游戏
router.post('/:gameId/start', async (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const { gameId } = req.params
    
    const mockSocket = {
      emit: (event: string, data: any) => {
        logger.info(`Socket事件: ${event}`, data)
      }
    } as any
    
    await gameManager.startGame(mockSocket, gameId)
    
    res.json({
      success: true,
      message: '游戏启动命令已发送'
    })
  } catch (error) {
    logger.error('启动游戏失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '启动游戏失败'
    })
  }
})

// 停止游戏
router.post('/:gameId/stop', async (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const { gameId } = req.params
    
    const mockSocket = {
      emit: (event: string, data: any) => {
        logger.info(`Socket事件: ${event}`, data)
      }
    } as any
    
    await gameManager.stopGame(mockSocket, gameId)
    
    res.json({
      success: true,
      message: '游戏停止命令已发送'
    })
  } catch (error) {
    logger.error('停止游戏失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '停止游戏失败'
    })
  }
})

// 重启游戏
router.post('/:gameId/restart', async (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const { gameId } = req.params
    
    const mockSocket = {
      emit: (event: string, data: any) => {
        logger.info(`Socket事件: ${event}`, data)
      }
    } as any
    
    await gameManager.restartGame(mockSocket, gameId)
    
    res.json({
      success: true,
      message: '游戏重启命令已发送'
    })
  } catch (error) {
    logger.error('重启游戏失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '重启游戏失败'
    })
  }
})

// 发送游戏命令
router.post('/:gameId/command', (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const { gameId } = req.params
    const { command } = req.body
    
    if (!command || typeof command !== 'string') {
      return res.status(400).json({
        success: false,
        error: '命令不能为空'
      })
    }
    
    const mockSocket = {
      emit: (event: string, data: any) => {
        logger.info(`Socket事件: ${event}`, data)
      }
    } as any
    
    gameManager.sendCommand(mockSocket, gameId, command)
    
    res.json({
      success: true,
      message: '命令已发送'
    })
  } catch (error) {
    logger.error('发送游戏命令失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '发送命令失败'
    })
  }
})

// 删除游戏
router.delete('/:gameId', async (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(500).json({ error: '游戏管理器未初始化' })
    }
    
    const { gameId } = req.params
    
    const mockSocket = {
      emit: (event: string, data: any) => {
        logger.info(`Socket事件: ${event}`, data)
      }
    } as any
    
    await gameManager.deleteGame(mockSocket, gameId)
    
    res.json({
      success: true,
      message: '游戏删除成功'
    })
  } catch (error) {
    logger.error('删除游戏失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '删除游戏失败'
    })
  }
})

// 验证游戏配置
router.post('/validate', (req: Request, res: Response) => {
  try {
    const { error, value } = gameConfigSchema.validate(req.body)
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: '配置验证失败',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      })
    }
    
    res.json({
      success: true,
      message: '配置验证通过',
      data: value
    })
  } catch (error) {
    logger.error('验证游戏配置失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '配置验证失败'
    })
  }
})

// 获取游戏类型的默认配置
router.get('/types/:type/defaults', (req: Request, res: Response) => {
  try {
    const { type } = req.params
    
    const defaults: { [key: string]: any } = {
      minecraft: {
        executable: 'java',
        args: ['-Xmx2G', '-Xms1G', '-jar', 'server.jar', 'nogui'],
        port: 25565,
        maxPlayers: 20,
        maxMemory: '2G',
        minMemory: '1G'
      },
      terraria: {
        executable: 'TerrariaServer.exe',
        args: ['-server', '-world', 'world.wld'],
        port: 7777,
        maxPlayers: 8
      },
      custom: {
        executable: '',
        args: [],
        port: 25565,
        maxPlayers: 10
      }
    }
    
    const defaultConfig = defaults[type]
    if (!defaultConfig) {
      return res.status(404).json({
        success: false,
        error: '不支持的游戏类型'
      })
    }
    
    res.json({
      success: true,
      data: defaultConfig
    })
  } catch (error) {
    logger.error('获取默认配置失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取默认配置失败'
    })
  }
})

// 获取支持的游戏类型
router.get('/types', (req: Request, res: Response) => {
  try {
    const types = [
      {
        id: 'minecraft',
        name: 'Minecraft',
        description: 'Minecraft 服务器',
        icon: '🎮',
        requiresJava: true,
        defaultPort: 25565
      },
      {
        id: 'terraria',
        name: 'Terraria',
        description: 'Terraria 专用服务器',
        icon: '🌍',
        requiresJava: false,
        defaultPort: 7777
      },
      {
        id: 'custom',
        name: '自定义',
        description: '自定义游戏服务器',
        icon: '🔧',
        requiresJava: false,
        defaultPort: 25565
      }
    ]
    
    res.json({
      success: true,
      data: types
    })
  } catch (error) {
    logger.error('获取游戏类型失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取游戏类型失败'
    })
  }
})

// 检查Java环境
router.get('/java/check', async (req: Request, res: Response) => {
  try {
    try {
      const { stdout, stderr } = await execAsync('java -version')
      // Java版本信息通常输出到stderr
      const output = stderr || stdout
      const versionMatch = output.match(/version "([^"]+)"/) || output.match(/openjdk version "([^"]+)"/)
      const version = versionMatch ? versionMatch[1] : 'Unknown'
      
      res.json({
        success: true,
        data: {
          installed: true,
          version,
          path: process.env.JAVA_HOME || 'java'
        }
      })
    } catch (error) {
      res.json({
        success: true,
        data: {
          installed: false,
          version: null,
          path: null,
          error: 'Java未安装或不在PATH中'
        }
      })
    }
  } catch (error) {
    logger.error('检查Java环境失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '检查Java环境失败'
    })
  }
})

// 设置路由的函数
export function setupGameRoutes(manager: GameManager) {
  setGameManager(manager)
  return router
}

export default router