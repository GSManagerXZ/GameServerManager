import React, { useEffect, useState } from 'react'
import { useNetworkCheckStore } from '@/stores/networkCheckStore'
import { CheckCircle2, AlertCircle, XCircle, Loader2, RefreshCw } from 'lucide-react'

interface NetworkStatusBannerProps {
  /** 分类ID：steam, minecraft, modrinth, gsmanager */
  categoryId?: string
  /** 项目ID：如果只检查分类中的某一项 */
  itemId?: string
  /** 是否自动检测 */
  autoCheck?: boolean
}

const NetworkStatusBanner: React.FC<NetworkStatusBannerProps> = ({ 
  categoryId, 
  itemId,
  autoCheck = false 
}) => {
  const { categories, checkSingle } = useNetworkCheckStore()
  const [closed, setClosed] = useState(false)

  // 获取要显示的项目
  const getRelevantItems = () => {
    if (!categoryId) return []
    
    const category = categories.find(c => c.id === categoryId)
    if (!category) return []
    
    // 如果指定了itemId，只返回该项
    if (itemId) {
      const item = category.items.find(i => i.id === itemId)
      return item ? [{ ...item, categoryId }] : []
    }
    
    // 否则返回该分类的所有项
    return category.items.map(item => ({ ...item, categoryId }))
  }

  const relevantItems = getRelevantItems()
  
  // 自动检测（仅首次加载时）
  useEffect(() => {
    if (autoCheck && relevantItems.length > 0) {
      relevantItems.forEach(item => {
        // 只对未检测的项进行检测
        if (item.status === 'pending') {
          checkSingle(item.categoryId, item.id)
        }
      })
    }
  }, []) // 空依赖数组，只在首次加载时运行

  // 如果没有要显示的项目，不渲染
  if (relevantItems.length === 0) return null

  // 如果横幅已关闭，不渲染
  if (closed) return null

  // 检测状态统计
  const allChecking = relevantItems.every(item => item.status === 'checking')
  const anyChecking = relevantItems.some(item => item.status === 'checking')
  const allSuccess = relevantItems.every(item => item.status === 'success')
  const anyFailed = relevantItems.some(item => item.status === 'failed')
  const allPending = relevantItems.every(item => item.status === 'pending')

  // 如果全部未检测，不显示横幅
  if (allPending) return null

  // 手动重新检测
  const handleRecheck = () => {
    relevantItems.forEach(item => {
      checkSingle(item.categoryId, item.id)
    })
  }

  // 获取显示文本
  const getBannerText = () => {
    if (allSuccess) {
      if (relevantItems.length === 1) {
        return `${relevantItems[0].name} 连接正常`
      }
      return `所有网络服务连接正常`
    }
    
    if (anyFailed) {
      const failedItems = relevantItems.filter(item => item.status === 'failed')
      if (failedItems.length === 1) {
        return failedItems[0].errorMessage || `${failedItems[0].name} 连接异常`
      }
      return `部分网络服务连接异常，可能影响相关功能`
    }
    
    return '正在检测网络连接...'
  }

  // 获取横幅样式
  const getBannerStyle = () => {
    if (allChecking || anyChecking) {
      return 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
    }
    if (allSuccess) {
      return 'bg-green-50 dark:bg-green-900/20 border-green-500'
    }
    if (anyFailed) {
      return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
    }
    return 'bg-gray-50 dark:bg-gray-900/20 border-gray-500'
  }

  // 获取图标
  const getIcon = () => {
    if (allChecking || anyChecking) {
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
    }
    if (allSuccess) {
      return <CheckCircle2 className="w-5 h-5 text-green-500" />
    }
    if (anyFailed) {
      return <AlertCircle className="w-5 h-5 text-yellow-500" />
    }
    return <AlertCircle className="w-5 h-5 text-gray-500" />
  }

  // 获取文本颜色
  const getTextColor = () => {
    if (allChecking || anyChecking) {
      return 'text-blue-800 dark:text-blue-300'
    }
    if (allSuccess) {
      return 'text-green-800 dark:text-green-300'
    }
    if (anyFailed) {
      return 'text-yellow-800 dark:text-yellow-300'
    }
    return 'text-gray-800 dark:text-gray-300'
  }

  return (
    <div 
      className={`p-4 rounded-lg border-l-4 transition-all duration-300 ${getBannerStyle()} animate-fade-in`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3 flex-1">
          {getIcon()}
          <div className="flex-1">
            <p className={`font-medium ${getTextColor()}`}>
              {getBannerText()}
            </p>
            {anyFailed && relevantItems.length === 1 && relevantItems[0].responseTime && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                响应时间: {relevantItems[0].responseTime}ms
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {/* 重新检测按钮 */}
          {!anyChecking && (
            <button
              onClick={handleRecheck}
              className="p-2 hover:bg-white/50 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
              title="重新检测"
            >
              <RefreshCw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}
          {/* 关闭按钮 */}
          <button
            onClick={() => setClosed(true)}
            className="p-2 hover:bg-white/50 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
            title="关闭"
          >
            <XCircle className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>
      
      {/* 显示详细项目状态（当有多个项目时） */}
      {relevantItems.length > 1 && !allChecking && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="space-y-2">
            {relevantItems.map(item => (
              <div key={item.id} className="flex items-center space-x-2 text-sm">
                {item.status === 'checking' && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
                {item.status === 'success' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                {item.status === 'failed' && <XCircle className="w-3 h-3 text-red-500" />}
                {item.status === 'pending' && <AlertCircle className="w-3 h-3 text-gray-400" />}
                <span className={`${getTextColor()}`}>
                  {item.name}
                  {item.status === 'success' && item.responseTime && ` (${item.responseTime}ms)`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default NetworkStatusBanner

