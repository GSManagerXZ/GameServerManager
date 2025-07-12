import React, { useState, useEffect } from 'react'
import { ApiClient } from '@/utils/api'
import { useNotificationStore } from '@/stores/notificationStore'
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
  const [currentPluginContent, setCurrentPluginContent] = useState<string>('')
  const [currentPluginName, setCurrentPluginName] = useState<string>('')
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
  const apiClient = new ApiClient()

  // 监听来自插件的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'gsm3-notification') {
        const { type, message } = event.data.data
        addNotification({
          type: type as 'info' | 'success' | 'warning' | 'error',
          title: '插件消息',
          message
        })
      } else if (event.data && event.data.type === 'gsm3-plugin-loaded') {
        console.log('插件加载完成:', event.data.data)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [addNotification])

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

  const handleDeletePlugin = async (plugin: Plugin) => {
    if (!confirm(`确定要删除插件 "${plugin.displayName}" 吗？此操作不可撤销。`)) {
      return
    }

    try {
      const response = await apiClient.delete(`/plugins/${plugin.name}`)
      if (response.success) {
        addNotification({ type: 'success', title: '成功', message: '插件删除成功' })
        loadPlugins()
      } else {
        addNotification({ type: 'error', title: '错误', message: response.message || '删除插件失败' })
      }
    } catch (error) {
      console.error('删除插件失败:', error)
      addNotification({ type: 'error', title: '错误', message: '删除插件失败' })
    }
  }

  const handleOpenPlugin = async (plugin: Plugin) => {
    if (plugin.hasWebInterface && plugin.enabled) {
      // 发送正在打开插件的通知
      addNotification({
        type: 'info',
        title: '提示',
        message: `正在打开插件 ${plugin.displayName || plugin.name}...`
      })
      
      try {
        // 通过API获取插件文件内容
        const response = await apiClient.get(`/plugins/${plugin.name}/files/${plugin.entryPoint || 'index.html'}`)
        
        // 检查响应数据格式
        if (response.data) {
          let content = ''
          
          // 如果是JSON格式的响应（HTML、CSS、JS文件）
          if (typeof response.data === 'object' && response.data.success && response.data.data) {
            content = response.data.data
          } 
          // 如果直接返回HTML内容（兼容性处理）
          else if (typeof response.data === 'string' && response.data.trim()) {
            content = response.data
          }
          // 如果是JSON格式但失败
          else if (typeof response.data === 'object' && !response.data.success) {
            addNotification({ 
              type: 'error', 
              title: '错误', 
              message: response.data.message || '获取插件文件失败' 
            })
            return
          }
          
          if (content && content.trim()) {
            // 修复gsm3-api.js的引用路径并注入token
            const token = apiClient.getToken()
            let injectedContent = content
            
            // 替换相对路径的gsm3-api.js引用为正确的API路径
            injectedContent = injectedContent.replace(
              /src="gsm3-api\.js"/g,
              `src="/api/plugins/${plugin.name}/files/gsm3-api.js"`
            )
            
            // 确保gsm3-api.js脚本标签有正确的type属性
            injectedContent = injectedContent.replace(
              /<script src="\/api\/plugins\/${plugin.name}\/files\/gsm3-api\.js"><\/script>/g,
              `<script type="text/javascript" src="/api/plugins/${plugin.name}/files/gsm3-api.js"></script>`
            )
            
            // 注入token设置脚本
            injectedContent = injectedContent.replace(
              '</head>',
              `<script>
                // 设置全局token变量
                window.gsm3Token = '${token}';
                console.log('全局token已设置:', '${token}');
              </script>
              </head>`
            )
            
            // 在body结束前注入token设置脚本，确保在gsm3-api.js完全初始化后执行
            injectedContent = injectedContent.replace(
              '</body>',
              `<script>
                // 等待gsm3-api.js完全加载并初始化
                (function() {
                  const waitForGsm3AndSetToken = () => {
                    // 检查window.gsm3对象是否存在且具有initialize方法
                    if (window.gsm3 && typeof window.gsm3.initialize === 'function') {
                      console.log('GSM3 API对象已找到，设置token...');
                      window.gsm3.token = '${token}';
                      console.log('GSM3 API Token已设置:', '${token}');
                      
                      // 如果API还未初始化，触发初始化
                      if (!window.gsm3.isInitialized) {
                        window.gsm3.initialize().then(() => {
                          console.log('GSM3 API初始化完成');
                        }).catch(error => {
                          console.error('GSM3 API初始化失败:', error);
                        });
                      }
                      return true;
                    }
                    return false;
                  };
                  
                  // 监听DOMContentLoaded事件，确保在gsm3-api.js的DOMContentLoaded之后执行
                  if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                      // 延迟一点时间，确保gsm3-api.js的DOMContentLoaded先执行
                      setTimeout(() => {
                        if (!waitForGsm3AndSetToken()) {
                          // 如果仍然失败，继续重试
                          let attempts = 0;
                          const checkGsm3 = () => {
                            attempts++;
                            if (waitForGsm3AndSetToken()) {
                              console.log('Token设置成功，尝试次数:', attempts);
                            } else if (attempts < 30) {
                              setTimeout(checkGsm3, 200);
                            } else {
                              console.error('Token设置失败：超时等待gsm3对象创建');
                              console.log('当前window对象包含的gsm3相关属性:', Object.keys(window).filter(key => key.includes('gsm3')));
                            }
                          };
                          setTimeout(checkGsm3, 200);
                        }
                      }, 100);
                    });
                  } else {
                    // 如果DOM已经加载完成，立即尝试
                    setTimeout(() => {
                      if (!waitForGsm3AndSetToken()) {
                        let attempts = 0;
                        const checkGsm3 = () => {
                          attempts++;
                          if (waitForGsm3AndSetToken()) {
                            console.log('Token设置成功，尝试次数:', attempts);
                          } else if (attempts < 30) {
                            setTimeout(checkGsm3, 200);
                          } else {
                            console.error('Token设置失败：超时等待gsm3对象创建');
                            console.log('当前window对象包含的gsm3相关属性:', Object.keys(window).filter(key => key.includes('gsm3')));
                          }
                        };
                        setTimeout(checkGsm3, 200);
                      }
                    }, 100);
                  }
                })();
              </script>
              </body>`
            )
            
            setCurrentPluginContent(injectedContent)
            setCurrentPluginName(plugin.displayName || plugin.name)
            setShowPluginModal(true)
            
            // 发送插件打开成功的通知
            addNotification({
              type: 'success',
              title: '成功',
              message: `插件 ${plugin.displayName || plugin.name} 已打开`
            })
          } else {
            addNotification({ type: 'error', title: '错误', message: '插件内容为空' })
          }
        } else {
          addNotification({ type: 'error', title: '错误', message: '无法获取插件内容' })
        }
      } catch (error) {
        console.error('打开插件失败:', error)
        addNotification({ 
          type: 'error', 
          title: '错误', 
          message: error instanceof Error ? error.message : '打开插件失败' 
        })
      }
    }
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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black dark:text-white">插件管理</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            管理和配置系统插件，扩展面板功能
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>创建插件</span>
        </button>
      </div>

      {/* 插件列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {plugins.map((plugin) => (
          <div
            key={plugin.name}
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
              <div className="flex items-center space-x-1">
                {plugin.enabled ? (
                  <div className="w-2 h-2 bg-green-500 rounded-full" title="已启用" />
                ) : (
                  <div className="w-2 h-2 bg-gray-400 rounded-full" title="已禁用" />
                )}
              </div>
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
                <button
                  onClick={() => handleTogglePlugin(plugin)}
                  className={`p-2 rounded-lg transition-colors ${
                    plugin.enabled
                      ? 'bg-green-500/20 text-green-600 hover:bg-green-500/30'
                      : 'bg-gray-500/20 text-gray-600 hover:bg-gray-500/30'
                  }`}
                  title={plugin.enabled ? '禁用插件' : '启用插件'}
                >
                  {plugin.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                </button>
                {plugin.hasWebInterface && plugin.enabled && (
                  <button
                    onClick={() => handleOpenPlugin(plugin)}
                    className="p-2 bg-blue-500/20 text-blue-600 rounded-lg hover:bg-blue-500/30 transition-colors"
                    title="打开插件"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                onClick={() => handleDeletePlugin(plugin)}
                className="p-2 bg-red-500/20 text-red-600 rounded-lg hover:bg-red-500/30 transition-colors"
                title="删除插件"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {plugins.length === 0 && (
        <div className="text-center py-12">
          <Puzzle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">
            暂无插件
          </h3>
          <p className="text-gray-500 dark:text-gray-500 mb-4">
            创建您的第一个插件来扩展面板功能
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            创建插件
          </button>
        </div>
      )}

      {/* 插件展示模态框 */}
      {showPluginModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass rounded-lg w-[90vw] h-[90vh] flex flex-col mx-4 border border-white/20 dark:border-gray-700/30">
            <div className="flex justify-between items-center p-4 border-b border-white/10 dark:border-gray-700/30">
              <h2 className="text-xl font-bold text-black dark:text-white">{currentPluginName}</h2>
              <button
                onClick={() => {
                  setShowPluginModal(false)
                  setCurrentPluginContent('')
                  setCurrentPluginName('')
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 p-4">
              <iframe
                srcDoc={currentPluginContent}
                className="w-full h-full border-0 rounded-lg bg-white dark:bg-gray-900"
                sandbox="allow-scripts allow-same-origin allow-forms"
                title={currentPluginName}
              />
            </div>
          </div>
        </div>
      )}

      {/* 创建插件模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="glass rounded-lg p-6 w-full max-w-md mx-4 border border-white/20 dark:border-gray-700/30">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-black dark:text-white">创建新插件</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  插件名称 *
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如: my-plugin"
                />
                <p className="text-xs text-gray-500 mt-1">只能包含字母、数字、下划线和连字符</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  显示名称
                </label>
                <input
                  type="text"
                  value={createForm.displayName}
                  onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如: 我的插件"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  描述
                </label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  placeholder="插件功能描述"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    版本
                  </label>
                  <input
                    type="text"
                    value={createForm.version}
                    onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    作者
                  </label>
                  <input
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
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    分类
                  </label>
                  <select
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
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    图标
                  </label>
                  <select
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
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreatePlugin}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PluginsPage