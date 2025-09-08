import React from 'react'
import { AlertTriangle, Power } from 'lucide-react'

interface ProductionPackageDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

const ProductionPackageDialog: React.FC<ProductionPackageDialogProps> = ({
  isOpen,
  onClose,
  onConfirm
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            危险操作确认
          </h3>
        </div>
        
        <div className="space-y-3 mb-6">
          <p className="text-gray-700 dark:text-gray-300">
            此操作将执行以下步骤：
          </p>
          <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>删除 server/data 目录下除 instances.json 外的所有文件</li>
            <li>保留文件夹结构</li>
            <li>结束程序运行</li>
          </ul>
          <p className="text-red-600 dark:text-red-400 font-semibold">
            此操作不可逆，请确认您已备份重要数据！
          </p>
        </div>
        
        <div className="flex space-x-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center space-x-2"
          >
            <Power className="w-4 h-4" />
            <span>确认执行</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProductionPackageDialog
