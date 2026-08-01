import { randomUUID } from 'crypto'
import net from 'net'
import TOML from 'smol-toml'
import {
  EASYTIER_PROFILE_SCHEMA_VERSION,
  EasyTierAclRule,
  EasyTierFlagValue,
  EasyTierPeerConfig,
  EasyTierPortForwardConfig,
  EasyTierProfile,
  EasyTierProfileDraft,
  EasyTierProfileSecrets,
  EasyTierProfileSettings,
  EasyTierProxyNetworkConfig,
  EasyTierSecretPresence
} from './easytierTypes.js'

export const EASYTIER_ALLOWED_FLAG_NAMES = new Set([
  'default_protocol',
  'dev_name',
  'enable_encryption',
  'enable_ipv6',
  'mtu',
  'latency_first',
  'enable_exit_node',
  'no_tun',
  'use_smoltcp',
  'relay_network_whitelist',
  'disable_p2p',
  'relay_all_peer_rpc',
  'disable_udp_hole_punching',
  'multi_thread',
  'data_compress_algo',
  'bind_device',
  'enable_kcp_proxy',
  'disable_kcp_input',
  'disable_relay_kcp',
  'proxy_forward_by_system',
  'accept_dns',
  'private_mode',
  'enable_quic_proxy',
  'disable_quic_input',
  'disable_relay_quic',
  'foreign_relay_bps_limit',
  'multi_thread_count',
  'enable_relay_foreign_network_kcp',
  'enable_relay_foreign_network_quic',
  'encryption_algorithm',
  'disable_sym_hole_punching',
  'tld_dns_zone',
  'p2p_only',
  'disable_tcp_hole_punching',
  'lazy_p2p',
  'need_p2p',
  'instance_recv_bps_limit',
  'disable_upnp',
  'disable_relay_data',
  'enable_udp_broadcast_relay',
  'socket_mark'
])

const EASYTIER_BOOLEAN_FLAG_NAMES = new Set([
  'enable_encryption',
  'enable_ipv6',
  'latency_first',
  'enable_exit_node',
  'no_tun',
  'use_smoltcp',
  'disable_p2p',
  'relay_all_peer_rpc',
  'disable_udp_hole_punching',
  'multi_thread',
  'bind_device',
  'enable_kcp_proxy',
  'disable_kcp_input',
  'disable_relay_kcp',
  'proxy_forward_by_system',
  'accept_dns',
  'private_mode',
  'enable_quic_proxy',
  'disable_quic_input',
  'disable_relay_quic',
  'enable_relay_foreign_network_kcp',
  'enable_relay_foreign_network_quic',
  'disable_sym_hole_punching',
  'p2p_only',
  'disable_tcp_hole_punching',
  'lazy_p2p',
  'need_p2p',
  'disable_upnp',
  'disable_relay_data',
  'enable_udp_broadcast_relay'
])

const EASYTIER_STRING_FLAG_NAMES = new Set([
  'default_protocol',
  'dev_name',
  'relay_network_whitelist',
  'encryption_algorithm',
  'tld_dns_zone'
])

const EASYTIER_UINT32_FLAG_NAMES = new Set([
  'mtu',
  'multi_thread_count',
  'socket_mark'
])

const EASYTIER_UINT64_FLAG_NAMES = new Set([
  'foreign_relay_bps_limit',
  'instance_recv_bps_limit'
])

const MAX_UINT32 = 4_294_967_295
const MAX_UINT64 = 18_446_744_073_709_551_615n

export class EasyTierValidationError extends Error {
  readonly code = 'EASYTIER_VALIDATION_ERROR'
  readonly field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'EasyTierValidationError'
    this.field = field
  }
}

const DEFAULT_SETTINGS: EasyTierProfileSettings = {
  hostname: '',
  instanceName: '',
  dhcp: true,
  noListener: false,
  listeners: [],
  mappedListeners: [],
  peers: [],
  proxyNetworks: [],
  routes: [],
  exitNodes: [],
  portForwards: [],
  tcpWhitelist: [],
  udpWhitelist: [],
  stunServers: [],
  stunServersV6: [],
  rpcPortalWhitelist: ['127.0.0.1/32', '::1/128'],
  flags: {},
  logging: {},
  secureMode: { enabled: false },
  aclDefaultAction: 'allow',
  acl: []
}

