import { Router, Request, Response } from 'express'
import { InstanceManager } from '../modules/instance/InstanceManager.js'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'
import PythonManager from '../utils/pythonManager.js'
import os from 'os'
import https from 'https'
import http from 'http'

const router = Router()

// 注意：这里需要在实际使用时注入InstanceManager实例
let instanceManager: InstanceManager

// 设置InstanceManager实例的函数
export function setInstanceManager(manager: InstanceManager) {
  instanceManager = manager
}

// 获取所有实例
router.get('/', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const instances = instanceManager.getInstances()
    res.json({
      success: true,
      data: instances
    })
  } catch (error: any) {
    logger.error('获取实例列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例列表失败',
      message: error.message
    })
  }
})

// 获取实例市场列表
router.get('/market', authenticateToken, async (req: Request, res: Response) => {
  try {
    // 确定系统类型
    const platform = os.platform()
    let systemType = 'Linux'
    if (platform === 'win32') {
      systemType = 'Windows'
    }
    
    // 请求第二个服务获取实例市场数据
    const marketUrl = `http://api.gsm.xiaozhuhouses.asia:10002/api/instances?system_type=${systemType}`
    
    logger.info(`请求实例市场数据: ${marketUrl}`)
    
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
          'User-Agent': 'GSM3-Server/1.0'
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
               logger.error(`API请求失败 - 状态码: ${response.statusCode}, 响应内容: ${data}`)
               reject(new Error(`HTTP error! status: ${response.statusCode}, response: ${data}`))
             }
           } catch (parseError) {
             logger.error(`JSON解析失败: ${parseError}, 原始数据: ${data}`)
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
  } catch (error: any) {
    logger.error('获取实例市场列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例市场列表失败',
      message: error.message
    })
  }
})

// 获取单个实例
router.get('/:id', authenticateToken, (req: Request, res: Response) => {
  try {
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
        error: '实例不存在'
      })
    }
    
    res.json({
      success: true,
      data: instance
    })
  } catch (error: any) {
    logger.error('获取实例失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例失败',
      message: error.message
    })
  }
})

// 创建实例
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { name, description, workingDirectory, startCommand, autoStart, stopCommand, enableStreamForward, programPath, terminalUser, instanceType, javaVersion } = req.body
    
    // 根据实例类型设置默认值
    const actualInstanceType = instanceType || 'generic'
    let actualStartCommand = startCommand?.trim() || ''
    let actualStopCommand = stopCommand || 'ctrl+c'
    
    // 我的世界基岩版 - 根据平台设置启动命令
    if (actualInstanceType === 'minecraft-bedrock') {
      const platform = os.platform()
      if (platform === 'win32') {
        actualStartCommand = '.\\bedrock_server.exe'
      } else {
        actualStartCommand = './bedrock_server'
      }
      actualStopCommand = 'stop'
    }
    
    // 我的世界Java版 - 启动命令会在启动时动态生成
    if (actualInstanceType === 'minecraft-java') {
      actualStartCommand = 'echo Minecraft Java Edition'  // 占位符，启动时会被替换为实际命令
      actualStopCommand = 'stop'
    }
    
    // 验证必填字段
    if (!name || !workingDirectory) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '实例名称和工作目录为必填项'
      })
    }
    
    // 通用类型需要启动命令
    if (actualInstanceType === 'generic' && !actualStartCommand) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '启动命令为必填项'
      })
    }
    
    // 验证停止命令
    if (actualStopCommand && !['ctrl+c', 'stop', 'exit', 'quit'].includes(actualStopCommand)) {
      return res.status(400).json({
        success: false,
        error: '无效的停止命令',
        message: '停止命令必须是 ctrl+c、stop、exit 或 quit 之一'
      })
    }
    
    const instanceData: any = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: actualStartCommand,
      autoStart: Boolean(autoStart),
      stopCommand: actualStopCommand,
      enableStreamForward: Boolean(enableStreamForward),
      programPath: programPath?.trim() || '',
      instanceType: actualInstanceType,
      javaVersion: javaVersion?.trim() || undefined
    }
    // 处理terminalUser字段：如果是空字符串则设为空字符串，如果有值则设置值
    if (typeof terminalUser === 'string') {
      instanceData.terminalUser = terminalUser.trim()
    }
    
    const instance = await instanceManager.createInstance(instanceData)
    
    logger.info(`用户创建实例: ${instance.name}, 类型: ${actualInstanceType}`)
    
    res.status(201).json({
      success: true,
      data: instance,
      message: '实例创建成功'
    })
  } catch (error: any) {
    logger.error('创建实例失败:', error)
    res.status(500).json({
      success: false,
      error: '创建实例失败',
      message: error.message
    })
  }
})

