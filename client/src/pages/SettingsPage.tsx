import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useSystemStore } from '@/stores/systemStore'
import AutoRedirectControl from '@/components/AutoRedirectControl'
import apiClient from '@/utils/api'
import {
  Settings,
  Monitor,
  Shield,
  User,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  Check,
  Edit2,
  Download,
  FolderOpen,
  CheckCircle,
  XCircle,
  Loader2,
  Battery,
  Moon,
  MapPin,
  RefreshCw,
  Code,
  AlertTriangle
} from 'lucide-react'

const SettingsPage: React.FC = () => {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useThemeStore()
  const { user, changePassword, changeUsername, logout } = useAuthStore()
  const { addNotification } = useNotificationStore()
  const { resetOnboarding, setShowOnboarding } = useOnboardingStore()
  const { systemInfo, fetchSystemInfo } = useSystemStore()
  const [showDeveloperWarning, setShowDeveloperWarning] = useState(false)
  
  // 城市选项数据
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
  
  // 密码修改状态
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
    showOldPassword: false,
    showNewPassword: false,
    showConfirmPassword: false
  })
  const [passwordLoading, setPasswordLoading] = useState(false)
  
  // 用户名修改状态
  const [usernameForm, setUsernameForm] = useState({
    newUsername: '',
    isEditing: false
  })
  const [usernameLoading, setUsernameLoading] = useState(false)
  
  // 网页设置状态
  const [webSettings, setWebSettings] = useState({
    enableLowPowerMode: true,
    lowPowerModeTimeout: 60, // 秒
    enableDeepSleep: true,
    deepSleepTimeout: 10, // 秒
    weatherCity: '101010100' // 默认北京
  })

  // SteamCMD设置状态
  const [steamcmdSettings, setSteamcmdSettings] = useState({
    installMode: 'online' as 'online' | 'manual',
    installPath: '/root/steamcmd',
    isInstalled: false,
    version: '',
    lastChecked: ''
  })
  const [steamcmdLoading, setSteamcmdLoading] = useState(false)
  const [steamcmdStatus, setSteamcmdStatus] = useState('')
  const [steamcmdProgress, setSteamcmdProgress] = useState(0)
  const [pathCheckLoading, setPathCheckLoading] = useState(false)
  const [pathExists, setPathExists] = useState<boolean | null>(null)

  // 赞助者密钥状态
  const [sponsorKey, setSponsorKey] = useState('')
  const [sponsorKeyLoading, setSponsorKeyLoading] = useState(false)
  const [sponsorKeyStatus, setSponsorKeyStatus] = useState<{
    isValid: boolean | null
    message: string
    expiryTime?: number
  }>({ isValid: null, message: '' })

  // 终端设置状态
  const [terminalSettings, setTerminalSettings] = useState({
    defaultUser: ''
  })
  const [terminalLoading, setTerminalLoading] = useState(false)
  
  // 系统用户列表状态
  const [systemUsers, setSystemUsers] = useState<string[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)

  // 游戏设置状态
  const [gameSettings, setGameSettings] = useState({
    defaultInstallPath: ''
  })
  const [gameLoading, setGameLoading] = useState(false)

  // Steam游戏部署清单更新状态
  const [gameListUpdateLoading, setGameListUpdateLoading] = useState(false)

  // 处理密码修改
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      addNotification({
        type: 'error',
        title: '密码不匹配',
        message: '新密码和确认密码不一致'
      })
      return
    }
    
    if (passwordForm.newPassword.length < 6) {
      addNotification({
        type: 'error',
        title: '密码太短',
        message: '新密码至少需要6个字符'
      })
      return
    }
    
    setPasswordLoading(true)
    
    try {
      const result = await changePassword(passwordForm.oldPassword, passwordForm.newPassword)
      
      if (result.success) {
        addNotification({
          type: 'success',
          title: '密码修改成功',
          message: '密码已更新，即将退出登录'
        })
        
        setPasswordForm({
          oldPassword: '',
          newPassword: '',
          confirmPassword: '',
          showOldPassword: false,
          showNewPassword: false,
          showConfirmPassword: false
        })
        
        // 密码修改成功后自动退出登录
        setTimeout(async () => {
          await logout()
        }, 1500)
      } else {
        addNotification({
          type: 'error',
          title: '密码修改失败',
          message: result.message
        })
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: '修改失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      setPasswordLoading(false)
    }
  }
  
  // 处理用户名修改
  const handleUsernameChange = async () => {
    if (!usernameForm.newUsername.trim()) {
      addNotification({
        type: 'error',
        title: '输入错误',
        message: '请输入新用户名'
      })
      return
    }
    
    if (!/^[a-zA-Z0-9]{3,30}$/.test(usernameForm.newUsername)) {
      addNotification({
        type: 'error',
        title: '格式错误',
        message: '用户名只能包含字母和数字，长度为3-30个字符'
      })
      return
    }
    
    if (usernameForm.newUsername === user?.username) {
      addNotification({
        type: 'warning',
        title: '无需修改',
        message: '新用户名与当前用户名相同'
      })
      return
    }
    
    setUsernameLoading(true)
    
    try {
      const result = await changeUsername(usernameForm.newUsername)
      
      if (result.success) {
        addNotification({
          type: 'success',
          title: '用户名修改成功',
          message: '用户名已更新，即将退出登录'
        })
        
        setUsernameForm({
          newUsername: '',
          isEditing: false
        })
        
        // 用户名修改成功后自动退出登录
        setTimeout(async () => {
          await logout()
        }, 1500)
      } else {
        addNotification({
          type: 'error',
          title: '用户名修改失败',
          message: result.message
        })
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: '修改失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      setUsernameLoading(false)
    }
  }
  
  // 取消用户名编辑
  const handleCancelUsernameEdit = () => {
    setUsernameForm({
      newUsername: '',
      isEditing: false
    })
  }

  // 处理赞助者密钥校验
  const handleClearSponsorKey = async () => {
    try {
      const result = await apiClient.clearSponsorKey()
      if (result.success) {
        setSponsorKey('')
        setSponsorKeyStatus({
          isValid: false,
          message: '',
          expiryTime: null
        })
        addNotification({
          type: 'success',
          title: '操作成功',
          message: '赞助者密钥已清除'
        })
      } else {
        addNotification({
          type: 'error',
          title: '操作失败',
          message: result.message || '清除密钥失败'
        })
      }
    } catch (error) {
      console.error('清除赞助者密钥失败:', error)
      addNotification({
        type: 'error',
        title: '网络错误',
        message: '请稍后重试'
      })
    }
  }

  const handleSponsorKeyValidation = async () => {
    if (!sponsorKey.trim()) {
      addNotification({
        type: 'error',
        title: '输入错误',
        message: '请输入赞助者密钥'
      })
      return
    }

    setSponsorKeyLoading(true)
    setSponsorKeyStatus({ isValid: null, message: '' })

    try {
      const result = await apiClient.validateSponsorKey(sponsorKey)

      if (result.success) {
        const { data } = result
        const isExpired = data.is_expired
        const expiryTime = data.timeData
        
        setSponsorKeyStatus({
          isValid: !isExpired,
          message: isExpired ? '密钥已过期' : '密钥有效',
          expiryTime: expiryTime
        })

        addNotification({
          type: isExpired ? 'warning' : 'success',
          title: '密钥校验完成',
          message: isExpired ? '密钥已过期，请联系管理员更新' : '密钥验证成功'
        })

        // 密钥已保存到服务器，显示预览格式
        if (!isExpired) {
          setSponsorKey(sponsorKey.substring(0, 8) + '...')
        }
      } else {
        setSponsorKeyStatus({
          isValid: false,
          message: result.message || '密钥校验失败'
        })

        addNotification({
          type: 'error',
          title: '密钥校验失败',
          message: result.message || '无效的赞助者密钥'
        })
      }
    } catch (error: any) {
      // 检查是否是API响应错误（包含具体错误信息）
      if (error.success === false && error.message) {
        // 这是从API返回的错误响应
        setSponsorKeyStatus({
          isValid: false,
          message: error.message
        })

        addNotification({
          type: 'error',
          title: '密钥校验失败',
          message: '请检查密钥是否正确且在有效期内，如有问题请联系项目开发者'
        })
      } else {
        // 真正的网络错误
        setSponsorKeyStatus({
          isValid: false,
          message: '网络错误，请稍后重试'
        })

        addNotification({
          type: 'error',
          title: '网络错误',
          message: '请稍后重试'
        })
      }
    } finally {
      setSponsorKeyLoading(false)
    }
  }

  // SteamCMD相关处理函数
  const fetchSteamCMDStatus = async () => {
    try {
      const response = await fetch('/api/steamcmd/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        }
      })
      const result = await response.json()
      
      if (result.success) {
        setSteamcmdSettings(prev => ({
          ...prev,
          ...result.data
        }))
      }
    } catch (error) {
      console.error('获取SteamCMD状态失败:', error)
    }
  }

  const handleOnlineInstall = async () => {
    if (!steamcmdSettings.installPath.trim()) {
      addNotification({
        type: 'error',
        title: '安装路径错误',
        message: '请输入有效的安装路径'
      })
      return
    }

    setSteamcmdLoading(true)
    setSteamcmdProgress(0)
    setSteamcmdStatus('准备安装...')

    try {
      const response = await fetch('/api/steamcmd/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({
          installPath: steamcmdSettings.installPath
        })
      })

      if (!response.ok) {
        throw new Error('安装请求失败')
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (line.startsWith('event: progress')) {
                setSteamcmdProgress(data.progress)
              } else if (line.startsWith('event: status')) {
                setSteamcmdStatus(data.status)
              } else if (line.startsWith('event: complete')) {
                addNotification({
                  type: 'success',
                  title: 'SteamCMD安装成功',
                  message: data.message
                })
                await fetchSteamCMDStatus()
              } else if (line.startsWith('event: error')) {
                addNotification({
                  type: 'error',
                  title: 'SteamCMD安装失败',
                  message: data.message
                })
              }
            } catch (e) {
              console.error('解析SSE数据失败:', e)
            }
          }
        }
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: '安装失败',
        message: error instanceof Error ? error.message : '未知错误'
      })
    } finally {
      setSteamcmdLoading(false)
      setSteamcmdStatus('')
      setSteamcmdProgress(0)
    }
  }

  const handleManualPath = async () => {
    if (!steamcmdSettings.installPath.trim()) {
      addNotification({
        type: 'error',
        title: '路径错误',
        message: '请输入有效的SteamCMD路径'
      })
      return
    }

    setSteamcmdLoading(true)

    try {
      const response = await fetch('/api/steamcmd/manual-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({
          installPath: steamcmdSettings.installPath
        })
      })

      const result = await response.json()

      if (result.success) {
        addNotification({
          type: result.data.isInstalled ? 'success' : 'warning',
          title: 'SteamCMD路径设置',
          message: result.data.message
        })
        await fetchSteamCMDStatus()
      } else {
        addNotification({
          type: 'error',
          title: '设置失败',
          message: result.message
        })
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: '设置失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      setSteamcmdLoading(false)
    }
  }

  const checkPath = async () => {
    if (!steamcmdSettings.installPath.trim()) {
      setPathExists(null)
      return
    }

    setPathCheckLoading(true)

    try {
      const response = await fetch('/api/steamcmd/check-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({
          installPath: steamcmdSettings.installPath
        })
      })

      const result = await response.json()

      if (result.success) {
        setPathExists(result.data.exists)
      } else {
        setPathExists(false)
      }
    } catch (error) {
      setPathExists(false)
    } finally {
      setPathCheckLoading(false)
    }
  }

  // 页面加载时获取SteamCMD状态和本地设置
  React.useEffect(() => {
    fetchSteamCMDStatus()
    fetchSystemInfo() // 获取系统信息以检测ARM架构

    // 从localStorage加载网页设置
    try {
      const savedWebSettings = localStorage.getItem('webSettings')
      if (savedWebSettings) {
        const parsedSettings = JSON.parse(savedWebSettings)
        setWebSettings(prev => ({ ...prev, ...parsedSettings }))
      }
    } catch (error) {
      console.error('加载本地设置失败:', error)
    }

    // 从服务器获取已保存的赞助者密钥信息
    const loadSponsorKeyInfo = async () => {
      try {
        const result = await apiClient.getSponsorKeyInfo()
        if (result.success && result.data) {
          // 设置密钥状态信息
          setSponsorKeyStatus({
            isValid: result.data.isValid,
            message: result.data.isValid ? '密钥有效' : '密钥已过期',
            expiryTime: result.data.expiryTime
          })
          // 显示密钥预览
          setSponsorKey(result.data.keyPreview)
        }
      } catch (error) {
        console.error('获取赞助者密钥信息失败:', error)
      }
    }
    
    // 从服务器加载终端配置
    const loadTerminalSettings = async () => {
      try {
        const result = await apiClient.getTerminalConfig()
        if (result.success && result.data) {
          setTerminalSettings({
            defaultUser: result.data.defaultUser || ''
          })
        }
      } catch (error) {
        console.error('加载终端配置失败:', error)
      }
    }
    
    // 获取系统用户列表
    const fetchSystemUsers = async () => {
      setLoadingUsers(true)
      try {
        const result = await apiClient.getSystemUsers()
        if (result.success && result.data) {
          setSystemUsers(result.data)
        }
      } catch (error) {
        console.error('获取系统用户列表失败:', error)
      } finally {
        setLoadingUsers(false)
      }
    }

    // 从服务器加载游戏配置
    const loadGameSettings = async () => {
      try {
        const response = await fetch('/api/settings/game-path', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
          }
        })
        const result = await response.json()
        if (result.success && result.data) {
          setGameSettings({
            defaultInstallPath: result.data.defaultInstallPath || ''
          })
        }
      } catch (error) {
        console.error('加载游戏配置失败:', error)
        // 尝试从本地存储加载
        const localPath = localStorage.getItem('gsm3_default_game_path')
        if (localPath) {
          setGameSettings({
            defaultInstallPath: localPath
          })
        }
      }
    }
    
    loadSponsorKeyInfo()
    loadTerminalSettings()
    loadGameSettings()
    fetchSystemUsers()
  }, [])

  // 路径变化时检查
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (steamcmdSettings.installPath) {
        checkPath()
      } else {
        setPathExists(null)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [steamcmdSettings.installPath])
  
  // 保存终端设置
  const saveTerminalSettings = async () => {
    setTerminalLoading(true)
    try {
      const response = await apiClient.updateTerminalConfig(terminalSettings)
      if (response.success) {
        addNotification({
          type: 'success',
          title: '终端设置已保存',
          message: '终端配置已成功更新'
        })
      } else {
        addNotification({
          type: 'error',
          title: '保存失败',
          message: response.message || '终端设置保存失败'
        })
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: '保存失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      setTerminalLoading(false)
    }
  }

  // 保存游戏设置
  const saveGameSettings = async () => {
    setGameLoading(true)
    try {
      const response = await fetch('/api/settings/game-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({ defaultGamePath: gameSettings.defaultInstallPath })
      })
      const result = await response.json()

      if (result.success) {
        // 同时保存到本地存储
        localStorage.setItem('gsm3_default_game_path', gameSettings.defaultInstallPath)

        addNotification({
          type: 'success',
          title: '游戏设置已保存',
          message: '游戏默认安装路径已成功更新'
        })
      } else {
        addNotification({
          type: 'error',
          title: '保存失败',
          message: result.message || '游戏设置保存失败'
        })
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: '保存失败',
        message: '网络错误，请稍后重试'
      })
    } finally {
      setGameLoading(false)
    }
  }

  // 保存设置
  const saveSettings = async () => {
    try {
      // 保存网页设置到localStorage
      localStorage.setItem('webSettings', JSON.stringify(webSettings))
      
      // 保存终端设置到服务器
      await saveTerminalSettings()
      
      addNotification({
        type: 'success',
        title: '设置已保存',
        message: '您的设置已成功保存'
      })
    } catch (error) {
      addNotification({
        type: 'error',
        title: '保存失败',
        message: '设置保存失败，请稍后重试'
      })
    }
  }
  
  // 重置设置
  const resetSettings = () => {
    const defaultWebSettings = {
      enableLowPowerMode: true,
      lowPowerModeTimeout: 60,
      enableDeepSleep: true,
      deepSleepTimeout: 10,
      weatherCity: '101010100'
    }
    
    const defaultTerminalSettings = {
      defaultUser: ''
    }
    
    setWebSettings(defaultWebSettings)
    setTerminalSettings(defaultTerminalSettings)
    
    // 清除localStorage中的设置
    localStorage.removeItem('webSettings')
    
    addNotification({
      type: 'info',
      title: '设置已重置',
      message: '所有设置已恢复为默认值'
    })
  }

  // 更新Steam游戏部署清单
  const handleUpdateGameList = async () => {
    setGameListUpdateLoading(true)
    try {
      const response = await apiClient.updateSteamGameList()
      
      if (response.success) {
        addNotification({
          type: 'success',
          title: '更新成功',
          message: `游戏部署清单已更新，共${response.data?.gameCount || 0}个游戏`
        })
      } else {
        addNotification({
          type: 'error',
          title: '更新失败',
          message: response.message || '更新游戏部署清单失败'
        })
      }
    } catch (error: any) {
      addNotification({
        type: 'error',
        title: '更新失败',
        message: error.message || '网络错误，请稍后重试'
      })
    } finally {
      setGameListUpdateLoading(false)
    }
  }

  // 处理开发者页面跳转
  const handleDeveloperPageAccess = () => {
    setShowDeveloperWarning(true)
  }

  const confirmDeveloperAccess = () => {
    setShowDeveloperWarning(false)
    navigate('/developer')
  }

  const cancelDeveloperAccess = () => {
    setShowDeveloperWarning(false)
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="card-game p-6">
        <div className="flex items-center space-x-3">
          <Settings className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-black dark:text-white font-display">
            系统设置
          </h1>
        </div>
        <p className="text-gray-700 dark:text-gray-300 mt-2">
          自定义您的GSM3游戏面板体验
        </p>
      </div>
      
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 网页设置 */}
        <div className="card-game p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Monitor className="w-5 h-5 text-purple-500" />
            <h2 className="text-lg font-semibold text-black dark:text-white">网页设置</h2>
          </div>
          
          <div className="space-y-6">
            {/* 主题模式 */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-800 dark:text-gray-200">主题模式</label>
                <p className="text-xs text-gray-600 dark:text-gray-400">选择浅色或深色主题</p>
              </div>
              <button
                onClick={toggleTheme}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                  ${theme === 'dark' ? 'bg-blue-600' : 'bg-gray-300'}
                `}
              >
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                    ${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'}
                  `}
                />
              </button>
            </div>
            
            {/* 低功耗模式 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Battery className="w-4 h-4 text-green-500" />
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">低功耗模式</label>
                    <p className="text-xs text-gray-600 dark:text-gray-400">鼠标无活动时自动断开WebSocket连接并优化页面性能</p>
                  </div>
                </div>
                <button
                  onClick={() => setWebSettings(prev => ({ ...prev, enableLowPowerMode: !prev.enableLowPowerMode }))}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${webSettings.enableLowPowerMode ? 'bg-green-600' : 'bg-gray-300'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                      ${webSettings.enableLowPowerMode ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
              
              {webSettings.enableLowPowerMode && (
                <div className="ml-6 space-y-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    进入时间 (秒)
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="300"
                    value={webSettings.lowPowerModeTimeout}
                    onChange={(e) => setWebSettings(prev => ({ 
                      ...prev, 
                      lowPowerModeTimeout: Math.max(10, Math.min(300, parseInt(e.target.value) || 60))
                    }))}
                    className="w-20 px-2 py-1 text-sm bg-white/10 border border-white/20 rounded text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    当前设置: {webSettings.lowPowerModeTimeout}秒后进入低功耗模式
                  </p>
                </div>
              )}
            </div>
            
            {/* 深度睡眠模式 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Moon className="w-4 h-4 text-blue-500" />
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">深度睡眠模式</label>
                    <p className="text-xs text-gray-600 dark:text-gray-400">标签页隐藏时快速进入低功耗状态，暂停媒体播放</p>
                  </div>
                </div>
                <button
                  onClick={() => setWebSettings(prev => ({ ...prev, enableDeepSleep: !prev.enableDeepSleep }))}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${webSettings.enableDeepSleep ? 'bg-blue-600' : 'bg-gray-300'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                      ${webSettings.enableDeepSleep ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
              
              {webSettings.enableDeepSleep && (
                <div className="ml-6 space-y-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    进入时间 (秒)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="60"
                    value={webSettings.deepSleepTimeout}
                    onChange={(e) => setWebSettings(prev => ({ 
                      ...prev, 
                      deepSleepTimeout: Math.max(5, Math.min(60, parseInt(e.target.value) || 10))
                    }))}
                    className="w-20 px-2 py-1 text-sm bg-white/10 border border-white/20 rounded text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    当前设置: 标签页隐藏{webSettings.deepSleepTimeout}秒后进入深度睡眠
                  </p>
                </div>
              )}
            </div>
            
            {/* 天气地理位置 */}
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-orange-500" />
                <div>
                  <label className="text-sm font-medium text-gray-800 dark:text-gray-200">天气地理位置</label>
                  <p className="text-xs text-gray-600 dark:text-gray-400">选择首页显示的天气城市</p>
                </div>
              </div>
              
              <select
                value={webSettings.weatherCity}
                onChange={(e) => setWebSettings(prev => ({ ...prev, weatherCity: e.target.value }))}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {cityOptions.map((city) => (
                  <option key={city.value} value={city.value} className="bg-white dark:bg-gray-800">
                    {city.label}
                  </option>
                ))}
              </select>
              
              <p className="text-xs text-gray-600 dark:text-gray-400">
                当前选择: {cityOptions.find(city => city.value === webSettings.weatherCity)?.label || '未知城市'}
              </p>
            </div>
            
            <div className="pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                当前主题: <span className="font-semibold">{theme === 'dark' ? '深色模式' : '浅色模式'}</span>
              </p>
              <div className="mt-2 space-y-1">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  • 低功耗模式: {webSettings.enableLowPowerMode ? '已启用' : '已禁用'}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  • 深度睡眠: {webSettings.enableDeepSleep ? '已启用' : '已禁用'}
                </p>
              </div>
            </div>
          </div>
        </div>
        
        {/* SteamCMD设置 - 检测到ARM架构时隐藏 */}
        {!(systemInfo?.arch === 'arm64' || systemInfo?.arch === 'aarch64') && (
        <div className="card-game p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Download className="w-5 h-5 text-green-500" />
            <h2 className="text-lg font-semibold text-black dark:text-white">SteamCMD设置</h2>
          </div>
          
          <div className="space-y-6">
            {/* 当前状态 */}
            <div className="p-4 bg-white/5 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">当前状态</h3>
                <div className="flex items-center space-x-2">
                  {steamcmdSettings.isInstalled ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm ${
                    steamcmdSettings.isInstalled ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {steamcmdSettings.isInstalled ? '已安装' : '未安装'}
                  </span>
                </div>
              </div>
              
              {steamcmdSettings.installPath && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  安装路径: {steamcmdSettings.installPath}
                </p>
              )}
              
              {steamcmdSettings.lastChecked && (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  最后检查: {new Date(steamcmdSettings.lastChecked).toLocaleString()}
                </p>
              )}
            </div>
            
            {/* 安装模式选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-3">
                安装模式
              </label>
              <div className="space-y-3">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="installMode"
                    value="online"
                    checked={steamcmdSettings.installMode === 'online'}
                    onChange={(e) => setSteamcmdSettings(prev => ({
                      ...prev,
                      installMode: e.target.value as 'online' | 'manual'
                    }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                    disabled={steamcmdLoading}
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      在线安装
                    </span>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      自动下载并安装SteamCMD到指定目录
                    </p>
                  </div>
                </label>
                
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="installMode"
                    value="manual"
                    checked={steamcmdSettings.installMode === 'manual'}
                    onChange={(e) => setSteamcmdSettings(prev => ({
                      ...prev,
                      installMode: e.target.value as 'online' | 'manual'
                    }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                    disabled={steamcmdLoading}
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      手动设置
                    </span>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      指定已安装的SteamCMD路径
                    </p>
                  </div>
                </label>
              </div>
            </div>
            
            {/* 路径输入 */}
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                {steamcmdSettings.installMode === 'online' ? '安装路径' : 'SteamCMD路径'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={steamcmdSettings.installPath}
                  onChange={(e) => setSteamcmdSettings(prev => ({
                    ...prev,
                    installPath: e.target.value
                  }))}
                  className="w-full px-3 py-2 pr-10 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={steamcmdSettings.installMode === 'online' 
                    ? '例如: C:\\SteamCMD 或 容器写 /root/steamcmd' 
                    : '例如: C:\\SteamCMD 或 容器写 /root/steamcmd'
                  }
                  disabled={steamcmdLoading}
                />
                
                {/* 路径检查状态 */}
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  {pathCheckLoading ? (
                    <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                  ) : pathExists === true ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : pathExists === false ? (
                    <XCircle className="w-4 h-4 text-red-500" />
                  ) : null}
                </div>
              </div>
              
              {steamcmdSettings.installMode === 'manual' && pathExists === false && (
                <p className="text-xs text-red-500 mt-1">
                  在指定路径下未找到steamcmd.exe或steamcmd.sh文件。容器中请填写为/root/steamcmd
                </p>
              )}
              
              {steamcmdSettings.installMode === 'manual' && pathExists === true && (
                <p className="text-xs text-green-500 mt-1">
                  已找到SteamCMD可执行文件
                </p>
              )}
            </div>
            
            {/* 安装进度 */}
            {steamcmdLoading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-800 dark:text-gray-200">
                    {steamcmdStatus}
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {steamcmdProgress}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${steamcmdProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
            
            {/* 操作按钮 */}
            <div className="flex space-x-3">
              {steamcmdSettings.installMode === 'online' ? (
                <button
                  onClick={handleOnlineInstall}
                  disabled={steamcmdLoading || !steamcmdSettings.installPath.trim()}
                  className="flex-1 btn-game py-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {steamcmdLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>{steamcmdLoading ? '安装中...' : '开始安装'}</span>
                </button>
              ) : (
                <button
                  onClick={handleManualPath}
                  disabled={steamcmdLoading || !steamcmdSettings.installPath.trim()}
                  className="flex-1 btn-game py-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {steamcmdLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FolderOpen className="w-4 h-4" />
                  )}
                  <span>{steamcmdLoading ? '设置中...' : '设置路径'}</span>
                </button>
              )}
              
              <button
                onClick={fetchSteamCMDStatus}
                disabled={steamcmdLoading}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="刷新状态"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        )}

        {/* 赞助者密钥 */}
        <div className="card-game p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Shield className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold text-black dark:text-white">赞助者密钥</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                密钥
              </label>
              <div className="flex space-x-3">
                <input
                  type="text"
                  value={sponsorKey}
                  onChange={(e) => setSponsorKey(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  placeholder="请输入赞助者密钥"
                  disabled={sponsorKeyLoading}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSponsorKeyValidation}
                    disabled={sponsorKeyLoading || !sponsorKey.trim()}
                    className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                  >
                    {sponsorKeyLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    <span>{sponsorKeyLoading ? '校验中...' : '校验密钥'}</span>
                  </button>
                  {sponsorKeyStatus.isValid && (
                    <button
                      onClick={handleClearSponsorKey}
                      disabled={sponsorKeyLoading}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* 密钥状态显示 */}
            {sponsorKeyStatus.message && (
              <div className={`p-3 rounded-lg ${
                sponsorKeyStatus.isValid === true 
                  ? 'bg-green-500/20 border border-green-500/30' 
                  : sponsorKeyStatus.isValid === false 
                  ? 'bg-red-500/20 border border-red-500/30'
                  : 'bg-yellow-500/20 border border-yellow-500/30'
              }`}>
                <div className="flex items-center space-x-2">
                  {sponsorKeyStatus.isValid === true ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : sponsorKeyStatus.isValid === false ? (
                    <XCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-yellow-500" />
                  )}
                  <span className={`text-sm font-medium ${
                    sponsorKeyStatus.isValid === true 
                      ? 'text-green-500' 
                      : sponsorKeyStatus.isValid === false 
                      ? 'text-red-500'
                      : 'text-yellow-500'
                  }`}>
                    {sponsorKeyStatus.message}
                  </span>
                </div>
                
                {sponsorKeyStatus.expiryTime && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    到期时间: {new Date(sponsorKeyStatus.expiryTime).toLocaleString()}
                  </p>
                )}
              </div>
            )}
            
            <div className="text-xs text-gray-600 dark:text-gray-400">
              <p>• 赞助者密钥用于验证您的赞助者身份</p>
              <p>• 密钥验证成功后将自动保存到本地</p>
              <p>• 如需获取密钥，请联系管理员</p>
            </div>
          </div>
        </div>
        
        {/* 终端选项 */}
        <div className="card-game p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Monitor className="w-5 h-5 text-green-500" />
            <h2 className="text-lg font-semibold text-black dark:text-white">终端选项</h2>
          </div>
          
          <div className="space-y-4">
            {/* 默认用户设置 */}
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                默认用户 (仅Linux有效)
              </label>
              <select
                value={terminalSettings.defaultUser}
                onChange={(e) => setTerminalSettings(prev => ({
                  ...prev,
                  defaultUser: e.target.value
                }))}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                disabled={terminalLoading || loadingUsers}
              >
                <option value="">默认用户（留空使用当前用户）</option>
                {systemUsers.map(user => (
                  <option key={user} value={user}>{user}</option>
                ))}
              </select>
              {loadingUsers && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  正在加载用户列表...
                </p>
              )}
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                • 设置后，新建终端将自动切换到指定用户
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                • 此功能仅在Linux系统下生效，Windows系统将忽略此设置
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                • 请确保指定的用户存在且当前用户有权限切换到该用户
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                • 如果当用户不存在或切换错误，终端将会自动切换回当前用户
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                • Docker中将此值填写为steam
              </p>              
            </div>
            
            {/* 保存按钮 */}
            <div className="flex justify-end">
              <button
                onClick={saveTerminalSettings}
                disabled={terminalLoading}
                className="btn-game px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {terminalLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{terminalLoading ? '保存中...' : '保存终端设置'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 游戏设置 */}
        <div className="card-game p-6">
          <div className="flex items-center space-x-3 mb-6">
            <FolderOpen className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-semibold text-black dark:text-white">游戏设置</h2>
          </div>

          <div className="space-y-4">
            {/* 默认安装路径设置 */}
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                游戏默认安装路径
              </label>
              <input
                type="text"
                value={gameSettings.defaultInstallPath}
                onChange={(e) => setGameSettings(prev => ({
                  ...prev,
                  defaultInstallPath: e.target.value
                }))}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="例如: D:\Games 或 /home/steam/games"
                disabled={gameLoading}
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                • 设置后，所有游戏部署时将默认使用此路径
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                • 可以在每次部署时修改具体的安装路径
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                • 建议选择磁盘空间充足的位置
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                • 路径中避免使用特殊字符和中文字符
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end">
              <button
                onClick={saveGameSettings}
                disabled={gameLoading}
                className="btn-game px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {gameLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{gameLoading ? '保存中...' : '保存游戏设置'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 账户安全 */}
        <div className="card-game p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Shield className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-semibold text-black dark:text-white">账户安全</h2>
          </div>
          
          {/* 用户信息 */}
          <div className="mb-6 p-4 bg-white/5 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <User className="w-8 h-8 text-blue-500" />
                <div>
                  {usernameForm.isEditing ? (
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={usernameForm.newUsername}
                        onChange={(e) => setUsernameForm(prev => ({
                          ...prev,
                          newUsername: e.target.value
                        }))}
                        className="px-2 py-1 bg-white/10 border border-white/20 rounded text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="输入新用户名"
                        disabled={usernameLoading}
                      />
                      <button
                        onClick={handleUsernameChange}
                        disabled={usernameLoading}
                        className="p-1 text-green-500 hover:text-green-400 disabled:opacity-50"
                        title="确认修改"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleCancelUsernameEdit}
                        disabled={usernameLoading}
                        className="p-1 text-gray-500 hover:text-gray-400 disabled:opacity-50"
                        title="取消修改"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                       <p className="text-black dark:text-white font-medium">{user?.username}</p>
                       <button
                         onClick={() => setUsernameForm(prev => ({
                           ...prev,
                           isEditing: true,
                           newUsername: user?.username || ''
                         }))}
                         className="p-1 text-blue-500 hover:text-blue-400"
                         title="修改用户名"
                       >
                         <Edit2 className="w-4 h-4" />
                       </button>
                     </div>
                  )}
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {user?.role === 'admin' ? '管理员' : '普通用户'}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* 自动跳转控制 */}
          <div className="mb-6">
            <AutoRedirectControl />
          </div>
          
          {/* 修改密码表单 */}
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                当前密码
              </label>
              <div className="relative">
                <input
                  type={passwordForm.showOldPassword ? 'text' : 'password'}
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm(prev => ({
                    ...prev,
                    oldPassword: e.target.value
                  }))}
                  className="w-full px-3 py-2 pr-10 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入当前密码"
                  disabled={passwordLoading}
                />
                <button
                  type="button"
                  onClick={() => setPasswordForm(prev => ({
                    ...prev,
                    showOldPassword: !prev.showOldPassword
                  }))}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white"
                >
                  {passwordForm.showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                新密码
              </label>
              <div className="relative">
                <input
                  type={passwordForm.showNewPassword ? 'text' : 'password'}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm(prev => ({
                    ...prev,
                    newPassword: e.target.value
                  }))}
                  className="w-full px-3 py-2 pr-10 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入新密码"
                  disabled={passwordLoading}
                />
                <button
                  type="button"
                  onClick={() => setPasswordForm(prev => ({
                    ...prev,
                    showNewPassword: !prev.showNewPassword
                  }))}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white"
                >
                  {passwordForm.showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                确认新密码
              </label>
              <div className="relative">
                <input
                  type={passwordForm.showConfirmPassword ? 'text' : 'password'}
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm(prev => ({
                    ...prev,
                    confirmPassword: e.target.value
                  }))}
                  className="w-full px-3 py-2 pr-10 bg-white/10 border border-white/20 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请再次输入新密码"
                  disabled={passwordLoading}
                />
                <button
                  type="button"
                  onClick={() => setPasswordForm(prev => ({
                    ...prev,
                    showConfirmPassword: !prev.showConfirmPassword
                  }))}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white"
                >
                  {passwordForm.showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <button
              type="submit"
              disabled={passwordLoading || !passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
              className="w-full btn-game py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {passwordLoading ? '修改中...' : '修改密码'}
            </button>
          </form>
        </div>
      </div>
      
      {/* 操作按钮 */}
      <div className="card-game p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-black dark:text-white mb-1">设置操作</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">保存或重置您的设置</p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleDeveloperPageAccess}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors flex items-center space-x-2"
            >
              <Code className="w-4 h-4" />
              <span>进入开发者页面</span>
            </button>

            <button
              onClick={() => {
                resetOnboarding()
                setShowOnboarding(true)
                addNotification({
                  type: 'info',
                  title: '新手引导已启动',
                  message: '新手引导界面即将显示'
                })
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center space-x-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>重新启动新手引导</span>
            </button>

            <button
              onClick={handleUpdateGameList}
              disabled={gameListUpdateLoading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg transition-colors flex items-center space-x-2 disabled:cursor-not-allowed"
            >
              {gameListUpdateLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{gameListUpdateLoading ? '更新中...' : '更新Steam游戏部署清单'}</span>
            </button>

            <button
              onClick={resetSettings}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors flex items-center space-x-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>重置设置</span>
            </button>

            <button
              onClick={saveSettings}
              className="btn-game px-4 py-2 flex items-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>保存设置</span>
            </button>
          </div>
        </div>
      </div>

      {/* 开发者页面警告弹窗 */}
      {showDeveloperWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <div className="flex items-center space-x-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-orange-500" />
              <h3 className="text-lg font-semibold text-black dark:text-white">
                开发者页面警告
              </h3>
            </div>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              此界面普通用户无需进入，若使用相关功能造成的一切后果需自行负责！
            </p>
            <div className="flex space-x-3 justify-end">
              <button
                onClick={cancelDeveloperAccess}
                className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDeveloperAccess}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
              >
                确认进入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsPage