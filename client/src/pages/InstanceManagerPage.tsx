import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Play,
  Square,
  Edit,
  Trash2,
  FolderOpen,
  Settings,
  Activity,
  Clock,
  Terminal,
  AlertCircle,
  CheckCircle,
  Loader,
  Server,
  ShoppingCart,
  Download,
  HelpCircle,
  X
} from 'lucide-react'
import { Instance, CreateInstanceRequest } from '@/types'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSystemStore } from '@/stores/systemStore'
import apiClient from '@/utils/api'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { ConfirmStartDialog } from '@/components/ConfirmStartDialog'
import { CreateConfigDialog } from '@/components/CreateConfigDialog'
import SearchableSelect from '@/components/SearchableSelect'
import RconConsole from '@/components/RconConsole'
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatFileSize } from '@/utils/format'

// 获取嵌套对象值的工具函数
const getNestedValue = (obj: any, ...path: string[]): any => {
  if (!obj || path.length === 0) return undefined

  let current = obj
  for (const part of path) {
    if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part]
    } else {
      return undefined
    }
  }
  return current
}

// 实例市场相关类型
interface MarketInstance {
  name: string
  command: string
  stopcommand: string
}

interface MarketResponse {
  instances: MarketInstance[]
}

interface InstallInstanceRequest {
  name: string
  command: string
  stopCommand: string
  workingDirectory: string
}