const ensureString = (value: unknown, field: string, maxLength = 256): string => {
  if (typeof value !== 'string') {
    throw new EasyTierValidationError(`${field} 必须是字符串`, field)
  }

  const normalized = value.trim()
  if (!normalized) {
    throw new EasyTierValidationError(`${field} 不能为空`, field)
  }
  if (normalized.length > maxLength) {
    throw new EasyTierValidationError(`${field} 长度不能超过 ${maxLength}`, field)
  }
  if (normalized.includes('\0')) {
    throw new EasyTierValidationError(`${field} 包含非法字符`, field)
  }

  return normalized
}

const optionalString = (value: unknown, field: string, maxLength = 256): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  return ensureString(value, field, maxLength)
}

const normalizeRelativeLogPath = (value: unknown, field: string, maxLength: number): string | undefined => {
  const normalized = optionalString(value, field, maxLength)?.replace(/\\/g, '/')
  if (!normalized) return undefined
  const segments = normalized.split('/')
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    segments.some(segment => !segment || segment === '..' || segment.startsWith('.'))
  ) {
    throw new EasyTierValidationError(`${field} 必须是 Profile 目录内的相对路径`, field)
  }
  return normalized
}

const normalizeX25519Key = (value: unknown, field: string): string | undefined => {
  const text = optionalString(value, field, 256)
  if (!text) return undefined
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new EasyTierValidationError(`${field} 必须是 base64 编码`, field)
  }
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length !== 32) throw new EasyTierValidationError(`${field} 必须解码为 32 字节`, field)
  return decoded.toString('base64')
}

const normalizeLoggerLevel = (value: unknown, field: string): string | undefined => {
  const level = optionalString(value, field, 32)?.toLowerCase()
  if (!level) return undefined
  if (!['disabled', 'error', 'warning', 'info', 'debug', 'trace'].includes(level)) {
    throw new EasyTierValidationError(`${field} 不是支持的日志级别`, field)
  }
  return level
}

const normalizeStringList = (value: unknown, field: string, maxItems = 64): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new EasyTierValidationError(`${field} 必须是数组`, field)
  }
  if (value.length > maxItems) {
    throw new EasyTierValidationError(`${field} 最多允许 ${maxItems} 项`, field)
  }

  return Array.from(new Set(value.map((item, index) => ensureString(item, `${field}[${index}]`, 512))))
}

const validateUri = (value: string, field: string): string => {
  try {
    const parsed = new URL(value)
    if (!parsed.protocol || !parsed.hostname) throw new Error('invalid URI')
    return value
  } catch {
    throw new EasyTierValidationError(`${field} 不是有效的连接 URI`, field)
  }
}

const validateCidr = (value: string, field: string): string => {
  const [address, prefixText, ...rest] = value.split('/')
  const family = net.isIP(address)
  const prefix = Number(prefixText)
  const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1
  if (rest.length > 0 || maxPrefix < 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw new EasyTierValidationError(`${field} 不是有效的 CIDR`, field)
  }
  return value
}

const normalizePeers = (value: unknown): EasyTierPeerConfig[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 64) {
    throw new EasyTierValidationError('peers 必须是最多 64 项的数组', 'settings.peers')
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new EasyTierValidationError(`peers[${index}] 格式无效`, `settings.peers[${index}]`)
    }
    const peer = item as Partial<EasyTierPeerConfig>
    const peerPublicKey = normalizeX25519Key(peer.peerPublicKey, `settings.peers[${index}].peerPublicKey`)
    return {
      uri: validateUri(ensureString(peer.uri, `settings.peers[${index}].uri`, 512), `settings.peers[${index}].uri`),
      ...(peerPublicKey ? { peerPublicKey } : {})
    }
  })
}

