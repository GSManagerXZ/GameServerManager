import { Router, Request, Response } from 'express'
import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import * as tar from 'tar'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { Server as SocketIOServer } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import { authenticateToken } from '../middleware/auth.js'
import type { ConfigManager } from '../modules/config/ConfigManager.js'
import type { Instance, InstanceManager, InstanceType } from '../modules/instance/InstanceManager.js'
import { createTarSecurityFilter } from '../utils/tarSecurityFilter.js'
import { zipToolsManager } from '../utils/zipToolsManager.js'
import logger from '../utils/logger.js'

const router = Router()

const SUPPORTED_ARCHIVE_SUFFIXES = ['.tar.gz', '.tar.xz', '.tgz', '.txz', '.zip', '.7z', '.tar'] as const
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const VALID_INSTANCE_TYPES = new Set<InstanceType>(['generic', 'minecraft-java', 'minecraft-bedrock'])

type SourceType = 'upload' | 'url'
type DirectoryStrategy = 'merge' | 'clean'
type InstanceStrategy = 'create' | 'update'

interface UploadSession {
  id: string
  fileName: string
  directory: string
  createdAt: number
}

interface ActiveDeployment {
  id: string
  socketId?: string
  status: 'running' | 'cancelled'
  abortController: AbortController
  stagingPath?: string
}

let io: SocketIOServer
let configManager: ConfigManager
let instanceManager: InstanceManager
const uploadSessions = new Map<string, UploadSession>()
const activeDeployments = new Map<string, ActiveDeployment>()

export function setFileDeployDependencies(
  socketIO: SocketIOServer,
  config: ConfigManager,
  instances: InstanceManager
) {
  io = socketIO
  configManager = config
  instanceManager = instances
  void cleanupExpiredTempDirectories()
}

function getTempRoot(): string {
  const baseDir = process.cwd()
  const possiblePaths = [
    path.join(baseDir, 'server', 'data', 'file-deploy', 'temp'),
    path.join(baseDir, 'data', 'file-deploy', 'temp')
  ]
  const existingParent = possiblePaths.find(candidate => fs.existsSync(path.dirname(candidate)))
  return existingParent || possiblePaths[0]
}

async function cleanupExpiredTempDirectories(): Promise<void> {
  const tempRoot = getTempRoot()
  await fs.ensureDir(tempRoot)
  const entries = await fs.readdir(tempRoot, { withFileTypes: true })
  const now = Date.now()

  await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const targetPath = path.join(tempRoot, entry.name)
    const stats = await fs.stat(targetPath).catch(() => null)
    if (stats && now - stats.mtimeMs > SESSION_TTL_MS) {
      await fs.remove(targetPath).catch(() => {})
    }
  }))
}

function normalizeGameName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('游戏名称为必填项')
  }

  const gameName = value.trim()
  if (!gameName) {
    throw new Error('游戏名称不能为空')
  }
  if (gameName === '.' || gameName === '..' || /[\\/\x00-\x1f<>:"|?*]/.test(gameName)) {
    throw new Error('游戏名称包含非法字符')
  }
  if (/[. ]$/.test(gameName)) {
    throw new Error('游戏名称不能以空格或句点结尾')
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(gameName)) {
    throw new Error('游戏名称不能使用系统保留名称')
  }

  return gameName
}

function getTargetPath(gameName: string): string {
  if (!configManager) {
    throw new Error('配置管理器未初始化')
  }
  const defaultInstallPath = configManager.getGameConfig().defaultInstallPath?.trim()
  if (!defaultInstallPath) {
    throw new Error('请先在设置中配置游戏默认安装路径')
  }
  return path.join(defaultInstallPath, gameName)
}

function getArchiveSuffix(fileName: string): string | null {
  const lowerName = fileName.toLowerCase().split('?')[0].split('#')[0]
  return SUPPORTED_ARCHIVE_SUFFIXES.find(suffix => lowerName.endsWith(suffix)) || null
}

