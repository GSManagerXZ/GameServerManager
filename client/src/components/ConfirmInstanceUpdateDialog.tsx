import React, { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmInstanceUpdateDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (updateInstanceInfo: boolean) => void
  instanceName: string
  gameName: string
}

const ConfirmInstanceUpdateDialog: React.FC<ConfirmInstanceUpdateDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  instanceName,
  gameName
}) => {
  const [isAnimating, setIsAnimating] = useState(false)
  const [updateInstanceInfo, setUpdateInstanceInfo] = useState(false)

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true)
        })
      })
    } else {
      setIsAnimating(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleConfirm = () => {
    onConfirm(updateInstanceInfo)
  }

  const handleClose = () => {
    setIsAnimating(false)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  return (
    <div
      className={`fixed inset-0 bg-black transition-opacity duration-300 z-50 ${
        isAnimating ? 'bg-opacity-50' : 'bg-opacity-0'
      }`}
      onClick={handleClose}
    >
      <div className="flex items-center justify-center min-h-screen p-4">
        <div
          className={`bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl transition-all duration-300 ${
            isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              </div>
              <h3 className="text-lg font-semibold text-white">检测到已安装游戏</h3>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="text-gray-300 space-y-2">
              <p>
                检测到实例 <span className="font-semibold text-white">"{instanceName}"</span> 已存在。
              </p>
              <p className="text-sm">
                本次部署将自动勾选<span className="font-semibold text-blue-400">'校验游戏完整性'</span>
                实现游戏更新和校验，并不会再额外创建实例。
              </p>
            </div>

            {/* 更新实例信息选项 */}
            <div className="bg-gray-700/50 rounded-lg p-4">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={updateInstanceInfo}
                  onChange={(e) => setUpdateInstanceInfo(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
                />
                <div className="flex-1">
                  <div className="text-white font-medium">更新现有实例信息</div>
                  <div className="text-sm text-gray-400 mt-1">
                    勾选后将更新实例的启动命令、停止命令等配置信息
                  </div>
                </div>
              </label>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                确认更新
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConfirmInstanceUpdateDialog

