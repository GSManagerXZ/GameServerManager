import React from 'react'
import { Settings, Shield, Package, CheckCircle, AlertCircle, Key, Lock } from 'lucide-react'
import DeveloperAuthForm from '../DeveloperAuthForm'
import DeveloperToolsPanel from '../DeveloperToolsPanel'
import type { DeveloperAuth } from '../../types/developer'

interface PanelSectionProps {
  auth: DeveloperAuth
  loading: boolean
  onSetPassword: (password: string, confirmPassword: string) => Promise<boolean>
  onLogin: (password: string) => Promise<boolean>
  onExecuteProductionPackage: () => Promise<boolean>
}

const PanelSection: React.FC<PanelSectionProps> = ({
  auth,
  loading,
  onSetPassword,
  onLogin,
  onExecuteProductionPackage
}) => {
  return (
    <div className="space-y-6">
      {/* 开发者认证 */}
      {!auth.isAuthenticated && (
        <DeveloperAuthForm
          auth={auth}
          loading={loading}
          onSetPassword={onSetPassword}
          onLogin={onLogin}
        />
      )}

      {/* 生产环境封装 */}
      {auth.isAuthenticated && (
        <DeveloperToolsPanel
          loading={loading}
          onExecuteProductionPackage={onExecuteProductionPackage}
        />
      )}
    </div>
  )
}

export default PanelSection
