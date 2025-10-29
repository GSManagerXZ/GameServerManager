import { Router, Request, Response } from 'express'
import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import axios from 'axios'
import http from 'http'
import { fileURLToPath } from 'url'
import { TerminalManager } from '../modules/terminal/TerminalManager.js'
import { InstanceManager } from '../modules/instance/InstanceManager.js'
import { SteamCMDManager } from '../modules/steamcmd/SteamCMDManager.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'
import logger from '../utils/logger.js'
import { authenticateToken } from '../middleware/auth.js'

// 平台枚举
enum Platform {
  Windows = 'Windows',
  Linux = 'Linux',
  MacOS = 'MacOS'
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()

// 管理器实例
let terminalManager: TerminalManager
let instanceManager: InstanceManager
let steamcmdManager: SteamCMDManager
let configManager: ConfigManager

// 设置管理器实例
export function setGameDeploymentManagers(
  terminal: TerminalManager,
  instance: InstanceManager,
  steamcmd: SteamCMDManager,
  config: ConfigManager
) {
  terminalManager = terminal
  instanceManager = instance
  steamcmdManager = steamcmd
  configManager = config
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
        const remoteUrl = 'http://gsm.server.xiaozhuhouses.asia:8082/disk1/GSM3/installgame.json'
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

// 安装游戏
router.post('/install', authenticateToken, async (req: Request, res: Response) => {
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
      steamcmdCommand,
      existingInstanceId,
      updateInstanceInfo,
      resetSteamManifest
    } = req.body
    
    if (!gameKey || !installPath || !instanceName || !steamcmdCommand) {
      return res.status(400).json({
        success: false,
        error: '缺少必填参数',
        message: '游戏标识、安装路径、实例名称和SteamCMD命令为必填项'
      })
    }
    
    if (!useAnonymous && (!steamUsername || !steamPassword)) {
      return res.status(400).json({
        success: false,
        error: '缺少Steam账户信息',
        message: '非匿名模式下需要提供Steam用户名和密码'
      })
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
      appId,
      command: steamcmdCommand,
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
      
      // 创建虚拟socket用于终端会话
      const virtualSocket = {
        id: `install-${Date.now()}`,
        emit: () => {},
        on: () => {},
        disconnect: () => {}
      } as any
      
      // 生成终端会话ID
      const terminalSessionId = `install-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      // 创建终端会话并执行安装命令
      terminalManager.createPty(virtualSocket, {
        sessionId: terminalSessionId,
        cols: 80,
        rows: 24,
        workingDirectory: steamcmdDir
      })
      
      // 等待终端完全初始化
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 根据操作系统构建SteamCMD执行命令
      const platform = os.platform()
      let steamcmdExecutable: string
      let fullCommand: string
      
      if (platform === 'win32') {
        steamcmdExecutable = '.\\steamcmd.exe'
        fullCommand = `${steamcmdExecutable} ${steamcmdCommand}`
      } else {
        // Linux环境下确保使用root用户权限执行SteamCMD
        steamcmdExecutable = './steamcmd.sh'
        // 检查当前用户是否为root，如果不是则使用sudo
        const currentUser = process.env.USER || process.env.USERNAME || 'unknown'
        if (currentUser === 'root') {
          fullCommand = `${steamcmdExecutable} ${steamcmdCommand}`
        } else {
          fullCommand = `sudo -u root ${steamcmdExecutable} ${steamcmdCommand}`
        }
      }
      
      logger.info(`执行SteamCMD命令: ${fullCommand}`, {
        platform,
        workingDirectory: steamcmdDir
      })
      
      // 发送安装命令到终端
      terminalManager.handleInput(virtualSocket, {
        sessionId: terminalSessionId,
        data: fullCommand + '\r'
      })
      
      // 处理实例：更新或创建
      let instance: any
      
      if (existingInstanceId) {
        // 如果存在实例ID，使用现有实例
        const existingInstance = instanceManager.getInstance(existingInstanceId)
        if (!existingInstance) {
          return res.status(404).json({
            success: false,
            error: '实例不存在',
            message: `未找到ID为 ${existingInstanceId} 的实例`
          })
        }
        
        instance = existingInstance
        
        // 如果需要更新实例信息
        if (updateInstanceInfo) {
          // 查询实例市场获取启动命令
          let startCommand = 'none'
          try {
            // 确定系统类型
            const platform = os.platform()
            let systemType = 'Linux'
            if (platform === 'win32') {
              systemType = 'Windows'
            }
            
            // 请求实例市场数据
            const marketUrl = `http://gsm.server.xiaozhuhouses.asia:10002/api/instances?system_type=${systemType}`
            
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
                logger.info(`实例市场中未找到匹配的游戏: ${gameNameToMatch}，使用默认启动命令`)
              }
            }
          } catch (error: any) {
            logger.warn('查询实例市场失败，使用默认启动命令:', error.message)
          }
          
