import React, { useState, useEffect } from 'react'
import { Package, Trash2, Loader2, Clock, Shield, AlertTriangle } from 'lucide-react'
import ProductionPackageDialog from './ProductionPackageDialog'
import apiClient from '@/utils/api'
import { useNotificationStore } from '@/stores/notificationStore'

interface DeveloperToolsPanelProps {
  loading: boolean
  onExecuteProductionPackage: () => Promise<boolean>
}

const DeveloperToolsPanel: React.FC<DeveloperToolsPanelProps> = ({
  loading,
  onExecuteProductionPackage
}) => {
  const [showProductionWarning, setShowProductionWarning] = useState(false)
  const [tokenExpireHours, setTokenExpireHours] = useState<number>(24)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [currentConfig, setCurrentConfig] = useState<{
    tokenResetRule: 'startup' | 'expire'
    tokenExpireHours: number | null
  } | null>(null)
  const { addNotification } = useNotificationStore()

  // 加载当前安全配置
  useEffect(() => {
    loadSecurityConfig()
  }, [])

  const loadSecurityConfig = async () => {
    try {
      const result = await apiClient.getSecurityConfig()
      if (result.success && result.data) {
        setCurrentConfig({
          tokenResetRule: result.data.tokenResetRule,
          tokenExpireHours: result.data.tokenExpireHours
        })
        if (result.data.tokenExpireHours) {
          setTokenExpireHours(result.data.tokenExpireHours)
        }
      }
    } catch (error) {
      console.error('加载安全配置失败:', error)
    }
  }

  const handleProductionPackage = async () => {
    setShowProductionWarning(false)
    await onExecuteProductionPackage()
  }

  const handleForceUpdateTokenExpire = async () => {
    if (tokenExpireHours <= 0) {
      addNotification({
        type: 'error',
        title: '输入错误',
        message: '令牌到期时间必须大于0'
      })
      return
    }

    setTokenLoading(true)
    try {
      const result = await apiClient.updateSecurityConfig({
        tokenResetRule: currentConfig?.tokenResetRule || 'expire',
        tokenExpireHours: tokenExpireHours
      })

      if (result.success) {
        addNotification({
          type: 'success',
          title: '更新成功',
          message: `令牌到期时间已强制更新为 ${tokenExpireHours} 小时`
        })
        await loadSecurityConfig()
      } else {
        addNotification({
          type: 'error',
          title: '更新失败',
          message: result.message || '更新令牌到期时间失败'
        })
      }
    } catch (error: any) {
      addNotification({
        type: 'error',
        title: '更新失败',
        message: error.message || '网络错误，请稍后重试'
      })
    } finally {
      setTokenLoading(false)
    }
  }

  return (
    <>
      {/* 强制修改令牌到期时间 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start space-x-3">
          <Clock className="w-5 h-5 text-blue-500 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center space-x-2">
              <span>强制修改令牌到期时间</span>
              <Shield className="w-4 h-4 text-orange-500" />
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              开发者工具允许您强制修改令牌到期时间，即使在 HTTP 访问环境下也可以操作。此功能仅用于开发和调试目的。
            </p>

            {/* 当前配置显示 */}
            {currentConfig && (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  当前配置：
                </p>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  • 重置规则: {currentConfig.tokenResetRule === 'startup' ? '启动时重置' : '过期自动重置'}
                </p>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  • 到期时间: {currentConfig.tokenExpireHours === null ? '永不到期' : `${currentConfig.tokenExpireHours} 小时`}
                </p>
              </div>
            )}

            {/* 警告提示 */}
            <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-orange-800 dark:text-orange-200 font-medium mb-1">
                    开发者专用功能
                  </p>
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    此功能绕过 HTTP 访问限制，仅供开发调试使用。生产环境请使用 HTTPS 并通过设置页面修改。
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="1"
                  max="8760"
                  value={tokenExpireHours}
                  onChange={(e) => setTokenExpireHours(parseInt(e.target.value) || 24)}
                  className="w-24 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={tokenLoading}
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">小时</span>
              </div>
              <button
                onClick={handleForceUpdateTokenExpire}
                disabled={tokenLoading}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {tokenLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Clock className="w-4 h-4" />
                )}
                <span>{tokenLoading ? '更新中...' : '强制更新'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 正式环境封装 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start space-x-3">
          <Trash2 className="w-5 h-5 text-red-500 mt-1" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              正式环境封装
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              清理开发环境数据，保留实例配置，为正式部署做准备。此操作将删除 server/data 目录下除 instances.json 外的所有文件，并结束程序运行。
            </p>
            <button
              onClick={() => setShowProductionWarning(true)}
              disabled={loading}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Package className="w-4 h-4" />
              )}
              <span>{loading ? '处理中...' : '执行正式环境封装'}</span>
            </button>
          </div>
        </div>
      </div>

      <ProductionPackageDialog
        isOpen={showProductionWarning}
        onClose={() => setShowProductionWarning(false)}
        onConfirm={handleProductionPackage}
      />
    </>
  )
}

export default DeveloperToolsPanel
