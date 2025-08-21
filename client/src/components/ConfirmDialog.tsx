import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmDialogProps {
  visible: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'warning' | 'danger' | 'info'
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  type = 'warning',
  onConfirm,
  onCancel
}) => {
  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          iconColor: 'text-red-500',
          confirmButton: 'bg-red-600 hover:bg-red-700',
          iconBg: 'bg-red-500/20'
        }
      case 'info':
        return {
          iconColor: 'text-blue-500',
          confirmButton: 'bg-blue-600 hover:bg-blue-700',
          iconBg: 'bg-blue-500/20'
        }
      default:
        return {
          iconColor: 'text-yellow-500',
          confirmButton: 'bg-yellow-600 hover:bg-yellow-700',
          iconBg: 'bg-yellow-500/20'
        }
    }
  }

  const styles = getTypeStyles()

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="glass rounded-lg p-6 w-full max-w-md mx-4 border border-white/20 dark:border-gray-700/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start space-x-4">
              <div className={`p-2 rounded-lg ${styles.iconBg} flex-shrink-0`}>
                <AlertTriangle className={`w-6 h-6 ${styles.iconColor}`} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-black dark:text-white mb-2">
                  {title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                  {message}
                </p>
              </div>
              <button
                onClick={onCancel}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex items-center justify-end space-x-3 mt-6">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onCancel}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {cancelText}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onConfirm}
                className={`px-4 py-2 text-white rounded-lg transition-colors ${styles.confirmButton}`}
              >
                {confirmText}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default ConfirmDialog