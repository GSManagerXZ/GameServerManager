import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Menu, X } from 'lucide-react'
import DeveloperSidebar from './DeveloperSidebar'

interface DeveloperLayoutProps {
  children: React.ReactNode
  activeSection: string
  onSectionChange: (section: string) => void
  isAuthenticated: boolean
  title?: string
  description?: string
}

const DeveloperLayout: React.FC<DeveloperLayoutProps> = ({
  children,
  activeSection,
  onSectionChange,
  isAuthenticated,
  title = '开发者工具',
  description = 'GSM3 开发者工具和高级功能'
}) => {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex overflow-hidden">
      {/* 移动端侧边栏遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 - 桌面端固定显示 */}
      <div className="hidden lg:block h-full">
        <DeveloperSidebar
          activeSection={activeSection}
          onSectionChange={onSectionChange}
          isAuthenticated={isAuthenticated}
        />
      </div>

      {/* 侧边栏 - 移动端抽屉式 */}
      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out lg:hidden h-full
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <DeveloperSidebar
          activeSection={activeSection}
          onSectionChange={(section) => {
            onSectionChange(section)
            setSidebarOpen(false) // 移动端选择后关闭侧边栏
          }}
          isAuthenticated={isAuthenticated}
        />
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* 顶部导航栏 */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2 lg:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* 移动端菜单按钮 */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700"
              >
                {sidebarOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>

              {/* 页面标题 */}
              <div>
                <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {title}
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {description}
                </p>
              </div>
            </div>

            {/* 返回按钮 */}
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">返回面板</span>
            </button>
          </div>
        </header>

        {/* 主内容 */}
        <main className="flex-1 overflow-auto">
          <div className="p-4 lg:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

export default DeveloperLayout
