import { Router, Request, Response } from 'express'
import { SystemManager } from '../modules/system/SystemManager.js'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'
import os from 'os'
import fs from 'fs/promises'
import path from 'path'
import { execAsync } from '../utils/execAsync.js'

const router = Router()

// 注意：这里需要在实际使用时注入SystemManager实例
let systemManager: SystemManager

// 设置SystemManager实例的函数
export function setSystemManager(manager: SystemManager) {
  systemManager = manager
}

// 获取系统基本信息
router.get('/info', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const systemInfo = await systemManager.getSystemInfo()
    res.json({
      success: true,
      data: systemInfo
    })
  } catch (error) {
    logger.error('获取系统信息失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取系统信息失败'
    })
  }
})

// 获取系统统计历史
router.get('/stats', (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const minutes = parseInt(req.query.minutes as string) || 60
    const stats = systemManager.getStatsHistory(minutes)
    
    res.json({
      success: true,
      data: {
        stats,
        period: minutes,
        count: stats.length
      }
    })
  } catch (error) {
    logger.error('获取系统统计失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取系统统计失败'
    })
  }
})

// 获取活跃告警
router.get('/alerts', (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const alerts = systemManager.getActiveAlerts()
    res.json({
      success: true,
      data: alerts
    })
  } catch (error) {
    logger.error('获取系统告警失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取告警失败'
    })
  }
})

// 设置告警阈值
router.post('/alerts/thresholds', (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const thresholds = req.body
    
    // 验证阈值格式
    const validKeys = ['cpu', 'memory', 'disk', 'network']
    for (const key of Object.keys(thresholds)) {
      if (!validKeys.includes(key)) {
        return res.status(400).json({
          success: false,
          error: `无效的阈值类型: ${key}`
        })
      }
      
      const threshold = thresholds[key]
      if (!threshold.warning || !threshold.critical || 
          threshold.warning >= threshold.critical ||
          threshold.warning < 0 || threshold.critical > 100) {
        return res.status(400).json({
          success: false,
          error: `无效的阈值配置: ${key}`
        })
      }
    }
    
    systemManager.setAlertThresholds(thresholds)
    
    res.json({
      success: true,
      message: '告警阈值设置成功'
    })
  } catch (error) {
    logger.error('设置告警阈值失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '设置阈值失败'
    })
  }
})

// 获取网络接口信息
router.get('/network', (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const interfaces = systemManager.getNetworkInterfaces()
    res.json({
      success: true,
      data: interfaces
    })
  } catch (error) {
    logger.error('获取网络接口失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取网络接口失败'
    })
  }
})

// 获取磁盘信息
router.get('/disks', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const disks = await systemManager.getDiskList()
    res.json({
      success: true,
      data: disks
    })
  } catch (error) {
    logger.error('获取磁盘信息失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取磁盘信息失败'
    })
  }
})

// 获取进程列表
router.get('/processes', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const processes = await systemManager.getProcessList()
    res.json({
      success: true,
      data: processes
    })
  } catch (error) {
    logger.error('获取进程列表失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取进程列表失败'
    })
  }
})

// 终止进程
router.post('/processes/:pid/kill', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const pid = parseInt(req.params.pid)
    const { force = false } = req.body
    
    if (!pid || pid <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的进程ID'
      })
    }
    
    // 记录操作日志
    logger.info(`用户尝试终止进程 PID: ${pid}, 强制: ${force}`)
    
    const result = await systemManager.killProcess(pid, force)
    
    if (result.success) {
      logger.info(`进程 ${pid} 终止成功`)
      res.json({
        success: true,
        message: result.message
      })
    } else {
      logger.warn(`进程 ${pid} 终止失败: ${result.message}`)
      res.status(400).json({
        success: false,
        error: result.message
      })
    }
  } catch (error) {
    logger.error('终止进程失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '终止进程失败'
    })
  }
})

// 获取CPU信息
router.get('/cpu', (req: Request, res: Response) => {
  try {
    const cpus = os.cpus()
    const cpuInfo = {
      model: cpus[0]?.model || 'Unknown',
      speed: cpus[0]?.speed || 0,
      cores: cpus.length,
      architecture: os.arch(),
      details: cpus.map((cpu, index) => ({
        core: index,
        model: cpu.model,
        speed: cpu.speed,
        times: cpu.times
      }))
    }
    
    res.json({
      success: true,
      data: cpuInfo
    })
  } catch (error) {
    logger.error('获取CPU信息失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取CPU信息失败'
    })
  }
})

// 获取内存信息
router.get('/memory', (req: Request, res: Response) => {
  try {
    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free
    
    const memoryInfo = {
      total,
      free,
      used,
      usage: (used / total) * 100,
      available: free,
      formatted: {
        total: formatBytes(total),
        free: formatBytes(free),
        used: formatBytes(used)
      }
    }
    
    res.json({
      success: true,
      data: memoryInfo
    })
  } catch (error) {
    logger.error('获取内存信息失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取内存信息失败'
    })
  }
})

