import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { ConfigManager } from '../modules/config/ConfigManager.js'
import logger from '../utils/logger.js'
import { Server as SocketIOServer } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import * as tar from 'tar'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { zipToolsManager } from '../utils/zipToolsManager.js'
import { createTarSecurityFilter } from '../utils/tarSecurityFilter.js'
import { getSponsorKey } from '../utils/sponsorStatus.js'
import { createSponsorDownloadSession, isSponsorDownloadUrl } from '../utils/sponsorDownload.js'
import {
  fetchOneClickDeployManifest,
  findOneClickDeployGame,
  getArchiveSuffix,
  getOneClickDeployPlatform,
  isOneClickDeployGameSupported,
  resolveOneClickDeployDownload,
  toPublicGames,
  type OneClickDeployChannel
} from '../utils/oneClickDeploySource.js'

/**
 * 一键开服（原「在线部署」）。
 *
 * 功能对所有人开放，游戏清单来自云端静态 JSON（见 utils/oneClickDeploySource.ts），
 * 仅在下载环节区分通道：本地记录赞助者密钥时优先走赞助者专用通道，失败自动回退普通通道。
 * 接口路径保留 /api/online-deploy，避免已有前端构建与插件失效。
 */
const router = Router()
let io: SocketIOServer
let configManager: ConfigManager

// 设置依赖
export function setOnlineDeployDependencies(socketIO: SocketIOServer, config: ConfigManager) {
  io = socketIO
  configManager = config
}

interface OneClickDeploymentTask {
  id: string
  gameId: string
  installPath: string
  status: 'running' | 'cancelled' | 'completed' | 'failed'
  startTime: Date
  archivePath?: string
  abortController: AbortController
}

// 活动部署映射
const activeDeployments = new Map<string, OneClickDeploymentTask>()

// 下载进度区间：下载占总进度的 20% - 70%
const DOWNLOAD_PROGRESS_START = 20
const DOWNLOAD_PROGRESS_SPAN = 50

// 判断是否为强制刷新
function isForceRefresh(value: unknown): boolean {
  return ['1', 'true', 'yes'].includes(String(value ?? '').toLowerCase())
}

// 发送部署日志
function emitLog(socketId: string | undefined, deploymentId: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  if (!io || !socketId) return

  io.to(socketId).emit('online-deploy-log', {
    deploymentId,
    message,
    type,
    timestamp: new Date().toISOString()
  })
}

// 发送部署进度
function emitProgress(socketId: string | undefined, deploymentId: string, percentage: number, currentStep: string) {
  if (!io || !socketId) return

  io.to(socketId).emit('online-deploy-progress', {
    deploymentId,
    percentage,
    currentStep
  })
}

// 发送部署完成事件
function emitComplete(socketId: string | undefined, deploymentId: string, payload: Record<string, unknown>) {
  if (!io || !socketId) return

  io.to(socketId).emit('online-deploy-complete', {
    deploymentId,
    ...payload
  })
}

// 按压缩包后缀解压，格式与「文件部署」保持一致
async function extractArchive(archivePath: string, targetPath: string): Promise<void> {
  const suffix = getArchiveSuffix(archivePath)
  if (!suffix) {
    throw new Error(`不支持的压缩包格式: ${path.basename(archivePath)}`)
  }

  if (suffix === '.zip') {
    await zipToolsManager.extractZip(archivePath, targetPath)
    return
  }

  if (suffix === '.7z') {
    await zipToolsManager.extract7z(archivePath, targetPath)
    return
  }

  if (suffix === '.tar' || suffix === '.tar.gz' || suffix === '.tgz') {
    await tar.extract({
      file: archivePath,
      cwd: targetPath,
      gzip: suffix !== '.tar',
      filter: createTarSecurityFilter({ cwd: targetPath })
    } as any)
    return
  }

  // tar.xz / txz：先用 7z 解出内层 tar，再按 tar 安全过滤解压
  const xzTempPath = `${archivePath}-xz`
  await fs.mkdir(xzTempPath, { recursive: true })
  try {
    await zipToolsManager.extract7z(archivePath, xzTempPath)
    const tarFiles = (await fs.readdir(xzTempPath)).filter(file => file.toLowerCase().endsWith('.tar'))
    if (tarFiles.length !== 1) {
      throw new Error('TAR.XZ 解压后未找到唯一的 TAR 归档')
    }

    await tar.extract({
      file: path.join(xzTempPath, tarFiles[0]),
      cwd: targetPath,
      filter: createTarSecurityFilter({ cwd: targetPath })
    } as any)
  } finally {
    await fs.rm(xzTempPath, { recursive: true, force: true }).catch(() => {})
  }
}

