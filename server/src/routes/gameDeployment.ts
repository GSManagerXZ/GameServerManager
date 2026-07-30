import { Router, Request, Response } from 'express'
import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import axios from 'axios'
import http from 'http'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Server as SocketIOServer } from 'socket.io'
import { TerminalManager } from '../modules/terminal/TerminalManager.js'
import { InstanceManager } from '../modules/instance/InstanceManager.js'
import { SteamCMDManager, type SteamBranchQueryOptions } from '../modules/steamcmd/SteamCMDManager.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'
import logger from '../utils/logger.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import {
  createSteamCMDRunScript,
  prepareSteamCMDLaunch,
  type SteamCMDRunScript
} from '../utils/steamcmdRunScript.js'

const execFileAsync = promisify(execFile)

// 平台枚举
enum Platform {
  Windows = 'Windows',
  Linux = 'Linux',
  MacOS = 'MacOS'
}

type StartCommandConfig = string | Partial<Record<Platform, string>>

interface LinuxSteamCMDRuntimeIssue {
  message: string
  fixCommands: string[]
  missingLibraries?: string[]
}

interface LinuxSteamCMDFixHint {
  message: string
  fixCommands: string[]
}

interface LinuxOsRelease {
  id?: string
  idLike: string[]
  name?: string
}

// 游戏信息接口
interface SteamGameInfo {
  game_nameCN: string
  appid: string
  tip: string
  image: string
  url: string
  system?: Platform[]
  system_info?: Platform[]  // 面板兼容的系统列表
  login_anonymous?: boolean
  start_command?: StartCommandConfig
}

function normalizeSteamBranch(branch?: string): string {
  const normalizedBranch = String(branch || 'public').trim()
  return normalizedBranch || 'public'
}

function quoteSteamCMDConsoleArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function getSteamUpdateCommand(appId: string, branch?: string, betaPassword?: string, validate?: boolean): string {
  const normalizedBranch = normalizeSteamBranch(branch)
  let command = `app_update ${appId}`

  if (normalizedBranch !== 'public') {
    command += ` -beta ${quoteSteamCMDConsoleArgument(normalizedBranch)}`
    if (betaPassword?.trim()) {
      command += ` -betapassword ${quoteSteamCMDConsoleArgument(betaPassword.trim())}`
    }
  }

  if (validate) {
    command += ' validate'
  }

  return command
}

function appendLaunchArguments(command: string, launchArgs: string): string {
  const normalizedCommand = command.trim()
  if (!launchArgs || !normalizedCommand || normalizedCommand === 'none') {
    return command
  }

  return `${normalizedCommand} ${launchArgs}`
}

function validateLaunchArguments(launchArgs: unknown): string {
  if (launchArgs === undefined || launchArgs === null) return ''
  if (
    typeof launchArgs !== 'string'
    || launchArgs.length > 2048
    || /[\r\n;&|`]/.test(launchArgs)
    || /\$\(|\$\{/.test(launchArgs)
  ) {
    throw new Error('启动参数包含不支持的字符')
  }

  return launchArgs.trim()
}

// 获取当前平台
function getCurrentPlatform(): Platform {
  const platform = os.platform()
  switch (platform) {
    case 'win32':
      return Platform.Windows
    case 'linux':
      return Platform.Linux
    case 'darwin':
      return Platform.MacOS
    default:
      return Platform.Linux // 默认为Linux
  }
}

// 检查游戏是否支持当前平台
function isGameSupportedOnCurrentPlatform(game: SteamGameInfo): boolean {
  // 如果游戏没有定义system字段，默认支持全平台
  if (!game.system || game.system.length === 0) {
    return true
  }
  
  const currentPlatform = getCurrentPlatform()
  return game.system.includes(currentPlatform)
}

// 检查面板是否兼容当前平台
function isPanelCompatibleOnCurrentPlatform(game: SteamGameInfo): boolean {
  // 如果游戏没有定义system_info字段，默认面板兼容
  if (!game.system_info || game.system_info.length === 0) {
    return true
  }
  
  const currentPlatform = getCurrentPlatform()
  return game.system_info.includes(currentPlatform)
}

function getInstallGamePaths(): string[] {
  const baseDir = process.cwd()
  return [
    path.join(baseDir, 'data', 'games', 'installgame.json'),           // 打包后的路径
    path.join(baseDir, 'server', 'data', 'games', 'installgame.json'), // 开发环境路径
  ]
}

async function getInstallGameFilePath(): Promise<string | null> {
  for (const possiblePath of getInstallGamePaths()) {
    try {
      await fs.access(possiblePath)
      return possiblePath
    } catch {
      // 继续尝试下一个路径
    }
  }

  return null
}

async function getInstallGameInfo(gameKey: string): Promise<SteamGameInfo | null> {
  const gamesFilePath = await getInstallGameFilePath()
  if (!gamesFilePath) {
    return null
  }

  const gamesData = await fs.readFile(gamesFilePath, 'utf-8')
  const allGames: { [key: string]: SteamGameInfo } = JSON.parse(gamesData)
  return allGames[gameKey] || null
}

function resolvePlatformStartCommand(startCommand?: StartCommandConfig): string | null {
  if (!startCommand) {
    return null
  }

  if (typeof startCommand === 'string') {
    return startCommand.trim() || null
  }

  const currentPlatform = getCurrentPlatform()
  return (
    startCommand[currentPlatform] ||
    startCommand[Platform.Linux] ||
    startCommand[Platform.Windows] ||
    startCommand[Platform.MacOS] ||
    null
  )
}

async function getLocalStartCommandForGame(gameKey: string): Promise<string | null> {
  const gameInfo = await getInstallGameInfo(gameKey)
  return resolvePlatformStartCommand(gameInfo?.start_command)
}

function normalizeSteamCMDArguments(command: string): string {
  return command
    .trim()
    .replace(/^(?:"[^"]*[\\/]?steamcmd(?:\.exe|\.sh)?"|(?:[a-z]:)?[^\s"]*[\\/]steamcmd(?:\.exe|\.sh)?|steamcmd(?:\.exe|\.sh)?)(?:\s+|$)/i, '')
    .trim()
}

function getSteamCMDTokenValue(token: string): string {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1)
  }

  return token
}

function redactSteamCMDCredentials(command: string): string {
  const tokens = command.match(/"[^"]*"|'(?:''|[^'])*'|\S+/g)
  if (!tokens) {
    return command
  }

  const redactedTokens = [...tokens]

  for (let index = 0; index < redactedTokens.length; index++) {
    const tokenValue = getSteamCMDTokenValue(redactedTokens[index]).toLowerCase()
    if (tokenValue !== 'login' && tokenValue !== '+login') {
      continue
    }

    const usernameToken = redactedTokens[index + 1]
    const passwordToken = redactedTokens[index + 2]
    if (!usernameToken || !passwordToken) {
      continue
    }

    const username = getSteamCMDTokenValue(usernameToken).toLowerCase()
    if (username === 'anonymous' || passwordToken.startsWith('+')) {
      continue
    }

    redactedTokens[index + 2] = '******'

    const steamGuardToken = redactedTokens[index + 3]
    if (steamGuardToken && !steamGuardToken.startsWith('+')) {
      redactedTokens[index + 3] = '******'
    }
  }

  return redactedTokens.join(' ')
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function parseOsReleaseValue(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\(["'\\$`])/g, '$1')
  }

  return trimmed
}

