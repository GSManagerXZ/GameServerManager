import { spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import axios from 'axios'

export type PtyAssetKey =
  | 'linux-x64'
  | 'linux-arm64'
  | 'win32-x64'

export interface PtyAsset {
  key: PtyAssetKey
  platform: 'linux' | 'win32'
  arch: 'x64' | 'arm64'
  assetId: number
  name: string
  size: number
  sha256: string
}

export interface EnsurePtyAssetOptions {
  asset: PtyAsset
  targetDir: string
  token?: string
  logger?: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
}

export const PTY_RELEASE_ID = 297277624
export const PTY_BUILD_COMMIT =
  '09fc369dfa278504831260de2771d7cbd98d01c4'

export const PTY_ASSETS: Record<PtyAssetKey, PtyAsset> = {
  'linux-x64': {
    key: 'linux-x64',
    platform: 'linux',
    arch: 'x64',
    assetId: 374651721,
    name: 'pty_linux_x64',
    size: 2654360,
    sha256: 'bbdfc8a5d0f57493e78c64bca56d370524c068c1d4d31cac653458a843d47f72'
  },
  'linux-arm64': {
    key: 'linux-arm64',
    platform: 'linux',
    arch: 'arm64',
    assetId: 374651727,
    name: 'pty_linux_arm64',
    size: 2752664,
    sha256: '48d8496997053b60eb84d2b02f4ec751298c7f214c615b08aca43309739ebf83'
  },
  'win32-x64': {
    key: 'win32-x64',
    platform: 'win32',
    arch: 'x64',
    assetId: 374651714,
    name: 'pty_win32_x64.exe',
    size: 3627520,
    sha256: 'fe35c154e623707d0dd2b728f41fd200bd3ead0a8cda8eb216b1e5e3e3ab2d40'
  }
}

const GITHUB_API_HOST = 'api.github.com'
const GITHUB_API_HEADERS = {
  'User-Agent': 'GameServerManager-PTY-Installer',
  'X-GitHub-Api-Version': '2022-11-28'
}
const PROBE_TIMEOUT_MS = 3000
const PROBE_TERMINATION_GRACE_MS = 500
const PROBE_OUTPUT_LIMIT = 64 * 1024
const FILE_REMOVE_RETRY_DELAYS_MS = [25, 50, 100] as const
const probeCache = new Map<string, Promise<void>>()
const ensureCache = new Map<string, Promise<string>>()

class PtyAssetRollbackError extends Error {
  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'PtyAssetRollbackError'
    ;(this as any).cause = cause
  }
}

interface GitHubReleaseAsset {
  id: number
  name: string
  size: number
}

interface GitHubRelease {
  id: number
  assets: GitHubReleaseAsset[]
}

export function getPtyAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): PtyAsset {
  const key = `${platform}-${arch}`
  if (key === 'linux-x64' || key === 'linux-arm64' || key === 'win32-x64') {
    return PTY_ASSETS[key]
  }

  throw new Error(`不支持的 PTY 平台或架构: ${platform}/${arch}`)
}

export async function verifyPtyAsset(
  filePath: string,
  asset: PtyAsset
): Promise<boolean> {
  if (path.basename(filePath) !== asset.name) {
    return false
  }

  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size !== asset.size) {
      return false
    }

    const hash = createHash('sha256')
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk as Buffer)
    }
    return hash.digest('hex') === asset.sha256
  } catch {
    return false
  }
}

function getProbeCacheKey(filePath: string): string {
  return `${process.pid}:${path.resolve(filePath)}`
}

function clearProbeCache(filePath: string): void {
  probeCache.delete(getProbeCacheKey(filePath))
}

function isNativeAsset(asset: PtyAsset): boolean {
  return asset.platform === process.platform && asset.arch === process.arch
}

