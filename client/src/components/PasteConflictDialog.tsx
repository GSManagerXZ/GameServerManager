import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X, Copy, FileEdit, SkipForward, FolderIcon, FileIcon } from 'lucide-react'

// 冲突文件信息
interface ConflictItem {
  fileName: string
  sourcePath: string
  exists: boolean
  sourceIsDir: boolean
  existingSize?: number
  existingModified?: string
}

interface PasteConflictDialogProps {
  visible: boolean
  conflicts: ConflictItem[]
  operation: 'copy' | 'cut' | null
  onReplace: () => void
  onRename: () => void
  onSkip: () => void
  onCancel: () => void
}

// 格式化文件大小
const formatSize = (size?: number): string => {
  if (size === undefined || size === null) return '未知'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// 格式化时间
const formatDate = (dateStr?: string): string => {
  if (!dateStr) return '未知'
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN')
  } catch {
    return '未知'
  }
}

const PasteConflictDialog: React.FC<PasteConflictDialogProps> = ({
  visible,
  conflicts,
  operation,
  onReplace,
  onRename,
  onSkip,
  onCancel
}) => {
  // 只显示有冲突的文件
  const conflictFiles = conflicts.filter(c => c.exists)
  const operationText = operation === 'copy' ? '复制' : '移动'

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
            className="glass rounded-lg p-6 w-full max-w-lg mx-4 border border-white/20 dark:border-gray-700/30"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题区域 */}
            <div className="flex items-start space-x-4 mb-4">
              <div className="p-2 rounded-lg bg-yellow-500/20 flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-yellow-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-black dark:text-white mb-1">
                  文件冲突
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  目标位置已存在 {conflictFiles.length} 个同名{conflictFiles.some(f => f.sourceIsDir) ? '项目' : '文件'}，请选择处理方式
                </p>
              </div>
              <button
                onClick={onCancel}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 冲突文件列表 */}
            <div className="max-h-48 overflow-y-auto mb-5 space-y-2">
              {conflictFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center space-x-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/50"
                >
                  {file.sourceIsDir ? (
                    <FolderIcon className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                  ) : (
                    <FileIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-black dark:text-white truncate">
                      {file.fileName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {file.existingSize !== undefined && `大小: ${formatSize(file.existingSize)}`}
                      {file.existingSize !== undefined && file.existingModified && ' · '}
                      {file.existingModified && `修改: ${formatDate(file.existingModified)}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* 操作按钮 */}
            <div className="space-y-2">
              {/* 替换按钮 */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onReplace}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors group"
              >
                <Copy className="w-4 h-4 text-red-500" />
                <div className="text-left flex-1">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">替换</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    用{operationText}的文件替换目标位置的同名文件
                  </p>
                </div>
              </motion.button>

              {/* 重命名按钮 */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onRename}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors group"
              >
                <FileEdit className="w-4 h-4 text-blue-500" />
                <div className="text-left flex-1">
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">保留两者（重命名）</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    自动为{operationText}的文件添加编号后缀
                  </p>
                </div>
              </motion.button>

              {/* 跳过按钮 */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onSkip}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/20 transition-colors group"
              >
                <SkipForward className="w-4 h-4 text-gray-500" />
                <div className="text-left flex-1">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">跳过</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    跳过已存在的文件，只{operationText}不冲突的文件
                  </p>
                </div>
              </motion.button>

              {/* 取消按钮 */}
              <div className="pt-1">
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={onCancel}
                  className="w-full px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors text-sm"
                >
                  取消
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default PasteConflictDialog
