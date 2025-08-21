import React, { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface BrowserCompatibilityCheckerProps {
  children: React.ReactNode
}

// 浏览器信息接口
interface BrowserInfo {
  name: string
  version: number
  isSupported: boolean
  reason?: string
}

const BrowserCompatibilityChecker: React.FC<BrowserCompatibilityCheckerProps> = ({ children }) => {
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null)
  const [showWarning, setShowWarning] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    // 通过UA标识检测浏览器类型和版本
    const detectBrowser = (): BrowserInfo => {
      const userAgent = navigator.userAgent
      let browserName = 'Unknown'
      let version = 0
      let isSupported = true
      let reason = ''

      try {
        // Chrome 检测 (包括基于Chromium的浏览器)
        if (userAgent.indexOf('Chrome') > -1 && userAgent.indexOf('Edge') === -1) {
          browserName = 'Chrome'
          const match = userAgent.match(/Chrome\/(\d+)/)
          if (match) {
            version = parseInt(match[1], 10)
            if (version < 60) {
              isSupported = false
              reason = 'Chrome 版本过低，需要 60 或更高版本'
            }
          }
        }
        // Firefox 检测
        else if (userAgent.indexOf('Firefox') > -1) {
          browserName = 'Firefox'
          const match = userAgent.match(/Firefox\/(\d+)/)
          if (match) {
            version = parseInt(match[1], 10)
            if (version < 55) {
              isSupported = false
              reason = 'Firefox 版本过低，需要 55 或更高版本'
            }
          }
        }
        // Safari 检测
        else if (userAgent.indexOf('Safari') > -1 && userAgent.indexOf('Chrome') === -1) {
          browserName = 'Safari'
          const match = userAgent.match(/Version\/(\d+)/)
          if (match) {
            version = parseInt(match[1], 10)
            if (version < 12) {
              isSupported = false
              reason = 'Safari 版本过低，需要 12 或更高版本'
            }
          }
        }
        // Edge 检测 (新版基于Chromium)
        else if (userAgent.indexOf('Edg') > -1) {
          browserName = 'Edge'
          const match = userAgent.match(/Edg\/(\d+)/)
          if (match) {
            version = parseInt(match[1], 10)
            if (version < 79) {
              isSupported = false
              reason = 'Edge 版本过低，需要 79 或更高版本'
            }
          }
        }
        // 旧版 Edge 检测
        else if (userAgent.indexOf('Edge') > -1) {
          browserName = 'Edge Legacy'
          const match = userAgent.match(/Edge\/(\d+)/)
          if (match) {
            version = parseInt(match[1], 10)
            isSupported = false
            reason = '不支持旧版 Edge，请升级到基于 Chromium 的新版 Edge'
          }
        }
        // IE 检测
        else if (userAgent.indexOf('MSIE') > -1 || userAgent.indexOf('Trident') > -1) {
          browserName = 'Internet Explorer'
          if (userAgent.indexOf('MSIE') > -1) {
            const match = userAgent.match(/MSIE (\d+)/)
            if (match) {
              version = parseInt(match[1], 10)
            }
          } else {
            // IE 11 使用 Trident
            const match = userAgent.match(/rv:(\d+)/)
            if (match) {
              version = parseInt(match[1], 10)
            }
          }
          isSupported = false
          reason = '不支持 Internet Explorer，请使用现代浏览器'
        }
        // 其他浏览器
        else {
          browserName = 'Unknown'
          isSupported = false
          reason = '未知浏览器，建议使用 Chrome、Firefox、Safari 或 Edge'
        }

        // 额外的API检测（作为兜底检查）
        if (isSupported) {
          const requiredAPIs = ['fetch', 'Promise', 'localStorage', 'sessionStorage', 'JSON', 'WebSocket']
          const missingAPIs = requiredAPIs.filter(api => typeof (window as any)[api] === 'undefined')

          if (missingAPIs.length > 0) {
            isSupported = false
            reason = `缺少必要的 Web API: ${missingAPIs.join(', ')}`
          }
        }

      } catch (error) {
        // 如果检测过程出错，标记为不支持
        isSupported = false
        reason = '浏览器检测失败，可能不支持现代 Web 标准'
      }

      return {
        name: browserName,
        version: version,
        isSupported: isSupported,
        reason: reason
      }
    }

    const browser = detectBrowser()
    setBrowserInfo(browser)

    // 如果不兼容，显示警告（延迟一点时间以确保页面加载完成）
    if (!browser.isSupported) {
      setTimeout(() => {
        setShowWarning(true)
        setIsAnimating(true)
      }, 500)
    }
  }, [])

  const handleCloseWarning = () => {
    setIsAnimating(false)
    setTimeout(() => {
      setShowWarning(false)
    }, 300)
  }

  const getBrowserRecommendations = () => {
    if (!browserInfo) {
      return '推荐使用 Chrome、Firefox、Safari 或 Edge 的最新版本'
    }

    if (browserInfo.reason) {
      return browserInfo.reason
    }

    return '推荐使用 Chrome、Firefox、Safari 或 Edge 的最新版本'
  }

  const getDownloadLinks = () => {
    return [
      { name: 'Chrome', url: 'https://www.google.com/chrome/' },
      { name: 'Firefox', url: 'https://www.mozilla.org/firefox/' },
      { name: 'Edge', url: 'https://www.microsoft.com/edge' },
      { name: 'Safari', url: 'https://www.apple.com/safari/' }
    ]
  }

  // 为古老浏览器提供内联样式
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px'
  }

  const modalStyle: React.CSSProperties = {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    border: '1px solid #e5e7eb',
    maxWidth: '448px',
    width: '100%',
    margin: '0 16px',
    transform: isAnimating ? 'scale(1)' : 'scale(0.95)',
    opacity: isAnimating ? 1 : 0,
    transition: 'all 0.3s ease-in-out'
  }

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '24px',
    borderBottom: '1px solid #e5e7eb'
  }

  const iconContainerStyle: React.CSSProperties = {
    width: '40px',
    height: '40px',
    backgroundColor: '#fef3c7',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  }

  const contentStyle: React.CSSProperties = {
    padding: '24px'
  }

  const warningBoxStyle: React.CSSProperties = {
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    padding: '12px',
    marginTop: '12px'
  }

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '24px',
    borderTop: '1px solid #e5e7eb'
  }

  const primaryButtonStyle: React.CSSProperties = {
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#ffffff',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  }

  const secondaryButtonStyle: React.CSSProperties = {
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  }

  const linkStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '8px 12px',
    fontSize: '14px',
    color: '#1d4ed8',
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    textDecoration: 'none',
    margin: '4px',
    textAlign: 'center',
    minWidth: '80px'
  }

  return (
    <>
      {children}

      {/* 兼容性警告弹窗 - 使用内联样式确保古老浏览器兼容性 */}
      {showWarning && (
        <div style={overlayStyle} onClick={handleCloseWarning}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div style={headerStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconContainerStyle}>
                  <AlertTriangle style={{ width: '20px', height: '20px', color: '#d97706' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                    浏览器兼容性警告
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#6b7280' }}>
                    检测到兼容性问题
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseWarning}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '50%',
                  fontSize: '16px'
                }}
              >
                ✕
              </button>
            </div>

            {/* 内容 */}
            <div style={contentStyle}>
              <p style={{ margin: '0 0 16px 0', color: '#374151', lineHeight: '1.5' }}>
                检测到您的浏览器是 <strong>{browserInfo?.name} {browserInfo?.version}</strong>，
                可能不支持现代 Web 标准，这将导致以下功能无法正常使用：
              </p>

              <ul style={{ margin: '0 0 16px 20px', color: '#6b7280', fontSize: '14px' }}>
                <li>实时终端连接</li>
                <li>实时日志查看</li>
                <li>服务器状态监控</li>
                <li>即时通知推送</li>
              </ul>

              <div style={warningBoxStyle}>
                <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                  建议解决方案：
                </p>
                <p style={{ margin: 0, fontSize: '14px', color: '#a16207' }}>
                  {getBrowserRecommendations()}
                </p>
              </div>

              {/* 浏览器下载链接 */}
              <div style={{ marginTop: '16px' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '500', color: '#374151' }}>
                  推荐浏览器下载：
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {getDownloadLinks().map((browser) => (
                    <a
                      key={browser.name}
                      href={browser.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={linkStyle}
                    >
                      {browser.name}
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <div style={buttonContainerStyle}>
              <button onClick={handleCloseWarning} style={secondaryButtonStyle}>
                我知道了
              </button>
              <button
                onClick={() => window.location.reload()}
                style={primaryButtonStyle}
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default BrowserCompatibilityChecker