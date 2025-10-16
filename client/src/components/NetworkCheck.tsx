import React, { useEffect, useState } from 'react'
import { useNetworkCheckStore } from '@/stores/networkCheckStore'
import { 
  Wifi, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react'

const NetworkCheck: React.FC = () => {
  const { 
    categories, 
    allChecksComplete, 
    allChecksPassed, 
    checking, 
    checkAll, 
    checkSingle 
  } = useNetworkCheckStore()
  
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [showBanner, setShowBanner] = useState(true)

  // 切换分类展开/折叠
  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId)
    } else {
      newExpanded.add(categoryId)
    }
    setExpandedCategories(newExpanded)
  }

  // 获取状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />
      case 'checking':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      default:
        return <AlertCircle className="w-5 h-5 text-gray-400" />
    }
  }

  // 格式化响应时间
  const formatResponseTime = (time?: number) => {
    if (!time) return '-'
    return `${time}ms`
  }

  return (
    <div className="space-y-4">
      {/* 网络状态横幅 */}
      {showBanner && allChecksComplete && (
        <div 
          className={`p-4 rounded-lg border-l-4 transition-all duration-300 ${
            allChecksPassed 
              ? 'bg-green-50 dark:bg-green-900/20 border-green-500' 
              : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {allChecksPassed ? (
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              ) : (
                <AlertCircle className="w-6 h-6 text-yellow-500" />
              )}
              <p className={`font-medium ${
                allChecksPassed 
                  ? 'text-green-800 dark:text-green-300' 
                  : 'text-yellow-800 dark:text-yellow-300'
              }`}>
                {allChecksPassed 
                  ? '网络正常且无阻，您可以畅快使用GSManager中所有在线服务' 
                  : '部分网络服务连接异常，可能影响相关功能的使用'
                }
              </p>
            </div>
            <button
              onClick={() => setShowBanner(false)}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* 网络检测卡片 */}
      <div className="card-game p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Wifi className="w-6 h-6 text-blue-500" />
            <h3 className="text-xl font-semibold text-black dark:text-white">网络连接检测</h3>
          </div>
          <button
            onClick={checkAll}
            disabled={checking}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
              checking
                ? 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {checking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{checking ? '检测中...' : '检测所有'}</span>
          </button>
        </div>

        {/* 检测项列表 */}
        <div className="space-y-4">
          {categories.map((category) => {
            const isExpanded = expandedCategories.has(category.id)
            const allSuccess = category.items.every(item => item.status === 'success')
            const anyFailed = category.items.some(item => item.status === 'failed')
            const anyChecking = category.items.some(item => item.status === 'checking')

            return (
              <div key={category.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                {/* 分类头部 */}
                <div
                  onClick={() => toggleCategory(category.id)}
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    {anyChecking ? (
                      <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    ) : allSuccess ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : anyFailed ? (
                      <XCircle className="w-5 h-5 text-red-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-gray-400" />
                    )}
                    <h4 className="font-medium text-black dark:text-white">{category.name}</h4>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({category.items.filter(item => item.status === 'success').length}/{category.items.length})
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-500" />
                  )}
                </div>

                {/* 分类项列表 */}
                {isExpanded && (
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {category.items.map((item) => (
                      <div key={item.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3 flex-1">
                            {getStatusIcon(item.status)}
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <p className="font-medium text-black dark:text-white">{item.name}</p>
                                {item.status === 'failed' && item.errorMessage && (
                                  <div className="group relative">
                                    <AlertCircle className="w-4 h-4 text-yellow-500 cursor-help" />
                                    <div className="absolute left-0 top-6 w-80 p-3 bg-gray-900 dark:bg-gray-800 text-white text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                      <p className="font-medium mb-1">连接失败</p>
                                      <p className="text-gray-300 dark:text-gray-400">{item.errorMessage}</p>
                                      <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 dark:bg-gray-800 transform rotate-45"></div>
                                    </div>
                                  </div>
                                )}
                              </div>
                              {item.status === 'success' && item.responseTime && (
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                  响应时间: {formatResponseTime(item.responseTime)}
                                </p>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              checkSingle(category.id, item.id)
                            }}
                            disabled={item.status === 'checking'}
                            className={`ml-4 px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                              item.status === 'checking'
                                ? 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed'
                                : 'bg-blue-500 hover:bg-blue-600 text-white'
                            }`}
                          >
                            {item.status === 'checking' && (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            )}
                            <span>{item.status === 'checking' ? '检测中' : '检测'}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 提示信息 */}
        {!allChecksComplete && !checking && (
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  点击"检测所有"按钮开始检测网络连接状态，或点击单项"检测"按钮检测特定服务。
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default NetworkCheck

