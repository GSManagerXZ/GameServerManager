import { Router, Request, Response } from 'express'
import fs from 'fs/promises'
import { constants as fsConstants, createReadStream, createWriteStream } from 'fs'
import https from 'https'
import path from 'path'
import * as tar from 'tar'
import crypto from 'crypto'
import { authenticateToken } from '../middleware/auth.js'
import type { InstanceManager } from '../modules/instance/InstanceManager.js'
import type { SystemManager } from '../modules/system/SystemManager.js'
import type { TerminalManager } from '../modules/terminal/TerminalManager.js'
import type { GameManager } from '../modules/game/GameManager.js'
import filesRouter from './files.js'
import { setupTerminalRoutes } from './terminal.js'
import logger from '../utils/logger.js'
import { createTarSecurityFilter } from '../utils/tarSecurityFilter.js'
import { zipToolsManager } from '../utils/zipToolsManager.js'

const router = Router()

// 依赖注入
let instanceManager: InstanceManager
let systemManager: SystemManager
let terminalManager: TerminalManager
let gameManager: GameManager

type TunnelToolName = 'frp' | 'easytier'

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size?: number
  digest?: string
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: GitHubReleaseAsset[]
}

interface TunnelToolDefinition {
  name: TunnelToolName
  label: string
  repo: string
  executableNames: string[]
}

interface TunnelToolInstallResult {
  tool: TunnelToolName
  version: string
  assetName: string
  installPath: string
  executablePath: string
  releaseUrl: string
}

interface TunnelToolInstalledState {
  tool: TunnelToolName
  label: string
  installed: boolean
  version?: string
  installPath?: string
  executablePath?: string
}

const TUNNEL_TOOL_DEFINITIONS: Record<TunnelToolName, TunnelToolDefinition> = {
  frp: {
    name: 'frp',
    label: 'frp',
    repo: 'fatedier/frp',
    executableNames: process.platform === 'win32' ? ['frpc.exe'] : ['frpc']
  },
  easytier: {
    name: 'easytier',
    label: 'EasyTier',
    repo: 'EasyTier/EasyTier',
    executableNames: process.platform === 'win32' ? ['easytier-core.exe'] : ['easytier-core']
  }
}

const getTunnelToolDefinition = (tool: string): TunnelToolDefinition => {
  if (tool === 'frp' || tool === 'easytier') {
    return TUNNEL_TOOL_DEFINITIONS[tool]
  }

  throw new Error(`不支持的工具: ${tool}`)
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}

const stripShellQuotes = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }

  return trimmed
}

const looksLikePath = (value: string): boolean => {
  return value.includes('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)
}

const getWindowsExecutableExtensions = (): string[] => {
  const pathext = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD'
  return pathext
    .split(';')
    .map(ext => ext.trim())
    .filter(Boolean)
}

const getExecutableCandidates = (executable: string, workingDirectory?: string): string[] => {
  const command = stripShellQuotes(executable)
  if (!command) return []

  const candidates = new Set<string>()
  const accessNames = process.platform === 'win32' && !path.extname(command)
    ? [command, ...getWindowsExecutableExtensions().map(ext => `${command}${ext}`)]
    : [command]

  if (looksLikePath(command)) {
    const baseDirectory = workingDirectory
      ? path.resolve(stripShellQuotes(workingDirectory))
      : process.cwd()

    for (const accessName of accessNames) {
      candidates.add(path.isAbsolute(accessName)
        ? accessName
        : path.resolve(baseDirectory, accessName))
    }

    return Array.from(candidates)
  }

  const pathEntries = (process.env.PATH || '')
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean)

  for (const entry of pathEntries) {
    for (const accessName of accessNames) {
      candidates.add(path.join(entry, accessName))
    }
  }

  return Array.from(candidates)
}

const findExecutable = async (executable: string, workingDirectory?: string): Promise<string | null> => {
  const mode = process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK

  for (const candidate of getExecutableCandidates(executable, workingDirectory)) {
    try {
      await fs.access(candidate, mode)
      return candidate
    } catch {
      // 继续检查下一个候选路径
    }
  }

  return null
}

