import express from 'express'
import { createServer } from 'http'
import type { Socket } from 'net'
import { Server as SocketIOServer } from 'socket.io'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import winston from 'winston'
import { promises as fs } from 'fs'

import { TerminalManager } from './modules/terminal/TerminalManager.js'
import { GameManager } from './modules/game/GameManager.js'
import { SystemManager } from './modules/system/SystemManager.js'
import { ConfigManager } from './modules/config/ConfigManager.js'
import { AuthManager } from './modules/auth/AuthManager.js'
import { InstanceManager } from './modules/instance/InstanceManager.js'
import { SteamCMDManager } from './modules/steamcmd/SteamCMDManager.js'
import { SchedulerManager } from './modules/scheduler/SchedulerManager.js'
import { PluginManager } from './modules/plugin/PluginManager.js'
import { FileWatchManager } from './modules/file/FileWatchManager.js'
import { setupTerminalRoutes } from './routes/terminal.js'
import { setupGameRoutes } from './routes/games.js'
import { setupSystemRoutes } from './routes/system.js'
import { setupAuthRoutes } from './routes/auth.js'
import { setupScheduledTaskRoutes } from './routes/scheduledTasks.js'
import { setupConfigRoutes } from './routes/config.js'
import { setupSettingsRoutes } from './routes/settings.js'
import { setAuthManager } from './middleware/auth.js'
import filesRouter from './routes/files.js'
import { setupInstanceRoutes } from './routes/instances.js'
import steamcmdRouter, { setSteamCMDManager } from './routes/steamcmd.js'
import gameDeploymentRouter, { setGameDeploymentManagers } from './routes/gameDeployment.js'
import { minecraftRouter, setMinecraftDependencies } from './routes/minecraft.js'
import moreGamesRouter from './routes/moreGames.js'
import weatherRouter from './routes/weather.js'
import pluginsRouter, { setPluginManager } from './routes/plugins.js'
import backupRoutes from './routes/backup.js'
import pluginApiRouter, { setPluginApiDependencies } from './routes/pluginApi.js'
import sponsorRouter, { setSponsorDependencies } from './routes/sponsor.js'
import onlineDeployRouter from './routes/onlineDeploy.js'
import gameConfigRouter from './routes/gameconfig.js'
import rconRouter from './routes/rcon.js'
import environmentRouter, { setEnvironmentSocketIO, setEnvironmentConfigManager } from './routes/environment.js'
import { setupDeveloperRoutes } from './routes/developer.js'
import wallpaperRouter from './routes/wallpaper.js'
import networkRouter from './routes/network.js'
import cloudBuildRouter from './routes/cloudBuild.js'
import { consoleLogBuffer } from './utils/logger.js'
import { zipToolsManager } from './utils/zipToolsManager.js'
import { ptyManager } from './utils/ptyManager.js'

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 加载环境变量
// 首先尝试加载根目录的.env文件，然后加载server目录的.env文件
dotenv.config({ path: path.join(__dirname, '../../.env') })
dotenv.config()

// 配置日志
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'gsm3-server' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
})

// 创建Express应用
const app = express()
const server = createServer(app)
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || '*', // 从环境变量读取CORS配置
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})

// 追踪所有活动的socket连接
const sockets = new Set<Socket>()
server.on('connection', socket => {
  sockets.add(socket)
  socket.on('close', () => {
    sockets.delete(socket)
  })
})

// 中间件配置
app.use(helmet({
  contentSecurityPolicy: false, // 开发环境下禁用CSP
  crossOriginOpenerPolicy: false // 禁用Cross-Origin-Opener-Policy
}))

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // 从环境变量读取CORS配置
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 静态文件服务
app.use('/static', express.static(path.join(__dirname, '../public')))
app.use(express.static(path.join(__dirname, '../public')))

// 管理器变量声明
let configManager: ConfigManager
let authManager: AuthManager
let terminalManager: TerminalManager
let gameManager: GameManager
let systemManager: SystemManager
let instanceManager: InstanceManager
let steamcmdManager: SteamCMDManager
let schedulerManager: SchedulerManager
let pluginManager: PluginManager
let fileWatchManager: FileWatchManager

