import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { LoginRequest, LoginResponse, RegisterRequest, RegisterResponse, HasUsersResponse, ApiResponse, User, Instance, CreateInstanceRequest, CaptchaResponse, CheckCaptchaResponse } from '@/types'
import config from '@/config'
import { useNotificationStore } from '@/stores/notificationStore'

class ApiClient {
  private client: AxiosInstance
  private token: string | null = null

  constructor() {
    this.client = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: config.requestTimeout,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // 请求拦截器
    this.client.interceptors.request.use(
      (config) => {
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // 响应拦截器
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        return response
      },
      (error) => {
        if (error.response?.status === 401) {
          // 只记录认证失败信息，不自动跳转登录页面
          console.warn('认证失败，请检查登录状态')
          
          // 添加消息通知
          try {
            const { addNotification } = useNotificationStore.getState()
            addNotification({
              type: 'error',
              title: '认证失败',
              message: '您的登录状态已过期，请退出重新登录',
              duration: 5000
            })
          } catch (notificationError) {
            console.error('添加通知失败:', notificationError)
          }
          
          // 调用authStore的handleTokenExpired方法处理token过期
          try {
            // 动态导入避免循环依赖
            import('@/stores/authStore').then(({ useAuthStore }) => {
              const { handleTokenExpired } = useAuthStore.getState()
              handleTokenExpired()
            })
          } catch (authError) {
            console.error('处理token过期失败:', authError)
          }
        }
        return Promise.reject(error)
      }
    )

    // 从localStorage恢复token
    this.loadToken()
  }

  private loadToken() {
    const token = localStorage.getItem('gsm3_token')
    if (token) {
      this.setToken(token)
    }
  }

  setToken(token: string) {
    this.token = token
    localStorage.setItem('gsm3_token', token)
  }

  clearToken() {
    this.token = null
    localStorage.removeItem('gsm3_token')
    localStorage.removeItem('gsm3_user')
  }

  getToken(): string | null {
    return this.token
  }

