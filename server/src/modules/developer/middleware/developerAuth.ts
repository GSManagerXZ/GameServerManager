import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { ConfigManager } from '../../config/ConfigManager.js'
import type { DeveloperRequest, DeveloperJWTPayload } from '../types/developer.js'
import logger from '../../../utils/logger.js'

/**
 * 开发者认证中间件类
 */
export class DeveloperAuthMiddleware {
  private configManager: ConfigManager

  constructor(configManager: ConfigManager) {
    this.configManager = configManager
  }

  /**
   * 开发者认证中间件
   */
  authenticate = (req: DeveloperRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: '缺少开发者认证令牌'
        })
      }

      const token = authHeader.substring(7)
      const jwtSecret = this.configManager.getJWTSecret()
      
      try {
        const decoded = jwt.verify(token, jwtSecret) as DeveloperJWTPayload
        if (decoded.type !== 'developer') {
          return res.status(401).json({
            success: false,
            message: '无效的开发者令牌'
          })
        }
        
        req.user = decoded
        next()
      } catch (jwtError) {
        return res.status(401).json({
          success: false,
          message: '开发者令牌已过期或无效'
        })
      }
    } catch (error) {
      logger.error('开发者认证中间件错误:', error)
      res.status(500).json({
        success: false,
        message: '服务器内部错误'
      })
    }
  }

  /**
   * 检查开发者令牌（可选认证）
   * 用于检查状态接口，不强制要求认证
   */
  checkToken = (req: DeveloperRequest, res: Response, next: NextFunction) => {
    try {
      const developerHeader = req.headers['x-developer-token'] as string
      
      if (developerHeader && developerHeader.startsWith('Bearer ')) {
        const token = developerHeader.substring(7)
        try {
          const jwtSecret = this.configManager.getJWTSecret()
          const decoded = jwt.verify(token, jwtSecret) as DeveloperJWTPayload
          if (decoded.type === 'developer') {
            req.user = decoded
          }
        } catch {
          // token无效，继续执行但不设置user
        }
      }
      
      next()
    } catch (error) {
      logger.error('检查开发者令牌错误:', error)
      next() // 继续执行，不阻断请求
    }
  }
}