async function runPtyProbe(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(filePath, ['-h'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const output: Buffer[] = []
    const terminationDetails: string[] = []
    let outputBytes = 0
    let settled = false
    let terminationError: Error | null = null
    let timeout: NodeJS.Timeout | null = null
    let terminationWatchdog: NodeJS.Timeout | null = null

    const stopCollecting = () => {
      child.stdout?.off('data', collect)
      child.stderr?.off('data', collect)
    }

    const clearTimers = () => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (terminationWatchdog) {
        clearTimeout(terminationWatchdog)
        terminationWatchdog = null
      }
    }

    const removeProcessListeners = () => {
      child.off('error', onError)
      child.off('close', onClose)
    }

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimers()
      stopCollecting()
      removeProcessListeners()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const buildTerminationError = (cannotConfirmTermination = false): Error => {
      const parts = [terminationError?.message || 'PTY 探测进程终止失败']
      parts.push(...terminationDetails)
      if (cannotConfirmTermination) {
        parts.push(`等待 ${PROBE_TERMINATION_GRACE_MS}ms 后无法确认探测进程已终止`)
      }
      return new Error(parts.join('；'))
    }

    const tryKill = (stage: string) => {
      try {
        if (!child.kill('SIGKILL')) {
          terminationDetails.push(`${stage} child.kill 返回 false`)
        }
      } catch (killError) {
        terminationDetails.push(`${stage} child.kill 失败: ${killError instanceof Error ? killError.message : String(killError)}`)
      }
    }

    const onTerminationGraceExpired = () => {
      if (settled) return
      tryKill('termination grace 到期再次')
      stopCollecting()
      child.stdout?.destroy()
      child.stderr?.destroy()
      finish(buildTerminationError(true))
    }

    const requestTermination = (error: Error) => {
      if (settled || terminationError) return
      terminationError = error
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      stopCollecting()
      terminationWatchdog = setTimeout(
        onTerminationGraceExpired,
        PROBE_TERMINATION_GRACE_MS
      )
      terminationWatchdog.unref?.()
      tryKill('首次')
    }

    const collect = (chunk: Buffer) => {
      if (settled || terminationError) return
      outputBytes += chunk.length
      if (outputBytes >= PROBE_OUTPUT_LIMIT) {
        requestTermination(new Error(`PTY 探测输出超过 ${PROBE_OUTPUT_LIMIT} 字节限制`))
        return
      }
      output.push(Buffer.from(chunk))
    }

    function onError(error: Error): void {
      if (terminationError) {
        terminationDetails.push(`探测进程 error: ${error.message}`)
        return
      }
      finish(error)
    }

    function onClose(code: number | null): void {
      if (settled) return
      if (terminationError) {
        finish(buildTerminationError())
        return
      }
      if (code !== 0) {
        finish(new Error(`PTY 探测失败，退出码: ${code}`))
        return
      }

      const helpText = Buffer.concat(output).toString('utf8')
      if (!helpText.includes('-fifo')) {
        finish(new Error('PTY 不支持必需的 -fifo 参数'))
        return
      }
      finish()
    }

    timeout = setTimeout(() => {
      requestTermination(new Error(`PTY 探测超时（${PROBE_TIMEOUT_MS}ms）`))
    }, PROBE_TIMEOUT_MS)
    timeout.unref?.()

    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

export async function probePtyAsset(
  filePath: string,
  asset: PtyAsset
): Promise<void> {
  if (!isNativeAsset(asset)) {
    throw new Error(`拒绝探测非本机 PTY 资产: ${asset.platform}/${asset.arch}`)
  }
  if (!await verifyPtyAsset(filePath, asset)) {
    throw new Error(`PTY 资产校验失败，拒绝执行: ${filePath}`)
  }

  const cacheKey = getProbeCacheKey(filePath)
  const cached = probeCache.get(cacheKey)
  if (cached) {
    return cached
  }

  let probePromise: Promise<void>
  probePromise = runPtyProbe(filePath).catch(error => {
    if (probeCache.get(cacheKey) === probePromise) {
      probeCache.delete(cacheKey)
    }
    throw error
  })
  probeCache.set(cacheKey, probePromise)
  return probePromise
}

function assertCanonicalAsset(asset: PtyAsset): void {
  const canonical = PTY_ASSETS[asset.key]
  if (
    !canonical ||
    canonical.platform !== asset.platform ||
    canonical.arch !== asset.arch ||
    canonical.assetId !== asset.assetId ||
    canonical.name !== asset.name ||
    canonical.size !== asset.size ||
    canonical.sha256 !== asset.sha256
  ) {
    throw new Error(`PTY 资产不在固定清单中: ${asset.key}`)
  }
}

function createGithubHeaders(accept: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    ...GITHUB_API_HEADERS,
    Accept: accept
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function removeAuthorizationOnUntrustedRedirect(options: Record<string, any>): void {
  if (String(options.hostname || '').toLowerCase() === GITHUB_API_HOST) {
    return
  }

  const headers = options.headers || {}
  for (const headerName of Object.keys(headers)) {
    if (headerName.toLowerCase() === 'authorization') {
      delete headers[headerName]
    }
  }
  delete options.auth
}

async function validateReleaseAsset(asset: PtyAsset, token?: string): Promise<void> {
  const response = await axios.get<GitHubRelease>(
    `https://${GITHUB_API_HOST}/repos/MCSManager/PTY/releases/${PTY_RELEASE_ID}`,
    {
      headers: createGithubHeaders('application/vnd.github+json', token),
      timeout: 60000,
      maxRedirects: 5,
      beforeRedirect: removeAuthorizationOnUntrustedRedirect
    }
  )
  const release = response.data
  if (!release || release.id !== PTY_RELEASE_ID || !Array.isArray(release.assets)) {
    throw new Error(`GitHub PTY release 元数据不匹配: ${PTY_RELEASE_ID}`)
  }

  const matches = release.assets.filter(candidate =>
    candidate.id === asset.assetId &&
    candidate.name === asset.name &&
    candidate.size === asset.size
  )
  if (matches.length !== 1) {
    throw new Error(`GitHub PTY release 资产元数据不唯一或不匹配: ${asset.name}`)
  }
}

async function downloadAsset(asset: PtyAsset, tempPath: string, token?: string): Promise<void> {
  const response = await axios.get(
    `https://${GITHUB_API_HOST}/repos/MCSManager/PTY/releases/assets/${asset.assetId}`,
    {
      headers: createGithubHeaders('application/octet-stream', token),
      responseType: 'stream',
      timeout: 60000,
      maxRedirects: 5,
      beforeRedirect: removeAuthorizationOnUntrustedRedirect
    }
  )

  let downloadedBytes = 0
  const sizeLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length
      if (downloadedBytes > asset.size) {
        callback(new Error(`PTY 下载数据超过固定大小: ${asset.size}`))
        return
      }
      callback(null, chunk)
    }
  })

  await pipeline(
    response.data,
    sizeLimiter,
    createWriteStream(tempPath, { flags: 'wx' })
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isBusyFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EBUSY'
}

function isPotentialRenameRace(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM' ||
    code === 'EACCES' || code === 'ENOENT'
}

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function removeFileWithRetry(filePath: string, label: string): Promise<void> {
  let lastError: unknown

  for (let attempt = 0; attempt <= FILE_REMOVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rm(filePath, { force: true })
      return
    } catch (error) {
      lastError = error
      if (!isBusyFileError(error) || attempt === FILE_REMOVE_RETRY_DELAYS_MS.length) {
        break
      }
      await wait(FILE_REMOVE_RETRY_DELAYS_MS[attempt])
    }
  }

  throw new Error(`清理${label}失败: ${filePath}: ${getErrorMessage(lastError)}`)
}