// 健康检查端点
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

// 根路径
app.get('/', (req, res) => {
  res.json({
    name: 'GSM3 Server',
    version: '1.0.0',
    description: '游戏面板后端服务',
    endpoints: {
      health: '/api/health',
      terminal: '/api/terminal',
      game: '/api/game',
      system: '/api/system'
    }
  })
})

// Socket.IO 连接处理将在startServer函数中设置

// 全局错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('未处理的错误:', err)
  res.status(500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : '请稍后重试'
  })
})

// 404处理将在startServer函数中设置

// 优雅关闭处理
let shuttingDown = false
function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    logger.warn('已在关闭中，忽略重复信号。')
    return
  }
  shuttingDown = true

  logger.info(`收到${signal}信号，开始优雅关闭...`)

  // 1. 立即清理所有管理器，特别是会创建子进程的TerminalManager
  logger.info('开始清理管理器...')
  try {
    if (terminalManager) {
      terminalManager.cleanup()
      logger.info('TerminalManager 已清理')
    }
    if (gameManager) {
      gameManager.cleanup()
      logger.info('GameManager 已清理')
    }
    if (systemManager) {
      systemManager.cleanup()
      logger.info('SystemManager 已清理')
    }
    if (fileWatchManager) {
      fileWatchManager.cleanup()
      logger.info('FileWatchManager 已清理')
    }
    if (instanceManager) {
      instanceManager.cleanup()
      logger.info('InstanceManager 已清理')
    }
    if (steamcmdManager) {
      // SteamCMDManager 通常不需要特殊清理，但为了一致性保留
      logger.info('SteamCMDManager 已清理')
    }
    if (schedulerManager) {
      schedulerManager.destroy()
      logger.info('SchedulerManager 已清理')
    }
    if (pluginManager) {
      pluginManager.cleanup()
      logger.info('PluginManager 已清理')
    }
    logger.info('管理器清理完成。')
  } catch (cleanupErr) {
    logger.error('清理管理器时出错:', cleanupErr)
  }

  // 2. 关闭服务器
  logger.info('开始关闭服务器...')
  // 强制销毁所有活动的socket
  logger.info(`正在销毁 ${sockets.size} 个活动的socket...`)
  for (const socket of sockets) {
    socket.destroy()
  }

  server.close(err => {
    if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
      logger.error('关闭HTTP服务器时出错:', err)
    } else {
      logger.info('HTTP服务器已关闭。')
    }
    // 无论HTTP服务器关闭是否出错，都准备退出
    logger.info('优雅关闭完成，服务器退出。')
    process.exit(0)
  })

  io.close(() => {
    logger.info('Socket.IO 服务器已关闭')
  })

  // 3. 设置超时强制退出
  setTimeout(() => {
    logger.error('优雅关闭超时，强制退出！')
    process.exit(1)
  }, 5000) // 5秒超时
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason)
  process.exit(1)
})

