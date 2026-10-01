export type JavaDownloadPlatformKey = 'windows' | 'linux' | 'arm' | 'riscv64'
export type JavaDownloadProviderId = 'sponsor' | 'adoptium'
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
}

export interface JavaCatalogProvider {
  id: JavaCatalogProviderId
  label: string
  description: string
  source: JavaCatalogOptionSource
  sponsorOnly?: boolean
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
  provider: JavaCatalogProviderId
  providerLabel: string
  providerDescription: string
  source: JavaCatalogOptionSource
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
}

export interface JavaDownloadResolution {
  version: string
  provider: JavaDownloadProviderId
  providerLabel: string
  downloadUrl: string
  archiveFileName: string
  sponsorOnly?: boolean
}

interface JavaDownloadCatalogOptions {
  sponsorAvailable?: boolean
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
    presets: ['minecraft-legacy']
  },
  {
    id: 'java11',
    major: 11,
    label: 'Java 11',
    description: 'Java 11 LTS，适合需要较新运行时但尚未迁移到 17 的服务端',
    packageName: 'openjdk-11-jre-headless',
    presets: ['minecraft-transitional']
  },
  {
    id: 'java17',
    major: 17,
    label: 'Java 17',
    description: 'Java 17 LTS，适合 Minecraft 1.18+ 及多数现代服务端',
    packageName: 'openjdk-17-jre-headless',
    presets: ['minecraft-modern']
  },
  {
    id: 'java21',
    major: 21,
    label: 'Java 21',
    description: 'Java 21 LTS，适合 Minecraft 1.20.5+ 及新版本服务端',
    packageName: 'openjdk-21-jre-headless',
    presets: ['minecraft-current', 'latest-lts']
  },
  {
    id: 'java25',
    major: 25,
    label: 'Java 25',
    description: 'Java 25，适合需要最新运行时的实验性场景',
    presets: ['latest-feature']
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
    versions: ['java21']
  },
  {
    id: 'latest-feature',
    label: '最新功能版',
    description: '用于测试需要新 Java 功能的服务端',
    versions: ['java25']
  }
]

const JAVA_PROVIDERS: JavaCatalogProvider[] = [
  {
    id: 'sponsor',
    label: '赞助高速源',
    description: '项目提供的国内高速下载源，需要有效赞助者密钥',
    source: 'download',
    sponsorOnly: true
  },
  {
    id: 'adoptium',
    label: 'Eclipse Temurin',
    description: 'Eclipse Adoptium 官方 latest GA JDK 下载 API',
    source: 'download'
  },
  {
    id: 'system',
    label: '系统包管理器',
    description: '通过 Linux 发行版的软件仓库安装 OpenJDK，适合 riscv64 等特殊架构',
    source: 'package-manager'
  }
]

const SPONSOR_DOWNLOAD_URLS: JavaArtifactMap = {
  java8: {
    windows: 'https://download.xiaozhuhouses.asia/download/v1/links/4GMNQ54kGwuviwcEOfgzVCRSWT6XzNPXp-ByPPVifYk',
    linux: 'https://download.xiaozhuhouses.asia/download/v1/links/WBaVRrXptRSqi0JjLkyYKDB2bnH3T67IQzJT-iPz6bA'
  },
  java11: {
    windows: 'https://download.xiaozhuhouses.asia/download/v1/links/enN1iE0CIwgJWmzDSq8bJJeWDnC1DuCx6IE_24aWQ2s',
    linux: 'https://download.xiaozhuhouses.asia/download/v1/links/_KQdgTNVpgZJZwrLozviN3gE6ZEcEpZZf58NUL9WYOA',
    arm: 'https://download.xiaozhuhouses.asia/download/v1/links/_ya4jKkyMFfDROU87g-oo2E9UnbRaxlgp_govHyDUYU'
  },
  java17: {
    windows: 'https://download.xiaozhuhouses.asia/download/v1/links/4_q8RzaqTgDGmFHQiVz1lMaBl3hTwjAp8YmFx0GtCjs',
    linux: 'https://download.xiaozhuhouses.asia/download/v1/links/oNn4sshvtLJ3V8dJApXecT5axaRLjTBUL5lqBkz0LPs',
    arm: 'https://download.xiaozhuhouses.asia/download/v1/links/9uS3rF5DO_-c_tcaM7BykYdI6ZrtPlnj4IVyVpK4F3Y'
  },
  java21: {
    windows: 'https://download.xiaozhuhouses.asia/download/v1/links/c0Heh97uhMO3_LCfYMr9tQyYCagRpX9Wi5gbm08dtuc',
    linux: 'https://download.xiaozhuhouses.asia/download/v1/links/rFPuJ-HY7XVmg-KnBsXwvtvewxI-2orfe95G949zFa0',
    arm: 'https://download.xiaozhuhouses.asia/download/v1/links/qWLHA8eDvA55KpG9pW35Aj1Ds-CNvuWT4JbO_8zIY9U'
  },
  java25: {
    windows: 'https://download.xiaozhuhouses.asia/download/v1/links/QBmtaNmE_wEATTjQoO0AAEncTPUVjwnCofWUxPY4EH4',
    linux: 'https://download.xiaozhuhouses.asia/download/v1/links/bvANX6e9XuW_nvdO6TmE89tyepAELCyub3wsXhcZMvU',
    arm: 'https://download.xiaozhuhouses.asia/download/v1/links/k-EfIFXJeFtP2DZv-8Fn9SwLCaQWL7HhfIbTkx1xeFk'
  }
}

