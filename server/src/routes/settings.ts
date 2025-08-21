import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import type { ConfigManager } from '../modules/config/ConfigManager.js'
import logger from '../utils/logger.js'

const router = Router()

// 注意：这里需要在实际使用时注入ConfigManager实例
let configManager: ConfigManager

// 设置ConfigManager实例的函数
export function setConfigManager(manager: ConfigManager) {
  configManager = manager
}

// 设置游戏默认安装路径（用于新手引导）
router.post('/game-path', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!configManager) {
      return res.status(500).json({ 
        success: false,
        error: 'ConfigManager未初始化' 
      })
    }

    const { defaultGamePath } = req.body

    // 验证输入
    if (!defaultGamePath || typeof defaultGamePath !== 'string') {
      return res.status(400).json({
        success: false,
        error: '参数错误',
        message: 'defaultGamePath必须是非空字符串'
      })
    }

    // 基本路径格式验证
    const trimmedPath = defaultGamePath.trim()
    if (!trimmedPath) {
      return res.status(400).json({
        success: false,
        error: '参数错误',
        message: '路径不能为空'
      })
    }

    // 更新配置
    await configManager.updateGameConfig({ defaultInstallPath: trimmedPath })

    logger.info(`游戏默认安装路径已设置: ${trimmedPath}`)

    res.json({
      success: true,
      message: '游戏默认安装路径设置成功',
      data: {
        defaultInstallPath: trimmedPath
      }
    })
  } catch (error) {
    logger.error('设置游戏默认安装路径失败:', error)
    res.status(500).json({
      success: false,
      error: '服务器内部错误',
      message: '设置游戏默认安装路径失败'
    })
  }
})

// 获取游戏默认安装路径
router.get('/game-path', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!configManager) {
      return res.status(500).json({ 
        success: false,
        error: 'ConfigManager未初始化' 
      })
    }

    const gameConfig = configManager.getGameConfig()
    
    res.json({
      success: true,
      data: {
        defaultInstallPath: gameConfig.defaultInstallPath || ''
      }
    })
  } catch (error) {
    logger.error('获取游戏默认安装路径失败:', error)
    res.status(500).json({
      success: false,
      error: '服务器内部错误',
      message: '获取游戏默认安装路径失败'
    })
  }
})

export function setupSettingsRoutes(manager: ConfigManager) {
  setConfigManager(manager)
  return router
}

export default router
