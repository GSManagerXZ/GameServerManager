import axios from 'axios'

export type JavaDownloadPlatformKey = 'windows' | 'linux' | 'arm' | 'riscv64'
export type JavaReleaseChannel = 'ga' | 'ea'
export type JavaDownloadProviderId = 'sponsor' | 'adoptium' | 'azul'
export type JavaCatalogProviderId = JavaDownloadProviderId | 'system'
export type JavaCatalogOptionSource = 'download' | 'package-manager'

type JavaArtifactMap = Record<string, Partial<Record<JavaDownloadPlatformKey, string>>>

export interface JavaVersionDefinition {
  id: string
  major: number
  label: string
  description: string
  packageName?: string
  presets: string[]
  channels: JavaReleaseChannel[]
  defaultChannel: JavaReleaseChannel
}

export interface JavaCatalogProvider {
  id: JavaCatalogProviderId
  label: string
  description: string
  source: JavaCatalogOptionSource
  sponsorOnly?: boolean
  supportsCustomVersion?: boolean
  supportedChannels?: JavaReleaseChannel[]
}

export interface JavaCatalogPreset {
  id: string
  label: string
  description: string
  versions: string[]
}

export interface JavaCatalogOption {
  id: string
  version: string
  versionLabel: string
  major: number
  provider: JavaCatalogProviderId
  providerLabel: string
  providerDescription: string
  source: JavaCatalogOptionSource
  releaseChannel: JavaReleaseChannel
  releaseChannelLabel: string
  available: boolean
  recommended: boolean
  sponsorOnly?: boolean
  downloadUrl?: string
  archiveFileName?: string
  packageManager?: 'apt'
  packageName?: string
  unsupportedReason?: string
  presets: string[]
}

export interface JavaDownloadCatalog {
  platform: string
  arch: string
  platformKey?: JavaDownloadPlatformKey
  sponsorAvailable: boolean
  providers: JavaCatalogProvider[]
  presets: JavaCatalogPreset[]
  versions: JavaVersionDefinition[]
  options: JavaCatalogOption[]
  custom: {
    defaultMajor: number
    defaultChannel: JavaReleaseChannel
    minMajor: number
    maxMajor: number
    providers: JavaDownloadProviderId[]
    channels: JavaReleaseChannel[]
  }
}

export interface JavaDownloadResolution {
  version: string
  major: number
  releaseChannel: JavaReleaseChannel
  provider: JavaDownloadProviderId
  providerLabel: string
  downloadUrl: string
  archiveFileName: string
  sponsorOnly?: boolean
}

interface JavaDownloadCatalogOptions {
  sponsorAvailable?: boolean
}

interface JavaResolutionOptions extends JavaDownloadCatalogOptions {
  releaseChannel?: JavaReleaseChannel
}

interface JavaVersionRequest {
  id: string
  major: number
  label: string
  description: string
  presets: string[]
  packageName?: string
  channels: JavaReleaseChannel[]
  defaultChannel: JavaReleaseChannel
  dynamic: boolean
}

export class UnsupportedJavaDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedJavaDownloadError'
  }
}