async function readLinuxOsRelease(): Promise<LinuxOsRelease> {
  try {
    const osRelease = await fs.readFile('/etc/os-release', 'utf-8')
    const values: Record<string, string> = {}

    for (const line of osRelease.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex === -1) {
        continue
      }

      const key = trimmed.slice(0, separatorIndex)
      const value = parseOsReleaseValue(trimmed.slice(separatorIndex + 1))
      values[key] = value
    }

    return {
      id: values.ID?.toLowerCase(),
      idLike: values.ID_LIKE?.toLowerCase().split(/\s+/).filter(Boolean) || [],
      name: values.NAME
    }
  } catch {
    return { idLike: [] }
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`], {
      timeout: 3000,
      maxBuffer: 1024
    })
    return true
  } catch {
    return false
  }
}

async function getLinuxSteamCMDFixHint(): Promise<LinuxSteamCMDFixHint> {
  const osRelease = await readLinuxOsRelease()
  const distroIds = new Set([osRelease.id, ...osRelease.idLike].filter(Boolean) as string[])
  const hasDistro = (...ids: string[]) => ids.some(id => distroIds.has(id))

  if (hasDistro('debian', 'ubuntu', 'linuxmint', 'pop', 'raspbian')) {
    return {
      message: '检测到 Debian/Ubuntu 系统，可使用下方命令安装 SteamCMD 需要的 i386 运行时依赖后重试。',
      fixCommands: [
        'dpkg --add-architecture i386',
        'apt-get update',
        'apt-get install -y libc6:i386 libstdc++6:i386 libgcc-s1:i386'
      ]
    }
  }

  if (hasDistro('fedora', 'rhel', 'centos', 'rocky', 'almalinux', 'ol')) {
    return {
      message: '检测到 Fedora/RHEL 系统，可使用下方命令安装 SteamCMD 需要的 32 位运行时依赖后重试。',
      fixCommands: [
        'dnf install -y glibc.i686 libstdc++.i686 libgcc.i686'
      ]
    }
  }

  if (hasDistro('arch', 'manjaro')) {
    return {
      message: '检测到 Arch 系统，请确认已启用 multilib 仓库，然后使用下方命令安装 SteamCMD 需要的 32 位运行时依赖后重试。',
      fixCommands: [
        'pacman -Syu --needed lib32-glibc lib32-gcc-libs'
      ]
    }
  }

  if (hasDistro('opensuse', 'suse', 'sles')) {
    return {
      message: '检测到 openSUSE/SUSE 系统，可使用下方命令安装 SteamCMD 需要的 32 位运行时依赖后重试。',
      fixCommands: [
        'zypper --non-interactive install glibc-32bit libstdc++6-32bit libgcc_s1-32bit'
      ]
    }
  }

  if (hasDistro('alpine')) {
    return {
      message: '检测到 Alpine/musl 环境。SteamCMD 的 linux32 可执行文件依赖 glibc 32 位运行时，不建议在 Alpine 上直接运行；建议改用 Debian/Ubuntu/RHEL/openSUSE/Arch 等 glibc 发行版或容器环境。',
      fixCommands: []
    }
  }

  const [hasAptGet, hasDnf, hasYum, hasPacman, hasZypper, hasApk] = await Promise.all([
    commandExists('apt-get'),
    commandExists('dnf'),
    commandExists('yum'),
    commandExists('pacman'),
    commandExists('zypper'),
    commandExists('apk')
  ])

  if (hasAptGet) {
    return {
      message: '检测到 apt-get，可使用下方命令安装 SteamCMD 需要的 i386 运行时依赖后重试。',
      fixCommands: [
        'dpkg --add-architecture i386',
        'apt-get update',
        'apt-get install -y libc6:i386 libstdc++6:i386 libgcc-s1:i386'
      ]
    }
  }

  if (hasDnf) {
    return {
      message: '检测到 dnf，可使用下方命令安装 SteamCMD 需要的 32 位运行时依赖后重试。',
      fixCommands: [
        'dnf install -y glibc.i686 libstdc++.i686 libgcc.i686'
      ]
    }
  }

  if (hasYum) {
    return {
      message: '检测到 yum，可使用下方命令安装 SteamCMD 需要的 32 位运行时依赖后重试。',
      fixCommands: [
        'yum install -y glibc.i686 libstdc++.i686 libgcc.i686'
      ]
    }
  }

  if (hasPacman) {
    return {
      message: '检测到 pacman，请确认已启用 multilib 仓库，然后使用下方命令安装 SteamCMD 需要的 32 位运行时依赖后重试。',
      fixCommands: [
        'pacman -Syu --needed lib32-glibc lib32-gcc-libs'
      ]
    }
  }

  if (hasZypper) {
    return {
      message: '检测到 zypper，可使用下方命令安装 SteamCMD 需要的 32 位运行时依赖后重试。',
      fixCommands: [
        'zypper --non-interactive install glibc-32bit libstdc++6-32bit libgcc_s1-32bit'
      ]
    }
  }

  if (hasApk) {
    return {
      message: '检测到 apk/Alpine 类环境。SteamCMD 的 linux32 可执行文件依赖 glibc 32 位运行时，不建议在该环境直接运行；建议改用 glibc 发行版或容器环境。',
      fixCommands: []
    }
  }

  return {
    message: '未识别出可自动生成修复命令的发行版。请根据当前系统文档安装 32 位 glibc/ELF loader、libstdc++ 和 libgcc 运行库后重试。',
    fixCommands: []
  }
}

async function createLinuxSteamCMDRuntimeIssue(message: string, missingLibraries?: string[]): Promise<LinuxSteamCMDRuntimeIssue> {
  const fixHint = await getLinuxSteamCMDFixHint()
  const privilegeHint = fixHint.fixCommands.length > 0 ? ' 这些命令需要 root 权限；非 root 用户请逐条加 sudo 执行。' : ''
  const issue: LinuxSteamCMDRuntimeIssue = {
    message: `${message}${fixHint.message ? ` ${fixHint.message}` : ''}${privilegeHint}`,
    fixCommands: fixHint.fixCommands
  }

  if (missingLibraries?.length) {
    issue.missingLibraries = missingLibraries
  }

  return issue
}

async function checkLinuxSteamCMDRuntime(steamcmdDir: string): Promise<LinuxSteamCMDRuntimeIssue | null> {
  if (getCurrentPlatform() !== Platform.Linux) {
    return null
  }

  const linux32Steamcmd = path.join(steamcmdDir, 'linux32', 'steamcmd')
  if (!(await pathExists(linux32Steamcmd))) {
    return {
      message: 'SteamCMD 安装目录缺少 linux32/steamcmd，当前 Linux SteamCMD 安装可能不完整。请在设置中重新下载/更新 SteamCMD 后重试。',
      fixCommands: []
    }
  }

  const loaderCandidates = [
    '/lib/ld-linux.so.2',
    '/lib32/ld-linux.so.2',
    '/lib/i386-linux-gnu/ld-linux.so.2',
    '/usr/lib/i386-linux-gnu/ld-linux.so.2'
  ]

  let has32BitLoader = false
  for (const candidate of loaderCandidates) {
    if (await pathExists(candidate)) {
      has32BitLoader = true
      break
    }
  }

  if (!has32BitLoader) {
    return createLinuxSteamCMDRuntimeIssue(
      '当前 Linux 系统缺少 32 位 ELF loader，SteamCMD 会报 “linux32/steamcmd: cannot execute: required file not found”。'
    )
  }

  try {
    const { stdout, stderr } = await execFileAsync('ldd', [linux32Steamcmd], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    })
    const lddOutput = `${stdout}\n${stderr}`
    const missingLibraries = Array.from(
      new Set(
        lddOutput
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.includes('not found'))
          .map(line => line.split(/\s+/)[0])
          .filter(Boolean)
      )
    )

    if (missingLibraries.length > 0) {
      return createLinuxSteamCMDRuntimeIssue(
        `SteamCMD 32 位运行库不完整，缺少：${missingLibraries.join(', ')}。`,
        missingLibraries
      )
    }
  } catch (error: any) {
    logger.warn('SteamCMD Linux runtime ldd 检测失败，继续安装流程:', error.message)
  }

  return null
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()

// 管理器实例
let terminalManager: TerminalManager
let instanceManager: InstanceManager
let steamcmdManager: SteamCMDManager
let configManager: ConfigManager
let io: SocketIOServer

type SteamUpdateStatus = 'running' | 'completed' | 'failed'

interface SteamUpdateTask {
  updateId: string
  userId: string
  instanceId: string
  requestedBranch: string
  status: SteamUpdateStatus
  error?: string
  updatedAt: string
}

const steamUpdateTasks = new Map<string, SteamUpdateTask>()
const STEAM_UPDATE_TASK_RETENTION_MS = 60 * 60 * 1000

function finishSteamUpdateTask(updateId: string, status: Exclude<SteamUpdateStatus, 'running'>, error?: string) {
  const task = steamUpdateTasks.get(updateId)
  if (!task) return

  task.status = status
  task.error = error
  task.updatedAt = new Date().toISOString()
  const completedAt = task.updatedAt
  const cleanupTimer = setTimeout(() => {
    if (steamUpdateTasks.get(updateId)?.updatedAt === completedAt) {
      steamUpdateTasks.delete(updateId)
    }
  }, STEAM_UPDATE_TASK_RETENTION_MS)
  cleanupTimer.unref?.()
}

// 设置管理器实例
export function setGameDeploymentManagers(
  terminal: TerminalManager,
  instance: InstanceManager,
  steamcmd: SteamCMDManager,
  config: ConfigManager,
  socketIO: SocketIOServer
) {
  terminalManager = terminal
  instanceManager = instance
  steamcmdManager = steamcmd
  configManager = config
  io = socketIO
}

async function respondWithSteamBranches(
  res: Response,
  appId: string,
  options: SteamBranchQueryOptions = {}
) {
  try {
    const branches = await steamcmdManager.getAppBranches(appId, options)
    res.json({
      success: true,
      data: branches
    })
  } catch (error: any) {
    logger.error('查询Steam分支失败:', error)
    res.status(500).json({
      success: false,
      error: '查询Steam分支失败',
      message: error.message
    })
  }
}

// 获取可安装的游戏列表
router.get('/games', authenticateToken, async (req: Request, res: Response) => {
  try {
    // 尝试多个可能的路径来查找 installgame.json 文件
    const baseDir = process.cwd()
    const possiblePaths = [
      path.join(baseDir, 'data', 'games', 'installgame.json'),           // 打包后的路径
      path.join(baseDir, 'server', 'data', 'games', 'installgame.json'), // 开发环境路径
    ]
    
    let gamesFilePath = ''
    for (const possiblePath of possiblePaths) {
      try {
        fsSync.accessSync(possiblePath, fsSync.constants.F_OK)
        gamesFilePath = possiblePath
        break
      } catch {
        // 继续尝试下一个路径
      }
    }

    if (!gamesFilePath) {
      logger.info('未找到 installgame.json 文件，开始自动更新游戏清单')
      
      try {
        // 自动执行更新游戏清单
        const remoteUrl = 'http://api.gsm.xiaozhuhouses.asia:8082/disk1/GSM3/installgame.json'
        const targetPath = possiblePaths[0] // 使用第一个路径作为目标路径
        
        // 确保目录存在
        const gamesDir = path.dirname(targetPath)
        try {
          await fs.access(gamesDir)
        } catch {
          await fs.mkdir(gamesDir, { recursive: true })
          logger.info('创建games目录:', gamesDir)
        }
        
        // 从远程URL下载最新的游戏清单
        const response = await axios.get(remoteUrl, {
          timeout: 30000, // 30秒超时
          headers: {
            'User-Agent': 'GSManager3/1.0'
          }
        })
        
        // 验证响应数据格式
        if (typeof response.data !== 'object' || response.data === null) {
          throw new Error('远程数据格式无效：不是有效的JSON对象')
        }
        
        // 简单验证数据结构
        const gameKeys = Object.keys(response.data)
        if (gameKeys.length === 0) {
          throw new Error('远程数据为空')
        }
        
        // 检查第一个游戏是否有必要的字段
        const firstGame = response.data[gameKeys[0]]
        if (!firstGame || typeof firstGame !== 'object' || !firstGame.game_nameCN || !firstGame.appid) {
          throw new Error('远程数据格式无效：缺少必要的游戏信息字段')
        }
        
        // 将数据写入本地文件
        await fs.writeFile(targetPath, JSON.stringify(response.data, null, 2), 'utf-8')
        
        logger.info('自动更新Steam游戏部署清单成功', {
          gameCount: gameKeys.length,
          filePath: targetPath
        })
        
        // 设置文件路径为新创建的文件
        gamesFilePath = targetPath
        
      } catch (updateError: any) {
        logger.error('自动更新游戏清单失败:', updateError)
        throw new Error(`无法找到 installgame.json 文件，且自动更新失败: ${updateError.message}`)
      }
    }
    
    const gamesData = await fs.readFile(gamesFilePath, 'utf-8')
    const allGames: { [key: string]: SteamGameInfo } = JSON.parse(gamesData)
    
    const currentPlatform = getCurrentPlatform()
    const filteredGames: { [key: string]: SteamGameInfo & { 
      supportedOnCurrentPlatform: boolean, 
      currentPlatform: Platform,
      panelCompatibleOnCurrentPlatform: boolean 
    } } = {}
    
    // 添加平台信息到所有游戏（不再过滤不兼容的游戏）
    for (const [gameKey, gameInfo] of Object.entries(allGames)) {
      const isSupported = isGameSupportedOnCurrentPlatform(gameInfo)
      const isPanelCompatible = isPanelCompatibleOnCurrentPlatform(gameInfo)
      
      // 返回所有游戏，包括不支持当前平台的游戏
      filteredGames[gameKey] = {
        ...gameInfo,
        supportedOnCurrentPlatform: isSupported,
        currentPlatform,
        panelCompatibleOnCurrentPlatform: isPanelCompatible
      }
    }
    
    const supportedCount = Object.values(filteredGames).filter(game => game.supportedOnCurrentPlatform).length
    logger.info(`当前平台: ${currentPlatform}, 支持的游戏数量: ${supportedCount}/${Object.keys(allGames).length}`)
    
    res.json({
      success: true,
      data: filteredGames
    })
  } catch (error: any) {
    logger.error('获取游戏列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取游戏列表失败',
      message: error.message
    })
  }
})

// 检查游戏内存需求
router.post('/check-memory', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameKey } = req.body

    if (!gameKey) {
      return res.status(400).json({
        success: false,
        error: '缺少游戏标识',
        message: '游戏标识为必填项'
      })
    }

    let memoryWarning = null

    try {
      // 读取游戏配置文件
      const baseDir = process.cwd()
      const possiblePaths = [
        path.join(baseDir, 'data', 'games', 'installgame.json'),
        path.join(baseDir, 'server', 'data', 'games', 'installgame.json'),
      ]

      let gamesFilePath = ''
      for (const possiblePath of possiblePaths) {
        try {
          fsSync.accessSync(possiblePath, fsSync.constants.F_OK)
          gamesFilePath = possiblePath
          break
        } catch {
          // 继续尝试下一个路径
        }
      }

      if (gamesFilePath) {
        const gamesData = await fs.readFile(gamesFilePath, 'utf-8')
        const games = JSON.parse(gamesData)
        const gameInfo = games[gameKey]

        if (gameInfo && gameInfo.memory) {
          const requiredMemoryGB = gameInfo.memory
          const systemMemoryGB = Math.round(os.totalmem() / (1024 * 1024 * 1024))

          logger.info(`内存检测: 游戏 ${gameKey} 需要 ${requiredMemoryGB}GB，系统总内存 ${systemMemoryGB}GB`)

          if (systemMemoryGB < requiredMemoryGB) {
            memoryWarning = {
              required: requiredMemoryGB,
              available: systemMemoryGB,
              message: `警告：${gameInfo.game_nameCN || gameKey} 推荐至少 ${requiredMemoryGB}GB 内存，但系统只有 ${systemMemoryGB}GB。继续安装可能会导致性能问题或无法正常运行。`
            }
            logger.warn(`内存不足警告: ${memoryWarning.message}`)
          }
        }
      }
    } catch (error) {
      logger.warn('检查游戏内存需求时出错:', error)
      // 内存检查失败不应阻止安装，继续执行
    }

    res.json({
      success: true,
      memoryWarning
    })

  } catch (error: any) {
    logger.error('检查游戏内存需求失败:', error)
    res.status(500).json({
      success: false,
      error: '检查内存需求失败',
      message: error.message
    })
  }
})

// 查询Steam应用分支
router.get('/steam/branches/:appId', authenticateToken, async (req: Request, res: Response) => {
  const appId = String(req.params.appId || '').trim()
  if (!/^\d{1,10}$/.test(appId) || Number(appId) > 0xFFFFFFFF) {
    return res.status(400).json({
      success: false,
      error: 'Steam AppID格式无效'
    })
  }

  const refreshValue = String(req.query.refresh || '').toLowerCase()
  await respondWithSteamBranches(res, appId, {
    forceRefresh: refreshValue === '1' || refreshValue === 'true'
  })
})

// 使用请求内Steam账户查询受限应用分支，凭据不进入面板配置或分支缓存
router.post('/steam/branches/:appId', authenticateToken, async (req: Request, res: Response) => {
  const appId = String(req.params.appId || '').trim()
  if (!/^\d{1,10}$/.test(appId) || Number(appId) > 0xFFFFFFFF) {
    return res.status(400).json({
      success: false,
      error: 'Steam AppID格式无效'
    })
  }

  const steamUsername = typeof req.body?.steamUsername === 'string' ? req.body.steamUsername.trim() : ''
  const steamPassword = typeof req.body?.steamPassword === 'string' ? req.body.steamPassword : ''
  if (!steamUsername || !steamPassword) {
    return res.status(400).json({
      success: false,
      error: 'Steam账户信息不完整'
    })
  }
  if (steamUsername.length > 128 || steamPassword.length > 256 || /[\r\n]/.test(steamUsername) || /[\r\n]/.test(steamPassword)) {
    return res.status(400).json({
      success: false,
      error: 'Steam账户信息格式无效'
    })
  }

  await respondWithSteamBranches(res, appId, {
    forceRefresh: Boolean(req.body?.forceRefresh),
    steamUsername,
    steamPassword
  })
})

// 更新Steam实例服务端文件
router.get('/steam/update/:updateId', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const task = steamUpdateTasks.get(req.params.updateId)
  if (!task || task.userId !== req.user?.userId) {
    return res.status(404).json({
      success: false,
      error: 'Steam更新任务不存在'
    })
  }

  res.json({
    success: true,
    data: {
      updateId: task.updateId,
      instanceId: task.instanceId,
      requestedBranch: task.requestedBranch,
      status: task.status,
      error: task.error,
      updatedAt: task.updatedAt
    }
  })
})

router.post('/steam/update', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  let operationLock: { instanceId: string; token: string } | null = null
  let updateTask: SteamUpdateTask | null = null
  let updateRunScript: SteamCMDRunScript | null = null
  let handedOff = false
  try {
    const {
      instanceId,
      branch,
      betaPassword,
      validate,
      useAnonymous,
      steamUsername,
      steamPassword
    } = req.body
    if (!instanceId || typeof instanceId !== 'string') {
      return res.status(400).json({
        success: false,
        error: '缺少实例ID'
      })
    }
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }

    if (!instance.steam?.appId) {
      return res.status(400).json({
        success: false,
        error: '该实例未关联Steam游戏信息'
      })
    }

    if (typeof branch !== 'string' || !branch.trim()) {
      return res.status(400).json({
        success: false,
        error: '请选择Steam分支'
      })
    }

    const requestedBranch = normalizeSteamBranch(branch)
    if (requestedBranch.length > 128 || !/^[\w.-]+$/.test(requestedBranch)) {
      return res.status(400).json({
        success: false,
        error: 'Steam分支名称无效'
      })
    }

    const requestedBetaPassword = typeof betaPassword === 'string' ? betaPassword.trim() : ''
    if (requestedBetaPassword.length > 256 || /[\r\n]/.test(requestedBetaPassword)) {
      return res.status(400).json({
        success: false,
        error: 'Steam分支密码无效'
      })
    }

    if (instance.status !== 'stopped' && instance.status !== 'error') {
      return res.status(400).json({
        success: false,
        error: '请先停止实例再更新服务端'
      })
    }

    const steamcmdPath = await steamcmdManager.getSteamCMDExecutablePath()
    if (!steamcmdPath) {
      return res.status(400).json({
        success: false,
        error: 'SteamCMD未配置',
        message: '请先在设置中配置SteamCMD路径'
      })
    }

    const shouldUseAnonymous = useAnonymous !== false
    const requestedSteamUsername = typeof steamUsername === 'string' ? steamUsername.trim() : ''
    const requestedSteamPassword = typeof steamPassword === 'string' ? steamPassword : ''
    if (!shouldUseAnonymous) {
      if (!requestedSteamUsername || !requestedSteamPassword) {
        return res.status(400).json({
          success: false,
          error: 'Steam账户信息不完整'
        })
      }
      if (
        requestedSteamUsername.length > 128
        || requestedSteamPassword.length > 256
        || /[\r\n]/.test(requestedSteamUsername)
        || /[\r\n]/.test(requestedSteamPassword)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Steam账户信息格式无效'
        })
      }
    }

    // 私有分支不会出现在公开AppInfo中，具体分支名和密码交由SteamCMD校验。
    const selectedBranch = requestedBranch
    const steamLoginCommand = shouldUseAnonymous
      ? 'login anonymous'
      : `login ${quoteSteamCMDConsoleArgument(requestedSteamUsername)} ${quoteSteamCMDConsoleArgument(requestedSteamPassword)}`
    const steamcmdCommands = [
      `force_install_dir ${quoteSteamCMDConsoleArgument(instance.workingDirectory)}`,
      steamLoginCommand,
      getSteamUpdateCommand(
        instance.steam.appId,
        selectedBranch,
        requestedBetaPassword || undefined,
        Boolean(validate)
      ),
      'quit'
    ]
    const updateId = `steam-update-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    if (!instanceManager.acquireOperationLock(instance.id, updateId, 'Steam 服务端更新')) {
      return res.status(409).json({
        success: false,
        error: '该实例正在执行其他操作'
      })
    }
    operationLock = { instanceId: instance.id, token: updateId }

    const currentInstance = instanceManager.getInstance(instance.id)
    if (!currentInstance || (currentInstance.status !== 'stopped' && currentInstance.status !== 'error')) {
      return res.status(400).json({
        success: false,
        error: '请先停止实例再更新服务端'
      })
    }

    updateRunScript = await createSteamCMDRunScript(steamcmdCommands)
    const activeRunScript = updateRunScript
    await prepareSteamCMDLaunch(steamcmdPath)

    const userId = req.user!.userId
    const updateRoom = `user:${userId}`
    updateTask = {
      updateId,
      userId,
      instanceId: instance.id,
      requestedBranch: selectedBranch,
      status: 'running',
      updatedAt: new Date().toISOString()
    }
    steamUpdateTasks.set(updateId, updateTask)

    res.status(202).json({
      success: true,
      message: 'Steam服务端更新已开始',
      data: {
        updateId,
        instanceId: instance.id,
        requestedBranch: selectedBranch
      }
    })
    handedOff = true

    setImmediate(() => {
      void (async () => {
        try {
          io?.to(updateRoom).emit('steam-update-log', {
            updateId,
            instanceId: instance.id,
            message: `开始更新 ${instance.name} 到 ${selectedBranch} 分支\n`
          })

          const updateResult = await terminalManager.runManagedProcess({
            executablePath: steamcmdPath,
            args: [
              '-logdir', activeRunScript.logDirectory,
              '+runscript', activeRunScript.filePath
            ],
            workingDirectory: path.dirname(steamcmdPath),
            redactValues: [requestedBetaPassword, requestedSteamPassword].filter(Boolean),
            timeoutMs: 30 * 60 * 1000,
            onOutput: output => {
              io?.to(updateRoom).emit('steam-update-log', {
                updateId,
                instanceId: instance.id,
                message: output
              })
            }
          })
          if (updateResult.code !== 0) {
            throw new Error(updateResult.output.slice(-2000) || `SteamCMD退出码: ${updateResult.code}`)
          }

          const latestInstance = instanceManager.getInstance(instance.id)
          if (!latestInstance) {
            throw new Error('实例已不存在，无法保存Steam分支信息')
          }

          const updatedInstance = await instanceManager.updateInstance(instance.id, {
            name: latestInstance.name,
            description: latestInstance.description,
            workingDirectory: latestInstance.workingDirectory,
            startCommand: latestInstance.startCommand,
            autoStart: latestInstance.autoStart,
            stopCommand: latestInstance.stopCommand,
            enableStreamForward: latestInstance.enableStreamForward,
            programPath: latestInstance.programPath,
            terminalUser: latestInstance.terminalUser,
            instanceType: latestInstance.instanceType,
            javaVersion: latestInstance.javaVersion,
            steam: {
              ...latestInstance.steam!,
              branch: selectedBranch
            }
          }, updateId)
          if (!updatedInstance) {
            throw new Error('保存Steam分支信息失败')
          }

          logger.info(`Steam实例更新完成: ${instance.name}`, {
            instanceId: instance.id,
            appId: instance.steam.appId,
            branch: selectedBranch,
            validate: Boolean(validate),
            useAnonymous: shouldUseAnonymous
          })
          finishSteamUpdateTask(updateId, 'completed')
          io?.to(updateRoom).emit('steam-update-complete', {
            updateId,
            instanceId: instance.id,
            requestedBranch: selectedBranch,
            instance: updatedInstance
          })
        } catch (error: any) {
          logger.error(`Steam实例更新失败: ${instance.name}`, {
            instanceId: instance.id,
            appId: instance.steam.appId,
            branch: selectedBranch,
            error: error.message
          })
          const errorMessage = error.message || 'Steam服务端更新失败'
          finishSteamUpdateTask(updateId, 'failed', errorMessage)
          io?.to(updateRoom).emit('steam-update-error', {
            updateId,
            instanceId: instance.id,
            error: errorMessage
          })
        } finally {
          await activeRunScript.cleanup().catch(error => {
            logger.warn('清理SteamCMD更新脚本失败', error)
          })
          instanceManager.releaseOperationLock(instance.id, updateId)
        }
      })()
    })
  } catch (error: any) {
    logger.error('更新Steam实例失败:', error)
    if (updateTask && !handedOff) {
      finishSteamUpdateTask(updateTask.updateId, 'failed', error.message || 'Steam服务端更新失败')
    }
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: '更新Steam实例失败',
        message: error.message
      })
    }
  } finally {
    if (updateRunScript && !handedOff) {
      await updateRunScript.cleanup().catch(error => {
        logger.warn('清理SteamCMD更新脚本失败', error)
      })
    }
    if (operationLock && !handedOff) {
      instanceManager.releaseOperationLock(operationLock.instanceId, operationLock.token)
    }
  }
})

