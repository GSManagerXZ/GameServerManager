import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'crypto'
import net from 'net'
import { EasyTierValidationError } from './easytierConfig.js'
import type { EasyTierAclRule, EasyTierCredentialSummary } from './easytierTypes.js'

const X25519_PRIVATE_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')
const KEY_BYTES = 32
const MAX_CREDENTIAL_TTL_SECONDS = 365 * 24 * 60 * 60

export interface EasyTierCredentialGenerateInput {
  ttlSeconds: number
  credentialId?: string
  groups?: string[]
  allowRelay?: boolean
  allowedProxyCidrs?: string[]
  reusable?: boolean
}

export interface NormalizedCredentialGenerateInput {
  ttlSeconds: number
  credentialId?: string
  groups: string[]
  allowRelay: boolean
  allowedProxyCidrs: string[]
  reusable: boolean
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const decodeBase64Key = (value: unknown, field: string): Buffer => {
  if (typeof value !== 'string' || !value.trim()) throw new EasyTierValidationError(`${field} 不能为空`, field)
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new EasyTierValidationError(`${field} 必须是 base64 编码`, field)
  }
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length !== KEY_BYTES) {
    throw new EasyTierValidationError(`${field} 必须解码为 32 字节 X25519 密钥`, field)
  }
  return decoded
}

const decodeBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64')
}

export const normalizeX25519PublicKey = (value: unknown, field = 'publicKey'): string => (
  decodeBase64Key(value, field).toString('base64')
)

export const deriveX25519PublicKey = (privateKeyValue: unknown): { privateKey: string; publicKey: string } => {
  const privateKeyBytes = decodeBase64Key(privateKeyValue, 'localPrivateKey')
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PRIVATE_PREFIX, privateKeyBytes]),
    format: 'der',
    type: 'pkcs8'
  })
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return {
    privateKey: privateKeyBytes.toString('base64'),
    publicKey: Buffer.from(publicDer).subarray(-KEY_BYTES).toString('base64')
  }
}

export const generateX25519KeyPair = (): { privateKey: string; publicKey: string } => {
  const pair = generateKeyPairSync('x25519')
  const privateJwk = pair.privateKey.export({ format: 'jwk' }) as { d?: string }
  const publicJwk = pair.publicKey.export({ format: 'jwk' }) as { x?: string }
  if (!privateJwk.d || !publicJwk.x) throw new Error('无法导出 X25519 密钥')
  return {
    privateKey: decodeBase64Url(privateJwk.d).toString('base64'),
    publicKey: decodeBase64Url(publicJwk.x).toString('base64')
  }
}

const normalizeCidr = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const text = String(value).trim()
  const [address, prefixText, ...extra] = text.split('/')
  const family = net.isIP(address)
  const prefix = Number(prefixText)
  const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1
  if (extra.length > 0 || maxPrefix < 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw new EasyTierValidationError(`${field} 不是有效 CIDR`, field)
  }
  return text
}

const normalizePortExpression = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const parts = String(value).split(',').map(item => item.trim()).filter(Boolean)
  if (parts.length === 0 || parts.length > 64) throw new EasyTierValidationError(`${field} 格式无效`, field)
  const isValidPart = (part: string): boolean => {
    const [startText, endText, ...extra] = part.split('-')
    const start = Number(startText)
    const end = endText === undefined ? start : Number(endText)
    return extra.length === 0 && Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= 65535 && start <= end
  }
  if (!parts.every(isValidPart)) throw new EasyTierValidationError(`${field} 包含无效端口或范围`, field)
  return parts.join(',')
}

const normalizeAclGroups = (value: unknown, field: string): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 32) {
    throw new EasyTierValidationError(`${field} 必须是最多 32 项的数组`, field)
  }
  const groups = Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)))
  if (groups.some(group => !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(group))) {
    throw new EasyTierValidationError(`${field} 包含无效分组名称`, field)
  }
  return groups
}