const normalizeProxyNetworks = (value: unknown): EasyTierProxyNetworkConfig[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 64) {
    throw new EasyTierValidationError('proxyNetworks 必须是最多 64 项的数组', 'settings.proxyNetworks')
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new EasyTierValidationError(`proxyNetworks[${index}] 格式无效`, `settings.proxyNetworks[${index}]`)
    }
    const network = item as Partial<EasyTierProxyNetworkConfig>
    const mappedCidr = optionalString(network.mappedCidr, `settings.proxyNetworks[${index}].mappedCidr`, 64)
    if (network.allow !== undefined && !Array.isArray(network.allow)) {
      throw new EasyTierValidationError(
        `proxyNetworks[${index}].allow 必须是数组`,
        `settings.proxyNetworks[${index}].allow`
      )
    }
    const allow = network.allow?.map((protocol, protocolIndex) => {
      if (protocol !== 'tcp' && protocol !== 'udp' && protocol !== 'icmp') {
        throw new EasyTierValidationError(
          `proxyNetworks[${index}].allow[${protocolIndex}] 必须是 tcp、udp 或 icmp`,
          `settings.proxyNetworks[${index}].allow[${protocolIndex}]`
        )
      }
      return protocol
    })

    return {
      cidr: validateCidr(ensureString(network.cidr, `settings.proxyNetworks[${index}].cidr`, 64), `settings.proxyNetworks[${index}].cidr`),
      ...(mappedCidr ? { mappedCidr: validateCidr(mappedCidr, `settings.proxyNetworks[${index}].mappedCidr`) } : {}),
      ...(allow && allow.length > 0 ? { allow } : {})
    }
  })
}

const normalizePortForwards = (value: unknown): EasyTierPortForwardConfig[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 128) {
    throw new EasyTierValidationError('portForwards 必须是最多 128 项的数组', 'settings.portForwards')
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new EasyTierValidationError(`portForwards[${index}] 格式无效`, `settings.portForwards[${index}]`)
    }
    const forward = item as Partial<EasyTierPortForwardConfig>
    if (forward.proto !== 'tcp' && forward.proto !== 'udp') {
      throw new EasyTierValidationError(`portForwards[${index}].proto 必须是 tcp 或 udp`, `settings.portForwards[${index}].proto`)
    }
    return {
      id: optionalString(forward.id, `settings.portForwards[${index}].id`, 64) || randomUUID(),
      bindAddr: ensureString(forward.bindAddr, `settings.portForwards[${index}].bindAddr`, 256),
      dstAddr: ensureString(forward.dstAddr, `settings.portForwards[${index}].dstAddr`, 256),
      proto: forward.proto
    }
  })
}

export const normalizeEasyTierFlags = (value: unknown): Record<string, EasyTierFlagValue> => {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new EasyTierValidationError('flags 必须是对象', 'settings.flags')
  }

  return Object.fromEntries(Object.entries(value).map(([key, flagValue]) => {
    if (!EASYTIER_ALLOWED_FLAG_NAMES.has(key)) {
      throw new EasyTierValidationError(`不支持的 EasyTier 配置项: ${key}`, `settings.flags.${key}`)
    }

    const field = `settings.flags.${key}`
    if (EASYTIER_BOOLEAN_FLAG_NAMES.has(key)) {
      if (typeof flagValue !== 'boolean') {
        throw new EasyTierValidationError(`配置项 ${key} 必须是布尔值`, field)
      }
      return [key, flagValue]
    }

    if (EASYTIER_STRING_FLAG_NAMES.has(key)) {
      if (typeof flagValue !== 'string' || flagValue.length > 2048) {
        throw new EasyTierValidationError(`配置项 ${key} 必须是长度不超过 2048 的字符串`, field)
      }
      return [key, flagValue]
    }

    if (EASYTIER_UINT32_FLAG_NAMES.has(key)) {
      if (!Number.isInteger(flagValue) || Number(flagValue) < 0 || Number(flagValue) > MAX_UINT32) {
        throw new EasyTierValidationError(`配置项 ${key} 必须是 uint32 整数`, field)
      }
      return [key, Number(flagValue)]
    }

    if (EASYTIER_UINT64_FLAG_NAMES.has(key)) {
      const text = typeof flagValue === 'number' && Number.isSafeInteger(flagValue)
        ? String(flagValue)
        : typeof flagValue === 'string' && /^\d+$/.test(flagValue)
          ? flagValue
          : ''
      if (!text || BigInt(text) > MAX_UINT64) {
        throw new EasyTierValidationError(`配置项 ${key} 必须是 uint64 整数或十进制字符串`, field)
      }
      return [key, BigInt(text).toString()]
    }

    if (key === 'data_compress_algo') {
      const normalized = typeof flagValue === 'string' ? flagValue.trim().toLowerCase() : flagValue
      if (normalized === 1 || normalized === '1' || normalized === 'none') return [key, 1]
      if (normalized === 2 || normalized === '2' || normalized === 'zstd') return [key, 2]
      throw new EasyTierValidationError(`配置项 ${key} 必须是 none/1 或 zstd/2`, field)
    }

    throw new EasyTierValidationError(`配置项 ${key} 缺少类型约束`, field)
  }))
}