// 安装游戏
router.post('/install', authenticateToken, async (req: Request, res: Response) => {
  let installOperationLock: { instanceId: string; token: string } | null = null
  let installRunScript: SteamCMDRunScript | null = null
  let installProcessStarted = false
  const releaseInstallOperationLock = () => {
    if (!installOperationLock) return
    instanceManager.releaseOperationLock(installOperationLock.instanceId, installOperationLock.token)
    installOperationLock = null
  }

  try {
    const { 
      gameKey, 
      gameName, 
      appId, 
      installPath, 
      instanceName, 
      useAnonymous, 
      steamUsername, 
      steamPassword, 
      existingInstanceId,
      updateInstanceInfo,
      resetSteamManifest,
      branch,
      betaPassword,
      launchArgs,
      validateGameIntegrity
    } = req.body
    
    if (!gameKey || !appId || !installPath || !instanceName) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数',
        message: '游戏标识、Steam AppID、安装路径和实例名称为必填项'
      })
    }
    const normalizedAppId = String(appId).trim()
    if (!/^\d{1,10}$/.test(normalizedAppId) || Number(normalizedAppId) > 0xFFFFFFFF) {
      return res.status(400).json({
        success: false,
        error: 'Steam AppID格式无效'
      })
    }

    if (existingInstanceId !== undefined && typeof existingInstanceId !== 'string') {
      return res.status(400).json({
        success: false,
        error: '实例ID格式无效'
      })
    }

    const shouldUseAnonymous = useAnonymous !== false
    const requestedSteamUsername = typeof steamUsername === 'string' ? steamUsername.trim() : ''
    const requestedSteamPassword = typeof steamPassword === 'string' ? steamPassword : ''
    if (!shouldUseAnonymous) {
      if (!requestedSteamUsername) {
        return res.status(400).json({
          success: false,
          error: '缺少Steam用户名'
        })
      }

      if (
        requestedSteamUsername.length > 128
        || requestedSteamPassword.length > 256
        || /[\r\n]/.test(requestedSteamUsername)
        || /[\r\n]/.test(requestedSteamPassword)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Steam账户信息格式无效'
        })
      }
    }

    const selectedBranch = normalizeSteamBranch(branch)
    if (selectedBranch.length > 128 || !/^[\w.-]+$/.test(selectedBranch)) {
      return res.status(400).json({ success: false, error: 'Steam分支名称无效' })
    }
    const selectedBetaPassword = typeof betaPassword === 'string' ? betaPassword.trim() : ''
    if (selectedBetaPassword.length > 256 || /[\r\n]/.test(selectedBetaPassword)) {
      return res.status(400).json({ success: false, error: 'Steam分支密码无效' })
    }

    let userLaunchArguments = ''
    try {
      userLaunchArguments = validateLaunchArguments(launchArgs)
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message })
    }

    const requestedExistingInstance = existingInstanceId
      ? instanceManager.getInstance(existingInstanceId)
      : undefined
    if (existingInstanceId && !requestedExistingInstance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在',
        message: `未找到ID为 ${existingInstanceId} 的实例`
      })
    }
    if (
      requestedExistingInstance
      && requestedExistingInstance.status !== 'stopped'
      && requestedExistingInstance.status !== 'error'
    ) {
      return res.status(400).json({
        success: false,
        error: '请先停止实例再安装或更新服务端'
      })
    }

    const installOperationToken = `steam-install-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    if (requestedExistingInstance) {
      if (!instanceManager.acquireOperationLock(
        requestedExistingInstance.id,
        installOperationToken,
        'Steam 服务端安装或更新'
      )) {
        return res.status(409).json({
          success: false,
          error: '该实例正在执行其他操作'
        })
      }
      installOperationLock = {
        instanceId: requestedExistingInstance.id,
        token: installOperationToken
      }

      const currentInstance = instanceManager.getInstance(requestedExistingInstance.id)
      if (!currentInstance || (currentInstance.status !== 'stopped' && currentInstance.status !== 'error')) {
        return res.status(400).json({
          success: false,
          error: '请先停止实例再安装或更新服务端'
        })
      }
    }

    // 检查安装路径是否存在
    try {
      await fs.access(installPath)
    } catch {
      // 如果路径不存在，尝试创建
      try {
        await fs.mkdir(installPath, { recursive: true })
      } catch (mkdirError: any) {
        return res.status(400).json({
          success: false,
          error: '无法创建安装路径',
          message: mkdirError.message
        })
      }
    }

    // 如果需要重置Steam游戏文件清单
    if (resetSteamManifest) {
      try {
        const steamappsPath = path.join(installPath, 'steamapps')
        logger.info(`尝试重置Steam游戏文件清单: ${steamappsPath}`)
        
        // 检查steamapps目录是否存在
        try {
          await fs.access(steamappsPath)
          
          // 读取目录中的所有文件
          const files = await fs.readdir(steamappsPath)
          
          // 筛选出以appmanifest开头、.acf结尾的文件
          const manifestFiles = files.filter(file => 
            file.startsWith('appmanifest_') && file.endsWith('.acf')
          )
          
          if (manifestFiles.length > 0) {
            logger.info(`找到 ${manifestFiles.length} 个Steam清单文件，准备删除`)
            
            // 删除所有匹配的文件
            for (const file of manifestFiles) {
              const filePath = path.join(steamappsPath, file)
              try {
                await fs.unlink(filePath)
                logger.info(`已删除Steam清单文件: ${file}`)
              } catch (unlinkError: any) {
                logger.warn(`删除Steam清单文件失败: ${file}`, unlinkError.message)
              }
            }
            
            logger.info('Steam游戏文件清单重置完成')
          } else {
            logger.info('未找到需要删除的Steam清单文件')
          }
        } catch (accessError) {
          // steamapps目录不存在，跳过删除操作
          logger.info('steamapps目录不存在，跳过清单文件删除')
        }
      } catch (error: any) {
        logger.warn('重置Steam游戏文件清单时出错:', error.message)
        // 不阻止安装流程，只记录警告
      }
    }
    
    logger.info(`开始安装游戏: ${gameName || gameKey}`, {
      installPath,
      appId: normalizedAppId,
      command: '由服务器安全生成',
      resetSteamManifest: resetSteamManifest || false
    })
    
    try {
      // 获取SteamCMD路径
      const steamcmdPath = await steamcmdManager.getSteamCMDExecutablePath()
      if (!steamcmdPath) {
        return res.status(400).json({
          success: false,
          error: 'SteamCMD未配置',
          message: '请先在设置中配置SteamCMD路径'
        })
      }
      
      // 获取SteamCMD所在目录作为工作目录
      const steamcmdDir = path.dirname(steamcmdPath)

      const linuxRuntimeIssue = await checkLinuxSteamCMDRuntime(steamcmdDir)
      if (linuxRuntimeIssue) {
        return res.status(400).json({
          success: false,
          error: 'SteamCMD Linux运行环境不完整',
          message: linuxRuntimeIssue.message,
          data: {
            fixCommands: linuxRuntimeIssue.fixCommands,
            missingLibraries: linuxRuntimeIssue.missingLibraries
          }
        })
      }
      
      // 创建虚拟socket用于终端会话
      const virtualSocket = {
        id: `install-${Date.now()}`,
        emit: () => {},
        on: () => {},
        disconnect: () => {}
      } as any
      const terminalSessionId = installOperationToken

      const platform = getCurrentPlatform()
      const steamcmdCommands = [
        `force_install_dir ${quoteSteamCMDConsoleArgument(installPath)}`,
        shouldUseAnonymous
          ? 'login anonymous'
          : `login ${quoteSteamCMDConsoleArgument(requestedSteamUsername)}${requestedSteamPassword ? ` ${quoteSteamCMDConsoleArgument(requestedSteamPassword)}` : ''}`,
        getSteamUpdateCommand(
          normalizedAppId,
          selectedBranch,
          selectedBetaPassword || undefined,
          Boolean(validateGameIntegrity)
        ),
        'quit'
      ]

      logger.info('执行SteamCMD安装命令', {
        platform,
        workingDirectory: steamcmdDir,
        appId: normalizedAppId,
        branch: selectedBranch,
        validate: Boolean(validateGameIntegrity),
        useAnonymous: shouldUseAnonymous
      })
      
      // 处理实例：更新或创建
      let instance: any
      
      if (existingInstanceId) {
        // 如果存在实例ID，使用现有实例
        const existingInstance = requestedExistingInstance!
        instance = existingInstance
        
        instance = await instanceManager.updateInstance(existingInstanceId, {
          name: instance.name,
          description: instance.description,
          workingDirectory: instance.workingDirectory,
          startCommand: instance.startCommand,
          autoStart: instance.autoStart,
          stopCommand: instance.stopCommand,
          enableStreamForward: instance.enableStreamForward,
          programPath: instance.programPath,
          terminalUser: instance.terminalUser,
          instanceType: instance.instanceType,
          javaVersion: instance.javaVersion,
          steam: {
            appId: normalizedAppId,
            gameKey,
            branch: selectedBranch
          }
        }, installOperationToken)

        // 如果需要更新实例信息
        if (updateInstanceInfo) {
          // 查询实例市场获取启动命令
          let startCommand = 'none'
          try {
            // 确定系统类型
            const platform = getCurrentPlatform()
            let systemType = 'Linux'
            if (platform === Platform.Windows) {
              systemType = 'Windows'
            }
            
            // 请求实例市场数据
            const marketUrl = `http://api.gsm.xiaozhuhouses.asia:10002/api/instances?system_type=${systemType}`
            
            const marketData = await new Promise<any>((resolve, reject) => {
              const url = new URL(marketUrl)
              const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'User-Agent': 'GSM3-Server/1.0'
                }
              }
              
              const req = http.request(options, (response: any) => {
                let data = ''
                
                response.on('data', (chunk: any) => {
                  data += chunk
                })
                
                response.on('end', () => {
                  try {
                    if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                      const jsonData = JSON.parse(data)
                      resolve(jsonData)
                    } else {
                      reject(new Error(`HTTP error! status: ${response.statusCode}`))
                    }
                  } catch (parseError) {
                    reject(new Error(`JSON parse error: ${parseError}`))
                  }
                })
              })
              
              req.on('error', (error: any) => {
                reject(error)
              })
              
              req.setTimeout(5000, () => {
                req.destroy()
                reject(new Error('Request timeout'))
              })
              
              req.end()
            })
            
            // 在实例市场中查找匹配的游戏
            if (marketData && marketData.instances && Array.isArray(marketData.instances)) {
              const gameNameToMatch = gameName || gameKey
              const matchedInstance = marketData.instances.find((instance: any) => {
                // 尝试多种匹配方式
                return instance.name && (
                  instance.name.toLowerCase().includes(gameNameToMatch.toLowerCase()) ||
                  gameNameToMatch.toLowerCase().includes(instance.name.toLowerCase())
                )
              })
              
              if (matchedInstance && matchedInstance.command) {
                startCommand = matchedInstance.command
                logger.info(`从实例市场找到匹配的启动命令: ${gameNameToMatch} -> ${startCommand}`)
              } else {
                logger.info(`实例市场中未找到匹配的游戏: ${gameNameToMatch}，尝试使用本地清单启动命令`)
              }
            }
          } catch (error: any) {
            logger.warn('查询实例市场失败，尝试使用本地清单启动命令:', error.message)
          }

          if (startCommand === 'none') {
            const localStartCommand = await getLocalStartCommandForGame(gameKey)
            if (localStartCommand) {
              startCommand = localStartCommand
              logger.info(`使用本地清单启动命令: ${gameKey} -> ${startCommand}`)
            }
          }
          
          // 更新实例信息
          const resolvedStartCommand = appendLaunchArguments(startCommand, userLaunchArguments)
          await instanceManager.updateInstance(existingInstanceId, {
            name: instance.name,
            description: `${gameName || gameKey} 服务器实例`,
            workingDirectory: installPath,
            startCommand: resolvedStartCommand,
            autoStart: instance.autoStart,
            stopCommand: instance.stopCommand,
            enableStreamForward: instance.enableStreamForward,
            programPath: instance.programPath,
            terminalUser: instance.terminalUser,
            instanceType: instance.instanceType,
            javaVersion: instance.javaVersion,
            steam: {
              appId: normalizedAppId,
              gameKey,
              branch: selectedBranch
            }
          }, installOperationToken)
          
          // 重新获取更新后的实例
          instance = instanceManager.getInstance(existingInstanceId)
          
          logger.info(`实例信息已更新: ${instanceName}`, {
            instanceId: existingInstanceId,
            startCommand: resolvedStartCommand,
            workingDirectory: installPath
          })
        }
        
        logger.info(`使用现有实例进行游戏更新: ${instanceName}`, {
          instanceId: existingInstanceId,
          installPath
        })
      } else {
        // 创建新实例
        // 查询实例市场获取启动命令
        let startCommand = 'none'
        try {
          // 确定系统类型
          const platform = getCurrentPlatform()
          let systemType = 'Linux'
          if (platform === Platform.Windows) {
            systemType = 'Windows'
          }
          
          // 请求实例市场数据
          const marketUrl = `http://api.gsm.xiaozhuhouses.asia:10002/api/instances?system_type=${systemType}`
          
          const marketData = await new Promise<any>((resolve, reject) => {
            const url = new URL(marketUrl)
            const options = {
              hostname: url.hostname,
              port: url.port,
              path: url.pathname + url.search,
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'GSM3-Server/1.0'
              }
            }
            
            const req = http.request(options, (response: any) => {
              let data = ''
              
              response.on('data', (chunk: any) => {
                data += chunk
              })
              
              response.on('end', () => {
                try {
                  if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                    const jsonData = JSON.parse(data)
                    resolve(jsonData)
                  } else {
                    reject(new Error(`HTTP error! status: ${response.statusCode}`))
                  }
                } catch (parseError) {
                  reject(new Error(`JSON parse error: ${parseError}`))
                }
              })
            })
            
            req.on('error', (error: any) => {
              reject(error)
            })
            
            req.setTimeout(5000, () => {
              req.destroy()
              reject(new Error('Request timeout'))
            })
            
            req.end()
          })
          
          // 在实例市场中查找匹配的游戏
          if (marketData && marketData.instances && Array.isArray(marketData.instances)) {
            const gameNameToMatch = gameName || gameKey
            const matchedInstance = marketData.instances.find((instance: any) => {
              // 尝试多种匹配方式
              return instance.name && (
                instance.name.toLowerCase().includes(gameNameToMatch.toLowerCase()) ||
                gameNameToMatch.toLowerCase().includes(instance.name.toLowerCase())
              )
            })
            
            if (matchedInstance && matchedInstance.command) {
              startCommand = matchedInstance.command
              logger.info(`从实例市场找到匹配的启动命令: ${gameNameToMatch} -> ${startCommand}`)
            } else {
              logger.info(`实例市场中未找到匹配的游戏: ${gameNameToMatch}，尝试使用本地清单启动命令`)
            }
          }
        } catch (error: any) {
          logger.warn('查询实例市场失败，尝试使用本地清单启动命令:', error.message)
        }

        if (startCommand === 'none') {
          const localStartCommand = await getLocalStartCommandForGame(gameKey)
          if (localStartCommand) {
            startCommand = localStartCommand
            logger.info(`使用本地清单启动命令: ${gameKey} -> ${startCommand}`)
          }
        }
        
        // 创建实例（在安装开始时就创建，而不是等安装完成）
        const instanceData = {
          name: instanceName,
          description: `${gameName || gameKey} 服务器实例`,
          workingDirectory: installPath,
          startCommand: appendLaunchArguments(startCommand, userLaunchArguments),
          autoStart: false,
          stopCommand: 'ctrl+c' as const,
          enableStreamForward: false,
          programPath: '',
          steam: {
            appId: normalizedAppId,
            gameKey,
            branch: selectedBranch
          }
        }
        
        instance = await instanceManager.createInstance(instanceData, {
          token: installOperationToken,
          reason: 'Steam 服务端安装或更新'
        })
        installOperationLock = {
          instanceId: instance.id,
          token: installOperationToken
        }
      }

      // 在所有实例校验和配置写入成功后才启动SteamCMD，避免失败请求继续修改服务端文件。
      installRunScript = await createSteamCMDRunScript(steamcmdCommands, {
        allowPasswordPrompt: !shouldUseAnonymous && !requestedSteamPassword,
        maxLifetimeMs: 24 * 60 * 60 * 1000
      })
      const activeRunScript = installRunScript
      await prepareSteamCMDLaunch(steamcmdPath)
      const currentUser = process.env.USER || process.env.USERNAME || 'unknown'
      const steamArguments = [
        '-logdir', activeRunScript.logDirectory,
        '+runscript', activeRunScript.filePath
      ]
      const steamCommand = platform !== Platform.Windows && currentUser !== 'root'
        ? ['sudo', '-u', 'root', steamcmdPath, ...steamArguments]
        : [steamcmdPath, ...steamArguments]

      await terminalManager.createPty(virtualSocket, {
        sessionId: terminalSessionId,
        cols: 80,
        rows: 24,
        workingDirectory: steamcmdDir
      }, {
        command: steamCommand,
        redactValues: [requestedSteamPassword, selectedBetaPassword].filter(Boolean),
        onExit: (code, signal) => {
          logger.info('SteamCMD安装会话已结束', {
            terminalSessionId,
            instanceId: installOperationLock?.instanceId,
            code,
            signal
          })
          installRunScript = null
          void activeRunScript.cleanup().catch(error => {
            logger.warn('清理SteamCMD安装脚本失败', error)
          })
          releaseInstallOperationLock()
        }
      })
      await new Promise(resolve => setTimeout(resolve, 1000))
      if (!terminalManager.hasSession(terminalSessionId)) {
        throw new Error('SteamCMD终端会话未能启动')
      }
      installProcessStarted = true
      
      logger.info(`游戏安装已开始: ${gameName || gameKey}`, {
        terminalSessionId,
        instanceId: instance.id,
        installPath
      })
      
      // 返回成功响应和终端会话ID
      res.json({
        success: true,
        message: `${gameName || gameKey} 安装已开始`,
        data: {
          terminalSessionId,
          instance,
          installPath
        }
      })
      
    } catch (error: any) {
      logger.error('创建游戏安装会话失败:', error)
      res.status(500).json({
        success: false,
        error: '创建安装会话失败',
        message: error.message
      })
    }
    
  } catch (error: any) {
    logger.error('游戏安装请求处理失败:', error)
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: '游戏安装请求处理失败',
        message: error.message
      })
    }
  } finally {
    if (!installProcessStarted) {
      if (installRunScript) {
        await installRunScript.cleanup().catch(error => {
          logger.warn('清理SteamCMD安装脚本失败', error)
        })
        installRunScript = null
      }
      releaseInstallOperationLock()
    }
  }
})