const JAVA_VERSIONS: JavaVersionDefinition[] = [
  {
    id: 'java8',
    major: 8,
    label: 'Java 8',
    description: 'Java 8 LTS，适合较老的 Minecraft/Forge 服务端',
    packageName: 'openjdk-8-jre-headless',
    presets: ['minecraft-legacy'],
    channels: ['ga'],
    defaultChannel: 'ga'
  },
  {
    id: 'java11',
    major: 11,
    label: 'Java 11',
    description: 'Java 11 LTS，适合需要较新运行时但尚未迁移到 17 的服务端',
    packageName: 'openjdk-11-jre-headless',
    presets: ['minecraft-transitional'],
    channels: ['ga'],
    defaultChannel: 'ga'
  },
  {
    id: 'java17',
    major: 17,
    label: 'Java 17',
    description: 'Java 17 LTS，适合 Minecraft 1.18+ 及多数现代服务端',
    packageName: 'openjdk-17-jre-headless',
    presets: ['minecraft-modern'],
    channels: ['ga'],
    defaultChannel: 'ga'
  },
  {
    id: 'java21',
    major: 21,
    label: 'Java 21',
    description: 'Java 21 LTS，适合 Minecraft 1.20.5+ 及新版本服务端',
    packageName: 'openjdk-21-jre-headless',
    presets: ['minecraft-current'],
    channels: ['ga'],
    defaultChannel: 'ga'
  },
  {
    id: 'java25',
    major: 25,
    label: 'Java 25',
    description: 'Java 25 LTS，适合需要最新长期支持运行时的场景',
    presets: ['latest-lts'],
    channels: ['ga'],
    defaultChannel: 'ga'
  },
  {
    id: 'java27',
    major: 27,
    label: 'Java 27',
    description: 'Java 27，适合需要最新功能版运行时的实验性场景',
    presets: ['latest-feature'],
    channels: ['ga'],
    defaultChannel: 'ga'
  },
  {
    id: 'java28-ea',
    major: 28,
    label: 'Java 28 EA',
    description: 'Java 28 Early Access，用于测试未来版本兼容性',
    presets: ['early-access'],
    channels: ['ea'],
    defaultChannel: 'ea'
  }
]

const JAVA_PRESETS: JavaCatalogPreset[] = [
  {
    id: 'minecraft-legacy',
    label: '旧版 Minecraft',
    description: 'Minecraft 1.16 及更早版本常用',
    versions: ['java8']
  },
  {
    id: 'minecraft-modern',
    label: '现代 Minecraft',
    description: 'Minecraft 1.18 到 1.20.4 常用',
    versions: ['java17']
  },
  {
    id: 'minecraft-current',
    label: '当前 Minecraft',
    description: 'Minecraft 1.20.5+ 常用',
    versions: ['java21']
  },
  {
    id: 'latest-lts',
    label: '最新 LTS',
    description: '优先选择长期支持版本',
    versions: ['java25']
  },
  {
    id: 'latest-feature',
    label: '最新功能版',
    description: '用于测试需要新 Java 功能的服务端',
    versions: ['java27']
  },
  {
    id: 'early-access',
    label: '预览 / EA',
    description: '用于验证未来 Java 版本',
    versions: ['java28-ea']
  },
  {
    id: 'custom-version',
    label: '自定义版本',
    description: '用户手动选择的 Java 主版本',
    versions: []
  }
]

const JAVA_PROVIDERS: JavaCatalogProvider[] = [
  {
    id: 'sponsor',
    label: '星辰全球下载源',
    description: '星辰全球下载源提供中国大陆地区的高速下载；赞助者享受最高速独享下载通道',
    source: 'download',
    supportedChannels: ['ga']
  },
  {
    id: 'adoptium',
    label: 'Eclipse Temurin',
    description: 'Eclipse Adoptium 官方 latest JDK API，支持 GA 与 EA 通道',
    source: 'download',
    supportsCustomVersion: true,
    supportedChannels: ['ga', 'ea']
  },
  {
    id: 'azul',
    label: 'Azul Zulu',
    description: 'Azul Metadata API，安装时解析最新匹配的 Zulu JDK 包',
    source: 'download',
    supportsCustomVersion: true,
    supportedChannels: ['ga', 'ea']
  },
  {
    id: 'system',
    label: '系统包管理器',
    description: '通过 Linux 发行版的软件仓库安装 OpenJDK，适合 riscv64 等特殊架构',
    source: 'package-manager',
    supportedChannels: ['ga']
  }
]

