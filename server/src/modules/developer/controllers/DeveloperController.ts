import { Response } from 'express'
import type {
  DeveloperRequest,
  DeveloperStatusResponse,
  DeveloperAuthResponse,
  ProductionPackageResponse,
  GameConfigResponse,
  GameConfigOperationResponse,
  GameConfig
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

  /**
   * 获取游戏配置列表
   */
  getGameConfigs = async (req: DeveloperRequest, res: Response<GameConfigResponse>) => {
    try {
      const configs = await this.developerService.getGameConfigs()

      res.json({
        success: true,
        data: configs
      })
    } catch (error) {
      logger.error('获取游戏配置失败:', error)
      res.status(500).json({
        success: false,
        message: '获取游戏配置失败'
      })
    }
  }

  /**
   * 创建游戏配置
   */
  createGameConfig = async (req: DeveloperRequest, res: Response<GameConfigOperationResponse>) => {
    try {
      const { key, config } = req.body

      if (!key || !config) {
        return res.status(400).json({
          success: false,
          message: '缺少必要参数'
        })
      }

      const gameConfig: GameConfig = { key, ...config }
      const result = await this.developerService.createGameConfig(gameConfig)

      res.json({
        success: true,
        data: result,
        message: '游戏配置创建成功'
      })
    } catch (error) {
      logger.error('创建游戏配置失败:', error)

      if (error instanceof Error) {
        if (error.message.includes('已存在') || error.message.includes('必填字段')) {
          return res.status(400).json({
            success: false,
            message: error.message
          })
        }
      }

      res.status(500).json({
        success: false,
        message: '创建游戏配置失败'
      })
    }
  }

  /**
   * 更新游戏配置
   */
  updateGameConfig = async (req: DeveloperRequest, res: Response<GameConfigOperationResponse>) => {
    try {
      const { key } = req.params
      const { config } = req.body

      if (!key || !config) {
        return res.status(400).json({
          success: false,
          message: '缺少必要参数'
        })
      }

      const result = await this.developerService.updateGameConfig(key, config)

      res.json({
        success: true,
        data: result,
        message: '游戏配置更新成功'
      })
    } catch (error) {
      logger.error('更新游戏配置失败:', error)

      if (error instanceof Error) {
        if (error.message.includes('不存在') || error.message.includes('必填字段')) {
          return res.status(400).json({
            success: false,
            message: error.message
          })
        }
      }

      res.status(500).json({
        success: false,
        message: '更新游戏配置失败'
      })
    }
  }

  /**
   * 删除游戏配置
   */
  deleteGameConfig = async (req: DeveloperRequest, res: Response<GameConfigOperationResponse>) => {
    try {
      const { key } = req.params

      if (!key) {
        return res.status(400).json({
          success: false,
          message: '缺少游戏标识参数'
        })
      }

      await this.developerService.deleteGameConfig(key)

      res.json({
        success: true,
        message: '游戏配置删除成功'
      })
    } catch (error) {
      logger.error('删除游戏配置失败:', error)

      if (error instanceof Error && error.message.includes('不存在')) {
        return res.status(404).json({
          success: false,
          message: error.message
        })
      }

      res.status(500).json({
        success: false,
        message: '删除游戏配置失败'
      })
    }
  }
}
