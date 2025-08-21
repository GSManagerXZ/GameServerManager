import React, { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme, App as AntdApp } from 'antd'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSystemStore } from '@/stores/systemStore'
import Layout from '@/components/Layout'
import PageTransition from '@/components/PageTransition'
import LoginPage from '@/pages/LoginPage'
import HomePage from '@/pages/HomePage'
import TerminalPage from '@/pages/TerminalPage'
import InstanceManagerPage from '@/pages/InstanceManagerPage'
import GameDeploymentPage from './pages/GameDeploymentPage'
import ScheduledTasksPage from '@/pages/ScheduledTasksPage'
import SettingsPage from '@/pages/SettingsPage'
import PluginsPage from '@/pages/PluginsPage'
import FileManagerPage from '@/pages/FileManagerPage'
import EnvironmentManagerPage from '@/pages/EnvironmentManagerPage'
import AboutProjectPage from '@/pages/AboutProjectPage'
import LoginTransition from '@/components/LoginTransition'
import NotificationContainer from '@/components/NotificationContainer'
import GlobalMusicPlayer from '@/components/GlobalMusicPlayer'
import GlobalSystemAlert from '@/components/GlobalSystemAlert'
import GlobalSystemAlertManager from '@/components/GlobalSystemAlertManager'
import BrowserCompatibilityChecker from '@/components/BrowserCompatibilityChecker'
import OnboardingWizard from '@/components/OnboardingWizard'

// GlobalMusicPlayer包装器组件 - 只在已登录时显示
const GlobalMusicPlayerWrapper: React.FC = () => {
  const { isAuthenticated } = useAuthStore()
  
  if (!isAuthenticated) {
    return null
  }
  
  return <GlobalMusicPlayer />
}

// 受保护的路由组件
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuthStore()
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

// 公共路由组件（已登录用户重定向到首页）
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuthStore()
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }
  
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }
  
  return <>{children}</>
}

function App() {
  const { verifyToken, setLoading } = useAuthStore()
  const { theme: currentTheme, initTheme } = useThemeStore()
  const { fetchSystemInfo } = useSystemStore()
  
  useEffect(() => {
    // 初始化主题
    initTheme()
    
    // 验证token
    const initAuth = async () => {
      setLoading(true)
      try {
        await verifyToken()
        // 验证成功后预加载系统信息
        fetchSystemInfo()
      } catch (error) {
        console.error('Token验证失败:', error)
      } finally {
        setLoading(false)
      }
    }
    
    initAuth()
  }, [])
  
  return (
    <BrowserCompatibilityChecker>
      <ConfigProvider
        theme={{
          algorithm: currentTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: '#1890ff',
          },
        }}
      >
        <AntdApp>
          <div className="min-h-screen bg-game-gradient">
            <Routes>
              {/* 公共路由 */}
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <PageTransition>
                      <LoginPage />
                    </PageTransition>
                  </PublicRoute>
                }
              />
              
              {/* 受保护的路由 */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Routes>
                        <Route path="/" element={<PageTransition><HomePage /></PageTransition>} />
                        <Route path="/terminal" element={<PageTransition><TerminalPage /></PageTransition>} />
                        <Route path="/instances" element={<PageTransition><InstanceManagerPage /></PageTransition>} />
                        <Route path="/game-deployment" element={<PageTransition><GameDeploymentPage /></PageTransition>} />
                        <Route path="/scheduled-tasks" element={<PageTransition><ScheduledTasksPage /></PageTransition>} />
                        <Route path="/files" element={<PageTransition><FileManagerPage /></PageTransition>} />
                        <Route path="/environment" element={<PageTransition><EnvironmentManagerPage /></PageTransition>} />
                        <Route path="/plugins" element={<PageTransition><PluginsPage /></PageTransition>} />
                        <Route path="/settings" element={<PageTransition><SettingsPage /></PageTransition>} />
                        <Route path="/about" element={<PageTransition><AboutProjectPage /></PageTransition>} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Layout>
                  </ProtectedRoute>
                }
              />
            </Routes>
            
            {/* 全局通知容器 */}
            <NotificationContainer />
            
            {/* 全局系统告警管理器 - 只在已登录时启用 */}
            <ProtectedRoute>
              <GlobalSystemAlertManager />
            </ProtectedRoute>
            
            {/* 全局系统告警弹窗 */}
            <GlobalSystemAlert />
            
            {/* 全局音乐播放器 - 只在已登录时显示 */}
            <GlobalMusicPlayerWrapper />

            {/* 新手引导 - 只在已登录时显示 */}
            <ProtectedRoute>
              <OnboardingWizard />
            </ProtectedRoute>
          </div>
        </AntdApp>
      </ConfigProvider>
    </BrowserCompatibilityChecker>
  )
}

export default App