function clearReplacementProbeCaches(...filePaths: string[]): void {
  for (const filePath of filePaths) {
    clearProbeCache(filePath)
  }
}

function isPtyBackupName(fileName: string, asset: PtyAsset): boolean {
  const prefix = `.${asset.name}.`
  const suffix = '.bak'
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    return false
  }

  const identity = fileName.slice(prefix.length, -suffix.length)
  // 兼容两种格式：`<pid>.<token>`（旧格式）与 `<pid>.<token>.<ts>`（内嵌创建时间戳）。
  return /^\d+\.[0-9a-f]{24}(\.\d+)?$/.test(identity)
}

/**
 * 解析 backup 名中的 owner marker（PID + 随机 token），
 * 与 replacePtyAssetTransaction 的命名 `.<name>.<pid>.<token>[.<ts>].bak` 一致。
 */
function parsePtyBackupOwner(
  fileName: string,
  asset: PtyAsset
): number | null {
  const prefix = `.${asset.name}.`
  const suffix = '.bak'
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    return null
  }

  const identity = fileName.slice(prefix.length, -suffix.length)
  const match = /^(\d+)\.([0-9a-f]{24})(?:\.(\d+))?$/.exec(identity)
  return match ? Number(match[1]) : null
}

/**
 * 解析 backup 名内嵌的创建时间戳（新格式 `.<name>.<pid>.<token>.<ts>.bak`）。
 * 旧格式（无时间戳）返回 null。创建时间来自文件名本身而不是文件系统 mtime：
 * backup 由 link/rename 创建，会继承旧 target 的 mtime，用它判年龄会把刚创建、
 * owner 仍存活的 in-flight backup 误判为过期。
 */
