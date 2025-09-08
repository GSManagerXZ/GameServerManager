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