const SPONSOR_DOWNLOAD_URLS: JavaArtifactMap = {
  java8: {
    windows: 'https://download.xiaozhuhouses.asia/d/e2fb4833ba415b8c500aed2d9b88d401/openjdk-8u44-windows-i586.zip',
    linux: 'https://download.xiaozhuhouses.asia/d/eba19d9b0eb2f5ee0af4aa1410e7e8ea/openjdk-8u44-linux-x64.tar.gz'
  },
  java11: {
    windows: 'https://download.xiaozhuhouses.asia/d/09844c5699181cace0c50838a01b3afa/openjdk-11.0.0.2_windows-x64.zip',
    linux: 'https://download.xiaozhuhouses.asia/d/1ad2d19275d387bf474186213159971b/openjdk-11.0.0.2_linux-x64.tar.gz'
  },
  java17: {
    windows: 'https://download.xiaozhuhouses.asia/d/7dc046a7855530363fac794781bdf767/openjdk-17.0.0.1+2_windows-x64_bin.zip',
    linux: 'https://download.xiaozhuhouses.asia/d/25b171ae761d3222bd0f91ddca373d32/openjdk-17.0.0.1+2_linux-x64_bin.tar.gz',
    arm: 'https://download.xiaozhuhouses.asia/d/8868121de8e1a36192abfe4034ec3a7b/openjdk-17.0.2_linux-aarch64_bin.tar.gz'
  },
  java21: {
    windows: 'https://download.xiaozhuhouses.asia/d/a436ba580cf68550b0a14408105eb8d5/openjdk-21+35_windows-x64_bin.zip',
    linux: 'https://download.xiaozhuhouses.asia/d/521a8c9551a8cd0923825789e3be5054/openjdk-21+35_linux-x64_bin.tar.gz',
    arm: 'https://download.xiaozhuhouses.asia/d/4c5d060a6186d630f4c0cb64cac7c075/openjdk-21_linux-aarch64_bin.tar.gz'
  },
  java25: {
    windows: 'https://download.xiaozhuhouses.asia/d/1e1b2424fef706eb9f13851ad9081aff/openjdk-25+36_windows-x64_bin.zip',
    linux: 'https://download.xiaozhuhouses.asia/d/59e59a84f693481bb7a29802a2ef5253/openjdk-25+36_linux-x64_bin.tar.gz',
    arm: 'https://download.xiaozhuhouses.asia/d/a6f7a6c56d31bcb9c47927fb55386343/openjdk-25.0.2_linux-aarch64_bin.tar.gz'
  },
  java27: {
    windows: 'https://download.xiaozhuhouses.asia/d/b1b2ce98fd714e8202a6d0cd8893237e/openjdk-27+35_windows-x64_bin.zip',
    linux: 'https://download.xiaozhuhouses.asia/d/57849c8d615de1b355d88ba2fa2d6bf2/openjdk-27+35_linux-x64_bin.tar.gz'
  }
}

const JAVA_ARCHIVE_FILE_NAMES: JavaArtifactMap = {
  java8: {
    windows: 'openjdk-8u44-windows-i586.zip',
    linux: 'openjdk-8u44-linux-x64.tar.gz'
  },
  java11: {
    windows: 'openjdk-11.0.0.2_windows-x64.zip',
    linux: 'openjdk-11.0.0.2_linux-x64.tar.gz'
  },
  java17: {
    windows: 'openjdk-17.0.0.1+2_windows-x64_bin.zip',
    linux: 'openjdk-17.0.0.1+2_linux-x64_bin.tar.gz',
    arm: 'openjdk-17.0.2_linux-aarch64_bin.tar.gz'
  },
  java21: {
    windows: 'openjdk-21+35_windows-x64_bin.zip',
    linux: 'openjdk-21+35_linux-x64_bin.tar.gz',
    arm: 'openjdk-21_linux-aarch64_bin.tar.gz'
  },
  java25: {
    windows: 'openjdk-25+36_windows-x64_bin.zip',
    linux: 'openjdk-25+36_linux-x64_bin.tar.gz',
    arm: 'openjdk-25.0.2_linux-aarch64_bin.tar.gz'
  },
  java27: {
    windows: 'openjdk-27+35_windows-x64_bin.zip',
    linux: 'openjdk-27+35_linux-x64_bin.tar.gz'
  }
}