// 更新Steam游戏部署清单
router.post('/update-game-list', authenticateToken, async (req: Request, res: Response) => {
  try {
    const remoteUrl = 'http://api.gsm.xiaozhuhouses.asia:8082/disk1/GSM3/installgame.json'
    const gamesFilePath = path.join(__dirname, '../data/games/installgame.json')
    
    logger.info('开始更新Steam游戏部署清单', { remoteUrl, localPath: gamesFilePath })
    
    // 确保目录存在
    const gamesDir = path.dirname(gamesFilePath)
    try {
      await fs.access(gamesDir)
    } catch {
      await fs.mkdir(gamesDir, { recursive: true })
      logger.info('创建games目录:', gamesDir)
    }
    
    // 备份现有文件（如果存在）
    let backupCreated = false
    try {
      await fs.access(gamesFilePath)
      const backupPath = `${gamesFilePath}.backup.${Date.now()}`
      await fs.copyFile(gamesFilePath, backupPath)
      backupCreated = true
      logger.info('已备份现有文件:', backupPath)
    } catch {
      logger.info('没有现有文件需要备份')
    }
    
    try {
      // 从远程URL下载最新的游戏清单
      const response = await axios.get(remoteUrl, {
        timeout: 30000, // 30秒超时
        headers: {
          'User-Agent': 'GSManager3/1.0'
        }
      })
      
      // 验证响应数据格式
      if (typeof response.data !== 'object' || response.data === null) {
        throw new Error('远程数据格式无效：不是有效的JSON对象')
      }
      
      // 简单验证数据结构（检查是否包含游戏信息的基本字段）
      const gameKeys = Object.keys(response.data)
      if (gameKeys.length === 0) {
        throw new Error('远程数据为空')
      }
      
      // 检查第一个游戏是否有必要的字段
      const firstGame = response.data[gameKeys[0]]
      if (!firstGame || typeof firstGame !== 'object' || !firstGame.game_nameCN || !firstGame.appid) {
        throw new Error('远程数据格式无效：缺少必要的游戏信息字段')
      }
      
      // 将数据写入本地文件
      await fs.writeFile(gamesFilePath, JSON.stringify(response.data, null, 2), 'utf-8')
      
      logger.info('Steam游戏部署清单更新成功', {
        gameCount: gameKeys.length,
        fileSize: JSON.stringify(response.data).length
      })
      
      res.json({
        success: true,
        message: '游戏部署清单更新成功',
        data: {
          gameCount: gameKeys.length,
          updateTime: new Date().toISOString(),
          backupCreated
        }
      })
      
    } catch (downloadError: any) {
      logger.error('下载游戏清单失败:', downloadError)
      
      // 如果下载失败且创建了备份，恢复备份文件
      if (backupCreated) {
        try {
          const backupFiles = await fs.readdir(gamesDir)
          const latestBackup = backupFiles
            .filter(file => file.startsWith('installgame.json.backup.'))
            .sort()
            .pop()
          
          if (latestBackup) {
            const backupPath = path.join(gamesDir, latestBackup)
            await fs.copyFile(backupPath, gamesFilePath)
            logger.info('已恢复备份文件')
          }
        } catch (restoreError) {
          logger.error('恢复备份文件失败:', restoreError)
        }
      }
      
      res.status(500).json({
        success: false,
        error: '更新游戏部署清单失败',
        message: downloadError.message || '网络请求失败'
      })
    }
    
  } catch (error: any) {
    logger.error('更新游戏部署清单请求处理失败:', error)
    res.status(500).json({
      success: false,
      error: '更新游戏部署清单失败',
      message: error.message
    })
  }
})