const JAVA_ARCHIVE_FILE_NAMES: JavaArtifactMap = {
  java8: {
    windows: 'openjdk-8u44-windows-i586.zip',
    linux: 'openjdk-8u44-linux-x64.tar.gz'
  },
  java11: {
    windows: 'openjdk-11.0.0.2_windows-x64.zip',
    linux: 'openjdk-11.0.0.2_linux-x64.tar.gz',
    arm: 'microsoft-jdk-11.0.29-linux-aarch64.tar.gz'
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

const ADOPTIUM_SUPPORTED_VERSIONS_BY_PLATFORM: Record<JavaDownloadPlatformKey, string[]> = {
  windows: ['java8', 'java11', 'java17', 'java21', 'java25'],
  linux: ['java8', 'java11', 'java17', 'java21', 'java25'],
  arm: ['java8', 'java11', 'java17', 'java21', 'java25'],
  riscv64: ['java17', 'java21', 'java25']
}

function formatPlatformArch(platform: string, arch?: string): string {
  return `${platform}/${arch || 'unknown'}`
}

function unsupportedJavaDownloadMessage(platform: string, arch?: string): string {
  return `当前平台/架构暂不支持下载式 Java 安装: ${formatPlatformArch(platform, arch)}。请使用系统包管理器安装 OpenJDK，并在实例中使用系统 PATH 中的 java。`
}

function getJavaVersion(version: string): JavaVersionDefinition {
  const javaVersion = JAVA_VERSIONS.find(item => item.id === version)
  if (!javaVersion) {
    throw new UnsupportedJavaDownloadError(`不支持的 Java 版本: ${version}`)
  }

  return javaVersion
}

function getProvider(provider: JavaCatalogProviderId): JavaCatalogProvider {
  const javaProvider = JAVA_PROVIDERS.find(item => item.id === provider)
  if (!javaProvider) {
    throw new UnsupportedJavaDownloadError(`不支持的 Java 下载源: ${provider}`)
  }

  return javaProvider
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
      `${artifactType} 不支持当前 Java 版本或平台/架构组合: ${version}, ${formatPlatformArch(platform, arch)}。请使用系统包管理器安装 OpenJDK。`
    )
  }

  return artifact
}

function getAdoptiumDownloadUrl(version: string, platform: string, arch?: string): string {
  const javaVersion = getJavaVersion(version)
  const platformKey = getJavaDownloadPlatformKey(platform, arch)
  if (!ADOPTIUM_SUPPORTED_VERSIONS_BY_PLATFORM[platformKey].includes(version)) {
    throw new UnsupportedJavaDownloadError(
      `Eclipse Temurin 暂不提供当前 Java 版本或平台/架构组合: ${version}, ${formatPlatformArch(platform, arch)}。请改用其它版本或系统包管理器安装 OpenJDK。`
    )
  }

  const osName = ADOPTIUM_OS_BY_PLATFORM[platformKey]
  const apiArch = ADOPTIUM_ARCH_BY_PLATFORM[platformKey]

  return `https://api.adoptium.net/v3/binary/latest/${javaVersion.major}/ga/${osName}/${apiArch}/jdk/hotspot/normal/eclipse`
}

