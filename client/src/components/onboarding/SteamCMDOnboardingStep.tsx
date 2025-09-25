import React, { useState, useEffect } from 'react'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useSystemStore } from '@/stores/systemStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { 
  Download, 
  FolderOpen, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Monitor,
  AlertCircle,
  Info
} from 'lucide-react'

const SteamCMDOnboardingStep: React.FC = () => {
  const { completeStep } = useOnboardingStore()
  const { systemInfo } = useSystemStore()
  const { addNotification } = useNotificationStore()
  
  const [installMode, setInstallMode] = useState<'online' | 'manual'>('online')
  const [installPath, setInstallPath] = useState('')
  const [isInstalling, setIsInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installStatus, setInstallStatus] = useState('')
  const [steamcmdStatus, setSteamcmdStatus] = useState<{
    isInstalled: boolean
    version?: string
    path?: string
  }>({ isInstalled: false })

  // 根据平台设置默认路径和安装模式
  useEffect(() => {
    if (systemInfo?.platform) {
      const isWindows = systemInfo.platform.toLowerCase().includes('windows')
      const isLinux = systemInfo.platform.toLowerCase().includes('linux')

      // 设置默认路径
      const defaultPath = isWindows ? 'C:\\SteamCMD' : '/root/steamcmd'
      setInstallPath(defaultPath)

      // Linux平台默认选择手动指定路径
      if (isLinux) {
        setInstallMode('manual')
      }

      // 临时保存默认路径
      localStorage.setItem('gsm3_temp_steamcmd_path', defaultPath)
    }
  }, [systemInfo])

  // 当路径改变时临时保存
  useEffect(() => {
    if (installPath.trim()) {
      localStorage.setItem('gsm3_temp_steamcmd_path', installPath)
    } else {
      localStorage.removeItem('gsm3_temp_steamcmd_path')
    }
  }, [installPath])

  // 检查SteamCMD状态
  useEffect(() => {
    checkSteamCMDStatus()
  }, [])

  const checkSteamCMDStatus = async () => {
    try {
      const response = await fetch('/api/steamcmd/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        }
      })
      const result = await response.json()
      
      if (result.success) {
        setSteamcmdStatus(result.data)
        if (result.data.isInstalled) {
          completeStep('steamcmd')
        }
      }
    } catch (error) {
      console.error('检查SteamCMD状态失败:', error)
    }
  }

  const handleOnlineInstall = async () => {
    if (!installPath.trim()) {
      addNotification({
        type: 'error',
        title: '路径错误',
        message: '请输入有效的安装路径'
      })
      return
    }

    setIsInstalling(true)
    setInstallProgress(0)
    setInstallStatus('准备安装...')

    try {
      const response = await fetch('/api/steamcmd/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({ installPath })
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
                setInstallProgress(data.progress)
              } else if (line.startsWith('event: status')) {
                setInstallStatus(data.status)
              } else if (line.startsWith('event: complete')) {
                addNotification({
                  type: 'success',
                  title: 'SteamCMD安装成功',
                  message: data.message
                })
                await checkSteamCMDStatus()
                completeStep('steamcmd')
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
      setIsInstalling(false)
      setInstallStatus('')
      setInstallProgress(0)
    }
  }

  const handleManualPath = async () => {
    if (!installPath.trim()) {
      addNotification({
        type: 'error',
        title: '路径错误',
        message: '请输入有效的SteamCMD路径'
      })
      return
    }

    setIsInstalling(true)

    try {
      const response = await fetch('/api/steamcmd/manual-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({ installPath })
      })

      const result = await response.json()

      if (result.success) {
        addNotification({
          type: result.data.isInstalled ? 'success' : 'warning',
          title: 'SteamCMD路径设置',
          message: result.data.message
        })
        await checkSteamCMDStatus()
        if (result.data.isInstalled) {
          completeStep('steamcmd')
        }
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
      setIsInstalling(false)
    }
  }

  const isWindows = systemInfo?.platform?.toLowerCase().includes('windows')
  const isArmArchitecture = systemInfo?.arch === 'arm64' || systemInfo?.arch === 'aarch64'

  // ARM架构下自动完成步骤
  useEffect(() => {
    if (isArmArchitecture) {
      // 延迟一下让用户看到提示信息
      const timer = setTimeout(() => {
        completeStep('steamcmd')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [isArmArchitecture, completeStep])

  // 如果是ARM架构，显示不支持的提示
  if (isArmArchitecture) {
    return (
      <div className="space-y-6">
        {/* ARM架构不支持提示 */}
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-6">
          <div className="flex items-start space-x-4">
            <div className="p-3 rounded-lg bg-orange-500/20 flex-shrink-0">
              <Monitor className="w-8 h-8 text-orange-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-orange-900 dark:text-orange-100 mb-2">
                ARM架构检测
              </h3>
              <p className="text-orange-800 dark:text-orange-200 mb-4">
                检测到您当前使用的是ARM架构（{systemInfo?.arch}），SteamCMD目前不支持ARM架构。
              </p>
              <div className="space-y-2 text-sm text-orange-700 dark:text-orange-300">
                <p>• SteamCMD仅支持x86_64架构</p>
                <p>• ARM架构下将自动跳过SteamCMD配置</p>
                <p>• 您仍可以使用其他游戏部署功能，如Minecraft服务器</p>
              </div>
              <div className="mt-4 text-sm text-orange-600 dark:text-orange-400">
                正在自动跳过此步骤...
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 平台信息 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-center space-x-3">
          <Monitor className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div>
            <h3 className="font-medium text-blue-900 dark:text-blue-100">
              检测到系统平台: {systemInfo?.platform || '未知'}
            </h3>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              {isWindows
                ? '建议使用在线安装，系统将自动下载并配置SteamCMD'
                : '已为您选择手动指定路径模式，适合Docker环境或已安装SteamCMD的系统'
              }
            </p>
          </div>
        </div>
      </div>

      {/* 当前状态 */}
      {steamcmdStatus.isInstalled && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            <div>
              <h3 className="font-medium text-green-900 dark:text-green-100">
                SteamCMD 已安装
              </h3>
              <p className="text-sm text-green-700 dark:text-green-300">
                路径: {steamcmdStatus.path}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 安装模式选择 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          选择安装方式
        </h3>
        
        <div className="space-y-3">
          <label
            role="radio"
            aria-checked={installMode === 'online'}
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !isInstalling) setInstallMode('online')
            }}
            onClick={() => !isInstalling && setInstallMode('online')}
            className={`flex items-start space-x-3 cursor-pointer p-3 border rounded-lg transition-colors
              ${installMode === 'online'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400/50'
                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <input
              type="radio"
              name="installMode"
              value="online"
              checked={installMode === 'online'}
              onChange={() => setInstallMode('online')}
              className="sr-only"
              disabled={isInstalling}
            />
            <div className="flex-1">
              <div className="font-medium text-gray-900 dark:text-white">
                在线安装 (推荐)
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                自动下载并安装SteamCMD到指定目录，适合新用户
              </div>
            </div>
          </label>
          
          <label
            role="radio"
            aria-checked={installMode === 'manual'}
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !isInstalling) setInstallMode('manual')
            }}
            onClick={() => !isInstalling && setInstallMode('manual')}
            className={`flex items-start space-x-3 cursor-pointer p-3 border rounded-lg transition-colors
              ${installMode === 'manual'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400/50'
                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <input
              type="radio"
              name="installMode"
              value="manual"
              checked={installMode === 'manual'}
              onChange={() => setInstallMode('manual')}
              className="sr-only"
              disabled={isInstalling}
            />
            <div className="flex-1">
              <div className="font-medium text-gray-900 dark:text-white">
                手动指定路径
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                指定已安装的SteamCMD路径，适合已有SteamCMD的用户
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* 路径输入 */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {installMode === 'online' ? '安装路径' : 'SteamCMD路径'}
        </label>
        <input
          type="text"
          value={installPath}
          onChange={(e) => setInstallPath(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          placeholder={installMode === 'online'
            ? (isWindows ? '例如: C:\\SteamCMD' : '例如: /root/steamcmd')
            : (isWindows ? '例如: C:\\SteamCMD' : '例如: /root/steamcmd')
          }
          disabled={isInstalling}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {installMode === 'online'
            ? '选择一个空目录用于安装SteamCMD'
            : '指向包含steamcmd.exe或steamcmd.sh的目录'
          }
        </p>

        {/* Docker环境提示 - 仅在Linux平台且为手动模式时显示 */}
        {!isWindows && installMode === 'manual' && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-700 dark:text-amber-300">
                <p className="font-medium">Docker 环境提示</p>
                <p className="mt-1">若您是Docker环境请勿更改此路径，保持默认的 <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">/root/steamcmd</code> 即可。</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 安装进度 */}
      {isInstalling && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {installStatus}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {installProgress}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${installProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex justify-end">
        <button
          onClick={installMode === 'online' ? handleOnlineInstall : handleManualPath}
          disabled={isInstalling || !installPath.trim()}
          className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isInstalling ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : installMode === 'online' ? (
            <Download className="w-4 h-4" />
          ) : (
            <FolderOpen className="w-4 h-4" />
          )}
          <span>
            {isInstalling 
              ? (installMode === 'online' ? '安装中...' : '保存中...') 
              : (installMode === 'online' ? '开始安装' : '保存路径')
            }
          </span>
        </button>
      </div>

      {/* 说明信息 */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-gray-500 dark:text-gray-400 mt-0.5" />
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p className="font-medium mb-2">关于 SteamCMD:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>SteamCMD 是 Steam 的命令行版本，用于下载和更新游戏服务器</li>
              <li>支持大部分 Steam 平台的游戏服务器，如 CS2、Garry's Mod 等</li>
              <li>此步骤可以跳过，但会影响 Steam 游戏的部署功能</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SteamCMDOnboardingStep
