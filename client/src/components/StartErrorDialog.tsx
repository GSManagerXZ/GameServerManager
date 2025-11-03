import React, { useState, useEffect } from 'react'
import { X, AlertTriangle, Terminal, FolderOpen } from 'lucide-react'

interface StartErrorDialogProps {
  isOpen: boolean
  instanceName: string
  errorMessage: string
  workingDirectory?: string
  onClose: () => void
}

export const StartErrorDialog: React.FC<StartErrorDialogProps> = ({
  isOpen,
  instanceName,
  errorMessage,
  workingDirectory,
  onClose
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

  const handleClose = () => {
    setIsAnimating(false)
    setIsClosing(true)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  if (!isVisible) return null

  // 解析错误信息，提取主要错误和详细信息
  const parseErrorMessage = (message: string) => {
    const lines = message.split('\n')
    const mainError = lines[0] || message
    const details = lines.slice(1).filter(line => line.trim())
    return { mainError, details }
  }

  const { mainError, details } = parseErrorMessage(errorMessage)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className={`absolute inset-0 bg-black/50 ${
          isClosing ? 'animate-fade-out' : isAnimating ? 'animate-fade-in' : 'opacity-0'
        }`}
        onClick={handleClose}
      />
      
      {/* 对话框内容 */}
      <div className={`relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 ${
        isClosing ? 'animate-scale-out' : isAnimating ? 'animate-scale-in' : 'opacity-0 scale-95'
      }`}>
        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
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
              启动失败
            </h3>
          </div>
        </div>

        {/* 实例信息 */}
        <div className="mb-6">
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            实例 <span className="font-semibold text-gray-900 dark:text-white">"{instanceName}"</span> 启动失败：
          </p>
          
          {/* 工作目录信息 */}
          {workingDirectory && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-4">
              <div className="flex items-center space-x-2 mb-2">
                <FolderOpen className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">工作目录：</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-mono break-all bg-gray-100 dark:bg-gray-600 p-2 rounded">
                {workingDirectory}
              </p>
            </div>
          )}

          {/* 错误信息 */}
          <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
              <div className="flex-1">
                <p className="text-sm font-medium mb-1 text-red-800 dark:text-red-200">
                  {mainError}
                </p>
                {details.length > 0 && (
                  <div className="text-xs space-y-1 text-red-700 dark:text-red-300 mt-2">
                    {details.map((detail, index) => (
                      <p key={index} className="whitespace-pre-wrap">{detail}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}

export default StartErrorDialog