// 艺术字输出函数
function printAsciiArt() {
  const terminalWidth = process.stdout.columns || 120

  const mainArtLines = [
    '______   _____    __  ___                                               ',
    '   / ____/  / ___/   /  |/  /  ____ _   ____   ____ _   ____ _  ___    _____ ',
    '  / / __    \\__ \\   / /|_/ /  / __ `/  / __ \\ / __ `/  / __ `/ / _ \\  / ___/ ',
    ' / /_/ /   ___/ /  / /  / /  / /_/ /  / / / // /_/ /  / /_/ / /  __/ / /    ',
    ' \\____/   /____/  /_/  /_/   \\__,_/  /_/ /_/ \\__,_/   \\__, /  \\___/ /_/     ',
    '                                                     /____/                 ',
    '                                                                            '
  ]

  const subtitle = '🎮 游戏服务器管理面板 v3.0 🎮'
  const startupText = '正在启动服务器...'

  // 居中显示主艺术字
  console.log('')
  mainArtLines.forEach(line => {
    const padding = Math.max(0, Math.floor((terminalWidth - line.length) / 2))
    console.log(' '.repeat(padding) + line)
  })

  console.log('')

  // 居中显示副标题
  const subtitlePadding = Math.max(0, Math.floor((terminalWidth - subtitle.length) / 2))
  console.log(' '.repeat(subtitlePadding) + subtitle)

  // 获取并居中显示平台艺术字
  const platformArt = getPlatformArt()
  const platformLines = platformArt.split('\n').filter(line => line.trim())
  platformLines.forEach(line => {
    const cleanLine = line.trim()
    if (cleanLine) {
      const padding = Math.max(0, Math.floor((terminalWidth - cleanLine.length) / 2))
      console.log(' '.repeat(padding) + cleanLine)
    }
  })

  console.log('')

  // 居中显示启动文本
  const startupPadding = Math.max(0, Math.floor((terminalWidth - startupText.length) / 2))
  console.log(' '.repeat(startupPadding) + startupText)

  console.log('')
}

// 显示连接信息
function displayConnectionInfo(host: string, port: number) {
  const terminalWidth = process.stdout.columns || 80

  console.log('')
  console.log('='.repeat(terminalWidth))
  console.log('')

  const title = '🚀 GSM面板启动完成！'
  const titlePadding = Math.max(0, Math.floor((terminalWidth - title.length) / 2))
  console.log(' '.repeat(titlePadding) + title)

  console.log('')

  // 显示本地访问地址
  const localUrl = `http://localhost:${port}`
  const localText = `📍 本地访问: ${localUrl}`
  const localPadding = Math.max(0, Math.floor((terminalWidth - localText.length) / 2))
  console.log(' '.repeat(localPadding) + localText)

  // 获取所有网络接口的IP地址
  const networkInterfaces = os.networkInterfaces()
  const networkIPs: string[] = []

  for (const [interfaceName, interfaces] of Object.entries(networkInterfaces)) {
    if (interfaces) {
      for (const iface of interfaces) {
        // 只显示IPv4地址，排除内部地址(127.x.x.x)和链路本地地址
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
          networkIPs.push(iface.address)
        }
      }
    }
  }

  // 显示网络访问地址
  if (networkIPs.length > 0) {
    // 如果有多个网卡IP，显示所有的
    networkIPs.forEach((ip, index) => {
      const networkUrl = `http://${ip}:${port}`
      const networkText = index === 0 ? `🌐 网络访问: ${networkUrl}` : `           ${networkUrl}`
      const networkPadding = Math.max(0, Math.floor((terminalWidth - networkText.length) / 2))
      console.log(' '.repeat(networkPadding) + networkText)
    })
  } else {
    // 如果没有找到网卡IP，使用原来的逻辑
    const networkUrl = host === '0.0.0.0' ? `http://127.0.0.1:${port}` : `http://${host}:${port}`
    const networkText = `🌐 网络访问: ${networkUrl}`
    const networkPadding = Math.max(0, Math.floor((terminalWidth - networkText.length) / 2))
    console.log(' '.repeat(networkPadding) + networkText)
  }

  console.log('')

  const tipText = '💡 请在浏览器中打开上述地址访问管理面板'
  const tipPadding = Math.max(0, Math.floor((terminalWidth - tipText.length) / 2))
  console.log(' '.repeat(tipPadding) + tipText)

  console.log('')
  console.log('='.repeat(terminalWidth))
  console.log('')
}

