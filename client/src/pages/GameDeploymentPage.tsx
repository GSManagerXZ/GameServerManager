import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download,
  Server,
  ExternalLink,
  FolderOpen,
  Play,
  X,
  Loader,
  Pickaxe,
  CheckCircle,
  AlertCircle,
  Plus,
  Package,
  BookOpen,
  RefreshCw,
  HelpCircle,
  Cloud,
  Archive
} from 'lucide-react'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSystemStore } from '@/stores/systemStore'
import apiClient from '@/utils/api'
import { MinecraftServerCategory, MinecraftDownloadOptions, MinecraftDownloadProgress, MoreGameInfo, Platform } from '@/types'
import { io, Socket } from 'socket.io-client'
import config from '@/config'
import { useDefaultGamePath, useGameInstallPath } from '@/hooks/useDefaultGamePath'
import CloudProviderModal from '@/components/CloudProviderModal'
import ConfirmInstanceUpdateDialog from '@/components/ConfirmInstanceUpdateDialog'
import NetworkStatusBanner from '@/components/NetworkStatusBanner'

interface GameInfo {
  game_nameCN: string
  appid: string
  tip: string
  image: string
  url: string
  docs?: string
  system?: string[]
  supportedOnCurrentPlatform?: boolean
  currentPlatform?: string
  panelCompatibleOnCurrentPlatform?: boolean
  cloud?: {
    [providerName: string]: {
      [logoUrl: string]: string
    }
  }
}

interface Games {
  [key: string]: GameInfo
}