  // 通用请求方法
  private async request<T = any>(
    config: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.request<ApiResponse<T>>(config)
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        throw error.response.data
      }
      throw {
        success: false,
        error: '网络错误',
        message: error.message || '请求失败，请检查网络连接',
      }
    }
  }

  // GET请求
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url })
  }

  // POST请求
  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data })
  }

  // PUT请求
  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data })
  }

  // DELETE请求
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url })
  }

  // PATCH请求
  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, data })
  }

  // 认证相关API
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    try {
      const response = await this.client.post<LoginResponse>('/auth/login', credentials)
      const result = response.data
      
      if (result.success && result.token) {
        this.setToken(result.token)
        if (result.user) {
          localStorage.setItem('gsm3_user', JSON.stringify(result.user))
        }
      }
      
      return result
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      return {
        success: false,
        message: error.message || '登录失败，请检查网络连接',
      }
    }
  }

  async getCaptcha(): Promise<CaptchaResponse> {
    try {
      const response = await this.client.get<CaptchaResponse>('/auth/captcha')
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      return {
        success: false,
        captcha: { id: '', svg: '' }
      }
    }
  }

  async checkCaptchaRequired(username: string): Promise<CheckCaptchaResponse> {
    try {
      const response = await this.client.post<CheckCaptchaResponse>('/auth/check-captcha', { username })
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      return {
        success: false,
        requireCaptcha: false
      }
    }
  }

  async verifyToken(): Promise<{ success: boolean; user?: User; message?: string }> {
    try {
      const response = await this.client.get('/auth/verify')
      return response.data
    } catch (error: any) {
      // 不再自动清除token，让调用方决定如何处理
      return {
        success: false,
        message: error.response?.data?.message || 'Token验证失败',
      }
    }
  }

  async logout(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.client.post('/auth/logout')
      this.clearToken()
      return response.data
    } catch (error: any) {
      this.clearToken()
      return {
        success: true,
        message: '已登出',
      }
    }
  }

  async hasUsers(): Promise<HasUsersResponse> {
    try {
      const response = await this.client.get<HasUsersResponse>('/auth/has-users')
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      return {
        success: false,
        hasUsers: true // 默认假设有用户，避免意外的注册界面
      }
    }
  }

  async register(credentials: RegisterRequest): Promise<RegisterResponse> {
    try {
      const response = await this.client.post<RegisterResponse>('/auth/register', credentials)
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      return {
        success: false,
        message: error.message || '注册失败，请检查网络连接',
      }
    }
  }

  // 校验赞助者密钥
  async validateSponsorKey(key: string): Promise<ApiResponse<any>> {
    return this.post('/sponsor/validate-key', { key })
  }

  // 获取已保存的赞助者密钥信息
  async getSponsorKeyInfo(): Promise<ApiResponse<any>> {
    return this.get('/sponsor/key-info')
  }

  // 清除已保存的赞助者密钥
  async clearSponsorKey(): Promise<ApiResponse<any>> {
    return this.delete('/sponsor/clear-key')
  }

  async changePassword(
    oldPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.client.post('/auth/change-password', {
        oldPassword,
        newPassword,
      })
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      return {
        success: false,
        message: error.message || '修改密码失败',
      }
    }
  }

  async changeUsername(
    newUsername: string
  ): Promise<{ success: boolean; message: string; user?: User }> {
    try {
      const response = await this.client.post('/auth/change-username', {
        newUsername,
      })
      
      // 如果修改成功，更新本地存储的用户信息
      if (response.data.success && response.data.user) {
        localStorage.setItem('gsm3_user', JSON.stringify(response.data.user))
      }
      
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      return {
        success: false,
        message: error.message || '修改用户名失败',
      }
    }
  }

  // 系统相关API
  async getSystemStats() {
    return this.get('/system/stats')
  }

  async getActivePorts() {
    return this.get('/system/ports')
  }

  async getSystemInfo() {
    return this.get('/system/info')
  }

  async getProcessList() {
    return this.get('/system/processes')
  }

  async killProcess(pid: number, force: boolean = false) {
    return this.post(`/system/processes/${pid}/kill`, { force })
  }

  async getActiveTerminalProcesses() {
    return this.get('/terminal/active-processes')
  }

  // 磁盘选择相关API
  async getDiskList() {
    return this.get('/system/disks')
  }

  async setSelectedDisk(disk: string) {
    return this.post('/system/disk/select', { disk })
  }

  async getSelectedDisk() {
    return this.get('/system/disk/selected')
  }

  // 网络接口相关API
  async getNetworkInterfaces() {
    return this.get('/system/network/interfaces')
  }

  async setSelectedNetworkInterface(interfaceName: string) {
    return this.post('/system/network/select', { interfaceName })
  }

  async getSelectedNetworkInterface() {
    return this.get('/system/network/selected')
  }

  // 终端相关API
  async getTerminalSessions() {
    return this.get('/terminal/sessions')
  }

  async createTerminalSession(name?: string) {
    return this.post('/terminal/create', { name })
  }

  async closeTerminalSession(sessionId: string) {
    return this.post('/terminal/close', { sessionId })
  }

  async updateTerminalSessionName(sessionId: string, name: string) {
    return this.put(`/terminal/sessions/${sessionId}/name`, { name })
  }

  // 游戏相关API
  async getGameServers() {
    return this.get('/game/servers')
  }

  async createGameServer(config: any) {
    return this.post('/game/create', config)
  }

  async startGameServer(gameId: string) {
    return this.post(`/game/${gameId}/start`)
  }

  async stopGameServer(gameId: string) {
    return this.post(`/game/${gameId}/stop`)
  }

  async deleteGameServer(gameId: string) {
    return this.delete(`/game/${gameId}`)
  }

  // 文件管理API
  async getFiles(path: string) {
    return this.get('/files/list', { params: { path } })
  }

  async uploadFile(file: File, path: string) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', path)
    
    return this.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  }

  async downloadFile(path: string) {
    try {
      const response = await this.client.get('/files/download', {
        params: { path },
        responseType: 'blob',
      })
      return response.data
    } catch (error) {
      throw error
    }
  }

  async deleteFile(path: string) {
    return this.delete('/files', { params: { path } })
  }

  async createFolder(path: string, name: string) {
    return this.post('/files/folder', { path, name })
  }

  // 实例管理API
  async getInstances() {
    return this.get<Instance[]>('/instances')
  }

  async createInstance(data: CreateInstanceRequest) {
    return this.post<Instance>('/instances', data)
  }

  async updateInstance(id: string, data: CreateInstanceRequest) {
    return this.put<Instance>(`/instances/${id}`, data)
  }

  async deleteInstance(id: string) {
    return this.delete(`/instances/${id}`)
  }

  async startInstance(id: string) {
    return this.post(`/instances/${id}/start`)
  }

  async stopInstance(id: string) {
    return this.post(`/instances/${id}/stop`)
  }

  async closeTerminal(id: string) {
    return this.post(`/instances/${id}/close-terminal`)
  }

  async getInstanceStatus(id: string) {
    return this.get(`/instances/${id}/status`)
  }

  // 实例市场API
  async getMarketInstances() {
    return this.get('/instances/market')
  }

  // 游戏部署API
  async getInstallableGames() {
    return this.get('/game-deployment/games')
  }

  async checkGameMemory(gameKey: string) {
    return this.post('/game-deployment/check-memory', { gameKey })
  }

  async installGame(data: {
    gameKey: string
    gameName: string
    appId: string
    installPath: string
    instanceName: string
    useAnonymous: boolean
    steamUsername?: string
    steamPassword?: string
    steamcmdCommand: string
  }) {
    return this.post('/game-deployment/install', data)
  }

  // 定时任务API
  async getScheduledTasks() {
    return this.get('/scheduled-tasks')
  }

  async createScheduledTask(data: any) {
    return this.post('/scheduled-tasks', data)
  }

  async updateScheduledTask(id: string, data: any) {
    return this.put(`/scheduled-tasks/${id}`, data)
  }

  async deleteScheduledTask(id: string) {
    return this.delete(`/scheduled-tasks/${id}`)
  }

  async toggleScheduledTask(id: string, enabled: boolean) {
    return this.patch(`/scheduled-tasks/${id}/toggle`, { enabled })
  }

  // Minecraft服务端API
  async getMinecraftServerCategories() {
    return this.get('/minecraft/server-categories')
  }

  async getMinecraftVersions(server: string) {
    return this.get(`/minecraft/versions/${server}`)
  }

  async getMinecraftDownloadInfo(server: string, version: string) {
    return this.get(`/minecraft/download-info/${server}/${version}`)
  }

  async downloadMinecraftServer(data: {
    server: string
    version: string
    targetDirectory: string
    skipJavaCheck?: boolean
    skipServerRun?: boolean
    socketId?: string
  }) {
    return this.post('/minecraft/download', data)
  }

  async cancelMinecraftDownload(downloadId: string) {
    return this.post('/minecraft/cancel-download', { downloadId })
  }

  async createMinecraftInstance(data: {
    name: string
    description?: string
    workingDirectory: string
    serverType: string
    version: string
    javaPath?: string
    javaArgs?: string
    serverArgs?: string
    maxMemory?: number
    minMemory?: number
  }) {
    return this.post('/minecraft/create-instance', data)
  }

  async validateJavaEnvironment() {
    return this.get('/minecraft/validate-java')
  }

  // 更多游戏部署API
  async getMoreGames() {
    return this.get('/more-games/games')
  }

  async getMoreGameInfo(gameId: string) {
    return this.get(`/more-games/games/${gameId}`)
  }

  async deployTModLoader(data: {
    installPath: string
    options?: {
      deleteAfterExtract?: boolean
      clearExtractDir?: boolean
      createVersionDir?: boolean
    }
    socketId?: string
  }) {
    return this.post('/more-games/deploy/tmodloader', data)
  }

  async deployFactorio(data: {
    installPath: string
    options?: {
      tempDir?: string
    }
    socketId?: string
  }) {
    return this.post('/more-games/deploy/factorio', data)
  }

  async getMoreGameDeploymentStatus(gameId: string, installPath: string) {
    return this.get(`/more-games/status/${gameId}/${encodeURIComponent(installPath)}`)
  }

  async getMoreGameVersion(gameId: string) {
    return this.get(`/more-games/version/${gameId}`)
  }

  async cancelMoreGameDeployment(deploymentId: string) {
    return this.post('/more-games/cancel-deployment', { deploymentId })
  }

  // Minecraft整合包API
  async searchMrpackModpacks(options: {
    query?: string
    limit?: number
    offset?: number
    categories?: string[]
    versions?: string[]
    loaders?: string[]
  } = {}) {
    const params = new URLSearchParams()
    if (options.query) params.append('query', options.query)
    if (options.limit) params.append('limit', options.limit.toString())
    if (options.offset) params.append('offset', options.offset.toString())
    if (options.categories) params.append('categories', options.categories.join(','))
    if (options.versions) params.append('versions', options.versions.join(','))
    if (options.loaders) params.append('loaders', options.loaders.join(','))
    
    return this.get(`/more-games/mrpack/search?${params.toString()}`)
  }

  async getMrpackProjectVersions(projectId: string) {
    return this.get(`/more-games/mrpack/project/${projectId}/versions`)
  }

  async deployMrpack(data: {
    projectId: string
    versionId: string
    installPath: string
    options?: {
      javaPath?: string
      maxMemory?: string
      minMemory?: string
    }
    socketId?: string
  }) {
    return this.post('/more-games/deploy/mrpack', data)
  }

  // 游戏配置文件API
  async getGameConfigTemplates() {
    return this.get('/gameconfig/templates')
  }

  async getGameConfigTemplate(gameName: string) {
    return this.get(`/gameconfig/templates/${encodeURIComponent(gameName)}`)
  }

  async readGameConfig(instanceId: string, gameName: string) {
    return this.get(`/gameconfig/instances/${instanceId}/${encodeURIComponent(gameName)}`)
  }

  async createGameConfig(instanceId: string, gameName: string) {
    return this.post(`/gameconfig/instances/${instanceId}/${encodeURIComponent(gameName)}/create`)
  }

  async saveGameConfig(instanceId: string, gameName: string, config: any) {
    return this.post(`/gameconfig/instances/${instanceId}/${encodeURIComponent(gameName)}`, { config })
  }

  async validateGameConfig(gameName: string, config: any) {
    return this.post(`/gameconfig/validate/${encodeURIComponent(gameName)}`, { config })
  }

  async getGameConfigRaw(instanceId: string, gameName: string) {
    return this.get(`/gameconfig/instances/${instanceId}/${encodeURIComponent(gameName)}/raw`)
  }

  // Python环境检测API
  async checkPythonEnvironment() {
    return this.get('/instances/python/check')
  }

  // 在线部署API
  async getOnlineGames() {
    return this.get('/online-deploy/games')
  }

  async deployOnlineGame(data: {
    gameId: string
    installPath: string
    socketId?: string
  }) {
    return this.post('/online-deploy/deploy', data)
  }

  async cancelOnlineGameDeployment(deploymentId: string) {
    return this.post('/online-deploy/cancel', { deploymentId })
  }

  // 终端配置API
  async getTerminalConfig() {
    return this.get('/config/terminal')
  }

  async updateTerminalConfig(config: { defaultUser: string }) {
    return this.put('/config/terminal', config)
  }

  // 游戏配置API
  async getGameConfig() {
    return this.get('/config/game')
  }

  async updateGameConfig(config: { defaultInstallPath: string }) {
    return this.put('/config/game', config)
  }

  // Steam游戏部署清单API
  async updateSteamGameList() {
    return this.post('/game-deployment/update-game-list')
  }

  // RCON API
  async getRconConfig(instanceId: string) {
    return this.get(`/rcon/${instanceId}/config`)
  }

  async saveRconConfig(instanceId: string, config: {
    host: string
    port: number
    password: string
    timeout?: number
  }) {
    return this.post(`/rcon/${instanceId}/config`, config)
  }

  async connectRcon(instanceId: string) {
    return this.post(`/rcon/${instanceId}/connect`)
  }

  async disconnectRcon(instanceId: string) {
    return this.post(`/rcon/${instanceId}/disconnect`)
  }

  async getRconStatus(instanceId: string) {
    return this.get(`/rcon/${instanceId}/status`)
  }

  async executeRconCommand(instanceId: string, command: string) {
    return this.post(`/rcon/${instanceId}/command`, { command })
  }

  // 环境管理API
  async getEnvironmentSystemInfo() {
    return this.get('/environment/system-info')
  }

  async getJavaEnvironments() {
    return this.get('/environment/java')
  }

  async installJavaEnvironment(data: {
    version: string
    downloadUrl: string
    platform: string
    socketId?: string
  }) {
    return this.post('/environment/java/install', data)
  }

  async uninstallJavaEnvironment(version: string) {
    return this.delete(`/environment/java/${version}`)
  }

  async verifyJavaEnvironment(version: string) {
    return this.get(`/environment/java/${version}/verify`)
  }

  // Visual C++运行库管理API
  async getVcRedistEnvironments() {
    return this.get('/environment/vcredist')
  }

  async installVcRedistEnvironment(data: {
    version: string
    architecture: string
    downloadUrl: string
    socketId?: string
  }) {
    return this.post('/environment/vcredist/install', data)
  }

  async uninstallVcRedistEnvironment(version: string, architecture: string, socketId?: string) {
    return this.delete(`/environment/vcredist/${version}/${architecture}`, {
      data: { socketId }
    })
  }

  async verifyVcRedistEnvironment(version: string, architecture: string) {
    return this.get(`/environment/vcredist/${version}/${architecture}/verify`)
  }

  // DirectX管理API
  async getDirectXEnvironments() {
    return this.get('/environment/directx')
  }

  async installDirectXEnvironment(data: {
    downloadUrl: string
    socketId?: string
  }) {
    return this.post('/environment/directx/install', data)
  }

  async uninstallDirectXEnvironment() {
    return this.delete('/environment/directx')
  }

  // 动态链接库管理API
  async getPackageManagers() {
    return this.get('/environment/package-managers')
  }

  async getPackageList(packageManager: string) {
    return this.get(`/environment/packages/${packageManager}`)
  }

  async installPackages(data: {
    packageManager: string
    packages: string[]
    socketId?: string
  }) {
    return this.post(`/environment/packages/${data.packageManager}/install`, {
      packages: data.packages,
      socketId: data.socketId
    })
  }

  async uninstallPackages(data: {
    packageManager: string
    packages: string[]
    socketId?: string
  }) {
    return this.post(`/environment/packages/${data.packageManager}/uninstall`, {
      packages: data.packages,
      socketId: data.socketId
    })
  }
}

// 创建单例实例
const apiClient = new ApiClient()

export default apiClient
export { ApiClient }