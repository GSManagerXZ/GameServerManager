import { Request, Response, NextFunction } from 'express'
import { AuthManager } from '../modules/auth/AuthManager.js'
import type { ConfigManager } from '../modules/config/ConfigManager.js'
import logger from '../utils/logger.js'

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string
    username: string
    role: string
  }
}

let authManager: AuthManager
let configManager: ConfigManager

export function setAuthManager(manager: AuthManager) {
  authManager = manager
}

export function setExternalApiConfigManager(manager: ConfigManager) {
  configManager = manager
}

function extractExternalApiKey(req: Request): string {
  const apiKeyHeader = req.headers['x-gsm-api-key']
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return apiKeyHeader.trim()
  }

  const authHeader = req.headers['authorization']
  if (!authHeader) {
    return ''
  }

  const [scheme, ...tokenParts] = authHeader.split(' ')
  const token = tokenParts.join(' ').trim()
  if (!token) {
    return ''
  }

  const normalizedScheme = scheme.toLowerCase()
  if (normalizedScheme === 'bearer' || normalizedScheme === 'apikey') {
    return token
  }

  return ''
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: '访问被拒绝',
      message: '需要提供访问令牌或重新登录'
    })
  }

  if (!authManager) {
    logger.error('认证管理器未初始化')
    return res.status(500).json({
      error: '服务器错误',
      message: '认证服务不可用'
    })
  }

  const decoded = authManager.verifyToken(token)
  
  if (!decoded) {
    return res.status(401).json({
      error: '访问被拒绝',
      message: '无效或过期的访问令牌，请重新登录'
    })
  }

  req.user = {
    userId: decoded.userId,
    username: decoded.username,
    role: decoded.role
  }

  next()
}

export function authenticateExternalApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!configManager) {
    logger.error('外部API认证配置管理器未初始化')
    return res.status(500).json({
      success: false,
      error: '服务器错误',
      message: '外部API认证服务不可用'
    })
  }

  const externalApi = configManager.getExternalApiConfig()
  if (!externalApi.enabled || !externalApi.keyHash) {
    return res.status(403).json({
      success: false,
      error: '外部API未启用',
      message: '请先在设置中启用并生成外部API密钥'
    })
  }

  const apiKey = extractExternalApiKey(req)
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: '访问被拒绝',
      message: '需要通过 Authorization: Bearer <API_KEY> 或 X-GSM-API-Key 提供外部API密钥'
    })
  }

  if (!configManager.verifyExternalApiKey(apiKey)) {
    return res.status(401).json({
      success: false,
      error: '访问被拒绝',
      message: '外部API密钥无效'
    })
  }

  req.user = {
    userId: 'external-api',
    username: 'external-api',
    role: 'admin'
  }

  next()
}

// 支持查询参数token的认证中间件（用于直接下载等场景）
export function authenticateTokenFlexible(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // 优先从Authorization头获取token
  const authHeader = req.headers['authorization']
  let token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN
  
  // 如果头部没有token，尝试从查询参数获取
  if (!token) {
    token = req.query.token as string
  }

  if (!token) {
    return res.status(401).json({
      error: '访问被拒绝',
      message: '需要提供访问令牌或重新登录'
    })
  }

  if (!authManager) {
    logger.error('认证管理器未初始化')
    return res.status(500).json({
      error: '服务器错误',
      message: '认证服务不可用'
    })
  }

  const decoded = authManager.verifyToken(token)
  
  if (!decoded) {
    return res.status(401).json({
      error: '访问被拒绝',
      message: '无效或过期的访问令牌，请重新登录'
    })
  }

  req.user = {
    userId: decoded.userId,
    username: decoded.username,
    role: decoded.role
  }

  next()
}

export function requireRole(role: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: '访问被拒绝',
        message: '需要身份验证'
      })
    }

    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '权限不足'
      })
    }

    next()
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireRole('admin')(req, res, next)
}
