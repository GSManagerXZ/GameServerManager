import React, { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useThemeStore } from '@/stores/themeStore'
import { useWallpaperStore } from '@/stores/wallpaperStore'
import { Eye, EyeOff, Gamepad2, Sun, Moon, Loader2, RefreshCw, UserPlus, HelpCircle } from 'lucide-react'
import apiClient from '@/utils/api'
import { CaptchaData } from '@/types'
import LoginTransition from '@/components/LoginTransition'
import WallpaperBackground from '@/components/WallpaperBackground'

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [captchaCode, setCaptchaCode] = useState('')
  const [captchaData, setCaptchaData] = useState<CaptchaData | null>(null)
  const [requireCaptcha, setRequireCaptcha] = useState(false)
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginSuccess, setLoginSuccess] = useState(false)
  const [isAnimating, setIsAnimating] = useState(true)
  const [showLoginTransition, setShowLoginTransition] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [hasUsers, setHasUsers] = useState(true)
  const [checkingUsers, setCheckingUsers] = useState(true)
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false)
  const [isClosingModal, setIsClosingModal] = useState(false)
  const { login, loading, error } = useAuthStore()
  const { addNotification } = useNotificationStore()
  const { theme, toggleTheme } = useThemeStore()
  const { settings: wallpaperSettings } = useWallpaperStore()

  // 页面加载动画
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnimating(false)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // 检查是否有用户存在
  useEffect(() => {
    const checkUsers = async () => {
      try {
        const response = await apiClient.hasUsers()
        if (response.success) {
          setHasUsers(response.hasUsers)
          setIsRegisterMode(!response.hasUsers)
        }
      } catch (error) {
        console.error('检查用户失败:', error)
        // 默认假设有用户，显示登录界面
        setHasUsers(true)
        setIsRegisterMode(false)
      } finally {
        setCheckingUsers(false)
      }
    }
    
    checkUsers()
  }, [])
  
  // 检查是否需要验证码（仅登录模式）
  const checkCaptchaRequired = async (usernameValue: string) => {
    if (!usernameValue.trim() || isRegisterMode) return
    
    try {
      const response = await apiClient.checkCaptchaRequired(usernameValue.trim())
      if (response.success) {
        setRequireCaptcha(response.requireCaptcha)
        if (response.requireCaptcha && !captchaData) {
          await loadCaptcha()
        }
      }
    } catch (error) {
      console.error('检查验证码需求失败:', error)
    }
  }

  // 处理忘记密码点击
  const handleForgotPassword = () => {
    setShowForgotPasswordModal(true)
    setIsClosingModal(false)
  }

  // 关闭忘记密码模态框
  const closeForgotPasswordModal = () => {
    setIsClosingModal(true)
    // 等待动画完成后关闭模态框
    setTimeout(() => {
      setShowForgotPasswordModal(false)
      setIsClosingModal(false)
    }, 200) // 与 animate-fade-out 动画时长一致
  }

  // 加载验证码
  const loadCaptcha = async () => {
    setCaptchaLoading(true)
    try {
      const response = await apiClient.getCaptcha()
      if (response.success) {
        setCaptchaData(response.captcha)
        setCaptchaCode('')
      } else {
        addNotification({
          type: 'error',
          title: '获取验证码失败',
          message: '请稍后重试'
        })
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: '获取验证码失败',
        message: '请检查网络连接'
      })
    } finally {
      setCaptchaLoading(false)
    }
  }

  // 刷新验证码
  const refreshCaptcha = () => {
    loadCaptcha()
  }

  // 用户名输入变化时检查是否需要验证码（仅登录模式）
  useEffect(() => {
    if (!isRegisterMode) {
      const timer = setTimeout(() => {
        checkCaptchaRequired(username)
      }, 500)
      
      return () => clearTimeout(timer)
    }
  }, [username, isRegisterMode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!username.trim() || !password.trim()) {
      addNotification({
        type: 'warning',
        title: '输入错误',
        message: '请输入用户名和密码'
      })
      return
    }

    if (isRegisterMode) {
      // 注册逻辑
      if (password !== confirmPassword) {
        addNotification({
          type: 'warning',
          title: '输入错误',
          message: '两次输入的密码不一致'
        })
        return
      }

      if (password.length < 6) {
        addNotification({
          type: 'warning',
          title: '输入错误',
          message: '密码长度至少为6个字符'
        })
        return
      }

      setIsLoggingIn(true)
      
      try {
        const response = await apiClient.register({
          username: username.trim(),
          password
        })
        
        if (response.success) {
          addNotification({
            type: 'success',
            title: '注册成功',
            message: '管理员账户创建成功，请登录'
          })
          
          // 切换到登录模式
          setIsRegisterMode(false)
          setHasUsers(true)
          setPassword('')
          setConfirmPassword('')
        } else {
          addNotification({
            type: 'error',
            title: '注册失败',
            message: response.message
          })
        }
      } catch (error: any) {
        addNotification({
          type: 'error',
          title: '注册失败',
          message: error.message || '注册失败，请稍后重试'
        })
      } finally {
        setIsLoggingIn(false)
      }
    } else {
      // 登录逻辑
      if (requireCaptcha && (!captchaData || !captchaCode.trim())) {
        addNotification({
          type: 'warning',
          title: '输入错误',
          message: '请输入验证码'
        })
        return
      }
      
      setIsLoggingIn(true)
      
      const credentials = {
        username: username.trim(),
        password,
        ...(requireCaptcha && captchaData ? {
          captchaId: captchaData.id,
          captchaCode: captchaCode.trim()
        } : {})
      }
      
      const result = await login(credentials)
      
      if (result.success) {
        setLoginSuccess(true)
        setShowLoginTransition(true)
        addNotification({
          type: 'success',
          title: '登录成功',
          message: '欢迎回来！'
        })
        
        // 延迟一下让用户看到成功动画
        setTimeout(() => {
          setIsLoggingIn(false)
        }, 1000)
      } else {
        setIsLoggingIn(false)
        addNotification({
          type: 'error',
          title: '登录失败',
          message: result.message
        })
        
        // 如果登录失败且需要验证码，刷新验证码
        if (requireCaptcha) {
          refreshCaptcha()
        }
      }
    }
  }

  // 如果正在检查用户，显示加载界面
  if (checkingUsers) {
    return (
      <div className={`
        min-h-screen flex items-center justify-center p-4
        ${theme === 'dark' 
          ? 'bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900' 
          : 'bg-gradient-to-br from-blue-50 via-white to-purple-50'
        }
      `}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">正在检查系统状态...</p>
        </div>
      </div>
    )
  }
  
  return (
    <>
      {/* 登录过渡动画 */}
      <LoginTransition 
        isVisible={showLoginTransition} 
        onComplete={() => {
          setShowLoginTransition(false)
        }}
      />

      {/* 背景壁纸 */}
      <WallpaperBackground isLoginPage={true} />
      
      <div className={`
        min-h-screen flex items-center justify-center p-4 transition-all duration-1000 relative
        ${!wallpaperSettings.syncWithMain && !wallpaperSettings.loginEnabled && !wallpaperSettings.enabled 
          ? theme === 'dark' 
            ? 'bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 animate-background-shift' 
            : 'bg-gradient-to-br from-blue-50 via-white to-purple-50'
          : ''
        }
      `}>
      {/* 主题切换按钮 */}
      <button
        onClick={toggleTheme}
        className={`
          fixed top-4 right-4 p-3 glass rounded-full text-black dark:text-white 
          hover:bg-white/20 transition-all duration-200 z-20
          ${isAnimating ? 'opacity-0 translate-y-[-20px]' : 'opacity-100 translate-y-0 animate-form-field-slide-in animate-delay-500'}
        `}
      >
        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>
      
      <div className={`
        w-full max-w-md transition-all duration-600 relative z-10
        ${isAnimating ? 'opacity-0 translate-y-10 scale-95' : 'opacity-100 translate-y-0 scale-100 animate-login-slide-in'}
        ${loginSuccess ? 'animate-page-transition-out' : ''}
      `}>
        {/* Logo和标题 */}
        <div className={`
          text-center mb-8
          ${isAnimating ? 'opacity-0' : 'opacity-100 animate-form-field-slide-in animate-delay-200'}
        `}>
          <div className="flex justify-center mb-4">
            <img 
              src="/logo/logo2.png" 
              alt="GSManager3 Logo" 
              className={`
                w-20 h-20 object-contain transition-all duration-300
                ${!isAnimating ? 'animate-logo-float' : ''}
                ${loginSuccess ? 'animate-success-checkmark' : ''}
              `}
            />
          </div>
          <h1 className="text-4xl font-bold font-game neon-text mb-2">
            GameServerManager
          </h1>
          <p className="text-gray-700 dark:text-gray-300 font-display">
            专为游戏服务端而设计的开服面板
          </p>
        </div>
        
        {/* 登录/注册表单 */}
        <div className={`
          card-game p-8 transition-all duration-800
          ${isAnimating ? 'opacity-0' : 'opacity-100 animate-fade-in'}
          ${loginSuccess ? 'scale-105 shadow-2xl' : ''}
        `}>
          {/* 表单标题 */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 flex items-center justify-center space-x-2">
              {isRegisterMode ? (
                <>
                  <UserPlus className="w-6 h-6" />
                  <span>创建管理员账户</span>
                </>
              ) : (
                <>
                  <Gamepad2 className="w-6 h-6" />
                  <span>登录到面板</span>
                </>
              )}
            </h2>
            {isRegisterMode && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                系统检测到还没有管理员账户，请创建第一个管理员账户
              </p>
            )}
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 用户名输入 */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                用户名
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="
                  w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg
                  text-black dark:text-white placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                  transition-all duration-200 hover:border-white/30
                  focus:scale-[1.02] focus:shadow-lg
                "
                placeholder="请输入用户名"
                disabled={loading || isLoggingIn}
              />
            </div>
            
            {/* 密码输入 */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                密码
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="
                    w-full px-4 py-3 pr-12 bg-white/10 border border-white/20 rounded-lg
                    text-black dark:text-white placeholder-gray-400
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                    transition-all duration-200 hover:border-white/30
                    focus:scale-[1.02] focus:shadow-lg
                  "
                  placeholder={isRegisterMode ? "请设置密码（至少6位）" : "请输入密码"}
                  disabled={loading || isLoggingIn}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white transition-all duration-200 hover:scale-110"
                  disabled={loading || isLoggingIn}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* 确认密码输入（仅注册模式） */}
            {isRegisterMode && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                  确认密码
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="
                      w-full px-4 py-3 pr-12 bg-white/10 border border-white/20 rounded-lg
                      text-black dark:text-white placeholder-gray-400
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      transition-all duration-200 hover:border-white/30
                      focus:scale-[1.02] focus:shadow-lg
                    "
                    placeholder="请再次输入密码"
                    disabled={loading || isLoggingIn}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white transition-all duration-200 hover:scale-110"
                    disabled={loading || isLoggingIn}
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            {/* 验证码输入（仅登录模式） */}
            {!isRegisterMode && requireCaptcha && (
              <div>
                <label htmlFor="captcha" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                  验证码
                </label>
                <div className="flex space-x-3">
                  <input
                    id="captcha"
                    type="text"
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value)}
                    className="
                      flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg
                      text-black dark:text-white placeholder-gray-400
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      transition-all duration-200 hover:border-white/30
                      focus:scale-[1.02] focus:shadow-lg
                    "
                    placeholder="请输入验证码"
                    disabled={loading || captchaLoading || isLoggingIn}
                    maxLength={4}
                  />
                  <div className="flex items-center space-x-2">
                    {/* 验证码图片 */}
                    <div 
                      className="
                        w-24 h-12 bg-white/10 border border-white/20 rounded-lg
                        flex items-center justify-center cursor-pointer
                        hover:bg-white/20 transition-all duration-200
                      "
                      onClick={refreshCaptcha}
                    >
                      {captchaLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                      ) : captchaData ? (
                        <div 
                          dangerouslySetInnerHTML={{ __html: captchaData.svg }}
                          className="w-full h-full flex items-center justify-center"
                        />
                      ) : (
                        <span className="text-gray-400 text-xs">验证码</span>
                      )}
                    </div>
                    {/* 刷新按钮 */}
                    <button
                      type="button"
                      onClick={refreshCaptcha}
                      disabled={loading || captchaLoading || isLoggingIn}
                      className="
                        p-3 bg-white/10 border border-white/20 rounded-lg
                        text-gray-400 hover:text-black dark:hover:text-white
                        hover:bg-white/20 transition-all duration-200
                        disabled:opacity-50 disabled:cursor-not-allowed
                        hover:scale-110 active:scale-95
                      "
                      title="刷新验证码"
                    >
                      <RefreshCw className={`w-4 h-4 ${captchaLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  点击验证码图片或刷新按钮可以更换验证码
                </p>
              </div>
            )}
            
            {/* 错误信息 */}
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg transition-all duration-300">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
            
            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={loading || isLoggingIn}
              className={`
                w-full py-3 font-semibold transition-all duration-300
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center space-x-2
                ${isLoggingIn 
                  ? 'bg-green-600 hover:bg-green-700 animate-button-pulse' 
                  : 'btn-game hover:scale-105 active:scale-95'
                }
                ${loginSuccess ? 'bg-green-500 scale-110' : ''}
              `}
            >
              {isLoggingIn ? (
                loginSuccess ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{isRegisterMode ? '注册成功！' : '登录成功！'}</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{isRegisterMode ? '注册中...' : '登录中...'}</span>
                  </>
                )
              ) : (
                <span>{isRegisterMode ? '创建管理员账户' : '登录'}</span>
              )}
            </button>
          </form>
          
          {/* 忘记密码链接（仅登录模式） */}
          {!isRegisterMode && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="
                  text-sm text-gray-600 dark:text-gray-400 
                  hover:text-blue-500 dark:hover:text-blue-400
                  transition-all duration-200 
                  flex items-center justify-center space-x-1
                  mx-auto
                  hover:scale-105
                "
                disabled={loading || isLoggingIn}
              >
                <HelpCircle className="w-4 h-4" />
                <span>忘记密码？</span>
              </button>
            </div>
          )}
          
          {/* 底部信息 */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              GSManager3 游戏服务器面板
            </p>
          </div>
        </div>
      </div>
    </div>
    
    {/* 忘记密码模态框 */}
    {showForgotPasswordModal && (
      <div 
        className={`fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 ${
          isClosingModal ? 'animate-fade-out' : 'animate-fade-in'
        }`}
        onClick={closeForgotPasswordModal}
      >
        <div 
          className={`bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl ${
            isClosingModal ? 'animate-scale-out' : 'animate-modal-slide-in'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center">
            <div className="mb-4">
              <HelpCircle className="w-12 h-12 text-blue-500 mx-auto mb-2 animate-bounce-gentle" />
              <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">
                忘记密码
              </h3>
            </div>
            
            <div className="text-left mb-6 space-y-3">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                如果您忘记了管理员密码，请按照以下步骤重置：
              </p>
              
              <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg">
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 dark:text-gray-300">
                  <li>停止 GSManager3 面板服务</li>
                  <li>删除程序目录下的 <code className="bg-red-100 dark:bg-red-900 px-2 py-1 rounded text-red-600 dark:text-red-400 font-mono text-xs">server/data/users.json</code> 文件</li>
                  <li>重新启动面板服务</li>
                  <li>系统将自动进入初始化模式，您可以重新创建管理员账户</li>
                </ol>
              </div>
              
              <div className="bg-yellow-100 dark:bg-yellow-900 p-3 rounded-lg">
                <p className="text-yellow-800 dark:text-yellow-200 text-xs">
                  ⚠️ 注意：删除用户文件将清除所有用户账户数据，请谨慎操作！
                </p>
              </div>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={closeForgotPasswordModal}
                className="
                  flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-600 
                  text-gray-800 dark:text-gray-200 rounded-lg
                  hover:bg-gray-300 dark:hover:bg-gray-500
                  transition-all duration-200
                  hover:scale-105 active:scale-95
                "
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

export default LoginPage