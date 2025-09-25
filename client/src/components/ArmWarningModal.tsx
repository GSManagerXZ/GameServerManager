import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X, Cpu, Server, Shield } from 'lucide-react'
import { useArmWarningStore } from '@/stores/armWarningStore'

const ArmWarningModal: React.FC = () => {
  const { isVisible, isClosing, closeWarning } = useArmWarningStore()

  if (!isVisible) {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className={`fixed inset-0 z-[70] flex items-center justify-center transition-all duration-300 ${
          isClosing ? 'bg-opacity-0' : 'bg-opacity-75'
        } bg-black backdrop-blur-sm`}
        onClick={closeWarning}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={`relative bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-lg w-full mx-4 transform transition-all duration-300 ${
            isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
          } border-2 border-orange-500/50`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 关闭按钮 */}
          <button
            onClick={closeWarning}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>

          {/* 头部 */}
          <div className="p-6 pb-4">
            <div className="flex items-center space-x-4 mb-4">
              <div className="p-3 rounded-lg bg-orange-500/20 flex-shrink-0">
                <Cpu className="w-8 h-8 text-orange-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  ARM架构警告
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  检测到您当前使用的是ARM架构，此架构目前仍在测试阶段
                </p>
              </div>
            </div>
          </div>

          {/* 内容 */}
          <div className="px-6 pb-6">
            <div className="space-y-4">
              {/* 警告信息 */}
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-orange-800 dark:text-orange-200">
                    <p className="font-medium mb-2">您可能会遇到以下问题：</p>
                  </div>
                </div>
              </div>

              {/* 问题列表 */}
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mt-0.5">
                    <span className="text-red-600 dark:text-red-400 text-sm font-bold">1</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <Server className="w-4 h-4 text-red-500" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">游戏服务端兼容性问题</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      ARM架构由于特殊性，Steam等众多单机游戏服务端均无法部署和运行，面板已自动隐藏不受支持的部分
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mt-0.5">
                    <span className="text-yellow-600 dark:text-yellow-400 text-sm font-bold">2</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <Shield className="w-4 h-4 text-yellow-500" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">技术支持限制</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      运行部分服务端您可能会遇到较多的问题需要自行寻找答案，将不受官方支持
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-0.5">
                    <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">3</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <AlertTriangle className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">测试阶段风险</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      目前ARM架构面板仍在测试阶段，可能会存在无法预料的问题
                    </p>
                  </div>
                </div>
              </div>

              {/* 底部提示 */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mt-4">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <span className="font-medium">提示：</span>
                  如果您需要完整的游戏服务端管理功能，建议使用AMD64(x86_64)架构的服务器。
                </p>
              </div>
            </div>

            {/* 按钮 */}
            <div className="flex justify-end mt-6">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={closeWarning}
                className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium"
              >
                我知道了
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default ArmWarningModal
