import axios from 'axios'
import { execFile } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { createWriteStream, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import * as unzipper from 'unzipper'
import { getDefaultEasyTierDataRoot } from './easytierPaths.js'
import {
  EasyTierInstallation,
  EasyTierInstallationStatus
} from './easytierTypes.js'

const execFileAsync = promisify(execFile)
const MAX_ARCHIVE_BYTES = 160 * 1024 * 1024
const MAX_EXECUTABLE_BYTES = 80 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 240 * 1024 * 1024
const CURRENT_INSTALLATION_FILE = 'current.json'
const INSTALLATION_METADATA_FILE = 'install.json'
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com'
])

export const EASYTIER_RECOMMENDED_VERSION = 'v2.6.4'

interface EasyTierInstallerOptions {
  dataRoot?: string
  logger?: any
}

interface EasyTierAssetTarget {
  platform: string
  architecture: string
  artifactName: string
}

interface EasyTierReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  digest?: string | null
}

interface EasyTierReleaseResponse {
  tag_name: string
  assets: EasyTierReleaseAsset[]
}

interface EasyTierInstallationPointer {
  version: string
  artifactName: string
  platform: string
  architecture: string
  installedAt: string
  sha256?: string
}

export class EasyTierInstallError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'EASYTIER_INSTALL_ERROR', status = 422) {
    super(message)
    this.name = 'EasyTierInstallError'
    this.code = code
    this.status = status
  }
}

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const assertTrustedDownloadUrl = (value: string, requireRepositoryPath = false): void => {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new EasyTierInstallError('EasyTier 下载地址格式无效', 'EASYTIER_ASSET_URL_INVALID', 502)
  }
  if (target.protocol !== 'https:' || !TRUSTED_DOWNLOAD_HOSTS.has(target.hostname.toLowerCase())) {
    throw new EasyTierInstallError('EasyTier 下载地址未通过安全校验', 'EASYTIER_ASSET_URL_INVALID', 502)
  }
  if (
    (requireRepositoryPath || target.hostname.toLowerCase() === 'github.com') &&
    !target.pathname.startsWith('/EasyTier/EasyTier/releases/download/')
  ) {
    throw new EasyTierInstallError('EasyTier 下载路径未通过安全校验', 'EASYTIER_ASSET_URL_INVALID', 502)
  }
}

const normalizeVersion = (version: string): string => {
  const normalized = String(version || '').trim()
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new EasyTierInstallError('EasyTier 版本号格式无效', 'EASYTIER_VERSION_INVALID', 400)
  }
  return normalized
}

const resolveAssetTarget = (version: string): EasyTierAssetTarget | undefined => {
  const cleanVersion = version.replace(/^v/, '')
  const platform = process.platform
  const architecture = process.arch
  let assetPlatform: string | undefined
  let assetArchitecture: string | undefined

  if (platform === 'linux') {
    assetPlatform = 'linux'
    const linuxArchitectures: Record<string, string> = {
      x64: 'x86_64',
      arm64: 'aarch64',
      arm: 'armv7hf',
      riscv64: 'riscv64',
      loong64: 'loongarch64'
    }
    assetArchitecture = linuxArchitectures[architecture]
    if (architecture === 'mips') assetArchitecture = os.endianness() === 'LE' ? 'mipsel' : 'mips'
  } else if (platform === 'win32') {
    assetPlatform = 'windows'
    assetArchitecture = ({ x64: 'x86_64', arm64: 'arm64', ia32: 'i686' } as Record<string, string>)[architecture]
  } else if (platform === 'darwin') {
    assetPlatform = 'macos'
    assetArchitecture = ({ x64: 'x86_64', arm64: 'aarch64' } as Record<string, string>)[architecture]
  } else if (platform === 'freebsd' && architecture === 'x64') {
    assetPlatform = 'freebsd-13.2'
    assetArchitecture = 'x86_64'
  }

  if (!assetPlatform || !assetArchitecture) return undefined
  return {
    platform,
    architecture,
    artifactName: `easytier-${assetPlatform}-${assetArchitecture}-v${cleanVersion}.zip`
  }
}

export class EasyTierInstaller {
  readonly dataRoot: string
  readonly binRoot: string
  private readonly downloadsRoot: string
  private readonly logger: any
  private installationPromise?: Promise<EasyTierInstallation>

