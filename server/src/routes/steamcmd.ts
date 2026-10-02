import { Router } from 'express'
import { SteamCMDManager } from '../modules/steamcmd/SteamCMDManager.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'
import winston from 'winston'
import { authenticateToken } from '../middleware/auth.js'
import { assertSteamCMDSupported, UnsupportedArchitectureError } from '../utils/architectureSupport.js'

const router = Router()
let steamcmdManager: SteamCMDManager
let logger: winston.Logger

export function setSteamCMDManager(manager: SteamCMDManager, loggerInstance: winston.Logger) {
  steamcmdManager = manager
  logger = loggerInstance
}

// 获取SteamCMD状态
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = await steamcmdManager.getStatus()
    res.json({
      success: true,
      data: status
    })
  } catch (error) {
    logger.error('获取SteamCMD状态失败:', error)
    res.status(500).json({
      success: false,
      message: '获取SteamCMD状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 在线安装SteamCMD
router.post('/install', authenticateToken, async (req, res) => {
  try {
    const { installPath } = req.body
    
    if (!installPath || typeof installPath !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请提供有效的安装路径'
      })
    }

    try {
      assertSteamCMDSupported()
    } catch (error) {
      return res.status(error instanceof UnsupportedArchitectureError ? 400 : 500).json({
        success: false,
        message: error instanceof Error ? error.message : '当前平台暂不支持 SteamCMD 在线安装'
      })
    }
    
    // 设置SSE响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    })
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    
    try {
      await steamcmdManager.installOnline({
        installPath,
        onProgress: (progress) => {
          sendEvent('progress', { progress })
        },
        onStatusChange: (status) => {
          sendEvent('status', { status })
        }
      })
      
      sendEvent('complete', { success: true, message: 'SteamCMD安装完成' })
      res.end()
      
    } catch (error) {
      sendEvent('error', {
        success: false,
        message: 'SteamCMD安装失败',
        error: error instanceof Error ? error.message : '未知错误'
      })
      res.end()
    }
    
  } catch (error) {
    logger.error('SteamCMD安装请求处理失败:', error)
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'SteamCMD安装请求处理失败',
        error: error instanceof Error ? error.message : '未知错误'
      })
    }
  }
})

// 设置手动安装路径
router.post('/manual-path', authenticateToken, async (req, res) => {
  try {
    const { installPath } = req.body
    
    if (!installPath || typeof installPath !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请提供有效的安装路径'
      })
    }
    
    const isInstalled = await steamcmdManager.setManualPath(installPath)
    
    res.json({
      success: true,
      data: {
        isInstalled,
        installPath,
        message: isInstalled ? 'SteamCMD路径设置成功' : 'SteamCMD路径已设置，但未找到可执行文件'
      }
    })
    
  } catch (error) {
    logger.error('设置SteamCMD手动路径失败:', error)
    res.status(500).json({
      success: false,
      message: '设置SteamCMD手动路径失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 检查路径下是否存在SteamCMD
router.post('/check-path', authenticateToken, async (req, res) => {
  try {
    const { installPath } = req.body
    
    if (!installPath || typeof installPath !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请提供有效的路径'
      })
    }
    
    const exists = await steamcmdManager.checkSteamCMDExists(installPath)
    
    res.json({
      success: true,
      data: {
        exists,
        path: installPath
      }
    })
    
  } catch (error) {
    logger.error('检查SteamCMD路径失败:', error)
    res.status(500).json({
      success: false,
      message: '检查SteamCMD路径失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 刷新SteamCMD状态
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const status = await steamcmdManager.refreshStatus()
    
    res.json({
      success: true,
      data: status
    })
    
  } catch (error) {
    logger.error('刷新SteamCMD状态失败:', error)
    res.status(500).json({
      success: false,
      message: '刷新SteamCMD状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取SteamCMD可执行文件路径
router.get('/executable-path', authenticateToken, async (req, res) => {
  try {
    const executablePath = await steamcmdManager.getSteamCMDExecutablePath()
    
    res.json({
      success: true,
      data: {
        executablePath
      }
    })
    
  } catch (error) {
    logger.error('获取SteamCMD可执行文件路径失败:', error)
    res.status(500).json({
      success: false,
      message: '获取SteamCMD可执行文件路径失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

export default router
