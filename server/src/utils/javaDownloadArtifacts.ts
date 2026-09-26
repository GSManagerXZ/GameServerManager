export type JavaDownloadPlatformKey = 'windows' | 'linux' | 'arm'

type JavaArtifactMap = Record<string, Partial<Record<JavaDownloadPlatformKey, string>>>

export class UnsupportedJavaDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedJavaDownloadError'
  }
}

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

function formatPlatformArch(platform: string, arch?: string): string {
  return `${platform}/${arch || 'unknown'}`
}

function unsupportedJavaDownloadMessage(platform: string, arch?: string): string {
  return `当前平台/架构暂不支持下载式 Java 安装: ${formatPlatformArch(platform, arch)}。请使用系统包管理器安装 OpenJDK，并在实例中使用系统 PATH 中的 java。`
}

export function getJavaDownloadPlatformKey(platform: string, arch?: string): JavaDownloadPlatformKey {
  const normalizedArch = (arch || '').toLowerCase()

  if (platform === 'win32') {
    return 'windows'
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

export function getSponsorDownloadUrl(version: string, platform: string, arch?: string): string {
  return getJavaArtifact(SPONSOR_DOWNLOAD_URLS, version, platform, arch, 'Java 赞助版下载链接')
}

export function getJavaArchiveFileName(version: string, platform: string, arch?: string): string {
  return getJavaArtifact(JAVA_ARCHIVE_FILE_NAMES, version, platform, arch, 'Java 压缩包')
}
