import { Request } from 'express'

/**
 * 开发者认证状态
 */
export interface DeveloperAuth {
  /** 是否已认证 */
  isAuthenticated: boolean
  /** 是否已设置密码 */
  hasPassword: boolean
}

/**
 * 开发者配置
 */
export interface DeveloperConfig {
  /** 密码哈希 */
  passwordHash: string
  /** 盐值 */
  salt: string
  /** 创建时间 */
  createdAt: Date
  /** 更新时间 */
  updatedAt: Date
}

/**
 * JWT载荷
 */
export interface DeveloperJWTPayload {
  /** 令牌类型 */
  type: 'developer'
  /** 时间戳 */
  timestamp: number
  /** 过期时间 */
  exp?: number
  /** 签发时间 */
  iat?: number
}

/**
 * 扩展的Request接口，包含开发者用户信息
 */
export interface DeveloperRequest extends Request {
  user?: DeveloperJWTPayload
}

/**
 * 正式环境封装结果
 */
export interface ProductionPackageResult {
  /** 删除的文件数量 */
  deletedFiles: number
  /** 保留的目录数量 */
  preservedDirs: number
  /** 保留的文件数量 */
  preservedFiles: number
  /** 数据目录路径 */
  dataDir: string
}

/**
 * API响应基础接口
 */
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
}

/**
 * 开发者认证响应
 */
export interface DeveloperAuthResponse extends ApiResponse<{ token: string }> {}

/**
 * 开发者状态响应
 */
export interface DeveloperStatusResponse extends ApiResponse<DeveloperAuth> {}

/**
 * 正式环境封装响应
 */
export interface ProductionPackageResponse extends ApiResponse<ProductionPackageResult> {}

/**
 * 游戏配置项
 */
export interface GameConfig {
  /** 游戏英文名（作为key） */
  key: string
  /** 游戏中文名 */
  game_nameCN: string
  /** Steam应用ID */
  appid: string
  /** 游戏提示信息 */
  tip: string
  /** 游戏图片URL */
  image: string
  /** Steam商店URL */
  url: string
  /** 支持的系统 */
  system?: string[]
  /** 系统信息 */
  system_info?: string[]
  /** 内存要求（GB） */
  memory?: number
  /** 文档链接 */
  docs?: string
  /** 端口信息 */
  ports?: Array<{
    port: number
    protocol: string
  }>
}

/**
 * 游戏配置文件数据
 */
export interface GameConfigData {
  [key: string]: Omit<GameConfig, 'key'>
}

/**
 * 游戏配置API响应
 */
export interface GameConfigResponse extends ApiResponse<GameConfigData> {}

/**
 * 游戏配置操作响应
 */
export interface GameConfigOperationResponse extends ApiResponse<GameConfig> {}