const getPlatformAliases = (): string[] => {
  switch (process.platform) {
    case 'win32':
      return ['windows', 'win32', 'win']
    case 'linux':
      return ['linux']
    case 'darwin':
      return ['darwin', 'macos', 'mac']
    case 'freebsd':
      return ['freebsd']
    default:
      return [process.platform]
  }
}

const getFrpArchAliases = (): string[] => {
  switch (process.arch) {
    case 'x64':
      return ['amd64', 'x86_64', 'x64']
    case 'arm64':
      return ['arm64', 'aarch64']
    case 'arm':
      return ['arm', 'arm_hf']
    default:
      return [process.arch]
  }
}

const getEasyTierArchAliases = (): string[] => {
  switch (process.arch) {
    case 'x64':
      return ['x86_64', 'amd64', 'x64']
    case 'arm64':
      return ['aarch64', 'arm64']
    case 'arm':
      return ['armv7', 'arm']
    default:
      return [process.arch]
  }
}

const isSupportedArchive = (assetName: string): boolean => {
  const name = assetName.toLowerCase()
  return name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.tgz')
}

const scoreAsset = (tool: TunnelToolName, asset: GitHubReleaseAsset): number => {
  const name = asset.name.toLowerCase()
  if (!isSupportedArchive(name)) return -1

  const platformAliases = getPlatformAliases()
  const archAliases = tool === 'frp' ? getFrpArchAliases() : getEasyTierArchAliases()
  const hasPlatform = platformAliases.some(alias => name.includes(alias))
  const hasArch = archAliases.some(alias => name.includes(alias))
  if (!hasPlatform || !hasArch) return -1

  let score = 100
  if (tool === 'frp') {
    if (!name.startsWith('frp_')) return -1
    if (name.includes('android')) return -1
    if (name.includes(`_${platformAliases[0]}_${archAliases[0]}`)) score += 20
  } else {
    if (!name.startsWith('easytier-')) return -1
    if (name.includes('gui') || name.includes('app-') || name.endsWith('.apk')) return -1
    if (name.endsWith('.rpm') || name.endsWith('.dmg') || name.endsWith('.appimage')) return -1
    if (name.includes(`${platformAliases[0]}-${archAliases[0]}`)) score += 20
  }

  if (name.endsWith('.zip')) score += process.platform === 'win32' ? 8 : 2
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) score += process.platform === 'win32' ? 2 : 8

  return score
}