          // 更新实例信息
          await instanceManager.updateInstance(existingInstanceId, {
            name: instance.name,
            description: `${gameName || gameKey} 服务器实例`,
            workingDirectory: installPath,
            startCommand,
            autoStart: instance.autoStart,
            stopCommand: 'ctrl+c' as 'ctrl+c' | 'stop' | 'exit' | 'quit'
          })
          
          // 重新获取更新后的实例
          instance = instanceManager.getInstance(existingInstanceId)
          
          logger.info(`实例信息已更新: ${instanceName}`, {
            instanceId: existingInstanceId,
            startCommand,
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
          const platform = os.platform()
          let systemType = 'Linux'
          if (platform === 'win32') {
            systemType = 'Windows'
          }
          
          // 请求实例市场数据
          const marketUrl = `http://gsm.server.xiaozhuhouses.asia:10002/api/instances?system_type=${systemType}`
          
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
              logger.info(`实例市场中未找到匹配的游戏: ${gameNameToMatch}，使用默认启动命令`)
            }
          }
        } catch (error: any) {
          logger.warn('查询实例市场失败，使用默认启动命令:', error.message)
        }
        
        // 创建实例（在安装开始时就创建，而不是等安装完成）
        const instanceData = {
          name: instanceName,
          description: `${gameName || gameKey} 服务器实例`,
          workingDirectory: installPath,
          startCommand,
          autoStart: false,
          stopCommand: 'ctrl+c' as 'ctrl+c' | 'stop' | 'exit' | 'quit'
        }
        
        instance = await instanceManager.createInstance(instanceData)
      }
      
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
  }
})

// 更新Steam游戏部署清单
router.post('/update-game-list', authenticateToken, async (req: Request, res: Response) => {
  try {
    const remoteUrl = 'http://gsm.server.xiaozhuhouses.asia:8082/disk1/GSM3/installgame.json'
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
      const platform = os.platform()
      const isWindows = platform === 'win32'
      
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
        recommendedStartCommand = scriptFile
        startMethod = 'bat_script'
        logger.info(`[智能检测] 推荐使用BAT脚本: ${scriptFile}`)
      } else if (!isWindows && shFiles.length > 0) {
        // Linux/Mac平台优先使用.sh脚本
        // 优先选择run.sh，否则使用第一个找到的.sh文件
        const runSh = shFiles.find(f => f.toLowerCase() === 'run.sh')
        const scriptFile = runSh || shFiles[0]
        recommendedStartCommand = `./${scriptFile}`
        startMethod = 'sh_script'
        logger.info(`[智能检测] 推荐使用SH脚本: ${scriptFile}`)
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
      
      res.json({
        success: true,
        data: {
          jarFiles,
          batFiles,
          shFiles,
          recommendedStartCommand,
          startMethod,
          platform: isWindows ? 'Windows' : (platform === 'darwin' ? 'MacOS' : 'Linux')
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