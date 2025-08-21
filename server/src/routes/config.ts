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

// 获取终端配置
router.get('/terminal', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!configManager) {
      return res.status(500).json({ error: 'ConfigManager未初始化' })
    }

    const terminalConfig = configManager.getTerminalConfig()
    res.json({
      success: true,
      data: terminalConfig
    })
  } catch (error) {
    logger.error('获取终端配置失败:', error)
    res.status(500).json({
      error: '服务器内部错误',
      message: '获取终端配置失败'
    })
  }
})

// 更新终端配置
router.put('/terminal', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!configManager) {
      return res.status(500).json({ error: 'ConfigManager未初始化' })
    }

    const { defaultUser } = req.body

    // 验证输入
    if (typeof defaultUser !== 'string') {
      return res.status(400).json({
        error: '参数错误',
        message: 'defaultUser必须是字符串类型'
      })
    }

    // 更新配置
    await configManager.updateTerminalConfig({ defaultUser })

    res.json({
      success: true,
      message: '终端配置更新成功'
    })
  } catch (error) {
    logger.error('更新终端配置失败:', error)
    res.status(500).json({
      error: '服务器内部错误',
      message: '更新终端配置失败'
    })
  }
})

// 获取游戏配置
router.get('/game', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!configManager) {
      return res.status(500).json({ error: 'ConfigManager未初始化' })
    }

    const gameConfig = configManager.getGameConfig()
    res.json({
      success: true,
      data: gameConfig
    })
  } catch (error) {
    logger.error('获取游戏配置失败:', error)
    res.status(500).json({
      error: '服务器内部错误',
      message: '获取游戏配置失败'
    })
  }
})

// 更新游戏配置
router.put('/game', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!configManager) {
      return res.status(500).json({ error: 'ConfigManager未初始化' })
    }

    const { defaultInstallPath } = req.body

    // 验证输入
    if (typeof defaultInstallPath !== 'string') {
      return res.status(400).json({
        error: '参数错误',
        message: 'defaultInstallPath必须是字符串类型'
      })
    }

    // 更新配置
    await configManager.updateGameConfig({ defaultInstallPath })

    res.json({
      success: true,
      message: '游戏配置更新成功'
    })
  } catch (error) {
    logger.error('更新游戏配置失败:', error)
    res.status(500).json({
      error: '服务器内部错误',
      message: '更新游戏配置失败'
    })
  }
})

export function setupConfigRoutes(manager: ConfigManager) {
  setConfigManager(manager)
  return router
}

export default router