import React from 'react'
import { 
  Code, 
  Shield, 
  Package, 
  Settings, 
  Database, 
  Terminal, 
  FileText, 
  Activity,
  Wrench,
  Info,
  ChevronRight
} from 'lucide-react'

interface SidebarItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  badge?: string
  disabled?: boolean
}

interface DeveloperSidebarProps {
  activeSection: string
  onSectionChange: (section: string) => void
  isAuthenticated: boolean
}

const DeveloperSidebar: React.FC<DeveloperSidebarProps> = ({
  activeSection,
  onSectionChange,
  isAuthenticated
}) => {
  const sidebarItems: SidebarItem[] = [
    {
      id: 'overview',
      label: '概览',
      icon: Info,
      description: '开发者工具概览和状态'
    },
    {
      id: 'panel',
      label: '面板设置',
      icon: Settings,
      description: '开发者面板配置和管理'
    }
  ]

  return (
    <div className="w-80 h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
      {/* 侧边栏头部 */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
            <Code className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              开发者工具
            </h2>
          </div>
        </div>
      </div>

      {/* 导航菜单 */}
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {sidebarItems.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            const isDisabled = item.disabled

            return (
              <button
                key={item.id}
                onClick={() => !isDisabled && onSectionChange(item.id)}
                disabled={isDisabled}
                className={`
                  w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-all duration-200
                  ${isActive 
                    ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-l-4 border-orange-500' 
                    : isDisabled
                      ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }
                `}
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <Icon className={`w-5 h-5 flex-shrink-0 ${
                    isActive 
                      ? 'text-orange-600 dark:text-orange-400' 
                      : isDisabled
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-500 dark:text-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium truncate">{item.label}</span>
                      {item.badge && (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
                {!isDisabled && (
                  <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-transform ${
                    isActive ? 'rotate-90' : ''
                  }`} />
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* 侧边栏底部 */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            GSManager Developer Mode
          </p>
        </div>
      </div>
    </div>
  )
}

export default DeveloperSidebar