const GameDeploymentPage: React.FC = () => {
  const { addNotification } = useNotificationStore()
  const { systemInfo, fetchSystemInfo } = useSystemStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('steamcmd')

  // 获取默认游戏路径
  const { path: defaultGamePath } = useDefaultGamePath()

  // 生成带游戏名称的完整路径的函数
  const generatePath = (gameName: string) => {
    if (!defaultGamePath || !gameName) return defaultGamePath

    // 清理游戏名称，移除特殊字符
    const cleanName = gameName.replace(/[<>:"|?*]/g, '').trim()

    // 根据平台使用正确的路径分隔符
    const isWindows = process.platform === 'win32'
    const separator = isWindows ? '\\' : '/'

    // 确保默认路径以分隔符结尾
    const basePath = defaultGamePath.endsWith(separator) || defaultGamePath.endsWith('/') || defaultGamePath.endsWith('\\')
      ? defaultGamePath
      : defaultGamePath + separator

    return basePath + cleanName
  }

  // 生成Minecraft服务端路径的函数
  const generateMinecraftPath = (serverType: string, version: string) => {
    if (!defaultGamePath || !serverType || !version) return defaultGamePath

    // 清理服务端名称和版本，移除特殊字符
    const cleanServerType = serverType.replace(/[<>:"|?*]/g, '').trim()
    const cleanVersion = version.replace(/[<>:"|?*]/g, '').trim()

    // 组合文件夹名称：服务端名称+Minecraft版本
    const folderName = `${cleanServerType}-${cleanVersion}`

    // 根据平台使用正确的路径分隔符
    const isWindows = process.platform === 'win32'
    const separator = isWindows ? '\\' : '/'

    // 确保默认路径以分隔符结尾
    const basePath = defaultGamePath.endsWith(separator) || defaultGamePath.endsWith('/') || defaultGamePath.endsWith('\\')
      ? defaultGamePath
      : defaultGamePath + separator

    return basePath + folderName
  }

  // 当默认路径加载完成后，填充到各个路径字段
  useEffect(() => {
    if (defaultGamePath) {
      // 使用setTimeout确保在下一个事件循环中执行，避免状态更新冲突
      setTimeout(() => {
        // Minecraft和整合包的路径将在用户选择后自动生成，不设置默认值
        setMoreGameInstallPath(prev => prev || defaultGamePath)
        setOnlineGameInstallPath(prev => prev || defaultGamePath)
        setCloudBuildPath(prev => prev || defaultGamePath)
      }, 0)
    }
  }, [defaultGamePath])
  const [games, setGames] = useState<Games>({})
  const [loading, setLoading] = useState(true)
  const [gameListError, setGameListError] = useState<string | null>(null)
  const [updatingGameList, setUpdatingGameList] = useState(false)
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [installModalAnimating, setInstallModalAnimating] = useState(false)
  const [selectedGame, setSelectedGame] = useState<{ key: string; info: GameInfo } | null>(null)
  const [installPath, setInstallPath] = useState('')
  const [installing, setInstalling] = useState(false)
  const [checkingEnvironment, setCheckingEnvironment] = useState<string | null>(null) // 正在检测环境的游戏key
  const [useAnonymous, setUseAnonymous] = useState(true)
  const [steamUsername, setSteamUsername] = useState('')
  const [steamPassword, setSteamPassword] = useState('')
  const [validateGameIntegrity, setValidateGameIntegrity] = useState(false)
  
  // 实例更新确认弹窗相关状态
  const [showInstanceUpdateDialog, setShowInstanceUpdateDialog] = useState(false)
  const [instanceUpdateDialogAnimating, setInstanceUpdateDialogAnimating] = useState(false)
  const [existingInstanceId, setExistingInstanceId] = useState<string | null>(null)
  const [updateInstanceInfo, setUpdateInstanceInfo] = useState(false)

  // 平台筛选状态
  const [platformFilter, setPlatformFilter] = useState<string>('all') // 'all', 'compatible', 'Windows', 'Linux', 'macOS'
  const [searchQuery, setSearchQuery] = useState('')

  // Minecraft相关状态
  const [minecraftCategories, setMinecraftCategories] = useState<MinecraftServerCategory[]>([])
  const [minecraftLoading, setMinecraftLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedServer, setSelectedServer] = useState<string>('')
  const [availableVersions, setAvailableVersions] = useState<string[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string>('')
  const [minecraftInstallPath, setMinecraftInstallPath] = useState('')
  const [skipJavaCheck, setSkipJavaCheck] = useState(false)
  const [skipServerRun, setSkipServerRun] = useState(false)
  const [minecraftDownloading, setMinecraftDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<MinecraftDownloadProgress | null>(null)
  const [javaValidated, setJavaValidated] = useState<boolean | null>(null)
  const [downloadLogs, setDownloadLogs] = useState<string[]>([])
  const [downloadComplete, setDownloadComplete] = useState(false)
  const [downloadResult, setDownloadResult] = useState<any>(null)
  const [showCreateInstanceModal, setShowCreateInstanceModal] = useState(false)
  const [createInstanceModalAnimating, setCreateInstanceModalAnimating] = useState(false)
  
  // 云服务商弹窗相关状态
  const [showCloudProviderModal, setShowCloudProviderModal] = useState(false)
  const [selectedGameForCloud, setSelectedGameForCloud] = useState<{ key: string; info: GameInfo } | null>(null)
  const [instanceName, setInstanceName] = useState('')
  const [instanceDescription, setInstanceDescription] = useState('')
  const [instanceStartCommand, setInstanceStartCommand] = useState('')
  const [creatingInstance, setCreatingInstance] = useState(false)

  // 更多游戏部署相关状态
  const [moreGames, setMoreGames] = useState<MoreGameInfo[]>([])
  const [moreGamesLoading, setMoreGamesLoading] = useState(false)
  const [selectedMoreGame, setSelectedMoreGame] = useState<string>('')
  const [moreGameInstallPath, setMoreGameInstallPath] = useState('')
  const [moreGameDeploying, setMoreGameDeploying] = useState(false)
  const [moreGameDeployResult, setMoreGameDeployResult] = useState<any>(null)
  const [moreGameDeployProgress, setMoreGameDeployProgress] = useState<any>(null)
  const [moreGameDeployLogs, setMoreGameDeployLogs] = useState<string[]>([])
  const [moreGameDeployComplete, setMoreGameDeployComplete] = useState(false)

  // Minecraft整合包部署相关状态
  const [mrpackSearchQuery, setMrpackSearchQuery] = useState('')
  const [mrpackSearchResults, setMrpackSearchResults] = useState<any[]>([])
  const [mrpackSearchLoading, setMrpackSearchLoading] = useState(false)
  const [selectedMrpack, setSelectedMrpack] = useState<any>(null)
  const [mrpackVersions, setMrpackVersions] = useState<any[]>([])
  const [mrpackVersionsLoading, setMrpackVersionsLoading] = useState(false)
  const [selectedMrpackVersion, setSelectedMrpackVersion] = useState<any>(null)
  const [mrpackInstallPath, setMrpackInstallPath] = useState('')
  const [mrpackDeploying, setMrpackDeploying] = useState(false)
  const [mrpackDeployResult, setMrpackDeployResult] = useState<any>(null)
  const [mrpackDeployProgress, setMrpackDeployProgress] = useState<any>(null)
  const [mrpackDeployLogs, setMrpackDeployLogs] = useState<string[]>([])
  const [mrpackDeployComplete, setMrpackDeployComplete] = useState(false)

  // 整合包悬停详情状态
  const [hoveredMrpack, setHoveredMrpack] = useState<string | null>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 创建整合包实例相关状态
  const [showCreateMrpackInstanceModal, setShowCreateMrpackInstanceModal] = useState(false)
  const [createMrpackInstanceModalAnimating, setCreateMrpackInstanceModalAnimating] = useState(false)
  const [mrpackInstanceName, setMrpackInstanceName] = useState('')
  const [mrpackInstanceDescription, setMrpackInstanceDescription] = useState('')
  const [mrpackInstanceStartCommand, setMrpackInstanceStartCommand] = useState('')
  const [creatingMrpackInstance, setCreatingMrpackInstance] = useState(false)

  // 在线部署相关状态
  const [onlineGames, setOnlineGames] = useState<any[]>([])
  const [onlineGamesLoading, setOnlineGamesLoading] = useState(false)
  const [sponsorKeyValid, setSponsorKeyValid] = useState<boolean | null>(null)
  const [sponsorKeyChecking, setSponsorKeyChecking] = useState(false)
  const [selectedOnlineGame, setSelectedOnlineGame] = useState<any>(null)
  const [onlineGameInstallPath, setOnlineGameInstallPath] = useState('')
  const [onlineGameDeploying, setOnlineGameDeploying] = useState(false)
  const [onlineGameDeployProgress, setOnlineGameDeployProgress] = useState<any>(null)
  const [onlineGameDeployLogs, setOnlineGameDeployLogs] = useState<string[]>([])
  const [onlineGameDeployComplete, setOnlineGameDeployComplete] = useState(false)
  const [onlineGameDeployResult, setOnlineGameDeployResult] = useState<any>(null)
  const [showOnlineGameInstallModal, setShowOnlineGameInstallModal] = useState(false)
  const [onlineGameInstallModalAnimating, setOnlineGameInstallModalAnimating] = useState(false)

  // 在线部署筛选相关状态
  const [onlineGameTypeFilter, setOnlineGameTypeFilter] = useState<string>('all')
  const [onlineGameSearchQuery, setOnlineGameSearchQuery] = useState('')

  // 面板兼容性确认对话框状态
  const [showCompatibilityModal, setShowCompatibilityModal] = useState(false)
  const [compatibilityModalAnimating, setCompatibilityModalAnimating] = useState(false)
  const [pendingGameInstall, setPendingGameInstall] = useState<{ key: string; info: GameInfo } | null>(null)

  // 内存警告对话框状态
  const [showMemoryWarningModal, setShowMemoryWarningModal] = useState(false)
  const [memoryWarningModalAnimating, setMemoryWarningModalAnimating] = useState(false)
  const [memoryWarningInfo, setMemoryWarningInfo] = useState<{
    required: number
    available: number
    message: string
    gameKey: string
    gameInfo: GameInfo
  } | null>(null)

  // 开服文档相关状态
  const [showDocsModal, setShowDocsModal] = useState(false)
  const [docsModalAnimating, setDocsModalAnimating] = useState(false)
  const [selectedGameDocs, setSelectedGameDocs] = useState<GameInfo | null>(null)

  // Java环境相关状态
  const [javaEnvironments, setJavaEnvironments] = useState<any[]>([])
  const [javaEnvironmentsLoading, setJavaEnvironmentsLoading] = useState(false)
  const [selectedMinecraftJava, setSelectedMinecraftJava] = useState<string>(() => {
    // 从localStorage读取保存的选择
    return localStorage.getItem('selectedMinecraftJava') || 'default'
  })
  const [selectedMrpackJava, setSelectedMrpackJava] = useState<string>(() => {
    // 从localStorage读取保存的选择
    return localStorage.getItem('selectedMrpackJava') || 'default'
  })

  // 帮助模态框相关状态
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [helpModalAnimating, setHelpModalAnimating] = useState(false)

  // 云构建部署相关状态
  const [cloudBuildType, setCloudBuildType] = useState('msl_Official')
  const [cloudBuildCores, setCloudBuildCores] = useState<any[]>([])
  const [cloudBuildCoresLoading, setCloudBuildCoresLoading] = useState(false)
  const [selectedCloudCore, setSelectedCloudCore] = useState<any>(null)
  const [selectedCloudVersion, setSelectedCloudVersion] = useState<string>('')
  const [cloudBuildPath, setCloudBuildPath] = useState('')
  const [cloudBuildStats, setCloudBuildStats] = useState<any>(null)
  const [buildingCloud, setBuildingCloud] = useState(false)
  const [cloudBuildTask, setCloudBuildTask] = useState<any>(null)
  const [cloudBuildProgress, setCloudBuildProgress] = useState<number>(0)
  const [cloudBuildLogs, setCloudBuildLogs] = useState<string[]>([])
  const [cloudBuildComplete, setCloudBuildComplete] = useState(false)
  const [cloudBuildResult, setCloudBuildResult] = useState<any>(null)
  const [showCreateCloudInstanceModal, setShowCreateCloudInstanceModal] = useState(false)
  const [createCloudInstanceModalAnimating, setCreateCloudInstanceModalAnimating] = useState(false)
  const [cloudInstanceName, setCloudInstanceName] = useState('')
  const [cloudInstanceDescription, setCloudInstanceDescription] = useState('')
  const [cloudInstanceStartCommand, setCloudInstanceStartCommand] = useState('')
  const [creatingCloudInstance, setCreatingCloudInstance] = useState(false)

  // SteamCMD高级选项
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [steamcmdCommand, setSteamcmdCommand] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const currentDownloadId = useRef<string | null>(null)
  const currentMoreGameDeploymentId = useRef<string | null>(null)
  const currentMrpackDeploymentId = useRef<string | null>(null)
  const currentOnlineGameDeploymentId = useRef<string | null>(null)

  // 获取游戏列表
  const fetchGames = async () => {
    try {
      setLoading(true)
      setGameListError(null)
      const response = await apiClient.getInstallableGames()

      if (response.success) {
        setGames(response.data || {})
      } else {
        throw new Error(response.message || '获取游戏列表失败')
      }
    } catch (error: any) {
      console.error('获取游戏列表失败:', error)
      setGameListError(error.message || '无法获取游戏列表')

      // 如果错误信息包含"无法找到 installgame.json 文件"，自动尝试更新游戏清单
      if (error.message && error.message.includes('无法找到 installgame.json 文件')) {
        addNotification({
          type: 'info',
          title: '正在更新',
          message: '检测到游戏清单文件缺失，正在自动更新...'
        })

        try {
          setUpdatingGameList(true)
          const updateResponse = await apiClient.updateSteamGameList()

          if (updateResponse.success) {
            addNotification({
              type: 'success',
              title: '更新成功',
              message: `游戏部署清单已更新，共${updateResponse.data?.gameCount || 0}个游戏`
            })

            // 重新获取游戏列表
            setTimeout(() => {
              fetchGames()
            }, 1000)
            return
          } else {
            throw new Error(updateResponse.message || '更新游戏部署清单失败')
          }
        } catch (updateError: any) {
          console.error('自动更新游戏清单失败:', updateError)
          addNotification({
            type: 'error',
            title: '自动更新失败',
            message: updateError.message || '无法自动更新游戏清单，请手动更新'
          })
        } finally {
          setUpdatingGameList(false)
        }
      } else {
        addNotification({
          type: 'error',
          title: '获取失败',
          message: error.message || '无法获取游戏列表'
        })
      }
    } finally {
      setLoading(false)
    }
  }

  // 获取更多游戏列表
  const fetchMoreGames = async () => {
    try {
      setMoreGamesLoading(true)
      const response = await apiClient.getMoreGames()

      if (response.success) {
        setMoreGames(response.data || [])
      } else {
        throw new Error(response.message || '获取更多游戏列表失败')
      }
    } catch (error: any) {
      console.error('获取更多游戏列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: error.message || '无法获取更多游戏列表'
      })
    } finally {
      setMoreGamesLoading(false)
    }
  }

  // 检查赞助者密钥
  const checkSponsorKey = async () => {
    try {
      setSponsorKeyChecking(true)
      const response = await apiClient.getSponsorKeyInfo()

      if (response.success && response.data) {
        setSponsorKeyValid(response.data.isValid)
        if (!response.data.isValid) {
          addNotification({
            type: 'warning',
            title: '密钥已过期',
            message: '您的赞助者密钥已过期，请前往设置页面更新密钥'
          })
        }
      } else {
        setSponsorKeyValid(false)
      }
    } catch (error: any) {
      console.error('检查赞助者密钥失败:', error)
      setSponsorKeyValid(false)
    } finally {
      setSponsorKeyChecking(false)
    }
  }

  // 获取云构建核心列表
  const fetchCloudBuildCores = async () => {
    try {
      setCloudBuildCoresLoading(true)
      const response = await apiClient.getCloudBuildCores(cloudBuildType)

      if (response.success && response.data) {
        setCloudBuildCores(response.data)
      } else {
        addNotification({
          type: 'error',
          title: '获取核心列表失败',
          message: response.message || '无法获取可用的服务端核心列表'
        })
      }
    } catch (error: any) {
      console.error('获取云构建核心列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取核心列表失败',
        message: error.message || '网络请求失败'
      })
    } finally {
      setCloudBuildCoresLoading(false)
    }
  }

  // 获取云构建统计数据
  const fetchCloudBuildStats = async () => {
    try {
      const response = await apiClient.getCloudBuildStats()
      if (response.success && response.data) {
        setCloudBuildStats(response.data)
      }
    } catch (error) {
      console.error('获取云构建统计数据失败:', error)
    }
  }

  // 开始云构建
  const handleCloudBuild = async () => {
    if (!selectedCloudCore || !selectedCloudVersion) {
      addNotification({
        type: 'warning',
        title: '请选择核心和版本',
        message: '请先选择服务端核心和版本'
      })
      return
    }

    if (!cloudBuildPath) {
      addNotification({
        type: 'warning',
        title: '请选择部署路径',
        message: '请先选择服务端部署路径'
      })
      return
    }

    try {
      setBuildingCloud(true)
      setCloudBuildLogs(['开始构建任务...'])
      setCloudBuildComplete(false)
      setCloudBuildResult(null)

      const response = await apiClient.createCloudBuildTask({
        coreName: selectedCloudCore.name,
        version: selectedCloudVersion,
        type: cloudBuildType
      })

      if (response.success && response.data) {
        if (response.data.cached) {
          // 缓存命中，直接下载
          setCloudBuildLogs(prev => [...prev, '从缓存获取服务端文件...'])
          await handleCloudDownload(response.data.fileName, null)
        } else if (response.data.taskId) {
          // 需要构建，监控进度
          setCloudBuildTask(response.data)
          setCloudBuildLogs(prev => [...prev, '构建任务已创建，正在处理...'])
          monitorCloudBuildProgress(response.data.taskId)
        }
      } else {
        throw new Error(response.message || '创建构建任务失败')
      }
    } catch (error: any) {
      console.error('云构建失败:', error)
      addNotification({
        type: 'error',
        title: '构建失败',
        message: error.message || '创建构建任务失败'
      })
      setBuildingCloud(false)
    }
  }

  // 监控云构建进度
  const monitorCloudBuildProgress = async (taskId: string) => {
    let isMonitoring = true
    
    const checkProgress = async () => {
      // 如果已经停止监控，直接返回
      if (!isMonitoring) return
      
      try {
        const response = await apiClient.getCloudBuildTaskStatus(taskId)
        
        if (response.success && response.data) {
          const { status, progress, message, downloadUrl } = response.data
          
          setCloudBuildProgress(progress || 0)
          
          // 只在消息变化时添加日志
          if (message) {
            setCloudBuildLogs(prev => {
              // 避免重复添加相同的消息
              if (prev[prev.length - 1] !== message) {
                return [...prev, message]
              }
              return prev
            })
          }

          if (status === 'COMPLETED') {
            // 停止监控
            isMonitoring = false
            setCloudBuildLogs(prev => [...prev, '构建完成，开始下载...'])
            await handleCloudDownload(null, taskId)
          } else if (status === 'FAILED') {
            // 停止监控
            isMonitoring = false
            throw new Error(message || '构建失败')
          } else if (status === 'PROCESSING' || status === 'QUEUED') {
            // 继续监控
            setTimeout(() => checkProgress(), 2000)
          } else {
            // 未知状态，停止监控
            isMonitoring = false
            console.warn('未知的构建状态:', status)
          }
        }
      } catch (error: any) {
        isMonitoring = false
        console.error('检查构建进度失败:', error)
        addNotification({
          type: 'error',
          title: '构建失败',
          message: error.message || '构建过程中出现错误'
        })
        setBuildingCloud(false)
      }
    }

    checkProgress()
  }

  // 下载并解压云构建文件
  const handleCloudDownload = async (fileName: string | null, taskId: string | null) => {
    try {
      setCloudBuildLogs(prev => [...prev, '开始下载服务端文件...'])

      const response = await apiClient.downloadAndExtractCloudBuild({
        fileName: fileName || undefined,
        taskId: taskId || undefined,
        coreName: selectedCloudCore.name,
        version: selectedCloudVersion,
        targetPath: cloudBuildPath
      })

      if (response.success && response.data) {
        setCloudBuildLogs(prev => [...prev, '文件下载完成！'])
        setCloudBuildLogs(prev => [...prev, '正在解压到部署目录...'])
        setCloudBuildLogs(prev => [...prev, `已解压 ${response.data.files} 个文件`])
        setCloudBuildLogs(prev => [...prev, '部署完成！'])

        // 使用后端检测到的启动命令
        const startCommand = response.data.startCommand || 
          (systemInfo?.platform === 'win32' ? '.\\start.bat' : 'bash start.sh')

        setCloudBuildComplete(true)
        setCloudBuildResult({
          coreName: selectedCloudCore.name,
          version: selectedCloudVersion,
          path: cloudBuildPath,
          startCommand
        })
        setBuildingCloud(false)

        addNotification({
          type: 'success',
          title: '部署完成',
          message: '服务端文件已成功下载并解压到部署目录'
        })
      } else {
        throw new Error(response.message || '下载并解压失败')
      }
    } catch (error: any) {
      console.error('下载失败:', error)
      addNotification({
        type: 'error',
        title: '下载失败',
        message: error.message || '下载服务端文件失败'
      })
      setBuildingCloud(false)
    }
  }

  // 打开创建云构建实例弹窗
  const handleOpenCreateCloudInstanceModal = () => {
    if (!cloudBuildResult) return

    const instanceName = `${cloudBuildResult.coreName}-${cloudBuildResult.version}`
    setCloudInstanceName(instanceName)
    setCloudInstanceDescription(`${cloudBuildResult.coreName} ${cloudBuildResult.version} 服务端`)
    
    // 使用后端检测到的启动命令，如果没有则使用默认值
    const startCommand = cloudBuildResult.startCommand || 
      (systemInfo?.platform === 'win32' ? '.\\start.bat' : 'bash start.sh')
    setCloudInstanceStartCommand(startCommand)

    setShowCreateCloudInstanceModal(true)
    // 延迟触发动画，让DOM先渲染
    setTimeout(() => {
      setCreateCloudInstanceModalAnimating(true)
    }, 10)
  }

  // 关闭创建云构建实例弹窗
  const handleCloseCreateCloudInstanceModal = () => {
    setCreateCloudInstanceModalAnimating(false)
    setTimeout(() => {
      setShowCreateCloudInstanceModal(false)
      setCloudInstanceName('')
      setCloudInstanceDescription('')
      setCloudInstanceStartCommand('')
    }, 300)
  }

  // 创建云构建实例
  const handleCreateCloudInstance = async () => {
    if (!cloudInstanceName.trim()) {
      addNotification({
        type: 'warning',
        title: '请输入实例名称',
        message: '实例名称不能为空'
      })
      return
    }

    if (!cloudInstanceStartCommand.trim()) {
      addNotification({
        type: 'warning',
        title: '请输入启动命令',
        message: '启动命令不能为空'
      })
      return
    }

    try {
      setCreatingCloudInstance(true)

      const response = await apiClient.createInstance({
        name: cloudInstanceName,
        description: cloudInstanceDescription,
        workingDirectory: cloudBuildPath,
        startCommand: cloudInstanceStartCommand,
        autoStart: false,
        stopCommand: 'stop'
      })

      if (response.success) {
        addNotification({
          type: 'success',
          title: '创建成功',
          message: '实例已成功创建'
        })

        handleCloseCreateCloudInstanceModal()
        
        // 重置云构建状态
        setCloudBuildComplete(false)
        setCloudBuildResult(null)
        setCloudBuildLogs([])
        setSelectedCloudCore(null)
        setSelectedCloudVersion('')
      } else {
        throw new Error(response.message || '创建实例失败')
      }
    } catch (error: any) {
      console.error('创建实例失败:', error)
      addNotification({
        type: 'error',
        title: '创建失败',
        message: error.message || '创建实例失败'
      })
    } finally {
      setCreatingCloudInstance(false)
    }
  }

  // 手动更新游戏清单
  const handleUpdateGameList = async () => {
    try {
      setUpdatingGameList(true)
      setGameListError(null)

      addNotification({
        type: 'info',
        title: '正在更新',
        message: '正在更新Steam游戏部署清单...'
      })

      const response = await apiClient.updateSteamGameList()

      if (response.success) {
        addNotification({
          type: 'success',
          title: '更新成功',
          message: `游戏部署清单已更新，共${response.data?.gameCount || 0}个游戏`
        })

        // 重新获取游戏列表
        setTimeout(() => {
          fetchGames()
        }, 1000)
      } else {
        throw new Error(response.message || '更新游戏部署清单失败')
      }
    } catch (error: any) {
      console.error('更新游戏清单失败:', error)
      addNotification({
        type: 'error',
        title: '更新失败',
        message: error.message || '无法更新游戏清单'
      })
    } finally {
      setUpdatingGameList(false)
    }
  }



  // 部署更多游戏
  const deployMoreGame = async () => {
    if (!selectedMoreGame || !moreGameInstallPath) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请选择游戏和安装路径'
      })
      return
    }

    // 检查游戏是否支持当前平台
    const selectedGame = moreGames.find(g => g.id === selectedMoreGame)
    if (!selectedGame?.supportedOnCurrentPlatform) {
      addNotification({
        type: 'error',
        title: '平台不兼容',
        message: `${selectedGame?.name || '所选游戏'} 不支持当前平台`
      })
      return
    }

    try {
      // 重置状态
      setMoreGameDeploying(true)
      setMoreGameDeployResult(null)
      setMoreGameDeployProgress(null)
      setMoreGameDeployLogs([])
      setMoreGameDeployComplete(false)

      // 初始化WebSocket连接并等待连接建立
      initializeSocket()

      // 等待WebSocket连接建立
      const waitForConnection = () => {
        return new Promise<string>((resolve, reject) => {
          if (socketRef.current?.connected && socketRef.current?.id) {
            resolve(socketRef.current.id)
            return
          }

          const timeout = setTimeout(() => {
            reject(new Error('WebSocket连接超时'))
          }, 10000) // 10秒超时

          const checkConnection = () => {
            if (socketRef.current?.connected && socketRef.current?.id) {
              clearTimeout(timeout)
              resolve(socketRef.current.id)
            } else {
              setTimeout(checkConnection, 100)
            }
          }

          checkConnection()
        })
      }

      const socketId = await waitForConnection()
      console.log('WebSocket连接已建立，Socket ID:', socketId)

      let response
      if (selectedMoreGame === 'tmodloader') {
        response = await apiClient.deployTModLoader({
          installPath: moreGameInstallPath,
          socketId
        })
      } else if (selectedMoreGame === 'factorio') {
        response = await apiClient.deployFactorio({
          installPath: moreGameInstallPath,
          socketId
        })
      } else {
        throw new Error('不支持的游戏类型')
      }

      if (response.success) {
        currentMoreGameDeploymentId.current = response.data?.deploymentId
        console.log('更多游戏部署开始，Deployment ID:', currentMoreGameDeploymentId.current)

        addNotification({
          type: 'info',
          title: '开始部署',
          message: `开始部署 ${selectedMoreGame}`
        })
      } else {
        throw new Error(response.message || '启动部署失败')
      }
    } catch (error: any) {
      console.error('启动部署失败:', error)
      setMoreGameDeploying(false)
      currentMoreGameDeploymentId.current = null
      addNotification({
        type: 'error',
        title: '部署失败',
        message: error.message || '无法启动游戏部署'
      })
    }
  }

  // 获取Minecraft服务器分类
  const fetchMinecraftCategories = async () => {
    try {
      setMinecraftLoading(true)
      const response = await apiClient.getMinecraftServerCategories()

      if (response.success) {
        setMinecraftCategories(response.data || [])
      } else {
        throw new Error(response.message || '获取Minecraft服务器分类失败')
      }
    } catch (error: any) {
      console.error('获取Minecraft服务器分类失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: error.message || '无法获取Minecraft服务器分类'
      })
    } finally {
      setMinecraftLoading(false)
    }
  }

  // 搜索Minecraft整合包
  const searchMrpackModpacks = async () => {
    if (!mrpackSearchQuery.trim()) {
      addNotification({
        type: 'error',
        title: '搜索错误',
        message: '请输入搜索关键词'
      })
      return
    }

    try {
      setMrpackSearchLoading(true)
      const response = await apiClient.searchMrpackModpacks({
        query: mrpackSearchQuery,
        limit: 20
      })

      if (response.success) {
        setMrpackSearchResults(response.data?.hits || [])
      } else {
        throw new Error(response.message || '搜索整合包失败')
      }
    } catch (error: any) {
      console.error('搜索整合包失败:', error)
      addNotification({
        type: 'error',
        title: '搜索失败',
        message: error.message || '无法搜索整合包'
      })
    } finally {
      setMrpackSearchLoading(false)
    }
  }

  // 获取整合包版本列表
  const fetchMrpackVersions = async (projectId: string) => {
    try {
      setMrpackVersionsLoading(true)
      const response = await apiClient.getMrpackProjectVersions(projectId)

      if (response.success) {
        setMrpackVersions(response.data || [])
        setSelectedMrpackVersion(null)
      } else {
        throw new Error(response.message || '获取版本列表失败')
      }
    } catch (error: any) {
      console.error('获取版本列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: error.message || '无法获取版本列表'
      })
    } finally {
      setMrpackVersionsLoading(false)
    }
  }

  // 部署Minecraft整合包
  const deployMrpack = async () => {
    if (!selectedMrpack || !selectedMrpackVersion || !mrpackInstallPath.trim()) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请选择整合包、版本和安装路径'
      })
      return
    }

    try {
      // 重置状态
      setMrpackDeploying(true)
      setMrpackDeployResult(null)
      setMrpackDeployProgress(null)
      setMrpackDeployLogs([])
      setMrpackDeployComplete(false)

      // 初始化WebSocket连接并等待连接建立
      initializeSocket()

      // 等待WebSocket连接建立
      const waitForConnection = () => {
        return new Promise<string>((resolve, reject) => {
          if (socketRef.current?.connected && socketRef.current?.id) {
            resolve(socketRef.current.id)
            return
          }

          const timeout = setTimeout(() => {
            reject(new Error('WebSocket连接超时'))
          }, 10000) // 10秒超时

          const checkConnection = () => {
            if (socketRef.current?.connected && socketRef.current?.id) {
              clearTimeout(timeout)
              resolve(socketRef.current.id)
            } else {
              setTimeout(checkConnection, 100)
            }
          }

          checkConnection()
        })
      }

      const socketId = await waitForConnection()
      console.log('WebSocket连接已建立，Socket ID:', socketId)

      const response = await apiClient.deployMrpack({
        projectId: selectedMrpack.project_id,
        versionId: selectedMrpackVersion.id,
        installPath: mrpackInstallPath,
        socketId
      })

      if (response.success) {
        currentMrpackDeploymentId.current = response.data?.deploymentId
        console.log('整合包部署开始，Deployment ID:', currentMrpackDeploymentId.current)

        addNotification({
          type: 'info',
          title: '开始部署',
          message: `开始部署整合包 ${selectedMrpack.title}`
        })
      } else {
        throw new Error(response.message || '启动部署失败')
      }
    } catch (error: any) {
      console.error('启动部署失败:', error)
      setMrpackDeploying(false)
      currentMrpackDeploymentId.current = null
      addNotification({
        type: 'error',
        title: '部署失败',
        message: error.message || '无法启动整合包部署'
      })
    }
  }

  // 获取指定服务端的可用版本
  const fetchMinecraftVersions = async (server: string) => {
    try {
      const response = await apiClient.getMinecraftVersions(server)

      if (response.success) {
        setAvailableVersions(response.data || [])
        setSelectedVersion('')
      } else {
        throw new Error(response.message || '获取版本列表失败')
      }
    } catch (error: any) {
      console.error('获取版本列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: error.message || '无法获取版本列表'
      })
    }
  }

  // 验证Java环境
  const validateJava = async () => {
    try {
      const response = await apiClient.validateJavaEnvironment()
      setJavaValidated(response.success)

      if (!response.success) {
        addNotification({
          type: 'warning',
          title: 'Java环境检查',
          message: 'Java环境验证失败，请确保已安装Java并添加到PATH环境变量中'
        })
      }
    } catch (error: any) {
      console.error('Java环境验证失败:', error)
      setJavaValidated(false)
    }
  }

  // 获取Java环境列表
  const fetchJavaEnvironments = async () => {
    try {
      setJavaEnvironmentsLoading(true)
      const response = await apiClient.getJavaEnvironments()

      if (response.success) {
        setJavaEnvironments(response.data || [])
        // 验证保存的Java版本是否仍然有效
        setTimeout(() => validateSavedJavaVersions(), 100)
      } else {
        console.error('获取Java环境列表失败:', response.message)
        addNotification({
          type: 'error',
          title: '错误',
          message: '获取Java环境列表失败'
        })
      }
    } catch (error) {
      console.error('获取Java环境列表失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '获取Java环境列表失败'
      })
    } finally {
      setJavaEnvironmentsLoading(false)
    }
  }

  // 保存Minecraft Java选择到localStorage
  const handleMinecraftJavaChange = (javaVersion: string) => {
    setSelectedMinecraftJava(javaVersion)
    localStorage.setItem('selectedMinecraftJava', javaVersion)
  }

  // 保存整合包Java选择到localStorage
  const handleMrpackJavaChange = (javaVersion: string) => {
    setSelectedMrpackJava(javaVersion)
    localStorage.setItem('selectedMrpackJava', javaVersion)
  }

  // 验证保存的Java版本是否仍然有效
  const validateSavedJavaVersions = () => {
    const installedVersions = javaEnvironments.filter(env => env.installed).map(env => env.version)

    // 验证Minecraft Java选择
    if (selectedMinecraftJava !== 'default' && !installedVersions.includes(selectedMinecraftJava)) {
      console.log(`保存的Minecraft Java版本 ${selectedMinecraftJava} 不再可用，重置为默认`)
      handleMinecraftJavaChange('default')
    }

    // 验证整合包Java选择
    if (selectedMrpackJava !== 'default' && !installedVersions.includes(selectedMrpackJava)) {
      console.log(`保存的整合包Java版本 ${selectedMrpackJava} 不再可用，重置为默认`)
      handleMrpackJavaChange('default')
    }
  }

  // 初始化WebSocket连接
  const initializeSocket = () => {
    if (socketRef.current) {
      return
    }

    const token = localStorage.getItem('gsm3_token')
    socketRef.current = io(config.serverUrl, {
      auth: {
        token
      }
    })

    // 添加连接事件监听
    socketRef.current.on('connect', () => {
      console.log('WebSocket连接成功，Socket ID:', socketRef.current?.id)
    })

    socketRef.current.on('disconnect', () => {
      console.log('WebSocket连接断开')
    })

    socketRef.current.on('connect_error', (error) => {
      console.error('WebSocket连接错误:', error)
    })

    // 监听Minecraft下载进度
    socketRef.current.on('minecraft-download-progress', (data) => {
      if (data.downloadId === currentDownloadId.current) {
        const progress = data.progress
        setDownloadProgress({
          percentage: typeof progress === 'object' ? progress.percentage : progress,
          loaded: progress.loaded || 0,
          total: progress.total || 100
        })
      }
    })

    // 监听Minecraft下载日志
    socketRef.current.on('minecraft-download-log', (data) => {
      if (data.downloadId === currentDownloadId.current) {
        // 确保只添加字符串到日志中
        const message = typeof data.message === 'string' ? data.message : JSON.stringify(data.message)
        setDownloadLogs(prev => [...prev, message])
      }
    })

    // 监听Minecraft下载完成
    socketRef.current.on('minecraft-download-complete', (data) => {
      console.log('收到下载完成事件:', data)
      if (data.downloadId === currentDownloadId.current) {
        setMinecraftDownloading(false)
        setDownloadComplete(true)
        setDownloadResult(data.data)

        addNotification({
          type: 'success',
          title: '下载完成',
          message: data.message || `${selectedServer} ${selectedVersion} 下载完成！`
        })
      }
    })

    // 监听Minecraft下载错误
    socketRef.current.on('minecraft-download-error', (data) => {
      console.log('收到下载错误事件:', data)
      if (data.downloadId === currentDownloadId.current) {
        setMinecraftDownloading(false)

        addNotification({
          type: 'error',
          title: '下载失败',
          message: data.error || '下载过程中发生错误'
        })
      }
    })

    // 监听游戏部署进度（包括更多游戏和Minecraft整合包）
    socketRef.current.on('more-games-deploy-progress', (data) => {
      console.log('收到整合包部署进度:', data)
      // 检查是否是整合包部署的进度
      if (data.deploymentId && data.deploymentId.startsWith('mrpack-deploy-')) {
        setMrpackDeployProgress(data.progress)
      } else {
        setMoreGameDeployProgress(data.progress)
      }
    })

    // 监听Minecraft整合包部署日志
    socketRef.current.on('more-games-deploy-log', (data) => {
      const message = typeof data.message === 'string' ? data.message : JSON.stringify(data.message)
      // 检查是否是整合包部署的日志
      if (data.deploymentId && data.deploymentId.startsWith('mrpack-deploy-')) {
        setMrpackDeployLogs(prev => [...prev, message])
      } else {
        setMoreGameDeployLogs(prev => [...prev, message])
      }
    })

    // 监听Minecraft整合包部署完成
    socketRef.current.on('more-games-deploy-complete', (data) => {
      // 检查是否是整合包部署的完成事件
      if (data.deploymentId && data.deploymentId.startsWith('mrpack-deploy-')) {
        setMrpackDeploying(false)
        setMrpackDeployComplete(true)
        setMrpackDeployResult(data.data)
        currentMrpackDeploymentId.current = null // 重置整合包部署ID

        // 自动生成启动命令
        if (data.data?.serverType) {
          setMrpackInstanceStartCommand(generateStartCommand(data.data.serverType, selectedMrpackJava))
        } else {
          // 默认启动命令
          const defaultCommand = data.data?.serverJarPath ? `java -jar "${data.data.serverJarPath}"` : 'java -jar server.jar'
          setMrpackInstanceStartCommand(selectedMrpackJava !== 'default' ? replaceJavaInCommand(defaultCommand, selectedMrpackJava) : defaultCommand)
        }

        addNotification({
          type: 'success',
          title: '部署完成',
          message: data.message || '整合包部署完成！'
        })
      } else {
        setMoreGameDeploying(false)
        setMoreGameDeployComplete(true)
        setMoreGameDeployResult(data.data)
        currentMoreGameDeploymentId.current = null

        addNotification({
          type: 'success',
          title: '部署完成',
          message: data.message || '游戏部署完成！'
        })
      }
    })

    // 监听Minecraft整合包部署错误
    socketRef.current.on('more-games-deploy-error', (data) => {
      // 检查是否是整合包部署的错误事件
      if (data.deploymentId && data.deploymentId.startsWith('mrpack-deploy-')) {
        setMrpackDeploying(false)
        currentMrpackDeploymentId.current = null // 重置整合包部署ID

        addNotification({
          type: 'error',
          title: '部署失败',
          message: data.error || '整合包部署过程中发生错误'
        })
      } else {
        setMoreGameDeploying(false)
        currentMoreGameDeploymentId.current = null

        addNotification({
          type: 'error',
          title: '部署失败',
          message: data.error || '部署过程中发生错误'
        })
      }
    })

    // 监听在线游戏部署日志
    socketRef.current.on('online-deploy-log', (data) => {
      if (data.deploymentId === currentOnlineGameDeploymentId.current) {
        const message = typeof data.message === 'string' ? data.message : JSON.stringify(data.message)
        setOnlineGameDeployLogs(prev => [...prev, message])
      }
    })

    // 监听在线游戏部署进度
    socketRef.current.on('online-deploy-progress', (data) => {
      console.log('收到在线部署进度:', data)
      if (data.deploymentId === currentOnlineGameDeploymentId.current) {
        setOnlineGameDeployProgress(data)
      }
    })

    // 监听在线游戏部署完成
    socketRef.current.on('online-deploy-complete', (data) => {
      console.log('收到在线部署完成事件:', data)
      if (data.deploymentId === currentOnlineGameDeploymentId.current) {
        setOnlineGameDeploying(false)
        setOnlineGameDeployComplete(true)
        setOnlineGameDeployResult(data.result)
        currentOnlineGameDeploymentId.current = null

        // 不显示通知，让用户在模态框中看到结果
        // 成功或失败的状态会在UI中显示
      }
    })
  }

  // 下载Minecraft服务端
  const downloadMinecraftServer = async () => {
    if (!selectedServer || !selectedVersion || !minecraftInstallPath.trim()) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请选择服务端、版本并填写安装路径'
      })
      return
    }

    try {
      // 重置状态
      setMinecraftDownloading(true)
      setDownloadProgress(null)
      setDownloadLogs([])
      setDownloadComplete(false)
      setDownloadResult(null)

      // 初始化WebSocket连接并等待连接建立
      initializeSocket()

      // 等待WebSocket连接建立
      const waitForConnection = () => {
        return new Promise<string>((resolve, reject) => {
          if (socketRef.current?.connected && socketRef.current?.id) {
            resolve(socketRef.current.id)
            return
          }

          const timeout = setTimeout(() => {
            reject(new Error('WebSocket连接超时'))
          }, 10000) // 10秒超时

          const checkConnection = () => {
            if (socketRef.current?.connected && socketRef.current?.id) {
              clearTimeout(timeout)
              resolve(socketRef.current.id)
            } else {
              setTimeout(checkConnection, 100)
            }
          }

          checkConnection()
        })
      }

      const socketId = await waitForConnection()
      console.log('WebSocket连接已建立，Socket ID:', socketId)

      const downloadOptions: MinecraftDownloadOptions & { socketId?: string } = {
        server: selectedServer,
        version: selectedVersion,
        targetDirectory: minecraftInstallPath.trim(),
        skipJavaCheck,
        skipServerRun,
        socketId
      }

      const response = await apiClient.downloadMinecraftServer(downloadOptions)

      if (response.success) {
        currentDownloadId.current = response.data?.downloadId
        console.log('下载开始，Download ID:', currentDownloadId.current, 'Socket ID:', socketId)

        addNotification({
          type: 'info',
          title: '开始下载',
          message: `开始下载 ${selectedServer} ${selectedVersion}`
        })
      } else {
        throw new Error(response.message || '启动下载失败')
      }
    } catch (error: any) {
      console.error('启动Minecraft服务端下载失败:', error)
      setMinecraftDownloading(false)
      addNotification({
        type: 'error',
        title: '下载失败',
        message: error.message || '无法启动Minecraft服务端下载'
      })
    }
  }

  // 取消更多游戏部署
  const cancelMoreGameDeployment = async () => {
    if (!currentMoreGameDeploymentId.current) {
      addNotification({
        type: 'error',
        title: '取消失败',
        message: '没有正在进行的部署任务'
      })
      return
    }

    try {
      console.log('尝试取消部署，ID:', currentMoreGameDeploymentId.current)
      const response = await apiClient.cancelMoreGameDeployment(currentMoreGameDeploymentId.current)

      if (response.success) {
        // 重置部署状态
        setMoreGameDeploying(false)
        setMoreGameDeployProgress(null)
        currentMoreGameDeploymentId.current = null

        addNotification({
          type: 'info',
          title: '部署已取消',
          message: '更多游戏部署已取消'
        })
      } else {
        console.error('取消部署失败，服务器响应:', response)
        throw new Error(response.message || '取消部署失败')
      }
    } catch (error: any) {
      console.error('取消部署失败:', error)
      addNotification({
        type: 'error',
        title: '取消失败',
        message: error.message || '无法取消部署'
      })
    }
  }

  // 取消Minecraft下载
  const cancelMinecraftDownload = async () => {
    if (!currentDownloadId.current) {
      addNotification({
        type: 'error',
        title: '取消失败',
        message: '没有正在进行的下载任务'
      })
      return
    }

    try {
      const response = await apiClient.cancelMinecraftDownload(currentDownloadId.current)

      if (response.success) {
        // 重置下载状态
        setMinecraftDownloading(false)
        setDownloadProgress(null)
        currentDownloadId.current = null

        addNotification({
          type: 'info',
          title: '下载已取消',
          message: 'Minecraft服务端下载已取消'
        })
      } else {
        throw new Error(response.message || '取消下载失败')
      }
    } catch (error: any) {
      console.error('取消下载失败:', error)
      addNotification({
        type: 'error',
        title: '取消失败',
        message: error.message || '无法取消下载'
      })
    }
  }

  // 取消整合包部署
  const cancelMrpackDeployment = async () => {
    if (!currentMrpackDeploymentId.current) {
      addNotification({
        type: 'error',
        title: '取消失败',
        message: '没有正在进行的整合包部署任务'
      })
      return
    }

    try {
      console.log('尝试取消整合包部署，ID:', currentMrpackDeploymentId.current)
      const response = await apiClient.cancelMoreGameDeployment(currentMrpackDeploymentId.current)

      if (response.success) {
        // 重置部署状态
        setMrpackDeploying(false)
        setMrpackDeployProgress(null)
        currentMrpackDeploymentId.current = null

        addNotification({
          type: 'info',
          title: '部署已取消',
          message: '整合包部署已取消'
        })
      } else {
        console.error('取消整合包部署失败，服务器响应:', response)
        throw new Error(response.message || '取消整合包部署失败')
      }
    } catch (error: any) {
      console.error('取消整合包部署失败:', error)
      addNotification({
        type: 'error',
        title: '取消失败',
        message: error.message || '无法取消整合包部署'
      })
    }
  }

  // 处理整合包鼠标悬停
  const handleMrpackMouseEnter = (mrpackId: string) => {
    // 清除之前的定时器
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }

    // 设置1秒后显示详情
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredMrpack(mrpackId)
    }, 1000)
  }

  const handleMrpackMouseLeave = () => {
    // 清除定时器
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }

    // 隐藏详情
    setHoveredMrpack(null)
  }

  // 获取选中的Java可执行文件路径
  const getSelectedJavaExecutable = (selectedJava: string) => {
    if (selectedJava === 'default') {
      return 'java'
    }

    const javaEnv = javaEnvironments.find(env => env.version === selectedJava)
    if (javaEnv && javaEnv.javaExecutable) {
      // 如果路径包含空格，需要用引号包围
      return javaEnv.javaExecutable.includes(' ') ? `"${javaEnv.javaExecutable}"` : javaEnv.javaExecutable
    }

    return 'java' // 回退到默认
  }

  // 根据服务器类型生成启动命令
  const generateStartCommand = (serverType: string, selectedJava: string = 'default', isWindows: boolean = process.platform === 'win32') => {
    const lowerServerType = serverType.toLowerCase()
    const javaExecutable = getSelectedJavaExecutable(selectedJava)

    if (lowerServerType.includes('forge') || lowerServerType.includes('neoforge')) {
      // Forge/NeoForge 使用启动脚本
      return isWindows ? 'run.bat' : './run.sh'
    } else if (lowerServerType.includes('fabric') || lowerServerType.includes('quilt')) {
      // Fabric/Quilt 重命名为 server.jar
      return `${javaExecutable} -jar server.jar`
    } else {
      // 默认情况
      return `${javaExecutable} -jar server.jar`
    }
  }

  // 替换启动命令中的Java路径
  const replaceJavaInCommand = (command: string, selectedJava: string) => {
    if (selectedJava === 'default') {
      return command
    }

    const javaExecutable = getSelectedJavaExecutable(selectedJava)
    // 替换命令开头的java为指定的Java可执行文件路径
    return command.replace(/^java\b/, javaExecutable)
  }

  // 创建Minecraft实例
  const createMinecraftInstance = async () => {
    if (!instanceName.trim() || !downloadResult) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请填写实例名称'
      })
      return
    }

    try {
      setCreatingInstance(true)

      // 生成启动命令，考虑选中的Java版本
      let finalStartCommand = instanceStartCommand || generateStartCommand(selectedServer, selectedMinecraftJava)

      // 如果用户手动输入了启动命令且选择了特定Java版本，替换其中的java
      if (instanceStartCommand && selectedMinecraftJava !== 'default') {
        finalStartCommand = replaceJavaInCommand(instanceStartCommand, selectedMinecraftJava)
      }

      const response = await apiClient.createInstance({
        name: instanceName.trim(),
        description: instanceDescription.trim() || `Minecraft ${selectedServer} ${selectedVersion}`,
        workingDirectory: downloadResult.targetDirectory,
        startCommand: finalStartCommand,
        autoStart: false,
        stopCommand: 'stop' as const
      })

      if (response.success) {
        addNotification({
          type: 'success',
          title: '实例创建成功',
          message: `Minecraft实例 "${instanceName}" 创建成功！`
        })

        handleCloseCreateInstanceModal()

        // 重置表单
        setSelectedCategory('')
        setSelectedServer('')
        setSelectedVersion('')
        setMinecraftInstallPath('')
        setAvailableVersions([])
        setDownloadComplete(false)
        setDownloadResult(null)
        setInstanceName('')
        setInstanceDescription('')
        setInstanceStartCommand('')

        // 跳转到实例管理页面
        navigate('/instances')
      } else {
        throw new Error(response.error || '创建实例失败')
      }
    } catch (error: any) {
      console.error('创建Minecraft实例失败:', error)
      addNotification({
        type: 'error',
        title: '创建失败',
        message: error.message || '无法创建Minecraft实例'
      })
    } finally {
      setCreatingInstance(false)
    }
  }

  // 处理服务端选择
  const handleServerSelect = (server: string) => {
    setSelectedServer(server)
    setSelectedVersion('')
    setAvailableVersions([])
    // 重置安装路径，等待版本选择后再生成完整路径
    setMinecraftInstallPath('')
    fetchMinecraftVersions(server)
  }

  // 处理更多游戏选择
  const handleMoreGameSelect = (gameId: string) => {
    setSelectedMoreGame(gameId)
    // 自动填充默认路径
    const selectedGame = moreGames.find(g => g.id === gameId)
    if (selectedGame && !moreGameInstallPath) {
      setMoreGameInstallPath(generatePath(selectedGame.name))
    }
  }

  // 处理整合包选择
  const handleMrpackSelect = (modpack: any) => {
    setSelectedMrpack(modpack)
    // 自动生成整合包路径
    if (modpack.title) {
      setMrpackInstallPath(generatePath(modpack.title))
    }
    // 获取版本列表
    if (modpack.project_id) {
      fetchMrpackVersions(modpack.project_id)
    }
  }

  useEffect(() => {
    // 首次加载时获取系统信息
    fetchSystemInfo()
    fetchGames()
    if (activeTab === 'minecraft') {
      fetchMinecraftCategories()
      validateJava()
      fetchJavaEnvironments()
      // Minecraft标签页的路径将在选择服务器和版本后自动生成
    }
    if (activeTab === 'more-games') {
      fetchMoreGames()
      // 确保更多游戏标签页有默认路径
      if (defaultGamePath && !moreGameInstallPath) {
        setMoreGameInstallPath(defaultGamePath)
      }
    }
    if (activeTab === 'mrpack') {
      validateJava()
      fetchJavaEnvironments()
      // 整合包标签页的路径将在选择整合包后自动生成
    }
    if (activeTab === 'online-deploy') {
      checkSponsorKey()
      if (sponsorKeyValid) {
        fetchOnlineGames()
      }
      // 确保在线部署标签页有默认路径
      if (defaultGamePath && !onlineGameInstallPath) {
        setOnlineGameInstallPath(defaultGamePath)
      }
    }
    if (activeTab === 'cloud-build') {
      fetchCloudBuildCores()
      fetchCloudBuildStats()
      // 确保云构建标签页有默认路径
      if (defaultGamePath && !cloudBuildPath) {
        setCloudBuildPath(defaultGamePath)
      }
    }
  }, [activeTab, sponsorKeyValid, defaultGamePath, fetchSystemInfo])

  // 当检测到ARM架构时，如果当前标签页是不支持的标签页，则切换到minecraft标签页
  useEffect(() => {
    if (systemInfo && (systemInfo.arch === 'arm64' || systemInfo.arch === 'aarch64')) {
      const unsupportedTabs = ['steamcmd', 'more-games', 'online-deploy']
      if (unsupportedTabs.includes(activeTab)) {
        setActiveTab('minecraft')
      }
    }
  }, [systemInfo, activeTab])

  // 监听Java版本选择变化，自动更新启动命令
  useEffect(() => {
    // 更新Minecraft实例启动命令
    if (selectedServer && selectedVersion && selectedMinecraftJava) {
      setInstanceStartCommand(generateStartCommand(selectedServer, selectedMinecraftJava))
    }
  }, [selectedMinecraftJava, selectedServer])

  useEffect(() => {
    // 更新整合包实例启动命令
    if (mrpackDeployResult && selectedMrpackJava) {
      if (mrpackDeployResult.serverType) {
        setMrpackInstanceStartCommand(generateStartCommand(mrpackDeployResult.serverType, selectedMrpackJava))
      } else {
        const defaultCommand = mrpackDeployResult.serverJarPath ? `java -jar "${mrpackDeployResult.serverJarPath}"` : 'java -jar server.jar'
        setMrpackInstanceStartCommand(selectedMrpackJava !== 'default' ? replaceJavaInCommand(defaultCommand, selectedMrpackJava) : defaultCommand)
      }
    }
  }, [selectedMrpackJava, mrpackDeployResult])

  // 清理WebSocket连接和定时器
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      // 清理悬停定时器
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
    }
  }, [])


  // 自动生成和更新SteamCMD命令
  useEffect(() => {
    if (showInstallModal && selectedGame) {
      const loginCommand = useAnonymous
        ? 'login anonymous'
        : `login ${steamUsername.trim()} ${steamPassword.trim()}`

      const installCommand = validateGameIntegrity
        ? `force_install_dir "${installPath.trim()}" +app_update ${selectedGame.info.appid} validate`
        : `force_install_dir "${installPath.trim()}" +app_update ${selectedGame.info.appid}`

      const fullCommand = `steamcmd +${loginCommand} +${installCommand} +quit`
      setSteamcmdCommand(fullCommand)
    }
  }, [showInstallModal, selectedGame, useAnonymous, steamUsername, steamPassword, validateGameIntegrity, installPath])

  // 打开安装对话框
  const handleInstallGame = async (gameKey: string, gameInfo: GameInfo) => {
    // 检查游戏是否支持当前平台
    if (gameInfo.supportedOnCurrentPlatform === false) {
      addNotification({
        type: 'error',
        title: '平台不兼容',
        message: `${gameInfo.game_nameCN} 不支持当前平台 (${gameInfo.currentPlatform})，无法安装`
      })
      return
    }

    // 设置正在检测环境状态
    setCheckingEnvironment(gameKey)

    try {
      // 检查面板是否兼容当前平台
      if (gameInfo.panelCompatibleOnCurrentPlatform === false) {
        // 显示兼容性确认对话框
        setPendingGameInstall({ key: gameKey, info: gameInfo })
        setShowCompatibilityModal(true)
        // 使用requestAnimationFrame确保DOM渲染完成后再触发动画
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setCompatibilityModalAnimating(true)
          })
        })
        return
      }

      // 检查内存需求
      try {
        const memoryCheckResponse = await apiClient.checkGameMemory(gameKey)
        const memoryWarning = (memoryCheckResponse as any).memoryWarning
        if (memoryCheckResponse.success && memoryWarning) {
          // 显示内存警告对话框
          setMemoryWarningInfo({
            required: memoryWarning.required,
            available: memoryWarning.available,
            message: memoryWarning.message,
            gameKey,
            gameInfo
          })
          setShowMemoryWarningModal(true)
          // 使用requestAnimationFrame确保DOM渲染完成后再触发动画
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setMemoryWarningModalAnimating(true)
            })
          })
          return
        }
      } catch (error) {
        console.warn('检查内存需求失败，继续安装流程:', error)
        // 内存检查失败不应阻止安装流程
      }

      // 直接打开安装对话框
      openInstallModal(gameKey, gameInfo)
    } finally {
      // 清除检测环境状态
      setCheckingEnvironment(null)
    }
  }



  // 打开安装对话框的通用函数
  const openInstallModal = async (gameKey: string, gameInfo: GameInfo) => {
    const defaultInstanceName = gameInfo.game_nameCN
    
    // 检查是否存在同名实例
    try {
      const instancesResponse = await apiClient.getInstances()
      if (instancesResponse.success && instancesResponse.data) {
        const existingInstance = instancesResponse.data.find(
          (instance: any) => instance.name === defaultInstanceName
        )
        
        if (existingInstance) {
          // 找到同名实例，显示确认弹窗
          setSelectedGame({ key: gameKey, info: gameInfo })
          setInstanceName(defaultInstanceName)
          setInstallPath(generatePath(gameKey))
          setExistingInstanceId(existingInstance.id)
          setShowInstanceUpdateDialog(true)
          // 使用requestAnimationFrame确保DOM渲染完成后再触发动画
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setInstanceUpdateDialogAnimating(true)
            })
          })
          return
        }
      }
    } catch (error) {
      console.error('检查实例失败:', error)
      // 检查失败不应阻止安装流程，继续正常流程
    }
    
    // 没有找到同名实例，正常打开安装对话框
    setSelectedGame({ key: gameKey, info: gameInfo })
    setInstanceName(defaultInstanceName)
    setInstallPath(generatePath(gameKey))
    setShowInstallModal(true)
    // 使用requestAnimationFrame确保DOM渲染完成后再触发动画
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setInstallModalAnimating(true)
      })
    })
  }

  // 关闭安装对话框
  const handleCloseInstallModal = () => {
    setInstallModalAnimating(false)
    setTimeout(() => {
      setShowInstallModal(false)
      setValidateGameIntegrity(false) // 重置校验游戏完整性状态
      setShowAdvanced(false) // 重置高级选项展开状态
      setSteamcmdCommand('') // 重置SteamCMD命令
      setExistingInstanceId(null) // 重置实例ID
      setUpdateInstanceInfo(false) // 重置更新实例信息标志
    }, 300)
  }
  
  // 关闭实例更新确认弹窗
  const handleCloseInstanceUpdateDialog = () => {
    setInstanceUpdateDialogAnimating(false)
    setTimeout(() => {
      setShowInstanceUpdateDialog(false)
      setExistingInstanceId(null)
      setUpdateInstanceInfo(false)
      setCheckingEnvironment(null) // 清除检测环境状态
    }, 300)
  }
  
  // 确认实例更新
  const handleConfirmInstanceUpdate = (shouldUpdateInfo: boolean) => {
    setUpdateInstanceInfo(shouldUpdateInfo)
    // 自动勾选校验游戏完整性
    setValidateGameIntegrity(true)
    // 关闭确认弹窗（但不重置 existingInstanceId）
    setInstanceUpdateDialogAnimating(false)
    setTimeout(() => {
      setShowInstanceUpdateDialog(false)
      setCheckingEnvironment(null) // 清除检测环境状态
      // 注意：不在这里重置 existingInstanceId 和 updateInstanceInfo
    }, 300)
    // 打开安装对话框
    setTimeout(() => {
      setShowInstallModal(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setInstallModalAnimating(true)
        })
      })
    }, 350)
  }

  // 关闭兼容性确认对话框
  const handleCloseCompatibilityModal = () => {
    setCompatibilityModalAnimating(false)
    setTimeout(() => {
      setShowCompatibilityModal(false)
      setPendingGameInstall(null)
      setCheckingEnvironment(null) // 清除检测环境状态
    }, 300)
  }

  // 关闭内存警告对话框
  const handleCloseMemoryWarningModal = () => {
    setMemoryWarningModalAnimating(false)
    setTimeout(() => {
      setShowMemoryWarningModal(false)
      setMemoryWarningInfo(null)
      setCheckingEnvironment(null) // 清除检测环境状态
    }, 300)
  }

  // 确认继续安装（忽略内存警告）
  const handleContinueInstallation = () => {
    if (memoryWarningInfo) {
      handleCloseMemoryWarningModal()
      // 清除检测环境状态
      setCheckingEnvironment(null)
      // 打开安装对话框
      openInstallModal(memoryWarningInfo.gameKey, memoryWarningInfo.gameInfo)
    }
  }

  // 确认继续安装不兼容的游戏
  const handleConfirmIncompatibleInstall = () => {
    if (pendingGameInstall) {
      handleCloseCompatibilityModal()
      // 清除检测环境状态
      setCheckingEnvironment(null)
      // 延迟一点时间等待对话框关闭动画完成
      setTimeout(() => {
        openInstallModal(pendingGameInstall.key, pendingGameInstall.info)
      }, 350)
    }
  }

  // 打开开服文档
  const handleOpenDocs = (gameInfo: GameInfo) => {
    if (!gameInfo.docs) {
      addNotification({
        type: 'error',
        title: '文档不可用',
        message: '该游戏暂无开服文档'
      })
      return
    }

    setSelectedGameDocs(gameInfo)
    setShowDocsModal(true)
    setTimeout(() => setDocsModalAnimating(true), 10)
  }

  // 关闭开服文档对话框
  const handleCloseDocsModal = () => {
    setDocsModalAnimating(false)
    setTimeout(() => {
      setShowDocsModal(false)
      setSelectedGameDocs(null)
    }, 300)
  }

  // 关闭创建实例对话框
  const handleCloseCreateInstanceModal = () => {
    setCreateInstanceModalAnimating(false)
    setTimeout(() => {
      setShowCreateInstanceModal(false)
    }, 300)
  }

  // 打开云服务商选择弹窗
  const handleOpenCloudProviderModal = (gameKey: string, gameInfo: GameInfo) => {
    setSelectedGameForCloud({ key: gameKey, info: gameInfo })
    setShowCloudProviderModal(true)
  }

  // 关闭云服务商选择弹窗
  const handleCloseCloudProviderModal = () => {
    setShowCloudProviderModal(false)
    setSelectedGameForCloud(null)
  }

  // 关闭创建整合包实例对话框
  const handleCloseCreateMrpackInstanceModal = () => {
    setCreateMrpackInstanceModalAnimating(false)
    setTimeout(() => {
      setShowCreateMrpackInstanceModal(false)
      // 重置表单
      setMrpackInstanceName('')
      setMrpackInstanceDescription('')
      setMrpackInstanceStartCommand('')
    }, 300)
  }

  // 打开帮助模态框
  const handleOpenHelpModal = () => {
    setShowHelpModal(true)
    setTimeout(() => setHelpModalAnimating(true), 10)
  }

  // 关闭帮助模态框
  const handleCloseHelpModal = () => {
    setHelpModalAnimating(false)
    setTimeout(() => {
      setShowHelpModal(false)
    }, 300)
  }

  // 创建整合包实例
  const createMrpackInstance = async () => {
    if (!mrpackInstanceName.trim() || !mrpackDeployResult) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请填写实例名称'
      })
      return
    }

    try {
      setCreatingMrpackInstance(true)

      // 生成启动命令，考虑选中的Java版本
      let finalStartCommand = mrpackInstanceStartCommand
      if (!finalStartCommand) {
        // 如果没有自定义启动命令，生成默认命令
        const defaultCommand = mrpackDeployResult.serverJarPath ? `java -jar "${mrpackDeployResult.serverJarPath}"` : 'java -jar server.jar'
        finalStartCommand = selectedMrpackJava !== 'default' ? replaceJavaInCommand(defaultCommand, selectedMrpackJava) : defaultCommand
      } else if (selectedMrpackJava !== 'default') {
        // 如果有自定义启动命令且选择了特定Java版本，替换其中的java
        finalStartCommand = replaceJavaInCommand(mrpackInstanceStartCommand, selectedMrpackJava)
      }

      const response = await apiClient.createInstance({
        name: mrpackInstanceName.trim(),
        description: mrpackInstanceDescription.trim() || `Minecraft整合包实例 - ${selectedMrpack?.title}`,
        workingDirectory: mrpackDeployResult.installPath,
        startCommand: finalStartCommand,
        autoStart: false,
        stopCommand: 'stop' as const
      })

      if (response.success) {
        addNotification({
          type: 'success',
          title: '实例创建成功',
          message: `实例 "${mrpackInstanceName.trim()}" 已创建，即将跳转到实例管理页面...`
        })

        handleCloseCreateMrpackInstanceModal()

        // 跳转到实例管理页面
        setTimeout(() => {
          navigate('/instances')
        }, 1500)
      } else {
        throw new Error(response.message || '创建实例失败')
      }
    } catch (error: any) {
      console.error('创建整合包实例失败:', error)
      addNotification({
        type: 'error',
        title: '创建失败',
        message: error.message || '无法创建整合包实例'
      })
    } finally {
      setCreatingMrpackInstance(false)
    }
  }

  // 开始安装游戏
  const startInstallation = async () => {
    if (!selectedGame || !installPath.trim() || !instanceName.trim()) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请填写完整的安装信息'
      })
      return
    }

    if (!useAnonymous && (!steamUsername.trim() || !steamPassword.trim())) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请填写Steam账户信息'
      })
      return
    }

    // 验证SteamCMD命令是否为空
    if (!steamcmdCommand.trim()) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: 'SteamCMD命令不能为空'
      })
      return
    }

    // 保存实例相关状态，因为关闭对话框时会被重置
    const currentExistingInstanceId = existingInstanceId
    const currentUpdateInstanceInfo = updateInstanceInfo

    try {
      // 关闭对话框
      handleCloseInstallModal()

      // 调用后端API开始游戏安装，使用高级选项中的命令
       const response = await apiClient.installGame({
          gameKey: selectedGame.key,
          gameName: selectedGame.info.game_nameCN,
          appId: selectedGame.info.appid,
          installPath: installPath.trim(),
          instanceName: instanceName.trim(),
          useAnonymous,
          steamUsername: useAnonymous ? undefined : steamUsername.trim(),
          steamPassword: useAnonymous ? undefined : steamPassword.trim(),
          steamcmdCommand: steamcmdCommand.trim(),
          existingInstanceId: currentExistingInstanceId || undefined,
          updateInstanceInfo: currentUpdateInstanceInfo
        })

      if (response.success && response.data?.terminalSessionId) {
        // 直接跳转到终端页面
        proceedWithInstallation(response.data)
      } else {
        throw new Error(response.message || '安装失败，未返回终端会话ID')
      }
    } catch (error: any) {
      console.error('游戏安装失败:', error)
      addNotification({
        type: 'error',
        title: '安装失败',
        message: error.message || '无法开始游戏安装'
      })
    }
  }

  // 继续安装流程（显示成功通知并跳转）
  const proceedWithInstallation = (installData: any) => {
    addNotification({
      type: 'success',
      title: '安装已启动',
      message: `${selectedGame?.info.game_nameCN} 安装已开始，即将跳转到终端页面...`
    })
    // 跳转到终端页面，并将会话ID作为参数传递
    setTimeout(() => {
      navigate(`/terminal?sessionId=${installData.terminalSessionId}`)
    }, 1500) // 延迟以便用户看到通知
  }

  // 选择安装路径
  const selectInstallPath = async () => {
    try {
      // 这里可以集成文件选择器，暂时使用输入框
      const path = prompt('请输入安装路径:', 'D:\\Games\\' + selectedGame?.info.game_nameCN)
      if (path) {
        setInstallPath(path)
      }
    } catch (error) {
      console.error('选择路径失败:', error)
    }
  }

  // 获取在线游戏列表
  const fetchOnlineGames = async () => {
    try {
      setOnlineGamesLoading(true)
      const response = await apiClient.getOnlineGames()

      if (response.success) {
        // 后端返回的是数组格式，直接使用
        const gamesArray = (response.data || []).map((gameData: any) => ({
          id: gameData.id || gameData.name,
          name: gameData.name,
          description: gameData.description || '',
          image: gameData.image || '',
          type: gameData.type || [],
          download: gameData.downloadUrl || gameData.download || '',
          supportedPlatforms: gameData.supportedPlatforms || [],
          supported: gameData.supported || false,
          currentPlatform: gameData.currentPlatform || ''
        }))
        setOnlineGames(gamesArray)
      } else {
        throw new Error(response.message || '获取在线游戏列表失败')
      }
    } catch (error: any) {
      console.error('获取在线游戏列表失败:', error)
      addNotification({
        type: 'error',
        title: '获取失败',
        message: error.message || '无法获取在线游戏列表'
      })
    } finally {
      setOnlineGamesLoading(false)
    }
  }

  // 打开在线游戏安装对话框
  const handleOpenOnlineGameInstallModal = (game: any) => {
    setSelectedOnlineGame(game)
    // 自动填充默认路径
    setOnlineGameInstallPath(generatePath(game.name || game.title || '游戏'))
    setShowOnlineGameInstallModal(true)
    setTimeout(() => setOnlineGameInstallModalAnimating(true), 10)
  }

  // 关闭在线游戏安装对话框
  const handleCloseOnlineGameInstallModal = () => {
    setOnlineGameInstallModalAnimating(false)
    setTimeout(() => {
      setShowOnlineGameInstallModal(false)
      setSelectedOnlineGame(null)
      setOnlineGameInstallPath('')
      // 重置部署相关状态
      setOnlineGameDeploying(false)
      setOnlineGameDeployProgress(null)
      setOnlineGameDeployLogs([])
      setOnlineGameDeployComplete(false)
      setOnlineGameDeployResult(null)
      currentOnlineGameDeploymentId.current = null
    }, 300)
  }

  // 开始在线游戏部署
  const startOnlineGameDeployment = async () => {
    if (!selectedOnlineGame || !onlineGameInstallPath.trim()) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '请选择游戏并填写安装路径'
      })
      return
    }

    try {
      // 重置状态
      setOnlineGameDeploying(true)
      setOnlineGameDeployProgress(null)
      setOnlineGameDeployLogs([])
      setOnlineGameDeployComplete(false)
      setOnlineGameDeployResult(null)

      // 初始化WebSocket连接
      initializeSocket()

      // 等待WebSocket连接建立
      const waitForConnection = () => {
        return new Promise<string>((resolve, reject) => {
          if (socketRef.current?.connected && socketRef.current?.id) {
            resolve(socketRef.current.id)
            return
          }

          const timeout = setTimeout(() => {
            reject(new Error('WebSocket连接超时'))
          }, 10000)

          const checkConnection = () => {
            if (socketRef.current?.connected && socketRef.current?.id) {
              clearTimeout(timeout)
              resolve(socketRef.current.id)
            } else {
              setTimeout(checkConnection, 100)
            }
          }

          checkConnection()
        })
      }

      const socketId = await waitForConnection()

      // 调用部署API
      const response = await apiClient.deployOnlineGame({
        gameId: selectedOnlineGame.id,
        installPath: onlineGameInstallPath.trim(),
        socketId
      })

      if (response.success && response.data?.deploymentId) {
        currentOnlineGameDeploymentId.current = response.data.deploymentId

        addNotification({
          type: 'success',
          title: '部署已启动',
          message: `${selectedOnlineGame.name} 部署已开始`
        })

        // 不关闭模态框，保持打开状态以显示部署进度
      } else {
        throw new Error(response.message || '启动部署失败')
      }
    } catch (error: any) {
      console.error('启动在线游戏部署失败:', error)
      setOnlineGameDeploying(false)

      addNotification({
        type: 'error',
        title: '部署失败',
        message: error.message || '无法启动在线游戏部署'
      })
    }
  }

  // 取消在线游戏部署
  const cancelOnlineGameDeployment = async () => {
    if (!currentOnlineGameDeploymentId.current) {
      addNotification({
        type: 'warning',
        title: '无法取消',
        message: '没有正在进行的在线游戏部署'
      })
      return
    }

    try {
      const response = await apiClient.cancelOnlineGameDeployment(currentOnlineGameDeploymentId.current)

      if (response.success) {
        setOnlineGameDeploying(false)
        setOnlineGameDeployProgress(null)
        currentOnlineGameDeploymentId.current = null

        addNotification({
          type: 'info',
          title: '部署已取消',
          message: '在线游戏部署已取消'
        })
      } else {
        throw new Error(response.message || '取消部署失败')
      }
    } catch (error: any) {
      console.error('取消在线游戏部署失败:', error)
      addNotification({
        type: 'error',
        title: '取消失败',
        message: error.message || '无法取消在线游戏部署'
      })
    }
  }

  // 创建在线游戏实例
  const createOnlineGameInstance = async () => {
    if (!onlineGameDeployResult || !selectedOnlineGame) {
      addNotification({
        type: 'error',
        title: '参数错误',
        message: '没有可用的部署结果'
      })
      return
    }

    try {
      const response = await apiClient.createInstance({
        name: selectedOnlineGame.name || '在线游戏实例',
        description: `在线部署的游戏实例 - ${selectedOnlineGame.name}`,
        workingDirectory: onlineGameDeployResult.installPath,
        startCommand: 'none',
        autoStart: false,
        stopCommand: 'ctrl+c' as const
      })

      if (response.success) {
        addNotification({
          type: 'success',
          title: '创建成功',
          message: `实例 "${selectedOnlineGame.name}" 创建成功！`
        })

        // 关闭模态框
        handleCloseOnlineGameInstallModal()

        // 跳转到实例管理页面
        navigate('/instances')
      } else {
        throw new Error(response.message || '创建实例失败')
      }
    } catch (error: any) {
      console.error('创建在线游戏实例失败:', error)
      addNotification({
        type: 'error',
        title: '创建失败',
        message: error.message || '创建实例时发生错误'
      })
    }
  }

  // 筛选游戏
  const filteredGames = Object.entries(games).filter(([gameKey, gameInfo]) => {
    // 搜索筛选
    if (searchQuery && !gameInfo.game_nameCN.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }

    // 平台筛选
    switch (platformFilter) {
      case 'all':
        return true
      case 'compatible':
        return gameInfo.supportedOnCurrentPlatform !== false
      case 'Windows':
      case 'Linux':
      case 'macOS':
        return gameInfo.system?.includes(platformFilter) || (!gameInfo.system || gameInfo.system.length === 0)
      default:
        return true
    }
  })

  // 筛选在线游戏
  const filteredOnlineGames = onlineGames.filter((game) => {
    // 搜索筛选
    if (onlineGameSearchQuery && !game.name.toLowerCase().includes(onlineGameSearchQuery.toLowerCase())) {
      return false
    }

    // 类型筛选
    if (onlineGameTypeFilter !== 'all' && game.type) {
      return game.type.includes(onlineGameTypeFilter)
    }

    return true
  })

  // 获取所有可用的在线游戏类型
  const availableOnlineGameTypes = Array.from(
    new Set(
      onlineGames.flatMap(game => game.type || []).filter(type => type && type.trim())
    )
  ).sort()

  // 检查是否有任何游戏包含type信息
  const hasGameTypes = availableOnlineGameTypes.length > 0

  // 检查是否为ARM架构，如果是则隐藏SteamCMD、更多游戏部署和在线部署标签页
  const isArmArchitecture = systemInfo?.arch === 'arm64' || systemInfo?.arch === 'aarch64'

  const tabs = [
    // 只有在非ARM架构时才显示SteamCMD标签页
    ...(isArmArchitecture ? [] : [{ id: 'steamcmd', name: 'SteamCMD', icon: Download }]),
    { id: 'minecraft', name: 'Minecraft部署', icon: Pickaxe },
    { id: 'mrpack', name: 'Minecraft整合包部署', icon: Package },
    { id: 'cloud-build', name: '云构建部署', icon: Cloud },
    // 只有在非ARM架构时才显示更多游戏部署和在线部署标签页
    ...(isArmArchitecture ? [] : [
      { id: 'more-games', name: '更多游戏部署', icon: Server },
      { id: 'online-deploy', name: '在线部署', icon: ExternalLink }
    ])
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600 dark:text-gray-400">加载游戏列表中...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">游戏部署</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              快速部署各种游戏服务器
            </p>
          </div>
          <button
            onClick={handleOpenHelpModal}
            className="p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            title="查看帮助信息"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 标签页 */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors
                  ${isActive
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.name}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* SteamCMD 标签页内容 */}
      {activeTab === 'steamcmd' && (
        <div className="space-y-6">
          {/* Steam网络状态提示 */}
          <NetworkStatusBanner categoryId="steam" autoCheck={true} />
          
          {/* 游戏列表错误状态 */}
          {gameListError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                    游戏列表加载失败
                  </h3>
                  <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                    {gameListError}
                  </p>
                  <div className="mt-3">
                    <button
                      onClick={handleUpdateGameList}
                      disabled={updatingGameList}
                      className="inline-flex items-center space-x-2 px-3 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg transition-colors"
                    >
                      {updatingGameList ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>正在更新游戏清单...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          <span>更新游戏清单</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 筛选器 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* 搜索框 */}
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  搜索游戏
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="输入游戏名称搜索..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              {/* 平台筛选 */}
              <div className="sm:w-48">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  平台筛选
                </label>
                <select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="all">全部游戏</option>
                  <option value="compatible">兼容当前平台</option>
                  <option value="Windows">Windows</option>
                  <option value="Linux">Linux</option>
                  <option value="macOS">macOS</option>
                </select>
               </div>

               {/* 清除筛选按钮 */}
               {(searchQuery || platformFilter !== 'all') && (
                 <div className="sm:w-auto flex items-end">
                   <button
                     onClick={() => {
                       setSearchQuery('')
                       setPlatformFilter('all')
                     }}
                     className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                   >
                     清除筛选
                   </button>
                 </div>
               )}
             </div>

             {/* 统计信息 */}
             <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
               显示 {filteredGames.length} / {Object.keys(games).length} 个游戏
               {platformFilter === 'compatible' && (
                 <span className="ml-2 text-green-600 dark:text-green-400">
                   (仅显示兼容游戏)
                 </span>
               )}
               {searchQuery && (
                 <span className="ml-2 text-blue-600 dark:text-blue-400">
                   (搜索: "{searchQuery}")
                 </span>
               )}
             </div>
          </div>

          {/* 游戏网格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredGames.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <div className="text-gray-500 dark:text-gray-400">
                  <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">没有找到匹配的游戏</p>
                  <p className="text-sm">
                    {searchQuery ? '尝试修改搜索关键词' : '尝试更改筛选条件'}
                  </p>
                </div>
              </div>
            ) : (
              filteredGames.map(([gameKey, gameInfo]) => (
              <div
                key={gameKey}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* 游戏图片 */}
                <div className="aspect-video bg-gray-200 dark:bg-gray-700 relative">
                  <img
                    src={gameInfo.image}
                    alt={gameInfo.game_nameCN}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuaXoOazleWKoOi9veWbvueJhzwvdGV4dD48L3N2Zz4='
                    }}
                  />
                  <div className="absolute top-2 right-2">
                    <a
                      href={gameInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white p-1 rounded transition-colors"
                      title="查看Steam商店页面"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>

                {/* 游戏信息 */}
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 text-center">
                    {gameInfo.game_nameCN}
                  </h3>

                  {/* 平台兼容性信息 */}
                  <div className="mb-4 text-center">
                    {gameInfo.system && gameInfo.system.length > 0 ? (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        <span>支持平台: {gameInfo.system.join(', ')}</span>
                        {gameInfo.currentPlatform && (
                          <div className={`mt-1 text-xs ${
                            gameInfo.supportedOnCurrentPlatform
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}>
                            当前平台: {gameInfo.currentPlatform}
                            {gameInfo.supportedOnCurrentPlatform ? '✓ 兼容' : '✗ 不兼容'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-green-600 dark:text-green-400">
                        ✓ 支持全平台
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="space-y-2">
                    {/* 第一行按钮 */}
                    <div className="flex space-x-2">
                      {/* 部署游戏按钮 */}
                      <button
                        onClick={() => handleInstallGame(gameKey, gameInfo)}
                        disabled={gameInfo.supportedOnCurrentPlatform === false || checkingEnvironment === gameKey}
                        className={`${(gameInfo.docs || gameInfo.cloud) ? 'flex-1' : 'w-full'} py-2 px-3 rounded-lg transition-colors flex items-center justify-center space-x-1 text-sm ${
                          gameInfo.supportedOnCurrentPlatform === false || checkingEnvironment === gameKey
                            ? 'bg-gray-400 cursor-not-allowed text-gray-200'
                            : gameInfo.panelCompatibleOnCurrentPlatform === false
                            ? 'bg-orange-600 hover:bg-orange-700 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {checkingEnvironment === gameKey ? (
                          <Loader className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        <span>
                          {checkingEnvironment === gameKey
                            ? '正在检测运行环境'
                            : gameInfo.supportedOnCurrentPlatform === false
                            ? '不兼容'
                            : gameInfo.panelCompatibleOnCurrentPlatform === false
                            ? '面板不兼容'
                            : '部署/更新 游戏'}
                        </span>
                      </button>

                      {/* 开服文档按钮（如果存在） */}
                      {gameInfo.docs && (
                        <button
                          onClick={() => handleOpenDocs(gameInfo)}
                          className="flex-1 py-2 px-3 rounded-lg transition-colors flex items-center justify-center space-x-1 text-sm bg-green-600 hover:bg-green-700 text-white"
                        >
                          <BookOpen className="w-4 h-4" />
                          <span>开服文档</span>
                        </button>
                      )}
                    </div>

                    {/* 购买已预装服务器按钮（如果存在云服务商） */}
                    {gameInfo.cloud && Object.keys(gameInfo.cloud).length > 0 && (
                      <button
                        onClick={() => handleOpenCloudProviderModal(gameKey, gameInfo)}
                        className="w-full py-2 px-3 rounded-lg transition-colors flex items-center justify-center space-x-1 text-sm bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <Server className="w-4 h-4" />
                        <span>购买已预装服务器</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 在线部署标签页内容 */}
      {activeTab === 'online-deploy' && (
        <div className="space-y-6">
          {/* GSManager在线部署服务网络状态提示 */}
          <NetworkStatusBanner categoryId="gsmanager" itemId="gsm-deploy" autoCheck={true} />
          
          {/* 赞助者密钥状态 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            <div className="flex items-center space-x-3">
              {sponsorKeyChecking ? (
                <Loader className="w-5 h-5 animate-spin text-blue-500" />
              ) : sponsorKeyValid ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-500" />
              )}
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  赞助者密钥状态
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {sponsorKeyChecking
                    ? '检查中...'
                    : sponsorKeyValid
                    ? '密钥有效，可以使用在线部署功能'
                    : '密钥无效或未设置，请前往设置页面配置赞助者密钥'}
                </p>
              </div>
              <button
                onClick={checkSponsorKey}
                className="ml-auto px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                重新检查
              </button>
            </div>
          </div>

          {/* 在线游戏筛选器 */}
          {sponsorKeyValid && onlineGames.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* 搜索框 */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    搜索游戏
                  </label>
                  <input
                    type="text"
                    value={onlineGameSearchQuery}
                    onChange={(e) => setOnlineGameSearchQuery(e.target.value)}
                    placeholder="输入游戏名称搜索..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* 类型筛选 - 只有当有游戏类型时才显示 */}
                {hasGameTypes && (
                  <div className="sm:w-48">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      游戏类型
                    </label>
                    <select
                      value={onlineGameTypeFilter}
                      onChange={(e) => setOnlineGameTypeFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="all">全部类型</option>
                      {availableOnlineGameTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 清除筛选按钮 */}
                {(onlineGameSearchQuery || (hasGameTypes && onlineGameTypeFilter !== 'all')) && (
                  <div className="sm:w-auto flex items-end">
                    <button
                      onClick={() => {
                        setOnlineGameSearchQuery('')
                        setOnlineGameTypeFilter('all')
                      }}
                      className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                    >
                      清除筛选
                    </button>
                  </div>
                )}
              </div>

              {/* 统计信息 */}
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                显示 {filteredOnlineGames.length} / {onlineGames.length} 个游戏
                {hasGameTypes && onlineGameTypeFilter !== 'all' && (
                  <span className="ml-2 text-green-600 dark:text-green-400">
                    (类型: {onlineGameTypeFilter})
                  </span>
                )}
                {onlineGameSearchQuery && (
                  <span className="ml-2 text-blue-600 dark:text-blue-400">
                    (搜索: "{onlineGameSearchQuery}")
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 在线游戏列表 */}
          {sponsorKeyValid ? (
            onlineGamesLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader className="w-8 h-8 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">加载在线游戏列表中...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredOnlineGames.length === 0 ? (
                  <div className="col-span-full text-center py-12">
                    <div className="text-gray-500 dark:text-gray-400">
                      <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium mb-2">
                        {onlineGames.length === 0 ? '暂无可用的在线游戏' : '没有找到匹配的游戏'}
                      </p>
                      <p className="text-sm">
                        {onlineGames.length === 0
                          ? '请稍后再试或联系管理员'
                          : '尝试修改搜索条件或筛选设置'}
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredOnlineGames.map((game) => (
                    <div
                      key={game.id}
                      className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
                    >
                      {/* 游戏图片 */}
                      <div className="aspect-video bg-gray-200 dark:bg-gray-700 relative">
                        <img
                          src={game.image || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuaXoOazleWKoOi9veWbvueJhzwvdGV4dD48L3N2Zz4='}
                          alt={game.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 right-2">
                          <div className="bg-black/50 text-white px-2 py-1 rounded text-xs">
                            在线部署
                          </div>
                        </div>
                      </div>

                      {/* 游戏信息 */}
                      <div className="p-4">
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-2 text-center">
                          {game.name}
                        </h3>

                        {/* 游戏类型标签 */}
                        {game.type && game.type.length > 0 && (
                          <div className="flex flex-wrap gap-1 justify-center mb-3">
                            {game.type.map((type, index) => (
                              <span
                                key={index}
                                className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                              >
                                {type}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* 游戏描述 */}
                        {game.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 text-center line-clamp-2">
                            {game.description}
                          </p>
                        )}

                        {/* 操作按钮 */}
                        <button
                          onClick={() => handleOpenOnlineGameInstallModal(game)}
                          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                        >
                          <Download className="w-4 h-4" />
                          <span>部署游戏</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          ) : (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-yellow-600 dark:text-yellow-400" />
              <h3 className="text-lg font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                需要赞助者密钥
              </h3>
              <p className="text-yellow-700 dark:text-yellow-300 mb-4">
                在线部署功能需要有效的赞助者密钥才能使用。请前往设置页面配置您的密钥。
              </p>
              <p className="text-yellow-700 dark:text-yellow-300 mb-4">
                在线部署是采用GSManager官方中国大陆服务器由开发团队亲自手动配置的服务端具有一键安装和百分百的成功率保障
              </p>
              <button
                onClick={() => navigate('/settings')}
                className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                前往设置
              </button>
            </div>
          )}
        </div>
      )}

      {/* 云构建部署标签页内容 */}
      {activeTab === 'cloud-build' && (
        <div className="space-y-6">
          {/* 云构建说明 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <Cloud className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                  云构建部署
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
                  通过GSManager云端构建服务在云端直接运行核心成功后将其打包，拥有接近百分百的开服成功率，从根源解决因本地环境和问题造成的启动失败等疑难杂症。
                </p>
                <a
                  href="https://download.mc.xiaozhuhouses.asia:4433/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>访问云构建缓存节点</span>
                </a>
              </div>
            </div>
          </div>

          {/* 云构建服务网络状态提示 */}
          <NetworkStatusBanner categoryId="gsmanager-cloud" autoCheck={true} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左侧：服务端选择 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                选择构建平台
              </h3>

              <div className="space-y-4">
                {/* 构建平台类型 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    构建平台
                  </label>
                  <select
                    value={cloudBuildType}
                    onChange={(e) => setCloudBuildType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    disabled={buildingCloud}
                  >
                    <option value="msl_Official">我的世界原版Java部署</option>
                  </select>
                </div>

                {/* 核心选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    服务端核心
                  </label>
                  {cloudBuildCoresLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader className="w-5 h-5 animate-spin text-blue-500" />
                      <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">加载核心列表...</span>
                    </div>
                  ) : (
                    <select
                      value={selectedCloudCore?.name || ''}
                      onChange={(e) => {
                        const core = cloudBuildCores.find(c => c.name === e.target.value)
                        setSelectedCloudCore(core || null)
                        setSelectedCloudVersion('')
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      disabled={buildingCloud}
                    >
                      <option value="">请选择服务端核心</option>
                      {cloudBuildCores.map((core) => (
                        <option key={core.name} value={core.name}>
                          {core.displayName} - {core.description}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 版本选择 */}
                {selectedCloudCore && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Minecraft版本
                    </label>
                    <select
                      value={selectedCloudVersion}
                      onChange={(e) => {
                        setSelectedCloudVersion(e.target.value)
                        // 自动更新部署路径
                        if (e.target.value && selectedCloudCore) {
                          setCloudBuildPath(generateMinecraftPath(selectedCloudCore.name, e.target.value))
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      disabled={buildingCloud}
                    >
                      <option value="">请选择版本</option>
                      {selectedCloudCore.versions.map((version: string) => (
                        <option key={version} value={version}>
                          {version}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 下载统计 */}
                {cloudBuildStats && selectedCloudCore && (
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {(() => {
                        const coreStat = cloudBuildStats.find((s: any) => s.coreName === selectedCloudCore.name)
                        if (coreStat) {
                          return (
                            <>
                              <div className="flex justify-between mb-1">
                                <span>总下载次数:</span>
                                <span className="font-medium">{coreStat.totalDownloads}</span>
                              </div>
                              {selectedCloudVersion && coreStat.versions[selectedCloudVersion] && (
                                <div className="flex justify-between">
                                  <span>当前版本下载:</span>
                                  <span className="font-medium">{coreStat.versions[selectedCloudVersion]}</span>
                                </div>
                              )}
                            </>
                          )
                        }
                        return '暂无统计数据'
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 右侧：部署配置 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                部署配置
              </h3>

              <div className="space-y-4">
                {/* 部署路径 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    部署路径
                  </label>
                  <input
                    type="text"
                    value={cloudBuildPath}
                    onChange={(e) => setCloudBuildPath(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="输入部署路径"
                    disabled={buildingCloud}
                  />
                </div>

                {/* 构建按钮 */}
                <button
                  onClick={handleCloudBuild}
                  disabled={
                    !selectedCloudCore ||
                    !selectedCloudVersion ||
                    !cloudBuildPath.trim() ||
                    buildingCloud
                  }
                  className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  {buildingCloud ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>构建中...</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="w-4 h-4" />
                      <span>开始构建部署</span>
                    </>
                  )}
                </button>

                {/* 构建进度 */}
                {buildingCloud && (
                  <div className="space-y-2">
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${cloudBuildProgress}%` }}
                      ></div>
                    </div>
                    <p className="text-sm text-center text-gray-600 dark:text-gray-400">
                      {cloudBuildProgress}%
                    </p>
                  </div>
                )}

                {/* 构建日志 */}
                {cloudBuildLogs.length > 0 && (
                  <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-xs max-h-64 overflow-y-auto">
                    {cloudBuildLogs.map((log, index) => (
                      <div key={index} className="mb-1">
                        {log}
                      </div>
                    ))}
                  </div>
                )}

                {/* 构建完成 - 创建实例 */}
                {cloudBuildComplete && cloudBuildResult && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">
                          部署完成！
                        </h4>
                        <p className="text-sm text-green-700 dark:text-green-300 mb-3">
                          服务端文件已成功下载到：{cloudBuildResult.path}
                        </p>
                        <button
                          onClick={handleOpenCreateCloudInstanceModal}
                          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                        >
                          <Server className="w-4 h-4" />
                          <span>创建实例</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Minecraft 标签页内容 */}
      {activeTab === 'minecraft' && (
        <div className="space-y-6">
          {/* MSL API网络状态提示 */}
          <NetworkStatusBanner categoryId="minecraft" itemId="msl-api" autoCheck={true} />
          
          {/* Java环境状态 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                {javaValidated === null ? (
                  <Loader className="w-5 h-5 animate-spin text-blue-500" />
                ) : javaValidated ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-500" />
                )}
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    Java环境状态
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {javaValidated === null
                      ? '检查中...'
                      : javaValidated
                      ? 'Java环境正常'
                      : 'Java环境未找到，请安装Java并添加到PATH环境变量'}
                  </p>
                </div>
                <button
                  onClick={validateJava}
                  className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  重新检查
                </button>
              </div>

              {/* Java版本选择 */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center space-x-4">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-0 flex-shrink-0">
                    Java版本选择:
                  </label>
                  <div className="flex-1">
                    {javaEnvironmentsLoading ? (
                      <div className="flex items-center space-x-2">
                        <Loader className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">加载中...</span>
                      </div>
                    ) : (
                      <select
                        value={selectedMinecraftJava}
                        onChange={(e) => handleMinecraftJavaChange(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="default">默认Java (系统PATH)</option>
                        {javaEnvironments.filter(env => env.installed).map((env) => (
                          <option key={env.version} value={env.version}>
                            {env.version} {env.javaExecutable ? `(${env.javaExecutable})` : '(未找到可执行文件)'}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <button
                    onClick={fetchJavaEnvironments}
                    disabled={javaEnvironmentsLoading}
                    className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${javaEnvironmentsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                {selectedMinecraftJava !== 'default' && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    已选择特定Java版本，创建实例时将使用此版本的Java运行时
                  </p>
                )}
              </div>
            </div>
          </div>

          {minecraftLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader className="w-8 h-8 animate-spin text-blue-500" />
              <span className="ml-2 text-gray-600 dark:text-gray-400">加载Minecraft服务器列表中...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 服务器选择 */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  选择服务端类型
                </h3>

                <div className="space-y-4">
                  {/* 服务器分类 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      服务器分类
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => {
                        setSelectedCategory(e.target.value)
                        setSelectedServer('')
                        setSelectedVersion('')
                        setAvailableVersions([])
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">请选择服务器分类</option>
                      {minecraftCategories.map((category) => (
                        <option key={category.name} value={category.name}>
                          {category.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 具体服务端 */}
                  {selectedCategory && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        服务端
                      </label>
                      <select
                        value={selectedServer}
                        onChange={(e) => handleServerSelect(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">请选择服务端</option>
                        {minecraftCategories
                          .find(cat => cat.name === selectedCategory)
                          ?.servers.map((server) => (
                            <option key={server} value={server}>
                              {server}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {/* 版本选择 */}
                  {selectedServer && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Minecraft版本
                      </label>
                      <select
                        value={selectedVersion}
                        onChange={(e) => {
                          const version = e.target.value
                          setSelectedVersion(version)
                          // 自动生成启动命令
                          if (version && selectedServer) {
                            setInstanceStartCommand(generateStartCommand(selectedServer, selectedMinecraftJava))
                            // 自动更新安装路径
                            setMinecraftInstallPath(generateMinecraftPath(selectedServer, version))
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">请选择版本</option>
                        {availableVersions.map((version) => (
                          <option key={version} value={version}>
                            {version}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* 下载配置 */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  下载配置
                </h3>

                <div className="space-y-4">
                  {/* 安装路径 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      安装路径
                    </label>
                    <input
                      type="text"
                      value={minecraftInstallPath}
                      onChange={(e) => setMinecraftInstallPath(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="例如/home/steam/games/xxx 或 D:\Games"
                    />
                  </div>

                  {/* 高级选项 */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      高级选项
                    </h4>

                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="skipJavaCheck"
                          checked={skipJavaCheck}
                          onChange={(e) => setSkipJavaCheck(e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                        />
                        <label htmlFor="skipJavaCheck" className="text-sm text-gray-700 dark:text-gray-300">
                          跳过Java环境检查
                        </label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="skipServerRun"
                          checked={skipServerRun}
                          onChange={(e) => setSkipServerRun(e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                        />
                        <label htmlFor="skipServerRun" className="text-sm text-gray-700 dark:text-gray-300">
                          跳过服务端运行（不生成EULA文件）
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* 下载按钮 */}
                  <div className="space-y-2">
                    <button
                      onClick={downloadMinecraftServer}
                      disabled={
                        !selectedServer ||
                        !selectedVersion ||
                        !minecraftInstallPath.trim() ||
                        minecraftDownloading
                      }
                      className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                    >
                      {minecraftDownloading ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>下载中...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          <span>下载服务端</span>
                        </>
                      )}
                    </button>

                    {/* 取消下载按钮 */}
                    {minecraftDownloading && (
                      <button
                        onClick={cancelMinecraftDownload}
                        className="w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                      >
                        <X className="w-4 h-4" />
                        <span>取消下载</span>
                      </button>
                    )}
                  </div>

                  {/* 下载进度 */}
                  {(downloadProgress || minecraftDownloading) && (
                    <div className="mt-4 space-y-3">
                      {downloadProgress && (
                        <div>
                          <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                            <span>下载进度</span>
                            <span>{downloadProgress.percentage}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${downloadProgress.percentage}%` }}
                            ></div>
                          </div>
                          {downloadProgress.loaded && downloadProgress.total && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {Math.round(downloadProgress.loaded / 1024 / 1024)}MB / {Math.round(downloadProgress.total / 1024 / 1024)}MB
                            </div>
                          )}
                        </div>
                      )}

                      {/* 下载日志 */}
                      {downloadLogs.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            下载日志
                          </h4>
                          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 max-h-32 overflow-y-auto">
                            {downloadLogs.slice(-10).map((log, index) => (
                              <div key={index} className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                                {typeof log === 'string' ? log : JSON.stringify(log)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 下载完成后的操作 */}
                  {downloadComplete && downloadResult && (
                    <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                      <div className="flex items-center space-x-2 mb-3">
                        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <h4 className="text-sm font-medium text-green-800 dark:text-green-200">
                          下载完成！
                        </h4>
                      </div>
                      <p className="text-sm text-green-700 dark:text-green-300 mb-3">
                        {selectedServer} {selectedVersion} 已成功下载到 {downloadResult.targetDirectory}
                      </p>
                      <button
                        onClick={() => {
                          setInstanceName(`${selectedServer}-${selectedVersion}`)
                          setInstanceDescription(`Minecraft ${selectedServer} ${selectedVersion} 服务器`)
                          setShowCreateInstanceModal(true)
                          setTimeout(() => setCreateInstanceModalAnimating(true), 10)
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                      >
                        <Plus className="w-4 h-4" />
                        <span>创建实例</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 更多游戏部署标签页内容 */}
      {activeTab === 'more-games' && (
        <div className="space-y-6">
          {/* 游戏选择 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              选择游戏
            </h3>

            {moreGamesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="w-6 h-6 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">加载游戏列表中...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {moreGames.map((game) => {
                  const isSupported = game.supportedOnCurrentPlatform
                  const platformText = {
                    [Platform.WINDOWS]: 'Windows',
                    [Platform.LINUX]: 'Linux',
                    [Platform.MACOS]: 'macOS'
                  }

                  return (
                    <div
                      key={game.id}
                      className={`
                        p-4 border-2 rounded-lg transition-all relative
                        ${!isSupported
                          ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 cursor-not-allowed opacity-60'
                          : selectedMoreGame === game.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 cursor-pointer'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 cursor-pointer'
                        }
                      `}
                      onClick={() => isSupported && handleMoreGameSelect(game.id)}
                    >
                      <div className="flex items-start space-x-3">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                           isSupported
                             ? 'bg-gradient-to-br from-blue-500 to-purple-600'
                             : 'bg-gray-400 dark:bg-gray-600'
                         }`}>
                           <Server className="w-6 h-6 text-white" />
                         </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className={`font-medium ${
                              isSupported
                                ? 'text-gray-900 dark:text-white'
                                : 'text-gray-500 dark:text-gray-400'
                            }`}>
                              {game.name}
                            </h4>
                            {!isSupported && (
                              <AlertCircle className="w-4 h-4 text-orange-500" />
                            )}
                          </div>
                          <p className={`text-sm ${
                            isSupported
                              ? 'text-gray-600 dark:text-gray-400'
                              : 'text-gray-500 dark:text-gray-500'
                          }`}>
                            {game.description}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              isSupported
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              当前平台: {platformText[game.currentPlatform || Platform.LINUX]}
                            </span>
                            {!isSupported && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400">
                                不支持当前平台
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            支持平台: {game.supportedPlatforms.map(p => platformText[p]).join(', ')}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 部署配置 */}
          {selectedMoreGame && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                部署配置
              </h3>

              <div className="space-y-4">
                {/* 安装路径 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    安装路径 *
                  </label>
                  <input
                    type="text"
                    value={moreGameInstallPath}
                    onChange={(e) => setMoreGameInstallPath(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder={`输入 ${moreGames.find(g => g.id === selectedMoreGame)?.name} 的安装路径`}
                  />
                </div>

                {/* 平台兼容性提示 */}
                {(() => {
                  const selectedGame = moreGames.find(g => g.id === selectedMoreGame)
                  if (selectedGame && !selectedGame.supportedOnCurrentPlatform) {
                    return (
                      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                        <div className="flex items-center space-x-2 text-orange-800 dark:text-orange-400">
                          <AlertCircle className="w-5 h-5" />
                          <span className="font-medium">平台不兼容</span>
                        </div>
                        <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                          {selectedGame.name} 不支持当前平台 ({selectedGame.currentPlatform})。
                          支持的平台: {selectedGame.supportedPlatforms.map(p => {
                            const platformText = {
                              [Platform.WINDOWS]: 'Windows',
                              [Platform.LINUX]: 'Linux',
                              [Platform.MACOS]: 'macOS'
                            }
                            return platformText[p]
                          }).join(', ')}
                        </p>
                      </div>
                    )
                  }
                  return null
                })()}

                {/* 部署按钮 */}
                <div className="space-y-2">
                  <div className="flex justify-end">
                    {(() => {
                      const selectedGame = moreGames.find(g => g.id === selectedMoreGame)
                      const isGameSupported = selectedGame?.supportedOnCurrentPlatform ?? false
                      const isDisabled = moreGameDeploying || !moreGameInstallPath.trim() || !isGameSupported

                      return (
                        <button
                          onClick={deployMoreGame}
                          disabled={isDisabled}
                          className={`px-6 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                            isDisabled
                              ? 'bg-gray-400 dark:bg-gray-600 text-gray-200 cursor-not-allowed'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {moreGameDeploying ? (
                            <>
                              <Loader className="w-4 h-4 animate-spin" />
                              <span>部署中...</span>
                            </>
                          ) : !isGameSupported ? (
                            <>
                              <AlertCircle className="w-4 h-4" />
                              <span>不支持当前平台</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4" />
                              <span>开始部署</span>
                            </>
                          )}
                        </button>
                      )
                    })()}
                  </div>

                  {/* 取消部署按钮 */}
                  {moreGameDeploying && (
                    <div className="flex justify-end">
                      <button
                        onClick={cancelMoreGameDeployment}
                        className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center space-x-2"
                      >
                        <X className="w-4 h-4" />
                        <span>取消部署</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 部署进度 */}
                {(moreGameDeployProgress || moreGameDeploying) && (
                  <div className="mt-4 space-y-3">
                    {moreGameDeployProgress && (
                      <div>
                        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                          <span>部署进度</span>
                          <span>{moreGameDeployProgress.percentage || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${moreGameDeployProgress.percentage || 0}%` }}
                          ></div>
                        </div>
                      </div>
                    )}

                    {/* 部署日志 */}
                    {moreGameDeployLogs.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          部署日志
                        </h4>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 max-h-32 overflow-y-auto">
                          {moreGameDeployLogs.slice(-10).map((log, index) => (
                            <div key={index} className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                              {typeof log === 'string' ? log : JSON.stringify(log)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 部署完成后的操作 */}
          {moreGameDeployComplete && moreGameDeployResult && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                部署完成
              </h3>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center space-x-2 text-green-800 dark:text-green-400 mb-3">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">部署成功！</span>
                </div>
                <div className="text-sm text-green-700 dark:text-green-300 space-y-1 mb-3">
                  <p><strong>安装路径:</strong> {moreGameDeployResult.installPath}</p>
                  {moreGameDeployResult.version && (
                    <p><strong>版本:</strong> {moreGameDeployResult.version}</p>
                  )}
                  {moreGameDeployResult.serverExecutablePath && (
                    <p><strong>服务端文件:</strong> {moreGameDeployResult.serverExecutablePath}</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    // 重置状态
                    setSelectedMoreGame('')
                    setMoreGameInstallPath('')
                    setMoreGameDeployComplete(false)
                    setMoreGameDeployResult(null)
                    setMoreGameDeployProgress(null)
                    setMoreGameDeployLogs([])
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>部署其他游戏</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Minecraft整合包部署标签页内容 */}
      {activeTab === 'mrpack' && (
        <div className="space-y-6">
          {/* Modrinth网络状态提示 */}
          <NetworkStatusBanner categoryId="modrinth" autoCheck={true} />
          
          {/* Java环境状态 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                {javaValidated === null ? (
                  <Loader className="w-5 h-5 animate-spin text-blue-500" />
                ) : javaValidated ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-500" />
                )}
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    Java环境状态
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {javaValidated === null
                      ? '检查中...'
                      : javaValidated
                      ? 'Java环境正常'
                      : 'Java环境未找到，请安装Java并添加到PATH环境变量'}
                  </p>
                </div>
                <button
                  onClick={validateJava}
                  className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  重新检查
                </button>
              </div>

              {/* Java版本选择 */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center space-x-4">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 min-w-0 flex-shrink-0">
                    Java版本选择:
                  </label>
                  <div className="flex-1">
                    {javaEnvironmentsLoading ? (
                      <div className="flex items-center space-x-2">
                        <Loader className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">加载中...</span>
                      </div>
                    ) : (
                      <select
                        value={selectedMrpackJava}
                        onChange={(e) => handleMrpackJavaChange(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="default">默认Java (系统PATH)</option>
                        {javaEnvironments.filter(env => env.installed).map((env) => (
                          <option key={env.version} value={env.version}>
                            {env.version} {env.javaExecutable ? `(${env.javaExecutable})` : '(未找到可执行文件)'}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <button
                    onClick={fetchJavaEnvironments}
                    disabled={javaEnvironmentsLoading}
                    className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${javaEnvironmentsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                {selectedMrpackJava !== 'default' && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    已选择特定Java版本，创建实例时将使用此版本的Java运行时
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* 搜索整合包 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              搜索Minecraft整合包
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              整合包内容来源于 <a href="https://modrinth.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Modrinth</a> 平台。若您是中国大陆网路可能会受到网络影响造成的部署失败，建议使用代理后再次部署。
            </p>

            <div className="flex space-x-4 mb-4">
              <input
                type="text"
                value={mrpackSearchQuery}
                onChange={(e) => setMrpackSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchMrpackModpacks()}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="输入整合包名称或关键词"
              />
              <button
                onClick={searchMrpackModpacks}
                disabled={mrpackSearchLoading || !mrpackSearchQuery.trim()}
                className={`px-6 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                  mrpackSearchLoading || !mrpackSearchQuery.trim()
                    ? 'bg-gray-400 dark:bg-gray-600 text-gray-200 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {mrpackSearchLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>搜索中...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>搜索</span>
                  </>
                )}
              </button>
            </div>

            {/* 搜索结果 */}
            {mrpackSearchResults.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mrpackSearchResults.map((modpack) => (
                  <div
                    key={modpack.project_id}
                    className={`
                      p-4 border-2 rounded-lg transition-all cursor-pointer
                      ${selectedMrpack?.project_id === modpack.project_id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                      }
                    `}
                    onClick={() => handleMrpackSelect(modpack)}
                    onMouseEnter={() => handleMrpackMouseEnter(modpack.project_id)}
                    onMouseLeave={handleMrpackMouseLeave}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                        {modpack.icon_url ? (
                          <img
                            src={modpack.icon_url}
                            alt={modpack.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // 图片加载失败时显示默认图标
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent) {
                                parent.className = 'w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center';
                                parent.innerHTML = '<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center">
                            <Package className="w-6 h-6 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 dark:text-white">
                          {modpack.title}
                        </h4>
                        <p className={`text-sm text-gray-600 dark:text-gray-400 transition-all duration-300 ${
                          hoveredMrpack === modpack.project_id ? '' : 'line-clamp-2'
                        }`}>
                          {modpack.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                            下载: {modpack.downloads?.toLocaleString() || 0}
                          </span>
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
                            作者: {modpack.author}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              mrpackSearchQuery && !mrpackSearchLoading && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    <Package className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                    未找到相关整合包
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    没有找到与 "{mrpackSearchQuery}" 相关的整合包，请尝试其他关键词
                  </p>
                  <button
                    onClick={() => {
                      setMrpackSearchQuery('')
                      setMrpackSearchResults([])
                    }}
                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                  >
                    清除搜索
                  </button>
                </div>
              )
            )}
          </div>

          {/* 部署配置 */}
          {selectedMrpack && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                部署配置
              </h3>

              <div className="space-y-4">
                {/* 选中的整合包信息 */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                      {selectedMrpack.icon_url ? (
                        <img
                          src={selectedMrpack.icon_url}
                          alt={selectedMrpack.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // 图片加载失败时显示默认图标
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.className = 'w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center';
                              parent.innerHTML = '<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                            }
                          }}
                        />
                      ) : (
                        <div className="w-full h-full bg-blue-600 flex items-center justify-center">
                          <Package className="w-6 h-6 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 text-blue-800 dark:text-blue-400 mb-2">
                        <span className="font-medium">选中的整合包</span>
                      </div>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        <strong>{selectedMrpack.title}</strong> - {selectedMrpack.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 版本选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    选择版本 *
                  </label>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => fetchMrpackVersions(selectedMrpack.project_id)}
                      disabled={mrpackVersionsLoading}
                      className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                        mrpackVersionsLoading
                          ? 'bg-gray-400 dark:bg-gray-600 text-gray-200 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {mrpackVersionsLoading ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>加载中...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          <span>获取版本列表</span>
                        </>
                      )}
                    </button>

                    {mrpackVersions.length > 0 && (
                      <select
                        value={selectedMrpackVersion?.id || ''}
                        onChange={(e) => {
                          const version = mrpackVersions.find(v => v.id === e.target.value)
                          setSelectedMrpackVersion(version || null)
                        }}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">请选择版本</option>
                        {mrpackVersions.map((version) => (
                          <option key={version.id} value={version.id}>
                            {version.name} ({version.version_number}) - {version.game_versions?.join(', ')}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {selectedMrpackVersion && (
                    <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <strong>版本:</strong> {selectedMrpackVersion.name} ({selectedMrpackVersion.version_number})
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <strong>支持的Minecraft版本:</strong> {selectedMrpackVersion.game_versions?.join(', ')}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <strong>加载器:</strong> {selectedMrpackVersion.loaders?.join(', ')}
                      </p>
                      {selectedMrpackVersion.changelog && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          <strong>更新日志:</strong> {selectedMrpackVersion.changelog.substring(0, 100)}...
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* 安装路径 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    安装路径 *
                  </label>
                  <input
                    type="text"
                    value={mrpackInstallPath}
                    onChange={(e) => setMrpackInstallPath(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="例如/home/steam/games/xxx 或 D:\Games"
                  />
                </div>

                {/* 部署按钮 */}
                <div className="space-y-2">
                  <div className="flex justify-end space-x-3">
                    {mrpackDeploying && (
                      <button
                        onClick={cancelMrpackDeployment}
                        className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center space-x-2"
                      >
                        <X className="w-4 h-4" />
                        <span>取消部署</span>
                      </button>
                    )}
                    <button
                      onClick={deployMrpack}
                      disabled={mrpackDeploying || !mrpackInstallPath.trim()}
                      className={`px-6 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                        mrpackDeploying || !mrpackInstallPath.trim()
                          ? 'bg-gray-400 dark:bg-gray-600 text-gray-200 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {mrpackDeploying ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>部署中...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          <span>开始部署</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 部署进度 */}
                {(mrpackDeployProgress || mrpackDeploying) && (
                  <div className="mt-4 space-y-3">
                    {mrpackDeployProgress && (
                      <div>
                        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                          <span>部署进度</span>
                          <span>{mrpackDeployProgress.percentage || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${mrpackDeployProgress.percentage || 0}%` }}
                          ></div>
                        </div>
                      </div>
                    )}

                    {/* 部署日志 */}
                    {mrpackDeployLogs.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          部署日志
                        </h4>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 max-h-32 overflow-y-auto">
                          {mrpackDeployLogs.slice(-10).map((log, index) => (
                            <div key={index} className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                              {typeof log === 'string' ? log : JSON.stringify(log)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 部署完成后的操作 */}
          {mrpackDeployComplete && mrpackDeployResult && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                部署完成
              </h3>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center space-x-2 text-green-800 dark:text-green-400 mb-3">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">部署成功！</span>
                </div>
                <div className="flex items-start space-x-3 mb-3">
                  <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                    {selectedMrpack?.icon_url ? (
                      <img
                        src={selectedMrpack.icon_url}
                        alt={selectedMrpack.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // 图片加载失败时显示默认图标
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.className = 'w-12 h-12 rounded-lg bg-green-600 flex items-center justify-center';
                            parent.innerHTML = '<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full bg-green-600 flex items-center justify-center">
                        <Package className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-sm text-green-700 dark:text-green-300 space-y-1">
                    <p><strong>整合包:</strong> {selectedMrpack?.title}</p>
                    <p><strong>安装路径:</strong> {mrpackDeployResult.installPath}</p>
                    {mrpackDeployResult.version && (
                      <p><strong>版本:</strong> {mrpackDeployResult.version}</p>
                    )}
                    {mrpackDeployResult.serverJarPath && (
                      <p><strong>服务端文件:</strong> {mrpackDeployResult.serverJarPath}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      // 打开创建整合包实例对话框
                      setShowCreateMrpackInstanceModal(true)
                      setCreateMrpackInstanceModalAnimating(true)
                    }}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    <Server className="w-4 h-4" />
                    <span>创建实例</span>
                  </button>
                  <button
                    onClick={() => {
                      // 重置状态
                      setSelectedMrpack(null)
                      setMrpackInstallPath('')
                      setMrpackDeployComplete(false)
                      setMrpackDeployResult(null)
                      setMrpackDeployProgress(null)
                      setMrpackDeployLogs([])
                      setMrpackSearchResults([])
                      setMrpackSearchQuery('')
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>部署其他整合包</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 安装配置对话框 */}
      {showInstallModal && selectedGame && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          installModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300 ${
            installModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                安装 {selectedGame.info.game_nameCN}
              </h3>
              <button
                onClick={handleCloseInstallModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 实例名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  实例名称
                </label>
                <input
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="输入实例名称"
                />
              </div>

              {/* 安装路径 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  安装路径
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={installPath}
                    onChange={(e) => setInstallPath(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="例如/home/steam/games/xxx 或 D:\Games"
                  />
                  <button
                    onClick={selectInstallPath}
                    className="px-3 py-2 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Steam账户设置 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Steam账户
                </label>
                <div className="space-y-3">
                  {/* 匿名账户选择 */}
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="useAnonymous"
                      checked={useAnonymous}
                      onChange={(e) => setUseAnonymous(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <label htmlFor="useAnonymous" className="text-sm text-gray-700 dark:text-gray-300">
                      使用匿名账户
                    </label>
                  </div>

                  {/* Steam登录信息 */}
                  {!useAnonymous && (
                    <div className="space-y-3 pl-6 border-l-2 border-gray-200 dark:border-gray-600">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Steam用户名
                        </label>
                        <input
                          type="text"
                          value={steamUsername}
                          onChange={(e) => setSteamUsername(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="输入Steam用户名"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Steam密码
                        </label>
                        <input
                          type="password"
                          value={steamPassword}
                          onChange={(e) => setSteamPassword(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="输入Steam密码"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 游戏信息 */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <strong>AppID:</strong> {selectedGame.info.appid}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  <strong>提示:</strong> {selectedGame.info.tip}
                </p>
              </div>

              {/* 高级选项 */}
              <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  <span>高级选项</span>
                  <svg
                    className={`w-4 h-4 transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 duration-200 max-h-60 overflow-y-auto pr-2">
                    {/* 校验游戏完整性选项 */}
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="validateGameIntegrity"
                        checked={validateGameIntegrity}
                        onChange={(e) => setValidateGameIntegrity(e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                        title="启用此选项将在安装命令中添加 validate 参数，用于校验游戏文件完整性"
                      />
                      <label
                        htmlFor="validateGameIntegrity"
                        className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
                        title="启用此选项将在安装命令中添加 validate 参数，用于校验游戏文件完整性"
                      >
                        校验游戏完整性
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        SteamCMD 安装命令
                      </label>
                      <textarea
                        value={steamcmdCommand}
                        onChange={(e) => setSteamcmdCommand(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                        placeholder="SteamCMD 命令将在这里显示，您可以修改后执行"
                        rows={4}
                        readOnly={false}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        您可以修改此命令来自定义安装参数，修改后的命令将用于实际安装
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseInstallModal}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                onClick={startInstallation}
                disabled={
                  !installPath.trim() ||
                  !instanceName.trim() ||
                  (!useAnonymous && (!steamUsername.trim() || !steamPassword.trim()))
                }
                className="px-4 py-2 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center space-x-2 bg-blue-600 hover:bg-blue-700"
              >
                <Download className="w-4 h-4" />
                <span>开始安装</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建Minecraft实例对话框 */}
      {/* 创建云构建实例弹窗 */}
      {showCreateCloudInstanceModal && cloudBuildResult && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          createCloudInstanceModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300 ${
            createCloudInstanceModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                创建云构建实例
              </h3>
              <button
                onClick={handleCloseCreateCloudInstanceModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  实例名称
                </label>
                <input
                  type="text"
                  value={cloudInstanceName}
                  onChange={(e) => setCloudInstanceName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="实例名称"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  描述（可选）
                </label>
                <textarea
                  value={cloudInstanceDescription}
                  onChange={(e) => setCloudInstanceDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="实例描述"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  启动命令
                </label>
                <input
                  type="text"
                  value={cloudInstanceStartCommand}
                  onChange={(e) => setCloudInstanceStartCommand(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="启动命令（自动生成，可手动修改）"
                />
              </div>
            </div>

            <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseCreateCloudInstanceModal}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateCloudInstance}
                disabled={!cloudInstanceName.trim() || creatingCloudInstance}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                {creatingCloudInstance ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>创建中...</span>
                  </>
                ) : (
                  <>
                    <Server className="w-4 h-4" />
                    <span>创建实例</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateInstanceModal && downloadResult && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          createInstanceModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300 ${
            createInstanceModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                创建Minecraft实例
              </h3>
              <button
                onClick={handleCloseCreateInstanceModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 服务器信息 */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  服务器信息
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  类型: {selectedServer} | 版本: {selectedVersion}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  路径: {downloadResult.targetDirectory}
                </p>
              </div>

              {/* 实例名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  实例名称 *
                </label>
                <input
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="输入实例名称"
                />
              </div>

              {/* 实例描述 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  实例描述
                </label>
                <textarea
                  value={instanceDescription}
                  onChange={(e) => setInstanceDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="输入实例描述（可选）"
                  rows={3}
                />
              </div>

              {/* 启动命令 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  启动命令
                </label>
                <input
                  type="text"
                  value={instanceStartCommand}
                  onChange={(e) => setInstanceStartCommand(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="启动命令（自动生成，可手动修改）"
                />
              </div>
            </div>

            <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseCreateInstanceModal}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                onClick={createMinecraftInstance}
                disabled={!instanceName.trim() || creatingInstance}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                {creatingInstance ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>创建中...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>创建实例</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 在线游戏安装对话框 */}
      {showOnlineGameInstallModal && selectedOnlineGame && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          onlineGameInstallModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300 ${
            onlineGameInstallModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                部署 {selectedOnlineGame.name}
              </h3>
              <button
                onClick={handleCloseOnlineGameInstallModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 游戏信息 */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  游戏信息
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <strong>名称:</strong> {selectedOnlineGame.name}
                </p>
                {selectedOnlineGame.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    <strong>描述:</strong> {selectedOnlineGame.description}
                  </p>
                )}
              </div>

              {/* 安装路径 */}
              {!onlineGameDeploying && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    安装路径 *
                  </label>
                  <input
                    type="text"
                    value={onlineGameInstallPath}
                    onChange={(e) => setOnlineGameInstallPath(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="例如/home/steam/games/xxx 或 D:\Games"
                  />
                </div>
              )}

              {/* 部署进度 */}
              {onlineGameDeploying && onlineGameDeployProgress && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      部署进度
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {onlineGameDeployProgress.percentage}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${onlineGameDeployProgress.percentage}%` }}
                    ></div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {onlineGameDeployProgress.currentStep}
                  </p>
                </div>
              )}

              {/* 部署日志 */}
              {onlineGameDeploying && onlineGameDeployLogs.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    部署日志
                  </h4>
                  <div className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs font-mono max-h-32 overflow-y-auto">
                    {onlineGameDeployLogs.map((log, index) => (
                      <div key={index} className="mb-1">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 部署完成结果 */}
              {onlineGameDeployComplete && (
                <div className={`rounded-lg p-3 ${
                  onlineGameDeployResult?.success !== false
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    {onlineGameDeployResult?.success !== false ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                    <h4 className={`text-sm font-medium ${
                      onlineGameDeployResult?.success !== false
                        ? 'text-green-800 dark:text-green-400'
                        : 'text-red-800 dark:text-red-400'
                    }`}>
                      {onlineGameDeployResult?.success !== false ? '部署完成' : '部署失败'}
                    </h4>
                  </div>
                  <p className={`text-sm mt-1 ${
                    onlineGameDeployResult?.success !== false
                      ? 'text-green-700 dark:text-green-300'
                      : 'text-red-700 dark:text-red-300'
                  }`}>
                    {onlineGameDeployResult?.message || (onlineGameDeployResult?.success !== false ? '在线游戏部署完成！' : '部署过程中发生错误')}
                  </p>
                  {onlineGameDeployResult?.installPath && (
                    <p className={`text-xs mt-1 ${
                      onlineGameDeployResult?.success !== false
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      安装路径: {onlineGameDeployResult.installPath}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              {onlineGameDeployComplete ? (
                onlineGameDeployResult?.success !== false ? (
                  <>
                    <button
                      onClick={handleCloseOnlineGameInstallModal}
                      className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                    >
                      完成
                    </button>
                    <button
                      onClick={createOnlineGameInstance}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
                    >
                      <Server className="w-4 h-4" />
                      <span>创建到实例</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleCloseOnlineGameInstallModal}
                    className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>完成</span>
                  </button>
                )
              ) : (
                <>
                  <button
                    onClick={onlineGameDeploying ? cancelOnlineGameDeployment : handleCloseOnlineGameInstallModal}
                    className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                  >
                    {onlineGameDeploying ? '取消部署' : '取消'}
                  </button>
                  <button
                    onClick={startOnlineGameDeployment}
                    disabled={!onlineGameInstallPath.trim() || onlineGameDeploying}
                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    {onlineGameDeploying ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        <span>部署中...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>开始部署</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 创建整合包实例对话框 */}
      {showCreateMrpackInstanceModal && mrpackDeployResult && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          createMrpackInstanceModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300 ${
            createMrpackInstanceModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                创建整合包实例
              </h3>
              <button
                onClick={handleCloseCreateMrpackInstanceModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 整合包信息 */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <div className="flex items-start space-x-3">
                  <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                    {selectedMrpack?.icon_url ? (
                      <img
                        src={selectedMrpack.icon_url}
                        alt={selectedMrpack.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // 图片加载失败时显示默认图标
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.className = 'w-12 h-12 rounded-lg bg-green-600 flex items-center justify-center';
                            parent.innerHTML = '<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full bg-green-600 flex items-center justify-center">
                        <Package className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      整合包信息
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      名称: {selectedMrpack?.title}
                    </p>
                    {mrpackDeployResult.version && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        版本: {mrpackDeployResult.version}
                      </p>
                    )}
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      路径: {mrpackDeployResult.installPath}
                    </p>
                  </div>
                </div>
              </div>

              {/* 实例名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  实例名称 *
                </label>
                <input
                  type="text"
                  value={mrpackInstanceName}
                  onChange={(e) => setMrpackInstanceName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="输入实例名称"
                />
              </div>

              {/* 实例描述 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  实例描述
                </label>
                <textarea
                  value={mrpackInstanceDescription}
                  onChange={(e) => setMrpackInstanceDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="输入实例描述（可选）"
                  rows={3}
                />
              </div>

              {/* 启动命令 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  启动命令
                </label>
                <input
                  type="text"
                  value={mrpackInstanceStartCommand}
                  onChange={(e) => setMrpackInstanceStartCommand(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="启动命令（自动生成，可手动修改）"
                />
              </div>
            </div>

            <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseCreateMrpackInstanceModal}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                onClick={createMrpackInstance}
                disabled={!mrpackInstanceName.trim() || creatingMrpackInstance}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                {creatingMrpackInstance ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>创建中...</span>
                  </>
                ) : (
                  <>
                    <Server className="w-4 h-4" />
                    <span>创建实例</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 面板兼容性确认对话框 */}
      {showCompatibilityModal && pendingGameInstall && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          compatibilityModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 transform transition-all duration-300 ${
            compatibilityModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-orange-500" />
                <span>面板兼容性提示</span>
              </h3>
              <button
                onClick={handleCloseCompatibilityModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-4">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-1">
                      面板兼容性警告
                    </h4>
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      此游戏在您当前平台上，面板尚未适配，您也许只能使用RCON进行管理，但无法使用终端管理进程。但是您可以继续安装。
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <strong>游戏:</strong> {pendingGameInstall.info.game_nameCN}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  <strong>当前平台:</strong> {pendingGameInstall.info.currentPlatform}
                </p>
              </div>
            </div>

            <div className="flex space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseCompatibilityModal}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmIncompatibleInstall}
                className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>继续安装</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 开服文档模态框 */}
      {showDocsModal && selectedGameDocs && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          docsModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[80vw] h-[90vh] mx-4 transform transition-all duration-300 flex flex-col ${
            docsModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-blue-500" />
                <span>开服文档 - {selectedGameDocs.game_nameCN}</span>
              </h3>
              <button
                onClick={handleCloseDocsModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 p-6 overflow-hidden">
              <div className="w-full h-full bg-gray-50 dark:bg-gray-900 rounded-lg overflow-hidden">
                <iframe
                  src={selectedGameDocs.docs}
                  className="w-full h-full border-0"
                  title={`${selectedGameDocs.game_nameCN} 开服文档`}
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 帮助模态框 */}
      {showHelpModal && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
          helpModalAnimating ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 transform transition-all duration-300 ${
            helpModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                <HelpCircle className="w-5 h-5 text-blue-500" />
                <span>游戏部署帮助</span>
              </h3>
              <button
                onClick={handleCloseHelpModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto">
              <div className="space-y-6">
                {/* 安装的游戏 */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                    <Server className="w-5 h-5 text-blue-500" />
                    <span>安装的游戏</span>
                  </h4>
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                      受限于Steam游戏兼容平台，面板会自动根据您运行平台检测您当前兼容安装的游戏提供一键调用SteamCMD进行安装游戏的过程。
                    </p>
                  </div>
                </div>

                {/* 路径选择 */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                    <FolderOpen className="w-5 h-5 text-green-500" />
                    <span>路径选择</span>
                  </h4>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-3">
                    <div>
                      <p className="text-sm text-green-800 dark:text-green-200 leading-relaxed mb-2">
                        <strong>容器环境：</strong>
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300 leading-relaxed ml-4">
                        若您是将面板安装在容器当中，您应当确保正确设置了路径映射并将您的安装游戏安装在您已经映射的路径中（若使用路径映射您需要将映射的文件夹设置为777权限），若您没有调整容器映射路径，默认请将游戏安装在 <code className="bg-green-100 dark:bg-green-800 px-1 py-0.5 rounded text-xs">/home/steam/games</code> 路径下。
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-green-700 dark:text-green-300 leading-relaxed ml-4">
                        末尾可以写文件夹，例如帕鲁 <code className="bg-green-100 dark:bg-green-800 px-1 py-0.5 rounded text-xs">/home/steam/games/pal</code> 游戏服务端文件将会在 <code className="bg-green-100 dark:bg-green-800 px-1 py-0.5 rounded text-xs">/home/steam/games/pal</code> 此文件夹下。
                      </p>
                    </div>
                    <div className="pt-2 border-t border-green-200 dark:border-green-700">
                      <p className="text-sm text-green-700 dark:text-green-300 leading-relaxed">
                        <strong>非容器环境：</strong>
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300 leading-relaxed ml-4">
                        若您面板安装在非容器环境下的Linux系统中，我们并不推荐这么做，一是因为您需要手动安装或编译游戏运行库，二是您需要手动创建非root用户才能符合一些游戏的运行规则。
                      </p>
                    </div>
                    <div className="pt-2 border-t border-green-200 dark:border-green-700">
                      <a
                        href="https://docs.gsm.xiaozhuhouses.asia/%E9%83%A8%E7%BD%B2/Docker.html#%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                      >
                        <span>了解更多</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* 注意事项 */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center space-x-2">
                    <AlertCircle className="w-5 h-5 text-orange-500" />
                    <span>注意事项</span>
                  </h4>
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                    <ul className="text-sm text-orange-800 dark:text-orange-200 space-y-2">
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>安装前请确保有足够的磁盘空间</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>某些游戏可能需要额外的运行时库支持</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>安装过程中请保持网络连接稳定</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-orange-500 mt-1">•</span>
                        <span>如遇到问题，请查看终端输出日志</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseHelpModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>我知道了</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 内存警告对话框 */}
      {showMemoryWarningModal && (
        <div className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
          memoryWarningModalAnimating ? 'bg-opacity-50' : 'bg-opacity-0'
        }`}>
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full transform transition-all duration-300 ${
            memoryWarningModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}>
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="flex-shrink-0">
                  <AlertCircle className="w-8 h-8 text-orange-500" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    内存不足警告
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    系统内存可能不足以运行此游戏
                  </p>
                </div>
              </div>

              {memoryWarningInfo && (
                <div className="space-y-4">
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                    <p className="text-sm text-orange-800 dark:text-orange-200 leading-relaxed">
                      {memoryWarningInfo.message}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                      <div className="text-gray-600 dark:text-gray-400">推荐内存</div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">
                        {memoryWarningInfo.required} GB
                      </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                      <div className="text-gray-600 dark:text-gray-400">系统内存</div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">
                        {memoryWarningInfo.available} GB
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>提示：</strong>您仍然可以继续安装，但可能会遇到以下问题：
                    </p>
                    <ul className="text-sm text-blue-700 dark:text-blue-300 mt-2 space-y-1 ml-4">
                      <li>• 游戏服务器启动缓慢或失败</li>
                      <li>• 运行过程中出现卡顿或崩溃</li>
                      <li>• 系统整体性能下降</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseMemoryWarningModal}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                取消安装
              </button>
              <button
                onClick={handleContinueInstallation}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <AlertCircle className="w-4 h-4" />
                <span>继续安装</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 云服务商选择弹窗 */}
      {showCloudProviderModal && selectedGameForCloud && (
        <CloudProviderModal
          visible={showCloudProviderModal}
          gameName={selectedGameForCloud.info.game_nameCN}
          providers={Object.entries(selectedGameForCloud.info.cloud || {}).map(([providerName, providerData]) => {
            const logoUrl = Object.keys(providerData)[0]
            const purchaseUrl = providerData[logoUrl]
            return {
              name: providerName,
              logoUrl,
              purchaseUrl
            }
          })}
          onClose={handleCloseCloudProviderModal}
        />
      )}
      
      {/* 实例更新确认弹窗 */}
      {showInstanceUpdateDialog && selectedGame && (
        <ConfirmInstanceUpdateDialog
          isOpen={showInstanceUpdateDialog}
          onClose={handleCloseInstanceUpdateDialog}
          onConfirm={handleConfirmInstanceUpdate}
          instanceName={instanceName}
          gameName={selectedGame.info.game_nameCN}
        />
      )}
    </div>
  )
}

export default GameDeploymentPage