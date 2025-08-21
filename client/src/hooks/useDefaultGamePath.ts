import { useState, useEffect } from 'react'

interface DefaultGamePathData {
  path: string
  isLoading: boolean
  error: string | null
}

/**
 * 获取默认游戏安装路径的Hook
 */
export const useDefaultGamePath = (): DefaultGamePathData => {
  const [path, setPath] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDefaultGamePath()
  }, [])

  const fetchDefaultGamePath = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/settings/game-path', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        }
      })

      if (!response.ok) {
        throw new Error('获取默认游戏路径失败')
      }

      const result = await response.json()

      if (result.success && result.data?.defaultInstallPath) {
        setPath(result.data.defaultInstallPath)
      } else {
        // 如果没有设置默认路径，使用平台默认值
        const isWindows = navigator.platform.toLowerCase().includes('win')
        setPath(isWindows ? 'D:\\Games' : '/home/steam/games')
      }
    } catch (err) {
      console.error('获取默认游戏路径失败:', err)
      setError(err instanceof Error ? err.message : '获取默认游戏路径失败')
      
      // 出错时使用平台默认值
      const isWindows = navigator.platform.toLowerCase().includes('win')
      setPath(isWindows ? 'D:\\Games' : '/home/steam/games')
    } finally {
      setIsLoading(false)
    }
  }

  return {
    path,
    isLoading,
    error
  }
}

/**
 * 生成带游戏名称的完整安装路径
 */
export const useGameInstallPath = (gameName?: string): DefaultGamePathData & { 
  generatePath: (name: string) => string 
} => {
  const { path: defaultPath, isLoading, error } = useDefaultGamePath()

  const generatePath = (name: string) => {
    if (!defaultPath || !name) return defaultPath

    // 清理游戏名称，移除特殊字符
    const cleanName = name.replace(/[<>:"|?*]/g, '').trim()
    
    // 根据平台使用正确的路径分隔符
    const isWindows = navigator.platform.toLowerCase().includes('win')
    const separator = isWindows ? '\\' : '/'
    
    // 确保默认路径以分隔符结尾
    const basePath = defaultPath.endsWith(separator) ? defaultPath : defaultPath + separator
    
    return basePath + cleanName
  }

  // 如果提供了游戏名称，自动生成完整路径
  const fullPath = gameName ? generatePath(gameName) : defaultPath

  return {
    path: fullPath,
    isLoading,
    error,
    generatePath
  }
}
