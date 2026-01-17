import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import axios from 'axios'
import logger from '../utils/logger.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'

const router = Router()
let configManager: ConfigManager

// 设置ConfigManager实例
export function setSponsorDependencies(config: ConfigManager) {
  configManager = config
}

// 校验赞助者密钥接口
router.post('/validate-key', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { key } = req.body
    
    if (!key || typeof key !== 'string') {
      return res.status(400).json({
        success: false,
        message: '密钥参数无效'
      })
    }

    // 向第三方API发送请求校验密钥
    const apiUrl = 'http://api.gsm.xiaozhuhouses.asia:10002/api/key/check'
    
    logger.info(`开始校验赞助者密钥: ${key.substring(0, 8)}...`)
    
    const response = await axios.get(apiUrl, {
      params: { key },
      timeout: 10000 // 10秒超时
    })
    
    const result = response.data
    
    if (result.status === 'success') {
      logger.info(`密钥校验成功: ${key.substring(0, 8)}..., 过期状态: ${result.data.is_expired}`)
      
      // 保存密钥信息到配置文件
      try {
        await configManager.updateSponsorConfig({
          key: result.data.key,
          isValid: !result.data.is_expired,
          expiryTime: result.data.timeData
        })
        logger.info('赞助者密钥已保存到配置文件')
      } catch (saveError) {
        logger.error('保存赞助者密钥到配置文件失败:', saveError)
        // 即使保存失败，也返回校验成功的结果
      }
      
      res.json({
        success: true,
        message: '密钥校验成功',
        data: {
          key: result.data.key,
          timeData: result.data.timeData,
          is_expired: result.data.is_expired,
          current_request_ip: result.data.current_request_ip
        }
      })
    } else {
      logger.warn(`密钥校验失败: ${key.substring(0, 8)}..., 原因: ${result.message}`)
      
      res.status(400).json({
        success: false,
        message: result.message || '密钥校验失败'
      })
    }
  } catch (error: any) {
    logger.error('赞助者密钥校验错误:', error)
    
    // 处理不同类型的错误
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return res.status(503).json({
        success: false,
        message: '校验服务暂时不可用，请稍后重试'
      })
    }
    
    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({
        success: false,
        message: '校验请求超时，请稍后重试'
      })
    }
    
    if (error.response) {
      // API返回了错误响应
      return res.status(400).json({
        success: false,
        message: error.response.data?.message || '密钥校验失败'
      })
    }
    
    res.status(500).json({
      success: false,
      message: '服务器内部错误，请稍后重试'
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

// 获取已保存的赞助者密钥信息
router.get('/key-info', authenticateToken, async (req: Request, res: Response) => {
  try {
    const sponsorConfig = configManager.getSponsorConfig()
    
    if (!sponsorConfig) {
      return res.json({
        success: true,
        data: null,
        message: '未找到已保存的赞助者密钥'
      })
    }
    
    // 返回密钥信息（不包含完整密钥，只返回前几位用于显示）
    res.json({
      success: true,
      data: {
        keyPreview: sponsorConfig.key.substring(0, 8) + '...',
        isValid: sponsorConfig.isValid,
        expiryTime: sponsorConfig.expiryTime,
        validatedAt: sponsorConfig.validatedAt
      },
      message: '获取赞助者密钥信息成功'
    })
  } catch (error: any) {
    logger.error('获取赞助者密钥信息错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
})

export default router