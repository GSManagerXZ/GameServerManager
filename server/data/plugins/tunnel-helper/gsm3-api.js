/**
 * GSM3 插件API客户端
 * 提供插件与主面板通信的接口
 */
class GSM3API {
  constructor() {
    this.baseURL = '/api/plugin-api'
    this.token = null
    this.initializeToken()
  }

  /**
   * 初始化token获取机制
   */
  initializeToken() {
    try {
      // 检查是否已经通过脚本注入设置了全局token
      if (window.gsm3Token) {
        this.token = window.gsm3Token
        console.log('Token已从全局变量获取:', this.token)
        return
      }
      
      // 检查是否已经通过脚本注入设置了token
      if (window.gsm3 && window.gsm3.token) {
        this.token = window.gsm3.token
        console.log('Token已从注入脚本获取')
        return
      }
      
      // 尝试从父窗口获取token
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'gsm3-get-token' }, '*')
      }
      
      console.log('正在初始化token...')
    } catch (error) {
      console.warn('Token初始化失败:', error)
    }

    // 监听token更新
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'gsm3-token-update') {
        this.token = event.data.token
        console.log('通过消息更新Token:', this.token)
      }
    })
    
    // 定期检查全局token变量
    const checkGlobalToken = () => {
      if (!this.token && window.gsm3Token) {
        this.token = window.gsm3Token
        console.log('从全局变量延迟获取Token:', this.token)
      }
    }
    
    // 每100ms检查一次，最多检查50次（5秒）
    let checkCount = 0
    const tokenChecker = setInterval(() => {
      checkGlobalToken()
      checkCount++
      if (this.token || checkCount >= 50) {
        clearInterval(tokenChecker)
      }
    }, 100)
  }

  /**
   * 发送HTTP请求
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`
    const config = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Request': 'true', // 添加插件标识
        ...(this.token && { 'Authorization': `Bearer ${this.token}` })
      },
      ...options
    }

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body)
    }

    try {
      const response = await fetch(url, config)
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`)
      }
      
      return data
    } catch (error) {
      console.error('API请求失败:', error)
      throw error
    }
  }

  // ==================== 系统信息API ====================

  /**
   * 获取系统状态
   */
  async getSystemStatus() {
    return await this.request('/system/status')
  }

  /**
   * 获取系统信息
   */
  async getSystemInfo() {
    return await this.request('/system/info')
  }

  // ==================== 实例管理API ====================

  /**
   * 获取所有实例列表
   */
  async getInstances() {
    return await this.request('/instances')
  }

  /**
   * 获取单个实例信息
   * @param {string} instanceId 实例ID
   */
  async getInstance(instanceId) {
    return await this.request(`/instances/${instanceId}`)
  }

  /**
   * 获取实例状态
   * @param {string} instanceId 实例ID
   */
  async getInstanceStatus(instanceId) {
    return await this.request(`/instances/${instanceId}/status`)
  }

  /**
   * 创建新实例
   * @param {Object} instanceData 实例数据
   * @param {string} instanceData.name 实例名称
   * @param {string} instanceData.description 实例描述
   * @param {string} instanceData.workingDirectory 工作目录
   * @param {string} instanceData.startCommand 启动命令
   * @param {boolean} instanceData.autoStart 是否自动启动
   * @param {string} instanceData.stopCommand 停止命令
   */
  async createInstance(instanceData) {
    return await this.request('/instances', {
      method: 'POST',
      body: instanceData
    })
  }

  /**
   * 更新实例
   * @param {string} instanceId 实例ID
   * @param {Object} instanceData 实例数据
   */
  async updateInstance(instanceId, instanceData) {
    return await this.request(`/instances/${instanceId}`, {
      method: 'PUT',
      body: instanceData
    })
  }

  /**
   * 删除实例
   * @param {string} instanceId 实例ID
   */
  async deleteInstance(instanceId) {
    return await this.request(`/instances/${instanceId}`, {
      method: 'DELETE'
    })
  }

  /**
   * 启动实例
   * @param {string} instanceId 实例ID
   */
  async startInstance(instanceId) {
    return await this.request(`/instances/${instanceId}/start`, {
      method: 'POST'
    })
  }

  /**
   * 停止实例
   * @param {string} instanceId 实例ID
   */
  async stopInstance(instanceId) {
    return await this.request(`/instances/${instanceId}/stop`, {
      method: 'POST'
    })
  }

  /**
   * 重启实例
   * @param {string} instanceId 实例ID
   */
  async restartInstance(instanceId) {
    return await this.request(`/instances/${instanceId}/restart`, {
      method: 'POST'
    })
  }

  /**
   * 获取实例市场列表
   */
  async getMarketInstances() {
    return await this.request('/instances/market')
  }

  // ==================== 终端管理API ====================

  /**
   * 获取终端会话列表
   */
  async getTerminals() {
    return await this.request('/terminals')
  }

   /**
   * 获取终端会话统计信息
   */
  async getTerminalStats() {
    return await this.request('/terminals/stats', {
      method: 'GET'
    })
  }

  /**
   * 获取终端会话详细信息
   */
  async getTerminalSessions() {
    return await this.request('/terminals/sessions', {
      method: 'GET'
    })
  }

  /**
   * 获取活跃终端进程信息
   */
  async getActiveTerminalProcesses() {
    return await this.request('/terminals/active-processes', {
      method: 'GET'
    })
  }

  /**
   * 更新终端会话名称
   * @param {string} sessionId 会话ID
   * @param {string} name 新的会话名称
   */
  async updateTerminalSessionName(sessionId, name) {
    return await this.request(`/terminals/sessions/${sessionId}/name`, {
      method: 'PUT',
      body: { name }
    })
  }

  /**
   * 验证终端配置
   * @param {string} workingDirectory 工作目录
   * @param {string} shell Shell程序路径
   */
  async validateTerminalConfig(workingDirectory, shell) {
    return await this.request('/terminals/validate-config', {
      method: 'POST',
      body: { workingDirectory, shell }
    })
  }

  /**
   * 获取系统默认Shell信息
   */
  async getDefaultShell() {
    return await this.request('/terminals/default-shell', {
      method: 'GET'
    })
  }

  /**
   * 获取终端主题配置
   */
  async getTerminalThemes() {
    return await this.request('/terminals/themes', {
      method: 'GET'
    })
  }

  /**
   * 获取终端字体配置
   */
  async getTerminalFonts() {
    return await this.request('/terminals/fonts', {
      method: 'GET'
    })
  }

  /**
   * 测试终端连接
   * @param {string} workingDirectory 工作目录
   */
  async testTerminalConnection(workingDirectory) {
    return await this.request('/terminals/test-connection', {
      method: 'POST',
      body: { workingDirectory }
    })
  }

  // ==================== 游戏管理API ====================

  /**
   * 获取游戏列表
   */
  async getGames() {
    return await this.request('/games')
  }

  // ==================== 文件操作API ====================

  /**
   * 读取文件内容
   * @param {string} filePath 文件路径（相对于服务器data目录）
   * @param {string} encoding 文件编码，默认为'utf-8'，二进制文件使用'binary'
   */
  async readFile(filePath, encoding = 'utf-8') {
    return await this.request('/files/read', {
      method: 'POST',
      body: { filePath, encoding }
    })
  }

  /**
   * 写入文件内容
   * @param {string} filePath 文件路径（相对于服务器data目录）
   * @param {string} content 文件内容
   * @param {string} encoding 文件编码，默认为'utf-8'
   */
  async writeFile(filePath, content, encoding = 'utf-8') {
    return await this.request('/files/write', {
      method: 'POST',
      body: { filePath, content, encoding }
    })
  }

  /**
   * 删除文件
   * @param {string} filePath 文件路径（相对于服务器data目录）
   */
  async deleteFile(filePath) {
    return await this.request('/files/delete', {
      method: 'DELETE',
      body: { filePath }
    })
  }

  /**
   * 创建目录
   * @param {string} dirPath 目录路径（相对于服务器data目录）
   * @param {boolean} recursive 是否递归创建父目录，默认为true
   */
  async createDirectory(dirPath, recursive = true) {
    return await this.request('/files/mkdir', {
      method: 'POST',
      body: { dirPath, recursive }
    })
  }

  /**
   * 删除目录
   * @param {string} dirPath 目录路径（相对于服务器data目录）
   * @param {boolean} recursive 是否递归删除，默认为false
   */
  async deleteDirectory(dirPath, recursive = false) {
    return await this.request('/files/rmdir', {
      method: 'DELETE',
      body: { dirPath, recursive }
    })
  }

  /**
   * 列出目录内容
   * @param {string} dirPath 目录路径（相对于服务器data目录），默认为根目录
   * @param {boolean} includeHidden 是否包含隐藏文件，默认为false
   */
  async listDirectory(dirPath = '', includeHidden = false) {
    return await this.request('/files/list', {
      method: 'POST',
      body: { dirPath, includeHidden }
    })
  }

  /**
   * 获取文件或目录信息
   * @param {string} path 文件或目录路径（相对于服务器data目录）
   */
  async getFileInfo(path) {
    return await this.request('/files/info', {
      method: 'POST',
      body: { path }
    })
  }

  /**
   * 检查文件或目录是否存在
   * @param {string} path 文件或目录路径（相对于服务器data目录）
   */
  async exists(path) {
    return await this.request('/files/exists', {
      method: 'POST',
      body: { path }
    })
  }

  /**
   * 复制文件或目录
   * @param {string} sourcePath 源路径（相对于服务器data目录）
   * @param {string} destPath 目标路径（相对于服务器data目录）
   * @param {boolean} overwrite 是否覆盖已存在的文件，默认为false
   */
  async copy(sourcePath, destPath, overwrite = false) {
    return await this.request('/files/copy', {
      method: 'POST',
      body: { sourcePath, destPath, overwrite }
    })
  }

  /**
   * 移动/重命名文件或目录
   * @param {string} sourcePath 源路径（相对于服务器data目录）
   * @param {string} destPath 目标路径（相对于服务器data目录）
   * @param {boolean} overwrite 是否覆盖已存在的文件，默认为false
   */
  async move(sourcePath, destPath, overwrite = false) {
    return await this.request('/files/move', {
      method: 'POST',
      body: { sourcePath, destPath, overwrite }
    })
  }

  /**
   * 搜索文件
   * @param {string} pattern 搜索模式（支持通配符）
   * @param {string} searchPath 搜索路径（相对于服务器data目录），默认为根目录
   * @param {boolean} recursive 是否递归搜索子目录，默认为true
   */
  async searchFiles(pattern, searchPath = '', recursive = true) {
    return await this.request('/files/search', {
      method: 'POST',
      body: { pattern, searchPath, recursive }
    })
  }

  // ==================== 通用API ====================

  /**
   * 获取API版本信息
   */
  async getVersion() {
    return await this.request('/version')
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    return await this.request('/health')
  }

  // ==================== 工具方法 ====================

  /**
   * 显示通知消息（如果主面板支持）
   * @param {string} type 消息类型: 'info', 'success', 'warning', 'error'
   * @param {string} message 消息内容
   */
  showNotification(type, message) {
    try {
      // 尝试向父窗口发送通知消息
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'gsm3-notification',
          data: { type, message }
        }, '*')
      } else {
        // 如果无法发送到父窗口，使用浏览器原生通知
        console.log(`[${type.toUpperCase()}] ${message}`)
      }
    } catch (error) {
      console.warn('发送通知失败:', error)
    }
  }

  /**
   * 格式化字节大小
   * @param {number} bytes 字节数
   * @param {number} decimals 小数位数
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes'
    
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  /**
   * 格式化时间戳
   * @param {string|number|Date} timestamp 时间戳
   */
  formatTime(timestamp) {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  /**
   * 格式化运行时间
   * @param {number} seconds 秒数
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    const parts = []
    if (days > 0) parts.push(`${days}天`)
    if (hours > 0) parts.push(`${hours}小时`)
    if (minutes > 0) parts.push(`${minutes}分钟`)
    if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`)
    
    return parts.join(' ')
  }
}

// 创建全局实例
window.gsm3 = new GSM3API()

// 添加初始化状态标记
window.gsm3.isInitialized = false
window.gsm3.initPromise = null

// 初始化API的Promise
window.gsm3.initialize = function() {
  if (this.initPromise) {
    return this.initPromise
  }
  
  this.initPromise = new Promise((resolve) => {
    const checkReady = () => {
      if (this.token) {
        this.isInitialized = true
        console.log('GSM3 API初始化完成，Token:', this.token)
        resolve(true)
      } else {
        setTimeout(checkReady, 100)
      }
    }
    checkReady()
  })
  
  return this.initPromise
}

// 监听来自父窗口的消息
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'gsm3-token-update') {
    window.gsm3.token = event.data.token
    console.log('Token已更新:', event.data.token)
  }
})

// 插件加载完成后的初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('GSM3 插件API已加载')
  
  // 启动初始化过程
  window.gsm3.initialize().then(() => {
    console.log('GSM3 API准备就绪')
    
    // 向父窗口发送插件加载完成的消息
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'gsm3-plugin-loaded',
        data: { timestamp: new Date().toISOString() }
      }, '*')
    }
  })
})