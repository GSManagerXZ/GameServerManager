import React, { useState, useEffect } from 'react'
import { X, AlertTriangle, Clock, Trash2 } from 'lucide-react'

interface ConfirmDeleteTaskDialogProps {
  isOpen: boolean
  taskName: string
  taskType: 'power' | 'command' | 'backup'
  instanceName?: string
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDeleteTaskDialog: React.FC<ConfirmDeleteTaskDialogProps> = ({
  isOpen,
  taskName,
  taskType,
  instanceName,
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

  const getTaskTypeText = () => {
    switch (taskType) {
      case 'power':
        return '电源管理'
      case 'command':
        return '命令执行'
      case 'backup':
        return '文件夹备份'
      default:
        return '未知类型'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              确认删除定时任务
            </h3>
          </div>
        </div>

        {/* 任务信息 */}
        <div className="mb-6">
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            确定要删除定时任务 <span className="font-semibold text-gray-900 dark:text-white">"{taskName}"</span> 吗？
          </p>
          
          {/* 任务详情 */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-4">
            <div className="flex items-center space-x-2 mb-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">任务详情：</span>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium">类型：</span>{getTaskTypeText()}
              </p>
              {instanceName && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">目标实例：</span>{instanceName}
                </p>
              )}
            </div>
          </div>

          {/* 警告信息 */}
          <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <div className="flex items-start space-x-2">
              <Trash2 className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  删除后无法恢复
                </p>
                <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                  此操作将永久删除该定时任务，已计划的执行将被取消。
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
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDeleteTaskDialog