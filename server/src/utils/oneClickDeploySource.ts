import axios from 'axios'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import logger from './logger.js'
import { ONE_CLICK_DEPLOY_LIST_URL } from './remoteSources.js'
import { isSponsorDownloadUrl } from './sponsorDownload.js'

/**
 * 一键开服（原「在线部署」）云端清单。
 *
 * 清单托管在文件站点上，面板启动后会实时拉取，用于替代旧的第三方在线游戏接口。
 * 赞助者与非赞助者使用同一个下载地址，区别只在下载请求是否携带赞助者会话 Cookie
 * （下载服务据此把请求调度到专用节点），与「环境管理 - Java 安装」的通道规则一致。
 */

export type OneClickDeployPlatform = 'windows' | 'linux' | 'macos'

/** 下载通道：normal 为普通请求，sponsor 为携带赞助者会话的请求 */
export type OneClickDeployChannel = 'normal' | 'sponsor'

/** 某个平台实际生效的下载配置，url 必填 */
export interface OneClickDeployDownloadEntry {
  /** 统一下载地址：赞助者与非赞助者使用同一个 URL */
  url: string
  /** 压缩包文件名，缺省时从下载地址推断 */
  fileName?: string
  /** 压缩包格式，缺省时从文件名或下载地址后缀推断 */
  format?: string
  /** 压缩包体积（字节），仅用于前端展示 */
  size?: number
}

export interface OneClickDeployDownload {
  /** 统一下载地址：赞助者与非赞助者使用同一个 URL */
  url?: string
  /** 压缩包文件名，缺省时从下载地址推断 */
  fileName?: string
  /** 压缩包格式，缺省时从文件名或下载地址后缀推断 */
  format?: string
  /** 压缩包体积（字节），仅用于前端展示 */
  size?: number
  /** 按平台覆盖 download 配置，键为 windows / linux / macos */
  platforms?: Partial<Record<OneClickDeployPlatform, OneClickDeployDownloadEntry>>
}

export interface OneClickDeployGame {
  id: string
  name: string
  description: string
  image: string
  type: string[]
  supportedPlatforms: OneClickDeployPlatform[]
  version: string
  download: OneClickDeployDownload
}

export interface OneClickDeployManifest {
  schemaVersion: number
  updatedAt: string
  notice: string
  games: OneClickDeployGame[]
  /** 解析时被跳过的无效记录，用于提示清单作者；不影响其它记录加载 */
  invalidGames: OneClickDeployInvalidGame[]
}

/** 清单里被跳过的一条无效记录 */
export interface OneClickDeployInvalidGame {
  /** 在 games 数组中的位置，从 1 开始 */
  index: number
  /** 能读到的 id，读不到时为空字符串 */
  id: string
  /** 跳过原因（中文） */
  reason: string
}

export type OneClickDeployManifestOrigin = 'remote' | 'memory-cache' | 'disk-cache'

export interface OneClickDeployManifestMeta {
  /** 清单来源地址 */
  url: string
  schemaVersion: number
  updatedAt: string
  notice: string
  /** 本次返回数据的获取时间 */
  fetchedAt: string
  /** 数据来源：远程 / 内存缓存 / 本地缓存 */
  origin: OneClickDeployManifestOrigin
  /** 被跳过的无效记录，前端据此提示清单作者 */
  invalidGames: OneClickDeployInvalidGame[]
}

export interface OneClickDeployManifestResult {
  manifest: OneClickDeployManifest
  meta: OneClickDeployManifestMeta
}

export interface OneClickDeployResolution {
  url: string
  fileName: string
  format: string
  size?: number
}

export interface FetchOneClickDeployOptions {
  /** 请求超时时间（毫秒），默认 15 秒 */
  timeoutMs?: number
  /** 内存缓存有效期（毫秒），默认 60 秒 */
  cacheTtlMs?: number
  /** 忽略缓存强制拉取 */
  forceRefresh?: boolean
  /** 请求方标识，便于来源区分 */
  userAgent?: string
}

/** 支持的压缩包后缀，按长度倒序匹配，避免 .tar 抢先命中 .tar.gz */
const SUPPORTED_ARCHIVE_SUFFIXES = ['.tar.gz', '.tar.xz', '.tgz', '.txz', '.zip', '.7z', '.tar'] as const

const VALID_PLATFORMS: OneClickDeployPlatform[] = ['windows', 'linux', 'macos']

