import React, { useEffect, useState } from 'react'
import { AlertTriangle, FolderSync, RotateCcw, Server, Plus, X } from 'lucide-react'
import type { InstanceType } from '@/types'

interface MatchingInstance {
  id: string
  name: string
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'error'
  workingDirectory: string
  instanceType: InstanceType
}

interface FileDeploymentConflictDialogProps {
  isOpen: boolean
  targetPath: string
  directoryExists: boolean
  matchingInstances: MatchingInstance[]
  onClose: () => void
  onConfirm: (options: {
    directoryStrategy: 'merge' | 'clean'
    instanceStrategy: 'create' | 'update'
    existingInstanceId?: string
  }) => void
}

const FileDeploymentConflictDialog: React.FC<FileDeploymentConflictDialogProps> = ({
  isOpen,
  targetPath,
  directoryExists,
  matchingInstances,
  onClose,
  onConfirm
}) => {
  const [isAnimating, setIsAnimating] = useState(false)
  const [directoryStrategy, setDirectoryStrategy] = useState<'merge' | 'clean' | ''>('')
  const [instanceStrategy, setInstanceStrategy] = useState<'create' | 'update' | ''>('')
  const [existingInstanceId, setExistingInstanceId] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setIsAnimating(false)
      return
    }
    setDirectoryStrategy(directoryExists ? '' : 'merge')
    setInstanceStrategy(matchingInstances.length > 0 ? '' : 'create')
    setExistingInstanceId('')
    requestAnimationFrame(() => requestAnimationFrame(() => setIsAnimating(true)))
  }, [isOpen, directoryExists, matchingInstances])

  if (!isOpen) return null

  const closeWithAnimation = () => {
    setIsAnimating(false)
    setTimeout(onClose, 300)
  }

  const canConfirm = Boolean(directoryStrategy && instanceStrategy && (
    instanceStrategy !== 'update' || existingInstanceId
  ))

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 transition-opacity duration-300 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
      <div className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-gray-800 shadow-xl transition-all duration-300 ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
        <div className="flex items-start justify-between border-b border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">检测到部署冲突</h2>
              <p className="mt-1 break-all text-sm text-gray-500 dark:text-gray-400">{targetPath}</p>
            </div>
          </div>
          <button onClick={closeWithAnimation} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-white" title="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {directoryExists && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">目标目录已存在</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  onClick={() => setDirectoryStrategy('merge')}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${directoryStrategy === 'merge' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-600'}`}
                >
                  <FolderSync className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">合并覆盖</span>
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">覆盖同名文件，保留压缩包中没有的旧文件。</span>
                  </span>
                </button>
                <button
                  onClick={() => setDirectoryStrategy('clean')}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${directoryStrategy === 'clean' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 hover:border-red-300 dark:border-gray-700 dark:hover:border-red-600'}`}
                >
                  <RotateCcw className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">删除后重装</span>
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">完成解压校验后删除旧目录，再放入新文件。</span>
                  </span>
                </button>
              </div>
            </section>
          )}

          {matchingInstances.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">已存在同名实例</h3>
              <div className="space-y-3">
                {matchingInstances.map(instance => {
                  const isRunning = instance.status === 'running' || instance.status === 'starting' || instance.status === 'stopping'
                  return (
                    <button
                      key={instance.id}
                      disabled={isRunning}
                      onClick={() => {
                        setInstanceStrategy('update')
                        setExistingInstanceId(instance.id)
                      }}
                      className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${instanceStrategy === 'update' && existingInstanceId === instance.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-600'}`}
                    >
                      <Server className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{instance.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{isRunning ? '请先停止' : '更新此实例'}</span>
                        </span>
                        <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">{instance.workingDirectory}</span>
                      </span>
                    </button>
                  )
                })}
                <button
                  onClick={() => {
                    setInstanceStrategy('create')
                    setExistingInstanceId('')
                  }}
                  className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${instanceStrategy === 'create' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 hover:border-green-300 dark:border-gray-700 dark:hover:border-green-600'}`}
                >
                  <Plus className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">仍然新建实例</span>
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">保留已有实例，再创建一个同名实例。</span>
                  </span>
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 dark:border-gray-700 p-5">
          <button onClick={closeWithAnimation} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">取消</button>
          <button
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm({
              directoryStrategy: directoryStrategy as 'merge' | 'clean',
              instanceStrategy: instanceStrategy as 'create' | 'update',
              existingInstanceId: existingInstanceId || undefined
            })}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            继续部署
          </button>
        </div>
      </div>
    </div>
  )
}

export default FileDeploymentConflictDialog