// 更新实例
router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const { name, description, workingDirectory, startCommand, autoStart, stopCommand, enableStreamForward, programPath, terminalUser, instanceType, javaVersion } = req.body
    
    // 根据实例类型设置默认值
    const actualInstanceType = instanceType || 'generic'
    let actualStartCommand = startCommand?.trim() || ''
    let actualStopCommand = stopCommand || 'ctrl+c'
    
    // 我的世界基岩版 - 根据平台设置启动命令
    if (actualInstanceType === 'minecraft-bedrock') {
      const platform = os.platform()
      if (platform === 'win32') {
        actualStartCommand = '.\\bedrock_server.exe'
      } else {
        actualStartCommand = './bedrock_server'
      }
      actualStopCommand = 'stop'
    }
    
    // 我的世界Java版 - 启动命令会在启动时动态生成
    if (actualInstanceType === 'minecraft-java') {
      actualStartCommand = 'echo Minecraft Java Edition'  // 占位符，启动时会被替换为实际命令
      actualStopCommand = 'stop'
    }
    
    // 验证必填字段
    if (!name || !workingDirectory) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '实例名称和工作目录为必填项'
      })
    }
    
    // 通用类型需要启动命令
    if (actualInstanceType === 'generic' && !actualStartCommand) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '启动命令为必填项'
      })
    }
    
    // 验证停止命令
    if (actualStopCommand && !['ctrl+c', 'stop', 'exit', 'quit'].includes(actualStopCommand)) {
      return res.status(400).json({
        success: false,
        error: '无效的停止命令',
        message: '停止命令必须是 ctrl+c、stop、exit 或 quit 之一'
      })
    }
    
    const instanceData: any = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: actualStartCommand,
      autoStart: Boolean(autoStart),
      stopCommand: actualStopCommand,
      enableStreamForward: Boolean(enableStreamForward),
      programPath: programPath?.trim() || '',
      instanceType: actualInstanceType,
      javaVersion: javaVersion?.trim() || undefined
    }
    // 处理terminalUser字段：如果是空字符串则设为空字符串，如果有值则设置值
    if (typeof terminalUser === 'string') {
      instanceData.terminalUser = terminalUser.trim()
    }
    
    const instance = await instanceManager.updateInstance(id, instanceData)
    
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    logger.info(`用户更新实例: ${instance.name}`)
    
    res.json({
      success: true,
      data: instance,
      message: '实例更新成功'
    })
  } catch (error: any) {
    logger.error('更新实例失败:', error)
    
    if (error.message === '无法修改正在运行的实例配置') {
      return res.status(400).json({
        success: false,
        error: '无法修改正在运行的实例配置',
        message: '请先停止实例再进行修改'
      })
    }
    
    res.status(500).json({
      success: false,
      error: '更新实例失败',
      message: error.message
    })
  }
})

// 删除实例
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const success = await instanceManager.deleteInstance(id)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    logger.info(`用户删除实例: ${id}`)
    
    res.json({
      success: true,
      message: '实例删除成功'
    })
  } catch (error: any) {
    logger.error('删除实例失败:', error)
    res.status(500).json({
      success: false,
      error: '删除实例失败',
      message: error.message
    })
  }
})

// 启动实例
router.post('/:id/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const result = await instanceManager.startInstance(id)
    
    logger.info(`用户启动实例: ${id}`)
    
    res.json({
      success: true,
      message: '实例启动成功',
      data: {
        terminalSessionId: result.terminalSessionId
      }
    })
  } catch (error: any) {
    logger.error('启动实例失败:', error)
    
    let statusCode = 500
    if (error.message.includes('不存在') || error.message.includes('已在运行') || error.message.includes('正在启动')) {
      statusCode = 400
    }
    
    res.status(statusCode).json({
      success: false,
      error: '启动实例失败',
      message: error.message
    })
  }
})

// 停止实例
router.post('/:id/stop', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    await instanceManager.stopInstance(id)
    
    logger.info(`用户停止实例: ${id}`)
    
    res.json({
      success: true,
      message: '实例停止成功'
    })
  } catch (error: any) {
    logger.error('停止实例失败:', error)
    
    let statusCode = 500
    if (error.message.includes('不存在') || error.message.includes('未在运行')) {
      statusCode = 400
    }
    
    res.status(statusCode).json({
      success: false,
      error: '停止实例失败',
      message: error.message
    })
  }
})

// 关闭终端
router.post('/:id/close-terminal', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    await instanceManager.closeTerminal(id)
    
    logger.info(`用户关闭实例终端: ${id}`)
    
    res.json({
      success: true,
      message: '终端关闭成功'
    })
  } catch (error: any) {
    logger.error('关闭终端失败:', error)
    
    let statusCode = 500
    if (error.message.includes('不存在') || error.message.includes('终端会话')) {
      statusCode = 400
    }
    
    res.status(statusCode).json({
      success: false,
      error: '关闭终端失败',
      message: error.message
    })
  }
})

