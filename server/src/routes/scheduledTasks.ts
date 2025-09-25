import { Router, Response } from 'express'
import { SchedulerManager } from '../modules/scheduler/SchedulerManager.js'
import logger from '../utils/logger.js'
import Joi from 'joi'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// 注意：这里需要在实际使用时注入SchedulerManager实例
let schedulerManager: SchedulerManager

// 设置SchedulerManager实例的函数
export function setSchedulerManager(manager: SchedulerManager) {
  schedulerManager = manager
}

// 定时任务验证模式
const taskSchema = Joi.object({
  name: Joi.string().required().min(1).max(100),
  type: Joi.string().valid('power', 'command', 'backup').required(),
  instanceId: Joi.alternatives().conditional('type', {
    is: Joi.valid('power', 'command'),
    then: Joi.string().required(),
    otherwise: Joi.when('checkInstanceRunning', {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional()
    })
  }),
  instanceName: Joi.string().optional(),
  action: Joi.string().valid('start', 'stop', 'restart').when('type', {
    is: 'power',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  command: Joi.when('type', {
    is: 'command',
    then: Joi.string().required().min(1),
    otherwise: Joi.string().allow('').optional()
  }),
  // 备份参数
  backupSourcePath: Joi.when('type', {
    is: 'backup',
    then: Joi.string().required(),
    otherwise: Joi.string().optional()
  }),
  backupName: Joi.when('type', {
    is: 'backup',
    then: Joi.string().required(),
    otherwise: Joi.string().optional()
  }),
  maxKeep: Joi.when('type', {
    is: 'backup',
    then: Joi.number().integer().min(0).default(0),
    otherwise: Joi.number().integer().optional()
  }),
  checkInstanceRunning: Joi.when('type', {
    is: 'backup',
    then: Joi.boolean().default(false),
    otherwise: Joi.boolean().optional()
  }),
  schedule: Joi.string().required().min(1),
  enabled: Joi.boolean().default(true)
})

const updateTaskSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  type: Joi.string().valid('power', 'command', 'backup').optional(),
  // 修正：更新时的 instanceId 类型为可选字符串，并与“备份+checkInstanceRunning”联动
  instanceId: Joi.alternatives().conditional('type', {
    is: Joi.valid('power', 'command'),
    then: Joi.string().optional(),
    otherwise: Joi.when('checkInstanceRunning', {
      is: true,
      then: Joi.string().required(),
      otherwise: Joi.string().optional()
    })
  }),
  instanceName: Joi.string().optional(),
  action: Joi.string().valid('start', 'stop', 'restart').optional(),
  command: Joi.when('type', {
    is: 'command',
    then: Joi.string().required().min(1),
    otherwise: Joi.string().allow('').optional()
  }),
  backupSourcePath: Joi.string().optional(),
  backupName: Joi.string().optional(),
  maxKeep: Joi.number().integer().min(0).optional(),
  checkInstanceRunning: Joi.boolean().optional(),
  schedule: Joi.string().min(1).optional(),
  enabled: Joi.boolean().optional()
})

// 中间件：检查SchedulerManager是否已设置
const checkSchedulerManager = (req: AuthenticatedRequest, res: Response, next: any) => {
  if (!schedulerManager) {
    return res.status(500).json({
      success: false,
      message: 'SchedulerManager未初始化'
    })
  }
  next()
}

// 应用认证中间件到所有路由
router.use(authenticateToken)
router.use(checkSchedulerManager)

// 获取所有定时任务
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tasks = schedulerManager.getTasks()
    
    res.json({
      success: true,
      data: tasks
    })
  } catch (error: any) {
    logger.error('获取定时任务列表失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '获取定时任务列表失败'
    })
  }
})

// 获取单个定时任务
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const task = schedulerManager.getTask(id)
    
    if (!task) {
      return res.status(404).json({
        success: false,
        message: '定时任务不存在'
      })
    }
    
    res.json({
      success: true,
      data: task
    })
  } catch (error: any) {
    logger.error('获取定时任务失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '获取定时任务失败'
    })
  }
})

// 创建定时任务
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = taskSchema.validate(req.body)
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        details: error.details.map(d => d.message)
      })
    }
    
    const task = await schedulerManager.createTask(value)
    
    logger.info(`用户 ${req.user?.username} 创建了定时任务: ${task.name}`)
    
    res.status(201).json({
      success: true,
      data: task,
      message: '定时任务创建成功'
    })
  } catch (error: any) {
    logger.error('创建定时任务失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '创建定时任务失败'
    })
  }
})

// 更新定时任务
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const { error, value } = updateTaskSchema.validate(req.body)
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        details: error.details.map(d => d.message)
      })
    }
    
    const task = await schedulerManager.updateTask(id, value)
    
    logger.info(`用户 ${req.user?.username} 更新了定时任务: ${task.name}`)
    
    res.json({
      success: true,
      data: task,
      message: '定时任务更新成功'
    })
  } catch (error: any) {
    logger.error('更新定时任务失败:', error)
    
    if (error.message === '定时任务不存在') {
      return res.status(404).json({
        success: false,
        message: error.message
      })
    }
    
    res.status(500).json({
      success: false,
      message: error.message || '更新定时任务失败'
    })
  }
})

// 删除定时任务
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    
    await schedulerManager.deleteTask(id)
    
    logger.info(`用户 ${req.user?.username} 删除了定时任务: ${id}`)
    
    res.json({
      success: true,
      message: '定时任务删除成功'
    })
  } catch (error: any) {
    logger.error('删除定时任务失败:', error)
    
    if (error.message === '定时任务不存在') {
      return res.status(404).json({
        success: false,
        message: error.message
      })
    }
    
    res.status(500).json({
      success: false,
      message: error.message || '删除定时任务失败'
    })
  }
})

// 切换定时任务启用状态
router.patch('/:id/toggle', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const { enabled } = req.body
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled参数必须是布尔值'
      })
    }
    
    const task = await schedulerManager.toggleTask(id, enabled)
    
    logger.info(`用户 ${req.user?.username} ${enabled ? '启用' : '禁用'}了定时任务: ${task.name}`)
    
    res.json({
      success: true,
      data: task,
      message: `定时任务已${enabled ? '启用' : '禁用'}`
    })
  } catch (error: any) {
    logger.error('切换定时任务状态失败:', error)
    
    if (error.message === '定时任务不存在') {
      return res.status(404).json({
        success: false,
        message: error.message
      })
    }
    
    res.status(500).json({
      success: false,
      message: error.message || '切换定时任务状态失败'
    })
  }
})

// 导出路由设置函数
export function setupScheduledTaskRoutes(manager: SchedulerManager) {
  setSchedulerManager(manager)
  return router
}

export default router