// 获取平台艺术字
function getPlatformArt(): string {
  const platform = process.platform

  switch (platform) {
    case 'win32':
      return `
██╗    ██╗██╗███╗   ██╗██████╗  ██████╗ ██╗    ██╗███████╗
██║    ██║██║████╗  ██║██╔══██╗██╔═══██╗██║    ██║██╔════╝
██║ █╗ ██║██║██╔██╗ ██║██║  ██║██║   ██║██║ █╗ ██║███████╗
██║███╗██║██║██║╚██╗██║██║  ██║██║   ██║██║███╗██║╚════██║
╚███╔███╔╝██║██║ ╚████║██████╔╝╚██████╔╝╚███╔███╔╝███████║
 ╚══╝╚══╝ ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝  ╚══╝╚══╝ ╚══════╝`

    case 'linux':
      return `
██╗     ██╗███╗   ██╗██╗   ██╗██╗  ██╗
██║     ██║████╗  ██║██║   ██║╚██╗██╔╝
██║     ██║██╔██╗ ██║██║   ██║ ╚███╔╝ 
██║     ██║██║╚██╗██║██║   ██║ ██╔██╗ 
███████╗██║██║ ╚████║╚██████╔╝██╔╝ ██╗
╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝`

    case 'darwin':
      return `
███╗   ███╗ █████╗  ██████╗ ██████╗ ███████╗
████╗ ████║██╔══██╗██╔════╝██╔═══██╗██╔════╝
██╔████╔██║███████║██║     ██║   ██║███████╗
██║╚██╔╝██║██╔══██║██║     ██║   ██║╚════██║
██║ ╚═╝ ██║██║  ██║╚██████╗╚██████╔╝███████║
╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝`

    default:
      return `
██╗   ██╗███╗   ██╗██╗██╗  ██╗
██║   ██║████╗  ██║██║╚██╗██╔╝
██║   ██║██╔██╗ ██║██║ ╚███╔╝ 
██║   ██║██║╚██╗██║██║ ██╔██╗ 
╚██████╔╝██║ ╚████║██║██╔╝ ██╗
 ╚═════╝ ╚═╝  ╚═══╝╚═╝╚═╝  ╚═╝`
  }
}

// 检查CORS配置安全性
function checkCORSConfiguration() {
  const corsOrigin = process.env.CORS_ORIGIN || '*'
  const socketCorsOrigin = process.env.SOCKET_CORS_ORIGIN || '*'

  if (corsOrigin === '*' || socketCorsOrigin === '*') {
    console.log('\n' + '='.repeat(80))
    console.log('🚨 CORS安全风险警告 🚨')
    console.log('='.repeat(80))

    if (corsOrigin === '*') {
      console.log('⚠️  检测到 CORS_ORIGIN 配置为通配符 "*"')
      console.log('   这将允许任何域名访问您的API，存在跨域安全风险！')
    }

    if (socketCorsOrigin === '*') {
      console.log('⚠️  检测到 SOCKET_CORS_ORIGIN 配置为通配符 "*"')
      console.log('   这将允许任何域名连接您的WebSocket，存在安全风险！')
    }

    console.log('\n🔧 若在公网中使用强烈建议修改配置：')
    console.log('   1. 在 .env 文件中将 CORS_ORIGIN 设置为具体的前端地址')
    console.log('   2. 在 .env 文件中将 SOCKET_CORS_ORIGIN 设置为具体的前端地址')
    console.log('   例如: CORS_ORIGIN=http://域名:端口')
    console.log('   例如: SOCKET_CORS_ORIGIN=http://域名:端口')
    console.log('\n💡 生产环境请务必使用具体的域名替换通配符！')
    console.log('='.repeat(80) + '\n')
  } else {
    console.log('✅ CORS配置安全检查通过')
  }
}