const normalizeAclRules = (value: unknown): EasyTierAclRule[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 128) {
    throw new EasyTierValidationError('settings.acl 必须是最多 128 项的数组', 'settings.acl')
  }
  const normalizeGroups = (input: unknown, field: string): string[] => {
    if (input === undefined || input === null) return []
    if (!Array.isArray(input) || input.length > 32) {
      throw new EasyTierValidationError(`${field} 必须是最多 32 项的数组`, field)
    }
    const groups = Array.from(new Set(input.map((item, index) => ensureString(item, `${field}[${index}]`, 64))))
    if (groups.some(group => !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(group))) {
      throw new EasyTierValidationError(`${field} 包含无效分组名称`, field)
    }
    return groups
  }
  const normalizePorts = (input: unknown, field: string): string | undefined => {
    const text = optionalString(input, field, 512)
    if (!text) return undefined
    const parts = text.split(',').map(item => item.trim()).filter(Boolean)
    const valid = parts.length > 0 && parts.every(part => {
      const [startText, endText, ...extra] = part.split('-')
      const start = Number(startText)
      const end = endText === undefined ? start : Number(endText)
      return extra.length === 0 && Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= 65535 && start <= end
    })
    if (!valid) throw new EasyTierValidationError(`${field} 包含无效端口或范围`, field)
    return parts.join(',')
  }

  const rules = value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new EasyTierValidationError(`settings.acl[${index}] 格式无效`, `settings.acl[${index}]`)
    const rule = item as Partial<EasyTierAclRule>
    const field = `settings.acl[${index}]`
    const id = ensureString(rule.id, `${field}.id`, 64)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new EasyTierValidationError(`${field}.id 格式无效`, `${field}.id`)
    if (!['allow', 'deny'].includes(String(rule.action))) throw new EasyTierValidationError(`${field}.action 无效`, `${field}.action`)
    const protocol = optionalString(rule.protocol, `${field}.protocol`, 16) || 'any'
    if (!['any', 'tcp', 'udp', 'icmp'].includes(protocol)) throw new EasyTierValidationError(`${field}.protocol 无效`, `${field}.protocol`)
    const sourceGroups = normalizeGroups(rule.sourceGroups, `${field}.sourceGroups`)
    const destinationGroups = normalizeGroups(rule.destinationGroups, `${field}.destinationGroups`)
    const source = optionalString(rule.source, `${field}.source`, 64)
    const destination = optionalString(rule.destination, `${field}.destination`, 64)
    const sourcePort = normalizePorts(rule.sourcePort, `${field}.sourcePort`)
    const destinationPort = normalizePorts(rule.destinationPort, `${field}.destinationPort`)
    const description = optionalString(rule.description, `${field}.description`, 256)
    return {
      id,
      action: rule.action as EasyTierAclRule['action'],
      protocol: protocol as EasyTierAclRule['protocol'],
      ...(sourceGroups.length > 0 ? { sourceGroups } : {}),
      ...(destinationGroups.length > 0 ? { destinationGroups } : {}),
      ...(source ? { source: validateCidr(source, `${field}.source`) } : {}),
      ...(destination ? { destination: validateCidr(destination, `${field}.destination`) } : {}),
      ...(sourcePort ? { sourcePort } : {}),
      ...(destinationPort ? { destinationPort } : {}),
      ...(description ? { description } : {})
    }
  })
  const ids = new Set<string>()
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new EasyTierValidationError(`settings.acl 包含重复规则 ID: ${rule.id}`, 'settings.acl')
    ids.add(rule.id)
  }
  return rules
}

