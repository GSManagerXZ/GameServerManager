import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import type { InstanceManager } from '../modules/instance/InstanceManager.js'
import type { SystemManager } from '../modules/system/SystemManager.js'
import type { TerminalManager } from '../modules/terminal/TerminalManager.js'
import type { GameManager } from '../modules/game/GameManager.js'
import filesRouter from './files.js'
import { setupTerminalRoutes } from './terminal.js'
import logger from '../utils/logger.js'

const router = Router()

// 依赖注入
let instanceManager: InstanceManager
let systemManager: SystemManager
let terminalManager: TerminalManager
let gameManager: GameManager

export function setPluginApiDependencies(
  instManager: InstanceManager,
  sysManager: SystemManager,
  termManager: TerminalManager,
  gmManager: GameManager
) {
  instanceManager = instManager
  systemManager = sysManager
  terminalManager = termManager
  gameManager = gmManager
}

// 插件API代理中间件
const pluginApiProxy = (req: Request, res: Response, next: any) => {
  // 验证请求来源是否为插件
  const isPluginRequest = req.get('X-Plugin-Request') === 'true'
  
  if (!isPluginRequest) {
    // 为了兼容开发环境，我们允许来自 about:srcdoc 的请求
    const referer = req.get('Referer')
    if (process.env.NODE_ENV === 'development' && referer === 'about:srcdoc') {
      return next()
    }

    return res.status(403).json({
      success: false,
      message: '仅允许插件调用此API'
    })
  }
  
  next()
}

// 应用插件API代理中间件
router.use(pluginApiProxy)
router.use(authenticateToken)

// ==================== 系统信息API ====================