// 下载压缩包，返回实际落盘路径
async function downloadArchive(options: {
  url: string
  fileName: string
  installPath: string
  headers?: Record<string, string>
  task: OneClickDeploymentTask
  socketId?: string
  gameName: string
}): Promise<string> {
  const { url, fileName, installPath, headers, task, socketId, gameName } = options

  emitLog(socketId, task.id, `正在下载 ${gameName}...`)

  const downloadPath = path.join(installPath, fileName)
  let writer: ReturnType<typeof createWriteStream> | undefined

  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 0,
      maxRedirects: 10,
      headers,
      signal: task.abortController.signal
    })

    const totalSize = Number.parseInt(String(response.headers['content-length'] || '0'), 10) || 0
    let downloadedSize = 0

    writer = createWriteStream(downloadPath)

    response.data.on('data', (chunk: Buffer) => {
      downloadedSize += chunk.length
      const percentage = totalSize > 0
        ? DOWNLOAD_PROGRESS_START + Math.round((downloadedSize / totalSize) * DOWNLOAD_PROGRESS_SPAN)
        : DOWNLOAD_PROGRESS_START + 10

      emitProgress(
        socketId,
        task.id,
        percentage,
        `下载中... ${Math.round(downloadedSize / 1024 / 1024)}MB${totalSize > 0 ? `/${Math.round(totalSize / 1024 / 1024)}MB` : ''}`
      )
    })

    await pipeline(response.data, writer)
  } catch (error) {
    // 下载失败时清掉半成品文件，避免回退通道或重试时残留脏数据
    writer?.destroy()
    await fs.rm(downloadPath, { force: true }).catch(() => {})
    throw error
  }

  task.archivePath = downloadPath

  return downloadPath
}

