import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useNetworkCheckStore } from '@/stores/networkCheckStore'
import { SystemStats, SystemInfo, ProcessInfo, WeatherData, ActivePort, SystemAlert, DiskInfo } from '@/types'
import socketClient from '@/utils/socket'
import apiClient from '@/utils/api'
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  Activity,
  Terminal,
  ArrowRight,
  Wifi,
  Search,
  Maximize2,
  X,
  AlertTriangle,
  Download,
  Upload,
  BarChart3
} from 'lucide-react'
import MusicPlayer from '@/components/MusicPlayer'
import NetworkCheck from '@/components/NetworkCheck'
import { getCityNameByCode } from '@/data/cityData'

// 主机名和IP地址组件
interface HostnameWithIPProps {
  systemInfo: SystemInfo
}

const HostnameWithIP: React.FC<HostnameWithIPProps> = ({ systemInfo }) => {
  const [showIPs, setShowIPs] = useState(false)
  const [hoverTimer, setHoverTimer] = useState<NodeJS.Timeout | null>(null)
  const [hideTimer, setHideTimer] = useState<NodeJS.Timeout | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [copySuccess, setCopySuccess] = useState<string | null>(null)

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMousePosition({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 10
    })

    // 清除隐藏定时器
    if (hideTimer) {
      clearTimeout(hideTimer)
      setHideTimer(null)
    }

    const timer = setTimeout(() => {
      setShowIPs(true)
    }, 1000)
    setHoverTimer(timer)
  }

  const handleMouseLeave = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      setHoverTimer(null)
    }

    // 延迟隐藏，给用户时间移动到弹窗上
    const timer = setTimeout(() => {
      setShowIPs(false)
    }, 300)
    setHideTimer(timer)
  }

  const handlePopupMouseEnter = () => {
    // 鼠标进入弹窗时，清除隐藏定时器
    if (hideTimer) {
      clearTimeout(hideTimer)
      setHideTimer(null)
    }
  }

  const handlePopupMouseLeave = () => {
    // 鼠标离开弹窗时，延迟隐藏
    const timer = setTimeout(() => {
      setShowIPs(false)
    }, 200)
    setHideTimer(timer)
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopySuccess(text)
      setTimeout(() => setCopySuccess(null), 2000)
    } catch (err) {
      // 降级方案：使用传统的复制方法
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopySuccess(text)
      setTimeout(() => setCopySuccess(null), 2000)
    }
  }

  return (
    <>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative"
      >
        <div className="flex items-center space-x-3">
          <Network className="w-8 h-8 text-purple-500" />
          <div className="flex-1">
            <p className="text-sm text-gray-600 dark:text-gray-400">主机信息（鼠标悬停显示IP）</p>
            <p className="text-lg font-semibold text-black dark:text-white">{systemInfo.hostname}</p>
          </div>
        </div>
      </div>

      {/* 使用Portal将IP地址信息渲染到body中 */}
      {showIPs && createPortal(
        <div
          className="fixed w-80 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl cursor-default"
          style={{
            left: `${mousePosition.x - 160}px`,
            top: `${mousePosition.y}px`,
            zIndex: 99999
          }}
          onMouseEnter={handlePopupMouseEnter}
          onMouseLeave={handlePopupMouseLeave}
        >
          <div className="space-y-3">
            {systemInfo.ipv4 && systemInfo.ipv4.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">IPv4 地址:</p>
                <div className="space-y-1">
                  {systemInfo.ipv4.map((ip, index) => (
                    <p
                      key={index}
                      className={`text-sm font-mono break-all select-text cursor-pointer px-2 py-1 rounded transition-colors ${copySuccess === ip
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                        }`}
                      title={copySuccess === ip ? '已复制!' : `点击复制: ${ip}`}
                      onClick={() => copyToClipboard(ip)}
                      onMouseEnter={handlePopupMouseEnter}
                    >
                      {copySuccess === ip ? '✓ 已复制' : ip}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {systemInfo.ipv6 && systemInfo.ipv6.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">IPv6 地址:</p>
                <div className="space-y-1">
                  {systemInfo.ipv6.map((ip, index) => (
                    <p
                      key={index}
                      className={`text-sm font-mono break-all select-text cursor-pointer px-2 py-1 rounded transition-colors ${copySuccess === ip
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                        }`}
                      title={copySuccess === ip ? '已复制!' : `点击复制: ${ip}`}
                      onClick={() => copyToClipboard(ip)}
                      onMouseEnter={handlePopupMouseEnter}
                    >
                      {copySuccess === ip ? '✓ 已复制' : ip}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {(!systemInfo.ipv4 || systemInfo.ipv4.length === 0) && (!systemInfo.ipv6 || systemInfo.ipv6.length === 0) && (
              <p className="text-sm text-gray-500 dark:text-gray-400">暂无可用IP地址</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

const HomePage: React.FC = () => {
  const { user } = useAuthStore()
  const { addNotification } = useNotificationStore()
  const { checkAll: checkNetworkAll } = useNetworkCheckStore()
  const navigate = useNavigate()
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [processList, setProcessList] = useState<ProcessInfo[]>([])
  const [connected, setConnected] = useState(socketClient.isConnected())
  const [currentDateTime, setCurrentDateTime] = useState(new Date())
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [activePorts, setActivePorts] = useState<ActivePort[]>([])
  const [portsLoading, setPortsLoading] = useState(false)
  const [isFirstPortsLoad, setIsFirstPortsLoad] = useState(true)
  const [portSearchQuery, setPortSearchQuery] = useState('')
  const [filteredPorts, setFilteredPorts] = useState<ActivePort[]>([])
  const [showPortsModal, setShowPortsModal] = useState(false)
  const [isPortsModalClosing, setIsPortsModalClosing] = useState(false)
  const [isPortsModalOpening, setIsPortsModalOpening] = useState(false)
  const [modalPortSearchQuery, setModalPortSearchQuery] = useState('')
  const [modalFilteredPorts, setModalFilteredPorts] = useState<ActivePort[]>([])

  // 活跃进程相关状态
  const [activeProcesses, setActiveProcesses] = useState<ProcessInfo[]>([])
  const [processesLoading, setProcessesLoading] = useState(false)
  const [isFirstProcessesLoad, setIsFirstProcessesLoad] = useState(true)
  const [processSearchQuery, setProcessSearchQuery] = useState('')
  const [filteredProcesses, setFilteredProcesses] = useState<ProcessInfo[]>([])
  const [showProcessesModal, setShowProcessesModal] = useState(false)
  const [isProcessesModalClosing, setIsProcessesModalClosing] = useState(false)
  const [isProcessesModalOpening, setIsProcessesModalOpening] = useState(false)
  const [modalProcessSearchQuery, setModalProcessSearchQuery] = useState('')
  const [modalFilteredProcesses, setModalFilteredProcesses] = useState<ProcessInfo[]>([])

  // 确认弹窗相关状态
  const [showKillConfirm, setShowKillConfirm] = useState(false)
  const [isKillConfirmClosing, setIsKillConfirmClosing] = useState(false)
  const [isKillConfirmVisible, setIsKillConfirmVisible] = useState(false)
  const [killProcessInfo, setKillProcessInfo] = useState<{ pid: number; name: string; force: boolean } | null>(null)

  // 磁盘选择相关状态
  const [diskList, setDiskList] = useState<DiskInfo[]>([])
  const [selectedDisk, setSelectedDisk] = useState<string>('')
  const [diskLoading, setDiskLoading] = useState(false)

  // 网络接口选择相关状态
  const [networkInterfaceList, setNetworkInterfaceList] = useState<{ name: string; displayName: string; type: string }[]>([])
  const [selectedNetworkInterface, setSelectedNetworkInterface] = useState<string>('')
  const [networkLoading, setNetworkLoading] = useState(false)

  // 网络检测（只在首次加载时执行一次）
  useEffect(() => {
    checkNetworkAll()
  }, [])

  // 将原先的 useEffect 拆分为两个

  // 第一个 useEffect：处理非 WebSocket 相关的数据获取和定时器
  useEffect(() => {
    // 获取系统信息
    const fetchSystemInfo = async () => {
      try {
        const response = await apiClient.getSystemInfo()
        if (response.success) {
          setSystemInfo(response.data)
        }
      } catch (error) {
        console.error('获取系统信息失败:', error)
      }
    }

    // 获取活跃终端进程列表 - 已改为 WebSocket 订阅
    // const fetchTerminalProcesses = async () => {
    //   try {
    //     const response = await apiClient.getActiveTerminalProcesses()
    //     if (response.success) {
    //       setProcessList(response.data)
    //     }
    //   } catch (error) {
    //     console.error('获取终端进程列表失败:', error)
    //   }
    // }

    // 获取天气信息
    const fetchWeatherData = async () => {
      try {
        setWeatherLoading(true)

        // 从localStorage获取天气城市设置
        let weatherCity = '101010100' // 默认北京
        try {
          const webSettings = localStorage.getItem('webSettings')
          if (webSettings) {
            const settings = JSON.parse(webSettings)
            if (settings.weatherCity) {
              weatherCity = settings.weatherCity
            }
          }
        } catch (error) {
          console.warn('读取天气城市设置失败:', error)
        }

        const response = await fetch(`/api/weather/current?city=${weatherCity}`)

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const result = await response.json()

        if (result.success && result.data) {
          // 添加选择的城市代码到天气数据中
          setWeatherData({ ...result.data, selectedCityCode: weatherCity })
        } else {
          throw new Error('天气API返回错误数据')
        }
      } catch (error) {
        console.error('获取天气信息失败:', error)
        setWeatherData(null)
      } finally {
        setWeatherLoading(false)
      }
    }

    // 获取磁盘列表
    const fetchDiskList = async () => {
      try {
        const response = await apiClient.getDiskList()
        if (response.success) {
          setDiskList(response.data)
        }
      } catch (error) {
        console.error('获取磁盘列表失败:', error)
      }
    }

    // 获取当前选择的磁盘
    const fetchSelectedDisk = async () => {
      try {
        const response = await apiClient.getSelectedDisk()
        if (response.success) {
          setSelectedDisk(response.data.selectedDisk)
        }
      } catch (error) {
        console.error('获取选择磁盘失败:', error)
      }
    }

    // 获取网络接口列表
    const fetchNetworkInterfaces = async () => {
      try {
        const response = await apiClient.getNetworkInterfaces()
        if (response.success) {
          setNetworkInterfaceList(response.data)
        }
      } catch (error) {
        console.error('获取网络接口列表失败:', error)
      }
    }

    // 获取当前选择的网络接口
    const fetchSelectedNetworkInterface = async () => {
      try {
        const response = await apiClient.getSelectedNetworkInterface()
        if (response.success) {
          setSelectedNetworkInterface(response.data.selectedInterface)
        }
      } catch (error) {
        console.error('获取选择网络接口失败:', error)
      }
    }

    fetchSystemInfo()
    // fetchTerminalProcesses() // 已改为 WebSocket 订阅
    fetchWeatherData()
    fetchDiskList()
    fetchSelectedDisk()
    fetchNetworkInterfaces()
    fetchSelectedNetworkInterface()

    // 设置定时刷新
    // const processInterval = setInterval(fetchTerminalProcesses, 5000) // 已改为 WebSocket 订阅
    const dateTimeInterval = setInterval(() => setCurrentDateTime(new Date()), 1000)
    const weatherInterval = setInterval(fetchWeatherData, 30 * 60 * 1000)

    // 监听Socket连接状态
    const handleConnectionStatus = ({ connected }) => {
      setConnected(connected)
    }
    socketClient.on('connection-status', handleConnectionStatus)

    // 设置初始连接状态
    setConnected(socketClient.isConnected())

    return () => {
      // clearInterval(processInterval) // 已改为 WebSocket 订阅
      clearInterval(dateTimeInterval)
      clearInterval(weatherInterval)
      socketClient.off('connection-status', handleConnectionStatus)
    }
  }, [])

  // 第二个 useEffect：处理 WebSocket 相关逻辑，依赖于 connected 状态
  useEffect(() => {
    if (connected) {
      // 监听系统状态更新
      socketClient.on('system-stats', (stats: SystemStats) => {
        setSystemStats(stats)
      })

      // 监听端口信息更新
      socketClient.on('system-ports', (ports: ActivePort[]) => {
        setActivePorts(ports)
        if (isFirstPortsLoad) {
          setPortsLoading(false)
          setIsFirstPortsLoad(false)
        }
      })

      // 监听进程信息更新
      socketClient.on('system-processes', (processes: ProcessInfo[]) => {
        setActiveProcesses(processes)
        if (isFirstProcessesLoad) {
          setProcessesLoading(false)
          setIsFirstProcessesLoad(false)
        }
      })

      // 监听终端活跃进程更新
      socketClient.on('terminal-processes-update', (response: any) => {
        if (response.success) {
          setProcessList(response.data)
        } else {
          console.error('获取终端活跃进程失败:', response.error)
        }
      })

      // 订阅系统状态、端口、进程信息和终端进程
      socketClient.subscribeSystemStats()
      socketClient.subscribeSystemPorts()
      socketClient.subscribeSystemProcesses()
      socketClient.subscribeTerminalProcesses()

      // 初始加载状态
      if (isFirstPortsLoad) setPortsLoading(true)
      if (isFirstProcessesLoad) setProcessesLoading(true)
    }

    return () => {
      socketClient.off('system-stats')
      socketClient.off('system-ports')
      socketClient.off('system-processes')
      socketClient.off('terminal-processes-update')

      if (socketClient.isConnected()) {
        socketClient.emit('unsubscribe-system-stats')
        socketClient.emit('unsubscribe-system-ports')
        socketClient.emit('unsubscribe-system-processes')
        socketClient.emit('unsubscribe-terminal-processes')
      }
    }
  }, [connected])

  // 处理端口搜索过滤
  useEffect(() => {
    if (portSearchQuery.trim() === '') {
      setFilteredPorts(activePorts)
    } else {
      const filtered = activePorts.filter(port =>
        port.port.toString().includes(portSearchQuery) ||
        port.protocol.toLowerCase().includes(portSearchQuery.toLowerCase()) ||
        port.address.toLowerCase().includes(portSearchQuery.toLowerCase())
      )
      setFilteredPorts(filtered)
    }
  }, [activePorts, portSearchQuery])

  // 处理弹窗端口搜索过滤
  useEffect(() => {
    if (modalPortSearchQuery.trim() === '') {
      setModalFilteredPorts(activePorts)
    } else {
      const filtered = activePorts.filter(port =>
        port.port.toString().includes(modalPortSearchQuery) ||
        port.protocol.toLowerCase().includes(modalPortSearchQuery.toLowerCase()) ||
        port.address.toLowerCase().includes(modalPortSearchQuery.toLowerCase())
      )
      setModalFilteredPorts(filtered)
    }
  }, [activePorts, modalPortSearchQuery])

  // 处理进程搜索过滤
  useEffect(() => {
    if (processSearchQuery.trim() === '') {
      setFilteredProcesses(activeProcesses)
    } else {
      const filtered = activeProcesses.filter(process =>
        process.name.toLowerCase().includes(processSearchQuery.toLowerCase()) ||
        process.pid.toString().includes(processSearchQuery) ||
        process.command.toLowerCase().includes(processSearchQuery.toLowerCase())
      )
      setFilteredProcesses(filtered)
    }
  }, [activeProcesses, processSearchQuery])

  // 处理弹窗进程搜索过滤
  useEffect(() => {
    if (modalProcessSearchQuery.trim() === '') {
      setModalFilteredProcesses(activeProcesses)
    } else {
      const filtered = activeProcesses.filter(process =>
        process.name.toLowerCase().includes(modalProcessSearchQuery.toLowerCase()) ||
        process.pid.toString().includes(modalProcessSearchQuery) ||
        process.command.toLowerCase().includes(modalProcessSearchQuery.toLowerCase())
      )
      setModalFilteredProcesses(filtered)
    }
  }, [activeProcesses, modalProcessSearchQuery])

  // 处理磁盘选择变化
  const handleDiskChange = async (disk: string) => {
    try {
      setDiskLoading(true)
      const response = await apiClient.setSelectedDisk(disk)
      if (response.success) {
        setSelectedDisk(disk)
        addNotification({
          type: 'success',
          title: '磁盘切换成功',
          message: disk === '' ? '已切换到总计模式' : `已切换到 ${disk}`
        })
      } else {
        addNotification({
          type: 'error',
          title: '磁盘切换失败',
          message: response.message || '未知错误'
        })
      }
    } catch (error) {
      console.error('切换磁盘失败:', error)
      addNotification({
        type: 'error',
        title: '磁盘切换失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      setDiskLoading(false)
    }
  }

  // 处理网络接口选择变化
  const handleNetworkInterfaceChange = async (interfaceName: string) => {
    try {
      setNetworkLoading(true)
      const response = await apiClient.setSelectedNetworkInterface(interfaceName)
      if (response.success) {
        setSelectedNetworkInterface(interfaceName)
        addNotification({
          type: 'success',
          title: '网络接口切换成功',
          message: interfaceName === '' ? '已切换到总计模式' : `已切换到 ${interfaceName}`
        })
      } else {
        addNotification({
          type: 'error',
          title: '网络接口切换失败',
          message: response.message || '未知错误'
        })
      }
    } catch (error) {
      console.error('切换网络接口失败:', error)
      addNotification({
        type: 'error',
        title: '网络接口切换失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      setNetworkLoading(false)
    }
  }

  // 处理弹窗打开动画
  const handleOpenPortsModal = () => {
    setShowPortsModal(true)
    setIsPortsModalOpening(true)
    // 短暂延迟后开始淡入动画
    setTimeout(() => {
      setIsPortsModalOpening(false)
    }, 50) // 50ms 后开始淡入
  }

  // 处理弹窗关闭动画
  const handleClosePortsModal = () => {
    setIsPortsModalClosing(true)
    setTimeout(() => {
      setShowPortsModal(false)
      setIsPortsModalClosing(false)
      setModalPortSearchQuery('') // 关闭时清空搜索
    }, 300) // 300ms 动画时间
  }

  // 处理进程弹窗打开动画
  const handleOpenProcessesModal = () => {
    setShowProcessesModal(true)
    setIsProcessesModalOpening(true)
    // 短暂延迟后开始淡入动画
    setTimeout(() => {
      setIsProcessesModalOpening(false)
    }, 50) // 50ms 后开始淡入
  }

  // 处理进程弹窗关闭动画
  const handleCloseProcessesModal = () => {
    setIsProcessesModalClosing(true)
    setTimeout(() => {
      setShowProcessesModal(false)
      setIsProcessesModalClosing(false)
      setModalProcessSearchQuery('') // 关闭时清空搜索
    }, 300) // 300ms 动画时间
  }

  // 终止进程
  const handleKillProcess = (pid: number, force: boolean = false) => {
    // 查找进程信息
    const process = activeProcesses.find(p => p.pid === pid)
    const processName = process?.name || `PID ${pid}`

    // 设置确认弹窗信息
    setKillProcessInfo({ pid, name: processName, force })
    setShowKillConfirm(true)
    setIsKillConfirmClosing(false)
    setIsKillConfirmVisible(false)

    // 延迟显示动画，确保DOM已渲染
    setTimeout(() => {
      setIsKillConfirmVisible(true)
    }, 10)
  }

  const confirmKillProcess = async () => {
    if (!killProcessInfo) return

    const { pid, name, force } = killProcessInfo

    try {
      const response = await apiClient.killProcess(pid, force)
      if (response.success) {
        // 显示成功通知
        addNotification({
          type: 'success',
          title: '进程终止成功',
          message: `进程 ${name} (PID: ${pid}) 已${force ? '强制' : ''}终止`
        })

        // 刷新进程列表
        const processResponse = await apiClient.getProcessList()
        if (processResponse.success) {
          setActiveProcesses(processResponse.data)
        }
      } else {
        console.error('终止进程失败:', response.message)
        addNotification({
          type: 'error',
          title: '进程终止失败',
          message: response.message || '未知错误'
        })
      }
    } catch (error) {
      console.error('终止进程失败:', error)
      addNotification({
        type: 'error',
        title: '进程终止失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      // 关闭确认弹窗
      setIsKillConfirmClosing(true)
      setTimeout(() => {
        setShowKillConfirm(false)
        setIsKillConfirmClosing(false)
        setIsKillConfirmVisible(false)
        setKillProcessInfo(null)
      }, 300) // 与CSS动画时间匹配
    }
  }

  const cancelKillProcess = () => {
    setIsKillConfirmClosing(true)
    setTimeout(() => {
      setShowKillConfirm(false)
      setIsKillConfirmClosing(false)
      setIsKillConfirmVisible(false)
      setKillProcessInfo(null)
    }, 300) // 与CSS动画时间匹配
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatBytesPerSecond = (bytesPerSec: number) => {
    if (bytesPerSec === 0) return '0 B/s'
    const k = 1024
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k))
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatOpsPerSecond = (ops: number) => {
    if (ops === 0) return '0 IOPS'
    if (ops < 1000) return `${ops.toFixed(1)} IOPS`
    if (ops < 1000000) return `${(ops / 1000).toFixed(1)}K IOPS`
    return `${(ops / 1000000).toFixed(1)}M IOPS`
  }



  const getUsageColor = (usage: number) => {
    if (usage >= 90) return 'text-red-500'
    if (usage >= 70) return 'text-yellow-500'
    return 'text-green-500'
  }

  const getUsageBgColor = (usage: number) => {
    if (usage >= 90) return 'bg-red-500'
    if (usage >= 70) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const formatDateTime = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')

    return {
      date: `${year}年${month}月${day}日`,
      time: `${hours}:${minutes}:${seconds}`
    }
  }

  return (
    <div className="space-y-6">
      {/* 日期时间和天气显示 */}
      <div className="card-game p-6">
        <div className="flex items-center justify-center space-x-8">
          {/* 日期时间 */}
          <div className="text-center">
            <div className="text-3xl font-bold text-black dark:text-white mb-2">
              {formatDateTime(currentDateTime).date}
            </div>
            <div className="text-4xl font-mono font-bold text-blue-600 dark:text-blue-400">
              {formatDateTime(currentDateTime).time}
            </div>
          </div>

          {/* 分隔线 */}
          <div className="h-20 w-px bg-gray-300 dark:bg-gray-600"></div>

          {/* 天气信息 */}
          <div className="text-center">
            {weatherLoading ? (
              <div className="text-gray-500 dark:text-gray-400">加载中...</div>
            ) : weatherData ? (
              <div>
                <div className="text-2xl font-bold text-black dark:text-white mb-1">
                  {getCityNameByCode(weatherData.selectedCityCode) || weatherData.cityInfo?.city || '北京'}
                </div>
                <div className="flex items-center justify-center space-x-2 mb-2">
                  <span className="text-3xl font-bold text-orange-500">
                    {weatherData.wendu}°C
                  </span>
                  <span className="text-lg text-gray-600 dark:text-gray-400">
                    {weatherData.forecast?.[0]?.type || '晴'}
                  </span>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {weatherData.forecast?.[0]?.low?.replace('低温 ', '')} ~ {weatherData.forecast?.[0]?.high?.replace('高温 ', '')}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {weatherData.forecast?.[0]?.fx} {weatherData.forecast?.[0]?.fl}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  湿度: {weatherData.shidu} | 空气质量: {weatherData.quality}
                </div>
              </div>
            ) : (
              <div className="text-gray-500 dark:text-gray-400">天气信息获取失败</div>
            )}
          </div>
        </div>
      </div>

      {/* 欢迎信息 */}
      <div className="card-game p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-black dark:text-white font-display mb-2">
              欢迎回来，{user?.username}！
            </h2>
            <p className="text-gray-700 dark:text-gray-300">
              GSManager 游戏服务器面板 - 让游戏开服变得如此简单

            </p>
          </div>
        </div>
      </div>

      {/* 系统信息卡片 */}
      {systemInfo && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="card-game p-6">
            <div className="flex items-center space-x-3">
              <Server className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">操作系统</p>
                <p className="text-lg font-semibold text-black dark:text-white">{systemInfo.platform}</p>
              </div>
            </div>
          </div>

          <div className="card-game p-6">
            <div className="flex items-center space-x-3">
              <Cpu className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">架构</p>
                <p className="text-lg font-semibold text-black dark:text-white">{systemInfo.arch}</p>
              </div>
            </div>
          </div>

          <div className="card-game p-6 relative">
            <HostnameWithIP systemInfo={systemInfo} />
          </div>

        </div>
      )}

      {/* 系统状态 */}
      {systemStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* CPU使用率 */}
          <div className="card-game p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <Cpu className="w-6 h-6 text-blue-500" />
                <h3 className="text-lg font-semibold text-black dark:text-white">CPU使用率</h3>
              </div>
              <span className={`text-2xl font-bold ${getUsageColor(systemStats.cpu.usage)}`}>
                {systemStats.cpu.usage.toFixed(1)}%
              </span>
            </div>

            {/* CPU总体信息 */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>核心数: {systemStats.cpu.cores}</span>
                <span>型号: {systemStats.cpu.model}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${getUsageBgColor(systemStats.cpu.usage)}`}
                  style={{ width: `${systemStats.cpu.usage}%` }}
                ></div>
              </div>
              {/* 面板CPU占用 */}
              {systemStats.panel && (
                <div className="flex items-center justify-between mt-2 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                  <div className="flex items-center space-x-1.5">
                    <Server className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-gray-600 dark:text-gray-400">面板占用:</span>
                  </div>
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    {systemStats.panel.cpu.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>

            {/* 详细核心信息 */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-blue-500" />
                  <h4 className="text-sm font-medium text-black dark:text-white">核心负载</h4>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {systemStats.cpu.cores} 个核心
                </div>
              </div>

              <div className="max-h-32 overflow-y-auto space-y-1.5">
                {systemStats.cpu.coreUsages && systemStats.cpu.coreUsages.map((coreUsage, index) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    <div className="flex items-center space-x-2">
                      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full"></div>
                      <span className="text-gray-600 dark:text-gray-400 text-xs">核心 {index + 1}:</span>
                    </div>
                    <div className="flex items-center space-x-2 flex-1 ml-3">
                      <div className="flex-1 bg-gray-700 rounded-full h-1">
                        <div
                          className={`h-1 rounded-full transition-all duration-300 ${getUsageBgColor(coreUsage)}`}
                          style={{ width: `${coreUsage}%` }}
                        ></div>
                      </div>
                      <div className={`text-right font-medium min-w-[40px] text-xs ${getUsageColor(coreUsage)}`}>
                        {coreUsage.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 内存使用率 */}
          <div className="card-game p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <MemoryStick className="w-6 h-6 text-green-500" />
                <h3 className="text-lg font-semibold text-black dark:text-white">内存使用率</h3>
              </div>
              <span className={`text-2xl font-bold ${getUsageColor(systemStats.memory.usage)}`}>
                {systemStats.memory.usage.toFixed(1)}%
              </span>
            </div>

            {/* 内存空间信息 */}
            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>已用: {formatBytes(systemStats.memory.used)}</span>
                <span>总计: {formatBytes(systemStats.memory.total)}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${getUsageBgColor(systemStats.memory.usage)}`}
                  style={{ width: `${systemStats.memory.usage}%` }}
                ></div>
              </div>
              {/* 面板内存占用 */}
              {systemStats.panel && (
                <div className="flex items-center justify-between mt-2 px-2 py-1 bg-green-50 dark:bg-green-900/20 rounded-md">
                  <div className="flex items-center space-x-1.5">
                    <Server className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-xs text-gray-600 dark:text-gray-400">面板占用:</span>
                  </div>
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">
                    {formatBytes(systemStats.panel.memory)} ({systemStats.panel.memoryUsage.toFixed(2)}%)
                  </span>
                </div>
              )}
            </div>

            {/* 详细内存信息 */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-green-500" />
                  <h4 className="text-sm font-medium text-black dark:text-white">详细信息</h4>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {systemInfo?.platform?.includes('Windows') ? 'Windows' : 'Linux'}
                </div>
              </div>

              <div className="space-y-2">
                {/* Windows 特有信息 */}
                {systemInfo?.platform?.includes('Windows') && systemStats.memory.committed !== undefined && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="text-gray-600 dark:text-gray-400">使用中:</span>
                      </div>
                      <div className="text-right">
                        <div className="text-blue-600 dark:text-blue-400 font-medium">
                          {formatBytes(systemStats.memory.used)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          物理内存
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                        <span className="text-gray-600 dark:text-gray-400">已提交:</span>
                      </div>
                      <div className="text-right">
                        <div className="text-orange-600 dark:text-orange-400 font-medium">
                          {formatBytes(systemStats.memory.committed)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {systemStats.memory.commitLimit ?
                            `/ ${formatBytes(systemStats.memory.commitLimit)}` :
                            '虚拟内存'
                          }
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Linux 特有信息 */}
                {!systemInfo?.platform?.includes('Windows') && (
                  <>
                    {systemStats.memory.available !== undefined && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                          <span className="text-gray-600 dark:text-gray-400">可用:</span>
                        </div>
                        <div className="text-right">
                          <div className="text-blue-600 dark:text-blue-400 font-medium">
                            {formatBytes(systemStats.memory.available)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            实际可用
                          </div>
                        </div>
                      </div>
                    )}

                    {systemStats.memory.buffers !== undefined && systemStats.memory.cached !== undefined && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                          <span className="text-gray-600 dark:text-gray-400">缓存:</span>
                        </div>
                        <div className="text-right">
                          <div className="text-purple-600 dark:text-purple-400 font-medium">
                            {formatBytes(systemStats.memory.buffers + systemStats.memory.cached)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            缓冲区+缓存
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Swap 信息 */}
                    {systemStats.memory.swap && systemStats.memory.swap.total > 0 && (
                      <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                        <div className="flex items-center justify-between text-sm mb-2">
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                            <span className="text-gray-600 dark:text-gray-400">Swap:</span>
                          </div>
                          <div className="text-right">
                            <div className="text-yellow-600 dark:text-yellow-400 font-medium">
                              {systemStats.memory.swap.usage.toFixed(1)}%
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {formatBytes(systemStats.memory.swap.used)} / {formatBytes(systemStats.memory.swap.total)}
                            </div>
                          </div>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-1">
                          <div
                            className="h-1 bg-yellow-500 rounded-full transition-all duration-300"
                            style={{ width: `${systemStats.memory.swap.usage}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 磁盘使用率 */}
          <div className="card-game p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <HardDrive className="w-6 h-6 text-purple-500" />
                <h3 className="text-lg font-semibold text-black dark:text-white">磁盘使用率</h3>
              </div>
              <div className="flex items-center space-x-3">
                {/* 磁盘选择下拉菜单 */}
                <div className="relative">
                  <select
                    value={selectedDisk}
                    onChange={(e) => handleDiskChange(e.target.value)}
                    disabled={diskLoading}
                    className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed hover:border-purple-400 dark:hover:border-purple-500 transition-colors w-[140px] truncate"
                    title={selectedDisk || '总计'}
                  >
                    <option value="" className="bg-white dark:bg-gray-800">总计</option>
                    {diskList.map((disk, index) => (
                      <option key={`${disk.filesystem}-${index}`} value={disk.filesystem} className="bg-white dark:bg-gray-800" title={disk.filesystem}>
                        {disk.filesystem}
                      </option>
                    ))}
                  </select>
                  {diskLoading && (
                    <div className="absolute right-1 top-1/2 transform -translate-y-1/2">
                      <div className="w-2 h-2 border border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
                <span className={`text-2xl font-bold ${getUsageColor(systemStats.disk.usage)}`}>
                  {systemStats.disk.usage.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* 磁盘空间信息 */}
            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>已用: {formatBytes(systemStats.disk.used)}</span>
                <span>总计: {formatBytes(systemStats.disk.total)}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${getUsageBgColor(systemStats.disk.usage)}`}
                  style={{ width: `${systemStats.disk.usage}%` }}
                ></div>
              </div>
            </div>

            {/* 实时磁盘读写 */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-purple-500" />
                  <h4 className="text-sm font-medium text-black dark:text-white">实时读写</h4>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {systemInfo?.platform?.includes('Windows') ? 'Windows' : 'Linux'}
                </div>
              </div>

              <div className="space-y-2">
                {/* 读取信息 */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <Upload className="w-3 h-3 text-blue-500" />
                    <span className="text-gray-600 dark:text-gray-400">读取:</span>
                  </div>
                  <div className="text-right">
                    <div className="text-blue-600 dark:text-blue-400 font-medium">
                      {formatBytesPerSecond(systemStats.disk.readBytes)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatOpsPerSecond(systemStats.disk.readOps)}
                    </div>
                  </div>
                </div>

                {/* 写入信息 */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <Download className="w-3 h-3 text-orange-500" />
                    <span className="text-gray-600 dark:text-gray-400">写入:</span>
                  </div>
                  <div className="text-right">
                    <div className="text-orange-600 dark:text-orange-400 font-medium">
                      {formatBytesPerSecond(systemStats.disk.writeBytes)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatOpsPerSecond(systemStats.disk.writeOps)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 网络使用率 */}
          <div className="card-game p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <Wifi className="w-6 h-6 text-cyan-500" />
                <h3 className="text-lg font-semibold text-black dark:text-white">网络使用率</h3>
              </div>
              <div className="flex items-center space-x-3">
                {/* 网络接口选择下拉菜单 */}
                <div className="relative">
                  <select
                    value={selectedNetworkInterface}
                    onChange={(e) => handleNetworkInterfaceChange(e.target.value)}
                    disabled={networkLoading}
                    className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed hover:border-cyan-400 dark:hover:border-cyan-500 transition-colors w-[140px] truncate"
                    title={selectedNetworkInterface || '总计'}
                  >
                    <option value="" className="bg-white dark:bg-gray-800">总计</option>
                    {networkInterfaceList.map((iface, index) => (
                      <option key={`${iface.name}-${index}`} value={iface.name} className="bg-white dark:bg-gray-800" title={iface.displayName}>
                        {iface.displayName}
                      </option>
                    ))}
                  </select>
                  {networkLoading && (
                    <div className="absolute right-1 top-1/2 transform -translate-y-1/2">
                      <div className="w-2 h-2 border border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 实时网络流量 */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-cyan-500" />
                  <h4 className="text-sm font-medium text-black dark:text-white">实时流量</h4>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {systemInfo?.platform?.includes('Windows') ? 'Windows' : 'Linux'}
                </div>
              </div>

              <div className="space-y-3">
                {/* 接收信息 */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <Download className="w-3 h-3 text-green-500" />
                    <span className="text-gray-600 dark:text-gray-400">接收:</span>
                  </div>
                  <div className="text-right">
                    <div className="text-green-600 dark:text-green-400 font-medium">
                      {formatBytesPerSecond(systemStats.network.rx)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      下行流量
                    </div>
                  </div>
                </div>

                {/* 发送信息 */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <Upload className="w-3 h-3 text-red-500" />
                    <span className="text-gray-600 dark:text-gray-400">发送:</span>
                  </div>
                  <div className="text-right">
                    <div className="text-red-600 dark:text-red-400 font-medium">
                      {formatBytesPerSecond(systemStats.network.tx)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      上行流量
                    </div>
                  </div>
                </div>

                {/* 总流量 */}
                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="w-3 h-3 text-cyan-500" />
                    <span className="text-gray-600 dark:text-gray-400">总计:</span>
                  </div>
                  <div className="text-right">
                    <div className="text-cyan-600 dark:text-cyan-400 font-medium">
                      {formatBytesPerSecond(systemStats.network.rx + systemStats.network.tx)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      总流量
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* 网络检测模块 */}
      <NetworkCheck />

      {/* 终端占用、活跃端口、活跃进程 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* 终端占用模块 */}
        <div className="card-game p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Terminal className="w-6 h-6 text-orange-500" />
            <h3 className="text-lg font-semibold text-black dark:text-white">活跃终端</h3>
            <span className="text-sm text-gray-600 dark:text-gray-400">({processList.length} 个进程)</span>
          </div>

          {processList.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-4 text-sm font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 pb-2">
                <span>终端名称</span>
                <span>PID</span>
                <span>操作</span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {processList.map((process, index) => (
                  <div key={`${process.id}-${index}`} className="grid grid-cols-3 gap-4 text-sm py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded">
                    <span className="text-black dark:text-white font-medium truncate" title={process.name}>
                      {process.name}
                    </span>
                    <span className="text-blue-600 dark:text-blue-400 font-mono">
                      {process.pid}
                    </span>
                    <button
                      onClick={() => navigate(`/terminal?sessionId=${process.id}`)}
                      className="flex items-center space-x-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                    >
                      <span>前往终端</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Terminal className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无终端进程运行</p>
            </div>
          )}
        </div>

        {/* 活跃端口模块 */}
        <div className="card-game p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Wifi className="w-6 h-6 text-cyan-500" />
              <h3 className="text-lg font-semibold text-black dark:text-white">活跃端口</h3>
              <span className="text-sm text-gray-600 dark:text-gray-400">({filteredPorts.length}/{activePorts.length} 个端口)</span>
            </div>
            <button
              onClick={handleOpenPortsModal}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="查看所有端口"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索端口号、协议或地址..."
              value={portSearchQuery}
              onChange={(e) => setPortSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
          </div>

          {portsLoading && isFirstPortsLoad ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50 animate-pulse" />
              <p>正在扫描端口...</p>
            </div>
          ) : filteredPorts.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-4 text-sm font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 pb-2">
                <span>端口</span>
                <span>协议</span>
                <span>状态</span>
                <span>地址</span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {filteredPorts.slice(0, 20).map((port, index) => (
                  <div key={`${port.protocol}-${port.port}-${port.address}-${index}`} className="grid grid-cols-4 gap-4 text-sm py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded">
                    <span className="text-blue-600 dark:text-blue-400 font-mono font-bold">
                      {port.port}
                    </span>
                    <span className={`font-medium ${port.protocol === 'tcp' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
                      }`}>
                      {port.protocol.toUpperCase()}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300 text-xs">
                      {port.state}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400 text-xs truncate" title={port.address}>
                      {port.address}
                    </span>
                  </div>
                ))}
                {filteredPorts.length > 20 && (
                  <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-2">
                    还有 {filteredPorts.length - 20} 个端口未显示
                  </div>
                )}
              </div>
            </div>
          ) : activePorts.length > 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>未找到匹配的端口</p>
              <p className="text-xs mt-1">尝试搜索其他关键词</p>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无活跃端口</p>
            </div>
          )}
        </div>

        {/* 活跃进程模块 */}
        <div className="card-game p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Activity className="w-6 h-6 text-purple-500" />
              <h3 className="text-lg font-semibold text-black dark:text-white">活跃进程</h3>
              <span className="text-sm text-gray-600 dark:text-gray-400">({filteredProcesses.length}/{activeProcesses.length} 个进程)</span>
            </div>
            <button
              onClick={handleOpenProcessesModal}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="查看所有进程"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索进程名、PID或命令..."
              value={processSearchQuery}
              onChange={(e) => setProcessSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {processesLoading && isFirstProcessesLoad ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-50 animate-pulse" />
              <p>正在扫描进程...</p>
            </div>
          ) : filteredProcesses.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-4 text-sm font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 pb-2">
                <span>进程名</span>
                <span>PID</span>
                <span>CPU</span>
                <span>操作</span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {filteredProcesses.slice(0, 15).map((process, index) => (
                  <div key={`${process.pid}-${index}`} className="grid grid-cols-4 gap-4 text-sm py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded">
                    <span className="text-black dark:text-white font-medium truncate" title={process.name}>
                      {process.name}
                    </span>
                    <span className="text-blue-600 dark:text-blue-400 font-mono">
                      {process.pid}
                    </span>
                    <span className="text-green-600 dark:text-green-400 font-mono text-xs">
                      {process.cpu}%
                    </span>
                    <button
                      onClick={() => handleKillProcess(process.pid)}
                      className="flex items-center space-x-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors text-xs"
                      title="终止进程"
                    >
                      <X className="w-3 h-3" />
                      <span>终止</span>
                    </button>
                  </div>
                ))}
                {filteredProcesses.length > 15 && (
                  <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-2">
                    还有 {filteredProcesses.length - 15} 个进程未显示
                  </div>
                )}
              </div>
            </div>
          ) : activeProcesses.length > 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>未找到匹配的进程</p>
              <p className="text-xs mt-1">尝试搜索其他关键词</p>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无活跃进程</p>
            </div>
          )}
        </div>
      </div>

      {/* 音乐播放器 */}
      <MusicPlayer />

      {/* 端口详情弹窗 */}
      {showPortsModal && (
        <div
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${isPortsModalClosing
            ? 'bg-opacity-0'
            : isPortsModalOpening
              ? 'bg-opacity-0'
              : 'bg-opacity-50'
            }`}
          onClick={handleClosePortsModal}
        >
          <div
            className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col transition-all duration-300 ease-in-out transform ${isPortsModalClosing
              ? 'scale-95 opacity-0'
              : isPortsModalOpening
                ? 'scale-95 opacity-0'
                : 'scale-100 opacity-100'
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <Wifi className="w-6 h-6 text-cyan-500" />
                <h2 className="text-xl font-semibold text-black dark:text-white">活跃端口详情</h2>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  ({modalFilteredPorts.length}/{activePorts.length} 个端口)
                </span>
              </div>
              <button
                onClick={handleClosePortsModal}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 搜索框 */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索端口号、协议或地址..."
                  value={modalPortSearchQuery}
                  onChange={(e) => setModalPortSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* 端口列表 */}
            <div className="flex-1 overflow-hidden">
              {portsLoading && isFirstPortsLoad ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center text-gray-500 dark:text-gray-400">
                    <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50 animate-pulse" />
                    <p>正在扫描端口...</p>
                  </div>
                </div>
              ) : modalFilteredPorts.length > 0 ? (
                <div className="p-6">
                  {/* 表头 */}
                  <div className="grid grid-cols-5 gap-4 text-sm font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 pb-3 mb-4">
                    <span>端口</span>
                    <span>协议</span>
                    <span>状态</span>
                    <span>地址</span>
                    <span>进程</span>
                  </div>

                  {/* 端口列表 */}
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {modalFilteredPorts.map((port, index) => (
                      <div
                        key={`${port.protocol}-${port.port}-${port.address}-${index}`}
                        className="grid grid-cols-5 gap-4 text-sm py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-2 transition-colors"
                      >
                        <span className="text-blue-600 dark:text-blue-400 font-mono font-bold text-lg">
                          {port.port}
                        </span>
                        <span className={`font-medium ${port.protocol === 'tcp' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
                          }`}>
                          {port.protocol.toUpperCase()}
                        </span>
                        <span className="text-gray-700 dark:text-gray-300">
                          {port.state}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400 font-mono text-xs break-all">
                          {port.address}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400 text-xs">
                          {port.process ? `${port.process}${port.pid ? ` (${port.pid})` : ''}` : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : activePorts.length > 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center text-gray-500 dark:text-gray-400">
                    <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>未找到匹配的端口</p>
                    <p className="text-xs mt-1">尝试搜索其他关键词</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center text-gray-500 dark:text-gray-400">
                    <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>暂无活跃端口</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 进程详情弹窗 */}
      {showProcessesModal && (
        <div
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${isProcessesModalClosing
            ? 'bg-opacity-0'
            : isProcessesModalOpening
              ? 'bg-opacity-0'
              : 'bg-opacity-50'
            }`}
          onClick={handleCloseProcessesModal}
        >
          <div
            className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col transition-all duration-300 ease-in-out transform ${isProcessesModalClosing
              ? 'scale-95 opacity-0'
              : isProcessesModalOpening
                ? 'scale-95 opacity-0'
                : 'scale-100 opacity-100'
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <Activity className="w-6 h-6 text-purple-500" />
                <h2 className="text-xl font-semibold text-black dark:text-white">活跃进程详情</h2>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  ({modalFilteredProcesses.length}/{activeProcesses.length} 个进程)
                </span>
              </div>
              <button
                onClick={handleCloseProcessesModal}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 搜索框 */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索进程名、PID或命令..."
                  value={modalProcessSearchQuery}
                  onChange={(e) => setModalProcessSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* 进程列表 */}
            <div className="flex-1 overflow-hidden">
              {processesLoading && isFirstProcessesLoad ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center text-gray-500 dark:text-gray-400">
                    <Activity className="w-12 h-12 mx-auto mb-3 opacity-50 animate-pulse" />
                    <p>正在扫描进程...</p>
                  </div>
                </div>
              ) : modalFilteredProcesses.length > 0 ? (
                <div className="p-6">
                  {/* 表头 */}
                  <div className="grid grid-cols-7 gap-4 text-sm font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 pb-3 mb-4">
                    <span>进程名</span>
                    <span>PID</span>
                    <span>CPU</span>
                    <span>内存</span>
                    <span>状态</span>
                    <span>启动时间</span>
                    <span>操作</span>
                  </div>

                  {/* 进程列表 */}
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {modalFilteredProcesses.map((process, index) => (
                      <div
                        key={`${process.pid}-${index}`}
                        className="grid grid-cols-7 gap-4 text-sm py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-2 transition-colors"
                      >
                        <span className="text-black dark:text-white font-medium truncate" title={process.name}>
                          {process.name}
                        </span>
                        <span className="text-blue-600 dark:text-blue-400 font-mono font-bold">
                          {process.pid}
                        </span>
                        <span className="text-green-600 dark:text-green-400 font-mono">
                          {process.cpu}%
                        </span>
                        <span className="text-orange-600 dark:text-orange-400 font-mono">
                          {typeof process.memory === 'number' ? `${process.memory.toFixed(1)}MB` : process.memory}
                        </span>
                        <span className={`text-xs ${process.status === 'Running' ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'
                          }`}>
                          {process.status}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400 text-xs">
                          {new Date(process.startTime).toLocaleString()}
                        </span>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleKillProcess(process.pid, false)}
                            className="flex items-center space-x-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                            title="终止进程"
                          >
                            <X className="w-3 h-3" />
                            <span>终止</span>
                          </button>
                          <button
                            onClick={() => handleKillProcess(process.pid, true)}
                            className="flex items-center space-x-1 text-red-700 dark:text-red-500 hover:text-red-900 dark:hover:text-red-400 transition-colors text-xs px-2 py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                            title="强制终止进程"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            <span>强制</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : activeProcesses.length > 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center text-gray-500 dark:text-gray-400">
                    <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>未找到匹配的进程</p>
                    <p className="text-xs mt-1">尝试搜索其他关键词</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center text-gray-500 dark:text-gray-400">
                    <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>暂无活跃进程</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 终止进程确认弹窗 */}
      {showKillConfirm && killProcessInfo && (
        <div
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${isKillConfirmClosing ? 'bg-opacity-0' : isKillConfirmVisible ? 'bg-opacity-50' : 'bg-opacity-0'
            }`}
          onClick={cancelKillProcess}
        >
          <div
            className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md transition-all duration-300 ease-in-out transform ${isKillConfirmClosing ? 'scale-95 opacity-0' : isKillConfirmVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center space-x-3 p-6 border-b border-gray-200 dark:border-gray-700">
              <AlertTriangle className={`w-6 h-6 ${killProcessInfo.force ? 'text-red-600' : 'text-yellow-600'}`} />
              <h2 className="text-xl font-semibold text-black dark:text-white">
                {killProcessInfo.force ? '强制终止进程' : '终止进程'}
              </h2>
            </div>

            {/* 弹窗内容 */}
            <div className="p-6">
              <div className="mb-4">
                <p className="text-gray-700 dark:text-gray-300 mb-2">
                  您确定要{killProcessInfo.force ? '强制' : ''}终止以下进程吗？
                </p>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 border">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-black dark:text-white">
                      {killProcessInfo.name}
                    </span>
                    <span className="text-blue-600 dark:text-blue-400 font-mono text-sm">
                      PID: {killProcessInfo.pid}
                    </span>
                  </div>
                </div>
              </div>

              {/* 风险提示 */}
              <div className={`p-3 rounded-lg border-l-4 mb-4 ${killProcessInfo.force
                ? 'bg-red-50 dark:bg-red-900/20 border-red-500'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
                }`}>
                <div className="flex items-start space-x-2">
                  <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${killProcessInfo.force ? 'text-red-600' : 'text-yellow-600'
                    }`} />
                  <div className="text-sm">
                    <p className={`font-medium ${killProcessInfo.force ? 'text-red-800 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-300'
                      }`}>
                      {killProcessInfo.force ? '⚠️ 高风险操作' : '⚠️ 注意'}
                    </p>
                    <p className={`mt-1 ${killProcessInfo.force ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'
                      }`}>
                      {killProcessInfo.force
                        ? '强制终止可能导致数据丢失或系统不稳定，进程无法正常清理资源。非必要不建议使用！'
                        : '终止进程会通知此进程进入结束流程，相对比较安全，但仍然可能会影响相关应用程序的正常运行。'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 弹窗按钮 */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={cancelKillProcess}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmKillProcess}
                className={`px-4 py-2 text-white rounded-lg transition-colors ${killProcessInfo.force
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  : 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500'
                  } focus:outline-none focus:ring-2 focus:ring-offset-2`}
              >
                {killProcessInfo.force ? '强制终止' : '确认终止'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default HomePage