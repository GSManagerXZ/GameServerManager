import os from 'os'

export class UnsupportedArchitectureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedArchitectureError'
  }
}

export function normalizeArchitecture(arch: string = os.arch()): string {
  return arch.toLowerCase()
}

export function isX64Architecture(arch: string = os.arch()): boolean {
  const normalizedArch = normalizeArchitecture(arch)
  return normalizedArch === 'x64' || normalizedArch === 'x86_64' || normalizedArch === 'amd64'
}

export function formatPlatformArch(platform: string = os.platform(), arch: string = os.arch()): string {
  return `${platform}/${arch}`
}

export function assertSteamCMDSupported(platform: string = os.platform(), arch: string = os.arch()): void {
  if (platform === 'win32') {
    return
  }

  if (platform === 'linux' && isX64Architecture(arch)) {
    return
  }

  throw new UnsupportedArchitectureError(
    `当前平台/架构暂不支持 SteamCMD: ${formatPlatformArch(platform, arch)}。SteamCMD Linux 发行包依赖 x86/x86_64 运行环境；请使用 AMD64 服务器或改用手动文件部署。`
  )
}

export function assertFactorioHeadlessSupported(platform: string = os.platform(), arch: string = os.arch()): void {
  if (platform === 'linux' && isX64Architecture(arch)) {
    return
  }

  throw new UnsupportedArchitectureError(
    `当前平台/架构暂不支持 Factorio headless 服务端自动部署: ${formatPlatformArch(platform, arch)}。Factorio 官方 headless 下载为 linux64 构建；请使用 Linux x86_64 服务器或手动提供匹配架构的服务端文件。`
  )
}