const normalizeSettings = (draft: EasyTierProfileDraft): EasyTierProfileSettings => {
  const source = { ...DEFAULT_SETTINGS, ...draft.settings }
  const hostname = ensureString(source.hostname, 'settings.hostname', 128)
  const instanceName = optionalString(source.instanceName, 'settings.instanceName', 128) || hostname
  const ipv4 = optionalString(source.ipv4, 'settings.ipv4', 64)
  const ipv6 = optionalString(source.ipv6, 'settings.ipv6', 128)
  const socks5Proxy = optionalString(source.socks5Proxy, 'settings.socks5Proxy', 512)
  const externalNode = optionalString(source.externalNode, 'settings.externalNode', 512)
  const rpcPortal = optionalString(source.rpcPortal, 'settings.rpcPortal', 256)
  const fileLogLevel = normalizeLoggerLevel(source.logging?.file?.level, 'settings.logging.file.level')
  const fileLogFile = normalizeRelativeLogPath(source.logging?.file?.file, 'settings.logging.file.file', 128)
  const fileLogDirectory = normalizeRelativeLogPath(source.logging?.file?.dir, 'settings.logging.file.dir', 512)
  const consoleLogLevel = normalizeLoggerLevel(source.logging?.console?.level, 'settings.logging.console.level')
  const localPublicKey = normalizeX25519Key(source.secureMode?.localPublicKey, 'settings.secureMode.localPublicKey')
  const aclDefaultAction = source.aclDefaultAction === 'deny'
    ? 'deny'
    : source.aclDefaultAction === 'allow'
      ? 'allow'
      : undefined

  if (ipv4 && !net.isIPv4(ipv4)) throw new EasyTierValidationError('settings.ipv4 不是有效的 IPv4 地址', 'settings.ipv4')
  if (ipv6 && !net.isIPv6(ipv6)) throw new EasyTierValidationError('settings.ipv6 不是有效的 IPv6 地址', 'settings.ipv6')
  if (!aclDefaultAction) throw new EasyTierValidationError('settings.aclDefaultAction 必须是 allow 或 deny', 'settings.aclDefaultAction')

  return {
    hostname,
    instanceName,
    ...(ipv4 ? { ipv4 } : {}),
    ...(ipv6 ? { ipv6 } : {}),
    dhcp: source.dhcp !== false,
    noListener: source.noListener === true,
    listeners: normalizeStringList(source.listeners, 'settings.listeners').map((uri, index) => validateUri(uri, `settings.listeners[${index}]`)),
    mappedListeners: normalizeStringList(source.mappedListeners, 'settings.mappedListeners').map((uri, index) => validateUri(uri, `settings.mappedListeners[${index}]`)),
    peers: normalizePeers(source.peers),
    proxyNetworks: normalizeProxyNetworks(source.proxyNetworks),
    routes: normalizeStringList(source.routes, 'settings.routes').map((cidr, index) => validateCidr(cidr, `settings.routes[${index}]`)),
    exitNodes: normalizeStringList(source.exitNodes, 'settings.exitNodes'),
    ...(source.vpnPortal
      ? {
          vpnPortal: {
            clientCidr: validateCidr(ensureString(source.vpnPortal.clientCidr, 'settings.vpnPortal.clientCidr', 64), 'settings.vpnPortal.clientCidr'),
            wireguardListen: ensureString(source.vpnPortal.wireguardListen, 'settings.vpnPortal.wireguardListen', 256)
          }
        }
      : {}),
    ...(socks5Proxy ? { socks5Proxy: validateUri(socks5Proxy, 'settings.socks5Proxy') } : {}),
    portForwards: normalizePortForwards(source.portForwards),
    tcpWhitelist: normalizeStringList(source.tcpWhitelist, 'settings.tcpWhitelist'),
    udpWhitelist: normalizeStringList(source.udpWhitelist, 'settings.udpWhitelist'),
    stunServers: normalizeStringList(source.stunServers, 'settings.stunServers'),
    stunServersV6: normalizeStringList(source.stunServersV6, 'settings.stunServersV6'),
    ...(externalNode ? { externalNode } : {}),
    ...(rpcPortal ? { rpcPortal } : {}),
    rpcPortalWhitelist: normalizeStringList(source.rpcPortalWhitelist, 'settings.rpcPortalWhitelist', 32),
    flags: normalizeEasyTierFlags(source.flags),
    logging: {
      ...(source.logging?.file
        ? {
            file: {
              ...(fileLogLevel ? { level: fileLogLevel } : {}),
            ...(fileLogFile ? { file: fileLogFile } : {}),
            ...(fileLogDirectory ? { dir: fileLogDirectory } : {}),
              ...(Number.isFinite(source.logging.file.sizeMb) ? { sizeMb: Number(source.logging.file.sizeMb) } : {}),
              ...(Number.isInteger(source.logging.file.count) ? { count: Number(source.logging.file.count) } : {})
            }
          }
        : {}),
      ...(consoleLogLevel
        ? { console: { level: consoleLogLevel } }
        : {})
    },
    secureMode: {
      enabled: source.secureMode?.enabled === true,
      ...(localPublicKey ? { localPublicKey } : {})
    },
    aclDefaultAction,
    acl: normalizeAclRules(source.acl)
  }
}

