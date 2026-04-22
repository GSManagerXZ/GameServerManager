import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import net from 'net'
import http from 'http'
import https from 'https'
import { URL } from 'url'

const router = Router()

// 网络检测项配置
type NetworkCheckType = 'auto' | 'tcp' | 'http'

interface NetworkCheckItem {
  id: string
  name: string
  url: string
  status: 'pending' | 'checking' | 'success' | 'failed'
  checkType?: NetworkCheckType
  port?: number
  expectedStatusCode?: number
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
  { id: 'gsm-deploy', name: 'GSManager功能服务', url: 'langlangy2.server.xiaozhuhouses.asia', status: 'pending', checkType: 'tcp', port: 443 },
  { id: 'gsm-mirror', name: '文件边缘下载服务', url: 'https://download.xiaozhuhouses.asia', status: 'pending', checkType: 'http', expectedStatusCode: 200 }
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
function httpPing(
  url: string,
  timeout: number = 10000,
  expectedStatusCode?: number
): Promise<{ success: boolean; responseTime?: number; error?: string }> {
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
        const statusCode = res.statusCode ?? 0
        const isStatusValid = expectedStatusCode !== undefined
          ? statusCode === expectedStatusCode
          : statusCode >= 200 && statusCode < 300

        res.resume() // 消费响应数据
        if (isStatusValid) {
          resolve({ success: true, responseTime })
          return
        }

        const expectedLabel = expectedStatusCode !== undefined
          ? `，期望 ${expectedStatusCode}`
          : '，期望 2xx'
        resolve({ success: false, error: `HTTP状态码异常: ${statusCode}${expectedLabel}` })
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
async function checkUrl(
  url: string,
  timeout: number = 10000,
  expectedStatusCode?: number
): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  try {
    // 如果是完整的HTTP/HTTPS URL，使用HTTP ping
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return await httpPing(url, timeout, expectedStatusCode)
    }

    // 对于域名，先尝试HTTP ping
    const httpResult = await httpPing(url, timeout, expectedStatusCode)
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

function extractHost(target: string): string {
  if (target.startsWith('http://') || target.startsWith('https://')) {
    try {
      return new URL(target).hostname
    } catch {
      return target
    }
  }

  return target.replace(/^(https?:\/\/)/, '').split('/')[0].split(':')[0]
}

async function checkItem(
  item: NetworkCheckItem,
  timeout: number = 10000
): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  if (item.checkType === 'tcp') {
    return tcpPing(extractHost(item.url), item.port ?? 80, timeout)
  }

  if (item.checkType === 'http') {
    return httpPing(item.url, timeout, item.expectedStatusCode)
  }

  return checkUrl(item.url, timeout, item.expectedStatusCode)
}

// 检测所有网络项
router.get('/check-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const results = await Promise.all(
      networkCheckItems.map(async (item) => {
        const result = await checkItem(item, 10000)
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
    const { url, id } = req.body

    if (!url) {
      return res.status(400).json({
        success: false,
        message: '缺少URL参数'
      })
    }

    const matchedItem = typeof id === 'string'
      ? networkCheckItems.find((item) => item.id === id)
      : undefined

    const result = matchedItem
      ? await checkItem(matchedItem, 10000)
      : await checkUrl(url, 10000)

    res.json({
      success: true,
      data: {
        id,
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

