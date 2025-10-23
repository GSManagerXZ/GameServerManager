import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import net from 'net'
import http from 'http'
import https from 'https'
import { URL } from 'url'

const router = Router()

// 网络检测项配置
interface NetworkCheckItem {
  id: string
  name: string
  url: string
  status: 'pending' | 'checking' | 'success' | 'failed'
  responseTime?: number
  errorMessage?: string
}

const networkCheckItems: NetworkCheckItem[] = [
  // 互联网
  { id: 'baidu', name: '互联网连接状态', url: 'www.baidu.com', status: 'pending' },
  // Steam网络
  { id: 'steamworks-api', name: 'Steamworks API(全球)', url: 'api.steampowered.com', status: 'pending' },
  { id: 'steamworks-partner', name: 'Steamworks API（合作/私有）', url: 'partner.steam-api.com', status: 'pending' },
  // Modrinth
  { id: 'modrinth-api', name: 'Modrinth API', url: 'api.modrinth.com', status: 'pending' },
  { id: 'modrinth-cdn', name: 'Modrinth CDN', url: 'cdn.modrinth.com', status: 'pending' },
  // Minecraft
  { id: 'mojang-session', name: 'Mojang 会话服务器', url: 'sessionserver.mojang.com', status: 'pending' },
  { id: 'msl-api', name: 'MSL API', url: 'https://api.mslmc.cn/v3', status: 'pending' },
  // GSManager
  { id: 'gsm-deploy', name: 'GSManager在线部署服务', url: 'http://gsm.server.xiaozhuhouses.asia:10002/', status: 'pending' },
  { id: 'gsm-mirror', name: 'GSManager镜像服务器', url: 'http://download.server.xiaozhuhouses.asia:8082/', status: 'pending' },
  { id: 'gsm-cloud-build', name: 'GSManager 云构建服务', url: 'http://api.mc.xiaozhuhouses.asia:10003', status: 'pending' },
  { id: 'gsm-cloud-cache', name: 'GSManager 云构建缓存节点', url: 'https://download.mc.xiaozhuhouses.asia:4433', status: 'pending' }
]

// TCP Ping 函数
function tcpPing(host: string, port: number, timeout: number = 10000): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const socket = new net.Socket()

    const timeoutId = setTimeout(() => {
      socket.destroy()
      resolve({ success: false, error: `连接超时 (${timeout}ms)` })
    }, timeout)

    socket.setTimeout(timeout)

    socket.connect(port, host, () => {
      const responseTime = Date.now() - startTime
      clearTimeout(timeoutId)
      socket.destroy()
      resolve({ success: true, responseTime })
    })

    socket.on('error', (err) => {
      clearTimeout(timeoutId)
      socket.destroy()
      resolve({ success: false, error: err.message })
    })

    socket.on('timeout', () => {
      clearTimeout(timeoutId)
      socket.destroy()
      resolve({ success: false, error: `连接超时 (${timeout}ms)` })
    })
  })
}

// HTTP/HTTPS Ping 函数
function httpPing(url: string, timeout: number = 10000): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    
    try {
      let parsedUrl: URL
      // 如果URL不包含协议，尝试添加https://
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        try {
          // 先尝试HTTPS
          parsedUrl = new URL(`https://${url}`)
        } catch {
          parsedUrl = new URL(`http://${url}`)
        }
      } else {
        parsedUrl = new URL(url)
      }

      const protocol = parsedUrl.protocol === 'https:' ? https : http

      const req = protocol.get(parsedUrl.toString(), {
        timeout,
        headers: {
          'User-Agent': 'GSManager-NetworkCheck/1.0'
        }
      }, (res) => {
        const responseTime = Date.now() - startTime
        res.resume() // 消费响应数据
        resolve({ success: true, responseTime })
      })

      req.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ success: false, error: `连接超时 (${timeout}ms)` })
      })

    } catch (error: any) {
      resolve({ success: false, error: error.message })
    }
  })
}

// 解析URL并检测
async function checkUrl(url: string, timeout: number = 10000): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  try {
    // 如果是完整的HTTP/HTTPS URL，使用HTTP ping
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return await httpPing(url, timeout)
    }

    // 对于域名，先尝试HTTP ping
    const httpResult = await httpPing(url, timeout)
    if (httpResult.success) {
      return httpResult
    }

    // HTTP失败，尝试TCP ping到80端口
    const hostname = url.replace(/^(https?:\/\/)/, '')
    return await tcpPing(hostname, 80, timeout)
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// 检测所有网络项
router.get('/check-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const results = await Promise.all(
      networkCheckItems.map(async (item) => {
        const result = await checkUrl(item.url, 10000)
        return {
          id: item.id,
          name: item.name,
          url: item.url,
          status: result.success ? 'success' : 'failed',
          responseTime: result.responseTime,
          error: result.error
        }
      })
    )

    res.json({
      success: true,
      data: {
        results,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('网络检测失败:', error)
    res.status(500).json({
      success: false,
      message: '网络检测失败',
      error: error.message
    })
  }
})

// 检测单个网络项
router.post('/check-single', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { url } = req.body

    if (!url) {
      return res.status(400).json({
        success: false,
        message: '缺少URL参数'
      })
    }

    const result = await checkUrl(url, 10000)

    res.json({
      success: true,
      data: {
        url,
        status: result.success ? 'success' : 'failed',
        responseTime: result.responseTime,
        error: result.error,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('单项网络检测失败:', error)
    res.status(500).json({
      success: false,
      message: '网络检测失败',
      error: error.message
    })
  }
})

export default router