const selectTunnelToolAsset = (tool: TunnelToolName, release: GitHubRelease): GitHubReleaseAsset => {
  const candidates = release.assets
    .map(asset => ({ asset, score: scoreAsset(tool, asset) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score)

  if (candidates.length === 0) {
    throw new Error(`未找到适用于 ${process.platform}/${process.arch} 的 ${tool} release 资产`)
  }

  return candidates[0].asset
}

const safeVersionSegment = (version: string): string => {
  return version.replace(/[^a-zA-Z0-9._-]/g, '_')
}

const getTunnelToolsRoot = (): string => {
  return path.resolve(process.cwd(), 'data', 'tools', 'tunnel-helper')
}

const getPluginDataRoot = (): string => {
  return path.resolve(process.cwd(), 'data')
}

const assertInsideDirectory = (targetPath: string, rootPath: string): void => {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootPath)
  const relative = path.relative(resolvedRoot, resolvedTarget)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径超出允许范围: ${targetPath}`)
  }
}

const resolvePluginDataPath = (dataPath: string): string => {
  if (!dataPath || typeof dataPath !== 'string') {
    throw new Error('缺少 dataPath')
  }

  if (dataPath.includes('\0')) {
    throw new Error('无效的路径')
  }

  if (path.isAbsolute(dataPath)) {
    throw new Error('dataPath 必须是相对 data 目录的路径')
  }

  const dataRoot = getPluginDataRoot()
  const resolvedPath = path.resolve(dataRoot, dataPath)
  assertInsideDirectory(resolvedPath, dataRoot)
  return resolvedPath
}

const requestJson = async <T>(url: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'GameServerManager-TunnelHelper'
      }
    }, response => {
      let body = ''

      response.on('data', chunk => {
        body += chunk
      })

      response.on('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          try {
            const parsed = JSON.parse(body)
            reject(new Error(parsed.message || `HTTP ${response.statusCode}`))
          } catch {
            reject(new Error(`HTTP ${response.statusCode}`))
          }
          return
        }

        try {
          resolve(JSON.parse(body) as T)
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

const requestHeaders = async (url: string): Promise<{
  statusCode?: number
  headers: Record<string, string | string[] | undefined>
}> => {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'GameServerManager-TunnelHelper' }
    }, response => {
      response.resume()
      resolve({
        statusCode: response.statusCode,
        headers: response.headers as Record<string, string | string[] | undefined>
      })
    })

    request.on('error', reject)
    request.end()
  })
}

const requestText = async (url: string, redirectCount = 0): Promise<string> => {
  if (redirectCount > 5) {
    throw new Error('请求重定向次数过多')
  }

  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'GameServerManager-TunnelHelper' }
    }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        requestText(new URL(response.headers.location, url).toString(), redirectCount + 1)
          .then(resolve)
          .catch(reject)
        return
      }

      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        reject(new Error(`HTTP ${response.statusCode || 'unknown'}`))
        return
      }

      response.setEncoding('utf8')
      let body = ''
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

const extractTagFromReleaseLocation = (location: string): string | null => {
  const match = location.match(/\/releases\/tag\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

const fetchLatestReleaseTagWithoutApi = async (repo: string): Promise<string> => {
  const latestUrl = `https://github.com/${repo}/releases/latest`
  const response = await requestHeaders(latestUrl)
  const locationHeader = response.headers.location
  const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader

  if (location) {
    const tag = extractTagFromReleaseLocation(location)
    if (tag) return tag
  }

  throw new Error(`无法从 ${latestUrl} 的跳转响应中获取最新版本`)
}

const extractReleaseAssetsFromHtml = (repo: string, html: string): GitHubReleaseAsset[] => {
  const assets: GitHubReleaseAsset[] = []
  const seen = new Set<string>()
  const expectedPathPrefix = `/${repo.toLowerCase()}/releases/download/`
  const hrefRegex = /href="([^"]*\/releases\/download\/[^"]+)"/g
  let match: RegExpExecArray | null

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = decodeHtmlEntities(match[1])
    let assetUrl: URL

    try {
      assetUrl = new URL(href, 'https://github.com')
    } catch {
      continue
    }

    if (assetUrl.hostname !== 'github.com') continue
    if (!assetUrl.pathname.toLowerCase().startsWith(expectedPathPrefix)) continue

    const encodedName = assetUrl.pathname.split('/').pop()
    if (!encodedName) continue

    const name = decodeURIComponent(encodedName)
    if (seen.has(name)) continue

    const assetHtml = html.slice(match.index, match.index + 3000)
    const digestMatch = assetHtml.match(/value="(sha256:[a-fA-F0-9]{64})"/)

    seen.add(name)
    assets.push({
      name,
      browser_download_url: assetUrl.toString(),
      digest: digestMatch ? digestMatch[1].toLowerCase() : undefined
    })
  }

  return assets
}

const fetchTunnelToolReleaseWithoutApi = async (definition: TunnelToolDefinition): Promise<GitHubRelease> => {
  const tag = await fetchLatestReleaseTagWithoutApi(definition.repo)
  const expandedAssetsUrl = `https://github.com/${definition.repo}/releases/expanded_assets/${encodeURIComponent(tag)}`
  const assetsHtml = await requestText(expandedAssetsUrl)
  const assets = extractReleaseAssetsFromHtml(definition.repo, assetsHtml)

  if (assets.length === 0) {
    throw new Error(`未能从 GitHub Release 页面读取 ${definition.label} 资产列表`)
  }

  return {
    tag_name: tag,
    html_url: `https://github.com/${definition.repo}/releases/tag/${encodeURIComponent(tag)}`,
    assets
  }
}