function getAdoptiumArchiveFileName(version: string, platform: string, arch?: string): string {
  const javaVersion = getJavaVersion(version)
  const platformKey = getJavaDownloadPlatformKey(platform, arch)
  if (!ADOPTIUM_SUPPORTED_VERSIONS_BY_PLATFORM[platformKey].includes(version)) {
    throw new UnsupportedJavaDownloadError(
      `Eclipse Temurin 暂不提供当前 Java 版本或平台/架构组合: ${version}, ${formatPlatformArch(platform, arch)}。请改用其它版本或系统包管理器安装 OpenJDK。`
    )
  }

  const osName = ADOPTIUM_OS_BY_PLATFORM[platformKey]
  const apiArch = ADOPTIUM_ARCH_BY_PLATFORM[platformKey]
  const extension = platformKey === 'windows' ? 'zip' : 'tar.gz'

  return `temurin-${javaVersion.major}-${osName}-${apiArch}.jdk.${extension}`
}

function buildUnavailableDownloadOption(
  version: JavaVersionDefinition,
  provider: JavaCatalogProvider,
  platform: string,
  arch: string | undefined,
  recommended: boolean,
  message: string
): JavaCatalogOption {
  return {
    id: `${version.id}:${provider.id}`,
    version: version.id,
    versionLabel: version.label,
    provider: provider.id,
    providerLabel: provider.label,
    providerDescription: provider.description,
    source: 'download',
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
  sponsorAvailable: boolean,
  recommended: boolean
): JavaCatalogOption {
  if (provider.id === 'sponsor' && !sponsorAvailable) {
    return buildUnavailableDownloadOption(
      version,
      provider,
      platform,
      arch,
      recommended,
      '赞助高速源需要先配置有效赞助者密钥'
    )
  }

  try {
    const resolution = resolveJavaDownloadOption(version.id, provider.id as JavaDownloadProviderId, platform, arch, {
      sponsorAvailable
    })

    return {
      id: `${version.id}:${provider.id}`,
      version: version.id,
      versionLabel: version.label,
      provider: provider.id,
      providerLabel: provider.label,
      providerDescription: provider.description,
      source: 'download',
      available: true,
      recommended,
      sponsorOnly: provider.sponsorOnly,
      downloadUrl: resolution.downloadUrl,
      archiveFileName: resolution.archiveFileName,
      presets: version.presets
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : unsupportedJavaDownloadMessage(platform, arch)
    return buildUnavailableDownloadOption(version, provider, platform, arch, recommended, message)
  }
}

function buildSystemPackageOption(
  version: JavaVersionDefinition,
  platform: string,
  arch: string | undefined,
  recommended: boolean
): JavaCatalogOption {
  const provider = getProvider('system')
  const available = platform === 'linux' && Boolean(version.packageName)
  const isRiscv64 = platform === 'linux' && (arch || '').toLowerCase() === 'riscv64'

  return {
    id: `${version.id}:system`,
    version: version.id,
    versionLabel: version.label,
    provider: provider.id,
    providerLabel: provider.label,
    providerDescription: provider.description,
    source: 'package-manager',
    available,
    recommended: recommended || isRiscv64,
    packageManager: available ? 'apt' : undefined,
    packageName: available ? version.packageName : undefined,
    unsupportedReason: available ? undefined : '当前版本没有内置的系统包管理器预设',
    presets: version.presets
  }
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
      const recommended = provider.id === (sponsorAvailable ? 'sponsor' : 'adoptium')
      catalogOptions.push(buildDownloadOption(version, provider, platform, arch, sponsorAvailable, recommended))
    }

    catalogOptions.push(buildSystemPackageOption(version, platform, arch, isRiscv64))
  }

  return {
    platform,
    arch: arch || 'unknown',
    platformKey,
    sponsorAvailable,
    providers: JAVA_PROVIDERS,
    presets: JAVA_PRESETS,
    versions: JAVA_VERSIONS,
    options: catalogOptions
  }
}

export function resolveJavaDownloadOption(
  version: string,
  provider: JavaDownloadProviderId,
  platform: string,
  arch?: string,
  options: JavaDownloadCatalogOptions = {}
): JavaDownloadResolution {
  const providerDefinition = getProvider(provider)

  if (provider === 'sponsor') {
    if (!options.sponsorAvailable) {
      throw new UnsupportedJavaDownloadError('赞助高速源需要先配置有效赞助者密钥')
    }

    return {
      version,
      provider,
      providerLabel: providerDefinition.label,
      sponsorOnly: true,
      downloadUrl: getSponsorDownloadUrl(version, platform, arch),
      archiveFileName: getJavaArchiveFileName(version, platform, arch)
    }
  }

  if (provider === 'adoptium') {
    return {
      version,
      provider,
      providerLabel: providerDefinition.label,
      downloadUrl: getAdoptiumDownloadUrl(version, platform, arch),
      archiveFileName: getAdoptiumArchiveFileName(version, platform, arch)
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
