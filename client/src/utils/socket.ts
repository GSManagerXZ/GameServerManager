import { io, Socket } from 'socket.io-client'
import type { CreateTerminalRequest, SocketEvents, TerminalErrorEvent } from '@/types'
import config from '@/config'

class SocketClient {
  private socket: Socket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Map<string, Function[]> = new Map()
  private isInitialized = false
  private isLowPowerMode = false
  private lowPowerModeCallbacks: Function[] = []
  private visibilityChangeHandler?: () => void
  private intersectionObserver?: IntersectionObserver
  private disconnectContext: 'manual' | 'low-power' | 'auth-update' | null = null
  /**
   * ACK-owned close-pty 重试队列（N2-I2）：
   * - pendingCloseOnReconnect：待发送项（断线时 closeTerminal 入队，或已发送未确认项在
   *   断线时放回）；
   * - awaitingCloseAck：当前连接已发送、等待 pty-closed/terminal-exit（或明确失败）的请求；
   * - closeSentForConnection：当前连接已发送过的 ID（同一连接内自动重发只发生一次，
   *   防重发风暴）。
   * 只有收到 pty-closed / terminal-exit（确认关闭）才从队列移除；terminal-error
   * {operation:'close', retained:true} 表示该次 close 未完成（target 被保留），放回待发送
   * 队列，下次连接自动重发（服务端对 retained target 每次 close-pty 都重新驱动有界关闭）。
   * 队列挂在单例上，跨页面卸载存活——页面卸载不再能丢失唯一 cleanup handle。
   */
  private pendingCloseOnReconnect = new Set<string>()
  private awaitingCloseAck = new Set<string>()
  private closeSentForConnection = new Set<string>()

  constructor() {
    // 不在构造函数中立即连接，等待用户登录后再连接
  }

  // 初始化连接（仅在用户登录后调用）
  initialize() {
    if (!this.isInitialized) {
      const connected = this.connect()
      this.isInitialized = connected
    }
  }

  private connect(forceRecreate = false): boolean {
    const token = localStorage.getItem('gsm3_token')

    // 如果没有token，不建立连接
    if (!token) {
      console.log('没有找到认证token，跳过Socket连接')
      return false
    }

    if (this.socket && !forceRecreate) {
      this.socket.auth = { token }
      if (!this.socket.connected) {
        this.socket.connect()
      }
      return true
    }

    this.clearReconnectTimer()
    this.destroySocket()

    const nextSocket = io(config.serverUrl, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
      timeout: config.socketTimeout,
      forceNew: true,
      reconnection: false,
    })

