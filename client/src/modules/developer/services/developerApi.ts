import type {
  DeveloperAuth,
  DeveloperAuthResponse,
  DeveloperStatusResponse,
  ProductionPackageResponse,
  GameConfig,
  GameConfigData,
  GameConfigResponse,
  GameConfigOperationResponse
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

  /**
   * 获取游戏配置列表
   */
  async getGameConfigs(): Promise<GameConfigData> {
    const response = await fetch('/api/developer/game-configs', {
      headers: this.getHeaders(true)
    })

    const result: GameConfigResponse = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.message || '获取游戏配置失败')
    }

    return result.data
  }

  /**
   * 创建游戏配置
   */
  async createGameConfig(config: GameConfig): Promise<GameConfig> {
    const { key, ...configData } = config
    const response = await fetch('/api/developer/game-configs', {
      method: 'POST',
      headers: this.getHeaders(true),
      body: JSON.stringify({ key, config: configData })
    })

    const result: GameConfigOperationResponse = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.message || '创建游戏配置失败')
    }

    return result.data
  }

  /**
   * 更新游戏配置
   */
  async updateGameConfig(key: string, config: Omit<GameConfig, 'key'>): Promise<GameConfig> {
    const response = await fetch(`/api/developer/game-configs/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: this.getHeaders(true),
      body: JSON.stringify({ config })
    })

    const result: GameConfigOperationResponse = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.message || '更新游戏配置失败')
    }

    return result.data
  }

  /**
   * 删除游戏配置
   */
  async deleteGameConfig(key: string): Promise<void> {
    const response = await fetch(`/api/developer/game-configs/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: this.getHeaders(true)
    })

    const result: GameConfigOperationResponse = await response.json()

    if (!result.success) {
      throw new Error(result.message || '删除游戏配置失败')
    }
  }
}

// 导出单例实例
export const developerApi = DeveloperApiService.getInstance()