function sanitizeArchiveFileName(fileName: string): string {
  const safeName = path.basename(fileName).replace(/[<>:"|?*\x00-\x1f]/g, '').trim()
  if (!safeName || !getArchiveSuffix(safeName)) {
    throw new Error(`不支持的压缩格式，支持: ${SUPPORTED_ARCHIVE_SUFFIXES.join(', ')}`)
  }
  return safeName
}

function getFileNameFromContentDisposition(value: unknown): string {
  if (typeof value !== 'string') return ''
  const encodedMatch = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1].replace(/^"|"$/g, ''))
    } catch {
      return encodedMatch[1].replace(/^"|"$/g, '')
    }
  }
  return value.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    || value.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
    || ''
}

function resolveUrlArchiveName(response: any, originalUrl: string): string {
  const dispositionName = getFileNameFromContentDisposition(response.headers?.['content-disposition'])
  const finalUrl = response.request?.res?.responseUrl || originalUrl
  const candidates = [dispositionName, finalUrl, originalUrl]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const pathname = /^https?:\/\//i.test(candidate) ? new URL(candidate).pathname : candidate
      const decodedName = decodeURIComponent(path.basename(pathname))
      if (getArchiveSuffix(decodedName)) return sanitizeArchiveFileName(decodedName)
    } catch {
      // 当前候选名无法解析时继续尝试下一项
    }
  }

  throw new Error('无法从下载响应或 URL 识别受支持的压缩包文件名')
}

function emitLog(deployment: ActiveDeployment, message: string, type: 'info' | 'success' | 'error' = 'info') {
  if (io && deployment.socketId) {
    io.to(deployment.socketId).emit('file-deploy-log', {
      deploymentId: deployment.id,
      message,
      type,
      timestamp: new Date().toISOString()
    })
  }
}

function emitProgress(deployment: ActiveDeployment, percentage: number, currentStep: string, downloadedBytes?: number, totalBytes?: number) {
  if (io && deployment.socketId) {
    io.to(deployment.socketId).emit('file-deploy-progress', {
      deploymentId: deployment.id,
      percentage,
      currentStep,
      downloadedBytes,
      totalBytes
    })
  }
}

function ensureNotCancelled(deployment: ActiveDeployment) {
  if (deployment.status === 'cancelled') {
    throw new Error('部署已取消')
  }
}

async function downloadArchive(deployment: ActiveDeployment, url: string): Promise<{ archivePath: string; fileName: string }> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('下载链接格式无效')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('下载链接仅支持 HTTP 或 HTTPS')
  }

  emitLog(deployment, '正在连接下载地址...')
  const response = await axios.get(parsedUrl.toString(), {
    responseType: 'stream',
    timeout: 0,
    maxRedirects: 10,
    signal: deployment.abortController.signal
  })
  const fileName = resolveUrlArchiveName(response, parsedUrl.toString())
  const sessionDirectory = path.join(getTempRoot(), deployment.id)
  const archivePath = path.join(sessionDirectory, fileName)
  await fs.ensureDir(sessionDirectory)

  const totalBytes = Number.parseInt(String(response.headers['content-length'] || '0'), 10) || 0
  let downloadedBytes = 0
  response.data.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length
    const percentage = totalBytes > 0 ? 5 + Math.round((downloadedBytes / totalBytes) * 45) : 25
    emitProgress(deployment, percentage, `正在下载 ${Math.round(downloadedBytes / 1024 / 1024)} MB`, downloadedBytes, totalBytes)
  })

  await pipeline(response.data, createWriteStream(archivePath))
  ensureNotCancelled(deployment)
  emitLog(deployment, `压缩包下载完成: ${fileName}`, 'success')
  return { archivePath, fileName }
}