const ADOPTIUM_OS_BY_PLATFORM: Record<JavaDownloadPlatformKey, string> = {
  windows: 'windows',
  linux: 'linux',
  arm: 'linux',
  riscv64: 'linux'
}

const ADOPTIUM_ARCH_BY_PLATFORM: Record<JavaDownloadPlatformKey, string> = {
  windows: 'x64',
  linux: 'x64',
  arm: 'aarch64',
  riscv64: 'riscv64'
}

const ADOPTIUM_SUPPORTED_KNOWN_VERSIONS_BY_PLATFORM: Record<JavaDownloadPlatformKey, string[]> = {
  windows: ['java8', 'java11', 'java17', 'java21', 'java25', 'java27', 'java28-ea'],
  linux: ['java8', 'java11', 'java17', 'java21', 'java25', 'java27', 'java28-ea'],
  arm: ['java8', 'java11', 'java17', 'java21', 'java25', 'java27', 'java28-ea'],
  riscv64: ['java17', 'java21', 'java25', 'java27', 'java28-ea']
}

const AZUL_OS_BY_PLATFORM: Partial<Record<JavaDownloadPlatformKey, string>> = {
  windows: 'windows',
  linux: 'linux',
  arm: 'linux'
}

const AZUL_ARCH_BY_PLATFORM: Partial<Record<JavaDownloadPlatformKey, string>> = {
  windows: 'x64',
  linux: 'x64',
  arm: 'aarch64'
}

function formatPlatformArch(platform: string, arch?: string): string {
  return `${platform}/${arch || 'unknown'}`
}

function getReleaseChannelLabel(channel: JavaReleaseChannel): string {
  return channel === 'ea' ? 'EA / 预览版' : 'GA / 稳定版'
}

function normalizeReleaseChannel(channel?: string): JavaReleaseChannel {
  return channel === 'ea' ? 'ea' : 'ga'
}

function unsupportedJavaDownloadMessage(platform: string, arch?: string): string {
  return `当前平台/架构暂不支持下载式 Java 安装: ${formatPlatformArch(platform, arch)}。请使用系统包管理器安装 OpenJDK，并在实例中使用系统 PATH 中的 java。`
}

function getProvider(provider: JavaCatalogProviderId): JavaCatalogProvider {
  const javaProvider = JAVA_PROVIDERS.find(item => item.id === provider)
  if (!javaProvider) {
    throw new UnsupportedJavaDownloadError(`不支持的 Java 下载源: ${provider}`)
  }

  return javaProvider
}

function getVersionInstallId(major: number, channel: JavaReleaseChannel): string {
  return channel === 'ea' ? `java${major}-ea` : `java${major}`
}

function parseJavaVersionRequest(version: string, releaseChannel?: JavaReleaseChannel): JavaVersionRequest {
  const predefined = JAVA_VERSIONS.find(item => item.id === version)
  if (predefined) {
    const channel = releaseChannel || predefined.defaultChannel
    if (!predefined.channels.includes(channel)) {
      throw new UnsupportedJavaDownloadError(`${predefined.label} 不支持 ${getReleaseChannelLabel(channel)} 通道`)
    }

    return {
      ...predefined,
      defaultChannel: channel,
      dynamic: false
    }
  }

  const match = /^java(\d+)(?:-(ga|ea))?$/i.exec(version)
  if (!match) {
    throw new UnsupportedJavaDownloadError(`不支持的 Java 版本: ${version}`)
  }

  const major = Number(match[1])
  if (!Number.isInteger(major) || major < 8 || major > 99) {
    throw new UnsupportedJavaDownloadError(`Java 主版本号超出支持范围: ${version}`)
  }

  const channel = releaseChannel || normalizeReleaseChannel(match[2])
  const id = getVersionInstallId(major, channel)

  return {
    id,
    major,
    label: `Java ${major}${channel === 'ea' ? ' EA' : ''}`,
    description: channel === 'ea'
      ? `Java ${major} Early Access，自定义预览版运行时`
      : `Java ${major}，自定义稳定版运行时`,
    presets: channel === 'ea' ? ['early-access'] : ['custom-version'],
    channels: ['ga', 'ea'],
    defaultChannel: channel,
    dynamic: true
  }
}

