import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ApiClient } from '@/utils/api'
import { useNotificationStore } from '@/stores/notificationStore'
import { useAuthStore } from '@/stores/authStore'
import ConfirmDialog from '@/components/ConfirmDialog'
import {
  Plus,
  Settings,
  Trash2,
  Power,
  PowerOff,
  ExternalLink,
  Edit,
  Save,
  X,
  Puzzle,
  User,
  Calendar,
  Tag,
  FileText,
  Globe
} from 'lucide-react'

interface Plugin {
  name: string
  displayName: string
  description: string
  version: string
  author: string
  enabled: boolean
  hasWebInterface: boolean
  entryPoint?: string
  icon?: string
  category?: string
}

interface CreatePluginForm {
  name: string
  displayName: string
  description: string
  version: string
  author: string
  category: string
  icon: string
}

const PluginsPage: React.FC = () => {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingPlugin, setEditingPlugin] = useState<Plugin | null>(null)
  const [showPluginModal, setShowPluginModal] = useState(false)
  const [currentPluginUrl, setCurrentPluginUrl] = useState<string>('')
  const [currentPluginChannel, setCurrentPluginChannel] = useState<string>('')
  const [currentPluginName, setCurrentPluginName] = useState<string>('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pluginToDelete, setPluginToDelete] = useState<Plugin | null>(null)
  const [createForm, setCreateForm] = useState<CreatePluginForm>({
    name: '',
    displayName: '',
    description: '',
    version: '1.0.0',
    author: '',
    category: '其他',
    icon: 'puzzle'
  })
  const { addNotification } = useNotificationStore()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const apiClient = useRef(new ApiClient()).current
  const pluginFrameRef = useRef<HTMLIFrameElement>(null)

  const closePluginModal = () => {
    setShowPluginModal(false)
    setCurrentPluginUrl('')
    setCurrentPluginChannel('')
    setCurrentPluginName('')
  }

  // 监听来自插件的消息
  useEffect(() => {
    const showPluginNotification = (data: unknown) => {
      const notification = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      const type = ['info', 'success', 'warning', 'error'].includes(String(notification.type))
        ? String(notification.type)
        : 'info'
      const message = String(notification.message || '').slice(0, 500)
      if (!message) return
      addNotification({
        type: type as 'info' | 'success' | 'warning' | 'error',
        title: '插件消息',
        message
      })
    }

    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== pluginFrameRef.current?.contentWindow ||
        !event.data ||
        typeof event.data !== 'object'
      ) {
        return
      }

      if (event.data.channel !== currentPluginChannel) return

      if (event.data.type === 'gsm3-close-plugin') {
        setShowPluginModal(false)
        setCurrentPluginUrl('')
        setCurrentPluginChannel('')
        setCurrentPluginName('')
      } else if (event.data.type === 'gsm3-auth-request') {
        if (!isAdmin) return
        const token = apiClient.getToken()
        if (!token || typeof event.data.requestId !== 'string') return
        ;(event.source as Window).postMessage({
          type: 'gsm3-auth-response',
          channel: currentPluginChannel,
          requestId: event.data.requestId,
          token
        }, window.location.origin)
      } else if (event.data.type === 'gsm3-notification') {
        showPluginNotification(event.data.data)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [addNotification, apiClient, currentPluginChannel, isAdmin])

  useEffect(() => {
    if (!showPluginModal) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setShowPluginModal(false)
      setCurrentPluginUrl('')
      setCurrentPluginChannel('')
      setCurrentPluginName('')
    }
    document.addEventListener('keydown', handleKeyDown)
    window.requestAnimationFrame(() => pluginFrameRef.current?.focus())
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [showPluginModal])

  const categories = [
    '工具',
    '游戏',
    '监控',
    '管理',
    '娱乐',
    '开发',
    '系统',
    '其他'
  ]

  const icons = [
    'puzzle',
    'settings',
    'gamepad-2',
    'monitor',
    'shield',
    'music',
    'code',
    'server',
    'globe',
    'tool',
    'heart',
    'star'
  ]

  useEffect(() => {
    loadPlugins()
  }, [])

  const loadPlugins = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/plugins/list')
      if (response.success) {
        setPlugins(response.data)
      } else {
        addNotification({ type: 'error', title: '错误', message: '获取插件列表失败' })
      }
    } catch (error) {
      console.error('获取插件列表失败:', error)
      addNotification({ type: 'error', title: '错误', message: '获取插件列表失败' })
    } finally {
      setLoading(false)
    }
  }

  const handleCreatePlugin = async () => {
    try {
      if (!createForm.name.trim()) {
        addNotification({ type: 'error', title: '错误', message: '插件名称不能为空' })
        return
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(createForm.name)) {
        addNotification({ type: 'error', title: '错误', message: '插件名称只能包含字母、数字、下划线和连字符' })
        return
      }

      const response = await apiClient.post('/plugins/create', createForm)
      if (response.success) {
        addNotification({ type: 'success', title: '成功', message: '插件创建成功' })
        setShowCreateModal(false)
        setCreateForm({
          name: '',
          displayName: '',
          description: '',
          version: '1.0.0',
          author: '',
          category: '其他',
          icon: 'puzzle'
        })
        loadPlugins()
      } else {
        addNotification({ type: 'error', title: '错误', message: response.message || '创建插件失败' })
      }
    } catch (error) {
      console.error('创建插件失败:', error)
      addNotification({ type: 'error', title: '错误', message: '创建插件失败' })
    }
  }

  const handleTogglePlugin = async (plugin: Plugin) => {
    try {
      const endpoint = plugin.enabled ? 'disable' : 'enable'
      const response = await apiClient.post(`/plugins/${plugin.name}/${endpoint}`)
      if (response.success) {
        addNotification({ type: 'success', title: '成功', message: `插件已${plugin.enabled ? '禁用' : '启用'}` })
        loadPlugins()
      } else {
        addNotification({ type: 'error', title: '错误', message: response.message || `${plugin.enabled ? '禁用' : '启用'}插件失败` })
      }
    } catch (error) {
      console.error('切换插件状态失败:', error)
      addNotification({ type: 'error', title: '错误', message: '操作失败' })
    }
  }

  const handleDeletePlugin = (plugin: Plugin) => {
    setPluginToDelete(plugin)
    setShowDeleteConfirm(true)
  }

  const confirmDeletePlugin = async () => {
    if (!pluginToDelete) return

    try {
      const response = await apiClient.delete(`/plugins/${pluginToDelete.name}`)
      if (response.success) {
        addNotification({ type: 'success', title: '成功', message: '插件删除成功' })
        loadPlugins()
      } else {
        addNotification({ type: 'error', title: '错误', message: response.message || '删除插件失败' })
      }
    } catch (error) {
      console.error('删除插件失败:', error)
      addNotification({ type: 'error', title: '错误', message: '删除插件失败' })
    } finally {
      setShowDeleteConfirm(false)
      setPluginToDelete(null)
    }
  }

  const handleOpenPlugin = (plugin: Plugin) => {
    if (!plugin.hasWebInterface || !plugin.enabled) return
    if (!isAdmin) {
      addNotification({ type: 'warning', title: '权限不足', message: '插件管理功能仅允许管理员使用' })
      return
    }
    const entryPoint = plugin.entryPoint || 'index.html'
    const pathSegments = entryPoint.split('/').filter(Boolean)
    if (
      pathSegments.length === 0 ||
      pathSegments.some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))
    ) {
      addNotification({ type: 'error', title: '错误', message: '插件入口路径无效' })
      return
    }

    const channel = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const encodedEntryPoint = pathSegments.map(segment => encodeURIComponent(segment)).join('/')
    const pluginUrl = `/api/plugins/${encodeURIComponent(plugin.name)}/files/${encodedEntryPoint}?channel=${encodeURIComponent(channel)}`
    setCurrentPluginChannel(channel)
    setCurrentPluginUrl(pluginUrl)
    setCurrentPluginName(plugin.displayName || plugin.name)
    setShowPluginModal(true)
    addNotification({
      type: 'success',
      title: '成功',
      message: `插件 ${plugin.displayName || plugin.name} 已打开`
    })
  }

  const getIconComponent = (iconName: string) => {
    const iconMap: { [key: string]: React.ComponentType<any> } = {
      puzzle: Puzzle,
      settings: Settings,
      'gamepad-2': Settings, // 使用Settings作为替代
      monitor: Settings,
      shield: Settings,
      music: Settings,
      code: Settings,
      server: Settings,
      globe: Globe,
      tool: Settings,
      heart: Settings,
      star: Settings
    }
    const IconComponent = iconMap[iconName] || Puzzle
    return <IconComponent className="w-6 h-6" />
  }

  const getCategoryColor = (category: string) => {
    const colorMap: { [key: string]: string } = {
      '工具': 'bg-blue-500',
      '游戏': 'bg-green-500',
      '监控': 'bg-yellow-500',
      '管理': 'bg-purple-500',
      '娱乐': 'bg-pink-500',
      '开发': 'bg-indigo-500',
      '系统': 'bg-red-500',
      '其他': 'bg-gray-500'
    }
    return colorMap[category] || 'bg-gray-500'
  }

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center h-64"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="rounded-full h-12 w-12 border-b-2 border-blue-500"
        />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="ml-4 text-gray-600 dark:text-gray-400"
        >
          加载插件中...
        </motion.p>
      </motion.div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题和操作 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between"
      >
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-2xl font-bold text-black dark:text-white"
          >
            插件管理
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-gray-600 dark:text-gray-400 mt-1"
          >
            管理和配置系统插件，扩展面板功能
          </motion.p>
        </div>
        <motion.button
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>创建插件</span>
        </motion.button>
      </motion.div>

      {/* 插件列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {plugins.map((plugin, index) => (
            <motion.div
              key={plugin.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="glass rounded-lg p-6 border border-white/20 dark:border-gray-700/30 hover:shadow-lg transition-all duration-300"
            >
            {/* 插件头部 */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  {getIconComponent(plugin.icon || 'puzzle')}
                </div>
                <div>
                  <h3 className="font-semibold text-black dark:text-white">
                    {plugin.displayName}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`px-2 py-1 text-xs text-white rounded-full ${getCategoryColor(plugin.category || '其他')}`}>
                      {plugin.category || '其他'}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      v{plugin.version}
                    </span>
                  </div>
                </div>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                plugin.enabled
                  ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                  : 'bg-gray-500/20 text-gray-600 dark:text-gray-300'
              }`}>
                {plugin.enabled ? '已启用' : '已禁用'}
              </span>
            </div>

            {/* 插件信息 */}
            <div className="space-y-2 mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {plugin.description}
              </p>
              <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center space-x-1">
                  <User className="w-3 h-3" />
                  <span>{plugin.author}</span>
                </div>
                {plugin.hasWebInterface && (
                  <div className="flex items-center space-x-1">
                    <Globe className="w-3 h-3" />
                    <span>Web界面</span>
                  </div>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center justify-between pt-4 border-t border-white/10 dark:border-gray-700/30">
              <div className="flex items-center space-x-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleTogglePlugin(plugin)}
                  className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    plugin.enabled
                      ? 'bg-green-500/20 text-green-600 hover:bg-green-500/30'
                      : 'bg-gray-500/20 text-gray-600 hover:bg-gray-500/30'
                  }`}
                  title={plugin.enabled ? '禁用插件' : '启用插件'}
                >
                  {plugin.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                  <span>{plugin.enabled ? '禁用' : '启用'}</span>
                </motion.button>
                {plugin.hasWebInterface && (
                  <motion.button
                  whileHover={{ scale: plugin.enabled && isAdmin ? 1.02 : 1 }}
                  whileTap={{ scale: plugin.enabled && isAdmin ? 0.98 : 1 }}
                    onClick={() => handleOpenPlugin(plugin)}
                  disabled={!plugin.enabled || !isAdmin}
                    className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    plugin.enabled && isAdmin
                        ? 'bg-blue-500/20 text-blue-600 hover:bg-blue-500/30'
                        : 'bg-gray-500/10 text-gray-400 cursor-not-allowed'
                    }`}
                  title={!isAdmin ? '仅管理员可打开插件' : plugin.enabled ? '打开插件' : '启用后可打开插件'}
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>打开</span>
                  </motion.button>
                )}
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleDeletePlugin(plugin)}
                className="p-2 bg-red-500/20 text-red-600 rounded-lg hover:bg-red-500/30 transition-colors"
                title="删除插件"
                aria-label={`删除插件 ${plugin.displayName}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </motion.button>
            </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {plugins.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center py-12"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Puzzle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          </motion.div>
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2"
          >
            暂无插件
          </motion.h3>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="text-gray-500 dark:text-gray-500 mb-4"
          >
            创建您的第一个插件来扩展面板功能
          </motion.p>
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            创建插件
          </motion.button>
        </motion.div>
      )}

      {/* 插件展示模态框 */}
      <AnimatePresence>
        {showPluginModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm sm:p-4 lg:left-[var(--gsm-sidebar-offset,16rem)]"
            onClick={closePluginModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="glass flex h-[calc(100vh-1rem)] w-full max-w-[1600px] flex-col overflow-hidden rounded-lg border border-white/20 dark:border-gray-700/30 sm:h-[92vh]"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="plugin-modal-title"
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 p-3 dark:border-gray-700/30 sm:p-4">
                <h2 id="plugin-modal-title" className="min-w-0 truncate text-lg font-bold text-black dark:text-white sm:text-xl">{currentPluginName}</h2>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={closePluginModal}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-white/10 dark:hover:text-gray-300"
                  aria-label="关闭插件窗口"
                >
                  <X className="w-6 h-6" aria-hidden="true" />
                </motion.button>
              </div>
              <div className="min-h-0 flex-1 p-2 sm:p-4">
                <motion.iframe
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.2 }}
                  ref={pluginFrameRef}
                  src={currentPluginUrl}
                  className="h-full w-full rounded-md border-0 bg-white dark:bg-gray-900 sm:rounded-lg"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  allow="clipboard-write"
                  referrerPolicy="same-origin"
                  title={currentPluginName}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 创建插件模态框 */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm sm:p-4 lg:left-[var(--gsm-sidebar-offset,16rem)]"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="glass rounded-lg p-6 w-full max-w-md mx-4 border border-white/20 dark:border-gray-700/30"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-plugin-modal-title"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 id="create-plugin-modal-title" className="text-xl font-bold text-black dark:text-white">创建新插件</h2>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="关闭创建插件窗口"
                >
                  <X className="w-6 h-6" aria-hidden="true" />
                </motion.button>
              </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="plugin-name" className="block text-sm font-medium text-black dark:text-white mb-2">
                  插件名称 *
                </label>
                <input
                  id="plugin-name"
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如: my-plugin"
                />
                <p className="text-xs text-gray-500 mt-1">只能包含字母、数字、下划线和连字符</p>
              </div>

              <div>
                <label htmlFor="plugin-display-name" className="block text-sm font-medium text-black dark:text-white mb-2">
                  显示名称
                </label>
                <input
                  id="plugin-display-name"
                  type="text"
                  value={createForm.displayName}
                  onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如: 我的插件"
                />
              </div>

              <div>
                <label htmlFor="plugin-description" className="block text-sm font-medium text-black dark:text-white mb-2">
                  描述
                </label>
                <textarea
                  id="plugin-description"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  placeholder="插件功能描述"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="plugin-version" className="block text-sm font-medium text-black dark:text-white mb-2">
                    版本
                  </label>
                  <input
                    id="plugin-version"
                    type="text"
                    value={createForm.version}
                    onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="plugin-author" className="block text-sm font-medium text-black dark:text-white mb-2">
                    作者
                  </label>
                  <input
                    id="plugin-author"
                    type="text"
                    value={createForm.author}
                    onChange={(e) => setCreateForm({ ...createForm, author: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="作者名称"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="plugin-category" className="block text-sm font-medium text-black dark:text-white mb-2">
                    分类
                  </label>
                  <select
                    id="plugin-category"
                    value={createForm.category}
                    onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {categories.map((category) => (
                      <option key={category} value={category} className="bg-white dark:bg-gray-800">
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="plugin-icon" className="block text-sm font-medium text-black dark:text-white mb-2">
                    图标
                  </label>
                  <select
                    id="plugin-icon"
                    value={createForm.icon}
                    onChange={(e) => setCreateForm({ ...createForm, icon: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {icons.map((icon) => (
                      <option key={icon} value={icon} className="bg-white dark:bg-gray-800">
                        {icon}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

              <div className="flex items-center justify-end space-x-3 mt-6">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  取消
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCreatePlugin}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  创建
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        visible={showDeleteConfirm}
        title="删除插件"
        message={`确定要删除插件 "${pluginToDelete?.displayName || pluginToDelete?.name}" 吗？此操作不可撤销。`}
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={confirmDeletePlugin}
        onCancel={() => {
          setShowDeleteConfirm(false)
          setPluginToDelete(null)
        }}
      />
    </div>
  )
}

export default PluginsPage