async function extractArchive(archivePath: string, stagingPath: string): Promise<void> {
  const suffix = getArchiveSuffix(archivePath)
  if (!suffix) throw new Error('不支持的压缩包格式')

  await fs.ensureDir(stagingPath)
  if (suffix === '.zip') {
    await zipToolsManager.extractZip(archivePath, stagingPath)
    return
  }
  if (suffix === '.7z') {
    await zipToolsManager.extract7z(archivePath, stagingPath)
    return
  }
  if (suffix === '.tar' || suffix === '.tar.gz' || suffix === '.tgz') {
    await tar.extract({
      file: archivePath,
      cwd: stagingPath,
      gzip: suffix !== '.tar',
      filter: createTarSecurityFilter({ cwd: stagingPath })
    } as any)
    return
  }

  const xzTempPath = `${stagingPath}-xz`
  await fs.ensureDir(xzTempPath)
  try {
    await zipToolsManager.extract7z(archivePath, xzTempPath)
    const tarFiles = (await fs.readdir(xzTempPath)).filter(file => file.toLowerCase().endsWith('.tar'))
    if (tarFiles.length !== 1) {
      throw new Error('TAR.XZ 解压后未找到唯一的 TAR 归档')
    }
    const tarPath = path.join(xzTempPath, tarFiles[0])
    await tar.extract({
      file: tarPath,
      cwd: stagingPath,
      filter: createTarSecurityFilter({ cwd: stagingPath })
    } as any)
  } finally {
    await fs.remove(xzTempPath).catch(() => {})
  }
}

async function flattenSingleWrapper(stagingPath: string): Promise<void> {
  const entries = await fs.readdir(stagingPath, { withFileTypes: true })
  if (entries.length !== 1 || !entries[0].isDirectory()) return

  const wrapperPath = path.join(stagingPath, entries[0].name)
  const wrappedEntries = await fs.readdir(wrapperPath)
  for (const entry of wrappedEntries) {
    await fs.move(path.join(wrapperPath, entry), path.join(stagingPath, entry), { overwrite: false })
  }
  await fs.remove(wrapperPath)
}

async function commitFiles(stagingPath: string, targetPath: string, strategy: DirectoryStrategy): Promise<void> {
  const targetExists = await fs.pathExists(targetPath)
  if (!targetExists) {
    await fs.move(stagingPath, targetPath)
    return
  }

  if (strategy === 'clean') {
    await fs.remove(targetPath)
    await fs.move(stagingPath, targetPath)
    return
  }

  await fs.copy(stagingPath, targetPath, { overwrite: true, errorOnExist: false })
  await fs.remove(stagingPath)
}

function buildInstanceData(
  gameName: string,
  targetPath: string,
  instanceType: InstanceType,
  startCommand: string,
  javaVersion?: string,
  existing?: Instance
) {
  let actualStartCommand = startCommand.trim()
  let stopCommand: 'ctrl+c' | 'stop' = 'ctrl+c'

  if (instanceType === 'minecraft-java') {
    actualStartCommand = 'echo Minecraft Java Edition'
    stopCommand = 'stop'
  } else if (instanceType === 'minecraft-bedrock') {
    actualStartCommand = os.platform() === 'win32' ? '.\\bedrock_server.exe' : './bedrock_server'
    stopCommand = 'stop'
  }

  return {
    name: gameName,
    description: existing?.description || `文件部署创建的 ${gameName} 实例`,
    workingDirectory: targetPath,
    startCommand: actualStartCommand,
    autoStart: existing?.autoStart || false,
    stopCommand,
    enableStreamForward: existing?.enableStreamForward || false,
    programPath: existing?.programPath || '',
    terminalUser: existing?.terminalUser || '',
    instanceType,
    javaVersion: instanceType === 'minecraft-java' ? javaVersion?.trim() || undefined : undefined
  }
}

async function createOrUpdateInstance(options: {
  gameName: string
  targetPath: string
  instanceType: InstanceType
  startCommand: string
  javaVersion?: string
  strategy: InstanceStrategy
  existingInstanceId?: string
}): Promise<Instance> {
  if (options.strategy === 'update') {
    if (!options.existingInstanceId) throw new Error('未选择要更新的实例')
    const existing = instanceManager.getInstance(options.existingInstanceId)
    if (!existing) throw new Error('要更新的实例不存在')
    if (existing.status === 'running') throw new Error('运行中的实例无法更新，请先停止实例')
    const updated = await instanceManager.updateInstance(existing.id, buildInstanceData(
      options.gameName,
      options.targetPath,
      options.instanceType,
      options.startCommand,
      options.javaVersion,
      existing
    ))
    if (!updated) throw new Error('更新实例失败')
    return updated
  }

  return instanceManager.createInstance(buildInstanceData(
    options.gameName,
    options.targetPath,
    options.instanceType,
    options.startCommand,
    options.javaVersion
  ))
}