export function getJavaDownloadPlatformKey(platform: string, arch?: string): JavaDownloadPlatformKey {
  const normalizedArch = (arch || '').toLowerCase()

  if (platform === 'win32') {
    if (!normalizedArch || normalizedArch === 'x64' || normalizedArch === 'x86_64' || normalizedArch === 'amd64') {
      return 'windows'
    }

    throw new UnsupportedJavaDownloadError(unsupportedJavaDownloadMessage(platform, arch))
  }

  if (platform !== 'linux') {
    throw new UnsupportedJavaDownloadError(unsupportedJavaDownloadMessage(platform, arch))
  }

  if (normalizedArch === 'x64' || normalizedArch === 'x86_64' || normalizedArch === 'amd64') {
    return 'linux'
  }

  if (normalizedArch === 'arm64' || normalizedArch === 'aarch64') {
    return 'arm'
  }

  if (normalizedArch === 'riscv64') {
    return 'riscv64'
  }

  throw new UnsupportedJavaDownloadError(unsupportedJavaDownloadMessage(platform, arch))
}

function getJavaArtifact(
  artifacts: JavaArtifactMap,
  version: string,
  platform: string,
  arch: string | undefined,
  artifactType: string
): string {
  const platformKey = getJavaDownloadPlatformKey(platform, arch)
  const artifact = artifacts[version]?.[platformKey]

  if (!artifact) {
    throw new UnsupportedJavaDownloadError(
      `${artifactType} 不支持当前 Java 版本或平台/架构组合: ${version}, ${formatPlatformArch(platform, arch)}。请使用其它提供商或系统包管理器安装 OpenJDK。`
    )
  }

  return artifact
}

function getAdoptiumDownloadUrl(version: JavaVersionRequest, platform: string, arch?: string): string {
  const platformKey = getJavaDownloadPlatformKey(platform, arch)
  if (!version.dynamic && !ADOPTIUM_SUPPORTED_KNOWN_VERSIONS_BY_PLATFORM[platformKey].includes(version.id)) {
    throw new UnsupportedJavaDownloadError(
      `Eclipse Temurin 暂不提供当前 Java 版本或平台/架构组合: ${version.id}, ${formatPlatformArch(platform, arch)}。请改用其它版本或系统包管理器安装 OpenJDK。`
    )
  }

  const osName = ADOPTIUM_OS_BY_PLATFORM[platformKey]
  const apiArch = ADOPTIUM_ARCH_BY_PLATFORM[platformKey]

  return `https://api.adoptium.net/v3/binary/latest/${version.major}/${version.defaultChannel}/${osName}/${apiArch}/jdk/hotspot/normal/eclipse`
}

function getAdoptiumArchiveFileName(version: JavaVersionRequest, platform: string, arch?: string): string {
  const platformKey = getJavaDownloadPlatformKey(platform, arch)
  if (!version.dynamic && !ADOPTIUM_SUPPORTED_KNOWN_VERSIONS_BY_PLATFORM[platformKey].includes(version.id)) {
    throw new UnsupportedJavaDownloadError(
      `Eclipse Temurin 暂不提供当前 Java 版本或平台/架构组合: ${version.id}, ${formatPlatformArch(platform, arch)}。请改用其它版本或系统包管理器安装 OpenJDK。`
    )
  }

  const osName = ADOPTIUM_OS_BY_PLATFORM[platformKey]
  const apiArch = ADOPTIUM_ARCH_BY_PLATFORM[platformKey]
  const extension = platformKey === 'windows' ? 'zip' : 'tar.gz'

  return `temurin-${version.major}-${version.defaultChannel}-${osName}-${apiArch}.jdk.${extension}`
}