// 执行一次一键开服部署（在后台异步进行，通过 WebSocket 推送进度）
async function runOneClickDeployment(task: OneClickDeploymentTask, socketId?: string) {
  const { id: deploymentId, gameId, installPath, abortController } = task
  let gameName = gameId
  let archivePath: string | undefined

  try {
    const isCancelled = () => task.status === 'cancelled' || abortController.signal.aborted

    emitLog(socketId, deploymentId, '正在获取游戏下载信息...')
    emitProgress(socketId, deploymentId, 5, '获取下载信息')

    const { manifest } = await fetchOneClickDeployManifest()
    const platform = getOneClickDeployPlatform()
    const game = findOneClickDeployGame(manifest, gameId)

    if (!game) {
      throw new Error('云端清单中未找到该游戏，请刷新列表后重试')
    }

    gameName = game.name

    if (!isOneClickDeployGameSupported(game, platform)) {
      throw new Error(`${game.name} 暂不支持当前系统平台`)
    }

    if (isCancelled()) return

    // 赞助者与非赞助者共用同一个下载地址，区别只在是否携带赞助者会话 Cookie
    const sponsorKey = getSponsorKey(configManager)
    const resolution = resolveOneClickDeployDownload(game, platform)
    let downloadHeaders: Record<string, string> | undefined
    let usedChannel: OneClickDeployChannel = 'normal'

    if (sponsorKey && isSponsorDownloadUrl(resolution.url)) {
      try {
        const session = await createSponsorDownloadSession(sponsorKey)
        downloadHeaders = { Cookie: session.cookie }
        usedChannel = 'sponsor'
        logger.info(`一键开服检测到本地赞助者密钥，本次下载使用赞助者专用节点: ${resolution.url}`)
      } catch (error) {
        logger.warn(`一键开服赞助者专用通道不可用，改用普通下载: ${error instanceof Error ? error.message : '未知错误'}`)
      }
    } else if (sponsorKey) {
      logger.info('一键开服下载地址不在赞助者下载服务域名下，本次使用普通下载')
    }

    emitLog(
      socketId,
      deploymentId,
      usedChannel === 'sponsor' ? '下载通道: 赞助者专用通道' : '下载通道: 普通下载通道'
    )
    emitProgress(socketId, deploymentId, 15, '验证安装路径')

    // 确保安装目录存在
    await fs.mkdir(installPath, { recursive: true })

    if (isCancelled()) return

    try {
      archivePath = await downloadArchive({
        url: resolution.url,
        fileName: resolution.fileName,
        installPath,
        headers: downloadHeaders,
        task,
        socketId,
        gameName
      })
    } catch (error) {
      // 赞助者会话失效等原因导致下载失败时，去掉 Cookie 再试一次
      if (isCancelled() || !downloadHeaders) {
        throw error
      }

      logger.warn(`一键开服赞助者通道下载失败，改用普通下载重试: ${error instanceof Error ? error.message : '未知错误'}`)
      emitLog(socketId, deploymentId, '赞助者通道下载失败，正在改用普通下载重试...', 'warning')

      archivePath = await downloadArchive({
        url: resolution.url,
        fileName: resolution.fileName,
        installPath,
        task,
        socketId,
        gameName
      })

      usedChannel = 'normal'
    }

    if (isCancelled()) {
      await fs.rm(archivePath, { force: true }).catch(() => {})
      return
    }

    emitLog(socketId, deploymentId, `正在解压 ${resolution.fileName}...`)
    emitProgress(socketId, deploymentId, 75, '解压文件')

    await extractArchive(archivePath, installPath)
    await fs.rm(archivePath, { force: true }).catch(() => {})
    task.archivePath = undefined

    if (isCancelled()) return

    emitLog(socketId, deploymentId, '开服文件准备完成！', 'success')
    emitProgress(socketId, deploymentId, 100, '开服完成')

    task.status = 'completed'
    emitComplete(socketId, deploymentId, {
      success: true,
      result: {
        installPath,
        gameId,
        gameName,
        channel: usedChannel,
        message: `${gameName} 一键开服完成！`
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'

    if (task.status === 'cancelled' || abortController.signal.aborted) {
      emitLog(socketId, deploymentId, '开服任务已取消', 'warning')
      const pendingArchive = archivePath || task.archivePath
      if (pendingArchive) {
        await fs.rm(pendingArchive, { force: true }).catch(() => {})
      }
      return
    }

    logger.error('一键开服失败:', error)
    task.status = 'failed'
    emitLog(socketId, deploymentId, `开服失败: ${message}`, 'error')
    emitComplete(socketId, deploymentId, { success: false, error: message })
  } finally {
    // 清理任务记录
    setTimeout(() => {
      activeDeployments.delete(deploymentId)
    }, 300000) // 5 分钟后清理
  }
}

// 获取一键开服游戏列表
router.get('/games', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { manifest, meta } = await fetchOneClickDeployManifest({
      forceRefresh: isForceRefresh(req.query.refresh)
    })

    const platform = getOneClickDeployPlatform()
    const publicGames = toPublicGames(manifest, platform)
    const supportedGames = publicGames.filter(game => game.supportedPlatforms.includes(platform))
    const sponsorKey = getSponsorKey(configManager)

    logger.info(`一键开服清单就绪，共 ${supportedGames.length} 个可用游戏（来源: ${meta.origin}）`)

    res.json({
      success: true,
      data: supportedGames.map(game => ({
        ...game,
        supported: true,
        currentPlatform: platform
      })),
      meta: {
        url: meta.url,
        schemaVersion: meta.schemaVersion,
        updatedAt: meta.updatedAt,
        notice: meta.notice,
        fetchedAt: meta.fetchedAt,
        origin: meta.origin,
        platform,
        // 清单已成功拉到但没有任何游戏，前端展示「云端暂无游戏」而不是报错
        empty: supportedGames.length === 0,
        // 清单总数（未按平台过滤），便于区分「云端没配置」和「当前平台不支持」
        totalGames: manifest.games.length,
        // 格式无效被忽略的记录，用于提示清单作者
        invalidGames: meta.invalidGames,
        // 本地是否记录赞助者密钥，用于前端展示下载通道状态
        sponsorChannelAvailable: sponsorKey !== null,
        sponsorChannelGames: supportedGames.filter(game => game.hasSponsorChannel).length
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('获取一键开服列表失败:', error)
    res.status(502).json({
      success: false,
      message: `获取一键开服列表失败：${message}`
    })
  }
})

// 开始一键开服
router.post('/deploy', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId, installPath, socketId } = req.body
    const normalizedInstallPath = typeof installPath === 'string' ? installPath.trim() : ''

    if (!gameId || !normalizedInstallPath) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    const deploymentId = uuidv4()
    const task: OneClickDeploymentTask = {
      id: deploymentId,
      gameId: String(gameId),
      installPath: normalizedInstallPath,
      status: 'running',
      startTime: new Date(),
      abortController: new AbortController()
    }

    activeDeployments.set(deploymentId, task)

    res.json({
      success: true,
      data: { deploymentId },
      message: '一键开服任务已开始'
    })

    // 异步执行部署，进度通过 WebSocket 推送
    setImmediate(() => {
      void runOneClickDeployment(task, typeof socketId === 'string' ? socketId : undefined)
    })
  } catch (error) {
    logger.error('启动一键开服失败:', error)
    res.status(500).json({
      success: false,
      message: '启动一键开服失败'
    })
  }
})

// 取消一键开服
router.post('/cancel/:deploymentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deploymentId } = req.params

    const deployment = activeDeployments.get(deploymentId)
    if (!deployment) {
      return res.status(404).json({
        success: false,
        message: '开服任务不存在'
      })
    }

    deployment.status = 'cancelled'
    deployment.abortController.abort()

    // 取消事件采用广播，兼容未携带 socketId 的请求
    if (io) {
      io.emit('online-deploy-log', {
        deploymentId,
        message: '开服任务已被用户取消',
        type: 'warning',
        timestamp: new Date().toISOString()
      })
      io.emit('online-deploy-complete', {
        deploymentId,
        success: false,
        error: '开服任务已取消'
      })
    }

    setTimeout(() => {
      activeDeployments.delete(deploymentId)
    }, 5000)

    res.json({
      success: true,
      message: '开服任务已取消'
    })
  } catch (error) {
    logger.error('取消一键开服失败:', error)
    res.status(500).json({
      success: false,
      message: '取消一键开服失败'
    })
  }
})

// 获取活动开服任务列表
router.get('/deployments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const deployments = Array.from(activeDeployments.values()).map(task => ({
      id: task.id,
      gameId: task.gameId,
      installPath: task.installPath,
      status: task.status,
      startTime: task.startTime
    }))

    res.json({
      success: true,
      data: deployments
    })
  } catch (error) {
    logger.error('获取开服任务列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取开服任务列表失败'
    })
  }
})

// 手动清空云端清单缓存（供设置页或调试使用）
router.post('/refresh', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { manifest, meta } = await fetchOneClickDeployManifest({ forceRefresh: true })

    res.json({
      success: true,
      data: { total: manifest.games.length },
      meta: {
        url: meta.url,
        updatedAt: meta.updatedAt,
        fetchedAt: meta.fetchedAt,
        origin: meta.origin
      },
      message: `一键开服清单已更新，共 ${manifest.games.length} 个游戏`
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('刷新一键开服清单失败:', error)
    res.status(502).json({
      success: false,
      message: `刷新一键开服清单失败：${message}`
    })
  }
})

export default router