const DEFAULT_FETCH_TIMEOUT_MS = 15000
const DEFAULT_CACHE_TTL_MS = 60 * 1000
const CACHE_FILE_NAME = 'oneClickDeploy.cache.json'

interface CachedManifest {
  manifest: OneClickDeployManifest
  meta: OneClickDeployManifestMeta
  expiresAt: number
}

let memoryCache: CachedManifest | null = null
let inFlightFetch: Promise<OneClickDeployManifestResult> | null = null

// 内存缓存使用的副本，避免调用方改动污染后续读取
function cloneManifest(manifest: OneClickDeployManifest): OneClickDeployManifest {
  return JSON.parse(JSON.stringify(manifest)) as OneClickDeployManifest
}

/**
 * 把运行平台映射为清单里的平台键。
 * 未知平台按 Linux 处理，与旧在线部署的降级方式一致。
 */
export function getOneClickDeployPlatform(platform: string = process.platform): OneClickDeployPlatform {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'linux'
}

/** 查找平台下载通道时的匹配顺序，macOS 缺少独立通道时回退 Linux */
function getPlatformCandidates(platform: OneClickDeployPlatform): OneClickDeployPlatform[] {
  return platform === 'macos' ? ['macos', 'linux'] : [platform]
}

/** 缓存目录，同时兼容打包后的 data/ 与开发环境的 server/data/ */
function getCacheDirectory(): string {
  const baseDir = process.cwd()
  const possiblePaths = [
    path.join(baseDir, 'server', 'data', 'one-click-deploy'),
    path.join(baseDir, 'data', 'one-click-deploy'),
    path.join(baseDir, '..', 'server', 'data', 'one-click-deploy')
  ]

  return possiblePaths.find(candidate => {
    try {
      // 同步判断父目录是否存在，尽量复用项目已有的数据目录
      fsSync.accessSync(path.dirname(candidate))
      return true
    } catch {
      return false
    }
  }) || possiblePaths[0]
}

function getCacheFilePath(): string {
  return path.join(getCacheDirectory(), CACHE_FILE_NAME)
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toOptionalSize(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
  }
  return undefined
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => toTrimmedString(item))
    .filter(item => item.length > 0)
}

/** 去掉地址上的查询串与哈希，便于判断压缩包后缀 */
function stripUrlExtras(url: string): string {
  return url.toLowerCase().split('?')[0].split('#')[0]
}

/** 从地址或文件名推断压缩包后缀 */
export function getArchiveSuffix(fileNameOrUrl: string): string | null {
  const lowerName = stripUrlExtras(fileNameOrUrl)
  return SUPPORTED_ARCHIVE_SUFFIXES.find(suffix => lowerName.endsWith(suffix)) || null
}

/** 从下载地址推断压缩包文件名，兼容 .tar.gz 这类多段后缀 */
function inferFileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const fileName = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')
    if (fileName) return fileName
  } catch {
    // 非法地址交给后续格式校验处理
  }
  return ''
}

/** 归一化单个下载配置；requireUrl 为 true 时缺少地址直接抛错（平台覆盖条目） */
function normalizeDownloadEntry(raw: unknown, label: string, requireUrl: boolean): OneClickDeployDownload | null {
  if (!raw || typeof raw !== 'object') {
    if (requireUrl) {
      throw new Error(`${label} 缺少 url 下载地址`)
    }
    return null
  }

  const source = raw as Record<string, unknown>
  const url = toTrimmedString(source.url)

  if (!url) {
    if (requireUrl) {
      throw new Error(`${label} 缺少 url 下载地址`)
    }
    // 顶层允许只提供 platforms，此时返回其它可选字段
    const fallbackFileName = toTrimmedString(source.fileName)
    if (!fallbackFileName) {
      return null
    }
    return {
      fileName: fallbackFileName,
      format: toTrimmedString(source.format) || getArchiveSuffix(fallbackFileName)?.replace(/^\./, '') || '',
      size: toOptionalSize(source.size)
    }
  }

  const fileName = toTrimmedString(source.fileName) || inferFileNameFromUrl(url)
  const format = toTrimmedString(source.format) || getArchiveSuffix(fileName)?.replace(/^\./, '') || ''

  if (!fileName) {
    throw new Error(`${label} 缺少有效的下载地址，无法推断压缩包文件名`)
  }

  if (!getArchiveSuffix(fileName)) {
    throw new Error(`${label} 的压缩包格式不受支持（${fileName}），支持: ${SUPPORTED_ARCHIVE_SUFFIXES.join(', ')}`)
  }

  return {
    url,
    fileName,
    format,
    size: toOptionalSize(source.size)
  }
}