function parsePtyBackupCreatedAt(
  fileName: string,
  asset: PtyAsset
): number | null {
  const prefix = `.${asset.name}.`
  const suffix = '.bak'
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    return null
  }

  const identity = fileName.slice(prefix.length, -suffix.length)
  const match = /^(\d+)\.([0-9a-f]{24})\.(\d+)$/.exec(identity)
  return match ? Number(match[3]) : null
}

function isPtyBackupOwnerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** 备份存在超过该时长且 owner 仍存活时视为过期（PID 复用兜底）。 */
const PTY_BACKUP_STALE_AGE_MS = 30 * 60 * 1000

/**
 * 只清理/恢复过期 backup；owner 仍存活且新鲜的 backup 属于另一进程
 * in-flight 的替换事务，进程 B 不得删除，也不能把它当作遗留备份恢复。
 * stale 判定 = owner 已死（ESRCH）或内嵌创建时间戳超过 STALE_AGE；
 * 不依赖 backup 文件的 mtime（link/rename 创建时继承旧 target 的 mtime）。
 * 旧格式（无内嵌时间戳）backup 且 owner 存活时无法安全判定年龄，保守视为 in-flight。
 */
function isPtyBackupStale(
  fileName: string,
  asset: PtyAsset
): boolean {
  const ownerPid = parsePtyBackupOwner(fileName, asset)
  if (ownerPid === null || !isPtyBackupOwnerAlive(ownerPid)) {
    return true
  }
  const createdAt = parsePtyBackupCreatedAt(fileName, asset)
  if (createdAt !== null) {
    return Date.now() - createdAt > PTY_BACKUP_STALE_AGE_MS
  }
  return false
}

async function cleanupPtyAssetBackups(
  backupPaths: string[],
  logger?: EnsurePtyAssetOptions['logger']
): Promise<void> {
  for (const backupPath of backupPaths) {
    try {
      await removeFileWithRetry(backupPath, '遗留 PTY 备份文件')
      clearProbeCache(backupPath)
    } catch (error) {
      logger?.warn(`PTY 遗留备份清理失败: ${backupPath}: ${getErrorMessage(error)}`)
    }
  }
}