export const createSecretPresence = (secrets: EasyTierProfileSecrets = {}): EasyTierSecretPresence => ({
  networkSecret: Boolean(secrets.networkSecret),
  localPrivateKey: Boolean(secrets.localPrivateKey),
  credentialFile: Boolean(secrets.credentialFileContent)
})

export const normalizeEasyTierSecrets = (secrets: EasyTierProfileSecrets = {}): EasyTierProfileSecrets => {
  const networkSecret = optionalString(secrets.networkSecret, 'secrets.networkSecret', 4096)
  const localPrivateKey = normalizeX25519Key(secrets.localPrivateKey, 'secrets.localPrivateKey')
  const credentialFileContent = optionalString(
    secrets.credentialFileContent,
    'secrets.credentialFileContent',
    1024 * 1024
  )
  return {
    ...(networkSecret ? { networkSecret } : {}),
    ...(localPrivateKey ? { localPrivateKey } : {}),
    ...(credentialFileContent ? { credentialFileContent } : {})
  }
}

export const normalizeEasyTierProfile = (
  draft: EasyTierProfileDraft | EasyTierProfile,
  secrets: EasyTierProfileSecrets = {},
  now = new Date()
): EasyTierProfile => {
  const normalizedSecrets = normalizeEasyTierSecrets(secrets)
  const createdAt = optionalString(draft.createdAt, 'createdAt', 64) || now.toISOString()
  const updatedAt = now.toISOString()
  const id = optionalString(draft.id, 'id', 64) || randomUUID()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
    throw new EasyTierValidationError('id 格式无效', 'id')
  }

  const corePath = ensureString(draft.binary?.corePath, 'binary.corePath', 2048)
  const cliPath = optionalString(draft.binary?.cliPath, 'binary.cliPath', 2048)
  const target = draft.target
    ? {
        address: ensureString(draft.target.address, 'target.address', 256),
        port: Number(draft.target.port),
        protocol: draft.target.protocol,
        ...(optionalString(draft.target.linkedGameInstanceId, 'target.linkedGameInstanceId', 64)
          ? { linkedGameInstanceId: optionalString(draft.target.linkedGameInstanceId, 'target.linkedGameInstanceId', 64) }
          : {})
      }
    : undefined

  if (target && (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) {
    throw new EasyTierValidationError('target.port 必须在 1-65535 之间', 'target.port')
  }
  if (target && !['tcp', 'udp', 'both'].includes(target.protocol)) {
    throw new EasyTierValidationError('target.protocol 必须是 tcp、udp 或 both', 'target.protocol')
  }

  return {
    schemaVersion: EASYTIER_PROFILE_SCHEMA_VERSION,
    id,
    name: ensureString(draft.name, 'name', 128),
    description: optionalString(draft.description, 'description', 1024) || '',
    preset: draft.preset || 'custom',
    networkName: ensureString(draft.networkName, 'networkName', 128),
    autoStart: draft.autoStart === true,
    binary: { corePath, ...(cliPath ? { cliPath } : {}) },
    settings: normalizeSettings(draft),
    ...(target ? { target } : {}),
    ...(optionalString(draft.managedInstanceId, 'managedInstanceId', 64)
      ? { managedInstanceId: optionalString(draft.managedInstanceId, 'managedInstanceId', 64) }
      : {}),
    ...(draft.capabilities ? { capabilities: { ...draft.capabilities } } : {}),
    secretPresence: createSecretPresence(normalizedSecrets),
    ...(draft.migration ? { migration: { ...draft.migration } } : {}),
    createdAt,
    updatedAt
  }
}

const removeEmptyValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const items = value.map(removeEmptyValues).filter(item => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, child]) => [key, removeEmptyValues(child)] as const)
      .filter(([, child]) => child !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  if (value === undefined || value === null || value === '') return undefined
  return value
}