/** 归一化下载配置（含按平台覆盖），赞助者与非赞助者共用同一份地址 */
function normalizeDownload(raw: unknown, label: string): OneClickDeployDownload {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${label} 缺少 download 下载配置`)
  }

  const source = raw as Record<string, unknown>
  const base = normalizeDownloadEntry(source, label, false)
  const platforms: Partial<Record<OneClickDeployPlatform, OneClickDeployDownloadEntry>> = {}
  const rawPlatforms = source.platforms

  if (rawPlatforms && typeof rawPlatforms === 'object') {
    for (const platform of VALID_PLATFORMS) {
      const declared = (rawPlatforms as Record<string, unknown>)[platform]
      if (declared === undefined || declared === null) continue

      const entry = normalizeDownloadEntry(declared, `${label}（${platform}）`, true)
      if (entry?.url) {
        platforms[platform] = entry as OneClickDeployDownloadEntry
      }
    }
  }

  if (!base?.url && Object.keys(platforms).length === 0) {
    throw new Error(`${label} 未配置任何下载地址`)
  }

  return {
    ...(base || {}),
    platforms: Object.keys(platforms).length > 0 ? platforms : undefined
  }
}

/**
 * 校验并归一化云端清单。
 *
 * 容错策略：只有「根节点不是对象」或「缺少 games 数组」才判定整份清单失败（由调用方回退缓存）；
 * 单条游戏记录有问题时只跳过该条并记录原因，避免清单里留一条模板记录就导致整个功能不可用。
 * games 为空数组是合法状态，表示云端暂未配置任何游戏。
 */
export function normalizeOneClickDeployManifest(raw: unknown): OneClickDeployManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('一键开服清单格式无效：根节点不是对象')
  }

  const source = raw as Record<string, unknown>
  if (!Array.isArray(source.games)) {
    throw new Error('一键开服清单格式无效：缺少 games 数组')
  }

  const seenIds = new Set<string>()
  const games: OneClickDeployGame[] = []
  const invalidGames: OneClickDeployInvalidGame[] = []

  source.games.forEach((item, index) => {
    const position = index + 1

    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`第 ${position} 条记录不是对象`)
      }

      const entry = item as Record<string, unknown>
      const id = toTrimmedString(entry.id)
      const name = toTrimmedString(entry.name)

      if (!id) {
        throw new Error(`第 ${position} 条记录缺少 id`)
      }
      if (!name) {
        throw new Error(`记录 ${id} 缺少 name`)
      }
      if (seenIds.has(id)) {
        throw new Error(`记录 ${id} 与前面的记录 id 重复`)
      }

      // 平台名统一按小写匹配；全部无法识别时回退为全平台可用
      const declaredPlatforms = normalizeStringArray(entry.supportedPlatforms).map(platform => platform.toLowerCase())
      const matchedPlatforms = VALID_PLATFORMS.filter(platform => declaredPlatforms.includes(platform))
      const supportedPlatforms = declaredPlatforms.length > 0 && matchedPlatforms.length > 0
        ? matchedPlatforms
        : [...VALID_PLATFORMS]

      const download = normalizeDownload(entry.download, `记录 ${id}`)

      seenIds.add(id)
      games.push({
        id,
        name,
        description: toTrimmedString(entry.description),
        image: toTrimmedString(entry.image),
        type: normalizeStringArray(entry.type),
        supportedPlatforms,
        version: toTrimmedString(entry.version),
        download
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误'
      invalidGames.push({
        index: position,
        id: toTrimmedString((item as Record<string, unknown> | null)?.id),
        reason
      })
      logger.warn(`跳过一键开服清单中的无效记录：${reason}`)
    }
  })

  const schemaVersion = Number(source.schemaVersion)

  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? Math.floor(schemaVersion) : 1,
    updatedAt: toTrimmedString(source.updatedAt),
    notice: toTrimmedString(source.notice),
    games,
    invalidGames
  }
}

/** 读取本地缓存清单，失败返回 null */
async function readDiskCache(): Promise<{ manifest: OneClickDeployManifest; meta: OneClickDeployManifestMeta } | null> {
  try {
    const content = await fs.readFile(getCacheFilePath(), 'utf8')
    const parsed = JSON.parse(content) as { manifest?: unknown; meta?: Partial<OneClickDeployManifestMeta> }
    const manifest = normalizeOneClickDeployManifest(parsed?.manifest)

    return {
      manifest,
      meta: {
        url: toTrimmedString(parsed?.meta?.url) || ONE_CLICK_DEPLOY_LIST_URL,
        schemaVersion: manifest.schemaVersion,
        updatedAt: manifest.updatedAt,
        notice: manifest.notice,
        fetchedAt: toTrimmedString(parsed?.meta?.fetchedAt),
        origin: 'disk-cache',
        // 缓存里的记录已经过滤过一次，优先沿用写入时记录的忽略清单
        invalidGames: Array.isArray(parsed?.meta?.invalidGames) ? parsed.meta.invalidGames : manifest.invalidGames
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn(`读取一键开服本地缓存失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
    return null
  }
}