router.post('/preflight', authenticateToken, async (req: Request, res: Response) => {
  try {
    const gameName = normalizeGameName(req.body.gameName)
    const targetPath = getTargetPath(gameName)
    const matchingInstances = instanceManager.getInstances()
      .filter(instance => instance.name.trim().toLowerCase() === gameName.toLowerCase())
      .map(instance => ({
        id: instance.id,
        name: instance.name,
        status: instance.status,
        workingDirectory: instance.workingDirectory,
        instanceType: instance.instanceType || 'generic'
      }))

    res.json({
      success: true,
      data: {
        gameName,
        targetPath,
        directoryExists: await fs.pathExists(targetPath),
        matchingInstances
      }
    })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || '部署预检查失败' })
  }
})

router.post('/upload-session', authenticateToken, async (req: Request, res: Response) => {
  try {
    const fileName = sanitizeArchiveFileName(req.body.fileName)
    const sessionId = uuidv4()
    const directory = path.join(getTempRoot(), sessionId)
    await fs.ensureDir(directory)
    uploadSessions.set(sessionId, { id: sessionId, fileName, directory, createdAt: Date.now() })
    res.json({ success: true, data: { sessionId, uploadPath: directory } })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || '创建上传会话失败' })
  }
})

router.delete('/upload-session/:sessionId', authenticateToken, async (req: Request, res: Response) => {
  const session = uploadSessions.get(req.params.sessionId)
  if (session) {
    uploadSessions.delete(session.id)
    await fs.remove(session.directory).catch(() => {})
  }
  res.json({ success: true, message: '上传会话已清理' })
})

