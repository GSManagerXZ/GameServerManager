import type { SystemInfo } from '@/types'

export const normalizeArchitecture = (arch?: string): string => (arch || '').toLowerCase()

export const isX64Architecture = (arch?: string): boolean => {
  const normalizedArch = normalizeArchitecture(arch)
  return normalizedArch === 'x64' || normalizedArch === 'x86_64' || normalizedArch === 'amd64'
}

export const isLimitedGameServerArchitecture = (systemInfo?: Pick<SystemInfo, 'arch'> | null): boolean => {
  return Boolean(systemInfo?.arch) && !isX64Architecture(systemInfo?.arch)
}

export const getArchitectureLabel = (systemInfo?: Pick<SystemInfo, 'arch'> | null): string => {
  return systemInfo?.arch || '未知架构'
}
