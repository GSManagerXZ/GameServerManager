import { Router, Request, Response } from 'express'
import { Instance, InstanceManager } from '../modules/instance/InstanceManager.js'
import { authenticateExternalApiKey } from '../middleware/auth.js'
import logger from '../utils/logger.js'

const router = Router()

let instanceManager: InstanceManager

type InstanceAction = 'start' | 'stop' | 'restart'

interface ActionResult {
  message: string
  terminalSessionId?: string
}

export function setupExternalApiRoutes(manager: InstanceManager) {
  instanceManager = manager
  return router
}

function serializeInstance(instance: Instance) {
  return {
    id: instance.id,
    name: instance.name,
    description: instance.description,
    status: instance.status,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    autoStart: instance.autoStart,
    stopCommand: instance.stopCommand,
    terminalSessionId: instance.terminalSessionId,
    lastStarted: instance.lastStarted,
    lastStopped: instance.lastStopped,
    instanceType: instance.instanceType,
    javaVersion: instance.javaVersion
  }
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1
}

function isIdempotentRequest(req: Request): boolean {
  return parseBoolean(req.query.idempotent) || parseBoolean(req.body?.idempotent)
}

function getErrorStatusCode(error: any): number {
  const message = String(error?.message || '')
  if (message.includes('不存在')) {
    return 404
  }

  if (
    message.includes('已在运行') ||
    message.includes('正在启动') ||
    message.includes('未在运行') ||
    message.includes('终端会话ID不存在')
  ) {
    return 409
  }

  return 500
}

function sendActionSuccess(res: Response, instance: Instance, result: ActionResult) {
  return res.json({
    success: true,
    message: result.message,
    data: {
      instance: serializeInstance(instance),
      terminalSessionId: result.terminalSessionId
    }
  })
}

async function runInstanceAction(req: Request, res: Response, action: InstanceAction) {
  if (!instanceManager) {
    return res.status(500).json({
      success: false,
      error: '实例管理器未初始化'
    })
  }

  const { id } = req.params
  const instance = instanceManager.getInstance(id)
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: '实例不存在',
      message: `实例不存在: ${id}`
    })
  }

  const idempotent = isIdempotentRequest(req)

  try {
    if (action === 'start') {
      if (idempotent && (instance.status === 'running' || instance.status === 'starting')) {
        return sendActionSuccess(res, instance, {
          message: instance.status === 'running' ? '实例已在运行' : '实例正在启动中',
          terminalSessionId: instance.terminalSessionId
        })
      }

      const result = await instanceManager.startInstance(id)
      logger.info(`外部API启动实例: ${id}`)
      return sendActionSuccess(res, instance, {
        message: '实例启动成功',
        terminalSessionId: result.terminalSessionId
      })
    }

    if (action === 'stop') {
      if (idempotent && (instance.status === 'stopped' || instance.status === 'error')) {
        return sendActionSuccess(res, instance, {
          message: instance.status === 'stopped' ? '实例已停止' : '实例处于错误状态'
        })
      }

      await instanceManager.stopInstance(id)
      logger.info(`外部API停止实例: ${id}`)
      return sendActionSuccess(res, instance, {
        message: '实例停止成功'
      })
    }

    const result = await instanceManager.restartInstance(id)
    logger.info(`外部API重启实例: ${id}`)
    return sendActionSuccess(res, instance, {
      message: '实例重启成功',
      terminalSessionId: result.terminalSessionId
    })
  } catch (error: any) {
    logger.error(`外部API执行实例操作失败: action=${action}, id=${id}`, error)
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      error: '实例操作失败',
      message: error.message
    })
  }
}

router.use(authenticateExternalApiKey)

router.get('/instances', (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({
        success: false,
        error: '实例管理器未初始化'
      })
    }

    res.json({
      success: true,
      data: instanceManager.getInstances().map(serializeInstance)
    })
  } catch (error: any) {
    logger.error('外部API获取实例列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例列表失败',
      message: error.message
    })
  }
})

router.get('/instances/:id', (req: Request, res: Response) => {
  const instance = instanceManager?.getInstance(req.params.id)
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: '实例不存在'
    })
  }

  res.json({
    success: true,
    data: serializeInstance(instance)
  })
})

router.get('/instances/:id/status', (req: Request, res: Response) => {
  const instance = instanceManager?.getInstance(req.params.id)
  if (!instance) {
    return res.status(404).json({
      success: false,
      error: '实例不存在'
    })
  }

  res.json({
    success: true,
    data: {
      id: instance.id,
      name: instance.name,
      status: instance.status,
      pid: instance.pid,
      terminalSessionId: instance.terminalSessionId,
      lastStarted: instance.lastStarted,
      lastStopped: instance.lastStopped
    }
  })
})

router.post('/instances/:id/start', (req: Request, res: Response) => {
  runInstanceAction(req, res, 'start')
})

router.post('/instances/:id/stop', (req: Request, res: Response) => {
  runInstanceAction(req, res, 'stop')
})

router.post('/instances/:id/restart', (req: Request, res: Response) => {
  runInstanceAction(req, res, 'restart')
})

router.post('/instances/:id/action', (req: Request, res: Response) => {
  const action = String(req.body?.action || '').toLowerCase() as InstanceAction
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({
      success: false,
      error: '无效操作',
      message: 'action 必须是 start、stop 或 restart'
    })
  }

  runInstanceAction(req, res, action)
})

export default router
