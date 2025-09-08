import { Router } from 'express'
import { authenticateToken } from '../../../middleware/auth.js'
import type { ConfigManager } from '../../config/ConfigManager.js'
import { DeveloperService } from '../services/DeveloperService.js'
import { DeveloperController } from '../controllers/DeveloperController.js'
import { DeveloperAuthMiddleware } from '../middleware/developerAuth.js'

/**
 * 创建开发者路由
 */
export function createDeveloperRoutes(configManager: ConfigManager): Router {
  const router = Router()
  
  // 创建服务和控制器实例
  const developerService = new DeveloperService(configManager)
  const developerController = new DeveloperController(developerService)
  const developerAuthMiddleware = new DeveloperAuthMiddleware(configManager)

  // 应用基础认证中间件（需要先登录系统）
  router.use(authenticateToken)

  // 认证相关路由
  router.get('/auth/status', 
    developerAuthMiddleware.checkToken, 
    developerController.checkAuthStatus
  )
  
  router.post('/auth/set-password', 
    developerController.setPassword
  )
  
  router.post('/auth/login', 
    developerController.login
  )

  // 需要开发者认证的路由
  router.post('/production-package',
    developerAuthMiddleware.authenticate,
    developerController.executeProductionPackage
  )

  // 游戏配置管理路由
  router.get('/game-configs',
    developerAuthMiddleware.authenticate,
    developerController.getGameConfigs
  )

  router.post('/game-configs',
    developerAuthMiddleware.authenticate,
    developerController.createGameConfig
  )

  router.put('/game-configs/:key',
    developerAuthMiddleware.authenticate,
    developerController.updateGameConfig
  )

  router.delete('/game-configs/:key',
    developerAuthMiddleware.authenticate,
    developerController.deleteGameConfig
  )

  return router
}

/**
 * 设置开发者路由（向后兼容）
 */
export function setupDeveloperRoutes(configManager: ConfigManager): Router {
  return createDeveloperRoutes(configManager)
}
