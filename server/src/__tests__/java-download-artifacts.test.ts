import {
  getJavaDownloadCatalog,
  getJavaArchiveFileName,
  getJavaDownloadPlatformKey,
  getSponsorDownloadUrl,
  resolveJavaDownloadOption,
  UnsupportedJavaDownloadError
} from '../utils/javaDownloadArtifacts.js'

describe('java download artifacts', () => {
  it('maps Linux x64 to the x64 Java archive', () => {
    expect(getJavaDownloadPlatformKey('linux', 'x64')).toBe('linux')
    expect(getJavaArchiveFileName('java17', 'linux', 'x64')).toBe('openjdk-17.0.0.1+2_linux-x64_bin.tar.gz')
  })

  it('maps Linux arm64 to the arm Java archive', () => {
    expect(getJavaDownloadPlatformKey('linux', 'arm64')).toBe('arm')
    expect(getJavaArchiveFileName('java17', 'linux', 'arm64')).toBe('openjdk-17.0.2_linux-aarch64_bin.tar.gz')
  })

  it('keeps riscv64 separate from Linux x64 Java artifacts', () => {
    expect(getJavaDownloadPlatformKey('linux', 'riscv64')).toBe('riscv64')
    expect(() => getJavaArchiveFileName('java17', 'linux', 'riscv64')).toThrow(/系统包管理器安装 OpenJDK/)
    expect(() => getSponsorDownloadUrl('java17', 'linux', 'riscv64')).toThrow(/系统包管理器安装 OpenJDK/)
  })

  it('rejects Java versions that have no artifact for the current architecture', () => {
    expect(() => getJavaArchiveFileName('java8', 'linux', 'arm64')).toThrow(UnsupportedJavaDownloadError)
    expect(() => getSponsorDownloadUrl('java8', 'linux', 'arm64')).toThrow(/不支持当前 Java 版本或平台\/架构组合/)
  })

  it('rejects unsupported operating systems instead of treating them as Linux', () => {
    expect(() => getJavaArchiveFileName('java17', 'darwin', 'x64')).toThrow(UnsupportedJavaDownloadError)
  })

  it('builds Eclipse Temurin download options from the Adoptium API pattern', async () => {
    const resolution = await resolveJavaDownloadOption('java17', 'adoptium', 'linux', 'x64')

    expect(resolution.downloadUrl).toBe(
      'https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse'
    )
    expect(resolution.archiveFileName).toBe('temurin-17-ga-linux-x64.jdk.tar.gz')
  })

  it('supports Temurin riscv64 downloads only for versions with current GA builds', async () => {
    const resolution = await resolveJavaDownloadOption('java21', 'adoptium', 'linux', 'riscv64')

    expect(resolution.downloadUrl).toBe(
      'https://api.adoptium.net/v3/binary/latest/21/ga/linux/riscv64/jdk/hotspot/normal/eclipse'
    )
    expect(resolution.archiveFileName).toBe('temurin-21-ga-linux-riscv64.jdk.tar.gz')
    await expect(resolveJavaDownloadOption('java11', 'adoptium', 'linux', 'riscv64')).rejects.toThrow(/Temurin 暂不提供/)
  })

  it('supports custom Early Access versions through provider parameters', async () => {
    const resolution = await resolveJavaDownloadOption('java28-ea', 'adoptium', 'linux', 'x64', {
      releaseChannel: 'ea'
    })

    expect(resolution.version).toBe('java28-ea')
    expect(resolution.releaseChannel).toBe('ea')
    expect(resolution.downloadUrl).toBe(
      'https://api.adoptium.net/v3/binary/latest/28/ea/linux/x64/jdk/hotspot/normal/eclipse'
    )
  })

  it('resolves sponsor downloads without requiring sponsor credentials', async () => {
    const resolution = await resolveJavaDownloadOption('java17', 'sponsor', 'linux', 'x64')

    expect(resolution.downloadUrl).toBe(getSponsorDownloadUrl('java17', 'linux', 'x64'))
    expect(resolution.archiveFileName).toBe(getJavaArchiveFileName('java17', 'linux', 'x64'))
  })

  it('keeps the first catalog option installable on supported platforms without sponsor credentials', () => {
    const catalog = getJavaDownloadCatalog('linux', 'x64')
    const java17Options = catalog.options.filter(option => option.version === 'java17')
    const sponsorOption = java17Options.find(option => option.provider === 'sponsor')

    expect(java17Options[0]).toEqual(expect.objectContaining({
      provider: 'sponsor',
      available: true,
      recommended: true
    }))
    expect(sponsorOption).toEqual(expect.objectContaining({
      available: true
    }))
  })

  it('keeps sponsor first when sponsor credentials are available', () => {
    const catalog = getJavaDownloadCatalog('linux', 'x64', {
      sponsorAvailable: true
    })
    const java17Options = catalog.options.filter(option => option.version === 'java17')

    expect(java17Options[0]).toEqual(expect.objectContaining({
      provider: 'sponsor',
      available: true,
      recommended: true
    }))
  })

  it('keeps sponsor unavailable on riscv64 while offering Temurin and system packages where valid', () => {
    const catalog = getJavaDownloadCatalog('linux', 'riscv64')
    const java17Options = catalog.options.filter(option => option.version === 'java17')
    const java11Options = catalog.options.filter(option => option.version === 'java11')

    expect(catalog.platformKey).toBe('riscv64')
    expect(catalog.versions.find(version => version.id === 'java27')).toEqual(expect.objectContaining({
      major: 27
    }))
    expect(catalog.versions.find(version => version.id === 'java28-ea')).toEqual(expect.objectContaining({
      defaultChannel: 'ea'
    }))
    expect(catalog.providers.find(provider => provider.id === 'azul')).toEqual(expect.objectContaining({
      supportsCustomVersion: true
    }))
    expect(catalog.custom).toEqual(expect.objectContaining({
      defaultMajor: 25,
      defaultChannel: 'ga'
    }))
    expect(java17Options.find(option => option.provider === 'sponsor')).toEqual(expect.objectContaining({
      available: false
    }))
    expect(java17Options[0]).toEqual(expect.objectContaining({
      provider: 'adoptium',
      available: true
    }))
    expect(java17Options.find(option => option.provider === 'adoptium')).toEqual(expect.objectContaining({
      available: true,
      downloadUrl: 'https://api.adoptium.net/v3/binary/latest/17/ga/linux/riscv64/jdk/hotspot/normal/eclipse'
    }))
    expect(java11Options.find(option => option.provider === 'adoptium')).toEqual(expect.objectContaining({
      available: false
    }))
    expect(java17Options.find(option => option.provider === 'system')).toEqual(expect.objectContaining({
      available: true,
      recommended: true,
      packageManager: 'apt',
      packageName: 'openjdk-17-jre-headless'
    }))
  })
})
