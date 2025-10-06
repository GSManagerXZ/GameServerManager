import React, { useState, useEffect, useRef } from 'react'
import { useWallpaperStore } from '@/stores/wallpaperStore'

interface WallpaperBackgroundProps {
  isLoginPage?: boolean
}

const WallpaperBackground: React.FC<WallpaperBackgroundProps> = ({ isLoginPage = false }) => {
  const { settings } = useWallpaperStore()
  const [imageLoaded, setImageLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // 确定使用哪个壁纸
  const shouldShow = isLoginPage
    ? (settings.syncWithMain ? settings.enabled : settings.loginEnabled)
    : settings.enabled

  const imageUrl = isLoginPage
    ? (settings.syncWithMain ? settings.imageUrl : settings.loginImageUrl)
    : settings.imageUrl

  const brightness = isLoginPage
    ? (settings.syncWithMain ? settings.brightness : settings.loginBrightness)
    : settings.brightness

  // 当壁纸URL变化时重置加载状态
  useEffect(() => {
    setImageLoaded(false)
    
    // 检查图片是否已经缓存完成
    const checkImageLoaded = () => {
      if (imgRef.current?.complete) {
        setImageLoaded(true)
      }
    }
    
    // 立即检查
    checkImageLoaded()
    
    // 延迟检查（处理某些边缘情况）
    const timer = setTimeout(checkImageLoaded, 100)
    
    // 安全超时：3秒后强制显示图片，避免一直卡加载
    const safetyTimer = setTimeout(() => {
      setImageLoaded(true)
    }, 3000)
    
    return () => {
      clearTimeout(timer)
      clearTimeout(safetyTimer)
    }
  }, [imageUrl])

  // 组件挂载时检查图片是否已缓存
  useEffect(() => {
    if (imgRef.current?.complete) {
      setImageLoaded(true)
    }
  }, [])

  if (!shouldShow || !imageUrl) {
    return null
  }

  return (
    <>
      {/* 背景壁纸 - 使用img标签以支持GIF动画 */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        {/* 加载占位符 */}
        {!imageLoaded && (
          <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
          </div>
        )}
        
        <img
          ref={imgRef}
          src={imageUrl}
          alt="壁纸背景"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            filter: `brightness(${brightness}%)`,
          }}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
        />
        {/* 可选的渐变叠加层，以确保文字可读性 */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/30" />
      </div>
    </>
  )
}

export default WallpaperBackground

