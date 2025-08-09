import React, { useState, useEffect } from 'react'
import { X, AlertTriangle, Terminal, Play } from 'lucide-react'

interface ConfirmStartDialogProps {
  isOpen: boolean
  instanceName: string
  startCommand: string
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmStartDialog: React.FC<ConfirmStartDialogProps> = ({
  isOpen,
  instanceName,
  startCommand,
  onConfirm,
  onCancel
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false)
      setIsVisible(true)
      setTimeout(() => setIsAnimating(true), 10)
    } else {
      setIsAnimating(false)
      setIsClosing(true)
      setTimeout(() => setIsVisible(false), 300)
    }
  }, [isOpen])

  const handleCancel = () => {
    setIsAnimating(false)
    setIsClosing(true)
    setTimeout(() => {
      onCancel()
    }, 300)
  }

  const handleConfirm = () => {
    setIsAnimating(false)
    setIsClosing(true)
    setTimeout(() => {
      onConfirm()
    }, 300)
  }

  if (!isVisible) return null

  // 检测启动命令是否为none
  const isCommandSuspicious = startCommand === 'none'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className={`absolute inset-0 bg-black/50 ${
          isClosing ? 'animate-fade-out' : isAnimating ? 'animate-fade-in' : 'opacity-0'
        }`}
        onClick={handleCancel}
      />
      
      {/* 对话框内容 */}
      <div className={`relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 ${
        isClosing ? 'animate-scale-out' : isAnimating ? 'animate-scale-in' : 'opacity-0 scale-95'
      }`}>
        {/* 关闭按钮 */}
        <button
          onClick={handleCancel}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 标题和图标 */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex-shrink-0">
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              启动命令警告
            </h3>
          </div>
        </div>

        {/* 实例信息 */}
        <div className="mb-6">
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            实例 <span className="font-semibold text-gray-900 dark:text-white">"{instanceName}"</span> 的启动命令可能存在问题：
          </p>
          
          {/* 启动命令信息 */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-4">
            <div className="flex items-center space-x-2 mb-2">
              <Terminal className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">启动命令：</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-mono break-all bg-gray-100 dark:bg-gray-600 p-2 rounded">
              {startCommand}
            </p>
          </div>

          {/* 警告信息 */}
          <div className="border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium mb-1">
                  检测到以下问题：
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
                  <li>• 启动命令为 "none"，则代表无启动命令，需要自行查询启动命令否则将无法启动</li>
                </ul>
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-2">
                  建议检查启动命令是否正确，或者修改实例配置后再启动。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
          >
            取消启动
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-yellow-600 border border-transparent rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-colors"
          >
            <Play className="w-4 h-4" />
            <span>继续启动</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmStartDialog
