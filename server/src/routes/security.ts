import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import type { ConfigManager } from '../modules/config/ConfigManager.js'
import logger from '../utils/logger.js'

const router = Router()

// 设置ConfigManager依赖
let configManager: ConfigManager

export function setSecurityConfigManager(manager: ConfigManager) {
  configManager = manager
}

function getExternalApiPublicConfig() {
  const externalApi = configManager.getExternalApiConfig()

  return {
    enabled: !!externalApi.enabled,
    hasApiKey: !!externalApi.keyHash,
    keyPrefix: externalApi.keyPrefix || '',
    createdAt: externalApi.createdAt || '',
    updatedAt: externalApi.updatedAt || '',
    endpoints: {
      listInstances: 'GET /api/external/instances',
      getInstance: 'GET /api/external/instances/:id',
      getStatus: 'GET /api/external/instances/:id/status',
      startInstance: 'POST /api/external/instances/:id/start',
      stopInstance: 'POST /api/external/instances/:id/stop',
      restartInstance: 'POST /api/external/instances/:id/restart',
      action: 'POST /api/external/instances/:id/action'
    }
  }
}

// 获取安全配置
router.get('/config', authenticateToken, async (req: Request, res: Response) => {
  try {
    const securityConfig = configManager.getSecurityConfig()
    const jwtConfig = configManager.getJWTConfig()
    
    res.json({
      success: true,
      data: {
        tokenResetRule: securityConfig.tokenResetRule,
        tokenExpireHours: securityConfig.tokenExpireHours,
        currentExpiresIn: jwtConfig.expiresIn
      }
    })
  } catch (error) {
    logger.error('获取安全配置失败:', error)
    res.status(500).json({
      success: false,
      message: '获取安全配置失败'
    })
  }
})

// 更新安全配置
router.post('/config', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { tokenResetRule, tokenExpireHours } = req.body

    // 验证输入
    if (!tokenResetRule || !['startup', 'expire'].includes(tokenResetRule)) {
      return res.status(400).json({
        success: false,
        message: '无效的令牌重置规则'
      })
    }

    if (tokenExpireHours !== null && (typeof tokenExpireHours !== 'number' || tokenExpireHours <= 0)) {
      return res.status(400).json({
        success: false,
        message: '令牌到期时间必须为正数或null'
      })
    }

    // 更新安全配置
    await configManager.updateSecurityConfig({
      tokenResetRule,
      tokenExpireHours
    })

    // 如果设置了到期时间，同时更新JWT配置
    if (tokenExpireHours !== null) {
      await configManager.updateJWTConfig({
        expiresIn: `${tokenExpireHours}h`
      })
    } else {
      // 永不到期的情况，设置为很长的过期时间（100年）
      await configManager.updateJWTConfig({
        expiresIn: '876000h' // 100年
      })
    }

    logger.info(`安全配置已更新: 重置规则=${tokenResetRule}, 到期时间=${tokenExpireHours}小时`)

    res.json({
      success: true,
      message: '安全配置已更新'
    })
  } catch (error) {
    logger.error('更新安全配置失败:', error)
    res.status(500).json({
      success: false,
      message: '更新安全配置失败'
    })
  }
})

// 重置JWT密钥（随时可用）
router.post('/reset-token', authenticateToken, async (req: Request, res: Response) => {
  try {
    // 重新生成JWT密钥，使所有现有令牌失效
    await configManager.regenerateJWTSecret()
    
    logger.info('JWT密钥已手动重新生成，所有现有令牌已失效')
    
    res.json({
      success: true,
      message: 'JWT密钥已重新生成，所有现有令牌将失效，请重新登录'
    })
  } catch (error) {
    logger.error('重置令牌失败:', error)
    res.status(500).json({
      success: false,
      message: '重置令牌失败'
    })
  }
})

// 获取外部自动化API配置
router.get('/external-api', authenticateToken, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: getExternalApiPublicConfig()
    })
  } catch (error) {
    logger.error('获取外部API配置失败:', error)
    res.status(500).json({
      success: false,
      message: '获取外部API配置失败'
    })
  }
})

// 启用或禁用外部自动化API
router.post('/external-api', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled 必须是布尔值'
      })
    }

    const externalApi = configManager.getExternalApiConfig()
    if (enabled && !externalApi.keyHash) {
      return res.status(400).json({
        success: false,
        message: '请先生成外部API密钥'
      })
    }

    await configManager.updateExternalApiConfig({ enabled })
    logger.info(`外部API已${enabled ? '启用' : '禁用'}`)

    res.json({
      success: true,
      message: enabled ? '外部API已启用' : '外部API已禁用',
      data: getExternalApiPublicConfig()
    })
  } catch (error) {
    logger.error('更新外部API配置失败:', error)
    res.status(500).json({
      success: false,
      message: '更新外部API配置失败'
    })
  }
})

// 生成或轮换外部自动化API密钥，明文密钥只会在本次响应中返回
router.post('/external-api/key', authenticateToken, async (req: Request, res: Response) => {
  try {
    const generated = await configManager.generateExternalApiKey()

    res.json({
      success: true,
      message: '外部API密钥已生成',
      data: {
        apiKey: generated.apiKey,
        keyPrefix: generated.keyPrefix,
        createdAt: generated.createdAt,
        enabled: true
      }
    })
  } catch (error) {
    logger.error('生成外部API密钥失败:', error)
    res.status(500).json({
      success: false,
      message: '生成外部API密钥失败'
    })
  }
})

// 清除外部自动化API密钥，同时禁用外部API
router.delete('/external-api/key', authenticateToken, async (req: Request, res: Response) => {
  try {
    await configManager.clearExternalApiKey()
    logger.info('外部API密钥已清除')

    res.json({
      success: true,
      message: '外部API密钥已清除',
      data: getExternalApiPublicConfig()
    })
  } catch (error) {
    logger.error('清除外部API密钥失败:', error)
    res.status(500).json({
      success: false,
      message: '清除外部API密钥失败'
    })
  }
})

export default router
