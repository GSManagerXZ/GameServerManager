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
 * 开发者认证响应
 */
export interface DeveloperAuthResponse {
  success: boolean
  data?: {
    token: string
  }
  message?: string
}

/**
 * 开发者状态响应
 */
export interface DeveloperStatusResponse {
  success: boolean
  data?: DeveloperAuth
  message?: string
}

/**
 * 正式环境封装响应
 */
export interface ProductionPackageResponse {
  success: boolean
  data?: {
    deletedFiles: number
    preservedDirs: number
    preservedFiles: number
    dataDir: string
  }
  message?: string
}

/**
 * 开发者认证表单数据
 */
export interface DeveloperAuthFormData {
  password: string
  confirmPassword?: string
}

/**
 * 开发者工具操作类型
 */
export type DeveloperToolAction = 'production-package'

/**
 * 开发者工具操作状态
 */
export interface DeveloperToolActionState {
  loading: boolean
  error?: string
}

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
export interface GameConfigResponse {
  success: boolean
  data?: GameConfigData
  message?: string
}

/**
 * 游戏配置操作响应
 */
export interface GameConfigOperationResponse {
  success: boolean
  data?: GameConfig
  message?: string
}