router.post('/deploy', authenticateToken, async (req: Request, res: Response) => {
  try {
    const gameName = normalizeGameName(req.body.gameName)
    const sourceType = req.body.sourceType as SourceType
    const instanceType = req.body.instanceType as InstanceType
    const directoryStrategy = req.body.directoryStrategy as DirectoryStrategy
    const instanceStrategy = req.body.instanceStrategy as InstanceStrategy
    const startCommand = typeof req.body.startCommand === 'string' ? req.body.startCommand : ''

    if (!['upload', 'url'].includes(sourceType)) throw new Error('无效的文件来源')
    if (!VALID_INSTANCE_TYPES.has(instanceType)) throw new Error('无效的实例类型')
    if (!['merge', 'clean'].includes(directoryStrategy)) throw new Error('无效的目录处理策略')
    if (!['create', 'update'].includes(instanceStrategy)) throw new Error('无效的实例处理策略')
    if (instanceType === 'generic' && !startCommand.trim()) throw new Error('通用实例必须填写启动命令')
    if (sourceType === 'url' && typeof req.body.downloadUrl !== 'string') throw new Error('请填写下载链接')

    let uploadSession: UploadSession | undefined
    if (sourceType === 'upload') {
      uploadSession = uploadSessions.get(req.body.uploadSessionId)
      if (!uploadSession) throw new Error('上传会话不存在或已过期')
      const archivePath = path.join(uploadSession.directory, uploadSession.fileName)
      if (!await fs.pathExists(archivePath)) throw new Error('上传的压缩包不存在')
    }

    const requestedDeploymentId = typeof req.body.deploymentId === 'string' ? req.body.deploymentId.trim() : ''
    const deploymentId = /^[0-9a-f-]{16,64}$/i.test(requestedDeploymentId) ? requestedDeploymentId : uuidv4()
    const deployment: ActiveDeployment = {
      id: deploymentId,
      socketId: typeof req.body.socketId === 'string' ? req.body.socketId : undefined,
      status: 'running',
      abortController: new AbortController()
    }
    activeDeployments.set(deploymentId, deployment)

    res.json({ success: true, data: { deploymentId } })

    setImmediate(async () => {
      let archivePath = ''
      let archiveFileName = ''
      let filesCommitted = false
      const targetPath = getTargetPath(gameName)
      const stagingPath = path.join(path.dirname(targetPath), `.gsm3-file-deploy-${deploymentId}`)
      deployment.stagingPath = stagingPath

      try {
        emitLog(deployment, `开始部署 ${gameName}`)
        emitProgress(deployment, 5, '准备压缩包')

        if (sourceType === 'url') {
          const downloaded = await downloadArchive(deployment, req.body.downloadUrl.trim())
          archivePath = downloaded.archivePath
          archiveFileName = downloaded.fileName
        } else {
          archivePath = path.join(uploadSession!.directory, uploadSession!.fileName)
          archiveFileName = uploadSession!.fileName
          emitProgress(deployment, 50, '压缩包上传完成')
        }

        ensureNotCancelled(deployment)
        await fs.remove(stagingPath).catch(() => {})
        emitLog(deployment, '正在解压和校验文件层级...')
        emitProgress(deployment, 60, '正在解压文件')
        await extractArchive(archivePath, stagingPath)
        await flattenSingleWrapper(stagingPath)
        ensureNotCancelled(deployment)

        emitProgress(deployment, 85, '正在提交游戏文件')
        await commitFiles(stagingPath, targetPath, directoryStrategy)
        filesCommitted = true
        emitLog(deployment, `游戏文件已部署到 ${targetPath}`, 'success')

        emitProgress(deployment, 95, '正在创建实例')
        const instance = await createOrUpdateInstance({
          gameName,
          targetPath,
          instanceType,
          startCommand,
          javaVersion: req.body.javaVersion,
          strategy: instanceStrategy,
          existingInstanceId: req.body.existingInstanceId
        })

        emitProgress(deployment, 100, '部署完成')
        emitLog(deployment, `实例 ${instance.name} 已${instanceStrategy === 'update' ? '更新' : '创建'}`, 'success')
        if (io && deployment.socketId) {
          io.to(deployment.socketId).emit('file-deploy-complete', {
            deploymentId,
            message: '文件部署和实例创建完成',
            data: { targetPath, sourceFileName: archiveFileName, instance }
          })
        }
      } catch (error: any) {
        const cancelled = deployment.status === 'cancelled' || axios.isCancel(error) || error?.code === 'ERR_CANCELED'
        const message = cancelled
          ? '部署已取消'
          : filesCommitted
            ? `文件已部署，实例创建失败: ${error.message || '未知错误'}`
            : error.message || '文件部署失败'
        logger.error(`文件部署失败: ${message}`)
        emitLog(deployment, message, 'error')
        if (io && deployment.socketId) {
          io.to(deployment.socketId).emit('file-deploy-error', {
            deploymentId,
            error: message,
            cancelled,
            filesDeployed: filesCommitted,
            targetPath: filesCommitted ? targetPath : undefined
          })
        }
      } finally {
        activeDeployments.delete(deploymentId)
        await fs.remove(stagingPath).catch(() => {})
        if (sourceType === 'upload' && uploadSession) {
          uploadSessions.delete(uploadSession.id)
          await fs.remove(uploadSession.directory).catch(() => {})
        } else if (archivePath) {
          await fs.remove(path.dirname(archivePath)).catch(() => {})
        }
      }
    })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || '启动文件部署失败' })
  }
})

router.post('/:deploymentId/cancel', authenticateToken, async (req: Request, res: Response) => {
  const deployment = activeDeployments.get(req.params.deploymentId)
  if (!deployment) {
    return res.status(404).json({ success: false, message: '部署任务不存在或已完成' })
  }
  deployment.status = 'cancelled'
  deployment.abortController.abort()
  res.json({ success: true, message: '已提交取消请求' })
})

export default router