function getAzulPlatform(platform: string, arch?: string): { osName: string; archName: string; archiveType: string } {
  const platformKey = getJavaDownloadPlatformKey(platform, arch)
  const osName = AZUL_OS_BY_PLATFORM[platformKey]
  const archName = AZUL_ARCH_BY_PLATFORM[platformKey]

  if (!osName || !archName) {
    throw new UnsupportedJavaDownloadError(`Azul Zulu 暂不支持当前平台/架构组合: ${formatPlatformArch(platform, arch)}`)
  }

  return {
    osName,
    archName,
    archiveType: platformKey === 'windows' ? 'zip' : 'tar.gz'
  }
}

function getFileNameFromUrl(url: string, fallback: string): string {
  try {
    const fileName = new URL(url).pathname.split('/').filter(Boolean).pop()
    return fileName || fallback
  } catch {
    return fallback
  }
}

async function resolveAzulDownload(version: JavaVersionRequest, platform: string, arch?: string): Promise<{ downloadUrl: string; archiveFileName: string }> {
  const { osName, archName, archiveType } = getAzulPlatform(platform, arch)
  const params = new URLSearchParams({
    java_version: String(version.major),
    os: osName,
    arch: archName,
    archive_type: archiveType,
    java_package_type: 'jdk',
    javafx_bundled: 'false',
    crac_supported: 'false',
    release_status: version.defaultChannel,
    availability_types: 'CA',
    latest: 'true',
    page: '1',
    page_size: '1'
  })

  const response = await axios.get(`https://api.azul.com/metadata/v1/zulu/packages/?${params.toString()}`, {
    timeout: 15000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GSManager3/1.0.0'
    }
  })

  const packageInfo = Array.isArray(response.data) ? response.data[0] : undefined
  const downloadUrl = typeof packageInfo?.download_url === 'string' ? packageInfo.download_url : ''
  if (!downloadUrl) {
    throw new UnsupportedJavaDownloadError(
      `Azul Zulu 未找到匹配的 Java ${version.major} ${getReleaseChannelLabel(version.defaultChannel)} 包: ${formatPlatformArch(platform, arch)}`
    )
  }

  return {
    downloadUrl,
    archiveFileName: typeof packageInfo.name === 'string'
      ? packageInfo.name
      : getFileNameFromUrl(downloadUrl, `zulu-${version.major}-${version.defaultChannel}-${osName}-${archName}.${archiveType}`)
  }
}

function buildUnavailableDownloadOption(
  version: JavaVersionDefinition,
  provider: JavaCatalogProvider,
  platform: string,
  arch: string | undefined,
  channel: JavaReleaseChannel,
  recommended: boolean,
  message: string
): JavaCatalogOption {
  return {
    id: `${version.id}:${provider.id}:${channel}`,
    version: version.id,
    versionLabel: version.label,
    major: version.major,
    provider: provider.id,
    providerLabel: provider.label,
    providerDescription: provider.description,
    source: 'download',
    releaseChannel: channel,
    releaseChannelLabel: getReleaseChannelLabel(channel),
    available: false,
    recommended,
    sponsorOnly: provider.sponsorOnly,
    unsupportedReason: message || unsupportedJavaDownloadMessage(platform, arch),
    presets: version.presets
  }
}

