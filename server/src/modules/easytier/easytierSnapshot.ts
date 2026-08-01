import type {
  EasyTierRuntimeSnapshot,
  EasyTierRuntimeState
} from './easytierTypes.js'

export interface EasyTierRawSnapshotData {
  node?: unknown
  peers?: unknown
  routes?: unknown
  stats?: unknown
}

const normalizeJsonKey = (value: string): string => value.replace(/[-_]/g, '').toLowerCase()

const findNestedValue = (value: unknown, keys: string[], depth = 0): unknown => {
  if (!value || typeof value !== 'object' || depth > 5) return undefined
  const record = value as Record<string, unknown>
  const normalizedKeys = new Set(keys.map(normalizeJsonKey))
  for (const [key, nested] of Object.entries(record)) {
    if (normalizedKeys.has(normalizeJsonKey(key))) return nested
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') {
      const result = findNestedValue(nested, keys, depth + 1)
      if (result !== undefined) return result
    }
  }
  return undefined
}

const extractNestedArray = (value: unknown, keys: string[], depth = 0): unknown[] => {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object' || depth > 5) return []
  const record = value as Record<string, unknown>
  const normalizedKeys = new Set(keys.map(normalizeJsonKey))
  for (const [key, nested] of Object.entries(record)) {
    if (normalizedKeys.has(normalizeJsonKey(key)) && Array.isArray(nested)) return nested
  }
  for (const nested of Object.values(record)) {
    const result = extractNestedArray(nested, keys, depth + 1)
    if (result.length > 0) return result
  }
  return []
}

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(', ')
  return undefined
}

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value.replace(/[^0-9.+-]/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

const normalizeNodeSnapshot = (raw: unknown): EasyTierRuntimeSnapshot['node'] | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const virtualIpv4 = stringValue(findNestedValue(raw, ['virtual_ipv4', 'ipv4_addr', 'ipv4', 'cidr']))
  const hostname = stringValue(findNestedValue(raw, ['hostname', 'host_name']))
  const instanceName = stringValue(findNestedValue(raw, ['instance_name', 'network_instance_name']))
  const publicKey = stringValue(findNestedValue(raw, ['public_key', 'node_public_key']))
  const version = stringValue(findNestedValue(raw, ['version']))
  const uptimeSeconds = numberValue(findNestedValue(raw, ['uptime_seconds', 'uptime_sec', 'uptime']))
  const natType = stringValue(findNestedValue(raw, ['nat_type', 'udp_nat_type']))
  const node = {
    ...(virtualIpv4 ? { virtualIpv4 } : {}),
    ...(hostname ? { hostname } : {}),
    ...(instanceName ? { instanceName } : {}),
    ...(publicKey ? { publicKey } : {}),
    ...(version ? { version } : {}),
    ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {}),
    ...(natType ? { natType } : {})
  }
  return Object.keys(node).length > 0 ? node : undefined
}