// 检测并生成.env文件
async function ensureEnvFile() {
  const envPath = path.join(process.cwd(), '.env')

  try {
    await fs.access(envPath)
    logger.info('.env 文件已存在')
  } catch {
    logger.info('.env 文件不存在，正在创建...')

    const envContent = `# GSM3 游戏服务器管理系统配置

# 服务器端口配置
# 后端API服务端口
SERVER_PORT=3001

# 前端开发服务端口（仅开发环境使用）
CLIENT_PORT=5173

# 环境配置
NODE_ENV=development

# 日志配置
LOG_LEVEL=info

# CORS配置
# 前端访问地址（开发环境）
CLIENT_URL=http://localhost:5173
# 允许的前端访问地址，生产环境请修改为实际域名
CORS_ORIGIN=*

# Socket.IO配置
SOCKET_CORS_ORIGIN=*

# 数据目录
DATA_DIR=./data

# 日志目录
LOG_DIR=./logs

# PTY配置
PTY_TIMEOUT=1800000
PTY_MAX_SESSIONS=0

# 游戏服务器配置
GAME_MAX_INSTANCES=0
GAME_DATA_DIR=./data/games

# 系统监控配置
SYSTEM_MONITOR_INTERVAL=3000
SYSTEM_STATS_HISTORY_SIZE=1200

# 告警配置
ALERT_CPU_WARNING=70
ALERT_CPU_CRITICAL=90
ALERT_MEMORY_WARNING=80
ALERT_MEMORY_CRITICAL=95
ALERT_DISK_WARNING=85
ALERT_DISK_CRITICAL=95

# Java配置（用于Minecraft服务器）
JAVA_HOME=
JAVA_OPTS=-Xmx2G -Xms1G

# 备份配置
BACKUP_ENABLED=true
BACKUP_INTERVAL=86400000
BACKUP_RETENTION=7

# 网络配置
REQUEST_TIMEOUT=0

# 说明：
# 1. 修改 SERVER_PORT 可以更改后端服务端口
# 2. 生产环境部署时，请将 CORS_ORIGIN 和 SOCKET_CORS_ORIGIN 设置为实际的前端访问地址
# 3. 请务必修改 SESSION_SECRET 和 JWT_SECRET 为随机字符串
# 4. 根据服务器配置调整 JAVA_OPTS 中的内存设置
`

    await fs.writeFile(envPath, envContent, 'utf8')
    logger.info(`.env 文件已创建: ${envPath}`)

    // 重新加载环境变量
    dotenv.config({ path: envPath })
  }
}

