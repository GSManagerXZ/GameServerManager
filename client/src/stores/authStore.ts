import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AuthState, LoginRequest } from '@/types'
import apiClient from '@/utils/api'
import socketClient from '@/utils/socket'
import { useOnboardingStore } from './onboardingStore'
import { useArmWarningStore } from '@/stores/armWarningStore'

interface AuthStore extends AuthState {
  // 控制是否在登录过期时自动跳转到登录页面
  autoRedirectOnExpire: boolean
  login: (credentials: LoginRequest) => Promise<{ success: boolean; message: string }>
  logout: () => Promise<void>
  verifyToken: () => Promise<boolean>
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; message: string }>
  changeUsername: (newUsername: string) => Promise<{ success: boolean; message: string }>
  clearError: () => void
  setLoading: (loading: boolean) => void
  setAutoRedirectOnExpire: (enabled: boolean) => void
  handleTokenExpired: () => void
  checkArmArchitecture: () => Promise<void>
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      user: null,
      token: null,
      loading: false,
      error: null,
      autoRedirectOnExpire: true, // 默认启用自动跳转

      login: async (credentials: LoginRequest) => {
        set({ loading: true, error: null })
        
        try {
          const response = await apiClient.login(credentials)
          
          if (response.success && response.token && response.user) {
            set({
              isAuthenticated: true,
              user: response.user,
              token: response.token,
              loading: false,
              error: null,
            })

            // 初始化Socket连接
            socketClient.initialize()

            // 检测是否是首次登录（没有lastLogin或者是新创建的用户）
            const isFirstLogin = !response.user.lastLogin ||
              (response.user.createdAt && new Date(response.user.createdAt).getTime() > Date.now() - 300000) // 5分钟内创建的用户

            if (isFirstLogin) {
              // 延迟显示引导，确保页面完全加载
              setTimeout(() => {
                const onboardingStore = useOnboardingStore.getState()
                onboardingStore.setFirstLogin(true)
                onboardingStore.setShowOnboarding(true)
              }, 1000)
            }

            // 检测ARM架构并显示警告（仅限一次）
            setTimeout(() => {
              get().checkArmArchitecture()
            }, 1500)

            return { success: true, message: response.message }
          } else {
            set({
              isAuthenticated: false,
              user: null,
              token: null,
              loading: false,
              error: response.message,
            })
            
            return { success: false, message: response.message }
          }
        } catch (error: any) {
          const errorMessage = error.message || '登录失败，请稍后重试'
          set({
            isAuthenticated: false,
            user: null,
            token: null,
            loading: false,
            error: errorMessage,
          })
          
          return { success: false, message: errorMessage }
        }
      },

      logout: async () => {
        set({ loading: true })
        
        try {
          await apiClient.logout()
        } catch (error) {
          console.error('登出请求失败:', error)
        } finally {
          set({
            isAuthenticated: false,
            user: null,
            token: null,
            loading: false,
            error: null,
          })
          
          // 断开Socket连接
          socketClient.disconnect()
          
          // 不再自动跳转到登录页，让调用方决定
        }
      },

      verifyToken: async () => {
        const { token } = get()
        
        if (!token) {
          set({
            isAuthenticated: false,
            user: null,
            token: null,
            loading: false,
          })
          return false
        }
        
        set({ loading: true })
        
        try {
          const response = await apiClient.verifyToken()
          
          if (response.success && response.user) {
            set({
              isAuthenticated: true,
              user: response.user,
              loading: false,
              error: null,
            })
            
            // 初始化Socket连接
            socketClient.initialize()
            
            return true
          } else {
            // Token验证失败时不清除认证状态，只设置错误信息
            set({
              loading: false,
              error: response.message,
            })
            
            return false
          }
        } catch (error: any) {
          // 网络错误或其他异常时也不清除认证状态
          set({
            loading: false,
            error: error.message || 'Token验证失败',
          })
          
          return false
        }
      },

      changePassword: async (oldPassword: string, newPassword: string) => {
        set({ loading: true, error: null })
        
        try {
          const response = await apiClient.changePassword(oldPassword, newPassword)
          
          set({ loading: false })
          
          if (!response.success) {
            set({ error: response.message })
          }
          
          return response
        } catch (error: any) {
          const errorMessage = error.message || '修改密码失败'
          set({
            loading: false,
            error: errorMessage,
          })
          
          return { success: false, message: errorMessage }
        }
      },

      changeUsername: async (newUsername: string) => {
        set({ loading: true, error: null })
        
        try {
          const response = await apiClient.changeUsername(newUsername)
          
          if (response.success && response.user) {
            // 更新用户信息
            set({
              user: response.user,
              loading: false,
              error: null,
            })
          } else {
            set({
              loading: false,
              error: response.message,
            })
          }
          
          return response
        } catch (error: any) {
          const errorMessage = error.message || '修改用户名失败'
          set({
            loading: false,
            error: errorMessage,
          })
          
          return { success: false, message: errorMessage }
        }
      },

      clearError: () => {
        set({ error: null })
      },

      setLoading: (loading: boolean) => {
        set({ loading })
      },

      setAutoRedirectOnExpire: (enabled: boolean) => {
        set({ autoRedirectOnExpire: enabled })
      },

      handleTokenExpired: () => {
        const { autoRedirectOnExpire } = get()
        
        // 清除认证状态
        set({
          isAuthenticated: false,
          user: null,
          token: null,
          loading: false,
          error: '登录已过期，请重新登录',
        })
        
        // 断开Socket连接
        socketClient.disconnect()
        
        // 如果启用了自动跳转，则跳转到登录页面
        if (autoRedirectOnExpire) {
          // 使用window.location.href确保能够跳转
          window.location.href = '/login'
        }
      },

      checkArmArchitecture: async () => {
        try {
          // 检查是否已经显示过ARM架构警告
          const hasShownArmWarning = localStorage.getItem('gsm3_arm_warning_shown')
          if (hasShownArmWarning === 'true') {
            return
          }

          // 获取系统信息
          const response = await apiClient.get('/environment/system-info')
          if (response.success && response.data) {
            const { arch } = response.data

            // 检测ARM架构 (arm64, aarch64, arm)
            if (arch && (arch.includes('arm') || arch.includes('aarch64'))) {
              // 显示ARM架构警告
              const armWarningStore = useArmWarningStore.getState()
              armWarningStore.showWarning()

              // 标记已显示过警告
              localStorage.setItem('gsm3_arm_warning_shown', 'true')
            }
          }
        } catch (error) {
          console.error('检测ARM架构失败:', error)
        }
      },
    }),
    {
      name: 'gsm3-auth',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        token: state.token,
        autoRedirectOnExpire: state.autoRedirectOnExpire,
      }),
    }
  )
)