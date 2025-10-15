import React from 'react'
import { Modal, Button } from 'antd'
import { ExclamationCircleOutlined, ReloadOutlined, CloseOutlined } from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'

interface FileChangedDialogProps {
  visible: boolean
  fileName: string
  onReload: () => void
  onKeep: () => void
}

export const FileChangedDialog: React.FC<FileChangedDialogProps> = ({
  visible,
  fileName,
  onReload,
  onKeep
}) => {
  return (
    <AnimatePresence>
      {visible && (
        <Modal
          title={
            <div className="flex items-center space-x-2">
              <ExclamationCircleOutlined className="text-orange-500 text-xl" />
              <span>文件已在外部修改</span>
            </div>
          }
          open={visible}
          onCancel={onKeep}
          footer={null}
          width={500}
          maskClosable={false}
          closable={false}
        >
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <div className="py-4 space-y-4">
              <p className="text-gray-700 dark:text-gray-300">
                文件 <span className="font-semibold text-blue-600 dark:text-blue-400">{fileName}</span> 已在其他地方被修改。
              </p>
              
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                您当前有未保存的修改，请选择：
              </p>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  ⚠️ 重新加载将会丢失您当前的修改！
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <Button
                  onClick={onKeep}
                  icon={<CloseOutlined />}
                  className="min-w-[120px]"
                >
                  保留我的修改
                </Button>
                
                <Button
                  type="primary"
                  danger
                  onClick={onReload}
                  icon={<ReloadOutlined />}
                  className="min-w-[120px]"
                >
                  重新加载文件
                </Button>
              </div>
            </div>
          </motion.div>
        </Modal>
      )}
    </AnimatePresence>
  )
}