  constructor(options: EasyTierInstallerOptions = {}) {
    this.dataRoot = path.resolve(options.dataRoot || getDefaultEasyTierDataRoot())
    this.binRoot = path.join(this.dataRoot, 'bin')
    this.downloadsRoot = path.join(this.dataRoot, 'downloads')
    this.logger = options.logger || console
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.binRoot, { recursive: true, mode: 0o700 })
    await fs.mkdir(this.downloadsRoot, { recursive: true, mode: 0o700 })
  }

  async getStatus(): Promise<EasyTierInstallationStatus> {
    const target = resolveAssetTarget(EASYTIER_RECOMMENDED_VERSION)
    const status: EasyTierInstallationStatus = {
      recommendedVersion: EASYTIER_RECOMMENDED_VERSION,
      platform: process.platform,
      architecture: process.arch,
      supported: Boolean(target),
      ...(target ? { artifactName: target.artifactName } : {
        unsupportedReason: `当前平台不支持自动安装: ${process.platform}/${process.arch}`
      })
    }

    try {
      const pointer = await this.readPointer()
      const installation = await this.resolveInstallation(pointer)
      return { ...status, installation }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`读取 EasyTier 安装状态失败: ${error instanceof Error ? error.message : String(error)}`)
      }
      return status
    }
  }

  async installRecommended(force = false): Promise<EasyTierInstallation> {
    if (this.installationPromise) return this.installationPromise
    this.installationPromise = this.install(EASYTIER_RECOMMENDED_VERSION, force)
      .finally(() => { this.installationPromise = undefined })
    return this.installationPromise
  }

  private async install(versionInput: string, force: boolean): Promise<EasyTierInstallation> {
    await this.initialize()
    const version = normalizeVersion(versionInput)
    const target = resolveAssetTarget(version)
    if (!target) {
      throw new EasyTierInstallError(
        `当前平台不支持自动安装: ${process.platform}/${process.arch}`,
        'EASYTIER_PLATFORM_UNSUPPORTED',
        409
      )
    }

    if (!force) {
      const currentStatus = await this.getStatus()
      if (currentStatus.installation?.version === version) return currentStatus.installation
    }

    const asset = await this.fetchReleaseAsset(version, target.artifactName)
    const operationId = randomUUID()
    const archivePath = path.join(this.downloadsRoot, `.easytier-${operationId}.zip`)
    const stagingDirectory = path.join(this.binRoot, `.install-${operationId}`)
    const targetDirectory = path.join(this.binRoot, version)
    const backupDirectory = path.join(this.binRoot, `.backup-${operationId}`)
    let preserveInstallationBackup = false

    try {
      const sha256 = await this.downloadAsset(asset, archivePath)
      await this.extractExecutables(archivePath, stagingDirectory)
      await this.verifyInstallation(stagingDirectory, version)

      const installedAt = new Date().toISOString()
      const pointer: EasyTierInstallationPointer = {
        version,
        artifactName: target.artifactName,
        platform: process.platform,
        architecture: process.arch,
        installedAt,
        sha256
      }
      await fs.writeFile(
        path.join(stagingDirectory, INSTALLATION_METADATA_FILE),
        `${JSON.stringify(pointer, null, 2)}\n`,
        { encoding: 'utf-8', mode: 0o600 }
      )

      const targetExists = await pathExists(targetDirectory)
      if (targetExists) await fs.rename(targetDirectory, backupDirectory)
      try {
        await fs.rename(stagingDirectory, targetDirectory)
        await this.writePointer(pointer)
      } catch (error) {
        await fs.rm(targetDirectory, { recursive: true, force: true }).catch(() => undefined)
        if (targetExists) {
          try {
            await fs.rename(backupDirectory, targetDirectory)
          } catch (rollbackError) {
            preserveInstallationBackup = true
            throw new Error(
              `EasyTier 安装提交失败 (${error instanceof Error ? error.message : String(error)})，且恢复原安装失败；备份保留在 ${backupDirectory}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            )
          }
        }
        throw error
      }
      await fs.rm(backupDirectory, { recursive: true, force: true }).catch(error => {
        this.logger.warn(`清理 EasyTier 安装备份失败，将保留目录 ${backupDirectory}: ${error instanceof Error ? error.message : String(error)}`)
      })

      const installation = await this.resolveInstallation(pointer)
      this.logger.info(`EasyTier ${version} 已安装到 ${targetDirectory}`)
      return installation
    } catch (error) {
      if (error instanceof EasyTierInstallError) throw error
      throw new EasyTierInstallError(
        `EasyTier 安装失败: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      await fs.rm(archivePath, { force: true }).catch(() => undefined)
      await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
      if (!preserveInstallationBackup) {
        await fs.rm(backupDirectory, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  private async fetchReleaseAsset(version: string, artifactName: string): Promise<EasyTierReleaseAsset> {
    const endpoint = `https://api.github.com/repos/EasyTier/EasyTier/releases/tags/${encodeURIComponent(version)}`
    let release: EasyTierReleaseResponse
    try {
      const response = await axios.get<EasyTierReleaseResponse>(endpoint, {
        timeout: 15_000,
        maxRedirects: 0,
        maxContentLength: 2 * 1024 * 1024,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'GSM3-EasyTier-Manager'
        }
      })
      release = response.data
    } catch (error) {
      throw new EasyTierInstallError(
        `无法读取 EasyTier ${version} 发布信息，请检查到 GitHub 的网络连接`,
        'EASYTIER_RELEASE_UNAVAILABLE',
        502
      )
    }
    const asset = release.assets.find(item => item.name === artifactName)
    if (!asset) {
      throw new EasyTierInstallError(
        `EasyTier ${version} 未提供当前平台安装包 ${artifactName}`,
        'EASYTIER_ASSET_NOT_FOUND',
        404
      )
    }
    assertTrustedDownloadUrl(asset.browser_download_url, true)
    if (!Number.isFinite(asset.size) || asset.size <= 0 || asset.size > MAX_ARCHIVE_BYTES) {
      throw new EasyTierInstallError('EasyTier 安装包大小异常', 'EASYTIER_ASSET_SIZE_INVALID', 502)
    }
    if (!asset.digest?.match(/^sha256:[0-9a-f]{64}$/i)) {
      throw new EasyTierInstallError(
        'EasyTier 发布资产未提供可信 SHA-256 摘要，已拒绝安装',
        'EASYTIER_ASSET_DIGEST_MISSING',
        502
      )
    }
    return asset
  }

  private async downloadAsset(asset: EasyTierReleaseAsset, destination: string): Promise<string> {
    assertTrustedDownloadUrl(asset.browser_download_url, true)
    const response = await axios.get(asset.browser_download_url, {
      responseType: 'stream',
      timeout: 120_000,
      maxRedirects: 5,
      beforeRedirect: options => {
        const target = String(options.href || `${options.protocol}//${options.hostname}${options.path || '/'}`)
        assertTrustedDownloadUrl(target)
      },
      maxContentLength: MAX_ARCHIVE_BYTES,
      maxBodyLength: MAX_ARCHIVE_BYTES,
      headers: { 'User-Agent': 'GSM3-EasyTier-Manager' }
    })
    const expectedDigest = asset.digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1]?.toLowerCase()
    if (!expectedDigest) throw new Error('EasyTier 安装包缺少可信 SHA-256 摘要')
    const hash = createHash('sha256')
    let receivedBytes = 0
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_ARCHIVE_BYTES) {
          callback(new Error('EasyTier 安装包超过允许大小'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    await pipeline(response.data, verifier, createWriteStream(destination, { mode: 0o600 }))
    if (receivedBytes !== asset.size) throw new Error(`下载大小不匹配 (${receivedBytes}/${asset.size})`)
    const actualDigest = hash.digest('hex')
    if (actualDigest !== expectedDigest) throw new Error('EasyTier 安装包 SHA-256 校验失败')
    return actualDigest
  }

  private async extractExecutables(archivePath: string, destination: string): Promise<void> {
    await fs.mkdir(destination, { recursive: true, mode: 0o700 })
    const extension = process.platform === 'win32' ? '.exe' : ''
    const expectedFiles = [
      `easytier-core${extension}`,
      `easytier-cli${extension}`,
      `easytier-web${extension}`,
      `easytier-web-embed${extension}`
    ]
    const archive = await unzipper.Open.file(archivePath)
    let totalExtractedBytes = 0
    for (const fileName of expectedFiles) {
      const matches = archive.files.filter(entry => entry.type === 'File' && path.posix.basename(entry.path) === fileName)
      if (matches.length !== 1) throw new Error(`安装包中缺少唯一的 ${fileName}`)
      if (matches[0].uncompressedSize > MAX_EXECUTABLE_BYTES) throw new Error(`${fileName} 解压大小异常`)
      const destinationPath = path.join(destination, fileName)
      let fileBytes = 0
      const extractionLimiter = new Transform({
        transform(chunk, _encoding, callback) {
          const chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
          fileBytes += chunkBytes
          totalExtractedBytes += chunkBytes
          if (fileBytes > MAX_EXECUTABLE_BYTES || totalExtractedBytes > MAX_EXTRACTED_BYTES) {
            callback(new Error(`${fileName} 解压大小超过安全限制`))
            return
          }
          callback(null, chunk)
        }
      })
      await pipeline(matches[0].stream(), extractionLimiter, createWriteStream(destinationPath, { mode: 0o755 }))
      if (process.platform !== 'win32') await fs.chmod(destinationPath, 0o755)
    }
  }

  private async verifyInstallation(directory: string, version: string): Promise<void> {
    const extension = process.platform === 'win32' ? '.exe' : ''
    const corePath = path.join(directory, `easytier-core${extension}`)
    const webEmbedPath = path.join(directory, `easytier-web-embed${extension}`)
    const [{ stdout: coreVersion }, { stdout: webVersion }] = await Promise.all([
      execFileAsync(corePath, ['--version'], { timeout: 10_000, windowsHide: true }),
      execFileAsync(webEmbedPath, ['--version'], { timeout: 10_000, windowsHide: true })
    ])
    const expectedVersion = version.replace(/^v/, '')
    if (!String(coreVersion).includes(expectedVersion) || !String(webVersion).includes(expectedVersion)) {
      throw new Error(`安装包版本校验失败，预期 ${expectedVersion}`)
    }
  }

  private async readPointer(): Promise<EasyTierInstallationPointer> {
    const content = await fs.readFile(path.join(this.binRoot, CURRENT_INSTALLATION_FILE), 'utf-8')
    try {
      return JSON.parse(content) as EasyTierInstallationPointer
    } catch {
      throw new EasyTierInstallError(
        'EasyTier 安装指针文件格式无效，请重新安装',
        'EASYTIER_INSTALL_POINTER_INVALID',
        500
      )
    }
  }

  private async writePointer(pointer: EasyTierInstallationPointer): Promise<void> {
    const targetPath = path.join(this.binRoot, CURRENT_INSTALLATION_FILE)
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
    const replacementBackup = `${targetPath}.${randomUUID()}.backup`
    let preserveBackup = false
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(pointer, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600
      })
      if (process.platform === 'win32' && await pathExists(targetPath)) {
        await fs.rename(targetPath, replacementBackup)
        try {
          await fs.rename(temporaryPath, targetPath)
        } catch (error) {
          try {
            await fs.rename(replacementBackup, targetPath)
          } catch (rollbackError) {
            preserveBackup = true
            throw new Error(
              `更新 EasyTier 安装指针失败，原指针保留在 ${replacementBackup}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            )
          }
          throw error
        }
      } else {
        await fs.rename(temporaryPath, targetPath)
      }
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      if (!preserveBackup) await fs.rm(replacementBackup, { force: true }).catch(() => undefined)
    }
  }

  private async resolveInstallation(pointer: EasyTierInstallationPointer): Promise<EasyTierInstallation> {
    const directory = path.join(this.binRoot, normalizeVersion(pointer.version))
    const extension = process.platform === 'win32' ? '.exe' : ''
    const paths = {
      corePath: path.join(directory, `easytier-core${extension}`),
      cliPath: path.join(directory, `easytier-cli${extension}`),
      webPath: path.join(directory, `easytier-web${extension}`),
      webEmbedPath: path.join(directory, `easytier-web-embed${extension}`)
    }
    const exists = await Promise.all(Object.values(paths).map(pathExists))
    if (exists.some(value => !value)) throw Object.assign(new Error('EasyTier 安装不完整'), { code: 'ENOENT' })
    return {
      version: pointer.version,
      artifactName: pointer.artifactName,
      platform: pointer.platform,
      architecture: pointer.architecture,
      installedAt: pointer.installedAt,
      directory,
      ...paths,
      ...(pointer.sha256 ? { sha256: pointer.sha256 } : {})
    }
  }
}