const InstanceManagerPage: React.FC = () => {
  const navigate = useNavigate()
  const { addNotification } = useNotificationStore()
  const { systemInfo, fetchSystemInfo } = useSystemStore()
  const [activeTab, setActiveTab] = useState<'instances' | 'market' | 'gameConfig' | 'rcon' | 'backup'>('instances')
  const [backups, setBackups] = useState<Array<{ name: string; baseDir: string; files: { fileName: string; size: number; modified: string }[]; meta?: { sourcePath?: string } }>>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [expandedBackup, setExpandedBackup] = useState<string | null>(null)
  const [restoreDialog, setRestoreDialog] = useState<{ visible: boolean; backupName: string; fileName: string; sourcePath?: string } | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [marketInstances, setMarketInstances] = useState<MarketInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [marketLoading, setMarketLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalAnimating, setCreateModalAnimating] = useState(false)
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [installModalAnimating, setInstallModalAnimating] = useState(false)
  const [selectedMarketInstance, setSelectedMarketInstance] = useState<MarketInstance | null>(null)
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [instanceToDelete, setInstanceToDelete] = useState<Instance | null>(null)
  const [showStartConfirmDialog, setShowStartConfirmDialog] = useState(false)
  const [instanceToStart, setInstanceToStart] = useState<Instance | null>(null)
  const [showCreateConfigDialog, setShowCreateConfigDialog] = useState(false)
  const [createConfigInfo, setCreateConfigInfo] = useState<{
    instanceId: string
    instanceName: string
    configId: string
    configPath: string
  } | null>(null)
  const [installFormData, setInstallFormData] = useState({ workingDirectory: '' })
  const [showStartCommandHelpModal, setShowStartCommandHelpModal] = useState(false)
  const [startCommandHelpModalAnimating, setStartCommandHelpModalAnimating] = useState(false)
  const [formData, setFormData] = useState<CreateInstanceRequest>({
    name: '',
    description: '',
    workingDirectory: '',
    startCommand: '',
    autoStart: false,
    stopCommand: 'ctrl+c',
    enableStreamForward: false,
    programPath: '',
    terminalUser: ''
  })
  
  // 停止按钮状态管理
  const [disabledStopButtons, setDisabledStopButtons] = useState<Set<string>>(new Set())

  // 游戏配置相关状态
  const [availableConfigs, setAvailableConfigs] = useState<any[]>([])
  const [selectedInstance, setSelectedInstance] = useState<string>('')
  const [selectedConfigId, setSelectedConfigId] = useState<string>('')
  const [configSchema, setConfigSchema] = useState<any>(null)
  const [configData, setConfigData] = useState<any>({})
  const [isConfigLoading, setIsConfigLoading] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)

  // 系统用户列表状态
  const [systemUsers, setSystemUsers] = useState<string[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)

  // 获取实例列表
  const fetchInstances = async () => {
    try {
      setLoading(true)
      const response = await apiClient.getInstances()
      if (response.success) {
        const instancesData = response.data || []
        setInstances(instancesData)
      }
    } catch (error) {
      console.error('获取实例列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: '无法获取实例列表'
      })
    } finally {
      setLoading(false)
    }
  }

  // 获取可用配置列表
  const fetchAvailableConfigs = async () => {
    try {
      const response = await apiClient.getGameConfigTemplates()
      setAvailableConfigs(response.data)
    } catch (error) {
      console.error('获取配置列表失败:', error)
    }
  }

  // 获取配置模板
  const fetchConfigSchema = async (configId: string) => {
    try {
      setIsConfigLoading(true)
      const response = await apiClient.getGameConfigTemplate(configId)
      setConfigSchema(response.data)
      return response.data // 返回获取到的配置模式数据
    } catch (error) {
      console.error('获取配置模板失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: '获取配置模板失败'
      })
      return null
    } finally {
      setIsConfigLoading(false)
    }
  }

  // 获取系统用户列表
  const fetchSystemUsers = async () => {
    try {
      setLoadingUsers(true)
      const response = await apiClient.getSystemUsers()
      if (response.success) {
        setSystemUsers(response.data || [])
      }
    } catch (error) {
      console.error('获取系统用户列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: '无法获取系统用户列表'
      })
    } finally {
      setLoadingUsers(false)
    }
  }

  // 读取游戏配置
  const loadGameConfig = async (instanceId: string, configId: string, schema?: any) => {
    try {
      setIsConfigLoading(true)
      const response = await apiClient.readGameConfig(instanceId, configId)

      // 检查配置文件是否存在
      if (response.data?.configExists === false) {
        // 配置文件不存在，显示创建提示对话框
        const configFilePath = response.data?.configFilePath || '配置文件'
        const instance = instances.find(inst => inst.id === instanceId)
        const instanceName = instance?.name || instanceId
        const configName = availableConfigs.find(config => config.id === configId)?.name || configId
        
        setCreateConfigInfo({
          instanceId,
          instanceName,
          configId: configName,
          configPath: configFilePath
        })
        setShowCreateConfigDialog(true)
        
        // 暂时使用默认值
        const currentSchema = schema || configSchema
        const defaultData = fillDefaultValues(currentSchema, response.data?.config || {})
        setConfigData(defaultData)
        return
      }

      // 配置文件存在，正常处理
      let configFromServer = response.data?.config || {}

      // 规范化数据：如果存在 server: { properties: ... }，则将其内容合并到 'server.properties'
      if (
        configFromServer.server &&
        typeof configFromServer.server === 'object' &&
        configFromServer.server.properties &&
        typeof configFromServer.server.properties === 'object'
      ) {
        // 创建一个新的对象副本以进行修改
        const newConfig = { ...configFromServer }

        // 将 server.properties 的内容合并到 'server.properties'
        newConfig['server.properties'] = {
          ...(newConfig['server.properties'] || {}),
          ...newConfig.server.properties
        }

        // 删除旧的 server 键
        delete newConfig.server

        // 更新配置数据
        configFromServer = newConfig
      }

      // 使用传入的配置模式或当前的配置模式填充默认值
      const currentSchema = schema || configSchema
      const filledData = fillDefaultValues(currentSchema, configFromServer)
      setConfigData(filledData)
    } catch (error) {
      console.error('读取配置失败:', error)
      addNotification({
        type: 'error',
        title: '读取失败',
        message: '读取配置失败'
      })
      // 即使读取失败，也尝试使用默认值创建配置
      const currentSchema = schema || configSchema
      const defaultData = fillDefaultValues(currentSchema, {})
      setConfigData(defaultData)
    } finally {
      setIsConfigLoading(false)
    }
  }

  // 保存游戏配置
  const saveGameConfig = async () => {
    if (!selectedInstance || !selectedConfigId) {
      addNotification({
        type: 'warning',
        title: '提示',
        message: '请选择实例和配置文件'
      })
      return
    }

    console.log('=== 保存配置调试信息 ===')
    console.log('选中的实例:', selectedInstance)
    console.log('选中的配置ID:', selectedConfigId)
    console.log('当前configData状态:', JSON.stringify(configData, null, 2))
    console.log('configData对象引用:', configData)
    console.log('configData的键:', Object.keys(configData))
    
    // 检查configData是否为空或只包含默认值
    const hasUserData = Object.keys(configData).length > 0
    console.log('configData是否包含数据:', hasUserData)

    try {
      setIsSavingConfig(true)
      const response = await apiClient.saveGameConfig(selectedInstance, selectedConfigId, configData)
      console.log('保存响应:', response)
      addNotification({
        type: 'success',
        title: '保存成功',
        message: '配置保存成功'
      })
    } catch (error) {
      console.error('保存配置失败:', error)
      addNotification({
        type: 'error',
        title: '保存失败',
        message: '保存配置失败'
      })
    } finally {
      setIsSavingConfig(false)
    }
  }

  // 处理配置选择变化
  const handleConfigSelection = async (instanceId: string, configId: string) => {
    setSelectedInstance(instanceId)
    setSelectedConfigId(configId)
    
    if (instanceId && configId) {
      // 先获取配置模式
      const schemaResponse = await fetchConfigSchema(configId)
      // 直接传递获取到的配置模式给loadGameConfig
      if (schemaResponse) {
        await loadGameConfig(instanceId, configId, schemaResponse)
      } else {
        await loadGameConfig(instanceId, configId)
      }
    } else {
      setConfigSchema(null)
      setConfigData({})
    }
  }

  // 填充默认值到配置数据
  const fillDefaultValues = (schema: any, currentData: any = {}) => {
    if (!schema || !schema.sections) return currentData
    
    const filledData = { ...currentData }
    
    // 处理sections数组
    if (Array.isArray(schema.sections)) {
      schema.sections.forEach((section: any) => {
        // 使用空值合并运算符，确保空字符串不会被替换成 'default'
        const sectionKey = section.key !== undefined && section.key !== null ? section.key : 'default'
        if (!filledData[sectionKey]) {
          filledData[sectionKey] = {}
        }
        
        if (section.fields && Array.isArray(section.fields)) {
          section.fields.forEach((field: any) => {
            if (field.type === 'nested' && field.nested_fields) {
              // 处理嵌套字段
              if (!filledData[sectionKey][field.name]) {
                filledData[sectionKey][field.name] = {}
              }
              
              // 填充嵌套字段的默认值
              field.nested_fields.forEach((nestedField: any) => {
                if (filledData[sectionKey][field.name][nestedField.name] === undefined && nestedField.default !== undefined) {
                  filledData[sectionKey][field.name][nestedField.name] = nestedField.default
                }
              })
            } else {
              // 处理普通字段
              if (filledData[sectionKey][field.name] === undefined && field.default !== undefined) {
                filledData[sectionKey][field.name] = field.default
              }
            }
          })
        }
      })
    } else {
      // 兼容旧格式：sections是对象
      Object.entries(schema.sections).forEach(([sectionKey, section]: [string, any]) => {
        if (!filledData[sectionKey]) {
          filledData[sectionKey] = {}
        }
        
        if (section.fields && Array.isArray(section.fields)) {
          section.fields.forEach((field: any) => {
            if (field.type === 'nested' && field.nested_fields) {
              // 处理嵌套字段
              if (!filledData[sectionKey][field.name]) {
                filledData[sectionKey][field.name] = {}
              }
              
              // 填充嵌套字段的默认值
              field.nested_fields.forEach((nestedField: any) => {
                if (filledData[sectionKey][field.name][nestedField.name] === undefined && nestedField.default !== undefined) {
                  filledData[sectionKey][field.name][nestedField.name] = nestedField.default
                }
              })
            } else {
              // 处理普通字段
              if (filledData[sectionKey][field.name] === undefined && field.default !== undefined) {
                filledData[sectionKey][field.name] = field.default
              }
            }
          })
        }
      })
    }
    
    return filledData
  }

  // 处理配置数据变化
  const handleConfigDataChange = (value: any, ...path: string[]) => {
    setConfigData((prev) => {
      // 使用深拷贝来避免状态更新问题
      const newData = JSON.parse(JSON.stringify(prev))

      let current = newData
      for (let i = 0; i < path.length - 1; i++) {
        const part = path[i]
        // 如果路径不存在，创建它
        if (current[part] === undefined || typeof current[part] !== 'object') {
          current[part] = {}
        }
        current = current[part]
      }

      // 设置最终值
      if (path.length > 0) {
        const lastPart = path[path.length - 1]
        current[lastPart] = value
      }

      return newData
    })
  }

  // 获取实例市场列表
  const fetchMarketInstances = async () => {
    try {
      setMarketLoading(true)
      const response = await apiClient.getMarketInstances()
      if (response.success) {
        setMarketInstances(response.data?.instances || [])
      }
    } catch (error) {
      console.error('获取实例市场列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: '无法获取实例市场列表'
      })
    } finally {
      setMarketLoading(false)
    }
  }

  useEffect(() => {
    fetchInstances()
    fetchAvailableConfigs()
    fetchSystemUsers()
    fetchSystemInfo() // 获取系统信息以检测ARM架构
  }, [])

  useEffect(() => {
    if (activeTab === 'market' && marketInstances.length === 0) {
      fetchMarketInstances()
    }
    if (activeTab === 'backup') {
      loadBackups()
    }
  }, [activeTab])

  const loadBackups = async () => {
    try {
      setLoadingBackups(true)
      const response = await apiClient.listBackups()
      if (response.success) {
        setBackups(response.data || [])
      }
    } catch (error) {
      console.error('获取备份列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: '无法获取备份列表'
      })
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleRestoreBackup = async (backupName: string, fileName: string) => {
    try {
      const resp = await apiClient.restoreBackup({ backupName, fileName })
      if (resp.success) {
        addNotification({ type: 'success', title: '恢复成功', message: '备份已恢复到原路径' })
      } else {
        throw new Error(resp.message || '恢复失败')
      }
    } catch (error: any) {
      addNotification({ type: 'error', title: '恢复失败', message: error.message || '恢复失败' })
    }
  }

  const handleDeleteBackupFile = async (backupName: string, fileName: string) => {
    try {
      const resp = await apiClient.deleteBackupFile(backupName, fileName)
      if (resp.success) {
        addNotification({ type: 'success', title: '删除成功', message: '备份文件已删除' })
        loadBackups()
      } else {
        throw new Error(resp.message || '删除失败')
      }
    } catch (error: any) {
      addNotification({ type: 'error', title: '删除失败', message: error.message || '删除失败' })
    }
  }

  // 当检测到ARM架构时，如果当前标签页是实例市场，则切换到我的实例标签页
  useEffect(() => {
    if (systemInfo && (systemInfo.arch === 'arm64' || systemInfo.arch === 'aarch64') && activeTab === 'market') {
      setActiveTab('instances')
    }
  }, [systemInfo, activeTab])

  // 监听configData变化
  useEffect(() => {
    console.log('configData状态已更新:', configData)
  }, [configData])

  // 创建实例
  const handleCreateInstance = async () => {
    try {
      // 验证输出流转发配置
      if (formData.enableStreamForward && formData.programPath) {
        // 解析程序路径，支持带引号的路径
        let executablePath = formData.programPath.trim()
        if (executablePath.startsWith('"') && executablePath.includes('"', 1)) {
          const endQuoteIndex = executablePath.indexOf('"', 1)
          executablePath = executablePath.substring(1, endQuoteIndex)
        } else {
          executablePath = executablePath.split(' ')[0]
        }
        
        // 检查是否为绝对路径（Windows: C:\ 或 D:\ 等，Unix: /开头）
        const isAbsolute = /^([a-zA-Z]:\\|\/)/.test(executablePath)
        if (!isAbsolute) {
          addNotification({
            type: 'error',
            title: '验证失败',
            message: '启用输出流转发时必须提供程序启动命令的绝对路径'
          })
          return
        }
      }
      
      const response = await apiClient.createInstance(formData)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '创建成功',
          message: `实例 "${formData.name}" 已创建`
        })
        handleCloseCreateModal()
        fetchInstances()
      }
    } catch (error: any) {
      console.error('创建实例失败:', error)
      
      // 获取具体的错误消息
      let errorMessage = '无法创建实例'
      if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      }
      
      addNotification({
        type: 'error',
        title: '创建失败',
        message: errorMessage
      })
    }
  }

  // 更新实例
  const handleUpdateInstance = async () => {
    if (!editingInstance) return
    
    try {
      // 验证输出流转发配置
      if (formData.enableStreamForward && formData.programPath) {
        // 解析程序路径，支持带引号的路径
        let executablePath = formData.programPath.trim()
        if (executablePath.startsWith('"') && executablePath.includes('"', 1)) {
          const endQuoteIndex = executablePath.indexOf('"', 1)
          executablePath = executablePath.substring(1, endQuoteIndex)
        } else {
          executablePath = executablePath.split(' ')[0]
        }
        
        // 检查是否为绝对路径（Windows: C:\ 或 D:\ 等，Unix: /开头）
        const isAbsolute = /^([a-zA-Z]:\\|\/)/.test(executablePath)
        if (!isAbsolute) {
          addNotification({
            type: 'error',
            title: '验证失败',
            message: '启用输出流转发时必须提供程序启动命令的绝对路径'
          })
          return
        }
      }
      
      const response = await apiClient.updateInstance(editingInstance.id, formData)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '更新成功',
          message: `实例 "${formData.name}" 已更新`
        })
        handleCloseCreateModal()
        fetchInstances()
      }
    } catch (error: any) {
      console.error('更新实例失败:', error)
      
      // 获取具体的错误消息
      let errorMessage = '无法更新实例'
      if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      }
      
      addNotification({
        type: 'error',
        title: '更新失败',
        message: errorMessage
      })
    }
  }

  // 安装市场实例
  const handleInstallMarketInstance = async () => {
    if (!selectedMarketInstance || !installFormData.workingDirectory) return
    
    try {
      // 转换停止命令格式
      let stopCommand: 'ctrl+c' | 'stop' | 'exit' | 'quit' = 'ctrl+c'
      if (selectedMarketInstance.stopcommand === '^C') {
        stopCommand = 'ctrl+c'
      } else if (selectedMarketInstance.stopcommand === 'stop') {
        stopCommand = 'stop'
      } else if (selectedMarketInstance.stopcommand === 'exit') {
        stopCommand = 'exit'
      } else if (selectedMarketInstance.stopcommand === 'quit') {
        stopCommand = 'quit'
      }
      
      const installData: CreateInstanceRequest = {
        name: selectedMarketInstance.name,
        description: `从实例市场安装的 ${selectedMarketInstance.name}`,
        workingDirectory: installFormData.workingDirectory,
        startCommand: selectedMarketInstance.command,
        autoStart: false,
        stopCommand,
        terminalUser: ''
      }
      
      const response = await apiClient.createInstance(installData)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '安装成功',
          message: `实例 "${selectedMarketInstance.name}" 已安装`
        })
        handleCloseInstallModal()
        fetchInstances()
        setActiveTab('instances')
      }
    } catch (error: any) {
      console.error('安装实例失败:', error)
      
      let errorMessage = '无法安装实例'
      if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      }
      
      addNotification({
        type: 'error',
        title: '安装失败',
        message: errorMessage
      })
    }
  }

  // 打开安装模态框
  const handleOpenInstallModal = (marketInstance: MarketInstance) => {
    setSelectedMarketInstance(marketInstance)
    setShowInstallModal(true)
    setTimeout(() => setInstallModalAnimating(true), 10)
  }

  // 检查启动命令并显示确认对话框
  const handleStartInstance = (instance: Instance) => {
    // 检测启动命令是否为none
    const isCommandNone = instance.startCommand === 'none'

    if (isCommandNone) {
      // 显示确认对话框
      setInstanceToStart(instance)
      setShowStartConfirmDialog(true)
    } else {
      // 直接启动
      performStartInstance(instance)
    }
  }

  // 实际执行启动实例的函数
  const performStartInstance = async (instance: Instance) => {
    try {
      const response = await apiClient.startInstance(instance.id)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '启动成功',
          message: `实例 "${instance.name}" 正在启动`
        })

        // 如果返回了终端会话ID，使用sessionId参数跳转到终端页面
        if (response.data?.terminalSessionId) {
          navigate(`/terminal?sessionId=${response.data.terminalSessionId}&instance=${instance.id}&cwd=${encodeURIComponent(instance.workingDirectory)}`)
        } else {
          // 兼容旧版本，使用instance参数
          navigate(`/terminal?instance=${instance.id}&cwd=${encodeURIComponent(instance.workingDirectory)}`)
        }

        fetchInstances()
      }
    } catch (error: any) {
      console.error('启动实例失败:', error)

      // 获取具体的错误消息
      let errorMessage = '无法启动实例'
      if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      }

      addNotification({
        type: 'error',
        title: '启动失败',
        message: errorMessage
      })
    }
  }

  // 确认启动实例
  const handleConfirmStart = () => {
    if (instanceToStart) {
      performStartInstance(instanceToStart)
      setShowStartConfirmDialog(false)
      setInstanceToStart(null)
    }
  }

  // 取消启动实例
  const handleCancelStart = () => {
    setShowStartConfirmDialog(false)
    setInstanceToStart(null)
  }

  // 停止实例
  const handleStopInstance = async (instance: Instance) => {
    try {
      const response = await apiClient.stopInstance(instance.id)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '停止成功',
          message: `实例 "${instance.name}" 正在停止`
        })
        
        // 刷新实例列表以获取最新状态
        fetchInstances()
      }
    } catch (error: any) {
      console.error('停止实例失败:', error)
      
      // 获取具体的错误消息
      let errorMessage = '无法停止实例'
      if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      }
      
      addNotification({
        type: 'error',
        title: '停止失败',
        message: errorMessage
      })
    }
  }

  // 关闭终端
  const handleCloseTerminal = async (instance: Instance) => {
    try {
      // 禁用按钮3秒
      setDisabledStopButtons(prev => new Set(prev).add(instance.id))
      setTimeout(() => {
        setDisabledStopButtons(prev => {
          const newSet = new Set(prev)
          newSet.delete(instance.id)
          return newSet
        })
      }, 3000)
      
      // 调用关闭终端的API
      const response = await apiClient.closeTerminal(instance.id)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '终端已关闭',
          message: `实例 "${instance.name}" 的终端已关闭`
        })
        
        fetchInstances()
      }
    } catch (error: any) {
      console.error('关闭终端失败:', error)
      
      let errorMessage = '无法关闭终端'
      if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      }
      
      addNotification({
        type: 'error',
        title: '关闭失败',
        message: errorMessage
      })
    }
  }

  // 删除实例
  const handleDeleteInstance = (instance: Instance) => {
    setInstanceToDelete(instance)
    setShowDeleteDialog(true)
  }

  // 确认删除实例
  const handleConfirmDelete = async (deleteDirectory: boolean) => {
    if (!instanceToDelete) return
    
    setShowDeleteDialog(false)
    
    try {
      const response = await apiClient.deleteInstance(instanceToDelete.id)
      if (response.success) {
        // 如果用户选择删除目录，发送删除目录的请求
        if (deleteDirectory) {
          try {
            // 调用删除目录的API，使用ApiClient确保包含认证token
            const token = localStorage.getItem('gsm3_token')
            const deleteResponse = await fetch('/api/files/delete', {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                paths: [instanceToDelete.workingDirectory]
              })
            })
            
            if (!deleteResponse.ok) {
              const errorData = await deleteResponse.json()
              throw new Error(errorData.message || '删除目录失败')
            }
            
            addNotification({
              type: 'success',
              title: '删除成功',
              message: `实例 "${instanceToDelete.name}" 已删除，工作目录也已删除`
            })
          } catch (dirError: any) {
            addNotification({
              type: 'warning',
              title: '目录删除失败',
              message: `实例已删除，但无法删除工作目录: ${dirError.message || '未知错误'}`
            })
          }
        } else {
          addNotification({
            type: 'success',
            title: '删除成功',
            message: `实例 "${instanceToDelete.name}" 已删除`
          })
        }
        
        fetchInstances()
      }
    } catch (error: any) {
      console.error('删除实例失败:', error)
      
      // 获取具体的错误消息
      let errorMessage = '无法删除实例'
      if (error.message) {
        errorMessage = error.message
      } else if (error.error) {
        errorMessage = error.error
      }
      
      addNotification({
        type: 'error',
        title: '删除失败',
        message: errorMessage
      })
    } finally {
      setInstanceToDelete(null)
    }
  }

  // 取消删除
  const handleCancelDelete = () => {
    setShowDeleteDialog(false)
    setInstanceToDelete(null)
  }

  // 打开文件目录
  const handleOpenDirectory = (instance: Instance) => {
    navigate(`/files?path=${encodeURIComponent(instance.workingDirectory)}`)
    addNotification({
      type: 'success',
      title: '跳转成功',
      message: `已打开 "${instance.name}" 的工作目录`
    })
  }

  // 重置表单
  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      workingDirectory: '',
      startCommand: '',
      autoStart: false,
      stopCommand: 'ctrl+c',
      enableStreamForward: false,
      programPath: '',
      terminalUser: ''
    })
  }

  // 关闭创建/编辑模态框
  const handleCloseCreateModal = () => {
    setCreateModalAnimating(false)
    setTimeout(() => {
      setShowCreateModal(false)
      setEditingInstance(null)
      resetForm()
    }, 300)
  }

  // 关闭安装模态框
  const handleCloseInstallModal = () => {
    setInstallModalAnimating(false)
    setTimeout(() => {
      setShowInstallModal(false)
      setSelectedMarketInstance(null)
      setInstallFormData({ workingDirectory: '' })
    }, 300)
  }

  // 处理创建配置文件确认
  const handleCreateConfigConfirm = async () => {
    if (!createConfigInfo) return
    
    try {
      const createResponse = await apiClient.createGameConfig(createConfigInfo.instanceId, createConfigInfo.configId)
      if (createResponse.data?.config) {
        const currentSchema = configSchema
        const filledData = fillDefaultValues(currentSchema, createResponse.data.config)
        setConfigData(filledData)
        addNotification({
          type: 'success',
          title: '创建成功',
          message: '配置文件已创建'
        })
      }
    } catch (createError) {
      console.error('创建配置文件失败:', createError)
      addNotification({
        type: 'error',
        title: '创建失败',
        message: '创建配置文件失败'
      })
    } finally {
      setShowCreateConfigDialog(false)
      setCreateConfigInfo(null)
    }
  }

  // 处理创建配置文件取消
  const handleCreateConfigCancel = () => {
    setShowCreateConfigDialog(false)
    setCreateConfigInfo(null)
  }

  // 打开启动命令帮助模态框
  const handleOpenStartCommandHelpModal = () => {
    setShowStartCommandHelpModal(true)
    setTimeout(() => setStartCommandHelpModalAnimating(true), 10)
  }

  // 关闭启动命令帮助模态框
  const handleCloseStartCommandHelpModal = () => {
    setStartCommandHelpModalAnimating(false)
    setTimeout(() => {
      setShowStartCommandHelpModal(false)
    }, 300)
  }

  // 编辑实例
  const handleEditInstance = (instance: Instance) => {
    setEditingInstance(instance)
    setFormData({
      name: instance.name,
      description: instance.description,
      workingDirectory: instance.workingDirectory,
      startCommand: instance.startCommand,
      autoStart: instance.autoStart,
      stopCommand: instance.stopCommand,
      enableStreamForward: instance.enableStreamForward || false,
      programPath: instance.programPath || '',
      terminalUser: instance.terminalUser || ''
    })
    setShowCreateModal(true)
    setTimeout(() => setCreateModalAnimating(true), 10)
  }

  // 获取状态图标
  const getStatusIcon = (status: Instance['status']) => {
    switch (status) {
      case 'running':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'stopped':
        return <Square className="w-5 h-5 text-gray-500" />
      case 'starting':
      case 'stopping':
        return <Loader className="w-5 h-5 text-blue-500 animate-spin" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <Square className="w-5 h-5 text-gray-500" />
    }
  }

  // 获取状态文本
  const getStatusText = (status: Instance['status']) => {
    switch (status) {
      case 'running': return '运行中'
      case 'stopped': return '已停止'
      case 'starting': return '启动中'
      case 'stopping': return '停止中'
      case 'error': return '错误'
      default: return '未知'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600 dark:text-gray-400">加载中...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">实例管理</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            管理和监控您的应用实例
          </p>
        </div>
        {activeTab === 'instances' && (
          <button
            onClick={() => {
              setEditingInstance(null)
              resetForm()
              setShowCreateModal(true)
              setTimeout(() => setCreateModalAnimating(true), 10)
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>创建实例</span>
          </button>
        )}
      </div>

      {/* 标签页导航 */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('instances')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'instances'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4" />
              <span>我的实例</span>
            </div>
          </button>
          {/* 实例市场标签页 - 检测到ARM架构时隐藏 */}
          {!(systemInfo?.arch === 'arm64' || systemInfo?.arch === 'aarch64') && (
            <button
              onClick={() => setActiveTab('market')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'market'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <ShoppingCart className="w-4 h-4" />
                <span>实例市场</span>
              </div>
            </button>
          )}
          <button
            onClick={() => setActiveTab('gameConfig')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'gameConfig'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Settings className="w-4 h-4" />
              <span>游戏配置文件</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('rcon')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'rcon'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4" />
              <span>RCON控制台</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'backup'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4" />
              <span>备份管理</span>
            </div>
          </button>
        </nav>
      </div>

      {/* 标签页内容 */}
      {activeTab === 'instances' ? (
        /* 我的实例列表 */
        instances.length === 0 ? (
          <div className="text-center py-12">
            <Server className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              暂无实例
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              创建您的第一个实例来开始管理应用
            </p>
            <button
              onClick={() => {
                setEditingInstance(null)
                resetForm()
                setShowCreateModal(true)
                setTimeout(() => setCreateModalAnimating(true), 10)
              }}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>创建实例</span>
            </button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {instances.map((instance) => (
              <div
                key={instance.id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-shadow"
              >
              {/* 实例头部 */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                    {instance.name}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                    {instance.description}
                  </p>
                </div>
                <div className="flex items-center space-x-1 ml-4">
                  {getStatusIcon(instance.status)}
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {getStatusText(instance.status)}
                  </span>
                </div>
              </div>

              {/* 实例信息 */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                  <FolderOpen className="w-4 h-4 mr-2" />
                  <span className="truncate">{instance.workingDirectory}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                  <Terminal className="w-4 h-4 mr-2" />
                  <span className="truncate">{instance.startCommand}</span>
                </div>
                {instance.lastStarted && (
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                    <Clock className="w-4 h-4 mr-2" />
                    <span>最后启动: {new Date(instance.lastStarted).toLocaleString()}</span>
                  </div>
                )}
                {instance.pid && (
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                    <Activity className="w-4 h-4 mr-2" />
                    <span>PID: {instance.pid}</span>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-2">
                  {instance.status === 'running' ? (
                    <button
                      onClick={() => handleStopInstance(instance)}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
                    >
                      <Square className="w-4 h-4" />
                      <span>停止</span>
                    </button>
                  ) : instance.status === 'stopping' ? (
                    <button
                      onClick={() => handleCloseTerminal(instance)}
                      disabled={disabledStopButtons.has(instance.id)}
                      className={`flex items-center space-x-1 px-3 py-1.5 rounded-md transition-colors ${
                        disabledStopButtons.has(instance.id)
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                      }`}
                    >
                      <Square className="w-4 h-4" />
                      <span>关闭终端</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStartInstance(instance)}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-green-100 text-green-700 rounded-md hover:bg-green-200 transition-colors"
                      disabled={instance.status === 'starting'}
                    >
                      <Play className="w-4 h-4" />
                      <span>启动</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenDirectory(instance)}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>文件</span>
                  </button>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleEditInstance(instance)}
                    disabled={instance.status === 'running'}
                    className={`p-1.5 rounded transition-colors ${
                      instance.status === 'running'
                        ? 'text-gray-400 cursor-not-allowed'
                        : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
                    }`}
                    title={instance.status === 'running' ? '实例运行时无法编辑' : '编辑实例'}
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteInstance(instance)}
                    disabled={instance.status === 'running'}
                    className={`p-1.5 rounded transition-colors ${
                      instance.status === 'running'
                        ? 'text-gray-400 cursor-not-allowed'
                        : 'text-gray-600 hover:text-red-600 hover:bg-red-50'
                    }`}
                    title={instance.status === 'running' ? '实例运行时无法删除' : '删除实例'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        )
      ) : activeTab === 'market' ? (
        /* 实例市场 */
        <div className="space-y-6">
          {marketLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader className="w-8 h-8 animate-spin text-blue-500" />
              <span className="ml-2 text-gray-600 dark:text-gray-400">加载实例市场...</span>
            </div>
          ) : marketInstances.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                暂无可用实例
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                实例市场暂时没有可用的实例模板
              </p>
              <button
                onClick={fetchMarketInstances}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <span>刷新</span>
              </button>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {marketInstances.map((marketInstance, index) => (
                <div
                  key={index}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-shadow"
                >
                  {/* 实例头部 */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                        {marketInstance.name}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        来自实例市场的预配置实例
                      </p>
                    </div>
                    <div className="flex items-center space-x-1 ml-4">
                      <ShoppingCart className="w-5 h-5 text-blue-500" />
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        可安装
                      </span>
                    </div>
                  </div>

                  {/* 实例信息 */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                      <Terminal className="w-4 h-4 mr-2" />
                      <span className="truncate">启动命令: {marketInstance.command}</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                      <Square className="w-4 h-4 mr-2" />
                      <span className="truncate">停止命令: {marketInstance.stopcommand}</span>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => handleOpenInstallModal(marketInstance)}
                      className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>安装</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'gameConfig' ? (
        /* 游戏配置文件 */
        <div className="space-y-6">
          {/* 选择区域 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              选择实例和配置文件
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 选择实例 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  选择实例
                </label>
                <SearchableSelect
                  value={selectedInstance}
                  onChange={(value) => handleConfigSelection(value, selectedConfigId)}
                  options={instances.map(instance => ({
                    id: instance.id,
                    name: instance.name
                  }))}
                  placeholder="请选择或输入搜索实例"
                  className="w-full"
                />
              </div>
              
              {/* 选择配置文件 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  选择配置文件
                </label>
                <SearchableSelect
                  value={selectedConfigId}
                  onChange={(value) => handleConfigSelection(selectedInstance, value)}
                  options={availableConfigs.map(config => ({
                    id: config.id,
                    name: config.name
                  }))}
                  placeholder="请选择或输入搜索配置文件"
                  disabled={!selectedInstance}
                  className="w-full"
                />
              </div>
            </div>
          </div>
          
          {/* 配置编辑区域 */}
          {selectedInstance && selectedConfigId && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  配置编辑
                </h3>
                <button
                  onClick={saveGameConfig}
                  disabled={isSavingConfig || isConfigLoading}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSavingConfig ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <Settings className="w-4 h-4" />
                  )}
                  <span>{isSavingConfig ? '保存中...' : '保存配置'}</span>
                </button>
              </div>
              
              {isConfigLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="ml-2 text-gray-600 dark:text-gray-400">加载配置中...</span>
                </div>
              ) : configSchema ? (
                <div className="space-y-6" key={`config-form-${selectedInstance}-${selectedConfigId}`}>
                  {/* 动态渲染配置表单 - 按sections分组 */}
                  {(Array.isArray(configSchema.sections) ? configSchema.sections : Object.entries(configSchema.sections || {})).map((sectionData: any, sectionIndex: number) => {
                    // 处理数组格式和对象格式的sections
                    const section = Array.isArray(configSchema.sections) ? sectionData : sectionData[1]
                    // 使用严格判断，确保空字符串不会被替换成 'default'
                    const sectionKey = Array.isArray(configSchema.sections) ? (section.key !== undefined && section.key !== null ? section.key : 'default') : sectionData[0]
                    
                    return (
                    <div key={sectionKey || sectionIndex} className="space-y-4">
                      {/* Section标题 */}
                      {sectionKey && (
                        <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                          <h4 className="text-md font-medium text-gray-900 dark:text-white">
                            {section.display_name || sectionKey}
                          </h4>
                          {section.description && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              {section.description}
                            </p>
                          )}
                        </div>
                      )}
                      
                      {/* Section字段 */}
                      <div className="space-y-4 pl-4">
                        {section.fields?.map((field: any, fieldIndex: number) => {
                          const fieldValue = getNestedValue(configData, sectionKey, field.name)
                          
                          return (
                            <div key={field.name || fieldIndex} className="space-y-2">
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                {field.display || field.name}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                              </label>
                              
                              {field.description && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {field.description}
                                </p>
                              )}
                              
                              {field.type === 'string' && (
                                <input
                                  type="text"
                                  value={fieldValue !== undefined && fieldValue !== null ? fieldValue : (field.default || '')}
                                  onChange={(e) => handleConfigDataChange(e.target.value, sectionKey, field.name)}
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="请输入值"
                                />
                              )}
                              
                              {(field.type === 'integer' || field.type === 'number') && (
                                <input
                                  type="number"
                                  value={fieldValue !== undefined && fieldValue !== null ? fieldValue.toString() : (field.default !== undefined ? field.default.toString() : '')}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    if (value === '') {
                                      handleConfigDataChange(field.default !== undefined ? field.default : (field.type === 'integer' ? 0 : 0.0), sectionKey, field.name)
                                    } else {
                                      const numValue = field.type === 'integer' ? parseInt(value) : parseFloat(value)
                                      handleConfigDataChange(isNaN(numValue) ? (field.default !== undefined ? field.default : (field.type === 'integer' ? 0 : 0.0)) : numValue, sectionKey, field.name)
                                    }
                                  }}
                                  step={field.type === 'integer' ? '1' : 'any'}
                                  min={field.min}
                                  max={field.max}
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="请输入数值"
                                />
                              )}
                              
                              {field.type === 'boolean' && (
                                <div className="flex items-center space-x-3">
                                  <label className="flex items-center cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={fieldValue !== undefined ? Boolean(fieldValue) : Boolean(field.default)}
                                      onChange={(e) => {
                                        handleConfigDataChange(e.target.checked, sectionKey, field.name)
                                      }}
                                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                                      {fieldValue !== undefined ? Boolean(fieldValue) : Boolean(field.default) ? '启用' : '禁用'}
                                    </span>
                                  </label>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    当前值: {fieldValue !== undefined ? (Boolean(fieldValue) ? 'true' : 'false') : (Boolean(field.default) ? 'true' : 'false')}
                                  </span>
                                </div>
                              )}
                              
                              {(field.type === 'enum' || field.type === 'select') && (
                                <select
                                  value={fieldValue !== undefined && fieldValue !== null ? fieldValue : (field.default || '')}
                                  onChange={(e) => handleConfigDataChange(e.target.value, sectionKey, field.name)}
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                  <option value="">请选择</option>
                                  {field.options?.map((option: any) => {
                                    // 支持两种格式：字符串数组和对象数组
                                    if (typeof option === 'string') {
                                      return (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      )
                                    } else if (option && typeof option === 'object' && option.value) {
                                      return (
                                        <option key={option.value} value={option.value}>
                                          {option.label || option.value}
                                        </option>
                                      )
                                    }
                                    return null
                                  })}
                                </select>
                              )}
                              
                              {(field.type === 'float' || field.type === 'double') && (
                                <input
                                  type="number"
                                  value={fieldValue !== undefined && fieldValue !== null ? fieldValue.toString() : (field.default !== undefined ? field.default.toString() : '')}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    if (value === '') {
                                      handleConfigDataChange(field.default !== undefined ? field.default : 0.0, sectionKey, field.name)
                                    } else {
                                      const numValue = parseFloat(value)
                                      handleConfigDataChange(isNaN(numValue) ? (field.default !== undefined ? field.default : 0.0) : numValue, sectionKey, field.name)
                                    }
                                  }}
                                  step="any"
                                  min={field.min}
                                  max={field.max}
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="请输入小数值"
                                />
                              )}
                              
                              {/* 默认处理未知类型为文本输入 */}
                              {field.type === 'nested' && field.nested_fields && (
                                <div className="space-y-4 pl-4 border-l-2 border-gray-200 dark:border-gray-600">
                                  <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                                    嵌套配置项:
                                  </p>
                                  {field.nested_fields.map((nestedField: any, nestedIndex: number) => {
                                    const nestedFieldValue = getNestedValue(configData, sectionKey, field.name, nestedField.name)
                                    
                                    return (
                                      <div key={nestedField.name || nestedIndex} className="space-y-2">
                                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">
                                          {nestedField.display || nestedField.name}
                                          {nestedField.required && <span className="text-red-500 ml-1">*</span>}
                                        </label>
                                        
                                        {nestedField.description && (
                                          <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {nestedField.description}
                                          </p>
                                        )}
                                        
                                        {nestedField.type === 'string' && (
                                          <input
                                            type="text"
                                            value={nestedFieldValue !== undefined && nestedFieldValue !== null ? nestedFieldValue : (nestedField.default || '')}
                                            onChange={(e) => handleConfigDataChange(e.target.value, sectionKey, field.name, nestedField.name)}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder="请输入值"
                                          />
                                        )}
                                        
                                        {(nestedField.type === 'integer' || nestedField.type === 'number') && (
                                          <input
                                            type="number"
                                            value={nestedFieldValue !== undefined && nestedFieldValue !== null ? nestedFieldValue.toString() : (nestedField.default !== undefined ? nestedField.default.toString() : '')}
                                            onChange={(e) => {
                                              const value = e.target.value
                                              if (value === '') {
                                                handleConfigDataChange(nestedField.default !== undefined ? nestedField.default : (nestedField.type === 'integer' ? 0 : 0.0), sectionKey, field.name, nestedField.name)
                                              } else {
                                                const numValue = nestedField.type === 'integer' ? parseInt(value) : parseFloat(value)
                                                handleConfigDataChange(isNaN(numValue) ? (nestedField.default !== undefined ? nestedField.default : (nestedField.type === 'integer' ? 0 : 0.0)) : numValue, sectionKey, field.name, nestedField.name)
                                              }
                                            }}
                                            step={nestedField.type === 'integer' ? '1' : 'any'}
                                            min={nestedField.min}
                                            max={nestedField.max}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder="请输入数值"
                                          />
                                        )}
                                        
                                        {nestedField.type === 'boolean' && (
                                          <div className="flex items-center space-x-3">
                                            <label className="flex items-center cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={nestedFieldValue !== undefined ? Boolean(nestedFieldValue) : Boolean(nestedField.default)}
                                                onChange={(e) => {
                                                  handleConfigDataChange(e.target.checked, sectionKey, field.name, nestedField.name)
                                                }}
                                                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                              />
                                              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                                                {nestedFieldValue !== undefined ? Boolean(nestedFieldValue) : Boolean(nestedField.default) ? '启用' : '禁用'}
                                              </span>
                                            </label>
                                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                              当前值: {nestedFieldValue !== undefined ? (Boolean(nestedFieldValue) ? 'true' : 'false') : (Boolean(nestedField.default) ? 'true' : 'false')}
                                            </span>
                                          </div>
                                        )}
                                        
                                        {(nestedField.type === 'enum' || nestedField.type === 'select') && (
                                          <select
                                            value={nestedFieldValue !== undefined && nestedFieldValue !== null ? nestedFieldValue : (nestedField.default || '')}
                                            onChange={(e) => handleConfigDataChange(e.target.value, sectionKey, field.name, nestedField.name)}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                          >
                                            <option value="">请选择</option>
                                            {nestedField.options?.map((option: any) => {
                                              if (typeof option === 'string') {
                                                return (
                                                  <option key={option} value={option}>
                                                    {option}
                                                  </option>
                                                )
                                              } else if (option && typeof option === 'object' && option.value) {
                                                return (
                                                  <option key={option.value} value={option.value}>
                                                    {option.label || option.value}
                                                  </option>
                                                )
                                              }
                                              return null
                                            })}
                                          </select>
                                        )}
                                        
                                        {(nestedField.type === 'float' || nestedField.type === 'double') && (
                                          <input
                                            type="number"
                                            value={nestedFieldValue !== undefined && nestedFieldValue !== null ? nestedFieldValue.toString() : (nestedField.default !== undefined ? nestedField.default.toString() : '')}
                                            onChange={(e) => {
                                              const value = e.target.value
                                              if (value === '') {
                                                handleConfigDataChange(nestedField.default !== undefined ? nestedField.default : 0.0, sectionKey, field.name, nestedField.name)
                                              } else {
                                                const numValue = parseFloat(value)
                                                handleConfigDataChange(isNaN(numValue) ? (nestedField.default !== undefined ? nestedField.default : 0.0) : numValue, sectionKey, field.name, nestedField.name)
                                              }
                                            }}
                                            step="any"
                                            min={nestedField.min}
                                            max={nestedField.max}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder="请输入小数值"
                                          />
                                        )}
                                        
                                        {/* 嵌套字段的默认处理 */}
                                        {!['string', 'integer', 'number', 'boolean', 'enum', 'select', 'float', 'double'].includes(nestedField.type) && (
                                          <div className="space-y-2">
                                            <input
                                              type="text"
                                              value={nestedFieldValue !== undefined && nestedFieldValue !== null ? nestedFieldValue.toString() : (nestedField.default !== undefined ? nestedField.default.toString() : '')}
                                              onChange={(e) => handleConfigDataChange(e.target.value, sectionKey, field.name, nestedField.name)}
                                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                              placeholder="请输入值"
                                            />
                                            <p className="text-xs text-yellow-600 dark:text-yellow-400">
                                              未知类型 '{nestedField.type}' - 作为文本处理
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                              
                               {!['string', 'integer', 'number', 'boolean', 'enum', 'select', 'float', 'double', 'nested'].includes(field.type) && (
                                <div className="space-y-2">
                                  <input
                                    type="text"
                                    value={fieldValue !== undefined && fieldValue !== null ? fieldValue.toString() : (field.default !== undefined ? field.default.toString() : '')}
                                    onChange={(e) => handleConfigDataChange(e.target.value, sectionKey, field.name)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="请输入值"
                                  />
                                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                                    未知类型 '{field.type}' - 作为文本处理
                                  </p>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Settings className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400">
                    请选择实例和配置文件开始编辑
                  </p>
                </div>
              )}
            </div>
          )}
          
          {/* 空状态 */}
          {(!selectedInstance || !selectedConfigId) && (
            <div className="text-center py-12">
              <Settings className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                游戏配置文件管理
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                选择实例和配置文件来开始可视化编辑游戏配置
              </p>
            </div>
          )}
        </div>
      ) : activeTab === 'rcon' ? (
        <RconConsole />
      ) : activeTab === 'backup' ? (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">备份列表</h3>
            {loadingBackups ? (
              <div className="flex items-center justify-center h-64">
                <Loader className="w-8 h-8 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">加载备份中...</span>
              </div>
            ) : backups.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">暂无备份</h3>
                <p className="text-gray-600 dark:text-gray-400">请先通过定时任务创建文件夹备份</p>
              </div>
            ) : (
              <div className="space-y-6">
                {backups.map((b) => (
                  <div key={b.name} className="bg-white dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between">
                      <div className="cursor-pointer" onClick={() => setExpandedBackup(prev => prev === b.name ? null : b.name)}>
                        <h4 className="text-md font-semibold text-gray-900 dark:text-white">{b.name}</h4>
                        {b.meta?.sourcePath && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">源路径: {b.meta.sourcePath}</p>
                        )}
                        <p className="text-sm text-gray-500 dark:text-gray-400">总大小: {formatFileSize(b.files.reduce((sum, file) => sum + file.size, 0))} • {b.files.length} 个文件</p>
                      </div>
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => setExpandedBackup(prev => prev === b.name ? null : b.name)}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {expandedBackup === b.name ? '收起' : '展开'}
                        </button>
                        <button
                          onClick={async () => {
                            const ok = confirm('确认删除整个备份文件夹及其所有文件吗？该操作不可恢复。')
                            if (!ok) return
                            try {
                              const resp = await apiClient.deleteBackupFolder(b.name)
                              if (resp.success) {
                                addNotification({ type: 'success', title: '删除成功', message: '备份文件夹已删除' })
                                loadBackups()
                              } else {
                                throw new Error(resp.message || '删除失败')
                              }
                            } catch (e: any) {
                              addNotification({ type: 'error', title: '删除失败', message: e.message || '删除失败' })
                            }
                          }}
                          className="text-red-600 dark:text-red-400 hover:underline"
                        >
                          删除备份
                        </button>
                      </div>
                    </div>
                    {expandedBackup === b.name && (
                      <div className="space-y-2 mt-3">
                        {b.files.length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400">暂无备份文件</p>
                        ) : (
                          b.files.map(f => (
                            <div key={f.fileName} className="flex items-center justify-between p-2 bg-white/60 dark:bg-gray-800/60 rounded">
                              <div>
                                <p className="text-sm text-gray-900 dark:text-white">{f.fileName}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(f.modified).toLocaleString()} • {(f.size/1024/1024).toFixed(2)} MB</p>
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => setRestoreDialog({ visible: true, backupName: b.name, fileName: f.fileName, sourcePath: b.meta?.sourcePath })}
                                  className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                >
                                  恢复
                                </button>
                                <button
                                  onClick={() => handleDeleteBackupFile(b.name, f.fileName)}
                                  className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* 备份提醒信息 */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                  备份功能提醒
                </h4>
                <p className="text-sm text-yellow-700 dark:text-yellow-400">
                  面板侧备份是通过压缩方式实现，可能会受到文件读写和IO限制可能存在备份不全或备份文件损坏问题，若服务端侧有相关备份功能强烈建议通过服务端侧实现更稳妥！
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 恢复备份确认弹窗 */}
      <ConfirmDialog
        visible={Boolean(restoreDialog?.visible)}
        title="恢复备份确认"
        message={`将把所选备份解压到原路径：${restoreDialog?.sourcePath || '未知路径'}。恢复过程会覆盖目标路径中的同名文件，请确认已做好重要数据的额外备份和关闭服务端释放文件。`}
        confirmText="确认恢复"
        cancelText="取消"
        type="warning"
        onConfirm={() => {
          if (restoreDialog) {
            handleRestoreBackup(restoreDialog.backupName, restoreDialog.fileName)
          }
          setRestoreDialog(null)
        }}
        onCancel={() => setRestoreDialog(null)}
      />

      {/* 创建/编辑实例模态框 */}
      {showCreateModal && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity duration-300 ${
          createModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto transform transition-all duration-300 ${
            createModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              {editingInstance ? '编辑实例' : '创建实例'}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  实例名称 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入实例名称"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  实例描述
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入实例描述"
                  rows={3}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  工作目录 *
                </label>
                <input
                  type="text"
                  value={formData.workingDirectory}
                  onChange={(e) => setFormData({ ...formData, workingDirectory: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入工作目录路径"
                />
              </div>
              
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    启动命令 *
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenStartCommandHelpModal}
                    className="p-1 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                    title="查看启动命令帮助"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={formData.startCommand}
                  onChange={(e) => setFormData({ ...formData, startCommand: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入启动命令"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  停止命令
                </label>
                <select
                  value={formData.stopCommand}
                  onChange={(e) => setFormData({ ...formData, stopCommand: e.target.value as 'ctrl+c' | 'stop' | 'exit' | 'quit' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="ctrl+c">Ctrl+C</option>
                  <option value="stop">stop</option>
                  <option value="exit">exit</option>
                  <option value="quit">quit</option>
                </select>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="autoStart"
                  checked={formData.autoStart}
                  onChange={(e) => setFormData({ ...formData, autoStart: e.target.checked })}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <label htmlFor="autoStart" className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  自动启动
                </label>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="enableStreamForward"
                  checked={formData.enableStreamForward}
                  onChange={(e) => setFormData({ ...formData, enableStreamForward: e.target.checked })}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <label htmlFor="enableStreamForward" className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  启用输出流转发(仅Windows)
                </label>
              </div>
              
              {formData.enableStreamForward && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    程序启动命令 *
                  </label>
                  <input
                    type="text"
                    value={formData.programPath}
                    onChange={(e) => setFormData({ ...formData, programPath: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={'"C:\\Program Files\\MyApp\\app.exe" arg1 arg2'}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    可以输入包含参数的完整命令行，如果路径包含空格请使用引号包围
                  </p>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  终端用户
                </label>
                <select
                  value={formData.terminalUser}
                  onChange={(e) => setFormData({ ...formData, terminalUser: e.target.value })}
                  onMouseDown={(e) => {
                    if (loadingUsers) {
                      e.preventDefault()
                      e.stopPropagation()
                      addNotification({
                        type: 'info',
                        title: '请稍候',
                        message: '正在加载系统用户列表...'
                      })
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">默认用户</option>
                  {systemUsers.map(user => (
                    <option key={user} value={user}>{user}</option>
                  ))}
                </select>
                {loadingUsers && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    正在加载用户列表...
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  选择以指定用户身份启动终端，留空则使用默认用户
                </p>
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseCreateModal}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                取消
              </button>
              <button
                onClick={editingInstance ? handleUpdateInstance : handleCreateInstance}
                disabled={!formData.name || !formData.workingDirectory || !formData.startCommand || (formData.enableStreamForward && !formData.programPath)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {editingInstance ? '更新' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 安装实例模态框 */}
      {showInstallModal && selectedMarketInstance && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity duration-300 ${
          installModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 transform transition-all duration-300 ${
            installModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              安装实例: {selectedMarketInstance.name}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  实例名称
                </label>
                <input
                  type="text"
                  value={selectedMarketInstance.name}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400"
                />
              </div>
              
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    启动命令
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenStartCommandHelpModal}
                    className="p-1 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                    title="查看启动命令帮助"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={selectedMarketInstance.command}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  停止命令
                </label>
                <input
                  type="text"
                  value={selectedMarketInstance.stopcommand}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  运行目录 *
                </label>
                <input
                  type="text"
                  value={installFormData.workingDirectory}
                  onChange={(e) => setInstallFormData({ workingDirectory: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请输入实例的运行目录路径"
                />
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseInstallModal}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleInstallMarketInstance}
                disabled={!installFormData.workingDirectory}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                安装
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建配置文件对话框 */}
      <CreateConfigDialog
        isOpen={showCreateConfigDialog}
        instanceName={createConfigInfo?.instanceName || ''}
        gameName={createConfigInfo?.configId || ''}
        configPath={createConfigInfo?.configPath || ''}
        onConfirm={handleCreateConfigConfirm}
        onCancel={handleCreateConfigCancel}
      />

      {/* 删除确认对话框 */}
      <ConfirmDeleteDialog
        isOpen={showDeleteDialog}
        instanceName={instanceToDelete?.name || ''}
        workingDirectory={instanceToDelete?.workingDirectory || ''}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* 启动确认对话框 */}
      <ConfirmStartDialog
        isOpen={showStartConfirmDialog}
        instanceName={instanceToStart?.name || ''}
        startCommand={instanceToStart?.startCommand || ''}
        onConfirm={handleConfirmStart}
        onCancel={handleCancelStart}
      />

      {/* 启动命令帮助模态框 */}
      {showStartCommandHelpModal && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          startCommandHelpModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 transform transition-all duration-300 ${
            startCommandHelpModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                <HelpCircle className="w-5 h-5 text-blue-500" />
                <span>启动命令帮助</span>
              </h3>
              <button
                onClick={handleCloseStartCommandHelpModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h4 className="text-md font-semibold text-blue-800 dark:text-blue-200 mb-2">💡 基本说明</h4>
                  <p className="text-blue-700 dark:text-blue-300 text-sm leading-relaxed">
                    执行脚本或二进制文件：Windows使用反斜杠<code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">.\</code> Linux使用正斜杠<code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">./</code>
                  </p>
                </div>

                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <h4 className="text-md font-semibold text-green-800 dark:text-green-200 mb-2">🚀 启动流程</h4>
                  <p className="text-green-700 dark:text-green-300 text-sm leading-relaxed">
                    启动后面板将会在您填写的工作目录下创建终端并执行您预先设置好的启动命令进行启动，若有问题您可以看到原生报错输出。
                  </p>
                </div>

                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <h4 className="text-md font-semibold text-yellow-800 dark:text-yellow-200 mb-2">⚠️ 特别提醒</h4>
                  <p className="text-yellow-700 dark:text-yellow-300 text-sm leading-relaxed">
                    若您是在游戏部署中的steamcmd部署的游戏，在安装时面板已经默认填写了实例市场的启动命令，这些命令是经过人工验证可以开服的，您一般不需要修改，保持默认即可。
                  </p>
                  <p className="text-yellow-700 dark:text-yellow-300 text-sm leading-relaxed mt-2">
                    若您发现是none则代表无启动命令，可能是此游戏目前人工没有测试出来的启动命令，您需要自行花费时间摸索和搜寻。
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseStartCommandHelpModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>我知道了</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default InstanceManagerPage