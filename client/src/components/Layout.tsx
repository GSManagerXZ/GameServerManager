import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import socketClient from '@/utils/socket'
import apiClient from '@/utils/api'
import LogoutTransition from './LogoutTransition'
import {
  Home,
  Terminal,
  Server,
  Download,
  Clock,
  FolderOpen,
  Settings,
  User,
  LogOut,
  Gamepad2,
  Menu,
  X,
  Sun,
  Moon,
  WifiOff,
  Wifi,
  RefreshCw,
  AlertTriangle,
  Info,
  Crown,
  Puzzle,
  HelpCircle,
  CheckCircle,
  Coffee,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'

interface LayoutProps {
  children: React.ReactNode
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    return saved === 'true'
  })
  const [isConnected, setIsConnected] = useState(socketClient.isConnected())
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [showLowPowerModal, setShowLowPowerModal] = useState(false)
  const [isLowPowerMode, setIsLowPowerMode] = useState(socketClient.isInLowPowerMode())
  const [showLogoutTransition, setShowLogoutTransition] = useState(false)
  const [isSponsor, setIsSponsor] = useState(false)
  const [showFileHelpModal, setShowFileHelpModal] = useState(false)
  const [fileHelpModalAnimating, setFileHelpModalAnimating] = useState(false)
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useThemeStore()
  
  const navigation = [
    { name: '首页', href: '/', icon: Home },
    { name: '终端', href: '/terminal', icon: Terminal },
    { name: '实例管理', href: '/instances', icon: Server },
    { name: '游戏部署', href: '/game-deployment', icon: Download },
    { name: '定时任务', href: '/scheduled-tasks', icon: Clock },
    { name: '文件管理', href: '/files', icon: FolderOpen },
    { name: '环境管理', href: '/environment', icon: Coffee },
    { name: '插件', href: '/plugins', icon: Puzzle },
    { name: '设置', href: '/settings', icon: Settings },
    { name: '关于项目', href: '/about', icon: Info },
  ]
  
  const handleLogout = async () => {
    setShowLogoutTransition(true)
  }

  const handleLogoutComplete = async () => {
    setShowLogoutTransition(false)
    await logout()
  }

  // 切换侧边栏展开/收缩
  const toggleSidebarCollapse = () => {
    const newState = !sidebarCollapsed
    setSidebarCollapsed(newState)
    localStorage.setItem('sidebarCollapsed', String(newState))
  }

  // 打开文件管理帮助模态框
  const handleOpenFileHelpModal = () => {
    setShowFileHelpModal(true)
    setTimeout(() => setFileHelpModalAnimating(true), 10)
  }

  // 关闭文件管理帮助模态框
  const handleCloseFileHelpModal = () => {
    setFileHelpModalAnimating(false)
    setTimeout(() => {
      setShowFileHelpModal(false)
    }, 300)
  }

  // 鼠标活动监测和低功耗模式管理
  useEffect(() => {
    let mouseTimer: NodeJS.Timeout | null = null
    let visibilityTimer: NodeJS.Timeout | null = null
    
    // 从localStorage读取网页设置
    const getWebSettings = () => {
      try {
        const savedSettings = localStorage.getItem('webSettings')
        if (savedSettings) {
          return JSON.parse(savedSettings)
        }
      } catch (error) {
        console.error('读取网页设置失败:', error)
      }
      // 默认设置
      return {
        enableLowPowerMode: true,
        lowPowerModeTimeout: 60,
        enableDeepSleep: true,
        deepSleepTimeout: 10
      }
    }
    
    const webSettings = getWebSettings()
    const MOUSE_IDLE_TIME = webSettings.lowPowerModeTimeout * 1000 // 转换为毫秒
    const VISIBILITY_IDLE_TIME = webSettings.deepSleepTimeout * 1000 // 转换为毫秒
    
    const enterLowPowerMode = () => {
      if (!socketClient.isInLowPowerMode() && webSettings.enableLowPowerMode) {
        socketClient.enterLowPowerMode()
        setShowLowPowerModal(true)
      }
    }
    
    const enterDeepSleepMode = () => {
      if (!socketClient.isInLowPowerMode() && webSettings.enableDeepSleep) {
        socketClient.enterLowPowerMode()
        setShowLowPowerModal(true)
      }
    }
    
    const exitLowPowerMode = () => {
      if (socketClient.isInLowPowerMode()) {
        socketClient.exitLowPowerMode()
        setShowLowPowerModal(false)
      }
    }
    
    const resetMouseTimer = () => {
      if (mouseTimer) {
        clearTimeout(mouseTimer)
      }
      
      // 如果当前在低功耗模式，退出低功耗模式
      exitLowPowerMode()
      
      // 只有在非终端页面且启用了低功耗模式才启动定时器
      if (location.pathname !== '/terminal' && webSettings.enableLowPowerMode) {
        mouseTimer = setTimeout(() => {
          enterLowPowerMode()
        }, MOUSE_IDLE_TIME)
      }
    }
    
    const resetVisibilityTimer = () => {
      if (visibilityTimer) {
        clearTimeout(visibilityTimer)
      }
      
      // 只有在非终端页面、标签页隐藏且启用了深度睡眠时才启动定时器
      if (location.pathname !== '/terminal' && document.hidden && webSettings.enableDeepSleep) {
        visibilityTimer = setTimeout(() => {
          enterDeepSleepMode()
        }, VISIBILITY_IDLE_TIME)
      }
    }
    
    const handleMouseMove = () => {
      resetMouseTimer()
    }
    
    const handleMouseClick = () => {
      resetMouseTimer()
    }
    
    const handleKeyPress = () => {
      resetMouseTimer()
    }
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 标签页隐藏时，清除鼠标定时器并启动可见性定时器
        if (mouseTimer) {
          clearTimeout(mouseTimer)
          mouseTimer = null
        }
        resetVisibilityTimer()
      } else {
        // 标签页显示时，清除可见性定时器并退出低功耗模式，重新启动鼠标定时器
        if (visibilityTimer) {
          clearTimeout(visibilityTimer)
          visibilityTimer = null
        }
        exitLowPowerMode()
        resetMouseTimer()
      }
    }
    
    // 添加事件监听器
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mousedown', handleMouseClick)
    document.addEventListener('keydown', handleKeyPress)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // 初始化定时器
    if (!document.hidden) {
      // 标签页可见时，启动鼠标活动监测（如果启用了低功耗模式）
      if (webSettings.enableLowPowerMode) {
        resetMouseTimer()
      }
    } else {
      // 标签页隐藏时，启动深度睡眠监测（如果启用了深度睡眠）
      if (webSettings.enableDeepSleep) {
        resetVisibilityTimer()
      }
    }
    
    return () => {
      if (mouseTimer) {
        clearTimeout(mouseTimer)
      }
      if (visibilityTimer) {
        clearTimeout(visibilityTimer)
      }
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mousedown', handleMouseClick)
      document.removeEventListener('keydown', handleKeyPress)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [location.pathname])

  // WebSocket连接状态监听
  useEffect(() => {
    const handleConnectionStatus = (data: { connected: boolean; reason?: string }) => {
      setIsConnected(data.connected)
      if (!data.connected && !socketClient.isInLowPowerMode()) {
        setShowDisconnectModal(true)
      } else {
        setShowDisconnectModal(false)
        setReconnecting(false)
      }
    }

    const handleConnectionError = () => {
      if (!socketClient.isInLowPowerMode()) {
        setIsConnected(false)
        setShowDisconnectModal(true)
      }
    }

    const handleMaxReconnectAttempts = () => {
      setReconnecting(false)
    }

    const handleLowPowerModeChange = (isLowPower: boolean) => {
      setIsLowPowerMode(isLowPower)
      if (!isLowPower) {
        setShowLowPowerModal(false)
      }
    }

    // 监听连接状态变化
    socketClient.on('connection-status', handleConnectionStatus)
    socketClient.on('connection-error', handleConnectionError)
    socketClient.on('max-reconnect-attempts', handleMaxReconnectAttempts)
    socketClient.onLowPowerModeChange(handleLowPowerModeChange)

    // 初始化连接状态
    setIsConnected(socketClient.isConnected())
    setIsLowPowerMode(socketClient.isInLowPowerMode())

    return () => {
      socketClient.off('connection-status', handleConnectionStatus)
      socketClient.off('connection-error', handleConnectionError)
      socketClient.off('max-reconnect-attempts', handleMaxReconnectAttempts)
      socketClient.offLowPowerModeChange(handleLowPowerModeChange)
    }
  }, [])

  // 获取赞助者状态
  useEffect(() => {
    const fetchSponsorStatus = async () => {
      try {
        const response = await apiClient.getSponsorKeyInfo()
        if (response.success && response.data) {
          setIsSponsor(response.data.isValid && !response.data.isExpired)
        }
      } catch (error) {
        console.error('获取赞助者状态失败:', error)
        setIsSponsor(false)
      }
    }

    if (user) {
      fetchSponsorStatus()
    }
  }, [user])

  // 手动重连
  const handleReconnect = () => {
    setReconnecting(true)
    socketClient.reconnectManually()
  }

  // 关闭弹窗
  const handleCloseModal = () => {
    setShowDisconnectModal(false)
  }

  // 退出低功耗模式
  const handleExitLowPowerMode = () => {
    socketClient.exitLowPowerMode()
    setShowLowPowerModal(false)
  }

  // 关闭低功耗模式弹窗但保持低功耗状态
  const handleCloseLowPowerModal = () => {
    setShowLowPowerModal(false)
  }
  
  return (
    <div className="min-h-screen bg-game-gradient">
      {/* 移动端侧边栏遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* 侧边栏 */}
      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-all duration-300 ease-in-out lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        ${sidebarCollapsed ? 'w-16' : 'w-64'}
      `}>
        <div className="flex h-full flex-col glass border-r border-white/20 dark:border-gray-700/30">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between px-3 border-b border-white/20 dark:border-gray-700/30">
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center w-full' : 'space-x-3 px-3'}`}>
              <Gamepad2 className={`text-blue-500 ${sidebarCollapsed ? 'w-6 h-6' : 'w-8 h-8'}`} />
              {!sidebarCollapsed && (
                <span className="text-xl font-bold font-game neon-text">
                  GSManager3
                </span>
              )}
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-black dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          {/* 导航菜单 */}
          <nav className="flex-1 px-3 py-5 space-y-1.5">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  title={sidebarCollapsed ? item.name : ''}
                  className={`
                    flex items-center rounded-lg transition-all duration-300 ease-in-out transform
                    hover:scale-105 hover:shadow-md active:scale-95
                    ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-2.5 px-3 py-2.5'}
                    ${isActive
                      ? 'bg-blue-600/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 shadow-lg scale-105'
                      : 'text-black dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                    }
                  `}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="font-medium whitespace-nowrap">{item.name}</span>
                  )}
                </Link>
              )
            })}
          </nav>
          
          {/* 用户信息和操作 */}
          <div className="border-t border-white/20 dark:border-gray-700/30 p-4 space-y-4">
            {/* 展开/收缩切换按钮 (仅桌面端显示) */}
            <button
              onClick={toggleSidebarCollapse}
              title={sidebarCollapsed ? '展开侧边栏' : '收缩侧边栏'}
              className={`hidden lg:flex items-center w-full rounded-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95 text-black dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-black dark:hover:text-white ${
                sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-2.5 px-3 py-2.5'
              }`}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <>
                  <ChevronLeft className="w-4 h-4" />
                  <span className="font-medium">收缩</span>
                </>
              )}
            </button>

            {/* 主题切换 */}
            <button
              onClick={toggleTheme}
              title={sidebarCollapsed ? (theme === 'dark' ? '浅色模式' : '深色模式') : ''}
              className={`flex items-center w-full rounded-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95 text-black dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-black dark:hover:text-white ${
                sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-2.5 px-3 py-2.5'
              }`}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 flex-shrink-0" />
              ) : (
                <Moon className="w-4 h-4 flex-shrink-0" />
              )}
              {!sidebarCollapsed && (
                <span className="font-medium whitespace-nowrap">
                  {theme === 'dark' ? '浅色模式' : '深色模式'}
                </span>
              )}
            </button>
            
            {/* 用户信息 */}
            <div 
              title={sidebarCollapsed ? `${user?.username} (${user?.role === 'admin' ? '管理员' : '用户'})` : ''}
              className={`flex items-center bg-gray-100 dark:bg-white/5 rounded-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-md ${
                sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-2.5 px-3 py-2.5'
              }`}
            >
              <div className={`bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0 ${
                sidebarCollapsed ? 'w-6 h-6' : 'w-7 h-7'
              }`}>
                <User className={`text-white ${sidebarCollapsed ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
              </div>
              {!sidebarCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-black dark:text-white truncate">
                    {user?.username}
                  </p>
                  <div className="flex items-center space-x-1">
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {user?.role === 'admin' ? '管理员' : '用户'}
                    </p>
                    {isSponsor && (
                      <div className="flex items-center space-x-1">
                        <Crown className="w-3 h-3 text-yellow-500" />
                        <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                          赞助者
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {/* 登出按钮 */}
            <button
              onClick={handleLogout}
              title={sidebarCollapsed ? '登出' : ''}
              className={`flex items-center w-full rounded-lg transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95 text-red-400 hover:bg-red-500/10 hover:text-red-300 ${
                sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'space-x-2.5 px-3 py-2.5'
              }`}
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && (
                <span className="font-medium whitespace-nowrap">登出</span>
              )}
            </button>
          </div>
        </div>
      </div>
      
      {/* 主内容区域 */}
      <div className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'}`}>
        {/* 顶部栏 */}
        <div className="sticky top-0 z-30 flex h-16 items-center justify-between px-6 glass border-b border-gray-200 dark:border-gray-700/30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-400 hover:text-white transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-black dark:text-white font-display">
              {navigation.find(item => item.href === location.pathname)?.name || 'GSM3 游戏面板'}
            </h1>
            {/* 文件管理页面的帮助按钮 */}
            {location.pathname === '/files' && (
              <button
                onClick={handleOpenFileHelpModal}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                title="查看文件管理帮助"
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            )}
          </div>
          
          <div className="flex items-center space-x-4">
            {/* 连接状态指示器 */}
            <div 
              className="flex items-center space-x-2 cursor-help" 
              title="WebSocket是一种网络通信协议，允许服务器和客户端之间进行实时双向通信。在GSManager3中，WebSocket作为核心功能，用于实时传输终端输出、系统状态更新、游戏服务器状态变化等信息，确保您能够及时获得最新的系统反馈。"
            >
              {isLowPowerMode ? (
                <>
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-yellow-600 dark:text-yellow-400">低功耗模式</span>
                </>
              ) : isConnected ? (
                <>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-black dark:text-gray-300">WebSocket连接已建立</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="text-sm text-red-500 dark:text-red-400">WebSocket连接中断</span>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* 页面内容 */}
        <main className="p-6 relative overflow-hidden">
          {children}
        </main>
      </div>

      {/* WebSocket连接中断弹窗 */}
      {showDisconnectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                  <WifiOff className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  连接中断
                </h3>
              </div>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    WebSocket连接已中断，这可能会影响实时功能的使用，如终端输出、系统监控等。
                  </p>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 mb-4">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      可能的原因：
                    </h4>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <li>• 网络连接不稳定</li>
                      <li>• 服务器临时不可用</li>
                      <li>• 认证令牌已过期</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseModal}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                稍后处理
              </button>
              <button
                onClick={handleReconnect}
                disabled={reconnecting}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                {reconnecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>重连中...</span>
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4" />
                    <span>立即重连</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 低功耗模式弹窗 */}
      {showLowPowerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
                  <Moon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  低功耗模式
                </h3>
              </div>
              <button
                onClick={handleCloseLowPowerModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    检测到您的鼠标超过1分钟没有活动，页面已自动进入低功耗模式以节省系统资源和电池电量。
                  </p>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 mb-4">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      低功耗模式功能：
                    </h4>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <li>• WebSocket连接已暂时关闭</li>
                      <li>• 实时数据更新已暂停</li>
                      <li>• 页面动画和过渡效果已暂停</li>
                      <li>• 浏览器标签页进入睡眠状态</li>
                      <li>• 视频和音频播放已暂停</li>
                      <li>• CPU和GPU使用率已降低</li>
                      <li>• 移动鼠标或按键可立即恢复</li>
                      <li>• 终端页面不会进入低功耗模式</li>
                    </ul>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    移动鼠标、点击或按键将自动退出低功耗模式并恢复正常功能。
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseLowPowerModal}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                保持低功耗
              </button>
              <button
                onClick={handleExitLowPowerMode}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                <Sun className="w-4 h-4" />
                <span>立即恢复</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 文件管理帮助模态框 */}
      {showFileHelpModal && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          fileHelpModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 transform transition-all duration-300 ${
            fileHelpModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                <HelpCircle className="w-5 h-5 text-blue-500" />
                <span>文件管理帮助</span>
              </h3>
              <button
                onClick={handleCloseFileHelpModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              <div className="space-y-6">
                {/* 文件夹和文件选择操作 */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                    <FolderOpen className="w-5 h-5 text-blue-500" />
                    <span>文件夹和文件选择操作</span>
                  </h4>
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed mb-3">
                      同时按住<kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl</kbd>键（Windows）或<kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Command</kbd>键（Mac），点击多个文件或文件夹，即可同时选中多个文件或文件夹。然后配合右键菜单进行文件操作。
                    </p>
                    <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                      选中多个文件或文件夹后，可以结合右键菜单实现多个文件的多选剪切和复制以及压缩。也可以结合快捷键<kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+C</kbd>（复制）<kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+X</kbd>（剪切）<kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+V</kbd>（粘贴）操作。正确后您应当可以看到相关通知。
                    </p>
                  </div>
                </div>

                {/* 右键菜单功能 */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                    <Menu className="w-5 h-5 text-green-500" />
                    <span>右键菜单功能</span>
                  </h4>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <p className="text-sm text-green-800 dark:text-green-200 leading-relaxed mb-3">
                      您可以选中文件或文件夹后右键以及空白地方右键都有对应的右键菜单组件满足几乎所有需求。
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-green-200 dark:border-green-700">
                        <h5 className="font-medium text-green-800 dark:text-green-200 mb-2">文件/文件夹右键菜单：</h5>
                        <ul className="text-xs text-green-700 dark:text-green-300 space-y-1">
                          <li>• 复制、剪切、删除</li>
                          <li>• 重命名、查看属性</li>
                          <li>• 下载、压缩</li>
                          <li>• 解压缩（压缩包）</li>
                          <li>• 在终端中打开</li>
                        </ul>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-green-200 dark:border-green-700">
                        <h5 className="font-medium text-green-800 dark:text-green-200 mb-2">空白区域右键菜单：</h5>
                        <ul className="text-xs text-green-700 dark:text-green-300 space-y-1">
                          <li>• 新建文件、新建文件夹</li>
                          <li>• 粘贴文件</li>
                          <li>• 刷新目录</li>
                          <li>• 在终端中打开当前目录</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 快捷键操作 */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                    <Settings className="w-5 h-5 text-purple-500" />
                    <span>快捷键操作</span>
                  </h4>
                  <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h5 className="font-medium text-purple-800 dark:text-purple-200 mb-2">文件操作：</h5>
                        <div className="space-y-2 text-sm text-purple-700 dark:text-purple-300">
                          <div className="flex justify-between">
                            <span>复制</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+C</kbd>
                          </div>
                          <div className="flex justify-between">
                            <span>剪切</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+X</kbd>
                          </div>
                          <div className="flex justify-between">
                            <span>粘贴</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+V</kbd>
                          </div>
                          <div className="flex justify-between">
                            <span>删除</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Delete</kbd>
                          </div>
                          <div className="flex justify-between">
                            <span>重命名</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">F2</kbd>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h5 className="font-medium text-purple-800 dark:text-purple-200 mb-2">选择操作：</h5>
                        <div className="space-y-2 text-sm text-purple-700 dark:text-purple-300">
                          <div className="flex justify-between">
                            <span>多选</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+点击</kbd>
                          </div>
                          <div className="flex justify-between">
                            <span>全选</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Ctrl+A</kbd>
                          </div>
                          <div className="flex justify-between">
                            <span>取消选择</span>
                            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono">Esc</kbd>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 注意事项 */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                    <span>注意事项</span>
                  </h4>
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                    <ul className="text-sm text-orange-800 dark:text-orange-200 space-y-2">
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>操作成功后会显示相应的通知消息</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>大文件操作可能需要较长时间，请耐心等待</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>删除操作不可恢复，请谨慎操作</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>压缩和解压缩支持多种格式（zip、tar、gz等）</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseFileHelpModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>我知道了</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 登出过渡动画 */}
      <LogoutTransition 
        isVisible={showLogoutTransition} 
        onComplete={handleLogoutComplete} 
      />
    </div>
  )
}

export default Layout