export const normalizeAclRules = (value: unknown): EasyTierAclRule[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 128) {
    throw new EasyTierValidationError('ACL 规则必须是最多 128 项的数组', 'acl')
  }
  const rules = value.map((item, index) => {
    const rule = asRecord(item)
    const field = `acl[${index}]`
    const id = String(rule.id || '').trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
      throw new EasyTierValidationError(`${field}.id 格式无效`, `${field}.id`)
    }
    const action: EasyTierAclRule['action'] | undefined = rule.action === 'deny'
      ? 'deny'
      : rule.action === 'allow'
        ? 'allow'
        : undefined
    if (!action) throw new EasyTierValidationError(`${field}.action 必须是 allow 或 deny`, `${field}.action`)
    const protocol = String(rule.protocol || 'any').toLowerCase()
    if (!['any', 'tcp', 'udp', 'icmp'].includes(protocol)) {
      throw new EasyTierValidationError(`${field}.protocol 无效`, `${field}.protocol`)
    }
    const sourceGroups = normalizeAclGroups(rule.sourceGroups, `${field}.sourceGroups`)
    const destinationGroups = normalizeAclGroups(rule.destinationGroups, `${field}.destinationGroups`)
    const description = String(rule.description || '').trim().slice(0, 256)
    const source = normalizeCidr(rule.source, `${field}.source`)
    const destination = normalizeCidr(rule.destination, `${field}.destination`)
    const sourcePort = normalizePortExpression(rule.sourcePort, `${field}.sourcePort`)
    const destinationPort = normalizePortExpression(rule.destinationPort, `${field}.destinationPort`)
    return {
      id,
      action,
      protocol: protocol as EasyTierAclRule['protocol'],
      ...(sourceGroups.length > 0 ? { sourceGroups } : {}),
      ...(destinationGroups.length > 0 ? { destinationGroups } : {}),
      ...(source ? { source } : {}),
      ...(destination ? { destination } : {}),
      ...(sourcePort ? { sourcePort } : {}),
      ...(destinationPort ? { destinationPort } : {}),
      ...(description ? { description } : {})
    }
  })
  const ids = new Set<string>()
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new EasyTierValidationError(`ACL 包含重复规则 ID: ${rule.id}`, 'acl')
    ids.add(rule.id)
  }
  return rules
}

const normalizeStringList = (value: unknown, field: string, maxItems: number): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new EasyTierValidationError(`${field} 必须是最多 ${maxItems} 项的数组`, field)
  }
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)))
}

export const normalizeCredentialGenerateInput = (
  value: EasyTierCredentialGenerateInput
): NormalizedCredentialGenerateInput => {
  const ttlSeconds = Number(value.ttlSeconds)
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_CREDENTIAL_TTL_SECONDS) {
    throw new EasyTierValidationError('凭据 TTL 必须在 60 秒到 365 天之间', 'ttlSeconds')
  }
  const credentialId = value.credentialId?.trim()
  if (credentialId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentialId)) {
    throw new EasyTierValidationError('credentialId 必须是有效 UUID', 'credentialId')
  }
  const groups = normalizeStringList(value.groups, 'groups', 32)
  if (groups.some(group => !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(group))) {
    throw new EasyTierValidationError('groups 包含无效名称', 'groups')
  }
  const allowedProxyCidrs = normalizeStringList(value.allowedProxyCidrs, 'allowedProxyCidrs', 32)
    .map((cidr, index) => normalizeCidr(cidr, `allowedProxyCidrs[${index}]`) as string)
  return {
    ttlSeconds,
    ...(credentialId ? { credentialId } : {}),
    groups,
    allowRelay: value.allowRelay === true,
    allowedProxyCidrs,
    reusable: value.reusable === true
  }
}

export const normalizeCredentialList = (value: unknown): EasyTierCredentialSummary[] => {
  const root = asRecord(value)
  const items = Array.isArray(value)
    ? value
    : Array.isArray(root.credentials)
      ? root.credentials
      : Array.isArray(root.data)
        ? root.data
        : []
  return items.map(item => {
    const credential = asRecord(item)
    const id = String(credential.credential_id || credential.credentialId || credential.id || '')
    const expiryUnix = Number(credential.expiry_unix || credential.expiryUnix || 0)
    return {
      id,
      groups: Array.isArray(credential.groups) ? credential.groups.map(String) : [],
      allowRelay: credential.allow_relay === true || credential.allowRelay === true,
      allowedProxyCidrs: Array.isArray(credential.allowed_proxy_cidrs)
        ? credential.allowed_proxy_cidrs.map(String)
        : Array.isArray(credential.allowedProxyCidrs)
          ? credential.allowedProxyCidrs.map(String)
          : [],
      reusable: credential.reusable !== false,
      ...(expiryUnix > 0 ? { expiresAt: new Date(expiryUnix * 1000).toISOString() } : {}),
      revoked: false
    }
  }).filter(credential => Boolean(credential.id))
}

export const normalizeGeneratedCredential = (
  value: unknown,
  input: NormalizedCredentialGenerateInput
): { credential: EasyTierCredentialSummary; secret: string } => {
  const result = asRecord(value)
  const id = String(result.credential_id || result.credentialId || result.id || input.credentialId || '')
  const secret = String(result.credential_secret || result.credentialSecret || result.secret || '')
  if (!id || !secret) throw new Error('EasyTier CLI 未返回完整凭据信息')
  return {
    credential: {
      id,
      groups: input.groups,
      allowRelay: input.allowRelay,
      allowedProxyCidrs: input.allowedProxyCidrs,
      reusable: input.reusable,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
      revoked: false
    },
    secret
  }
}