// 扫描Minecraft目录中的启动文件
router.post('/scan-minecraft-directory', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { directory } = req.body
    
    if (!directory) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数',
        message: '目录路径为必填项'
      })
    }
    
    logger.info(`扫描Minecraft目录: ${directory}`)
    
    try {
      // 检查目录是否存在
      await fs.access(directory)
    } catch {
      return res.status(400).json({
        success: false,
        error: '目录不存在',
        message: `指定的目录不存在: ${directory}`
      })
    }
    
    try {
      const files = await fs.readdir(directory)
      const platform = getCurrentPlatform()
      const isWindows = platform === Platform.Windows
      
      // 查找.jar文件
      const jarFiles = files.filter(file => file.toLowerCase().endsWith('.jar'))
      
      // 查找启动脚本
      const batFiles = files.filter(file => file.toLowerCase().endsWith('.bat'))
      const shFiles = files.filter(file => file.toLowerCase().endsWith('.sh'))
      
      logger.info(`找到文件: jar=${jarFiles.length}, bat=${batFiles.length}, sh=${shFiles.length}`)
      
      // 确定推荐的启动方式
      let recommendedStartCommand = ''
      let startMethod = 'none'
      
      // 优先使用对应平台的启动脚本
      if (isWindows && batFiles.length > 0) {
        // Windows平台优先使用.bat脚本
        // 优先选择run.bat，否则使用第一个找到的.bat文件
        const runBat = batFiles.find(f => f.toLowerCase() === 'run.bat')
        const scriptFile = runBat || batFiles[0]
        recommendedStartCommand = `.\\${scriptFile}`  // 添加 .\ 路径前缀
        startMethod = 'bat_script'
        logger.info(`[智能检测] 推荐使用BAT脚本: ${recommendedStartCommand}`)
      } else if (!isWindows && shFiles.length > 0) {
        // Linux/Mac平台优先使用.sh脚本
        // 优先选择run.sh，否则使用第一个找到的.sh文件
        const runSh = shFiles.find(f => f.toLowerCase() === 'run.sh')
        const scriptFile = runSh || shFiles[0]
        // 使用 bash 命令执行，与云构建保持一致
        recommendedStartCommand = `bash ${scriptFile}`
        startMethod = 'sh_script'
        logger.info(`[智能检测] 推荐使用SH脚本: ${recommendedStartCommand}`)
      } else if (jarFiles.length > 0) {
        // 如果没有对应平台的脚本，使用jar文件
        // 优先选择server.jar，否则使用第一个找到的jar文件
        const serverJar = jarFiles.find(f => f.toLowerCase() === 'server.jar')
        const jarFile = serverJar || jarFiles[0]
        recommendedStartCommand = `java -jar ${jarFile}`
        startMethod = 'jar_file'
        logger.info(`[智能检测] 推荐使用JAR文件: ${jarFile}, 完整命令: ${recommendedStartCommand}`)
      } else {
        logger.warn(`[智能检测] 未找到任何启动文件 (jar/bat/sh)`)
      }

      logger.info(`[智能检测] 平台: ${platform}, isWindows: ${isWindows}, 推荐命令: ${recommendedStartCommand}`)

      res.json({
        success: true,
        data: {
          jarFiles,
          batFiles,
          shFiles,
          recommendedStartCommand,
          startMethod,
          platform
        }
      })
      
    } catch (error: any) {
      logger.error('读取目录文件失败:', error)
      res.status(500).json({
        success: false,
        error: '读取目录失败',
        message: error.message
      })
    }
    
  } catch (error: any) {
    logger.error('扫描Minecraft目录失败:', error)
    res.status(500).json({
      success: false,
      error: '扫描目录失败',
      message: error.message
    })
  }
})

export default router
