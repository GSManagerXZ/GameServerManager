import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ExternalLink } from 'lucide-react'

interface CloudProvider {
  name: string
  logoUrl: string
  purchaseUrl: string
}

interface CloudProviderModalProps {
  visible: boolean
  gameName: string
  providers: CloudProvider[]
  onClose: () => void
}

const CloudProviderModal: React.FC<CloudProviderModalProps> = ({
  visible,
  gameName,
  providers,
  onClose
}) => {
  const handleProviderClick = (provider: CloudProvider) => {
    // 在新窗口中打开购买链接
    window.open(provider.purchaseUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="glass rounded-lg p-6 w-full max-w-2xl mx-4 border border-white/20 dark:border-gray-700/30"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-black dark:text-white">
                  购买已预装服务器
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {gameName}
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 说明文字 */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                以下服务商将GSManager面板和游戏进行了预装，您购买后即可立即开服，免去安装过程，具体可向服务商负责人了解详情
              </p>
            </div>

            {/* 服务商列表 */}
            <div className="space-y-3">
              {providers.map((provider, index) => (
                <motion.div
                  key={provider.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 transition-colors cursor-pointer group"
                  onClick={() => handleProviderClick(provider)}
                >
                  <div className="flex items-center space-x-4">
                    {/* 服务商Logo */}
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center overflow-hidden">
                      <img
                        src={provider.logoUrl}
                        alt={provider.name}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                          target.parentElement!.innerHTML = `<div class="text-gray-500 text-xs">${provider.name}</div>`
                        }}
                      />
                    </div>
                    
                    {/* 服务商名称 */}
                    <div>
                      <h4 className="font-medium text-gray-900 dark:text-white">
                        {provider.name}
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        点击前往购买页面
                      </p>
                    </div>
                  </div>

                  {/* 外部链接图标 */}
                  <div className="text-gray-400 group-hover:text-blue-500 transition-colors">
                    <ExternalLink className="w-5 h-5" />
                  </div>
                </motion.div>
              ))}
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-end mt-6">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="px-6 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                关闭
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default CloudProviderModal
