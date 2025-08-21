import React, { useState, useEffect } from 'react'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useSystemStore } from '@/stores/systemStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { 
  FolderOpen, 
  Save, 
  CheckCircle, 
  AlertCircle,
  Info,
  HardDrive,
  Loader2
} from 'lucide-react'

const GamePathOnboardingStep: React.FC = () => {
  const { completeStep } = useOnboardingStore()
  const { systemInfo } = useSystemStore()
  const { addNotification } = useNotificationStore()
  
  const [defaultGamePath, setDefaultGamePath] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isPathValid, setIsPathValid] = useState<boolean | null>(null)

  // 根据平台设置默认路径
  useEffect(() => {
    if (systemInfo?.platform) {
      const isWindows = systemInfo.platform.toLowerCase().includes('windows')
      setDefaultGamePath(isWindows ? 'D:\\Games' : '/home/steam/games')
    }
  }, [systemInfo])

  // 验证路径格式并临时保存
  useEffect(() => {
    if (defaultGamePath.trim()) {
      validatePath(defaultGamePath)
      // 临时保存到localStorage，供退出时使用
      localStorage.setItem('gsm3_temp_game_path', defaultGamePath)
    } else {
      setIsPathValid(null)
      localStorage.removeItem('gsm3_temp_game_path')
    }
  }, [defaultGamePath])

  const validatePath = (path: string) => {
    // 基本路径格式验证
    const isWindows = systemInfo?.platform?.toLowerCase().includes('windows')
    
    if (isWindows) {
      // Windows 路径验证
      const windowsPathRegex = /^[A-Za-z]:\\(?:[^<>:"|?*\r\n]+\\)*[^<>:"|?*\r\n]*$/
      setIsPathValid(windowsPathRegex.test(path))
    } else {
      // Linux/Unix 路径验证
      const unixPathRegex = /^\/(?:[^\/\0]+\/)*[^\/\0]*$/
      setIsPathValid(unixPathRegex.test(path))
    }
  }

  const handleSave = async () => {
    if (!defaultGamePath.trim()) {
      addNotification({
        type: 'error',
        title: '路径错误',
        message: '请输入有效的游戏安装路径'
      })
      return
    }

    if (!isPathValid) {
      addNotification({
        type: 'error',
        title: '路径格式错误',
        message: '请输入正确格式的路径'
      })
      return
    }

    setIsSaving(true)

    try {
      // 保存到服务器配置
      const response = await fetch('/api/settings/game-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({ defaultGamePath })
      })

      const result = await response.json()

      if (result.success) {
        // 同时保存到本地存储作为备份
        localStorage.setItem('gsm3_default_game_path', defaultGamePath)
        
        addNotification({
          type: 'success',
          title: '设置保存成功',
          message: '游戏默认安装路径已设置'
        })
        
        completeStep('game-path')
      } else {
        addNotification({
          type: 'error',
          title: '保存失败',
          message: result.message || '设置保存失败'
        })
      }
    } catch (error) {
      // 如果服务器保存失败，至少保存到本地
      localStorage.setItem('gsm3_default_game_path', defaultGamePath)
      
      addNotification({
        type: 'warning',
        title: '已保存到本地',
        message: '服务器保存失败，但已保存到本地存储'
      })
      
      completeStep('game-path')
    } finally {
      setIsSaving(false)
    }
  }

  const getPathExamples = () => {
    const isWindows = systemInfo?.platform?.toLowerCase().includes('windows')
    
    if (isWindows) {
      return [
        'D:\\Games',
        'C:\\GameServers',
        'E:\\Steam\\GameServers'
      ]
    } else {
      return [
        '/home/steam/games',
        '/opt/gameservers',
        '/var/games'
      ]
    }
  }

  const isWindows = systemInfo?.platform?.toLowerCase().includes('windows')
  const pathExamples = getPathExamples()

  return (
    <div className="space-y-6">
      {/* 说明信息 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="text-sm text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-2">关于游戏默认安装路径:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>设置后，所有游戏部署时将默认使用此路径</li>
              <li>可以在每次部署时修改具体的安装路径</li>
              <li>建议选择磁盘空间充足的位置</li>
              <li>路径会在设置页面中同步显示，方便后续修改</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 系统信息 */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
        <div className="flex items-center space-x-3 mb-3">
          <HardDrive className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="font-medium text-gray-900 dark:text-white">
            系统信息
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">操作系统:</span>
            <span className="ml-2 text-gray-900 dark:text-white">
              {systemInfo?.platform || '未知'}
            </span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">架构:</span>
            <span className="ml-2 text-gray-900 dark:text-white">
              {systemInfo?.arch || '未知'}
            </span>
          </div>
        </div>
      </div>

      {/* 路径输入 */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            游戏默认安装路径 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={defaultGamePath}
              onChange={(e) => setDefaultGamePath(e.target.value)}
              className={`w-full px-3 py-2 pr-10 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                isPathValid === false 
                  ? 'border-red-300 dark:border-red-600' 
                  : isPathValid === true 
                  ? 'border-green-300 dark:border-green-600' 
                  : 'border-gray-300 dark:border-gray-600'
              }`}
              placeholder={isWindows ? '例如: D:\\Games' : '例如: /home/steam/games'}
              disabled={isSaving}
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              {isPathValid === true && (
                <CheckCircle className="w-4 h-4 text-green-500" />
              )}
              {isPathValid === false && (
                <AlertCircle className="w-4 h-4 text-red-500" />
              )}
            </div>
          </div>
          
          {isPathValid === false && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {isWindows 
                ? '请输入有效的Windows路径格式，如: D:\\Games' 
                : '请输入有效的Unix路径格式，如: /home/steam/games'
              }
            </p>
          )}
          
          {isPathValid === true && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-1">
              路径格式正确
            </p>
          )}
        </div>

        {/* 路径示例 */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            路径示例:
          </h4>
          <div className="space-y-1">
            {pathExamples.map((example, index) => (
              <button
                key={index}
                onClick={() => setDefaultGamePath(example)}
                className="block w-full text-left px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
                disabled={isSaving}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 注意事项 */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
          <div className="text-sm text-yellow-700 dark:text-yellow-300">
            <p className="font-medium mb-2">注意事项:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>确保选择的路径有足够的磁盘空间（建议至少 50GB）</li>
              <li>默认路径为Docker环境，若您是Docker环境不懂请勿修改</li>
              <li>确保当前用户对该路径有读写权限</li>
              {isWindows && <li>Windows 用户建议使用非 C 盘的其他盘符</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving || !defaultGamePath.trim() || !isPathValid}
          className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{isSaving ? '保存中...' : '保存设置'}</span>
        </button>
      </div>
    </div>
  )
}

export default GamePathOnboardingStep