export const buildEasyTierToml = (
  profile: EasyTierProfile,
  _secrets: EasyTierProfileSecrets,
  credentialFilePath?: string
): string => {
  const settings = profile.settings
  const protocolNumbers: Record<string, number> = { tcp: 1, udp: 2, icmp: 3, any: 5 }
  const acl = settings.acl.length > 0 || settings.aclDefaultAction === 'deny'
    ? {
        acl_v1: {
          chains: [{
            name: 'gsm3-managed-inbound',
            chain_type: 1,
            description: 'Managed by GSM3 EasyTier Manager',
            enabled: true,
            default_action: settings.aclDefaultAction === 'deny' ? 2 : 1,
            rules: settings.acl.map((rule, index) => ({
              name: rule.id,
              description: rule.description,
              priority: 65535 - index,
              action: rule.action === 'allow' ? 1 : 2,
              protocol: protocolNumbers[rule.protocol || 'any'] || 5,
              source_groups: rule.sourceGroups || [],
              destination_groups: rule.destinationGroups || [],
              source_ips: rule.source ? [rule.source] : [],
              destination_ips: rule.destination ? [rule.destination] : [],
              source_ports: rule.sourcePort ? rule.sourcePort.split(',') : [],
              ports: rule.destinationPort ? rule.destinationPort.split(',') : [],
              enabled: true,
              rate_limit: 0,
              burst_limit: 0,
              stateful: true
            }))
          }]
        }
      }
    : undefined
  const baseConfig = removeEmptyValues({
    hostname: settings.hostname,
    instance_name: settings.instanceName,
    ipv4: settings.ipv4,
    ipv6: settings.ipv6,
    dhcp: settings.dhcp,
    network_identity: {
      network_name: profile.networkName
    },
    mapped_listeners: settings.mappedListeners,
    exit_nodes: settings.exitNodes,
    peer: [
      ...settings.peers,
      ...(settings.externalNode && !settings.peers.some(peer => peer.uri === settings.externalNode)
        ? [{ uri: settings.externalNode }]
        : [])
    ].map(peer => ({
      uri: peer.uri,
      peer_public_key: peer.peerPublicKey
    })),
    proxy_network: settings.proxyNetworks.map(network => ({
      cidr: network.cidr,
      mapped_cidr: network.mappedCidr,
      allow: network.allow
    })),
    vpn_portal_config: settings.vpnPortal
      ? {
          client_cidr: settings.vpnPortal.clientCidr,
          wireguard_listen: settings.vpnPortal.wireguardListen
        }
      : undefined,
    routes: settings.routes,
    socks5_proxy: settings.socks5Proxy,
    port_forward: settings.portForwards.map(forward => ({
      bind_addr: forward.bindAddr,
      dst_addr: forward.dstAddr,
      proto: forward.proto
    })),
    secure_mode: settings.secureMode.enabled
      ? {
          enabled: true,
          local_public_key: settings.secureMode.localPublicKey
        }
      : undefined,
    flags: settings.flags,
    tcp_whitelist: settings.tcpWhitelist,
    udp_whitelist: settings.udpWhitelist,
    stun_servers: settings.stunServers,
    stun_servers_v6: settings.stunServersV6,
    credential_file: settings.secureMode.enabled ? credentialFilePath : undefined,
    acl,
    file_logger: settings.logging.file
      ? {
          level: settings.logging.file.level,
          file: settings.logging.file.file,
          dir: settings.logging.file.dir,
          size_mb: settings.logging.file.sizeMb,
          count: settings.logging.file.count
        }
      : undefined,
    console_logger: settings.logging.console,
    source: { source: 'user' }
  }) as Record<string, unknown>
  const config = {
    ...baseConfig,
    ...(settings.noListener
      ? { listeners: [] }
      : settings.listeners.length > 0
        ? { listeners: [...settings.listeners] }
        : {})
  }

  const output = TOML.stringify(config)
  TOML.parse(output)
  return `${output.trim()}\n`
}

export const redactSecrets = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(item => redactSecrets(item)) as T
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    const isSecret = /secret|private[_-]?key|credential/i.test(key)
    return [key, isSecret && child ? '[REDACTED]' : redactSecrets(child)]
  })) as T
}