// 启动服务器
async function startServer() {
  try {
    // 检测并生成.env文件
    await ensureEnvFile()

    // 输出艺术字
    printAsciiArt()

    // 确保uploads目录存在
    const uploadsDir = path.join(process.cwd(), 'uploads')
    try {
      await fs.access(uploadsDir)
    } catch {
      await fs.mkdir(uploadsDir, { recursive: true })
      logger.info(`创建uploads目录: ${uploadsDir}`)
    }

    // 删除之前的终端会话文件
    const terminalSessionsPath = path.join(process.cwd(), 'data', 'terminal-sessions.json')
    try {
      await fs.unlink(terminalSessionsPath)
      logger.info('已删除之前的终端会话文件')
    } catch (error: any) {
      // 文件不存在时忽略错误
      if (error.code !== 'ENOENT') {
        logger.warn('删除终端会话文件时出错:', error.message)
      }
    }

    // 初始化管理器
    configManager = new ConfigManager(logger)
    authManager = new AuthManager(configManager, logger)
    terminalManager = new TerminalManager(io, logger, configManager)
    gameManager = new GameManager(io, logger)
    systemManager = new SystemManager(io, logger)
    instanceManager = new InstanceManager(terminalManager, logger)
    steamcmdManager = new SteamCMDManager(logger, configManager)
    pluginManager = new PluginManager(logger)
    fileWatchManager = new FileWatchManager(logger)

    // 确保data目录存在
    const dataDir = path.join(process.cwd(), 'data')
    try {
      await fs.access(dataDir)
    } catch {
      await fs.mkdir(dataDir, { recursive: true })
      logger.info(`创建data目录: ${dataDir}`)
    }

    schedulerManager = new SchedulerManager(dataDir, logger)

    // 初始化配置和认证
    await configManager.initialize()
    await authManager.initialize()
    await terminalManager.initialize()
    await instanceManager.initialize()
    await pluginManager.loadPlugins()
    setAuthManager(authManager)
    setPluginManager(pluginManager)

    // 设置 TerminalManager 的 Socket.IO 实例
    terminalManager.setSocketIO(io)

    // 设置 FileWatchManager 的 Socket.IO 实例
    fileWatchManager.setSocketIO(io)

    // 设置 consoleLogBuffer 的 Socket.IO 实例（用于实时日志广播）
    consoleLogBuffer.setSocketIO(io)

    // 设置schedulerManager与gameManager、instanceManager和terminalManager的关联
    schedulerManager.setGameManager(gameManager)
    schedulerManager.setInstanceManager(instanceManager)
    schedulerManager.setTerminalManager(terminalManager)

    // 检测并下载 Zip-Tools
    try {
      await zipToolsManager.ensureInstalled()
      logger.info('Zip-Tools 已就绪')
    } catch (error: any) {
      logger.warn('Zip-Tools 下载失败，ZIP 相关功能可能不可用:', error.message || error)
      // 不阻塞启动
    }

    // 检测并下载 PTY
    try {
      await ptyManager.ensureInstalled()
      logger.info('PTY 已就绪')
    } catch (error: any) {
      logger.warn('PTY 下载失败，终端功能可能不可用:', error.message || error)
      // 不阻塞启动
    }

    // 设置路由
    app.use('/api/auth', setupAuthRoutes(authManager))
    app.use('/api/terminal', setupTerminalRoutes(terminalManager))
    app.use('/api/games', setupGameRoutes(gameManager))
    app.use('/api/system', setupSystemRoutes(systemManager))
    app.use('/api/files', filesRouter)
    app.use('/api/instances', setupInstanceRoutes(instanceManager))
    app.use('/api/scheduled-tasks', setupScheduledTaskRoutes(schedulerManager))
    app.use('/api/config', setupConfigRoutes(configManager))
    app.use('/api/settings', setupSettingsRoutes(configManager))
    app.use('/api/backup', backupRoutes)

    // 设置SteamCMD管理器和路由
    setSteamCMDManager(steamcmdManager, logger)
    app.use('/api/steamcmd', steamcmdRouter)

    // 设置游戏部署路由
    setGameDeploymentManagers(terminalManager, instanceManager, steamcmdManager, configManager)
    app.use('/api/game-deployment', gameDeploymentRouter)

    // 设置Minecraft路由
    setMinecraftDependencies(io, instanceManager)
    app.use('/api/minecraft', minecraftRouter)

    // 设置更多游戏部署路由
    const { setMoreGamesDependencies } = await import('./routes/moreGames.js')
    setMoreGamesDependencies(io)
    app.use('/api/more-games', moreGamesRouter)

    // 设置天气路由
    app.use('/api/weather', weatherRouter)

    // 设置插件路由
    app.use('/api/plugins', pluginsRouter)

    // 设置插件API桥接路由
    setPluginApiDependencies(instanceManager, systemManager, terminalManager, gameManager)
    app.use('/api/plugin-api', pluginApiRouter)

    // 设置赞助者路由
    setSponsorDependencies(configManager)
    app.use('/api/sponsor', sponsorRouter)

    // 设置在线部署路由
    const { setOnlineDeployDependencies } = await import('./routes/onlineDeploy.js')
    setOnlineDeployDependencies(io, configManager)
    app.use('/api/online-deploy', onlineDeployRouter)

    // 设置游戏配置路由
    const { setInstanceManager: setGameConfigInstanceManager } = await import('./routes/gameconfig.js')
    setGameConfigInstanceManager(instanceManager)
    app.use('/api/gameconfig', gameConfigRouter)

    // 设置RCON路由
    app.use('/api/rcon', rconRouter)

    // 设置环境管理路由
    setEnvironmentSocketIO(io)
    setEnvironmentConfigManager(configManager)
    app.use('/api/environment', environmentRouter)

      // 导出 fileWatchManager 给文件路由使用
      ; (global as any).fileWatchManager = fileWatchManager

    // 设置开发者路由
    app.use('/api/developer', setupDeveloperRoutes(configManager))

    // 壁纸路由
    app.use('/api/wallpaper', wallpaperRouter)

    // 网络检测路由
    app.use('/api/network', networkRouter)

    // 云构建部署路由
    app.use('/api', cloudBuildRouter)

    // 设置安全配置路由
    const { setSecurityConfigManager } = await import('./routes/security.js')
    setSecurityConfigManager(configManager)
    const securityRouter = (await import('./routes/security.js')).default
    app.use('/api/security', securityRouter)

    // 前端路由处理（SPA支持）
    app.get('*', (req, res) => {
      // 如果是API请求，返回404
      if (req.path.startsWith('/api/')) {
        res.status(404).json({
          error: '接口不存在',
          path: req.originalUrl
        })
      } else {
        // 其他请求返回前端页面
        res.sendFile(path.join(__dirname, '../public/index.html'))
      }
    })

    // Socket.IO 认证中间件
    io.use(async (socket, next) => {
      const token = socket.handshake.auth.token

      if (!token) {
        logger.warn(`Socket连接被拒绝: ${socket.id} - 缺少token`)
        return next(new Error('Authentication error: No token provided'))
      }

      const decoded = authManager.verifyToken(token)
      if (!decoded) {
        logger.warn(`Socket连接被拒绝: ${socket.id} - 无效token`)
        return next(new Error('Authentication error: Invalid token'))
      }

      // 将用户信息附加到socket
      socket.data.user = {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role
      }

      logger.info(`Socket认证成功: ${socket.id} - 用户: ${decoded.username}`)
      next()
    })

    // Socket.IO 连接处理
    io.on('connection', (socket) => {
      logger.info(`客户端连接: ${socket.id} - 用户: ${socket.data.user?.username}`)

      // 终端相关事件
      socket.on('create-pty', async (data) => {
        // 将前端的cwd参数映射到后端的workingDirectory
        const mappedData = {
          ...data,
          workingDirectory: data.cwd || data.workingDirectory
        }
        delete mappedData.cwd
        await terminalManager.createPty(socket, mappedData)
      })

      socket.on('terminal-input', (data) => {
        terminalManager.handleInput(socket, data)
      })

      socket.on('terminal-resize', (data) => {
        terminalManager.resizeTerminal(socket, data)
      })

      socket.on('close-pty', (data) => {
        terminalManager.closePty(socket, data)
      })

      socket.on('reconnect-session', (data) => {
        const success = terminalManager.reconnectSession(socket, data.sessionId)
        if (success) {
          socket.emit('session-reconnected', { sessionId: data.sessionId })
        } else {
          socket.emit('session-reconnect-failed', { sessionId: data.sessionId })
        }
      })

      // 游戏管理事件
      socket.on('game-start', (data) => {
        gameManager.startGame(socket, data)
      })

      socket.on('game-stop', (data) => {
        gameManager.stopGame(socket, data)
      })

      socket.on('game-command', (data) => {
        gameManager.sendCommand(socket, data.gameId, data.command)
      })

      // 系统监控事件
      socket.on('subscribe-system-stats', () => {
        socket.join('system-stats')
        logger.info(`客户端 ${socket.id} 开始订阅系统状态`)
      })

      socket.on('unsubscribe-system-stats', () => {
        socket.leave('system-stats')
        logger.info(`客户端 ${socket.id} 取消订阅系统状态`)
        // 检查是否还有其他订阅者
        systemManager.handleClientDisconnect()
      })

      // 端口监控事件
      socket.on('subscribe-system-ports', () => {
        socket.join('system-ports')
        logger.info(`客户端 ${socket.id} 开始订阅端口信息`)
      })

      socket.on('unsubscribe-system-ports', () => {
        socket.leave('system-ports')
        logger.info(`客户端 ${socket.id} 取消订阅端口信息`)
        // 检查是否还有其他订阅者
        systemManager.handleClientDisconnect()
      })

      // 进程监控事件
      socket.on('subscribe-system-processes', () => {
        socket.join('system-processes')
        logger.info(`客户端 ${socket.id} 开始订阅进程信息`)
      })

      socket.on('unsubscribe-system-processes', () => {
        socket.leave('system-processes')
        logger.info(`客户端 ${socket.id} 取消订阅进程信息`)
        // 检查是否还有其他订阅者
        systemManager.handleClientDisconnect()
      })

      // 终端活跃进程监控事件
      socket.on('subscribe-terminal-processes', () => {
        socket.join('terminal-processes')
        logger.info(`客户端 ${socket.id} 开始订阅终端活跃进程信息`)
        // 立即发送一次当前数据
        terminalManager.sendActiveProcessesToClient(socket)
      })

      socket.on('unsubscribe-terminal-processes', () => {
        socket.leave('terminal-processes')
        logger.info(`客户端 ${socket.id} 取消订阅终端活跃进程信息`)
        // 检查是否还有其他订阅者
        terminalManager.handleClientDisconnect()
      })

      // 面板日志订阅事件
      socket.on('subscribe-console-logs', () => {
        socket.join('console-logs')
        logger.info(`客户端 ${socket.id} 开始订阅面板日志`)
        // 发送历史日志
        const recentLogs = consoleLogBuffer.getRecentLogs(100)
        socket.emit('console-logs-history', { lines: recentLogs })
      })

      socket.on('unsubscribe-console-logs', () => {
        socket.leave('console-logs')
        logger.info(`客户端 ${socket.id} 取消订阅面板日志`)
      })

      // 文件监视事件
      socket.on('watch-file', async (data: { filePath: string }) => {
        try {
          const success = await fileWatchManager.watchFile(socket, data.filePath)
          socket.emit('watch-file-response', {
            filePath: data.filePath,
            success,
            message: success ? '开始监视文件' : '监视文件失败'
          })
        } catch (error: any) {
          logger.error('监视文件失败:', error)
          socket.emit('watch-file-response', {
            filePath: data.filePath,
            success: false,
            message: error.message || '监视文件失败'
          })
        }
      })

      socket.on('unwatch-file', (data: { filePath: string }) => {
        try {
          fileWatchManager.unwatchFile(socket, data.filePath)
          socket.emit('unwatch-file-response', {
            filePath: data.filePath,
            success: true,
            message: '停止监视文件'
          })
        } catch (error: any) {
          logger.error('取消监视文件失败:', error)
          socket.emit('unwatch-file-response', {
            filePath: data.filePath,
            success: false,
            message: error.message || '取消监视文件失败'
          })
        }
      })

      // 断开连接处理
      socket.on('disconnect', (reason) => {
        logger.info(`客户端断开连接: ${socket.id}, 原因: ${reason}`)
        terminalManager.handleDisconnect(socket)
        socket.leave('system-stats')
        socket.leave('system-ports')
        socket.leave('system-processes')
        socket.leave('terminal-processes')
        socket.leave('console-logs')
        // 通知系统管理器客户端已断开连接
        systemManager.handleClientDisconnect()
        // 通知终端管理器客户端已断开连接
        terminalManager.handleClientDisconnect()
        // 清理文件监视
        fileWatchManager.unwatchAllFilesForSocket(socket)
      })

      // 错误处理
      socket.on('error', (error) => {
        logger.error(`Socket错误 ${socket.id}:`, error)
      })
    })

    const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '3001', 10)
    const HOST = process.env.HOST || '0.0.0.0'

    server.listen(PORT, HOST, () => {
      logger.info(`GSM3服务器启动成功!`)
      logger.info(`地址: http://${HOST}:${PORT}`)
      logger.info(`环境: ${process.env.NODE_ENV || 'development'}`)
      logger.info(`进程ID: ${process.pid}`)

      // 检查CORS配置安全性
      checkCORSConfiguration()

      // 重点显示连接地址
      displayConnectionInfo(HOST, PORT)
    })
  } catch (error) {
    logger.error('服务器启动失败:', error)
    process.exit(1)
  }
}

startServer()

export { app, server, io, logger }