// 获取系统状态
router.get('/system/status', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(503).json({
        success: false,
        message: '系统管理器未初始化'
      })
    }

    const status = await systemManager.getSystemInfo()
    res.json({
      success: true,
      data: status
    })
  } catch (error) {
    logger.error('插件获取系统状态失败:', error)
    res.status(500).json({
      success: false,
      message: '获取系统状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取系统信息
router.get('/system/info', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(503).json({
        success: false,
        message: '系统管理器未初始化'
      })
    }

    const info = await systemManager.getSystemInfo()
    res.json({
      success: true,
      data: info
    })
  } catch (error) {
    logger.error('插件获取系统信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取系统信息失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// ==================== 实例管理API ====================

// 获取实例列表
router.get('/instances', async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instances = instanceManager.getInstances()
    res.json({
      success: true,
      data: instances
    })
  } catch (error) {
    logger.error('插件获取实例列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取实例列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取单个实例信息
router.get('/instances/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    res.json({
      success: true,
      data: instance
    })
  } catch (error) {
    logger.error('插件获取实例信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取实例信息失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取实例状态
router.get('/instances/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const status = await instanceManager.getInstanceStatus(id)
    res.json({
      success: true,
      data: status
    })
  } catch (error) {
    logger.error('插件获取实例状态失败:', error)
    res.status(500).json({
      success: false,
      message: '获取实例状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取市场实例列表
router.get('/instances/market', async (req: Request, res: Response) => {
  try {
    const os = await import('os')
    const http = await import('http')
    
    // 确定系统类型
    const platform = os.platform()
    let systemType = 'Linux'
    if (platform === 'win32') {
      systemType = 'Windows'
    }
    
    // 请求第二个服务获取实例市场数据
    const marketUrl = `http://api.gsm.xiaozhuhouses.asia:10002/api/instances?system_type=${systemType}`
    
    logger.info(`插件请求实例市场数据: ${marketUrl}`)
    
    // 使用Promise包装http请求
    const marketData = await new Promise((resolve, reject) => {
      const url = new URL(marketUrl)
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GSM3-Plugin-API/1.0'
        }
      }
      
      const req = http.request(options, (response) => {
        let data = ''
        
        response.on('data', (chunk) => {
          data += chunk
        })
        
        response.on('end', () => {
           try {
             if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
               const jsonData = JSON.parse(data)
               resolve(jsonData)
             } else {
               logger.error(`插件API请求失败 - 状态码: ${response.statusCode}, 响应内容: ${data}`)
               reject(new Error(`HTTP error! status: ${response.statusCode}, response: ${data}`))
             }
           } catch (parseError) {
             logger.error(`插件JSON解析失败: ${parseError}, 原始数据: ${data}`)
             reject(new Error(`JSON parse error: ${parseError}`))
           }
         })
      })
      
      req.on('error', (error) => {
        reject(error)
      })
      
      req.setTimeout(10000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
      
      req.end()
    })
    
    res.json({
      success: true,
      data: marketData
    })
  } catch (error) {
    logger.error('插件获取市场实例列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取市场实例列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 创建实例
router.post('/instances', async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const { name, description, workingDirectory, startCommand, stopCommand, autoStart } = req.body

    // 验证必填字段
    if (!name || !workingDirectory || !startCommand) {
      return res.status(400).json({
        success: false,
        message: '缺少必填字段: name, workingDirectory, startCommand'
      })
    }

    // 验证停止命令
    const validStopCommands = ['ctrl+c', 'stop', 'quit', 'exit']
    if (stopCommand && !validStopCommands.includes(stopCommand)) {
      return res.status(400).json({
        success: false,
        message: `无效的停止命令。支持的命令: ${validStopCommands.join(', ')}`
      })
    }

    const instanceData = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: startCommand.trim(),
      stopCommand: stopCommand || 'ctrl+c',
      autoStart: autoStart || false
    }

    const result = await instanceManager.createInstance(instanceData)
    res.status(201).json({
      success: true,
      data: result,
      message: '实例创建成功'
    })
  } catch (error) {
    logger.error('插件创建实例失败:', error)
    res.status(500).json({
      success: false,
      message: '创建实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 更新实例
router.put('/instances/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const { name, description, workingDirectory, startCommand, stopCommand, autoStart } = req.body

    // 验证必填字段
    if (!name || !workingDirectory || !startCommand) {
      return res.status(400).json({
        success: false,
        message: '缺少必填字段: name, workingDirectory, startCommand'
      })
    }

    // 验证停止命令
    const validStopCommands = ['ctrl+c', 'stop', 'quit', 'exit']
    if (stopCommand && !validStopCommands.includes(stopCommand)) {
      return res.status(400).json({
        success: false,
        message: `无效的停止命令。支持的命令: ${validStopCommands.join(', ')}`
      })
    }

    const instanceData = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: startCommand.trim(),
      stopCommand: stopCommand || 'ctrl+c',
      autoStart: autoStart || false
    }

    const result = await instanceManager.updateInstance(id, instanceData)
    res.json({
      success: true,
      data: result,
      message: '实例更新成功'
    })
  } catch (error) {
    logger.error('插件更新实例失败:', error)
    res.status(500).json({
      success: false,
      message: '更新实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 删除实例
router.delete('/instances/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    await instanceManager.deleteInstance(id)
    res.json({
      success: true,
      message: '实例删除成功'
    })
  } catch (error) {
    logger.error('插件删除实例失败:', error)
    res.status(500).json({
      success: false,
      message: '删除实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 启动实例
router.post('/instances/:id/start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const result = await instanceManager.startInstance(id)
    res.json({
      success: true,
      data: result,
      message: '实例启动成功'
    })
  } catch (error) {
    logger.error('插件启动实例失败:', error)
    res.status(500).json({
      success: false,
      message: '启动实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 停止实例
router.post('/instances/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const result = await instanceManager.stopInstance(id)
    res.json({
      success: true,
      data: result,
      message: '实例停止成功'
    })
  } catch (error) {
    logger.error('插件停止实例失败:', error)
    res.status(500).json({
      success: false,
      message: '停止实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 重启实例
router.post('/instances/:id/restart', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const result = await instanceManager.restartInstance(id)
    res.json({
      success: true,
      data: result,
      message: '实例重启成功'
    })
  } catch (error) {
    logger.error('插件重启实例失败:', error)
    res.status(500).json({
      success: false,
      message: '重启实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// ==================== 终端管理API ====================

// 转发终端操作请求到terminal路由
const terminalRouter = setupTerminalRoutes(terminalManager)
router.use('/terminals', terminalRouter)

// ==================== 游戏管理API ====================

// 获取游戏列表
router.get('/games', async (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(503).json({
        success: false,
        message: '游戏管理器未初始化'
      })
    }

    const games = gameManager.getGames()
    res.json({
      success: true,
      data: games
    })
  } catch (error) {
    logger.error('插件获取游戏列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取游戏列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// ==================== 文件操作API ====================

// 转发文件操作请求到files路由
router.use('/files', filesRouter)

// ==================== 通用API ====================

// 获取API版本信息
router.get('/version', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      version: '1.0.0',
      apiVersion: 'v1',
      pluginApiVersion: '1.0.0',
      timestamp: new Date().toISOString()
    }
  })
})

// 健康检查
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  })
})

export default router