/** 写入本地缓存清单，失败只记录日志 */
async function writeDiskCache(manifest: OneClickDeployManifest, meta: OneClickDeployManifestMeta): Promise<void> {
  try {
    const cacheDirectory = getCacheDirectory()
    await fs.mkdir(cacheDirectory, { recursive: true })
    await fs.writeFile(
      path.join(cacheDirectory, CACHE_FILE_NAME),
      JSON.stringify({ manifest, meta }, null, 2),
      'utf8'
    )
  } catch (error) {
    logger.warn(`写入一键开服本地缓存失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}

/**
 * 拉取一键开服云端清单。
 *
 * 默认使用 60 秒内存缓存，命中缓存时不会请求云端；云端不可用时回退本地缓存，
 * 保证面板至少还能展示上一次成功拉取到的游戏列表。
 */
export async function fetchOneClickDeployManifest(
  options: FetchOneClickDeployOptions = {}
): Promise<OneClickDeployManifestResult> {
  const {
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    forceRefresh = false,
    userAgent = 'GSM3-Server/1.0'
  } = options

  if (!forceRefresh && memoryCache && memoryCache.expiresAt > Date.now()) {
    return {
      manifest: cloneManifest(memoryCache.manifest),
      meta: { ...memoryCache.meta, origin: 'memory-cache' }
    }
  }

  if (!forceRefresh && inFlightFetch) {
    return inFlightFetch
  }

  const task = (async (): Promise<OneClickDeployManifestResult> => {
    try {
      logger.info(`请求一键开服清单: ${ONE_CLICK_DEPLOY_LIST_URL}`)

      const response = await axios.get(ONE_CLICK_DEPLOY_LIST_URL, {
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent
        }
      })

      const manifest = normalizeOneClickDeployManifest(response.data)
      const meta: OneClickDeployManifestMeta = {
        url: ONE_CLICK_DEPLOY_LIST_URL,
        schemaVersion: manifest.schemaVersion,
        updatedAt: manifest.updatedAt,
        notice: manifest.notice,
        fetchedAt: new Date().toISOString(),
        origin: 'remote',
        invalidGames: manifest.invalidGames
      }

      memoryCache = {
        manifest: cloneManifest(manifest),
        meta,
        expiresAt: Date.now() + Math.max(cacheTtlMs, 0)
      }

      await writeDiskCache(manifest, meta)

      if (manifest.games.length === 0) {
        logger.warn('一键开服清单拉取成功，但云端暂未配置任何游戏')
      } else {
        logger.info(`一键开服清单拉取成功，共 ${manifest.games.length} 个游戏`)
      }

      if (manifest.invalidGames.length > 0) {
        logger.warn(`一键开服清单有 ${manifest.invalidGames.length} 条记录格式无效已被忽略`)
      }

      return { manifest, meta }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      logger.error(`拉取一键开服清单失败: ${message}`)

      const diskCache = await readDiskCache()
      if (diskCache) {
        logger.warn('已回退到一键开服本地缓存清单')
        memoryCache = {
          manifest: cloneManifest(diskCache.manifest),
          meta: diskCache.meta,
          expiresAt: Date.now() + Math.max(cacheTtlMs, 0)
        }
        return diskCache
      }

      throw new Error(`无法获取一键开服清单：${message}`)
    } finally {
      inFlightFetch = null
    }
  })()

  inFlightFetch = task
  return task
}

/** 清空内存缓存，主要供测试与手动刷新使用 */
export function clearOneClickDeployManifestCache(): void {
  memoryCache = null
  inFlightFetch = null
}

/** 判断游戏是否支持指定平台 */
export function isOneClickDeployGameSupported(
  game: OneClickDeployGame,
  platform: OneClickDeployPlatform
): boolean {
  return game.supportedPlatforms.includes(platform)
}

/**
 * 该下载地址是否属于赞助者下载服务。
 *
 * 赞助者与非赞助者共用同一个 URL，只有该域名下的地址才支持用会话 Cookie
 * 调度到赞助者专用节点（见 server/src/utils/sponsorDownload.ts）。
 */
export function isOneClickDeploySponsorEligible(url?: string): boolean {
  const normalizedUrl = toTrimmedString(url)
  return Boolean(normalizedUrl) && isSponsorDownloadUrl(normalizedUrl)
}

/** 按游戏 id 查找记录，找不到返回 null */
export function findOneClickDeployGame(
  manifest: OneClickDeployManifest,
  gameId: string
): OneClickDeployGame | null {
  const normalizedId = toTrimmedString(gameId)
  if (!normalizedId) return null

  return manifest.games.find(game => game.id === normalizedId) || null
}

/**
 * 选择某平台实际生效的下载配置。
 * 平台专属配置优先，其次回退到顶层配置。
 */
function pickDownloadEntry(
  download: OneClickDeployDownload,
  platform: OneClickDeployPlatform
): OneClickDeployDownload {
  for (const candidate of getPlatformCandidates(platform)) {
    const platformEntry = download.platforms?.[candidate]
    if (!platformEntry) continue

    return {
      url: platformEntry.url || download.url,
      fileName: platformEntry.fileName || download.fileName,
      format: platformEntry.format || download.format,
      size: platformEntry.size ?? download.size
    }
  }

  return {
    url: download.url,
    fileName: download.fileName,
    format: download.format,
    size: download.size
  }
}

/**
 * 解析某个游戏在当前平台的最终下载地址。
 *
 * 赞助者与非赞助者使用同一个 URL，是否走赞助者专用节点由下载请求决定
 * （见 server/src/utils/sponsorDownload.ts），这里只负责按平台挑出正确地址。
 */
export function resolveOneClickDeployDownload(
  game: OneClickDeployGame,
  platform: OneClickDeployPlatform
): OneClickDeployResolution {
  const entry = pickDownloadEntry(game.download, platform)
  const url = toTrimmedString(entry.url)

  if (!url) {
    throw new Error(`${game.name} 未配置当前平台可用的下载地址`)
  }

  const fileName = entry.fileName || inferFileNameFromUrl(url)
  const suffix = getArchiveSuffix(fileName)
  if (!fileName || !suffix) {
    throw new Error(`${game.name} 的压缩包格式不受支持，支持: ${SUPPORTED_ARCHIVE_SUFFIXES.join(', ')}`)
  }

  return {
    url,
    fileName,
    format: entry.format || suffix.replace(/^\./, ''),
    size: entry.size
  }
}

/** 供前端展示的轻量游戏信息 */
export interface OneClickDeployPublicGame {
  id: string
  name: string
  description: string
  image: string
  type: string[]
  version: string
  supportedPlatforms: OneClickDeployPlatform[]
  size?: number
  format: string
  fileName: string
  /** 统一下载地址，赞助者与非赞助者共用 */
  downloadUrl: string
  /** 该地址是否属于赞助者下载服务，本地记录密钥后可享受专用节点 */
  hasSponsorChannel: boolean
}

/** 把清单记录转换为可下发前端的结构 */
export function toPublicGames(
  manifest: OneClickDeployManifest,
  platform: OneClickDeployPlatform
): OneClickDeployPublicGame[] {
  return manifest.games.map(game => {
    const entry = pickDownloadEntry(game.download, platform)

    return {
      id: game.id,
      name: game.name,
      description: game.description,
      image: game.image,
      type: game.type,
      version: game.version,
      supportedPlatforms: game.supportedPlatforms,
      size: entry.size,
      format: entry.format || getArchiveSuffix(entry.fileName || entry.url || '')?.replace(/^\./, '') || '',
      fileName: entry.fileName || inferFileNameFromUrl(entry.url || ''),
      downloadUrl: entry.url || '',
      // 地址属于赞助者下载服务时，本地记录了密钥即可享受专用节点
      hasSponsorChannel: isOneClickDeploySponsorEligible(entry.url)
    }
  })
}

export { ONE_CLICK_DEPLOY_LIST_URL }