import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'

const router = Router()
let configManager: ConfigManager

// 赞助者密钥最大长度限制，避免异常超长内容写入配置文件
const MAX_SPONSOR_KEY_LENGTH = 512

// 设置ConfigManager实例
export function setSponsorDependencies(config: ConfigManager) {
  configManager = config
}

// 保存赞助者密钥（仅本地记录，不做在线校验）
router.post('/save-key', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { key } = req.body

    if (!key || typeof key !== 'string') {
      return res.status(400).json({
        success: false,
        message: '密钥参数无效'
      })
    }

    const trimmedKey = key.trim()

    if (!trimmedKey) {
      return res.status(400).json({
        success: false,
        message: '密钥不能为空'
      })
    }

    if (trimmedKey.length > MAX_SPONSOR_KEY_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `密钥长度不能超过 ${MAX_SPONSOR_KEY_LENGTH} 个字符`
      })
    }

    await configManager.saveSponsorConfig(trimmedKey)
    logger.info('赞助者密钥已保存到本地')

    res.json({
      success: true,
      message: '赞助者密钥已保存',
      data: {
        key: trimmedKey,
        savedAt: configManager.getSponsorConfig()?.savedAt
      }
    })
  } catch (error: any) {
    logger.error('保存赞助者密钥错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误，请稍后重试'
    })
  }
})

// 获取已保存的赞助者密钥记录
router.get('/key-info', authenticateToken, async (req: Request, res: Response) => {
  try {
    const sponsorConfig = configManager.getSponsorConfig()

    if (!sponsorConfig || !sponsorConfig.key) {
      return res.json({
        success: true,
        data: null,
        message: '未找到已保存的赞助者密钥'
      })
    }

    res.json({
      success: true,
      data: {
        key: sponsorConfig.key,
        savedAt: sponsorConfig.savedAt
      },
      message: '获取赞助者密钥记录成功'
    })
  } catch (error: any) {
    logger.error('获取赞助者密钥记录错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
})

// 清除已保存的赞助者密钥
router.delete('/clear-key', authenticateToken, async (req: Request, res: Response) => {
  try {
    await configManager.clearSponsorConfig()

    res.json({
      success: true,
      message: '赞助者密钥已清除'
    })
  } catch (error: any) {
    logger.error('清除赞助者密钥错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
})

export default router