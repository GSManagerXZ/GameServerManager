import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useDeveloperAuth } from '../hooks/useDeveloperAuth'
import DeveloperLayout from '../components/DeveloperLayout'
import OverviewSection from '../components/sections/OverviewSection'
import PanelSection from '../components/sections/PanelSection'

const DeveloperPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState('overview')
  const {
    auth,
    loading,
    actionLoading,
    setPassword,
    login,
    executeProductionPackage
  } = useDeveloperAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600 dark:text-gray-400">加载中...</p>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return <OverviewSection isAuthenticated={auth.isAuthenticated} />

      case 'panel':
        return (
          <PanelSection
            auth={auth}
            loading={actionLoading}
            onSetPassword={setPassword}
            onLogin={login}
            onExecuteProductionPackage={executeProductionPackage}
          />
        )

      default:
        return <OverviewSection isAuthenticated={auth.isAuthenticated} />
    }
  }

  const getSectionTitle = () => {
    const titles: Record<string, string> = {
      overview: '概览',
      panel: '面板设置'
    }
    return titles[activeSection] || '开发者工具'
  }

  const getSectionDescription = () => {
    const descriptions: Record<string, string> = {
      overview: '开发者工具概览和系统状态',
      panel: '开发者面板配置和管理'
    }
    return descriptions[activeSection] || 'GSM3 开发者工具和高级功能'
  }

  return (
    <DeveloperLayout
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      isAuthenticated={auth.isAuthenticated}
      title={getSectionTitle()}
      description={getSectionDescription()}
    >
      {renderContent()}
    </DeveloperLayout>
  )
}

export default DeveloperPage