// 获取系统负载
router.get('/load', (req: Request, res: Response) => {
  try {
    const loadavg = os.loadavg()
    const uptime = os.uptime()
    
    const loadInfo = {
      avg1: loadavg[0],
      avg5: loadavg[1],
      avg15: loadavg[2],
      uptime,
      uptimeFormatted: formatUptime(uptime)
    }
    
    res.json({
      success: true,
      data: loadInfo
    })
  } catch (error) {
    logger.error('获取系统负载失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取系统负载失败'
    })
  }
})

// 获取环境变量
router.get('/env', (req: Request, res: Response) => {
  try {
    // 只返回安全的环境变量
    const safeEnvVars = {
      NODE_ENV: process.env.NODE_ENV,
      NODE_VERSION: process.version,
      PLATFORM: process.platform,
      ARCH: process.arch,
      HOME: process.env.HOME || process.env.USERPROFILE,
      USER: process.env.USER || process.env.USERNAME,
      SHELL: process.env.SHELL,
      PATH: process.env.PATH,
      JAVA_HOME: process.env.JAVA_HOME,
      PORT: process.env.PORT
    }
    
    res.json({
      success: true,
      data: safeEnvVars
    })
  } catch (error) {
    logger.error('获取环境变量失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取环境变量失败'
    })
  }
})

// 获取日志文件列表
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const logDir = path.resolve(process.cwd(), 'logs')
    
    try {
      const files = await fs.readdir(logDir)
      const logFiles = []
      
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(logDir, file)
          const stats = await fs.stat(filePath)
          
          logFiles.push({
            name: file,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            modified: stats.mtime,
            created: stats.birthtime
          })
        }
      }
      
      res.json({
        success: true,
        data: logFiles
      })
    } catch (error) {
      res.json({
        success: true,
        data: [],
        message: '日志目录不存在或为空'
      })
    }
  } catch (error) {
    logger.error('获取日志文件列表失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取日志列表失败'
    })
  }
})

// 获取日志文件内容
router.get('/logs/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params
    const lines = parseInt(req.query.lines as string) || 100
    
    // 安全检查：只允许读取.log文件
    if (!filename.endsWith('.log') || filename.includes('..')) {
      return res.status(400).json({
        success: false,
        error: '无效的文件名'
      })
    }
    
    const logDir = path.resolve(process.cwd(), 'logs')
    const filePath = path.join(logDir, filename)
    
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const logLines = content.split('\n').filter(line => line.trim())
      const recentLines = logLines.slice(-lines)
      
      res.json({
        success: true,
        data: {
          filename,
          lines: recentLines,
          totalLines: logLines.length,
          requestedLines: lines
        }
      })
    } catch (error) {
      res.status(404).json({
        success: false,
        error: '日志文件不存在'
      })
    }
  } catch (error) {
    logger.error('读取日志文件失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '读取日志失败'
    })
  }
})

// 清理日志文件
router.delete('/logs/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params
    
    // 安全检查
    if (!filename.endsWith('.log') || filename.includes('..')) {
      return res.status(400).json({
        success: false,
        error: '无效的文件名'
      })
    }
    
    const logDir = path.resolve(process.cwd(), 'logs')
    const filePath = path.join(logDir, filename)
    
    await fs.unlink(filePath)
    
    res.json({
      success: true,
      message: '日志文件删除成功'
    })
  } catch (error) {
    logger.error('删除日志文件失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '删除日志失败'
    })
  }
})

// 系统重启（仅重启应用）
router.post('/restart', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      message: '应用重启命令已发送'
    })
    
    // 延迟重启以确保响应发送
    setTimeout(() => {
      logger.info('应用重启中...')
      process.exit(0)
    }, 1000)
  } catch (error) {
    logger.error('重启应用失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '重启失败'
    })
  }
})

// 获取系统时间
router.get('/time', (req: Request, res: Response) => {
  try {
    const now = new Date()
    
    res.json({
      success: true,
      data: {
        timestamp: now.getTime(),
        iso: now.toISOString(),
        local: now.toLocaleString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: now.getTimezoneOffset()
      }
    })
  } catch (error) {
    logger.error('获取系统时间失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取时间失败'
    })
  }
})

// 获取活跃端口
router.get('/ports', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const ports = await systemManager.getActivePorts()
    res.json({
      success: true,
      data: ports
    })
  } catch (error) {
    logger.error('获取活跃端口失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取活跃端口失败'
    })
  }
})

