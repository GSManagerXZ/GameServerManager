import React, { useState, useEffect } from 'react'
import { useNotificationStore } from '@/stores/notificationStore'
import {
  Clock,
  Plus,
  Edit,
  Trash2,
  Power,
  RotateCcw,
  Terminal,
  Calendar,
  Settings
} from 'lucide-react'
import apiClient from '@/utils/api'
import ConfirmDeleteTaskDialog from '@/components/ConfirmDeleteTaskDialog'

interface ScheduledTask {
  id: string
  name: string
  type: 'power' | 'command' | 'backup'
  instanceId?: string
  instanceName?: string
  action?: 'start' | 'stop' | 'restart'
  command?: string
  // 备份
  backupSourcePath?: string
  backupName?: string
  maxKeep?: number
  checkInstanceRunning?: boolean
  schedule: string
  enabled: boolean
  nextRun?: string
  lastRun?: string
  createdAt: string
  updatedAt: string
}

interface Instance {
  id: string
  name: string
  status: string
}

const ScheduledTasksPage: React.FC = () => {
  const { addNotification } = useNotificationStore()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [modalAnimating, setModalAnimating] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState<ScheduledTask | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    type: 'power' as 'power' | 'command' | 'backup',
    instanceId: '',
    action: 'start' as 'start' | 'stop' | 'restart',
    command: '',
    backupSourcePath: '',
    backupName: '',
    maxKeep: 0,
    checkInstanceRunning: false,
    schedule: '',
    enabled: true
  })

  useEffect(() => {
    fetchTasks()
    fetchInstances()
  }, [])

  const fetchTasks = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/scheduled-tasks')
      if (response.success) {
        setTasks(response.data || [])
      } else {
        throw new Error(response.message || '获取定时任务失败')
      }
    } catch (error: any) {
      console.error('获取定时任务失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: error.message || '无法获取定时任务列表'
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchInstances = async () => {
    try {
      const response = await apiClient.get('/instances')
      if (response.success) {
        setInstances(response.data || [])
      }
    } catch (error: any) {
      console.error('获取实例列表失败:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      addNotification({
        type: 'error',
        title: '验证失败',
        message: '请输入任务名称'
      })
      return
    }

    if (!formData.schedule.trim()) {
      addNotification({
        type: 'error',
        title: '验证失败',
        message: '请输入Cron表达式'
      })
      return
    }

    if (formData.type === 'power' && !formData.instanceId) {
      addNotification({
        type: 'error',
        title: '验证失败',
        message: '请选择实例'
      })
      return
    }

    if (formData.type === 'command' && (!formData.instanceId || !formData.command.trim())) {
      addNotification({
        type: 'error',
        title: '验证失败',
        message: '请选择实例并输入命令'
      })
      return
    }

    if (formData.type === 'backup') {
      if (!formData.backupSourcePath.trim()) {
        addNotification({
          type: 'error',
          title: '验证失败',
          message: '请输入需要备份文件夹的绝对路径'
        })
        return
      }
      if (!formData.backupName.trim()) {
        addNotification({
          type: 'error',
          title: '验证失败',
          message: '请输入备份名称'
        })
        return
      }
      if (formData.checkInstanceRunning && !formData.instanceId) {
        addNotification({
          type: 'error',
          title: '验证失败',
          message: '已勾选关联实例时必须选择实例'
        })
        return
      }
    }

    try {
      const taskData = {
        ...formData,
        instanceName: instances.find(i => i.id === formData.instanceId)?.name
      } as any

      // 按任务类型清理无关字段，避免后端校验失败
      if (taskData.type !== 'power') {
        delete taskData.action
      }
      if (taskData.type !== 'command') {
        delete taskData.command
      }
      if (taskData.type !== 'backup') {
        delete taskData.backupSourcePath
        delete taskData.backupName
        delete taskData.maxKeep
        delete taskData.checkInstanceRunning
      } else {
        if (!taskData.checkInstanceRunning) {
          // 未关联实例时不发送 instanceId
          delete taskData.instanceId
          delete taskData.instanceName
        }
      }

      if (editingTask) {
        const response = await apiClient.put(`/scheduled-tasks/${editingTask.id}`, taskData)
        if (response.success) {
          addNotification({
            type: 'success',
            title: '更新成功',
            message: '定时任务已更新'
          })
        } else {
          throw new Error(response.message || '更新定时任务失败')
        }
      } else {
        const response = await apiClient.post('/scheduled-tasks', taskData)
        if (response.success) {
          addNotification({
            type: 'success',
            title: '创建成功',
            message: '定时任务已创建'
          })
        } else {
          throw new Error(response.message || '创建定时任务失败')
        }
      }

      handleCloseModal()
      fetchTasks()
    } catch (error: any) {
      console.error('保存定时任务失败:', error)
      addNotification({
        type: 'error',
        title: '保存失败',
        message: error.message || '保存定时任务失败'
      })
    }
  }

  const handleEdit = (task: ScheduledTask) => {
    setEditingTask(task)
    setFormData({
      name: task.name,
      type: task.type,
      instanceId: task.instanceId || '',
      action: task.action || 'start',
      command: task.command || '',
      backupSourcePath: task.backupSourcePath || '',
      backupName: task.backupName || '',
      maxKeep: task.maxKeep ?? 0,
      checkInstanceRunning: task.checkInstanceRunning ?? false,
      schedule: task.schedule,
      enabled: task.enabled
    })
    setShowModal(true)
    setTimeout(() => setModalAnimating(true), 10)
  }

  const handleDelete = (task: ScheduledTask) => {
    setTaskToDelete(task)
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = async () => {
    if (!taskToDelete) return

    setShowDeleteDialog(false)
    
    try {
      const response = await apiClient.delete(`/scheduled-tasks/${taskToDelete.id}`)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '删除成功',
          message: '定时任务已删除'
        })
        fetchTasks()
      } else {
        throw new Error(response.message || '删除定时任务失败')
      }
    } catch (error: any) {
      console.error('删除定时任务失败:', error)
      addNotification({
        type: 'error',
        title: '删除失败',
        message: error.message || '删除定时任务失败'
      })
    } finally {
      setTaskToDelete(null)
    }
  }

  const handleCancelDelete = () => {
    setShowDeleteDialog(false)
    setTaskToDelete(null)
  }

  const handleToggleEnabled = async (taskId: string, enabled: boolean) => {
    try {
      const response = await apiClient.patch(`/scheduled-tasks/${taskId}/toggle`, { enabled })
      if (response.success) {
        addNotification({
          type: 'success',
          title: enabled ? '启用成功' : '禁用成功',
          message: `定时任务已${enabled ? '启用' : '禁用'}`
        })
        fetchTasks()
      } else {
        throw new Error(response.message || '切换状态失败')
      }
    } catch (error: any) {
      console.error('切换任务状态失败:', error)
      addNotification({
        type: 'error',
        title: '操作失败',
        message: error.message || '切换任务状态失败'
      })
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'power',
      instanceId: '',
      action: 'start',
      command: '',
      backupSourcePath: '',
      backupName: '',
      maxKeep: 0,
      checkInstanceRunning: false,
      schedule: '',
      enabled: true
    })
  }

  const handleCloseModal = () => {
    setModalAnimating(false)
    setTimeout(() => {
      setShowModal(false)
      setEditingTask(null)
      resetForm()
    }, 300)
  }

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'start':
        return <Power className="w-4 h-4 text-green-500" />
      case 'stop':
        return <Power className="w-4 h-4 text-red-500" />
      case 'restart':
        return <RotateCcw className="w-4 h-4 text-blue-500" />
      default:
        return <Terminal className="w-4 h-4 text-gray-500" />
    }
  }

  const getActionText = (action: string) => {
    switch (action) {
      case 'start':
        return '启动'
      case 'stop':
        return '停止'
      case 'restart':
        return '重启'
      default:
        return '未知'
    }
  }

  const formatNextRun = (nextRun: string) => {
    if (!nextRun) return '未计划'
    const date = new Date(nextRun)
    return date.toLocaleString('zh-CN')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Clock className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold text-black dark:text-white">定时任务</h1>
            <p className="text-gray-600 dark:text-gray-400">管理实例的定时开关机和命令执行</p>
          </div>
        </div>
        <button
          onClick={() => {
            setShowModal(true)
            setTimeout(() => setModalAnimating(true), 10)
          }}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>新建任务</span>
        </button>
      </div>

      {/* 任务列表 */}
      <div className="glass rounded-lg border border-white/20 dark:border-gray-700/30">
        <div className="p-6">
          {tasks.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-black dark:text-white mb-2">暂无定时任务</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">创建您的第一个定时任务</p>
              <button
                onClick={() => {
                  setShowModal(true)
                  setTimeout(() => setModalAnimating(true), 10)
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                新建任务
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-4 bg-white/5 dark:bg-gray-800/50 rounded-lg border border-white/10 dark:border-gray-700/50"
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      {task.type === 'power' ? (
                        getActionIcon(task.action || '')
                      ) : (
                        <Terminal className="w-4 h-4 text-purple-500" />
                      )}
                      <span className="font-medium text-black dark:text-white">{task.name}</span>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {task.type === 'power' ? (
                        <span>{getActionText(task.action || '')} - {task.instanceName}</span>
                      ) : (
                        <span>命令执行 - {task.instanceName}</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-500">
                      <span>下次执行: {formatNextRun(task.nextRun || '')}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={task.enabled}
                        onChange={(e) => handleToggleEnabled(task.id, e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-400">启用</span>
                    </label>
                    <button
                      onClick={() => handleEdit(task)}
                      className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(task)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 新建/编辑任务模态框 */}
      {showModal && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 transition-opacity duration-300 ${
          modalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`w-full max-w-md glass rounded-lg border border-white/20 dark:border-gray-700/30 transform transition-all duration-300 ${
            modalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="p-6">
              <h2 className="text-xl font-bold text-black dark:text-white mb-4">
                {editingTask ? '编辑任务' : '新建任务'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-1">
                    任务名称
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="输入任务名称"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-1">
                    任务类型
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'power' | 'command' | 'backup' })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="power">电源管理</option>
                    <option value="command">命令执行</option>
                    <option value="backup">文件夹备份</option>
                  </select>
                </div>

                {(formData.type === 'power' || formData.type === 'command' || formData.checkInstanceRunning) && (
                  <div>
                    <label className="block text-sm font-medium text-black dark:text-white mb-1">
                      目标实例
                    </label>
                    <select
                      value={formData.instanceId}
                      onChange={(e) => setFormData({ ...formData, instanceId: e.target.value })}
                      disabled={formData.type === 'backup' && !formData.checkInstanceRunning}
                      className={`w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${formData.type === 'backup' && !formData.checkInstanceRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <option value="">选择实例</option>
                      {instances.map((instance) => (
                        <option key={instance.id} value={instance.id}>
                          {instance.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {formData.type === 'power' && (
                  <div>
                    <label className="block text-sm font-medium text-black dark:text-white mb-1">
                      操作类型
                    </label>
                    <select
                      value={formData.action}
                      onChange={(e) => setFormData({ ...formData, action: e.target.value as 'start' | 'stop' | 'restart' })}
                      className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="start">启动</option>
                      <option value="stop">停止</option>
                      <option value="restart">重启</option>
                    </select>
                  </div>
                )}

                {formData.type === 'command' && (
                  <div>
                    <label className="block text-sm font-medium text-black dark:text-white mb-1">
                      执行命令
                    </label>
                    <input
                      type="text"
                      value={formData.command}
                      onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                      className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="输入要执行的命令"
                    />
                  </div>
                )}

                {formData.type === 'backup' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-black dark:text-white mb-1">
                        需要备份文件夹的绝对路径
                      </label>
                      <input
                        type="text"
                        value={formData.backupSourcePath}
                        onChange={(e) => setFormData({ ...formData, backupSourcePath: e.target.value })}
                        className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="/absolute/path/to/folder"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-black dark:text-white mb-1">
                        备份名称
                      </label>
                      <input
                        type="text"
                        value={formData.backupName}
                        onChange={(e) => setFormData({ ...formData, backupName: e.target.value })}
                        className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="例如：人渣、幻兽帕鲁实例备份"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-black dark:text-white mb-1">
                        最大保存数目
                      </label>
                      <input
                        type="number"
                        value={formData.maxKeep}
                        onChange={(e) => setFormData({ ...formData, maxKeep: Number(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        min={0}
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="checkInstanceRunning"
                        checked={formData.checkInstanceRunning}
                        onChange={(e) => setFormData({ ...formData, checkInstanceRunning: e.target.checked })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <label htmlFor="checkInstanceRunning" className="text-sm text-black dark:text-white">
                        关联实例（仅当实例运行时执行备份）
                      </label>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-1">
                    Cron表达式
                  </label>
                  <input
                    type="text"
                    value={formData.schedule}
                    onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700/50 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例如: 0 0 * * * (每天午夜)"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    格式: 秒 分 时 日 月 周 (例如: 0 0 8 * * * 表示每天8点)
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="enabled" className="text-sm text-black dark:text-white">
                    启用任务
                  </label>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    {editingTask ? '更新' : '创建'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      <ConfirmDeleteTaskDialog
        isOpen={showDeleteDialog}
        taskName={taskToDelete?.name || ''}
        taskType={taskToDelete?.type || 'power'}
        instanceName={taskToDelete?.instanceName}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  )
}

export default ScheduledTasksPage