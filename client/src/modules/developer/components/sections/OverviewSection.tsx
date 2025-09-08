import React from 'react'
import { Info, Shield, Package, CheckCircle, AlertCircle, Key, Lock, Settings, Wrench } from 'lucide-react'

interface OverviewSectionProps {
  isAuthenticated: boolean
}

const OverviewSection: React.FC<OverviewSectionProps> = ({
  isAuthenticated
}) => {
  const features = [
    {
      title: '开发者认证',
      description: '安全的开发者身份验证系统',
      icon: Shield,
      status: isAuthenticated ? 'active' : 'inactive',
      color: isAuthenticated ? 'text-green-600' : 'text-yellow-600',
      bgColor: isAuthenticated ? 'bg-green-100 dark:bg-green-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30'
    },
    {
      title: '生产环境封装',
      description: '清理开发数据，准备生产部署',
      icon: Package,
      status: isAuthenticated ? 'available' : 'locked',
      color: isAuthenticated ? 'text-blue-600' : 'text-gray-400',
      bgColor: isAuthenticated ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'
    },
    {
      title: '开发者工具',
      description: '各种开发和调试工具集合',
      icon: Wrench,
      status: 'planned',
      color: 'text-purple-600',
      bgColor: 'bg-purple-100 dark:bg-purple-900/30'
    }
  ]

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return '已激活'
      case 'available':
        return '可用'
      case 'locked':
        return '需要认证'
      case 'planned':
        return '计划中'
      default:
        return '未知'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'available':
        return <CheckCircle className="w-4 h-4 text-blue-500" />
      case 'locked':
        return <Lock className="w-4 h-4 text-gray-400" />
      case 'planned':
        return <AlertCircle className="w-4 h-4 text-purple-500" />
      default:
        return <AlertCircle className="w-4 h-4 text-gray-400" />
    }
  }

  return (
    <div className="space-y-6">
      {/* 认证状态卡片 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h4 className="font-medium text-gray-900 dark:text-white">当前状态</h4>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 认证状态 */}
            <div className="flex items-center space-x-4">
              <div className={`p-3 rounded-full ${
                isAuthenticated 
                  ? 'bg-green-100 dark:bg-green-900/30' 
                  : 'bg-red-100 dark:bg-red-900/30'
              }`}>
                <Shield className={`w-6 h-6 ${
                  isAuthenticated 
                    ? 'text-green-600 dark:text-green-400' 
                    : 'text-red-600 dark:text-red-400'
                }`} />
              </div>
              <div>
                <h5 className="font-medium text-gray-900 dark:text-white">
                  开发者认证
                </h5>
                <div className="flex items-center space-x-2 mt-1">
                  {isAuthenticated ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-600 dark:text-green-400">
                        已认证
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-600 dark:text-red-400">
                        未认证
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 系统状态 */}
            <div className="flex items-center space-x-4">
              <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h5 className="font-medium text-gray-900 dark:text-white">
                  面板状态
                </h5>
                <div className="flex items-center space-x-2 mt-1">
                  <CheckCircle className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-blue-600 dark:text-blue-400">
                    运行正常
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 安全提示 */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
          <div>
            <h4 className="font-medium text-yellow-900 dark:text-yellow-100">
              安全提示
            </h4>
            <ul className="text-sm text-yellow-700 dark:text-yellow-300 mt-2 space-y-1">
              <li>• 开发者密码应该足够复杂，建议包含字母、数字和特殊字符</li>
              <li>• 不要在生产环境中启用开发者模式</li>
              <li>• 定期更换开发者密码以确保安全</li>
              <li>• 开发者功能具有高级权限，请谨慎使用</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OverviewSection
