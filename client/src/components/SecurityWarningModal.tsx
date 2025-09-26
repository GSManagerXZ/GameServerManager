import React from 'react'
import { AlertTriangle, Shield, X } from 'lucide-react'

interface SecurityWarningModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
}

const SecurityWarningModal: React.FC<SecurityWarningModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消'
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl transform transition-all duration-300 scale-100">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-black dark:text-white">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="mb-6">
          <div className="flex items-start space-x-3 mb-4">
            <Shield className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" />
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              {message}
            </p>
          </div>
          
          {/* 安全警告列表 */}
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
            <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-2">
              安全风险提示：
            </h4>
            <ul className="text-sm text-orange-700 dark:text-orange-300 space-y-1">
              <li>• 永不到期的令牌存在安全风险</li>
              <li>• 令牌泄露后无法自动失效</li>
              <li>• 建议定期更换令牌以提高安全性</li>
              <li>• 请确保在安全的环境中使用</li>
            </ul>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex space-x-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SecurityWarningModal