const fetchTunnelToolReleaseWithApi = async (definition: TunnelToolDefinition): Promise<GitHubRelease> => {
  return requestJson<GitHubRelease>(`https://api.github.com/repos/${definition.repo}/releases/latest`)
}

const fetchLatestTunnelToolRelease = async (definition: TunnelToolDefinition): Promise<GitHubRelease> => {
  try {
    return await fetchTunnelToolReleaseWithoutApi(definition)
  } catch (webError) {
    logger.warn(`插件通过 GitHub 页面获取 ${definition.label} 最新版本失败，尝试 GitHub API:`, webError)

    try {
      return await fetchTunnelToolReleaseWithApi(definition)
    } catch (apiError) {
      throw new Error(
        `获取 ${definition.label} 最新版本失败: 页面方式失败: ${getErrorMessage(webError)}; GitHub API 失败: ${getErrorMessage(apiError)}`
      )
    }
  }
}

const downloadFile = async (
  url: string,
  targetPath: string,
  onProgress?: (progress: number) => void,
  redirectCount = 0
): Promise<void> => {
  if (redirectCount > 5) {
    throw new Error('下载重定向次数过多')
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'GameServerManager-TunnelHelper' }
    }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        downloadFile(new URL(response.headers.location, url).toString(), targetPath, onProgress, redirectCount + 1)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`下载失败: HTTP ${response.statusCode}`))
        return
      }

      const totalSize = Number(response.headers['content-length'] || 0)
      let downloadedSize = 0
      const file = createWriteStream(targetPath)

      response.on('data', chunk => {
        downloadedSize += chunk.length
        if (totalSize > 0) {
          onProgress?.(Math.round((downloadedSize / totalSize) * 100))
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve()
      })

      file.on('error', error => {
        fs.rm(targetPath, { force: true }).catch(() => { })
        reject(error)
      })
    })

    request.on('error', error => {
      fs.rm(targetPath, { force: true }).catch(() => { })
      reject(error)
    })
  })
}

const calculateSha256 = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)

    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

const verifyDownloadedAsset = async (asset: GitHubReleaseAsset, archivePath: string): Promise<void> => {
  const stats = await fs.stat(archivePath)
  if (stats.size <= 0) {
    throw new Error('下载的文件为空')
  }

  if (asset.digest && asset.digest.startsWith('sha256:')) {
    const expected = asset.digest.slice('sha256:'.length).toLowerCase()
    const actual = await calculateSha256(archivePath)
    if (actual !== expected) {
      throw new Error(`SHA256 校验失败: expected=${expected}, actual=${actual}`)
    }
  }
}

const extractTunnelToolArchive = async (archivePath: string, targetPath: string): Promise<void> => {
  const lowerArchivePath = archivePath.toLowerCase()
  if (lowerArchivePath.endsWith('.zip')) {
    await zipToolsManager.extractZip(archivePath, targetPath)
    return
  }

  if (lowerArchivePath.endsWith('.tar.gz') || lowerArchivePath.endsWith('.tgz')) {
    await tar.extract({
      file: archivePath,
      cwd: targetPath,
      filter: createTarSecurityFilter({ cwd: targetPath })
    } as any)
    return
  }

  throw new Error(`不支持的压缩包格式: ${path.basename(archivePath)}`)
}

const findExtractedExecutable = async (rootPath: string, executableNames: string[]): Promise<string | null> => {
  const queue = [rootPath]
  const expectedNames = new Set(executableNames.map(name => name.toLowerCase()))

  while (queue.length > 0) {
    const currentPath = queue.shift()!
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        queue.push(entryPath)
        continue
      }

      if (entry.isFile() && expectedNames.has(entry.name.toLowerCase())) {
        if (process.platform !== 'win32') {
          await fs.chmod(entryPath, 0o755).catch(() => { })
        }
        return entryPath
      }
    }
  }

  return null
}