const normalizePeerSnapshots = (raw: unknown): EasyTierRuntimeSnapshot['peers'] => (
  extractNestedArray(raw, ['peer_routes', 'peers', 'items']).map((peer, index) => {
    const id = stringValue(findNestedValue(peer, ['peer_id', 'node_id', 'id', 'public_key'])) || `peer-${index + 1}`
    const hostname = stringValue(findNestedValue(peer, ['hostname', 'host_name']))
    const virtualIpv4 = stringValue(findNestedValue(peer, ['virtual_ipv4', 'ipv4_addr', 'ipv4', 'cidr']))
    const publicKey = stringValue(findNestedValue(peer, ['public_key', 'peer_public_key']))
    const latencyMs = numberValue(findNestedValue(peer, ['latency_ms', 'lat_ms', 'latency']))
    const lossRate = numberValue(findNestedValue(peer, ['loss_rate', 'packet_loss']))
    const natType = stringValue(findNestedValue(peer, ['nat_type', 'udp_nat_type']))
    const tunnelProtocol = stringValue(findNestedValue(peer, ['tunnel_protocol', 'tunnel_proto', 'protocol']))
    const directValue = findNestedValue(peer, ['direct', 'is_direct'])
    const pathLength = numberValue(findNestedValue(peer, ['path_len', 'path_length', 'hop_count']))
    return {
      id,
      ...(hostname ? { hostname } : {}),
      ...(virtualIpv4 ? { virtualIpv4 } : {}),
      ...(publicKey ? { publicKey } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(lossRate !== undefined ? { lossRate } : {}),
      ...(natType ? { natType } : {}),
      ...(tunnelProtocol ? { tunnelProtocol } : {}),
      direct: typeof directValue === 'boolean' ? directValue : pathLength !== undefined && pathLength <= 1
    }
  })
)

const normalizeRouteSnapshots = (raw: unknown): EasyTierRuntimeSnapshot['routes'] => (
  extractNestedArray(raw, ['routes', 'peer_routes', 'items']).map((route, index) => {
    const destination = stringValue(findNestedValue(route, [
      'destination',
      'dst',
      'proxy_cidr',
      'proxy_cidrs',
      'ipv4_addr',
      'ipv4',
      'cidr'
    ])) || `route-${index + 1}`
    const nextHop = stringValue(findNestedValue(route, [
      'next_hop_ipv4',
      'next_hop',
      'gateway',
      'peer_id'
    ]))
    const interfaceName = stringValue(findNestedValue(route, ['interface', 'iface', 'device']))
    const metric = numberValue(findNestedValue(route, ['metric', 'cost', 'path_latency']))
    const proxyValue = findNestedValue(route, ['proxy', 'is_proxy', 'proxy_cidrs'])
    return {
      destination,
      ...(nextHop ? { nextHop } : {}),
      ...(interfaceName ? { interface: interfaceName } : {}),
      ...(metric !== undefined ? { metric } : {}),
      proxy: Array.isArray(proxyValue) ? proxyValue.length > 0 : Boolean(proxyValue)
    }
  })
)

const normalizeTrafficSnapshot = (raw: unknown): EasyTierRuntimeSnapshot['traffic'] | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const metrics = extractNestedArray(raw, ['metrics', 'stats', 'items'])
  let rxBytes = 0
  let txBytes = 0
  let rxPackets = 0
  let txPackets = 0
  let activeConnections = 0
  let foundMetric = false
  for (const metric of metrics) {
    const name = (stringValue(findNestedValue(metric, ['name', 'metric_name'])) || '').toLowerCase()
    const value = numberValue(findNestedValue(metric, ['value', 'metric_value']))
    if (!name || value === undefined) continue
    if (name.includes('rx') && name.includes('byte')) { rxBytes += value; foundMetric = true }
    else if (name.includes('tx') && name.includes('byte')) { txBytes += value; foundMetric = true }
    else if (name.includes('rx') && name.includes('packet')) { rxPackets += value; foundMetric = true }
    else if (name.includes('tx') && name.includes('packet')) { txPackets += value; foundMetric = true }
    else if (name.includes('connection') && (name.includes('active') || name.includes('current'))) {
      activeConnections += value
      foundMetric = true
    }
  }
  if (!foundMetric) {
    const directRxBytes = numberValue(findNestedValue(raw, ['rx_bytes', 'received_bytes']))
    const directTxBytes = numberValue(findNestedValue(raw, ['tx_bytes', 'sent_bytes']))
    if (directRxBytes === undefined && directTxBytes === undefined) return undefined
    const directRxPackets = numberValue(findNestedValue(raw, ['rx_packets', 'received_packets']))
    const directTxPackets = numberValue(findNestedValue(raw, ['tx_packets', 'sent_packets']))
    const directConnections = numberValue(findNestedValue(raw, ['active_connections', 'current_connections']))
    return {
      rxBytes: directRxBytes || 0,
      txBytes: directTxBytes || 0,
      ...(directRxPackets !== undefined ? { rxPackets: directRxPackets } : {}),
      ...(directTxPackets !== undefined ? { txPackets: directTxPackets } : {}),
      ...(directConnections !== undefined ? { activeConnections: directConnections } : {})
    }
  }
  return {
    rxBytes,
    txBytes,
    ...(rxPackets > 0 ? { rxPackets } : {}),
    ...(txPackets > 0 ? { txPackets } : {}),
    ...(activeConnections > 0 ? { activeConnections } : {})
  }
}

export const toEasyTierRuntimeState = (status?: string): EasyTierRuntimeState => (
  ['stopped', 'starting', 'running', 'stopping', 'error'].includes(status || '')
    ? status as EasyTierRuntimeState
    : 'unknown'
)

export const safeEasyTierErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return '未知错误'
  return error.message.replace(/[\r\n]+/g, ' ').slice(0, 300)
}

export const getEasyTierSettledWarning = (
  label: string,
  result: PromiseSettledResult<unknown>
): string[] => (
  result.status === 'rejected'
    ? [`${label}: ${safeEasyTierErrorMessage(result.reason)}`]
    : []
)

export const buildEasyTierRuntimeSnapshot = (options: {
  profileId: string
  state: EasyTierRuntimeState
  capturedAt: string
  raw: EasyTierRawSnapshotData
  warnings: string[]
}): EasyTierRuntimeSnapshot => {
  const node = normalizeNodeSnapshot(options.raw.node)
  const traffic = normalizeTrafficSnapshot(options.raw.stats)
  return {
    profileId: options.profileId,
    state: options.state,
    capturedAt: options.capturedAt,
    ...(node ? { node } : {}),
    peers: normalizePeerSnapshots(options.raw.peers),
    routes: normalizeRouteSnapshots(options.raw.routes),
    ...(traffic ? { traffic } : {}),
    raw: { ...options.raw },
    warnings: [...options.warnings],
    ...(options.warnings.length === 4 ? { error: 'EasyTier CLI 快照采集失败' } : {})
  }
}
