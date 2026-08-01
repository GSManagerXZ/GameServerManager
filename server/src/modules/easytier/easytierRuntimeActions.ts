import {
  EasyTierValidationError,
  normalizeEasyTierProfile
} from './easytierConfig.js'
import type {
  EasyTierProfile,
  EasyTierProfileSecrets,
  EasyTierRuntimeAction
} from './easytierTypes.js'

export interface EasyTierRuntimeActionPlan {
  args: string[]
  rollbackArgs?: string[]
  profile: EasyTierProfile
}

const buildWhitelistArgs = (protocol: 'tcp' | 'udp', values: string[]): string[] => (
  values.length > 0
    ? ['whitelist', protocol === 'tcp' ? 'set-tcp' : 'set-udp', values.join(',')]
    : ['whitelist', protocol === 'tcp' ? 'clear-tcp' : 'clear-udp']
)

const validateWhitelistValues = (values: string[], field: string): string[] => {
  if (!Array.isArray(values)) throw new EasyTierValidationError('端口白名单必须是数组', field)
  const normalized = Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)))
  for (const value of normalized) {
    const match = value.match(/^(\d{1,5})(?:-(\d{1,5}))?$/)
    if (!match) throw new EasyTierValidationError(`无效的端口白名单值: ${value}`, field)
    const start = Number(match[1])
    const end = Number(match[2] || match[1])
    if (start < 1 || start > 65535 || end < start || end > 65535) {
      throw new EasyTierValidationError(`无效的端口范围: ${value}`, field)
    }
  }
  return normalized
}

export const buildEasyTierRuntimeActionPlan = (
  profile: EasyTierProfile,
  secrets: EasyTierProfileSecrets,
  action: EasyTierRuntimeAction
): EasyTierRuntimeActionPlan => {
  const normalizeWithSettings = (settings: EasyTierProfile['settings']): EasyTierProfile => {
    const normalized = normalizeEasyTierProfile({ ...profile, settings }, secrets)
    return { ...normalized, createdAt: profile.createdAt }
  }
  const settings = profile.settings

  switch (action.type) {
    case 'connector-add': {
      const nextProfile = normalizeWithSettings({
        ...settings,
        peers: [...settings.peers.filter(peer => peer.uri !== action.uri), { uri: action.uri }]
      })
      return {
        args: ['connector', 'add', action.uri],
        rollbackArgs: ['connector', 'remove', action.uri],
        profile: nextProfile
      }
    }
    case 'connector-remove': {
      const existing = settings.peers.find(peer => peer.uri === action.uri)
      if (!existing) throw new EasyTierValidationError('要删除的连接器不存在', 'action.uri')
      return {
        args: ['connector', 'remove', action.uri],
        rollbackArgs: ['connector', 'add', action.uri],
        profile: normalizeWithSettings({
          ...settings,
          peers: settings.peers.filter(peer => peer.uri !== action.uri)
        })
      }
    }
    case 'mapped-listener-add': {
      const nextProfile = normalizeWithSettings({
        ...settings,
        mappedListeners: [...settings.mappedListeners.filter(uri => uri !== action.uri), action.uri]
      })
      return {
        args: ['mapped-listener', 'add', action.uri],
        rollbackArgs: ['mapped-listener', 'remove', action.uri],
        profile: nextProfile
      }
    }
    case 'mapped-listener-remove': {
      if (!settings.mappedListeners.includes(action.uri)) {
        throw new EasyTierValidationError('要删除的映射监听器不存在', 'action.uri')
      }
      return {
        args: ['mapped-listener', 'remove', action.uri],
        rollbackArgs: ['mapped-listener', 'add', action.uri],
        profile: normalizeWithSettings({
          ...settings,
          mappedListeners: settings.mappedListeners.filter(uri => uri !== action.uri)
        })
      }
    }
    case 'port-forward-add': {
      const nextProfile = normalizeWithSettings({
        ...settings,
        portForwards: [...settings.portForwards.filter(rule => rule.id !== action.value.id), action.value]
      })
      const added = nextProfile.settings.portForwards.find(rule => rule.id === action.value.id)
      if (!added) throw new EasyTierValidationError('端口转发规则无效', 'action.value')
      return {
        args: ['port-forward', 'add', added.proto, added.bindAddr, added.dstAddr],
        rollbackArgs: ['port-forward', 'remove', added.proto, added.bindAddr, added.dstAddr],
        profile: nextProfile
      }
    }
    case 'port-forward-remove': {
      const existing = settings.portForwards.find(rule => rule.id === action.id)
      if (!existing) throw new EasyTierValidationError('要删除的端口转发规则不存在', 'action.id')
      return {
        args: ['port-forward', 'remove', existing.proto, existing.bindAddr, existing.dstAddr],
        rollbackArgs: ['port-forward', 'add', existing.proto, existing.bindAddr, existing.dstAddr],
        profile: normalizeWithSettings({
          ...settings,
          portForwards: settings.portForwards.filter(rule => rule.id !== action.id)
        })
      }
    }
    case 'tcp-whitelist-set': {
      const values = validateWhitelistValues(action.values, 'action.values')
      return {
        args: buildWhitelistArgs('tcp', values),
        rollbackArgs: buildWhitelistArgs('tcp', settings.tcpWhitelist),
        profile: normalizeWithSettings({ ...settings, tcpWhitelist: values })
      }
    }
    case 'udp-whitelist-set': {
      const values = validateWhitelistValues(action.values, 'action.values')
      return {
        args: buildWhitelistArgs('udp', values),
        rollbackArgs: buildWhitelistArgs('udp', settings.udpWhitelist),
        profile: normalizeWithSettings({ ...settings, udpWhitelist: values })
      }
    }
    case 'logger-set': {
      const levels = [action.value.console?.level, action.value.file?.level]
        .filter((value): value is string => Boolean(value))
      if (levels.length === 0) throw new EasyTierValidationError('logger-set 至少需要一个日志级别', 'action.value')
      if (new Set(levels).size > 1) throw new EasyTierValidationError('运行时日志级别必须保持一致', 'action.value')
      const level = levels[0].toLowerCase()
      const allowedLevels = ['disabled', 'error', 'warning', 'info', 'debug', 'trace']
      if (!allowedLevels.includes(level)) throw new EasyTierValidationError('不支持的日志级别', 'action.value')
      const previousLevel = settings.logging.console?.level || settings.logging.file?.level || 'info'
      const normalizedLogging = {
        ...(action.value.file ? { file: { ...action.value.file, level } } : {}),
        ...(action.value.console ? { console: { ...action.value.console, level } } : {})
      }
      return {
        args: ['logger', 'set', level],
        rollbackArgs: ['logger', 'set', previousLevel],
        profile: normalizeWithSettings({ ...settings, logging: normalizedLogging })
      }
    }
    default:
      throw new EasyTierValidationError('不支持的 EasyTier 运行时操作', 'action.type')
  }
}