async function recoverPtyAssetBackups(
  targetPath: string,
  asset: PtyAsset,
  logger?: EnsurePtyAssetOptions['logger']
): Promise<void> {
  const targetDir = path.dirname(targetPath)
  const backupNames = (await fs.readdir(targetDir))
    .filter(fileName => isPtyBackupName(fileName, asset))
    .sort()
  if (backupNames.length === 0) {
    return
  }

  // 跨进程 owner 分区：in-flight 事务（owner 存活且新鲜）的 backup 既不能删除
  // 也不能用于恢复；只有过期 backup（owner 已死或超龄）才参与遗留清理/恢复。
  const backupPathsByName = new Map<string, string>()
  for (const fileName of backupNames) {
    backupPathsByName.set(fileName, path.join(targetDir, fileName))
  }
  const staleBackupNames: string[] = []
  for (const fileName of backupNames) {
    const backupPath = backupPathsByName.get(fileName)!
    // fs.stat 错误只把 ENOENT（已被删除）视为可清理，其他错误保守跳过：
    // 不删除、不恢复，避免在 stat 不可用时误破坏另一进程的备份。
    try {
      const backupStat = await fs.stat(backupPath)
      if (!backupStat.isFile()) {
        continue
      }
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException)?.code === 'ENOENT') {
        continue
      }
      logger?.warn(`PTY 备份文件状态检查失败，保守跳过: ${backupPath}: ${getErrorMessage(statError)}`)
      continue
    }
    if (isPtyBackupStale(fileName, asset)) {
      staleBackupNames.push(fileName)
    }
  }
  if (backupNames.length > staleBackupNames.length) {
    logger?.info(
      `检测到 ${backupNames.length - staleBackupNames.length} 个进行中的 PTY 替换备份（保留），` +
      `过期备份 ${staleBackupNames.length} 个`
    )
  }
  if (staleBackupNames.length === 0) {
    return
  }

  const backupNames2 = staleBackupNames
  const backupPaths = backupNames2.map(fileName => backupPathsByName.get(fileName)!)
  clearReplacementProbeCaches(targetPath, ...backupPaths)

  // 删除 stale backup 前，对当前 target 做与正常 ensure 一致的 probe 级校验
  // （不能只靠 size/SHA）；target 不可 probe 时保留 backup，留作恢复路径。
  let targetUsable = false
  if (await verifyPtyAsset(targetPath, asset)) {
    if (!isNativeAsset(asset)) {
      targetUsable = true
    } else {
      try {
        await probePtyAsset(targetPath, asset)
        targetUsable = true
      } catch {
        logger?.warn(`现有 PTY 目标不可执行，保留过期备份: ${targetPath}`)
      }
    }
  }

  if (targetUsable) {
    await cleanupPtyAssetBackups(backupPaths, logger)
    return
  }

  let trustedBackup: { path: string; asset: PtyAsset } | null = null
  for (let index = 0; index < backupNames2.length; index += 1) {
    const backupName = backupNames2[index]
    const backupPath = backupPaths[index]
    const backupAsset: PtyAsset = { ...asset, name: backupName }
    if (!await verifyPtyAsset(backupPath, backupAsset)) {
      continue
    }

    try {
      if (isNativeAsset(asset)) {
        await probePtyAsset(backupPath, backupAsset)
      }
      trustedBackup = { path: backupPath, asset: backupAsset }
      break
    } catch {
      clearProbeCache(backupPath)
    }
  }

  if (!trustedBackup) {
    // target 不可用且无可信 backup：保留过期备份（不删除），等待下次 ensure 或离线下载；
    // 不可 probe 的 target 下删除备份会失去唯一本地恢复路径。
    logger?.warn(`PTY 目标不可用且无可信备份，保留过期备份以待恢复: ${targetPath}`)
    return
  }

  if (process.platform === 'win32') {
    await removeFileWithRetry(targetPath, '无效 PTY 目标文件')
  }
  await fs.rename(trustedBackup.path, targetPath)
  clearReplacementProbeCaches(targetPath, trustedBackup.path)

  if (!await verifyPtyAsset(targetPath, asset)) {
    throw new Error(`恢复后的 PTY 资产校验失败: ${targetPath}`)
  }
  if (isNativeAsset(asset)) {
    await probePtyAsset(targetPath, asset)
  }

  logger?.info(`已恢复可信 PTY 备份: ${targetPath}`)
  await cleanupPtyAssetBackups(
    backupPaths.filter(backupPath => backupPath !== trustedBackup.path),
    logger
  )
}

