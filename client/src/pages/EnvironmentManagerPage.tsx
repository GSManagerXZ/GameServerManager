import React, { useState, useEffect } from 'react'
import {
  Coffee,
  Download,
  CheckCircle,
  AlertCircle,
  Copy,
  Trash2,
  RefreshCw,
  Monitor,
  Server,
  Loader2,
  Package
} from 'lucide-react'
import { useNotificationStore } from '@/stores/notificationStore'
import apiClient from '@/utils/api'
import socketClient from '@/utils/socket'
import { copyToClipboard } from '@/utils/clipboard'

interface JavaEnvironment {
  version: string
  platform: string
  downloadUrl: string
  installed: boolean
  installPath?: string
  javaExecutable?: string
  installing?: boolean
  installProgress?: number
  installStage?: 'download' | 'extract'
}

interface LocalSystemInfo {
  platform: string
  rawPlatform?: string  // 原始平台标识 (win32/linux/darwin)
  arch: string
}

interface PackageManager {
  name: string
  displayName: string
  available: boolean
}

interface PackageInfo {
  name: string
  description: string
  category: string
  installed: boolean
  installing?: boolean
}

interface PackageInstallTask {
  id: string
  packageName: string
  packageManager: string
  operation: 'install' | 'uninstall'
  status: 'preparing' | 'installing' | 'completed' | 'failed'
  startTime: Date
  endTime?: Date
  error?: string
}

interface VcRedistEnvironment {
  version: string
  platform: string
  downloadUrl: string
  installed: boolean
  installPath?: string
  architecture: 'x86' | 'x64' | 'arm64'
  installing?: boolean
  installProgress?: number
  installStage?: 'download' | 'install'
}

interface DirectXEnvironment {
  version: string
  platform: string
  downloadUrl: string
  installed: boolean
  installPath?: string
  installing?: boolean
  installProgress?: number
  installStage?: 'download' | 'install'
}

