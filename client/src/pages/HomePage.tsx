import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { SystemStats, SystemInfo, ProcessInfo, WeatherData, ActivePort, SystemAlert } from '@/types'
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
  AlertTriangle
} from 'lucide-react'
import MusicPlayer from '@/components/MusicPlayer'

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
            <p className="text-sm text-gray-600 dark:text-gray-400">主机信息</p>
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
                        className={`text-sm font-mono break-all select-text cursor-pointer px-2 py-1 rounded transition-colors ${
                          copySuccess === ip 
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
                        className={`text-sm font-mono break-all select-text cursor-pointer px-2 py-1 rounded transition-colors ${
                          copySuccess === ip 
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

// 城市代码映射
const cityOptions = [
  { value: '101010100', label: '北京市' },
  { value: '101020100', label: '上海市' },
  { value: '101280101', label: '广州市' },
  { value: '101280601', label: '深圳市' },
  { value: '101210101', label: '杭州市' },
  { value: '101030100', label: '天津市' },
  { value: '101200101', label: '武汉市' },
  { value: '101270101', label: '成都市' },
  { value: '101110101', label: '西安市' },
  { value: '101190401', label: '苏州市' },
  { value: '101230101', label: '福州市' },
  { value: '101040100', label: '重庆市' },
  { value: '101250101', label: '长沙市' },
  { value: '101230201', label: '厦门市' },
  { value: '101180101', label: '郑州市' },
  { value: '101120101', label: '济南市' },
  { value: '101190101', label: '南京市' },
  { value: '101260101', label: '合肥市' },
  { value: '101300101', label: '南宁市' },
  { value: '101310101', label: '海口市' },
  { value: '101320101', label: '石家庄市' },
  { value: '101330101', label: '太原市' },
  { value: '101340101', label: '沈阳市' },
  { value: '101050101', label: '哈尔滨市' },
  { value: '101060101', label: '长春市' },
  { value: '101070101', label: '呼和浩特市' },
  { value: '101080101', label: '乌鲁木齐市' },
  { value: '101090101', label: '银川市' },
  { value: '101100101', label: '西宁市' },
  { value: '101150101', label: '兰州市' },
  { value: '101160101', label: '拉萨市' },
  { value: '101240101', label: '南昌市' },
  { value: '101290101', label: '昆明市' },
  { value: '101170101', label: '贵阳市' }
]

const HomePage: React.FC = () => {
  const { user } = useAuthStore()
  const { addNotification } = useNotificationStore()
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
  
  // 警报相关状态
  const [alertsShown, setAlertsShown] = useState<Set<string>>(new Set())
  const [showSystemAlert, setShowSystemAlert] = useState(false)
  const [systemAlertType, setSystemAlertType] = useState<'memory' | 'disk' | 'cpu' | null>(null)
  const [isSystemAlertClosing, setIsSystemAlertClosing] = useState(false)
  
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
    
    // 获取活跃终端进程列表
    const fetchTerminalProcesses = async () => {
      try {
        const response = await apiClient.getActiveTerminalProcesses()
        if (response.success) {
          setProcessList(response.data)
        }
      } catch (error) {
        console.error('获取终端进程列表失败:', error)
      }
    }

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
    
    fetchSystemInfo()
    fetchTerminalProcesses()
    fetchWeatherData()
    
    // 设置定时刷新
    const processInterval = setInterval(fetchTerminalProcesses, 5000)
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
      clearInterval(processInterval)
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
      
      // 监听系统告警
      socketClient.on('system-alert', (alert: SystemAlert) => {
        const currentTime = Date.now()
        const alertKey = `${alert.type}-${Math.floor(currentTime / 60000)}` // 每分钟最多一次相同类型的警报
        
        if (!alertsShown.has(alertKey)) {
          // 发送通知
          addNotification({
            type: alert.level === 'critical' ? 'error' : 'warning',
            title: `⚠️ ${alert.type === 'memory' ? '内存' : alert.type === 'disk' ? '磁盘' : alert.type === 'cpu' ? 'CPU' : '系统'}使用率警报`,
            message: `${alert.message}，当前值: ${alert.value.toFixed(1)}%`,
            duration: 10000 // 10秒后自动消失
          })
          
          // 显示系统警报弹窗
          if (!showSystemAlert) {
            setSystemAlertType(alert.type as 'memory' | 'disk' | 'cpu')
            setShowSystemAlert(true)
            setIsSystemAlertClosing(false)
          }
          
          // 记录已显示的警报
          setAlertsShown(prev => new Set([...prev, alertKey]))
        }
      })
      
      // 监听系统告警解除
      socketClient.on('system-alert-resolved', (alert: SystemAlert) => {
        // 可以在这里添加告警解除的通知
        console.log('系统告警已解除:', alert.message)
      })
      
      // 订阅系统状态、端口和进程信息
      socketClient.subscribeSystemStats()
      socketClient.subscribeSystemPorts()
      socketClient.subscribeSystemProcesses()
      
      // 初始加载状态
      if (isFirstPortsLoad) setPortsLoading(true)
      if (isFirstProcessesLoad) setProcessesLoading(true)
    }
    
    return () => {
      socketClient.off('system-stats')
      socketClient.off('system-ports')
      socketClient.off('system-processes')
      socketClient.off('system-alert')
      socketClient.off('system-alert-resolved')
      
      if (socketClient.isConnected()) {
        socketClient.emit('unsubscribe-system-stats')
        socketClient.emit('unsubscribe-system-ports')
        socketClient.emit('unsubscribe-system-processes')
      }
    }
  }, [connected])
  
  // 清理过期的警报记录（每5分钟清理一次）
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const currentTime = Date.now()
      const fiveMinutesAgo = Math.floor((currentTime - 5 * 60 * 1000) / 60000)
      
      setAlertsShown(prev => {
        const newSet = new Set<string>()
        prev.forEach(key => {
          const [type, timeKey] = key.split('-')
          if (parseInt(timeKey) > fiveMinutesAgo) {
            newSet.add(key)
          }
        })
        return newSet
      })
    }, 5 * 60 * 1000) // 每5分钟执行一次
    
    return () => clearInterval(cleanupInterval)
  }, [])
  
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
  
  // 关闭系统警报弹窗
  const closeSystemAlert = () => {
    setIsSystemAlertClosing(true)
    setTimeout(() => {
      setShowSystemAlert(false)
      setIsSystemAlertClosing(false)
      setSystemAlertType(null)
    }, 300) // 与CSS动画时间匹配
  }
  
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
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
                   {cityOptions.find(city => city.value === weatherData.selectedCityCode)?.label || weatherData.cityInfo?.city || '北京'}
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            <div className="space-y-2">
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
            <div className="space-y-2">
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
            </div>
          </div>
          
          {/* 磁盘使用率 */}
          <div className="card-game p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <HardDrive className="w-6 h-6 text-purple-500" />
                <h3 className="text-lg font-semibold text-black dark:text-white">磁盘使用率</h3>
              </div>
              <span className={`text-2xl font-bold ${getUsageColor(systemStats.disk.usage)}`}>
                {systemStats.disk.usage.toFixed(1)}%
              </span>
            </div>
            <div className="space-y-2">
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
          </div>
          

        </div>
      )}
      
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
                    <span className={`font-medium ${
                      port.protocol === 'tcp' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
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
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${
            isPortsModalClosing 
              ? 'bg-opacity-0' 
              : isPortsModalOpening 
                ? 'bg-opacity-0' 
                : 'bg-opacity-50'
          }`}
          onClick={handleClosePortsModal}
        >
          <div 
            className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col transition-all duration-300 ease-in-out transform ${
              isPortsModalClosing 
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
                        <span className={`font-medium ${
                          port.protocol === 'tcp' ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
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
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${
            isProcessesModalClosing 
              ? 'bg-opacity-0' 
              : isProcessesModalOpening 
                ? 'bg-opacity-0' 
                : 'bg-opacity-50'
          }`}
          onClick={handleCloseProcessesModal}
        >
          <div 
            className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col transition-all duration-300 ease-in-out transform ${
              isProcessesModalClosing 
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
                        <span className={`text-xs ${
                          process.status === 'Running' ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'
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
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${
            isKillConfirmClosing ? 'bg-opacity-0' : isKillConfirmVisible ? 'bg-opacity-50' : 'bg-opacity-0'
          }`}
          onClick={cancelKillProcess}
        >
          <div 
            className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md transition-all duration-300 ease-in-out transform ${
              isKillConfirmClosing ? 'scale-95 opacity-0' : isKillConfirmVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
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
              <div className={`p-3 rounded-lg border-l-4 mb-4 ${
                killProcessInfo.force 
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-500' 
                  : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
              }`}>
                <div className="flex items-start space-x-2">
                  <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    killProcessInfo.force ? 'text-red-600' : 'text-yellow-600'
                  }`} />
                  <div className="text-sm">
                    <p className={`font-medium ${
                      killProcessInfo.force ? 'text-red-800 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-300'
                    }`}>
                      {killProcessInfo.force ? '⚠️ 高风险操作' : '⚠️ 注意'}
                    </p>
                    <p className={`mt-1 ${
                      killProcessInfo.force ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'
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
                className={`px-4 py-2 text-white rounded-lg transition-colors ${
                  killProcessInfo.force
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

      {/* 系统警报弹窗 */}
      {showSystemAlert && systemAlertType && (
        <div 
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${
            isSystemAlertClosing ? 'bg-opacity-0' : 'bg-opacity-50'
          }`}
          onClick={closeSystemAlert}
        >
          <div 
            className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg transition-all duration-300 ease-in-out transform ${
              isSystemAlertClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="w-8 h-8 text-red-600 animate-pulse" />
                <h2 className="text-xl font-semibold text-black dark:text-white">
                  ⚠️ 系统资源警报
                </h2>
              </div>
              <button
                onClick={closeSystemAlert}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* 弹窗内容 */}
            <div className="p-6">
              <div className="mb-6">
                {systemAlertType === 'memory' && systemStats && (
                  <div>
                    <div className="flex items-center space-x-3 mb-4">
                      <MemoryStick className="w-6 h-6 text-red-500" />
                      <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">
                        内存使用率过高
                      </h3>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-red-800 dark:text-red-300 font-medium">当前内存使用率</span>
                        <span className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {systemStats.memory.usage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-red-200 dark:bg-red-800 rounded-full h-3 mb-2">
                        <div
                          className="h-3 bg-red-500 rounded-full transition-all duration-300"
                          style={{ width: `${systemStats.memory.usage}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-sm text-red-700 dark:text-red-400">
                        <span>已用: {formatBytes(systemStats.memory.used)}</span>
                        <span>总计: {formatBytes(systemStats.memory.total)}</span>
                      </div>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <p className="mb-2">
                        <strong>建议操作：</strong>
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                        <li>关闭不必要的应用程序和进程</li>
                        <li>检查是否有内存泄漏的程序</li>
                        <li>重启占用内存较大的服务</li>
                        <li>考虑增加系统内存</li>
                      </ul>
                    </div>
                  </div>
                )}
                
                {systemAlertType === 'disk' && systemStats && (
                  <div>
                    <div className="flex items-center space-x-3 mb-4">
                      <HardDrive className="w-6 h-6 text-red-500" />
                      <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">
                        磁盘使用率过高
                      </h3>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-red-800 dark:text-red-300 font-medium">当前磁盘使用率</span>
                        <span className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {systemStats.disk.usage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-red-200 dark:bg-red-800 rounded-full h-3 mb-2">
                        <div
                          className="h-3 bg-red-500 rounded-full transition-all duration-300"
                          style={{ width: `${systemStats.disk.usage}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-sm text-red-700 dark:text-red-400">
                        <span>已用: {formatBytes(systemStats.disk.used)}</span>
                        <span>总计: {formatBytes(systemStats.disk.total)}</span>
                      </div>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <p className="mb-2">
                        <strong>建议操作：</strong>
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                        <li>清理临时文件和缓存</li>
                        <li>删除不需要的文件和程序</li>
                        <li>清空回收站</li>
                        <li>移动大文件到其他磁盘</li>
                        <li>使用磁盘清理工具</li>
                      </ul>
                    </div>
                  </div>
                )}

                {systemAlertType === 'cpu' && systemStats && (
                  <div>
                    <div className="flex items-center space-x-3 mb-4">
                      <Cpu className="w-6 h-6 text-red-500" />
                      <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">
                        CPU使用率过高
                      </h3>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-red-800 dark:text-red-300 font-medium">当前CPU使用率</span>
                        <span className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {systemStats.cpu.usage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-red-200 dark:bg-red-800 rounded-full h-3 mb-2">
                        <div
                          className="h-3 bg-red-500 rounded-full transition-all duration-300"
                          style={{ width: `${systemStats.cpu.usage}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-sm text-red-700 dark:text-red-400">
                         <span>核心数: {systemStats.cpu.cores}</span>
                         <span>型号: {systemStats.cpu.model}</span>
                       </div>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <p className="mb-2">
                        <strong>建议操作：</strong>
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                        <li>关闭占用CPU较高的进程</li>
                        <li>检查是否有恶意软件或病毒</li>
                        <li>重启占用CPU较高的服务</li>
                        <li>检查系统后台任务</li>
                        <li>考虑升级CPU硬件</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
              
              {/* 警告提示 */}
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-yellow-600" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-800 dark:text-yellow-300">
                      ⚠️ 重要提醒
                    </p>
                    <p className="mt-1 text-yellow-700 dark:text-yellow-400">
                      {systemAlertType === 'memory' 
                        ? '内存使用率过高可能导致系统响应缓慢、程序崩溃或系统不稳定。'
                        : systemAlertType === 'disk'
                        ? '磁盘空间不足可能导致程序无法正常运行、数据无法保存或系统崩溃。'
                        : 'CPU使用率过高可能导致系统响应缓慢、程序运行异常或系统过热。'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* 弹窗按钮 */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={closeSystemAlert}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default HomePage