async function replacePtyAssetTransaction(
  tempPath: string,
  targetPath: string,
  asset: PtyAsset
): Promise<void> {
  // 名称内嵌创建时间戳：backup 由 link/rename 创建会继承旧 target 的 mtime，
  // 跨进程 stale 判定必须使用独立时间来源（文件名内嵌时间戳），不能依赖文件 mtime。
  const backupName = `.${asset.name}.${process.pid}.${randomBytes(12).toString('hex')}.${Date.now()}.bak`
  const backupPath = path.join(path.dirname(targetPath), backupName)
  let backupExists = false
  let targetHasDownloadedAsset = false

  clearReplacementProbeCaches(tempPath, targetPath, backupPath)

  try {
    try {
      if (process.platform === 'win32') {
        await fs.rename(targetPath, backupPath)
      } else {
        await fs.link(targetPath, backupPath)
      }
      backupExists = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error
      }
    }

    clearReplacementProbeCaches(tempPath, targetPath, backupPath)
    await fs.rename(tempPath, targetPath)
    targetHasDownloadedAsset = true
    clearReplacementProbeCaches(tempPath, targetPath, backupPath)

    if (!await verifyPtyAsset(targetPath, asset)) {
      throw new Error(`安装后的 PTY 资产校验失败: ${targetPath}`)
    }
    if (isNativeAsset(asset)) {
      await probePtyAsset(targetPath, asset)
    }

    if (backupExists) {
      await removeFileWithRetry(backupPath, 'PTY 备份文件')
      backupExists = false
    }
  } catch (error) {
    const rollbackErrors: string[] = []
    clearReplacementProbeCaches(tempPath, targetPath, backupPath)

    if (process.platform !== 'win32' && backupExists) {
      try {
        if (targetHasDownloadedAsset) {
          await fs.rename(backupPath, targetPath)
          targetHasDownloadedAsset = false
        } else {
          await removeFileWithRetry(backupPath, 'PTY 备份文件')
        }
        backupExists = false
      } catch (rollbackError) {
        rollbackErrors.push(`恢复原 PTY: ${getErrorMessage(rollbackError)}`)
      }
    } else {
      if (targetHasDownloadedAsset) {
        try {
          await fs.rename(targetPath, tempPath)
          targetHasDownloadedAsset = false
        } catch (rollbackError) {
          if ((rollbackError as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            rollbackErrors.push(`移走失败的新 PTY: ${getErrorMessage(rollbackError)}`)
          }
        }
      }

      if (backupExists) {
        try {
          await fs.rename(backupPath, targetPath)
          backupExists = false
        } catch (rollbackError) {
          rollbackErrors.push(`恢复原 PTY: ${getErrorMessage(rollbackError)}`)
        }
      }
    }

    clearReplacementProbeCaches(tempPath, targetPath, backupPath)
    if (rollbackErrors.length > 0) {
      throw new PtyAssetRollbackError(
        `PTY 替换失败且回滚未完成: ${rollbackErrors.join('; ')}；原始错误: ${getErrorMessage(error)}`,
        error
      )
    }
    throw error
  }
}