function buildDownloadOption(
  version: JavaVersionDefinition,
  provider: JavaCatalogProvider,
  platform: string,
  arch: string | undefined,
  channel: JavaReleaseChannel,
  recommended: boolean
): JavaCatalogOption {
  if (!provider.supportedChannels?.includes(channel)) {
    return buildUnavailableDownloadOption(version, provider, platform, arch, channel, recommended, `${provider.label} 不支持 ${getReleaseChannelLabel(channel)} 通道`)
  }

  if (provider.id === 'azul') {
    try {
      getAzulPlatform(platform, arch)
      return {
        id: `${version.id}:${provider.id}:${channel}`,
        version: version.id,
        versionLabel: version.label,
        major: version.major,
        provider: provider.id,
        providerLabel: provider.label,
        providerDescription: provider.description,
        source: 'download',
        releaseChannel: channel,
        releaseChannelLabel: getReleaseChannelLabel(channel),
        available: true,
        recommended,
        presets: version.presets
      }
    } catch (error) {
      return buildUnavailableDownloadOption(
        version,
        provider,
        platform,
        arch,
        channel,
        recommended,
        error instanceof Error ? error.message : unsupportedJavaDownloadMessage(platform, arch)
      )
    }
  }

  try {
    const request = parseJavaVersionRequest(version.id, channel)
    const downloadUrl = provider.id === 'sponsor'
      ? getSponsorDownloadUrl(version.id, platform, arch)
      : getAdoptiumDownloadUrl(request, platform, arch)
    const archiveFileName = provider.id === 'sponsor'
      ? getJavaArchiveFileName(version.id, platform, arch)
      : getAdoptiumArchiveFileName(request, platform, arch)

    return {
      id: `${version.id}:${provider.id}:${channel}`,
      version: version.id,
      versionLabel: version.label,
      major: version.major,
      provider: provider.id,
      providerLabel: provider.label,
      providerDescription: provider.description,
      source: 'download',
      releaseChannel: channel,
      releaseChannelLabel: getReleaseChannelLabel(channel),
      available: true,
      recommended,
      sponsorOnly: provider.sponsorOnly,
      downloadUrl,
      archiveFileName,
      presets: version.presets
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : unsupportedJavaDownloadMessage(platform, arch)
    return buildUnavailableDownloadOption(version, provider, platform, arch, channel, recommended, message)
  }
}

function buildSystemPackageOption(
  version: JavaVersionDefinition,
  platform: string,
  arch: string | undefined,
  recommended: boolean
): JavaCatalogOption {
  const provider = getProvider('system')
  const available = platform === 'linux' && Boolean(version.packageName) && version.defaultChannel === 'ga'
  const isRiscv64 = platform === 'linux' && (arch || '').toLowerCase() === 'riscv64'

  return {
    id: `${version.id}:system:ga`,
    version: version.id,
    versionLabel: version.label,
    major: version.major,
    provider: provider.id,
    providerLabel: provider.label,
    providerDescription: provider.description,
    source: 'package-manager',
    releaseChannel: 'ga',
    releaseChannelLabel: getReleaseChannelLabel('ga'),
    available,
    recommended: recommended || isRiscv64,
    packageManager: available ? 'apt' : undefined,
    packageName: available ? version.packageName : undefined,
    unsupportedReason: available ? undefined : '当前版本没有内置的系统包管理器预设',
    presets: version.presets
  }
}

function getOptionPriority(option: JavaCatalogOption): number {
  if (option.available && option.source === 'download' && option.recommended) return 0
  if (option.available && option.source === 'download') return 1
  if (option.available && option.source === 'package-manager' && option.recommended) return 2
  if (option.available) return 3
  return 4
}

const PROVIDER_SORT_ORDER: Record<JavaCatalogProviderId, number> = {
  sponsor: 0,
  adoptium: 1,
  azul: 2,
  system: 3
}

function sortJavaOptions(options: JavaCatalogOption[]): JavaCatalogOption[] {
  return options.sort((left, right) => {
    const priorityDiff = getOptionPriority(left) - getOptionPriority(right)
    if (priorityDiff !== 0) return priorityDiff

    return PROVIDER_SORT_ORDER[left.provider] - PROVIDER_SORT_ORDER[right.provider]
  })
}

export function getJavaDownloadCatalog(
  platform: string,
  arch?: string,
  options: JavaDownloadCatalogOptions = {}
): JavaDownloadCatalog {
  const sponsorAvailable = Boolean(options.sponsorAvailable)
  let platformKey: JavaDownloadPlatformKey | undefined

  try {
    platformKey = getJavaDownloadPlatformKey(platform, arch)
  } catch (error) {
    platformKey = undefined
  }

  const catalogOptions: JavaCatalogOption[] = []
  const isRiscv64 = platform === 'linux' && (arch || '').toLowerCase() === 'riscv64'

  for (const version of JAVA_VERSIONS) {
    for (const provider of JAVA_PROVIDERS.filter(item => item.source === 'download')) {
      for (const channel of version.channels) {
        const recommended = (
          provider.id === 'sponsor' && channel === version.defaultChannel
        )
        catalogOptions.push(buildDownloadOption(version, provider, platform, arch, channel, recommended))
      }
    }

    catalogOptions.push(buildSystemPackageOption(version, platform, arch, isRiscv64))
  }

  const sortedOptions = JAVA_VERSIONS.flatMap(version => (
    sortJavaOptions(catalogOptions.filter(option => option.version === version.id))
  ))

  return {
    platform,
    arch: arch || 'unknown',
    platformKey,
    sponsorAvailable,
    providers: JAVA_PROVIDERS,
    presets: JAVA_PRESETS,
    versions: JAVA_VERSIONS,
    options: sortedOptions,
    custom: {
      defaultMajor: 25,
      defaultChannel: 'ga',
      minMajor: 8,
      maxMajor: 99,
      providers: ['adoptium', 'azul'],
      channels: ['ga', 'ea']
    }
  }
}

export async function resolveJavaDownloadOption(
  version: string,
  provider: JavaDownloadProviderId,
  platform: string,
  arch?: string,
  options: JavaResolutionOptions = {}
): Promise<JavaDownloadResolution> {
  const providerDefinition = getProvider(provider)
  const versionRequest = parseJavaVersionRequest(version, options.releaseChannel)

  if (!providerDefinition.supportedChannels?.includes(versionRequest.defaultChannel)) {
    throw new UnsupportedJavaDownloadError(`${providerDefinition.label} 不支持 ${getReleaseChannelLabel(versionRequest.defaultChannel)} 通道`)
  }

  if (provider === 'sponsor') {
    if (versionRequest.dynamic) {
      throw new UnsupportedJavaDownloadError('星辰全球下载源仅支持项目维护的预设版本')
    }

    return {
      version: versionRequest.id,
      major: versionRequest.major,
      releaseChannel: versionRequest.defaultChannel,
      provider,
      providerLabel: providerDefinition.label,
      downloadUrl: getSponsorDownloadUrl(versionRequest.id, platform, arch),
      archiveFileName: getJavaArchiveFileName(versionRequest.id, platform, arch)
    }
  }

  if (provider === 'adoptium') {
    return {
      version: versionRequest.id,
      major: versionRequest.major,
      releaseChannel: versionRequest.defaultChannel,
      provider,
      providerLabel: providerDefinition.label,
      downloadUrl: getAdoptiumDownloadUrl(versionRequest, platform, arch),
      archiveFileName: getAdoptiumArchiveFileName(versionRequest, platform, arch)
    }
  }

  if (provider === 'azul') {
    const resolved = await resolveAzulDownload(versionRequest, platform, arch)
    return {
      version: versionRequest.id,
      major: versionRequest.major,
      releaseChannel: versionRequest.defaultChannel,
      provider,
      providerLabel: providerDefinition.label,
      downloadUrl: resolved.downloadUrl,
      archiveFileName: resolved.archiveFileName
    }
  }

  throw new UnsupportedJavaDownloadError(`不支持的 Java 下载源: ${provider}`)
}

export function getSponsorDownloadUrl(version: string, platform: string, arch?: string): string {
  return getJavaArtifact(SPONSOR_DOWNLOAD_URLS, version, platform, arch, 'Java 赞助版下载链接')
}

export function getJavaArchiveFileName(version: string, platform: string, arch?: string): string {
  return getJavaArtifact(JAVA_ARCHIVE_FILE_NAMES, version, platform, arch, 'Java 压缩包')
}

export function getSupportedJavaVersions(): JavaVersionDefinition[] {
  return JAVA_VERSIONS
}