const getInstalledTunnelTool = async (tool: TunnelToolName): Promise<TunnelToolInstalledState> => {
  const definition = getTunnelToolDefinition(tool)
  const toolsRoot = getTunnelToolsRoot()
  const toolRoot = path.join(toolsRoot, definition.name)
  assertInsideDirectory(toolRoot, toolsRoot)

  const emptyState: TunnelToolInstalledState = {
    tool: definition.name,
    label: definition.label,
    installed: false
  }

  let entries: Array<import('fs').Dirent>
  try {
    entries = await fs.readdir(toolRoot, { withFileTypes: true })
  } catch (error: any) {
    if (error.code === 'ENOENT') return emptyState
    throw error
  }

  const candidates: Array<TunnelToolInstalledState & { modifiedAt: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'downloads' || entry.name.startsWith('.staging-')) continue

    const installPath = path.join(toolRoot, entry.name)
    assertInsideDirectory(installPath, toolsRoot)

    const executablePath = await findExtractedExecutable(installPath, definition.executableNames)
    if (!executablePath) continue

    const stats = await fs.stat(installPath)
    candidates.push({
      tool: definition.name,
      label: definition.label,
      installed: true,
      version: entry.name,
      installPath,
      executablePath,
      modifiedAt: stats.mtimeMs
    })
  }

  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt || String(b.version || '').localeCompare(String(a.version || '')))
  const latest = candidates[0]
  if (!latest) return emptyState

  const { modifiedAt, ...state } = latest
  return state
}

const installTunnelTool = async (
  tool: TunnelToolName,
  onProgress: (progress: number) => void,
  onStatusChange: (status: string) => void
): Promise<TunnelToolInstallResult> => {
  const definition = getTunnelToolDefinition(tool)
  const toolsRoot = getTunnelToolsRoot()

  onStatusChange(`正在获取 ${definition.label} 最新版本信息...`)
  const release = await fetchLatestTunnelToolRelease(definition)
  const asset = selectTunnelToolAsset(tool, release)

  const version = safeVersionSegment(release.tag_name)
  const toolRoot = path.join(toolsRoot, definition.name)
  const installPath = path.join(toolRoot, version)
  const downloadPath = path.join(toolRoot, 'downloads', asset.name)
  const stagingPath = path.join(toolRoot, `.staging-${version}-${Date.now()}`)

  assertInsideDirectory(toolRoot, toolsRoot)
  assertInsideDirectory(installPath, toolsRoot)
  assertInsideDirectory(downloadPath, toolsRoot)
  assertInsideDirectory(stagingPath, toolsRoot)

  try {
    await fs.mkdir(path.dirname(downloadPath), { recursive: true })

    onStatusChange(`正在下载 ${asset.name}...`)
    await downloadFile(asset.browser_download_url, downloadPath, progress => {
      onProgress(Math.min(70, Math.round(progress * 0.7)))
    })

    onStatusChange('正在校验下载文件...')
    await verifyDownloadedAsset(asset, downloadPath)

    await fs.rm(stagingPath, { recursive: true, force: true })
    await fs.mkdir(stagingPath, { recursive: true })

    onStatusChange('正在解压文件...')
    await extractTunnelToolArchive(downloadPath, stagingPath)
    onProgress(90)

    const executablePath = await findExtractedExecutable(stagingPath, definition.executableNames)
    if (!executablePath) {
      throw new Error(`安装验证失败：未找到 ${definition.executableNames.join(' 或 ')}`)
    }

    await fs.rm(installPath, { recursive: true, force: true })
    await fs.rename(stagingPath, installPath)
    await fs.rm(downloadPath, { force: true }).catch(() => { })

    const finalExecutablePath = path.join(installPath, path.relative(stagingPath, executablePath))
    const resolvedExecutable = await findExecutable(finalExecutablePath)
    if (!resolvedExecutable) {
      throw new Error(`安装验证失败：${finalExecutablePath} 不可访问`)
    }

    onProgress(100)
    onStatusChange('安装完成')

    return {
      tool,
      version: release.tag_name,
      assetName: asset.name,
      installPath,
      executablePath: finalExecutablePath,
      releaseUrl: release.html_url
    }
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => { })
    await fs.rm(downloadPath, { force: true }).catch(() => { })
    throw error
  }
}

