import React, { useState } from 'react'
import { Package, Trash2, Loader2 } from 'lucide-react'
import ProductionPackageDialog from './ProductionPackageDialog'

interface DeveloperToolsPanelProps {
  loading: boolean
  onExecuteProductionPackage: () => Promise<boolean>
}

const DeveloperToolsPanel: React.FC<DeveloperToolsPanelProps> = ({
  loading,
  onExecuteProductionPackage
}) => {
  const [showProductionWarning, setShowProductionWarning] = useState(false)

  const handleProductionPackage = async () => {
    setShowProductionWarning(false)
    await onExecuteProductionPackage()
  }

  return (
    <>
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
