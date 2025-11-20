import React, { useState, useEffect } from 'react'
import { 
  Plus, 
  Edit, 
  Trash2, 
  Save, 
  X, 
  Search,
  GamepadIcon,
  ExternalLink,
  Monitor,
  HardDrive,
  AlertCircle,
  CheckCircle,
  Loader2
} from 'lucide-react'
import { developerApi } from '../../services/developerApi'
import type { GameConfig, GameConfigData } from '../../types/developer'

interface GameConfigSectionProps {
  isAuthenticated: boolean
}

const GameConfigSection: React.FC<GameConfigSectionProps> = ({ isAuthenticated }) => {
  const [configs, setConfigs] = useState<GameConfigData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingConfig, setEditingConfig] = useState<GameConfig | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // 加载游戏配置
  const loadConfigs = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await developerApi.getGameConfigs()
      setConfigs(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载游戏配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadConfigs()
    }
  }, [isAuthenticated])

  // 过滤配置
  const filteredConfigs = Object.entries(configs).filter(([key, config]) => {
    const searchLower = searchTerm.toLowerCase()
    return (
      key.toLowerCase().includes(searchLower) ||
      config.game_nameCN.toLowerCase().includes(searchLower) ||
      config.appid.includes(searchTerm)
    )
  })

  // 开始创建新配置
  const handleCreate = () => {
    setEditingConfig({
      key: '',
      game_nameCN: '',
      appid: '',
      tip: '',
      image: '',
      url: '',
      system: ['Windows'],
      system_info: [],
      memory: 4,
      ports: []
    })
    setIsCreating(true)
  }

  // 开始编辑配置
  const handleEdit = (key: string, config: Omit<GameConfig, 'key'>) => {
    setEditingConfig({ key, ...config })
    setIsCreating(false)
  }

  // 保存配置
  const handleSave = async () => {
    if (!editingConfig) return

    try {
      setActionLoading('save')
      
      if (isCreating) {
        await developerApi.createGameConfig(editingConfig)
      } else {
        const { key, ...configData } = editingConfig
        await developerApi.updateGameConfig(key, configData)
      }
      
      await loadConfigs()
      setEditingConfig(null)
      setIsCreating(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存配置失败')
    } finally {
      setActionLoading(null)
    }
  }

  // 删除配置
  const handleDelete = async (key: string) => {
    if (!confirm(`确定要删除游戏配置 "${key}" 吗？`)) return

    try {
      setActionLoading(`delete-${key}`)
      await developerApi.deleteGameConfig(key)
      await loadConfigs()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除配置失败')
    } finally {
      setActionLoading(null)
    }
  }

  // 取消编辑
  const handleCancel = () => {
    setEditingConfig(null)
    setIsCreating(false)
  }

  if (!isAuthenticated) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
        <div className="flex items-center space-x-3">
          <AlertCircle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
          <div>
            <h3 className="font-medium text-yellow-900 dark:text-yellow-100">
              需要开发者认证
            </h3>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              请先完成开发者认证才能访问游戏配置编辑功能
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600 dark:text-gray-400">加载游戏配置中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <h4 className="font-medium text-red-900 dark:text-red-100">操作失败</h4>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* 头部操作栏 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              游戏部署配置管理
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              管理 installgame.json 文件中的游戏配置
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            {/* 搜索框 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索游戏..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            {/* 添加按钮 */}
            <button
              onClick={handleCreate}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>添加游戏</span>
            </button>
          </div>
        </div>
      </div>

      {/* 游戏配置列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredConfigs.map(([key, config]) => (
          <div key={key} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* 游戏图片 */}
            <div className="aspect-video bg-gray-100 dark:bg-gray-700 relative">
              {config.image ? (
                <img
                  src={config.image}
                  alt={config.game_nameCN}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <GamepadIcon className="w-12 h-12 text-gray-400" />
                </div>
              )}
              
              {/* 操作按钮 */}
              <div className="absolute top-2 right-2 flex space-x-1">
                <button
                  onClick={() => handleEdit(key, config)}
                  className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  title="编辑"
                >
                  <Edit className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleDelete(key)}
                  disabled={actionLoading === `delete-${key}`}
                  className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50"
                  title="删除"
                >
                  {actionLoading === `delete-${key}` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>

            {/* 游戏信息 */}
            <div className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white">
                    {config.game_nameCN}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {key}
                  </p>
                </div>
                {config.url && (
                  <a
                    href={config.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    title="查看Steam页面"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center space-x-2">
                  <span className="text-gray-500 dark:text-gray-400">App ID:</span>
                  <span className="text-gray-900 dark:text-white font-mono">{config.appid}</span>
                </div>

                {config.system && config.system.length > 0 && (
                  <div className="flex items-center space-x-2">
                    <Monitor className="w-4 h-4 text-gray-400" />
                    <div className="flex flex-wrap gap-1">
                      {config.system.map((sys) => (
                        <span
                          key={sys}
                          className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs"
                        >
                          {sys}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {config.memory && (
                  <div className="flex items-center space-x-2">
                    <HardDrive className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-700 dark:text-gray-300">
                      {config.memory}GB 内存
                    </span>
                  </div>
                )}

                {config.ports && config.ports.length > 0 && (
                  <div className="flex items-start space-x-2">
                    <span className="text-gray-500 dark:text-gray-400 mt-0.5">端口:</span>
                    <div className="flex flex-wrap gap-1">
                      {config.ports.map((portInfo, index) => (
                        <span
                          key={index}
                          className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-xs font-medium"
                        >
                          {portInfo.port} ({portInfo.protocol})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {config.tip && (
                <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400">
                  {config.tip.length > 100 ? `${config.tip.substring(0, 100)}...` : config.tip}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredConfigs.length === 0 && !loading && (
        <div className="text-center py-12">
          <GamepadIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {searchTerm ? '未找到匹配的游戏' : '暂无游戏配置'}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {searchTerm ? '尝试使用其他关键词搜索' : '点击"添加游戏"按钮创建第一个游戏配置'}
          </p>
        </div>
      )}

      {/* 编辑模态框 */}
      {editingConfig && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={handleCancel} />

            <div className="inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-gray-800 shadow-xl rounded-lg">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  {isCreating ? '添加游戏配置' : '编辑游戏配置'}
                </h3>
                <button
                  onClick={handleCancel}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4 max-h-96 overflow-y-auto">
                {/* 游戏标识 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    游戏标识 (英文名) *
                  </label>
                  <input
                    type="text"
                    value={editingConfig.key}
                    onChange={(e) => setEditingConfig({ ...editingConfig, key: e.target.value })}
                    disabled={!isCreating}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                    placeholder="例如: Palworld"
                  />
                  {!isCreating && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      游戏标识不可修改
                    </p>
                  )}
                </div>

                {/* 游戏中文名 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    游戏中文名 *
                  </label>
                  <input
                    type="text"
                    value={editingConfig.game_nameCN}
                    onChange={(e) => setEditingConfig({ ...editingConfig, game_nameCN: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="例如: 幻兽帕鲁"
                  />
                </div>

                {/* Steam App ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Steam App ID *
                  </label>
                  <input
                    type="text"
                    value={editingConfig.appid}
                    onChange={(e) => setEditingConfig({ ...editingConfig, appid: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="例如: 2394010"
                  />
                </div>

                {/* 游戏图片URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    游戏图片URL
                  </label>
                  <input
                    type="url"
                    value={editingConfig.image}
                    onChange={(e) => setEditingConfig({ ...editingConfig, image: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="https://..."
                  />
                </div>

                {/* Steam商店URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Steam商店URL
                  </label>
                  <input
                    type="url"
                    value={editingConfig.url}
                    onChange={(e) => setEditingConfig({ ...editingConfig, url: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="https://store.steampowered.com/app/..."
                  />
                </div>

                {/* 支持系统 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    支持系统
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {['Windows', 'Linux', 'macOS'].map((system) => (
                      <label key={system} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={editingConfig.system?.includes(system) || false}
                          onChange={(e) => {
                            const currentSystems = editingConfig.system || []
                            if (e.target.checked) {
                              setEditingConfig({
                                ...editingConfig,
                                system: [...currentSystems, system]
                              })
                            } else {
                              setEditingConfig({
                                ...editingConfig,
                                system: currentSystems.filter(s => s !== system)
                              })
                            }
                          }}
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{system}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 内存要求 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    内存要求 (GB)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="128"
                    value={editingConfig.memory || ''}
                    onChange={(e) => setEditingConfig({
                      ...editingConfig,
                      memory: e.target.value ? parseInt(e.target.value) : undefined
                    })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="4"
                  />
                </div>

                {/* 文档链接 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    文档链接
                  </label>
                  <input
                    type="url"
                    value={editingConfig.docs || ''}
                    onChange={(e) => setEditingConfig({ ...editingConfig, docs: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="https://docs.gsm.xiaozhuhouses.asia/..."
                  />
                </div>

                {/* 端口信息 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    端口信息
                  </label>
                  <div className="space-y-2">
                    {(editingConfig.ports || []).map((port, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <input
                          type="number"
                          min="1"
                          max="65535"
                          value={port.port}
                          onChange={(e) => {
                            const newPorts = [...(editingConfig.ports || [])]
                            newPorts[index] = { ...newPorts[index], port: parseInt(e.target.value) || 0 }
                            setEditingConfig({ ...editingConfig, ports: newPorts })
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="端口号"
                        />
                        <input
                          type="text"
                          value={port.protocol}
                          onChange={(e) => {
                            const newPorts = [...(editingConfig.ports || [])]
                            newPorts[index] = { ...newPorts[index], protocol: e.target.value }
                            setEditingConfig({ ...editingConfig, ports: newPorts })
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="协议 (如: tcp/udp)"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const newPorts = (editingConfig.ports || []).filter((_, i) => i !== index)
                            setEditingConfig({ ...editingConfig, ports: newPorts })
                          }}
                          className="p-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const newPorts = [...(editingConfig.ports || []), { port: 0, protocol: 'tcp/udp' }]
                        setEditingConfig({ ...editingConfig, ports: newPorts })
                      }}
                      className="flex items-center space-x-2 px-3 py-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      <Plus className="w-4 h-4" />
                      <span>添加端口</span>
                    </button>
                  </div>
                </div>

                {/* 游戏提示 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    游戏提示信息
                  </label>
                  <textarea
                    value={editingConfig.tip}
                    onChange={(e) => setEditingConfig({ ...editingConfig, tip: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="游戏端口、配置文件位置、注意事项等..."
                  />
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={!editingConfig.key || !editingConfig.game_nameCN || !editingConfig.appid || actionLoading === 'save'}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
                >
                  {actionLoading === 'save' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>保存中...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>保存</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GameConfigSection
