import { Response } from 'express'
import type { 
  DeveloperRequest,
  DeveloperStatusResponse,
  DeveloperAuthResponse,
  ProductionPackageResponse
} from '../types/developer.js'
import { DeveloperService } from '../services/DeveloperService.js'
import logger from '../../../utils/logger.js'

/**
 * 开发者控制器类
 */
export class DeveloperController {
  private developerService: DeveloperService

  constructor(developerService: DeveloperService) {
    this.developerService = developerService
  }

  /**
   * 检查开发者认证状态
   */
  checkAuthStatus = async (req: DeveloperRequest, res: Response<DeveloperStatusResponse>) => {
    try {
      const authData = await this.developerService.checkAuthStatus(req.user)
      
      res.json({
        success: true,
        data: authData
      })
    } catch (error) {
      logger.error('检查开发者认证状态失败:', error)
      res.status(500).json({
        success: false,
        message: '服务器内部错误'
      })
    }
  }

  /**
   * 设置开发者密码
   */
  setPassword = async (req: DeveloperRequest, res: Response<DeveloperAuthResponse>) => {
    try {
      const { password } = req.body

      const token = await this.developerService.setPassword(password)

      res.json({
        success: true,
        data: { token },
        message: '开发者密码设置成功'
      })
    } catch (error) {
      logger.error('设置开发者密码失败:', error)
      
      if (error instanceof Error) {
        // 根据错误类型返回不同的状态码
        if (error.message.includes('密码不能为空') || 
            error.message.includes('密码长度至少需要6位')) {
          return res.status(400).json({
            success: false,
            message: error.message
          })
        }
        
        if (error.message.includes('开发者密码已设置')) {
          return res.status(400).json({
            success: false,
            message: error.message
          })
        }
      }

      res.status(500).json({
        success: false,
        message: '服务器内部错误'
      })
    }
  }

  /**
   * 开发者登录
   */
  login = async (req: DeveloperRequest, res: Response<DeveloperAuthResponse>) => {
    try {
      const { password } = req.body

      const token = await this.developerService.login(password)

      res.json({
        success: true,
        data: { token },
        message: '开发者登录成功'
      })
    } catch (error) {
      logger.error('开发者登录失败:', error)
      
      if (error instanceof Error) {
        // 根据错误类型返回不同的状态码
        if (error.message.includes('密码不能为空')) {
          return res.status(400).json({
            success: false,
            message: error.message
          })
        }
        
        if (error.message.includes('请先设置开发者密码') ||
            error.message.includes('开发者配置不存在')) {
          return res.status(400).json({
            success: false,
            message: error.message
          })
        }
        
        if (error.message.includes('开发者密码错误')) {
          return res.status(401).json({
            success: false,
            message: error.message
          })
        }
      }

      res.status(500).json({
        success: false,
        message: '服务器内部错误'
      })
    }
  }

  /**
   * 执行正式环境封装
   */
  executeProductionPackage = async (req: DeveloperRequest, res: Response<ProductionPackageResponse>) => {
    try {
      const result = await this.developerService.executeProductionPackage()

      res.json({
        success: true,
        data: result,
        message: '正式环境封装完成，程序即将退出'
      })
    } catch (error) {
      logger.error('正式环境封装失败:', error)
      
      if (error instanceof Error && error.message.includes('数据目录不存在')) {
        return res.status(404).json({
          success: false,
          message: error.message
        })
      }

      res.status(500).json({
        success: false,
        message: '正式环境封装失败'
      })
    }
  }
}