export function setPluginApiDependencies(
  instManager: InstanceManager,
  sysManager: SystemManager,
  termManager: TerminalManager,
  gmManager: GameManager
) {
  instanceManager = instManager
  systemManager = sysManager
  terminalManager = termManager
  gameManager = gmManager
}

// 插件API代理中间件
const pluginApiProxy = (req: Request, res: Response, next: any) => {
  // 验证请求来源是否为插件
  const isPluginRequest = req.get('X-Plugin-Request') === 'true'
  
  if (!isPluginRequest) {
    // 为了兼容开发环境，我们允许来自 about:srcdoc 的请求
    const referer = req.get('Referer')
    if (process.env.NODE_ENV === 'development' && referer === 'about:srcdoc') {
      return next()
    }

    return res.status(403).json({
      success: false,
      message: '仅允许插件调用此API'
    })
  }
  
  next()
}

// 应用插件API代理中间件
router.use(pluginApiProxy)
router.use(authenticateToken)

// ==================== 系统信息API ====================

// 获取系统状态
router.get('/system/status', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(503).json({
        success: false,
        message: '系统管理器未初始化'
      })
    }

    const status = await systemManager.getSystemInfo()
    res.json({
      success: true,
      data: status
    })
  } catch (error) {
    logger.error('插件获取系统状态失败:', error)
    res.status(500).json({
      success: false,
      message: '获取系统状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取系统信息
router.get('/system/info', async (req: Request, res: Response) => {
  try {
    if (!systemManager) {
      return res.status(503).json({
        success: false,
        message: '系统管理器未初始化'
      })
    }

    const info = await systemManager.getSystemInfo()
    res.json({
      success: true,
      data: info
    })
  } catch (error) {
    logger.error('插件获取系统信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取系统信息失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// ==================== 实例管理API ====================

// 获取实例列表
router.get('/instances', async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instances = instanceManager.getInstances()
    res.json({
      success: true,
      data: instances
    })
  } catch (error) {
    logger.error('插件获取实例列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取实例列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取单个实例信息
router.get('/instances/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    res.json({
      success: true,
      data: instance
    })
  } catch (error) {
    logger.error('插件获取实例信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取实例信息失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取实例状态
router.get('/instances/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const status = await instanceManager.getInstanceStatus(id)
    res.json({
      success: true,
      data: status
    })
  } catch (error) {
    logger.error('插件获取实例状态失败:', error)
    res.status(500).json({
      success: false,
      message: '获取实例状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取市场实例列表
router.get('/instances/market', async (req: Request, res: Response) => {
  try {
    const os = await import('os')
    const http = await import('http')
    
    // 确定系统类型
    const platform = os.platform()
    let systemType = 'Linux'
    if (platform === 'win32') {
      systemType = 'Windows'
    }
    
    // 请求第二个服务获取实例市场数据
    const marketUrl = `http://api.gsm.xiaozhuhouses.asia:10002/api/instances?system_type=${systemType}`
    
    logger.info(`插件请求实例市场数据: ${marketUrl}`)
    
    // 使用Promise包装http请求
    const marketData = await new Promise((resolve, reject) => {
      const url = new URL(marketUrl)
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GSM3-Plugin-API/1.0'
        }
      }
      
      const req = http.request(options, (response) => {
        let data = ''
        
        response.on('data', (chunk) => {
          data += chunk
        })
        
        response.on('end', () => {
           try {
             if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
               const jsonData = JSON.parse(data)
               resolve(jsonData)
             } else {
               logger.error(`插件API请求失败 - 状态码: ${response.statusCode}, 响应内容: ${data}`)
               reject(new Error(`HTTP error! status: ${response.statusCode}, response: ${data}`))
             }
           } catch (parseError) {
             logger.error(`插件JSON解析失败: ${parseError}, 原始数据: ${data}`)
             reject(new Error(`JSON parse error: ${parseError}`))
           }
         })
      })
      
      req.on('error', (error) => {
        reject(error)
      })
      
      req.setTimeout(10000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
      
      req.end()
    })
    
    res.json({
      success: true,
      data: marketData
    })
  } catch (error) {
    logger.error('插件获取市场实例列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取市场实例列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 创建实例
router.post('/instances', async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const { name, description, workingDirectory, startCommand, stopCommand, autoStart } = req.body

    // 验证必填字段
    if (!name || !workingDirectory || !startCommand) {
      return res.status(400).json({
        success: false,
        message: '缺少必填字段: name, workingDirectory, startCommand'
      })
    }

    // 验证停止命令
    const validStopCommands = ['ctrl+c', 'stop', 'quit', 'exit']
    if (stopCommand && !validStopCommands.includes(stopCommand)) {
      return res.status(400).json({
        success: false,
        message: `无效的停止命令。支持的命令: ${validStopCommands.join(', ')}`
      })
    }

    const instanceData = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: startCommand.trim(),
      stopCommand: stopCommand || 'ctrl+c',
      autoStart: autoStart || false
    }

    const result = await instanceManager.createInstance(instanceData)
    res.status(201).json({
      success: true,
      data: result,
      message: '实例创建成功'
    })
  } catch (error) {
    logger.error('插件创建实例失败:', error)
    res.status(500).json({
      success: false,
      message: '创建实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 更新实例
router.put('/instances/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const { name, description, workingDirectory, startCommand, stopCommand, autoStart } = req.body

    // 验证必填字段
    if (!name || !workingDirectory || !startCommand) {
      return res.status(400).json({
        success: false,
        message: '缺少必填字段: name, workingDirectory, startCommand'
      })
    }

    // 验证停止命令
    const validStopCommands = ['ctrl+c', 'stop', 'quit', 'exit']
    if (stopCommand && !validStopCommands.includes(stopCommand)) {
      return res.status(400).json({
        success: false,
        message: `无效的停止命令。支持的命令: ${validStopCommands.join(', ')}`
      })
    }

    const instanceData = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: startCommand.trim(),
      stopCommand: stopCommand || 'ctrl+c',
      autoStart: autoStart || false
    }

    const result = await instanceManager.updateInstance(id, instanceData)
    res.json({
      success: true,
      data: result,
      message: '实例更新成功'
    })
  } catch (error) {
    logger.error('插件更新实例失败:', error)
    res.status(500).json({
      success: false,
      message: '更新实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 删除实例
router.delete('/instances/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    await instanceManager.deleteInstance(id)
    res.json({
      success: true,
      message: '实例删除成功'
    })
  } catch (error) {
    logger.error('插件删除实例失败:', error)
    res.status(500).json({
      success: false,
      message: '删除实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 启动实例
router.post('/instances/:id/start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const result = await instanceManager.startInstance(id)
    res.json({
      success: true,
      data: result,
      message: '实例启动成功'
    })
  } catch (error) {
    logger.error('插件启动实例失败:', error)
    res.status(500).json({
      success: false,
      message: '启动实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 停止实例
router.post('/instances/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const result = await instanceManager.stopInstance(id)
    res.json({
      success: true,
      data: result,
      message: '实例停止成功'
    })
  } catch (error) {
    logger.error('插件停止实例失败:', error)
    res.status(500).json({
      success: false,
      message: '停止实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 重启实例
router.post('/instances/:id/restart', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    if (!instanceManager) {
      return res.status(503).json({
        success: false,
        message: '实例管理器未初始化'
      })
    }

    const instance = instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '实例不存在'
      })
    }

    const result = await instanceManager.restartInstance(id)
    res.json({
      success: true,
      data: result,
      message: '实例重启成功'
    })
  } catch (error) {
    logger.error('插件重启实例失败:', error)
    res.status(500).json({
      success: false,
      message: '重启实例失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// ==================== 终端管理API ====================

// 转发终端操作请求到terminal路由
const terminalRouter = setupTerminalRoutes(terminalManager)
router.use('/terminals', terminalRouter)

// ==================== 游戏管理API ====================

// 获取游戏列表
router.get('/games', async (req: Request, res: Response) => {
  try {
    if (!gameManager) {
      return res.status(503).json({
        success: false,
        message: '游戏管理器未初始化'
      })
    }

    const games = gameManager.getGames()
    res.json({
      success: true,
      data: games
    })
  } catch (error) {
    logger.error('插件获取游戏列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取游戏列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// ==================== 工具检测API ====================

router.post('/tools/resolve-executable', async (req: Request, res: Response) => {
  try {
    const { executable, workingDirectory } = req.body || {}

    if (!executable || typeof executable !== 'string') {
      return res.status(400).json({
        success: false,
        message: '缺少可执行文件参数'
      })
    }

    if (executable.includes('\0') || (typeof workingDirectory === 'string' && workingDirectory.includes('\0'))) {
      return res.status(400).json({
        success: false,
        message: '无效的路径参数'
      })
    }

    const resolvedPath = await findExecutable(
      executable,
      typeof workingDirectory === 'string' ? workingDirectory : undefined
    )

    res.json({
      success: true,
      data: {
        executable: stripShellQuotes(executable),
        found: Boolean(resolvedPath),
        resolvedPath
      }
    })
  } catch (error) {
    logger.error('插件检测可执行文件失败:', error)
    res.status(500).json({
      success: false,
      message: '检测可执行文件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

router.post('/tools/resolve-data-path', async (req: Request, res: Response) => {
  const { dataPath } = req.body || {}

  try {
    const absolutePath = resolvePluginDataPath(String(dataPath || ''))

    res.json({
      success: true,
      data: {
        dataPath,
        absolutePath
      }
    })
  } catch (error) {
    logger.error('插件解析 data 路径失败:', error)
    res.status(400).json({
      success: false,
      message: '解析 data 路径失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

router.get('/tools/tunnel-tool/:tool', async (req: Request, res: Response) => {
  const { tool } = req.params

  try {
    const definition = getTunnelToolDefinition(String(tool || ''))
    const state = await getInstalledTunnelTool(definition.name)

    res.json({
      success: true,
      data: state
    })
  } catch (error) {
    logger.error('插件获取穿透工具安装状态失败:', error)
    res.status(400).json({
      success: false,
      message: '获取穿透工具安装状态失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

router.post('/tools/install-tunnel-tool', async (req: Request, res: Response) => {
  const { tool } = req.body || {}

  try {
    const definition = getTunnelToolDefinition(String(tool || ''))

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    })

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const result = await installTunnelTool(
        definition.name,
        progress => sendEvent('progress', { progress }),
        status => sendEvent('status', { status })
      )

      sendEvent('complete', {
        success: true,
        message: `${definition.label} 安装完成`,
        data: result
      })
      res.end()
    } catch (error) {
      logger.error(`插件安装 ${definition.label} 失败:`, error)
      sendEvent('error', {
        success: false,
        message: `${definition.label} 安装失败`,
        error: error instanceof Error ? error.message : '未知错误'
      })
      res.end()
    }
  } catch (error) {
    logger.error('插件安装穿透工具请求失败:', error)
    if (!res.headersSent) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : '安装请求无效'
      })
    }
  }
})

// ==================== 文件操作API ====================

// 转发文件操作请求到files路由
router.use('/files', filesRouter)

// ==================== 通用API ====================

// 获取API版本信息
router.get('/version', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      version: '1.0.0',
      apiVersion: 'v1',
      pluginApiVersion: '1.0.0',
      timestamp: new Date().toISOString()
    }
  })
})

// 健康检查
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  })
})

export default router
