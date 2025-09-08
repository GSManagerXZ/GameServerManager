import { useState, useEffect, useCallback } from 'react'
import { useNotificationStore } from '@/stores/notificationStore'
import { developerApi } from '../services/developerApi'
import type { DeveloperAuth } from '../types/developer'

/**
 * 开发者认证Hook
 */
export function useDeveloperAuth() {
  const { addNotification } = useNotificationStore()
  
  const [auth, setAuth] = useState<DeveloperAuth>({ 
    isAuthenticated: false, 
    hasPassword: false 
  })
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  /**
   * 检查认证状态
   */
  const checkAuthStatus = useCallback(async () => {
    try {
      const authData = await developerApi.checkAuthStatus()
      setAuth(authData)
    } catch (error) {
      console.error('检查开发者认证状态失败:', error)
      addNotification({
        type: 'error',
        title: '检查认证状态失败',
        message: error instanceof Error ? error.message : '未知错误'
      })
    } finally {
      setLoading(false)
    }
  }, [addNotification])

  /**
   * 设置开发者密码
   */
  const setPassword = useCallback(async (password: string, confirmPassword: string) => {
    if (password !== confirmPassword) {
      addNotification({
        type: 'error',
        title: '密码不匹配',
        message: '两次输入的密码不一致'
      })
      return false
    }

    if (password.length < 6) {
      addNotification({
        type: 'error',
        title: '密码太短',
        message: '密码长度至少需要6位'
      })
      return false
    }

    setActionLoading(true)
    try {
      const token = await developerApi.setPassword(password)
      
      // 存储开发者token
      localStorage.setItem('gsm3_developer_token', token)
      
      setAuth({ isAuthenticated: true, hasPassword: true })
      
      addNotification({
        type: 'success',
        title: '密码设置成功',
        message: '开发者密码已设置'
      })
      
      return true
    } catch (error) {
      addNotification({
        type: 'error',
        title: '设置失败',
        message: error instanceof Error ? error.message : '设置开发者密码失败'
      })
      return false
    } finally {
      setActionLoading(false)
    }
  }, [addNotification])

  /**
   * 开发者登录
   */
  const login = useCallback(async (password: string) => {
    if (!password) {
      addNotification({
        type: 'error',
        title: '请输入密码',
        message: '开发者密码不能为空'
      })
      return false
    }

    setActionLoading(true)
    try {
      const token = await developerApi.login(password)
      
      // 存储开发者token
      localStorage.setItem('gsm3_developer_token', token)
      
      setAuth({ isAuthenticated: true, hasPassword: true })
      
      addNotification({
        type: 'success',
        title: '登录成功',
        message: '欢迎进入开发者模式'
      })
      
      return true
    } catch (error) {
      addNotification({
        type: 'error',
        title: '登录失败',
        message: error instanceof Error ? error.message : '开发者密码错误'
      })
      return false
    } finally {
      setActionLoading(false)
    }
  }, [addNotification])

  /**
   * 执行正式环境封装
   */
  const executeProductionPackage = useCallback(async () => {
    setActionLoading(true)
    try {
      await developerApi.executeProductionPackage()
      
      addNotification({
        type: 'success',
        title: '封装成功',
        message: '正式环境封装完成，程序即将退出'
      })
      
      // 延迟一下让用户看到通知
      setTimeout(() => {
        window.close()
      }, 2000)
      
      return true
    } catch (error) {
      addNotification({
        type: 'error',
        title: '封装失败',
        message: error instanceof Error ? error.message : '正式环境封装失败'
      })
      return false
    } finally {
      setActionLoading(false)
    }
  }, [addNotification])

  // 初始化时检查认证状态
  useEffect(() => {
    checkAuthStatus()
  }, [checkAuthStatus])

  return {
    auth,
    loading,
    actionLoading,
    checkAuthStatus,
    setPassword,
    login,
    executeProductionPackage
  }
}