const EnvironmentManagerPage: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<LocalSystemInfo | null>(null)
  const [javaEnvironments, setJavaEnvironments] = useState<JavaEnvironment[]>([])
  const [vcRedistEnvironments, setVcRedistEnvironments] = useState<VcRedistEnvironment[]>([])
  const [directxEnvironments, setDirectxEnvironments] = useState<DirectXEnvironment[]>([])
  const [packageManagers, setPackageManagers] = useState<PackageManager[]>([])
  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [selectedPackageManager, setSelectedPackageManager] = useState<string>('')
  const [selectedPackages, setSelectedPackages] = useState<string[]>([])
  const [packageTasks, setPackageTasks] = useState<PackageInstallTask[]>([])
  const [showTaskProgress, setShowTaskProgress] = useState(false)
  const [taskProgressAnimating, setTaskProgressAnimating] = useState(false)
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('java')

  // 标签页数据加载状态
  const [tabLoadingStates, setTabLoadingStates] = useState({
    java: false,
    vcredist: false,
    directx: false,
    packages: false
  })

  // 标签页数据是否已加载
  const [tabDataLoaded, setTabDataLoaded] = useState({
    java: false,
    vcredist: false,
    directx: false,
    packages: false
  })

  const { addNotification } = useNotificationStore()

  // 赞助者状态
  const [sponsorStatus, setSponsorStatus] = useState<{
    isValid: boolean
    loading: boolean
  }>({
    isValid: false,
    loading: true
  })

  // Java版本配置
  const javaVersions = [
    {
      version: 'Java 8',
      key: 'java8',
      description: 'Java 8 (OpenJDK 8u44)',
      windows: 'https://download.java.net/openjdk/jdk8u44/ri/openjdk-8u44-windows-i586.zip',
      linux: 'https://download.java.net/openjdk/jdk8u44/ri/openjdk-8u44-linux-x64.tar.gz'
    },
    {
      version: 'Java 11',
      key: 'java11',
      description: 'Java 11 (OpenJDK 11.0.0.2)',
      windows: 'https://download.java.net/openjdk/jdk11.0.0.2/ri/openjdk-11.0.0.2_windows-x64.zip',
      linux: 'https://download.java.net/openjdk/jdk11.0.0.2/ri/openjdk-11.0.0.2_linux-x64.tar.gz',
      arm: 'https://aka.ms/download-jdk/microsoft-jdk-11-linux-aarch64.tar.gz'
    },
    {
      version: 'Java 17',
      key: 'java17',
      description: 'Java 17 (OpenJDK 17.0.0.1)',
      windows: 'https://download.java.net/openjdk/jdk17.0.0.1/ri/openjdk-17.0.0.1+2_windows-x64_bin.zip',
      linux: 'https://download.java.net/openjdk/jdk17.0.0.1/ri/openjdk-17.0.0.1+2_linux-x64_bin.tar.gz',
      arm: 'https://download.java.net/java/GA/jdk17.0.2/dfd4a8d0985749f896bed50d7138ee7f/8/GPL/openjdk-17.0.2_macos-aarch64_bin.tar.gz'
    },
    {
      version: 'Java 21',
      key: 'java21',
      description: 'Java 21 (OpenJDK 21)',
      windows: 'https://download.java.net/openjdk/jdk21/ri/openjdk-21+35_windows-x64_bin.zip',
      linux: 'https://download.java.net/openjdk/jdk21/ri/openjdk-21+35_linux-x64_bin.tar.gz',
      arm: 'https://download.java.net/java/GA/jdk21/fd2272bbf8e04c3dbaee13770090416c/35/GPL/openjdk-21_macos-aarch64_bin.tar.gz'
    },
    {
      version: 'Java 25',
      key: 'java25',
      description: 'Java 25 (OpenJDK 25+36)',
      windows: 'https://download.java.net/openjdk/jdk25/ri/openjdk-25+36_windows-x64_bin.zip',
      linux: 'https://download.java.net/openjdk/jdk25/ri/openjdk-25+36_linux-x64_bin.tar.gz',
      arm: 'https://download.java.net/java/GA/jdk25/bd75d5f9689641da8e1daabeccb5528b/36/GPL/openjdk-25_macos-aarch64_bin.tar.gz'
    }
  ]

  // 获取系统信息
  const fetchSystemInfo = async () => {
    try {
      const response = await apiClient.getEnvironmentSystemInfo()
      if (response.success && response.data) {
        setSystemInfo({
          platform: response.data.platform,
          rawPlatform: response.data.rawPlatform,
          arch: response.data.arch
        })
      }
    } catch (error) {
      console.error('获取系统信息失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '获取系统信息失败'
      })
    }
  }

  // 获取赞助者状态
  const fetchSponsorStatus = async () => {
    try {
      setSponsorStatus(prev => ({ ...prev, loading: true }))
      const response = await apiClient.getSponsorKeyInfo()

      if (response.success && response.data) {
        setSponsorStatus({
          isValid: response.data.isValid && !response.data.isExpired,
          loading: false
        })
      } else {
        setSponsorStatus({
          isValid: false,
          loading: false
        })
      }
    } catch (error) {
      console.error('获取赞助者状态失败:', error)
      setSponsorStatus({
        isValid: false,
        loading: false
      })
    }
  }

  // 获取Java环境列表
  const fetchJavaEnvironments = async () => {
    if (tabDataLoaded.java) return

    setTabLoadingStates(prev => ({ ...prev, java: true }))
    try {
      const response = await apiClient.getJavaEnvironments()
      if (response.success && response.data) {
        setJavaEnvironments(response.data)
        setTabDataLoaded(prev => ({ ...prev, java: true }))
      }
    } catch (error) {
      console.error('获取Java环境列表失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '获取Java环境列表失败'
      })
    } finally {
      setTabLoadingStates(prev => ({ ...prev, java: false }))
    }
  }

  // 获取Visual C++运行库环境列表
  const fetchVcRedistEnvironments = async () => {
    if (tabDataLoaded.vcredist) return

    setTabLoadingStates(prev => ({ ...prev, vcredist: true }))
    try {
      const response = await apiClient.getVcRedistEnvironments()
      if (response.success && response.data) {
        setVcRedistEnvironments(response.data)
        setTabDataLoaded(prev => ({ ...prev, vcredist: true }))
      }
    } catch (error) {
      console.error('获取Visual C++运行库环境列表失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '获取Visual C++运行库环境列表失败'
      })
    } finally {
      setTabLoadingStates(prev => ({ ...prev, vcredist: false }))
    }
  }

  // 获取DirectX环境列表
  const fetchDirectXEnvironments = async () => {
    if (tabDataLoaded.directx) return

    setTabLoadingStates(prev => ({ ...prev, directx: true }))
    try {
      const response = await apiClient.getDirectXEnvironments()
      if (response.success && response.data) {
        setDirectxEnvironments(response.data)
        setTabDataLoaded(prev => ({ ...prev, directx: true }))
      }
    } catch (error) {
      console.error('获取DirectX环境列表失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '获取DirectX环境列表失败'
      })
    } finally {
      setTabLoadingStates(prev => ({ ...prev, directx: false }))
    }
  }

  // 获取包管理器列表
  const fetchPackageManagers = async () => {
    if (tabDataLoaded.packages) return

    setTabLoadingStates(prev => ({ ...prev, packages: true }))
    try {
      const response = await apiClient.getPackageManagers()
      if (response.success && response.data) {
        setPackageManagers(response.data)
        // 如果有可用的包管理器，默认选择第一个
        if (response.data.length > 0) {
          setSelectedPackageManager(response.data[0].name)
        }
        setTabDataLoaded(prev => ({ ...prev, packages: true }))
      }
    } catch (error) {
      console.error('获取包管理器列表失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '获取包管理器列表失败'
      })
    } finally {
      setTabLoadingStates(prev => ({ ...prev, packages: false }))
    }
  }

  // 获取包列表
  const fetchPackages = async (packageManagerName: string) => {
    if (!packageManagerName) return

    setPackagesLoading(true)
    try {
      const response = await apiClient.getPackageList(packageManagerName)
      if (response.success && response.data) {
        setPackages(response.data)
      }
    } catch (error) {
      console.error('获取包列表失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '获取包列表失败'
      })
    } finally {
      setPackagesLoading(false)
    }
  }

  // 初始化数据 - 只加载系统信息和默认标签页数据
  useEffect(() => {
    const initData = async () => {
      setLoading(true)
      // 加载系统信息、赞助者状态和默认标签页（Java）的数据
      await Promise.all([
        fetchSystemInfo(),
        fetchSponsorStatus(),
        fetchJavaEnvironments() // 默认加载Java标签页
      ])
      setLoading(false)
    }
    initData()
  }, [])

  // 标签页切换时的懒加载逻辑
  const handleTabChange = async (tabName: string) => {
    setActiveTab(tabName)

    // 根据标签页加载对应的数据
    switch (tabName) {
      case 'java':
        await fetchJavaEnvironments()
        break
      case 'vcredist':
        if (systemInfo?.platform === 'win32') {
          await fetchVcRedistEnvironments()
        }
        break
      case 'directx':
        if (systemInfo?.platform === 'win32') {
          await fetchDirectXEnvironments()
        }
        break
      case 'packages':
        if (systemInfo?.platform === 'linux') {
          await fetchPackageManagers()
          // 如果已经有选中的包管理器，也加载包列表
          if (selectedPackageManager) {
            await fetchPackages(selectedPackageManager)
          }
        }
        break
    }
  }

  // 监听Java安装进度
  useEffect(() => {
    const handleInstallProgress = (data: { version: string; stage: 'download' | 'extract'; progress: number }) => {
      setJavaEnvironments(prev => prev.map(env =>
        env.version === data.version
          ? {
              ...env,
              installing: true,
              installStage: data.stage,
              installProgress: data.stage === 'download' ? data.progress * 0.7 : 70 + (data.progress * 0.3)
            }
          : env
      ))
    }

    // 监听Java安装完成
    const handleInstallComplete = (data: { version: string; success: boolean; message: string }) => {
      setJavaEnvironments(prev => prev.map(env =>
        env.version === data.version
          ? { ...env, installing: false, installProgress: 0, installStage: undefined }
          : env
      ))

      addNotification({
        type: data.success ? 'success' : 'error',
        title: data.success ? '成功' : '错误',
        message: data.message
      })

      if (data.success) {
        fetchJavaEnvironments()
      }
    }

    // 监听Visual C++运行库安装进度
    const handleVcRedistInstallProgress = (data: { version: string; architecture: string; stage: 'download' | 'install'; progress: number }) => {
      setVcRedistEnvironments(prev => prev.map(env =>
        env.version === data.version && env.architecture === data.architecture
          ? {
              ...env,
              installing: true,
              installStage: data.stage,
              installProgress: data.stage === 'download' ? data.progress * 0.5 : 50 + (data.progress * 0.5)
            }
          : env
      ))
    }

    // 监听Visual C++运行库安装完成
    const handleVcRedistInstallComplete = (data: { version: string; architecture: string; success: boolean; message: string }) => {
      setVcRedistEnvironments(prev => prev.map(env =>
        env.version === data.version && env.architecture === data.architecture
          ? { ...env, installing: false, installProgress: 0, installStage: undefined }
          : env
      ))

      addNotification({
        type: data.success ? 'success' : 'error',
        title: data.success ? '成功' : '错误',
        message: data.message
      })

      if (data.success) {
        // 立即刷新一次
        fetchVcRedistEnvironments()

        // 5秒后再次刷新，确保检测到安装状态
        setTimeout(() => {
          fetchVcRedistEnvironments()
        }, 5000)

        // 10秒后最后一次刷新
        setTimeout(() => {
          fetchVcRedistEnvironments()
        }, 10000)
      }
    }

    // 监听Visual C++运行库卸载完成
    const handleVcRedistUninstallComplete = (data: { version: string; architecture: string; success: boolean; message: string }) => {
      addNotification({
        type: data.success ? 'success' : 'error',
        title: data.success ? '成功' : '错误',
        message: data.message
      })

      if (data.success) {
        // 立即刷新一次
        fetchVcRedistEnvironments()

        // 3秒后再次刷新，确保检测到卸载状态
        setTimeout(() => {
          fetchVcRedistEnvironments()
        }, 3000)
      }
    }

    // 监听DirectX安装进度
    const handleDirectXInstallProgress = (data: { stage: 'download' | 'install'; progress: number }) => {
      setDirectxEnvironments(prev => prev.map(env =>
        env.version === 'DirectX 9.0c'
          ? {
              ...env,
              installing: true,
              installProgress: data.progress,
              installStage: data.stage
            }
          : env
      ))
    }

    // 监听DirectX安装完成
    const handleDirectXInstallComplete = (data: { success: boolean; message: string }) => {
      setDirectxEnvironments(prev => prev.map(env =>
        env.version === 'DirectX 9.0c'
          ? { ...env, installing: false, installProgress: 0, installStage: undefined }
          : env
      ))

      addNotification({
        type: data.success ? 'success' : 'error',
        title: data.success ? '成功' : '错误',
        message: data.message
      })

      if (data.success) {
        // 立即刷新一次
        fetchDirectXEnvironments()

        // 5秒后再次刷新，确保检测到安装状态
        setTimeout(() => {
          fetchDirectXEnvironments()
        }, 5000)
      }
    }

    // 监听包任务进度
    const handlePackageTaskProgress = (task: PackageInstallTask) => {
      setPackageTasks(prev => {
        // 尝试通过包名和操作类型匹配任务（因为服务端生成的ID可能不同）
        const existingIndex = prev.findIndex(t =>
          t.packageName === task.packageName &&
          t.operation === task.operation &&
          t.packageManager === task.packageManager &&
          (t.status === 'preparing' || t.status === 'installing')
        )

        if (existingIndex >= 0) {
          // 更新现有任务
          const updated = [...prev]
          updated[existingIndex] = {
            ...updated[existingIndex],
            status: task.status,
            error: task.error,
            endTime: task.endTime ? new Date(task.endTime) : undefined
          }
          return updated
        } else {
          // 如果找不到匹配的任务，添加新任务
          return [...prev, { ...task, startTime: new Date(task.startTime) }]
        }
      })
    }

    // 监听包安装/卸载完成
    const handlePackageInstallComplete = (data: { packageManager: string; packages: string[]; success: boolean; message: string }) => {
      addNotification({
        type: data.success ? 'success' : 'error',
        title: data.success ? '成功' : '错误',
        message: data.message
      })

      // 刷新包列表
      if (data.success) {
        fetchPackages(data.packageManager)
      }
    }

    const handlePackageUninstallComplete = (data: { packageManager: string; packages: string[]; success: boolean; message: string }) => {
      addNotification({
        type: data.success ? 'success' : 'error',
        title: data.success ? '成功' : '错误',
        message: data.message
      })

      // 刷新包列表
      if (data.success) {
        fetchPackages(data.packageManager)
      }
    }

    socketClient.on('java-install-progress', handleInstallProgress)
    socketClient.on('java-install-complete', handleInstallComplete)
    socketClient.on('vcredist-install-progress', handleVcRedistInstallProgress)
    socketClient.on('vcredist-install-complete', handleVcRedistInstallComplete)
    socketClient.on('vcredist-uninstall-complete', handleVcRedistUninstallComplete)
    socketClient.on('directx-install-progress', handleDirectXInstallProgress)
    socketClient.on('directx-install-complete', handleDirectXInstallComplete)
    socketClient.on('package-task-progress', handlePackageTaskProgress)
    socketClient.on('package-install-complete', handlePackageInstallComplete)
    socketClient.on('package-uninstall-complete', handlePackageUninstallComplete)

    return () => {
      socketClient.off('java-install-progress', handleInstallProgress)
      socketClient.off('java-install-complete', handleInstallComplete)
      socketClient.off('vcredist-install-progress', handleVcRedistInstallProgress)
      socketClient.off('vcredist-install-complete', handleVcRedistInstallComplete)
      socketClient.off('vcredist-uninstall-complete', handleVcRedistUninstallComplete)
      socketClient.off('directx-install-progress', handleDirectXInstallProgress)
      socketClient.off('directx-install-complete', handleDirectXInstallComplete)
      socketClient.off('package-task-progress', handlePackageTaskProgress)
      socketClient.off('package-install-complete', handlePackageInstallComplete)
      socketClient.off('package-uninstall-complete', handlePackageUninstallComplete)
    }
  }, [])

  // 监听选中的包管理器变化，获取对应的包列表
  useEffect(() => {
    if (selectedPackageManager && activeTab === 'packages') {
      fetchPackages(selectedPackageManager)
    }
  }, [selectedPackageManager, activeTab])

  // 处理进度窗口淡入动画
  useEffect(() => {
    if (showTaskProgress) {
      // 延迟触发淡入动画，确保DOM已渲染
      const timer = setTimeout(() => {
        setTaskProgressAnimating(true)
      }, 50) // 稍长的延迟确保DOM完全渲染

      return () => clearTimeout(timer)
    } else {
      // 窗口关闭时重置动画状态
      setTaskProgressAnimating(false)
    }
  }, [showTaskProgress])

  // 刷新数据 - 只刷新当前活跃标签页的数据
  const handleRefresh = async () => {
    setRefreshing(true)

    // 刷新赞助者状态
    await fetchSponsorStatus()

    // 根据当前活跃标签页刷新对应数据
    switch (activeTab) {
      case 'java':
        // 重置加载状态，强制重新加载
        setTabDataLoaded(prev => ({ ...prev, java: false }))
        await fetchJavaEnvironments()
        break
      case 'vcredist':
        if (systemInfo?.platform === 'win32') {
          setTabDataLoaded(prev => ({ ...prev, vcredist: false }))
          await fetchVcRedistEnvironments()
        }
        break
      case 'directx':
        if (systemInfo?.platform === 'win32') {
          setTabDataLoaded(prev => ({ ...prev, directx: false }))
          await fetchDirectXEnvironments()
        }
        break
      case 'packages':
        if (systemInfo?.platform === 'linux') {
          setTabDataLoaded(prev => ({ ...prev, packages: false }))
          await fetchPackageManagers()
          if (selectedPackageManager) {
            await fetchPackages(selectedPackageManager)
          }
        }
        break
    }

    setRefreshing(false)
  }

  // 安装Java环境
  const handleInstallJava = async (version: string) => {
    if (!systemInfo) {
      addNotification({
        type: 'error',
        title: '错误',
        message: '系统信息未加载'
      })
      return
    }

    const javaConfig = javaVersions.find(v => v.key === version)
    if (!javaConfig) {
      addNotification({
        type: 'error',
        title: '错误',
        message: '未找到Java版本配置'
      })
      return
    }

    // 根据平台和架构选择下载URL
    let downloadUrl: string
    if (systemInfo.platform === 'win32') {
      downloadUrl = javaConfig.windows
    } else if (systemInfo.arch === 'arm64' || systemInfo.arch === 'aarch64') {
      // ARM架构
      downloadUrl = (javaConfig as any).arm || javaConfig.linux
    } else {
      // x64架构
      downloadUrl = javaConfig.linux
    }

    try {
      // 更新安装状态
      setJavaEnvironments(prev => prev.map(env =>
        env.version === version
          ? { ...env, installing: true, installProgress: 0 }
          : env
      ))

      const response = await apiClient.installJavaEnvironment({
        version,
        downloadUrl,
        platform: systemInfo.platform,
        socketId: socketClient.getId()
      })

      if (!response.success) {
        addNotification({
          type: 'error',
          title: '错误',
          message: `${javaConfig.version} 启动安装失败: ${response.message}`
        })
        // 重置安装状态
        setJavaEnvironments(prev => prev.map(env =>
          env.version === version
            ? { ...env, installing: false, installProgress: 0 }
            : env
        ))
      }
    } catch (error) {
      console.error('安装Java环境失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: `${javaConfig.version} 安装失败`
      })
      // 重置安装状态
      setJavaEnvironments(prev => prev.map(env =>
        env.version === version
          ? { ...env, installing: false, installProgress: 0 }
          : env
      ))
    }
  }

  // 卸载Java环境
  const handleUninstallJava = async (version: string) => {
    try {
      const response = await apiClient.uninstallJavaEnvironment(version)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '成功',
          message: `${version} 卸载成功`
        })
        await fetchJavaEnvironments()
      } else {
        addNotification({
          type: 'error',
          title: '错误',
          message: `${version} 卸载失败: ${response.message}`
        })
      }
    } catch (error) {
      console.error('卸载Java环境失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: `${version} 卸载失败`
      })
    }
  }

  // 安装Visual C++运行库
  const handleInstallVcRedist = async (version: string, architecture: string, downloadUrl: string) => {
    if (!systemInfo) {
      addNotification({
        type: 'error',
        title: '错误',
        message: '系统信息未加载'
      })
      return
    }

    if (systemInfo.platform !== 'win32') {
      addNotification({
        type: 'error',
        title: '错误',
        message: 'Visual C++运行库只能在Windows系统上安装'
      })
      return
    }

    try {
      // 更新安装状态
      setVcRedistEnvironments(prev => prev.map(env =>
        env.version === version && env.architecture === architecture
          ? { ...env, installing: true, installProgress: 0 }
          : env
      ))

      const response = await apiClient.installVcRedistEnvironment({
        version,
        architecture,
        downloadUrl,
        socketId: socketClient.getId()
      })

      if (!response.success) {
        addNotification({
          type: 'error',
          title: '错误',
          message: `${version} ${architecture} 启动安装失败: ${response.message}`
        })
        // 重置安装状态
        setVcRedistEnvironments(prev => prev.map(env =>
          env.version === version && env.architecture === architecture
            ? { ...env, installing: false, installProgress: 0 }
            : env
        ))
      }
    } catch (error) {
      console.error('安装Visual C++运行库失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: `${version} ${architecture} 安装失败`
      })
      // 重置安装状态
      setVcRedistEnvironments(prev => prev.map(env =>
        env.version === version && env.architecture === architecture
          ? { ...env, installing: false, installProgress: 0 }
          : env
      ))
    }
  }

  // 卸载Visual C++运行库
  const handleUninstallVcRedist = async (version: string, architecture: string) => {
    try {
      const response = await apiClient.uninstallVcRedistEnvironment(version, architecture, socketClient.getId())
      if (response.success) {
        addNotification({
          type: 'info',
          title: '提示',
          message: response.message || `${version} ${architecture} 卸载命令已下发`
        })
      } else {
        addNotification({
          type: 'error',
          title: '错误',
          message: `${version} ${architecture} 卸载失败: ${response.message}`
        })
      }
    } catch (error) {
      console.error('卸载Visual C++运行库失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: `${version} ${architecture} 卸载失败`
      })
    }
  }

  // 安装DirectX
  const handleInstallDirectX = async (downloadUrl: string) => {
    try {
      // 更新安装状态
      setDirectxEnvironments(prev => prev.map(env =>
        env.version === 'DirectX 9.0c'
          ? { ...env, installing: true, installProgress: 0 }
          : env
      ))

      const response = await apiClient.installDirectXEnvironment({
        downloadUrl,
        socketId: socketClient.getId()
      })

      if (!response.success) {
        addNotification({
          type: 'error',
          title: '错误',
          message: `DirectX 启动安装失败: ${response.message}`
        })
        // 重置安装状态
        setDirectxEnvironments(prev => prev.map(env =>
          env.version === 'DirectX 9.0c'
            ? { ...env, installing: false, installProgress: 0 }
            : env
        ))
      }
    } catch (error) {
      console.error('安装DirectX失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: 'DirectX 安装失败'
      })
      // 重置安装状态
      setDirectxEnvironments(prev => prev.map(env =>
        env.version === 'DirectX 9.0c'
          ? { ...env, installing: false, installProgress: 0 }
          : env
      ))
    }
  }

  // 清理DirectX文件
  const handleUninstallDirectX = async () => {
    // 显示确认对话框
    if (!window.confirm('确定要清理DirectX安装文件吗？\n\n注意：这只会删除下载的安装文件，不会卸载已安装的DirectX系统组件。')) {
      return
    }

    try {
      const response = await apiClient.uninstallDirectXEnvironment()
      if (response.success) {
        addNotification({
          type: 'success',
          title: '成功',
          message: 'DirectX 安装文件已清理'
        })
        await fetchDirectXEnvironments()
      } else {
        addNotification({
          type: 'error',
          title: '错误',
          message: `DirectX 文件清理失败: ${response.message}`
        })
      }
    } catch (error) {
      console.error('清理DirectX文件失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: 'DirectX 文件清理失败'
      })
    }
  }

  // 复制Java路径
  const handleCopyJavaPath = async (javaExecutable: string) => {
    try {
      const success = await copyToClipboard(javaExecutable)

      if (success) {
        addNotification({
          type: 'success',
          title: '成功',
          message: 'Java路径已复制到剪贴板'
        })
      } else {
        addNotification({
          type: 'error',
          title: '错误',
          message: '复制失败，请手动复制'
        })
      }
    } catch (error) {
      console.error('复制Java路径失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '复制失败'
      })
    }
  }

  // 处理包选择
  const handlePackageSelect = (packageName: string, checked: boolean) => {
    if (checked) {
      setSelectedPackages(prev => [...prev, packageName])
    } else {
      setSelectedPackages(prev => prev.filter(name => name !== packageName))
    }
  }

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allPackageNames = packages.map(pkg => pkg.name)
      setSelectedPackages(allPackageNames)
    } else {
      setSelectedPackages([])
    }
  }

  // 批量安装包
  const handleBatchInstall = async () => {
    if (!selectedPackageManager || selectedPackages.length === 0) {
      addNotification({
        type: 'warning',
        title: '警告',
        message: '请选择要安装的包'
      })
      return
    }

    const uninstalledPackages = selectedPackages.filter(name => {
      const pkg = packages.find(p => p.name === name)
      return pkg && !pkg.installed
    })

    if (uninstalledPackages.length === 0) {
      addNotification({
        type: 'warning',
        title: '警告',
        message: '所选包均已安装'
      })
      return
    }

    try {
      // 预先创建所有任务并显示
      const newTasks: PackageInstallTask[] = uninstalledPackages.map((packageName, index) => ({
        id: `${selectedPackageManager}-install-${Date.now()}-${index}`,
        packageName,
        packageManager: selectedPackageManager,
        operation: 'install',
        status: 'preparing',
        startTime: new Date()
      }))

      setPackageTasks(prev => [...prev, ...newTasks])
      showTaskProgressModal()

      await apiClient.installPackages({
        packageManager: selectedPackageManager,
        packages: uninstalledPackages,
        socketId: socketClient.getId()
      })

      addNotification({
        type: 'success',
        title: '成功',
        message: '操作命令已下发'
      })

      setSelectedPackages([])
    } catch (error) {
      console.error('批量安装失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '批量安装失败'
      })
    }
  }

  // 批量卸载包
  const handleBatchUninstall = async () => {
    if (!selectedPackageManager || selectedPackages.length === 0) {
      addNotification({
        type: 'warning',
        title: '警告',
        message: '请选择要卸载的包'
      })
      return
    }

    const installedPackages = selectedPackages.filter(name => {
      const pkg = packages.find(p => p.name === name)
      return pkg && pkg.installed
    })

    if (installedPackages.length === 0) {
      addNotification({
        type: 'warning',
        title: '警告',
        message: '所选包均未安装'
      })
      return
    }

    try {
      // 预先创建所有任务并显示
      const newTasks: PackageInstallTask[] = installedPackages.map((packageName, index) => ({
        id: `${selectedPackageManager}-uninstall-${Date.now()}-${index}`,
        packageName,
        packageManager: selectedPackageManager,
        operation: 'uninstall',
        status: 'preparing',
        startTime: new Date()
      }))

      setPackageTasks(prev => [...prev, ...newTasks])
      showTaskProgressModal()

      await apiClient.uninstallPackages({
        packageManager: selectedPackageManager,
        packages: installedPackages,
        socketId: socketClient.getId()
      })

      addNotification({
        type: 'success',
        title: '成功',
        message: '操作命令已下发'
      })

      setSelectedPackages([])
    } catch (error) {
      console.error('批量卸载失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '批量卸载失败'
      })
    }
  }

  // 单个包安装
  const handleSingleInstall = async (packageName: string) => {
    if (!selectedPackageManager) return

    try {
      // 预先创建任务并显示
      const newTask: PackageInstallTask = {
        id: `${selectedPackageManager}-install-${Date.now()}-single`,
        packageName,
        packageManager: selectedPackageManager,
        operation: 'install',
        status: 'preparing',
        startTime: new Date()
      }

      setPackageTasks(prev => [...prev, newTask])
      showTaskProgressModal()

      await apiClient.installPackages({
        packageManager: selectedPackageManager,
        packages: [packageName],
        socketId: socketClient.getId()
      })

      addNotification({
        type: 'success',
        title: '成功',
        message: '操作命令已下发'
      })
    } catch (error) {
      console.error('安装失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '安装失败'
      })
    }
  }

  // 单个包卸载
  const handleSingleUninstall = async (packageName: string) => {
    if (!selectedPackageManager) return

    try {
      // 预先创建任务并显示
      const newTask: PackageInstallTask = {
        id: `${selectedPackageManager}-uninstall-${Date.now()}-single`,
        packageName,
        packageManager: selectedPackageManager,
        operation: 'uninstall',
        status: 'preparing',
        startTime: new Date()
      }

      setPackageTasks(prev => [...prev, newTask])
      showTaskProgressModal()

      await apiClient.uninstallPackages({
        packageManager: selectedPackageManager,
        packages: [packageName],
        socketId: socketClient.getId()
      })

      addNotification({
        type: 'success',
        title: '成功',
        message: '操作命令已下发'
      })
    } catch (error) {
      console.error('卸载失败:', error)
      addNotification({
        type: 'error',
        title: '错误',
        message: '卸载失败'
      })
    }
  }

  // 显示进度窗口
  const showTaskProgressModal = () => {
    setShowTaskProgress(true) // DOM会被创建，useEffect会处理动画
  }

  // 隐藏进度窗口
  const hideTaskProgressModal = () => {
    setTaskProgressAnimating(false) // 触发淡出动画
    setTimeout(() => {
      setShowTaskProgress(false)
    }, 300) // 等待淡出动画完成（与CSS动画时间一致）
  }

  // 获取平台图标
  const getPlatformIcon = () => {
    if (!systemInfo) return <Monitor className="w-4 h-4" />
    // 优先使用 rawPlatform，回退到检查 platform 字段
    const isWindows = systemInfo?.rawPlatform
      ? systemInfo.rawPlatform === 'win32'
      : systemInfo.platform?.toLowerCase().includes('windows')
    return isWindows
      ? <Monitor className="w-4 h-4" />
      : <Server className="w-4 h-4" />
  }

  // 获取平台名称
  const getPlatformName = () => {
    if (!systemInfo) return '未知'
    // 优先使用 rawPlatform，回退到检查 platform 字段
    const isWindows = systemInfo?.rawPlatform
      ? systemInfo.rawPlatform === 'win32'
      : systemInfo.platform?.toLowerCase().includes('windows')
    return isWindows ? 'Windows' : 'Linux'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">正在加载环境信息...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Coffee className="w-6 h-6 mr-2 text-orange-500" />
            环境管理
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">管理和安装各种开发环境</p>
        </div>
        <button 
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>
      </div>

      {/* 赞助者状态提示 */}
      {!sponsorStatus.loading && (
        <div className={`rounded-lg p-4 border ${
          sponsorStatus.isValid
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
        }`}>
          <div className="flex items-start space-x-3">
            <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
              sponsorStatus.isValid
                ? 'bg-green-500'
                : 'bg-yellow-500'
            }`}>
              {sponsorStatus.isValid ? (
                <CheckCircle className="w-3 h-3 text-white" />
              ) : (
                <AlertCircle className="w-3 h-3 text-white" />
              )}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                sponsorStatus.isValid
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-yellow-800 dark:text-yellow-200'
              }`}>
                {sponsorStatus.isValid ? (
                  '您现已是赞助者，专享国内高速服务器下载Java环境'
                ) : (
                  <>
                    Java环境安装现已支持赞助者专享国内高速服务器下载，您当前还不是赞助者，欢迎前往
                    <a
                      href="https://afdian.com/a/xiaozhuhouses"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline ml-1"
                    >
                      爱发电
                    </a>
                    赞助
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 系统信息 */}
      {systemInfo && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center space-x-2">
            {getPlatformIcon()}
            <span className="text-blue-800 dark:text-blue-200">
              当前系统: {getPlatformName()} ({systemInfo.arch})
            </span>
          </div>
        </div>
      )}

      {/* 环境管理标签页 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        {/* 标签页头部 */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8 px-6">
            <button
              onClick={() => handleTabChange('java')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'java'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Coffee className="w-4 h-4" />
                <span>Java 环境</span>
                {tabLoadingStates.java && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
              </div>
            </button>
            {/* 只在Windows系统上显示Microsoft Visual C++标签页 */}
            {systemInfo?.platform === 'win32' && (
              <button
                onClick={() => handleTabChange('vcredist')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'vcredist'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Package className="w-4 h-4" />
                  <span>Microsoft Visual C++</span>
                  {tabLoadingStates.vcredist && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                </div>
              </button>
            )}
            {/* 只在Windows系统上显示DirectX标签页 */}
            {systemInfo?.platform === 'win32' && (
              <button
                onClick={() => handleTabChange('directx')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'directx'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Monitor className="w-4 h-4" />
                  <span>DirectX</span>
                  {tabLoadingStates.directx && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                </div>
              </button>
            )}
            {/* 只在Linux系统上显示动态链接库标签页 */}
            {systemInfo?.platform === 'linux' && (
              <button
                onClick={() => handleTabChange('packages')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'packages'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Package className="w-4 h-4" />
                  <span>动态链接库</span>
                  {tabLoadingStates.packages && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                </div>
              </button>
            )}
          </nav>
        </div>

        {/* 标签页内容 */}
        <div className="p-6">
          {activeTab === 'java' && (
            <>
              {tabLoadingStates.java ? (
                <div className="text-center py-12">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">正在加载Java环境信息...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {javaVersions.map((javaConfig) => {
                const env = javaEnvironments.find(e => e.version === javaConfig.key)
                const isInstalled = env?.installed || false
                const isInstalling = env?.installing || false
                
                return (
                  <div
                    key={javaConfig.key}
                    className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 border border-gray-200 dark:border-gray-600"
                  >
                    {/* 卡片头部 */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-2">
                        <Coffee className="w-5 h-5 text-orange-500" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {javaConfig.version}
                        </h3>
                      </div>
                      <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
                        isInstalled 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300'
                      }`}>
                        {isInstalled ? (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            <span>已安装</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3 h-3" />
                            <span>未安装</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 描述 */}
                    <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                      {javaConfig.description}
                    </p>

                    {/* 安装进度 */}
                    {isInstalling && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                          <span>
                            {env?.installStage === 'download' ? '正在下载...' :
                             env?.installStage === 'extract' ? '正在解压...' : '正在安装...'}
                          </span>
                          <span>{Math.round(env?.installProgress || 0)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${env?.installProgress || 0}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {env?.installStage === 'download' ? '下载阶段 (70%)' :
                           env?.installStage === 'extract' ? '解压阶段 (30%)' : ''}
                        </div>
                      </div>
                    )}

                    {/* Java路径 */}
                    {isInstalled && env?.javaExecutable && (
                      <div className="mb-4">
                        <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">启动命令:</p>
                        <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded border text-xs font-mono break-all">
                          {env.javaExecutable}
                        </div>
                        <button
                          onClick={() => handleCopyJavaPath(env.javaExecutable!)}
                          className="mt-2 flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          <Copy className="w-3 h-3" />
                          <span>复制路径</span>
                        </button>
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex space-x-2">
                      {!isInstalled ? (
                        <button
                          onClick={() => handleInstallJava(javaConfig.key)}
                          disabled={isInstalling}
                          className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                        >
                          {isInstalling ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>安装中...</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4" />
                              <span>安装</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUninstallJava(javaConfig.key)}
                          className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>卸载</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
                </div>
              )}
            </>
          )}

          {/* Visual C++运行库标签页内容 */}
          {activeTab === 'vcredist' && systemInfo?.platform === 'win32' && (
            <>
              {tabLoadingStates.vcredist ? (
                <div className="text-center py-12">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">正在加载Visual C++运行库信息...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                      Microsoft Visual C++ 运行库
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400">
                      安装各版本的Microsoft Visual C++运行库，确保应用程序正常运行
                    </p>
                  </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {vcRedistEnvironments.map((env) => {
                  const isInstalling = env.installing || false

                  return (
                    <div
                      key={`${env.version}-${env.architecture}`}
                      className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 border border-gray-200 dark:border-gray-600"
                    >
                      {/* 卡片头部 */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2">
                          <Package className="w-5 h-5 text-blue-500" />
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {env.version}
                          </h3>
                          <span className="px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded">
                            {env.architecture}
                          </span>
                        </div>
                        <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
                          env.installed
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300'
                        }`}>
                          {env.installed ? (
                            <>
                              <CheckCircle className="w-3 h-3" />
                              <span>已安装</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3" />
                              <span>未安装</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* 描述 */}
                      <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                        Microsoft Visual C++ {env.version.replace('Visual C++ ', '')} 运行库 ({env.architecture})
                      </p>

                      {/* 安装进度 */}
                      {isInstalling && env.installProgress !== undefined && (
                        <div className="mb-4">
                          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                            <span>
                              {env.installStage === 'download' ? '下载中...' : '安装中...'}
                            </span>
                            <span>{env.installProgress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${env.installProgress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 操作按钮 */}
                      <div className="flex space-x-2">
                        {!env.installed ? (
                          <button
                            onClick={() => handleInstallVcRedist(env.version, env.architecture, env.downloadUrl)}
                            disabled={isInstalling}
                            className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>安装中...</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                <span>安装</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <>
                            <div className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-lg">
                              <CheckCircle className="w-4 h-4" />
                              <span>已安装</span>
                            </div>
                            <button
                              onClick={() => handleUninstallVcRedist(env.version, env.architecture)}
                              className="flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>卸载</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

                  {vcRedistEnvironments.length === 0 && (
                    <div className="text-center py-12">
                      <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 dark:text-gray-400">暂无可用的运行库</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* DirectX标签页内容 */}
          {activeTab === 'directx' && systemInfo?.platform === 'win32' && (
            <>
              {tabLoadingStates.directx ? (
                <div className="text-center py-12">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">正在加载DirectX环境信息...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                      DirectX 9.0c 运行库
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-3">
                      安装DirectX 9.0c运行时组件，确保老游戏和多媒体应用程序正常运行
                    </p>
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>说明：</strong> 即使您的系统有DirectX 12，许多老游戏仍需要DirectX 9.0c的特定运行时组件。
                    这些组件不会随DirectX 12自动安装。
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {directxEnvironments.map((env) => {
                  const isInstalling = env.installing || false

                  return (
                    <div
                      key={env.version}
                      className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 border border-gray-200 dark:border-gray-600"
                    >
                      {/* 卡片头部 */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2">
                          <Monitor className="w-5 h-5 text-blue-500" />
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {env.version}
                          </h3>
                        </div>
                        <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
                          env.installed
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300'
                        }`}>
                          {env.installed ? (
                            <>
                              <CheckCircle className="w-3 h-3" />
                              <span>已安装</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3" />
                              <span>未安装</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* 描述 */}
                      <div className="mb-4">
                        <p className="text-gray-600 dark:text-gray-400 text-sm mb-2">
                          DirectX 9.0c 运行时组件，包含d3dx9、xinput1_3、xaudio2_7等老游戏必需的DLL文件
                        </p>
                        {env.installed && env.installPath && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            安装文件位置: {env.installPath}
                          </p>
                        )}
                        {!env.installed && (
                          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-2 mt-2">
                            <p className="text-xs text-yellow-800 dark:text-yellow-200">
                              <strong>为什么需要安装？</strong> 即使系统有DirectX 12，老游戏仍需要DirectX 9.0c的特定运行时文件。
                              这些文件不会自动包含在新版DirectX中。
                            </p>
                          </div>
                        )}
                        {env.installed && (
                          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-2 mt-2">
                            <p className="text-xs text-green-800 dark:text-green-200">
                              <strong>已安装：</strong> 检测到DirectX 9.0c运行时组件。"清理文件"仅删除安装程序，不影响已安装的组件。
                            </p>
                          </div>
                        )}
                      </div>

                      {/* 安装进度 */}
                      {isInstalling && env.installProgress !== undefined && (
                        <div className="mb-4">
                          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                            <span>
                              {env.installStage === 'download' ? '下载中...' : '安装中...'}
                            </span>
                            <span>{env.installProgress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${env.installProgress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 操作按钮 */}
                      <div className="flex space-x-2">
                        {!env.installed ? (
                          <button
                            onClick={() => handleInstallDirectX(env.downloadUrl)}
                            disabled={isInstalling}
                            className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>安装中...</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                <span>安装</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <>
                            <div className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-lg">
                              <CheckCircle className="w-4 h-4" />
                              <span>已安装</span>
                            </div>
                            <button
                              onClick={() => handleUninstallDirectX()}
                              className="flex items-center justify-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
                              title="清理DirectX安装文件（不会卸载系统组件）"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>清理文件</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

                  {directxEnvironments.length === 0 && (
                    <div className="text-center py-12">
                      <Monitor className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 dark:text-gray-400">暂无可用的DirectX运行库</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 动态链接库标签页内容 */}
          {activeTab === 'packages' && systemInfo?.platform === 'linux' && (
            <>
              {tabLoadingStates.packages ? (
                <div className="text-center py-12">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">正在加载包管理器信息...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                      动态链接库管理
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400">
                      管理系统动态链接库，确保游戏服务器运行所需的依赖库
                    </p>
                  </div>

                  {/* 包管理器选择 */}
                  {packageManagers.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      <span className="text-blue-800 dark:text-blue-200 font-medium">包管理器:</span>
                      <select
                        value={selectedPackageManager}
                        onChange={(e) => setSelectedPackageManager(e.target.value)}
                        className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-3 py-1 text-sm"
                      >
                        {packageManagers.map(pm => (
                          <option key={pm.name} value={pm.name}>
                            {pm.displayName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 操作按钮区域 */}
                    <div className="flex items-center space-x-2">
                      {/* 进度按钮 */}
                      {packageTasks.length > 0 && (
                        <button
                          onClick={() => showTaskProgress ? hideTaskProgressModal() : showTaskProgressModal()}
                          className="flex items-center space-x-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                        >
                          <Loader2 className="w-4 h-4" />
                          <span>任务进度 ({packageTasks.filter(t => t.status === 'installing' || t.status === 'preparing').length})</span>
                        </button>
                      )}

                      {/* 批量操作按钮 */}
                      {selectedPackages.length > 0 && (
                        <>
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            已选择 {selectedPackages.length} 个包
                          </span>
                          <button
                            onClick={handleBatchInstall}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                          >
                            批量安装
                          </button>
                          <button
                            onClick={handleBatchUninstall}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                          >
                            批量卸载
                          </button>
                          <button
                            onClick={() => setSelectedPackages([])}
                            className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded transition-colors"
                          >
                            清空选择
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

                  {/* 包列表 */}
                  {!packagesLoading && packages.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  {/* 表头 */}
                  <div className="border-b border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={selectedPackages.length === packages.length}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="font-medium text-gray-900 dark:text-white">全选</span>
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        共 {packages.length} 个包，已安装 {packages.filter(p => p.installed).length} 个
                      </div>
                    </div>
                  </div>

                  {/* 按分类分组显示包 */}
                  {Object.entries(
                    packages.reduce((groups, pkg) => {
                      const category = pkg.category || '其他'
                      if (!groups[category]) groups[category] = []
                      groups[category].push(pkg)
                      return groups
                    }, {} as Record<string, typeof packages>)
                  ).map(([category, categoryPackages]) => (
                    <div key={category} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                      {/* 分类标题 */}
                      <div className="bg-gray-50 dark:bg-gray-700/50 px-4 py-2 border-b border-gray-200 dark:border-gray-600">
                        <h3 className="font-medium text-gray-900 dark:text-white">{category}</h3>
                      </div>

                      {/* 分类下的包列表 */}
                      <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {categoryPackages.map((pkg) => (
                          <div key={pkg.name} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3 flex-1">
                                <input
                                  type="checkbox"
                                  checked={selectedPackages.includes(pkg.name)}
                                  onChange={(e) => handlePackageSelect(pkg.name, e.target.checked)}
                                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2">
                                    <span className="font-medium text-gray-900 dark:text-white font-mono text-sm">
                                      {pkg.name}
                                    </span>
                                    <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
                                      pkg.installed
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                        : 'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-300'
                                    }`}>
                                      {pkg.installed ? (
                                        <>
                                          <CheckCircle className="w-3 h-3" />
                                          <span>已安装</span>
                                        </>
                                      ) : (
                                        <>
                                          <AlertCircle className="w-3 h-3" />
                                          <span>未安装</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    {pkg.description}
                                  </p>
                                </div>
                              </div>

                              {/* 单个包操作按钮 */}
                              <div className="flex items-center space-x-2">
                                {pkg.installed ? (
                                  <button
                                    onClick={() => handleSingleUninstall(pkg.name)}
                                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                                  >
                                    卸载
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleSingleInstall(pkg.name)}
                                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                                  >
                                    安装
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

                  {/* 正在检测包列表 */}
                  {packagesLoading && (
                    <div className="text-center py-12">
                      <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
                      <p className="text-gray-500 dark:text-gray-400">正在检测可用的包...</p>
                    </div>
                  )}

                  {/* 空状态 */}
                  {!packagesLoading && packageManagers.length === 0 && (
                    <div className="text-center py-12">
                      <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 dark:text-gray-400">当前系统不支持包管理器或未检测到可用的包管理器</p>
                    </div>
                  )}

                  {!packagesLoading && packageManagers.length > 0 && packages.length === 0 && selectedPackageManager && (
                    <div className="text-center py-12">
                      <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 dark:text-gray-400">暂无可用的包</p>
                    </div>
                  )}

              {/* 任务进度显示窗口 */}
              {showTaskProgress && packageTasks.length > 0 && (
                <div
                  className={`fixed inset-0 bg-black flex items-center justify-center z-50 transition-all duration-200 ease-in-out ${
                    taskProgressAnimating ? 'bg-opacity-50' : 'bg-opacity-0'
                  }`}
                  onClick={hideTaskProgressModal}
                >
                  <div
                    className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-96 overflow-hidden transform transition-all duration-300 ease-out ${
                      taskProgressAnimating ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 窗口头部 */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                        <Loader2 className="w-5 h-5 mr-2 text-blue-500" />
                        安装任务进度
                      </h3>
                      <button
                        onClick={hideTaskProgressModal}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* 任务列表 */}
                    <div className="p-4 max-h-80 overflow-y-auto">
                      <div className="space-y-3">
                        {packageTasks.map((task) => (
                          <div key={task.id} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                  <span className="font-medium text-gray-900 dark:text-white font-mono text-sm">
                                    {task.packageName}
                                  </span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    ({task.operation === 'install' ? '安装' : '卸载'})
                                  </span>
                                </div>
                                {task.error && (
                                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                                    {task.error}
                                  </p>
                                )}
                              </div>

                              {/* 状态指示器 */}
                              <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
                                task.status === 'preparing'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                  : task.status === 'installing'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                                  : task.status === 'completed'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                              }`}>
                                {task.status === 'preparing' && (
                                  <>
                                    <AlertCircle className="w-3 h-3" />
                                    <span>准备处理</span>
                                  </>
                                )}
                                {task.status === 'installing' && (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span>正在{task.operation === 'install' ? '安装' : '卸载'}</span>
                                  </>
                                )}
                                {task.status === 'completed' && (
                                  <>
                                    <CheckCircle className="w-3 h-3" />
                                    <span>{task.operation === 'install' ? '安装' : '卸载'}完成</span>
                                  </>
                                )}
                                {task.status === 'failed' && (
                                  <>
                                    <AlertCircle className="w-3 h-3" />
                                    <span>{task.operation === 'install' ? '安装' : '卸载'}失败</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 窗口底部 */}
                    <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          总计: {packageTasks.length} 个任务，
                          完成: {packageTasks.filter(t => t.status === 'completed').length}，
                          失败: {packageTasks.filter(t => t.status === 'failed').length}
                        </div>
                        <button
                          onClick={() => setPackageTasks([])}
                          className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded transition-colors"
                        >
                          清空记录
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default EnvironmentManagerPage
