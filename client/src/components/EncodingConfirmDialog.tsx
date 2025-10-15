import React from 'react'
import { Modal, Button } from 'antd'
import { ExclamationCircleOutlined, WarningOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'

interface EncodingConfirmDialogProps {
  visible: boolean
  fileName: string
  detectedEncoding: string
  confidence: number
  onConfirm: () => void
  onCancel: () => void
  onEditDirectly?: () => void
}

export const EncodingConfirmDialog: React.FC<EncodingConfirmDialogProps> = ({
  visible,
  fileName,
  detectedEncoding,
  confidence,
  onConfirm,
  onCancel,
  onEditDirectly
}) => {
  return (
    <Modal
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={560}
      centered
      closeIcon={null}
      maskClosable={false}
      destroyOnClose
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            className="py-4"
          >
            {/* 标题区域 */}
            <div className="flex items-start mb-6">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                  <WarningOutlined className="text-2xl text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  检测到不兼容的文件编码
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  文件 <span className="font-medium text-gray-900 dark:text-white">"{fileName}"</span> 使用了不兼容的编码格式
                </p>
              </div>
            </div>

            {/* 编码信息 */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
              <div className="flex items-start">
                <InfoCircleOutlined className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="ml-3">
                  <p className="text-sm text-blue-900 dark:text-blue-100 mb-2">
                    <span className="font-semibold">检测到的编码：</span>
                    <span className="ml-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-800 rounded text-blue-800 dark:text-blue-200 font-mono text-xs">
                      {detectedEncoding.toUpperCase()}
                    </span>
                  </p>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <span className="font-semibold">检测置信度：</span>
                    <span className="ml-2">{Math.round(confidence * 100)}%</span>
                  </p>
                </div>
              </div>
            </div>

            {/* 警告信息 */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <ExclamationCircleOutlined className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="ml-3">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
                    该编码不在编辑器支持范围内
                  </p>
                  <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1.5 ml-4 list-disc">
                    <li>编辑器支持的编码：UTF-8, UTF-16 LE/BE, GBK, Big5, ANSI</li>
                    <li>可以转换为 UTF-8 编码后编辑，但可能造成服务端无法读取</li>
                    <li>某些特殊字符可能在转换过程中丢失或损坏</li>
                    <li><strong>建议：</strong>下载文件后在本地编辑器中修改再上传</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end space-x-3">
              <Button
                onClick={onCancel}
                className="min-w-[100px]"
              >
                取消
              </Button>
              <Button
                type="primary"
                onClick={onConfirm}
                className="min-w-[100px] bg-orange-500 hover:bg-orange-600 border-orange-500 hover:border-orange-600"
              >
                转换为 UTF-8
              </Button>
            </div>

            {/* 建议提示 */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-start">
                <InfoCircleOutlined className="mr-2 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="font-semibold">建议操作：</span>
                  将文件下载到本地，使用支持该编码的文本编辑器（如 Notepad++、VSCode）打开并修改，然后重新上传。
                </span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}