    this.socket = nextSocket
    this.setupEventListeners(nextSocket)
    this.attachStoredListeners(nextSocket)
    return true
  }

  private setupEventListeners(socket: Socket) {
    socket.on('connect', () => {
      console.log('Socket连接成功:', socket.id)
      this.disconnectContext = null
      this.clearReconnectTimer()
      this.reconnectAttempts = 0
      this.emit('connection-status', { connected: true })
      // 重发断线期间排队的 close 请求（N2-I2：ACK-owned，发送后保留到确认/断线放回）
      this.flushPendingCloseOnReconnect()
    })

    socket.on('disconnect', (reason) => {
      console.log('Socket断开连接:', reason)
      // N2-I2：已发送未确认的 close 请求放回待发送队列——服务端会在断开时移除 requester，
      // 若 target 再次 timeout retained，重连后必须重发，否则唯一 cleanup handle 随断线丢失。
      for (const sessionId of this.awaitingCloseAck) {
        this.pendingCloseOnReconnect.add(sessionId)
      }
      this.awaitingCloseAck.clear()
      this.closeSentForConnection.clear()

      this.emit('connection-status', { connected: false, reason })

      if (this.shouldReconnect(reason)) {
        this.reconnect(reason)
      }

      this.disconnectContext = null
    })

    // N2-I2：close 请求的 ACK 跟踪（队列在单例上，跨页面卸载存活）
    socket.on('pty-closed', (data: { sessionId: string }) => {
      this.handleCloseAcknowledged(data?.sessionId)
    })
    socket.on('terminal-exit', (data: { sessionId: string }) => {
      this.handleCloseAcknowledged(data?.sessionId)
    })
    socket.on('terminal-error', (data: TerminalErrorEvent) => {
      if (data?.operation === 'close' && data?.retained) {
        // 该次 close 未完成（target 被服务端保留）：放回待发送队列，下次连接自动重发
        if (this.awaitingCloseAck.delete(data.sessionId)) {
          this.pendingCloseOnReconnect.add(data.sessionId)
        }
      }
    })

    socket.on('connect_error', (error) => {
      console.error('Socket连接错误:', error)
      this.emit('connection-status', { connected: false, reason: 'connect_error' })
      this.emit('connection-error', { error: error.message })

      if (this.isAuthError(error.message)) {
        this.handleAuthError(error.message)
        return
      }

      this.reconnect('connect_error')
    })

    socket.on('error', (error) => {
      console.error('Socket错误:', error)
      this.emit('socket-error', { error })
    })

    // 认证错误处理
    socket.on('auth-error', (error) => {
      const errorMessage = typeof error === 'string' ? error : error?.message || '认证失败'
      console.error('Socket认证错误:', error)
      this.handleAuthError(errorMessage)
    })
  }

  private attachStoredListeners(socket: Socket) {
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach(callback => {
        socket.on(event, callback as any)
      })
    })
  }

  private destroySocket() {
    if (!this.socket) {
      return
    }

    // N2-I2：removeAllListeners 会阻止 disconnect handler 把未确认 close 放回队列，
    // 因此先在这里显式迁移（未确认项在重连后重发，不随 socket 销毁丢失）。
    for (const sessionId of this.awaitingCloseAck) {
      this.pendingCloseOnReconnect.add(sessionId)
    }
    this.awaitingCloseAck.clear()
    this.closeSentForConnection.clear()

    this.socket.removeAllListeners()
    this.socket.disconnect()
    this.socket = null
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private shouldReconnect(reason?: string) {
    if (this.isLowPowerMode) {
      return false
    }

    if (this.disconnectContext === 'manual' || this.disconnectContext === 'low-power') {
      return false
    }

    // 客户端主动断开通常不需要重连，但这里保留兜底，
    // 以处理意外进入该状态后无法恢复的情况。
    return reason !== 'io client disconnect'
  }

  private isAuthError(message?: string) {
    if (!message) {
      return false
    }

    return message.includes('Authentication error') || message.includes('Invalid token')
  }

  private handleAuthError(message: string) {
    this.disconnectContext = 'manual'
    this.clearReconnectTimer()
    this.emit('auth-error', { error: message })
    localStorage.removeItem('gsm3_token')
    window.location.href = '/login'
  }

  private reconnect(reason?: string) {
    const token = localStorage.getItem('gsm3_token')
    if (!token) {
      console.warn('缺少认证token，取消重连')
      return
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('达到最大重连次数，停止重连')
      this.emit('max-reconnect-attempts', {})
      return
    }

    this.clearReconnectTimer()
    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    const shouldRecreateSocket = reason === 'client namespace disconnect' || reason === 'connect_error'

    console.log(`${delay}ms后尝试第${this.reconnectAttempts}次重连...`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null

      if (shouldRecreateSocket || !this.socket) {
        this.connect(true)
        return
      }

      this.socket.auth = { token }
      this.socket.connect()
    }, delay)
  }

  // 发送事件
  emit(event: string, data?: any) {
    // 首先触发本地监听器
    this.emitLocal(event, data)

    // 然后尝试向服务器发送事件
    if (this.socket?.connected) {
      this.socket.emit(event, data)
    } else {
      console.warn('Socket未连接，无法发送事件:', event)
    }
  }

  // 触发本地监听器
  private emitLocal(event: string, data?: any) {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`执行事件监听器时出错 (${event}):`, error)
        }
      })
    }
  }

  // 监听事件
  on<K extends keyof SocketEvents>(event: K, callback: SocketEvents[K]): void
  on(event: string, callback: Function): void
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }

    this.listeners.get(event)!.push(callback)

    if (this.socket) {
      this.socket.on(event, callback as any)
    }
  }

  // 取消监听事件
  off(event: string, callback?: Function) {
    if (callback) {
      const listeners = this.listeners.get(event)
      if (listeners) {
        const index = listeners.indexOf(callback)
        if (index > -1) {
          listeners.splice(index, 1)
        }
      }

      if (this.socket) {
        this.socket.off(event, callback as any)
      }
    } else {
      // 移除所有监听器
      this.listeners.delete(event)
      if (this.socket) {
        this.socket.off(event)
      }
    }
  }

  // 一次性监听
  once(event: string, callback: Function) {
    if (this.socket) {
      this.socket.once(event, callback as any)
    }
  }

  // 获取连接状态
  isConnected(): boolean {
    return this.socket?.connected || false
  }

  // 获取Socket ID
  getId(): string | undefined {
    return this.socket?.id
  }

  // 手动重连
  reconnectManually() {
    this.reconnectAttempts = 0
    this.disconnectContext = null
    this.clearReconnectTimer()
    this.connect(true)
    this.isInitialized = !!this.socket
  }

  // 断开连接
  disconnect() {
    this.disconnectContext = 'manual'
    this.clearReconnectTimer()
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.listeners.clear()
    this.isInitialized = false
  }

  // 更新认证token
  updateAuth(token: string) {
    localStorage.setItem('gsm3_token', token)

    if (this.socket) {
      this.disconnectContext = 'auth-update'
      this.clearReconnectTimer()
      this.isInitialized = this.connect(true)
    } else {
      // 如果socket不存在，初始化连接
      this.initialize()
    }
  }

  // 终端相关方法
  createTerminal(data: CreateTerminalRequest): void {
    this.emit('create-pty', data)
  }

  sendTerminalInput(sessionId: string, data: string) {
    this.emit('terminal-input', { sessionId, data })
  }

  resizeTerminal(sessionId: string, cols: number, rows: number) {
    this.emit('terminal-resize', { sessionId, cols, rows })
  }

  closeTerminal(sessionId: string) {
    if (this.socket?.connected) {
      // N2-I2：已在飞行且未收到结果（pty-closed/terminal-exit/明确失败）时幂等跳过——
      // 该请求已被 ACK-owned 队列跟踪，unmount/重复点击不会重复发送；断线时自动回到
      // 待发送队列。terminal-error{retained} 会把该项放回待发送队列，用户重试可再次发送。
      if (this.awaitingCloseAck.has(sessionId)) {
        return
      }
      this.pendingCloseOnReconnect.delete(sessionId)
      this.awaitingCloseAck.add(sessionId)
      this.closeSentForConnection.add(sessionId)
      this.emit('close-pty', { sessionId })
    } else {
      // N2-I2：断线时不静默丢弃——排队待重连后重发（对 retained target 服务端继续 bounded close）
      this.pendingCloseOnReconnect.add(sessionId)
      console.warn('Socket未连接，close 请求已排队，将在重连后重发:', sessionId)
    }
  }

  /** connect 后重发断线期间排队的 close-pty 请求（N2-I2，ACK-owned）。 */
  private flushPendingCloseOnReconnect(): void {
    if (!this.socket?.connected) {
      return
    }
    if (this.pendingCloseOnReconnect.size === 0) {
      return
    }
    const pending = Array.from(this.pendingCloseOnReconnect)
    this.pendingCloseOnReconnect.clear()
    pending.forEach(sessionId => {
      // 同一连接内已发送过（且未确认）：不再重发，等待 ACK 或断线放回
      if (this.closeSentForConnection.has(sessionId)) {
        return
      }
      this.closeSentForConnection.add(sessionId)
      this.awaitingCloseAck.add(sessionId)
      this.emit('close-pty', { sessionId })
    })
  }

  /** close-pty 被确认（pty-closed / terminal-exit）：从所有队列移除。 */
  private handleCloseAcknowledged(sessionId: string | undefined): void {
    if (!sessionId) {
      return
    }
    this.awaitingCloseAck.delete(sessionId)
    this.pendingCloseOnReconnect.delete(sessionId)
    // Minor：确认关闭后同步删除 closeSentForConnection 对应项，避免长连接按历史
    // 关闭数无限增长；flush 重发守卫语义保持——被守卫的是未确认项（仍在 awaiting/
    // pending 的 ID 不会被误删，重新 closeTerminal 会再次加入）
    this.closeSentForConnection.delete(sessionId)
  }

  reconnectTerminal(sessionId: string): void {
    this.emit('reconnect-session', { sessionId })
  }

  // 系统监控相关方法
  subscribeSystemStats() {
    this.emit('subscribe-system-stats')
  }

  unsubscribeSystemStats() {
    this.emit('unsubscribe-system-stats')
  }

  // 端口监控相关方法
  subscribeSystemPorts() {
    this.emit('subscribe-system-ports')
  }

  unsubscribeSystemPorts() {
    this.emit('unsubscribe-system-ports')
  }

  // 进程监控相关方法
  subscribeSystemProcesses() {
    this.emit('subscribe-system-processes')
  }

  unsubscribeSystemProcesses() {
    this.emit('unsubscribe-system-processes')
  }

  // 终端活跃进程监控相关方法
  subscribeTerminalProcesses() {
    this.emit('subscribe-terminal-processes')
  }

  unsubscribeTerminalProcesses() {
    this.emit('unsubscribe-terminal-processes')
  }

  // 游戏服务器相关方法
  startGame(gameId: string) {
    this.emit('game-start', { gameId })
  }

  stopGame(gameId: string) {
    this.emit('game-stop', { gameId })
  }

  sendGameCommand(gameId: string, command: string) {
    this.emit('game-command', { gameId, command })
  }

  // 订阅游戏服务器状态
  subscribeGameStatus(gameId: string) {
    this.emit('subscribe-game-status', { gameId })
  }

  unsubscribeGameStatus(gameId: string) {
    this.emit('unsubscribe-game-status', { gameId })
  }

  // 面板日志订阅方法
  subscribeConsoleLogs() {
    this.emit('subscribe-console-logs')
  }

  unsubscribeConsoleLogs() {
    this.emit('unsubscribe-console-logs')
  }

  // 低功耗模式相关方法
  enterLowPowerMode() {
    if (!this.isLowPowerMode) {
      this.isLowPowerMode = true
      console.log('进入低功耗模式，关闭WebSocket连接并优化浏览器性能')

      // 触发低功耗模式回调
      this.lowPowerModeCallbacks.forEach(callback => {
        try {
          callback(true)
        } catch (error) {
          console.error('执行低功耗模式回调时出错:', error)
        }
      })

      // 断开WebSocket连接
      if (this.socket) {
        this.disconnectContext = 'low-power'
        this.clearReconnectTimer()
        this.socket.disconnect()
      }

      // 通知浏览器进入低功耗状态
      this.enableBrowserLowPowerMode()
    }
  }

  exitLowPowerMode() {
    if (this.isLowPowerMode) {
      this.isLowPowerMode = false
      console.log('退出低功耗模式，重新建立WebSocket连接并恢复浏览器性能')

      // 触发低功耗模式回调
      this.lowPowerModeCallbacks.forEach(callback => {
        try {
          callback(false)
        } catch (error) {
          console.error('执行低功耗模式回调时出错:', error)
        }
      })

      // 恢复浏览器正常状态
      this.disableBrowserLowPowerMode()

      // 重新连接
      this.reconnectManually()
    }
  }

  isInLowPowerMode(): boolean {
    return this.isLowPowerMode
  }

  onLowPowerModeChange(callback: (isLowPower: boolean) => void) {
    this.lowPowerModeCallbacks.push(callback)
  }

  offLowPowerModeChange(callback: (isLowPower: boolean) => void) {
    const index = this.lowPowerModeCallbacks.indexOf(callback)
    if (index > -1) {
      this.lowPowerModeCallbacks.splice(index, 1)
    }
  }

  // 浏览器低功耗模式管理
  private enableBrowserLowPowerMode() {
    try {
      // 1. 降低页面刷新率
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => {
          console.log('页面进入空闲状态优化')
        })
      }

      // 2. 暂停不必要的动画和CSS过渡
      document.documentElement.style.setProperty('--animation-play-state', 'paused')
      document.documentElement.classList.add('low-power-mode')

      // 3. 降低定时器频率
      this.pauseNonEssentialTimers()

      // 4. 修改页面标题提示用户
      this.originalTitle = document.title
      document.title = '💤 ' + this.originalTitle + ' (低功耗模式)'

      // 5. 使用Page Visibility API监听标签页状态
      this.setupPageVisibilityOptimization()

      // 6. 设置Intersection Observer暂停不可见元素的更新
      this.setupIntersectionObserver()

      // 7. 请求浏览器降低CPU使用率
      if ('scheduler' in window && 'postTask' in (window as any).scheduler) {
        (window as any).scheduler.postTask(() => {
          console.log('已请求浏览器调度器优化性能')
        }, { priority: 'background' })
      }

      // 8. 降低浏览器渲染频率
      this.reduceBrowserRenderingFrequency()

      console.log('浏览器低功耗模式已启用，标签页进入深度睡眠状态')
    } catch (error) {
      console.warn('启用浏览器低功耗模式时出错:', error)
    }
  }

  private disableBrowserLowPowerMode() {
    try {
      // 1. 恢复动画和CSS过渡
      document.documentElement.style.removeProperty('--animation-play-state')
      document.documentElement.classList.remove('low-power-mode')

      // 2. 恢复定时器
      this.resumeNonEssentialTimers()

      // 3. 恢复页面标题
      if (this.originalTitle) {
        document.title = this.originalTitle
        this.originalTitle = undefined
      }

      // 4. 清理Page Visibility API监听
      this.cleanupPageVisibilityOptimization()

      // 5. 清理Intersection Observer
      this.cleanupIntersectionObserver()

      // 6. 恢复浏览器正常渲染频率
      this.restoreBrowserRenderingFrequency()

      console.log('浏览器低功耗模式已禁用，标签页恢复正常状态')
    } catch (error) {
      console.warn('禁用浏览器低功耗模式时出错:', error)
    }
  }

  private originalTitle?: string
  private pausedIntervals: Set<number> = new Set()
  private pausedTimeouts: Set<number> = new Set()

  private pauseNonEssentialTimers() {
    // 这里可以暂停一些非关键的定时器
    // 注意：这是一个示例实现，实际项目中需要根据具体情况调整
    console.log('暂停非必要定时器')
  }

  private resumeNonEssentialTimers() {
    // 恢复之前暂停的定时器
    console.log('恢复非必要定时器')
  }

  // Page Visibility API 优化
  private setupPageVisibilityOptimization() {
    if (typeof document.hidden !== 'undefined') {
      this.visibilityChangeHandler = () => {
        if (document.hidden && this.isLowPowerMode) {
          console.log('标签页已隐藏，进入深度睡眠模式')
          // 进一步降低资源使用
          this.enterDeepSleepMode()
        } else if (!document.hidden && this.isLowPowerMode) {
          console.log('标签页已显示，退出深度睡眠模式')
          this.exitDeepSleepMode()
        }
      }
      document.addEventListener('visibilitychange', this.visibilityChangeHandler)
    }
  }

  private cleanupPageVisibilityOptimization() {
    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler)
      this.visibilityChangeHandler = undefined
    }
  }

  // Intersection Observer 优化
  private setupIntersectionObserver() {
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const element = entry.target as HTMLElement
          if (entry.isIntersecting) {
            element.style.willChange = 'auto'
          } else {
            // 不可见元素停止GPU加速
            element.style.willChange = 'unset'
          }
        })
      }, {
        threshold: 0.1
      })

      // 观察所有可能消耗资源的元素
      document.querySelectorAll('video, canvas, iframe, [style*="animation"]').forEach(el => {
        this.intersectionObserver?.observe(el)
      })
    }
  }

  private cleanupIntersectionObserver() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect()
      this.intersectionObserver = undefined
    }
  }

  // 深度睡眠模式（标签页隐藏时）
  private enterDeepSleepMode() {
    // 暂停所有视频
    document.querySelectorAll('video').forEach(video => {
      const videoElement = video as HTMLVideoElement
      if (!videoElement.paused) {
        videoElement.pause()
        videoElement.dataset.wasPlaying = 'true'
      }
    })

    // 暂停所有音频
    document.querySelectorAll('audio').forEach(audio => {
      const audioElement = audio as HTMLAudioElement
      if (!audioElement.paused) {
        audioElement.pause()
        audioElement.dataset.wasPlaying = 'true'
      }
    })

    console.log('已进入深度睡眠模式')
  }

  private exitDeepSleepMode() {
    // 恢复之前播放的视频
    document.querySelectorAll('video[data-was-playing="true"]').forEach(video => {
      const videoElement = video as HTMLVideoElement
      videoElement.play().catch(() => { })
      delete videoElement.dataset.wasPlaying
    })

    // 恢复之前播放的音频
    document.querySelectorAll('audio[data-was-playing="true"]').forEach(audio => {
      const audioElement = audio as HTMLAudioElement
      audioElement.play().catch(() => { })
      delete audioElement.dataset.wasPlaying
    })

    console.log('已退出深度睡眠模式')
  }

  // 降低浏览器渲染频率
  private reduceBrowserRenderingFrequency() {
    // 通过CSS减少重绘和回流
    const style = document.createElement('style')
    style.id = 'low-power-mode-styles'
    style.textContent = `
      .low-power-mode * {
        animation-play-state: paused !important;
        transition-duration: 0s !important;
      }
      .low-power-mode video,
      .low-power-mode canvas {
        opacity: 0.8;
        filter: grayscale(0.2);
      }
    `
    document.head.appendChild(style)
  }

  private restoreBrowserRenderingFrequency() {
    const style = document.getElementById('low-power-mode-styles')
    if (style) {
      style.remove()
    }
  }
}

// 创建单例实例
const socketClient = new SocketClient()

export default socketClient
export { SocketClient }
