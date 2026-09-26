import {
  getJavaArchiveFileName,
  getJavaDownloadPlatformKey,
  getSponsorDownloadUrl,
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

  it('does not map riscv64 to Linux x64 Java artifacts', () => {
    expect(() => getJavaDownloadPlatformKey('linux', 'riscv64')).toThrow(UnsupportedJavaDownloadError)
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
})