// 获取实例状态
router.get('/:id/status', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const status = instanceManager.getInstanceStatus(id)
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    res.json({
      success: true,
      data: status
    })
  } catch (error: any) {
    logger.error('获取实例状态失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例状态失败',
      message: error.message
    })
  }
})

// 向实例发送输入
router.post('/:id/input', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const { input } = req.body
    
    if (typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: '无效的输入',
        message: '输入必须是字符串'
      })
    }
    
    const success = instanceManager.sendInput(id, input)
    
    if (!success) {
      return res.status(400).json({
        success: false,
        error: '发送输入失败',
        message: '实例不存在或未在运行'
      })
    }
    
    res.json({
      success: true,
      message: '输入发送成功'
    })
  } catch (error: any) {
    logger.error('发送输入失败:', error)
    res.status(500).json({
      success: false,
      error: '发送输入失败',
      message: error.message
    })
  }
})





// 获取可用的游戏配置文件列表
router.get('/configs/available', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await PythonManager.getAvailableConfigs()
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('获取游戏配置列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取游戏配置列表失败',
      message: error.message
    })
  }
})

// 获取指定游戏配置的模板结构
router.get('/configs/schema/:configId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { configId } = req.params
    const decodedConfigId = decodeURIComponent(configId)
    const result = await PythonManager.getConfigSchema(decodedConfigId)
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: '配置模板不存在'
      })
    }
    
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('获取配置模板失败:', error)
    res.status(500).json({
      success: false,
      error: '获取配置模板失败',
      message: error.message
    })
  }
})

// 读取实例的游戏配置文件
router.get('/:instanceId/configs/:configId', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { instanceId, configId } = req.params
    const decodedConfigId = decodeURIComponent(configId)
    
    // 获取实例信息
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    // 获取配置模板
    const schema = await PythonManager.getConfigSchema(decodedConfigId)
    if (!schema) {
      return res.status(404).json({
        success: false,
        error: '配置模板不存在'
      })
    }
    
    // 从配置模板中获取正确的解析器类型
    const parser = schema.meta?.parser || 'configobj'
    logger.info(`使用解析器: ${parser} 读取配置: ${decodedConfigId}`)
    
    // 读取配置文件
    const result = await PythonManager.readGameConfig(
      instance.workingDirectory,
      schema,
      parser
    )
    
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('读取游戏配置失败:', error)
    res.status(500).json({
      success: false,
      error: '读取游戏配置失败',
      message: error.message
    })
  }
})

// 保存实例的游戏配置文件
router.post('/:instanceId/configs/:configId', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { instanceId, configId } = req.params
    const { configData } = req.body
    const decodedConfigId = decodeURIComponent(configId)
    
    if (!configData) {
      return res.status(400).json({
        success: false,
        error: '缺少配置数据'
      })
    }
    
    // 获取实例信息
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    // 获取配置模板
    const schema = await PythonManager.getConfigSchema(decodedConfigId)
    if (!schema) {
      return res.status(404).json({
        success: false,
        error: '配置模板不存在'
      })
    }
    
    // 从配置模板中获取正确的解析器类型
    const parser = schema.meta?.parser || 'configobj'
    logger.info(`使用解析器: ${parser} 保存配置: ${decodedConfigId}`)
    
    // 保存配置文件
    const result = await PythonManager.saveGameConfig(
      instance.workingDirectory,
      schema,
      configData,
      parser
    )
    
    if (result) {
      logger.info(`用户保存游戏配置: 实例=${instanceId}, 配置=${decodedConfigId}, 解析器=${parser}`)
      res.json({
        success: true,
        message: '配置保存成功'
      })
    } else {
      res.status(500).json({
        success: false,
        error: '配置保存失败'
      })
    }
  } catch (error: any) {
    logger.error('保存游戏配置失败:', error)
    res.status(500).json({
      success: false,
      error: '保存游戏配置失败',
      message: error.message
    })
  }
})

// Python环境重置功能已移除

// Python环境检测
router.get('/python/check', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await PythonManager.checkPythonEnvironment()
    
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('Python环境检测异常:', error)
    
    res.json({
      success: true,
      data: {
        available: false,
        error: `Python环境检测失败: ${error.message}`,
        platform: os.platform()
      }
    })
  }
})

// 导出设置函数和路由
export function setupInstanceRoutes(manager: InstanceManager) {
  setInstanceManager(manager)
  return router
}

export default router