// 获取系统用户列表
router.get('/users', authenticateToken, async (req: Request, res: Response) => {
  try {
    const platform = os.platform()
    let users: string[] = []
    
    if (platform === 'linux') {
      try {
        // 在Linux系统中读取/etc/passwd文件获取用户列表
        const passwdContent = await fs.readFile('/etc/passwd', 'utf-8')
        const lines = passwdContent.split('\n').filter(line => line.trim())
        
        users = lines
          .map(line => {
            const parts = line.split(':')
            if (parts.length >= 7) {
              const username = parts[0]
              const uid = parseInt(parts[2])
              const shell = parts[6]
              
              // 过滤系统用户和无效shell的用户
              if (uid >= 1000 || username === 'root') {
                // 检查shell是否有效（不是/bin/false, /usr/sbin/nologin等）
                if (shell && !shell.includes('false') && !shell.includes('nologin')) {
                  return username
                }
              }
            }
            return null
          })
          .filter((user): user is string => user !== null)
          .sort()
        
        // 确保root用户在列表开头
        if (users.includes('root')) {
          users = ['root', ...users.filter(u => u !== 'root')]
        }
      } catch (error) {
        logger.warn('读取/etc/passwd失败，尝试使用getent命令:', error)
        
        try {
          // 备用方案：使用getent命令
          const { stdout } = await execAsync('getent passwd')
          const lines = stdout.split('\n').filter(line => line.trim())
          
          users = lines
            .map(line => {
              const parts = line.split(':')
              if (parts.length >= 7) {
                const username = parts[0]
                const uid = parseInt(parts[2])
                const shell = parts[6]
                
                if (uid >= 1000 || username === 'root') {
                  if (shell && !shell.includes('false') && !shell.includes('nologin')) {
                    return username
                  }
                }
              }
              return null
            })
            .filter((user): user is string => user !== null)
            .sort()
          
          if (users.includes('root')) {
            users = ['root', ...users.filter(u => u !== 'root')]
          }
        } catch (getentError) {
          logger.error('获取用户列表失败:', getentError)
          users = ['root'] // 默认返回root用户
        }
      }
    } else if (platform === 'win32') {
      try {
        // Windows系统使用net user命令获取用户列表
        const { stdout } = await execAsync('net user')
        const lines = stdout.split('\n')
        
        // 查找用户列表部分（通常在"User accounts for"之后）
        let userSection = false
        for (const line of lines) {
          if (line.includes('User accounts for') || line.includes('用户帐户')) {
            userSection = true
            continue
          }
          
          if (userSection && line.includes('---')) {
            continue
          }
          
          if (userSection && line.trim()) {
            // 解析用户名（可能有多列）
            const userNames = line.trim().split(/\s+/).filter(name => 
              name && 
              !name.includes('completed') && 
              !name.includes('successfully') &&
              !name.includes('命令成功完成')
            )
            users.push(...userNames)
          }
          
          if (userSection && (line.includes('completed') || line.includes('命令成功完成'))) {
            break
          }
        }
        
        users = [...new Set(users)].sort() // 去重并排序
      } catch (error) {
        logger.error('获取Windows用户列表失败:', error)
        users = [] // Windows下如果失败就返回空列表
      }
    }
    
    // 如果没有获取到用户，至少返回当前用户
    if (users.length === 0) {
      const currentUser = os.userInfo().username
      users = [currentUser]
    }
    
    res.json({
      success: true,
      data: users
    })
  } catch (error) {
    logger.error('获取系统用户列表失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取系统用户列表失败'
    })
  }
})

// 设置选择的磁盘
router.post('/disk/select', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const { disk } = req.body
    
    if (typeof disk !== 'string') {
      return res.status(400).json({
        success: false,
        error: '磁盘参数必须是字符串'
      })
    }
    
    systemManager.setSelectedDisk(disk)
    
    res.json({
      success: true,
      message: '磁盘选择已更新',
      data: { selectedDisk: disk }
    })
  } catch (error) {
    logger.error('设置选择磁盘失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '设置选择磁盘失败'
    })
  }
})

// 获取当前选择的磁盘
router.get('/disk/selected', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const selectedDisk = systemManager.getSelectedDisk()
    
    res.json({
      success: true,
      data: { selectedDisk }
    })
  } catch (error) {
    logger.error('获取选择磁盘失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取选择磁盘失败'
    })
  }
})

// 获取可用的网络接口列表
router.get('/network/interfaces', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const interfaces = systemManager.getAvailableNetworkInterfaces()
    
    res.json({
      success: true,
      data: interfaces
    })
  } catch (error) {
    logger.error('获取网络接口列表失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取网络接口列表失败'
    })
  }
})

// 设置选择的网络接口
router.post('/network/select', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const { interfaceName } = req.body
    
    if (typeof interfaceName !== 'string') {
      return res.status(400).json({
        success: false,
        error: '网络接口参数必须是字符串'
      })
    }
    
    systemManager.setSelectedNetworkInterface(interfaceName)
    
    res.json({
      success: true,
      message: '网络接口选择已更新',
      data: { selectedInterface: interfaceName }
    })
  } catch (error) {
    logger.error('设置选择网络接口失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '设置选择网络接口失败'
    })
  }
})

// 获取当前选择的网络接口
router.get('/network/selected', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(500).json({ error: '系统管理器未初始化' })
    }
    
    const selectedInterface = systemManager.getSelectedNetworkInterface()
    
    res.json({
      success: true,
      data: { selectedInterface }
    })
  } catch (error) {
    logger.error('获取选择网络接口失败:', error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取选择网络接口失败'
    })
  }
})

// 工具函数：格式化字节数
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 工具函数：格式化运行时间
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  const parts = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分钟`)
  if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`)
  
  return parts.join(' ')
}

// 设置路由的函数
export function setupSystemRoutes(manager: SystemManager) {
  setSystemManager(manager)
  return router
}

export default router