async function verifyConcurrentWinner(targetPath: string, asset: PtyAsset): Promise<boolean> {
  clearProbeCache(targetPath)
  if (!await verifyPtyAsset(targetPath, asset)) {
    return false
  }

  try {
    if (isNativeAsset(asset)) {
      await probePtyAsset(targetPath, asset)
    }
    return true
  } catch {
    return false
  }
}

async function ensurePtyAssetInternal(
  options: EnsurePtyAssetOptions,
  targetPath: string
): Promise<string> {
  const { asset, token, logger } = options
  const targetDir = path.dirname(targetPath)
  const targetStat = await fs.stat(targetDir)
  if (!targetStat.isDirectory()) {
    throw new Error(`PTY 目标路径不是目录: ${targetDir}`)
  }

  await recoverPtyAssetBackups(targetPath, asset, logger)

  if (await verifyPtyAsset(targetPath, asset)) {
    try {
      if (isNativeAsset(asset)) {
        await probePtyAsset(targetPath, asset)
      }
      logger?.info(`PTY 资产已通过校验: ${targetPath}`)
      return targetPath
    } catch {
      logger?.warn(`现有 PTY 资产探测失败，将下载固定版本: ${targetPath}`)
    }
  } else {
    logger?.warn(`现有 PTY 资产缺失或校验失败，将下载固定版本: ${targetPath}`)
  }

  await validateReleaseAsset(asset, token)

  const tempName = `.${asset.name}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
  const tempPath = path.join(targetDir, tempName)
  const tempAsset: PtyAsset = { ...asset, name: tempName }
  let resultPath: string | null = null
  let installError: unknown

  try {
    logger?.info(`正在下载固定 PTY 资产: ${asset.name}`)
    await downloadAsset(asset, tempPath, token)

    if (process.platform !== 'win32') {
      await fs.chmod(tempPath, 0o755)
    }
    if (!await verifyPtyAsset(tempPath, tempAsset)) {
      throw new Error(`下载的 PTY 资产校验失败: ${asset.name}`)
    }
    if (isNativeAsset(asset)) {
      await probePtyAsset(tempPath, tempAsset)
    }

    await replacePtyAssetTransaction(tempPath, targetPath, asset)
    resultPath = targetPath
  } catch (error) {
    if (
      !(error instanceof PtyAssetRollbackError) &&
      isPotentialRenameRace(error) &&
      await verifyConcurrentWinner(targetPath, asset)
    ) {
      logger?.info(`检测到并发进程已安装可信 PTY 资产: ${targetPath}`)
      resultPath = targetPath
    } else {
      installError = error
    }
  }

  try {
    await removeFileWithRetry(tempPath, '临时 PTY 文件')
  } catch (cleanupError) {
    logger?.error(`PTY 临时文件清理失败: ${asset.name}`)
    if (installError) {
      const combinedError = new Error(
        `${getErrorMessage(cleanupError)}；原始安装错误: ${getErrorMessage(installError)}`
      )
      ;(combinedError as any).cause = installError
      throw combinedError
    }
    throw cleanupError
  }

  if (installError) {
    logger?.error(`PTY 资产安装失败: ${asset.name}`)
    throw installError
  }
  if (!resultPath) {
    throw new Error(`PTY 资产安装未返回有效路径: ${asset.name}`)
  }

  logger?.info(`PTY 资产安装完成: ${resultPath}`)
  return resultPath
}

export async function ensurePtyAsset(
  options: EnsurePtyAssetOptions
): Promise<string> {
  assertCanonicalAsset(options.asset)
  const targetPath = path.resolve(options.targetDir, options.asset.name)
  const cached = ensureCache.get(targetPath)
  if (cached) {
    return cached
  }

  let ensurePromise: Promise<string>
  ensurePromise = ensurePtyAssetInternal(options, targetPath).finally(() => {
    if (ensureCache.get(targetPath) === ensurePromise) {
      ensureCache.delete(targetPath)
    }
  })
  ensureCache.set(targetPath, ensurePromise)
  return ensurePromise
}
