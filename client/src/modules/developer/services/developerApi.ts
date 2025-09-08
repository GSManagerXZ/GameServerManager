import type {
  DeveloperAuth,
  DeveloperAuthResponse,
  DeveloperStatusResponse,
  ProductionPackageResponse
} from '../types/developer'

/**
 * 开发者API服务类
 */
export class DeveloperApiService {
  private static instance: DeveloperApiService
  
  private constructor() {}
  
  public static getInstance(): DeveloperApiService {
    if (!DeveloperApiService.instance) {
      DeveloperApiService.instance = new DeveloperApiService()
    }
    return DeveloperApiService.instance
  }

  /**
   * 获取请求头
   */
  private getHeaders(includeDeveloperToken = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
    }

    if (includeDeveloperToken) {
      const developerToken = localStorage.getItem('gsm3_developer_token')
      if (developerToken) {
        headers['Authorization'] = `Bearer ${developerToken}`
      }
    }

    return headers
  }

  /**
   * 检查开发者认证状态
   */
  async checkAuthStatus(): Promise<DeveloperAuth> {
    const headers = this.getHeaders()
    
    // 如果有开发者token，也发送
    const developerToken = localStorage.getItem('gsm3_developer_token')
    if (developerToken) {
      headers['X-Developer-Token'] = `Bearer ${developerToken}`
    }

    const response = await fetch('/api/developer/auth/status', { headers })
    const result: DeveloperStatusResponse = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.message || '检查认证状态失败')
    }

    return result.data
  }

  /**
   * 设置开发者密码
   */
  async setPassword(password: string): Promise<string> {
    const response = await fetch('/api/developer/auth/set-password', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ password })
    })

    const result: DeveloperAuthResponse = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.message || '设置密码失败')
    }

    return result.data.token
  }

  /**
   * 开发者登录
   */
  async login(password: string): Promise<string> {
    const response = await fetch('/api/developer/auth/login', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ password })
    })

    const result: DeveloperAuthResponse = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.message || '登录失败')
    }

    return result.data.token
  }

  /**
   * 执行正式环境封装
   */
  async executeProductionPackage(): Promise<ProductionPackageResponse['data']> {
    const response = await fetch('/api/developer/production-package', {
      method: 'POST',
      headers: this.getHeaders(true)
    })

    const result: ProductionPackageResponse = await response.json()

    if (!result.success) {
      throw new Error(result.message || '正式环境封装失败')
    }

    return result.data
  }
}

// 导出单例实例
export const developerApi = DeveloperApiService.getInstance()
