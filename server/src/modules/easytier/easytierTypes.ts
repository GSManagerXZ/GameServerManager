export const EASYTIER_PROFILE_SCHEMA_VERSION = 2 as const

export type EasyTierProfilePreset =
  | 'game-node'
  | 'shared-node'
  | 'subnet-gateway'
  | 'exit-node'
  | 'vpn-portal'
  | 'custom'

export type EasyTierRuntimeState =
  | 'unknown'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export type EasyTierPortProtocol = 'tcp' | 'udp'
export type EasyTierAllowedProtocol = 'tcp' | 'udp' | 'icmp'
export type EasyTierFlagValue = string | number | boolean

export interface EasyTierBinarySelection {
  corePath: string
  cliPath?: string
}

export interface EasyTierBinaryCapabilities {
  version?: string
  corePath: string
  cliPath?: string
  supportsConfigFile: boolean
  supportsJsonOutput: boolean
  supportsSecureMode: boolean
  supportsCredentials: boolean
  supportsAcl: boolean
  flags: string[]
  coreFlags: string[]
  cliFlags: string[]
  commands: string[]
  detectedAt: string
  compatibilityWarnings: string[]
}

export interface EasyTierInstallation {
  version: string
  artifactName: string
  platform: string
  architecture: string
  installedAt: string
  directory: string
  corePath: string
  cliPath: string
  webPath: string
  webEmbedPath: string
  sha256?: string
}

export interface EasyTierInstallationStatus {
  recommendedVersion: string
  platform: string
  architecture: string
  artifactName?: string
  supported: boolean
  unsupportedReason?: string
  installation?: EasyTierInstallation
}

export type EasyTierWebConfigProtocol = 'udp' | 'tcp' | 'ws'

export interface EasyTierWebSettings {
  schemaVersion: 1
  binaryPath: string
  apiServerAddress: string
  apiServerPort: number
  apiHost?: string
  configServerPort: number
  configServerProtocol: EasyTierWebConfigProtocol
  disableRegistration: boolean
  allowAutoCreateUser: boolean
  autoStart: boolean
  managedInstanceId?: string
  updatedAt: string
}

export type EasyTierWebSettingsInput = Partial<Omit<
  EasyTierWebSettings,
  'schemaVersion' | 'managedInstanceId' | 'updatedAt'
>>

export interface EasyTierWebStatus {
  configured: boolean
  binaryAvailable: boolean
  version?: string
  healthy: boolean
  managementUrl?: string
  configServerUri: string
  databasePath: string
  logsDirectory: string
  settings: EasyTierWebSettings
  instance?: {
    id: string
    name: string
    status: EasyTierRuntimeState
    lastStarted?: string
    lastStopped?: string
  }
  warnings: string[]
}

export interface EasyTierGameTarget {
  address: string
  port: number
  protocol: EasyTierPortProtocol | 'both'
  linkedGameInstanceId?: string
}

export interface EasyTierPeerConfig {
  uri: string
  peerPublicKey?: string
}

export interface EasyTierProxyNetworkConfig {
  cidr: string
  mappedCidr?: string
  allow?: EasyTierAllowedProtocol[]
}

export interface EasyTierVpnPortalConfig {
  clientCidr: string
  wireguardListen: string
}

export interface EasyTierPortForwardConfig {
  id: string
  bindAddr: string
  dstAddr: string
  proto: EasyTierPortProtocol
}

export interface EasyTierLoggerConfig {
  level?: string
  file?: string
  dir?: string
  sizeMb?: number
  count?: number
}

export interface EasyTierLoggingConfig {
  file?: EasyTierLoggerConfig
  console?: Pick<EasyTierLoggerConfig, 'level'>
}

export interface EasyTierSecureModeConfig {
  enabled: boolean
  localPublicKey?: string
}

export interface EasyTierAclRule {
  id: string
  action: 'allow' | 'deny'
  protocol?: EasyTierAllowedProtocol | 'any'
  sourceGroups?: string[]
  destinationGroups?: string[]
  source?: string
  destination?: string
  sourcePort?: string
  destinationPort?: string
  description?: string
}

export interface EasyTierProfileSettings {
  hostname: string
  instanceName: string
  ipv4?: string
  ipv6?: string
  dhcp: boolean
  noListener: boolean
  listeners: string[]
  mappedListeners: string[]
  peers: EasyTierPeerConfig[]
  proxyNetworks: EasyTierProxyNetworkConfig[]
  routes: string[]
  exitNodes: string[]
  vpnPortal?: EasyTierVpnPortalConfig
  socks5Proxy?: string
  portForwards: EasyTierPortForwardConfig[]
  tcpWhitelist: string[]
  udpWhitelist: string[]
  stunServers: string[]
  stunServersV6: string[]
  externalNode?: string
  rpcPortal?: string
  rpcPortalWhitelist: string[]
  flags: Record<string, EasyTierFlagValue>
  logging: EasyTierLoggingConfig
  secureMode: EasyTierSecureModeConfig
  aclDefaultAction: 'allow' | 'deny'
  acl: EasyTierAclRule[]
}

export interface EasyTierSecretPresence {
  networkSecret: boolean
  localPrivateKey: boolean
  credentialFile: boolean
}

export interface EasyTierProfileMigration {
  source: 'tunnel-helper'
  legacyDirectory: string
  legacyManifestPath: string
  backupDirectory: string
  migratedAt: string
  legacyProfileName: string
}

export interface EasyTierProfile {
  schemaVersion: typeof EASYTIER_PROFILE_SCHEMA_VERSION
  id: string
  name: string
  description: string
  preset: EasyTierProfilePreset
  networkName: string
  autoStart: boolean
  binary: EasyTierBinarySelection
  settings: EasyTierProfileSettings
  target?: EasyTierGameTarget
  managedInstanceId?: string
  capabilities?: EasyTierBinaryCapabilities
  secretPresence: EasyTierSecretPresence
  migration?: EasyTierProfileMigration
  createdAt: string
  updatedAt: string
}

export interface EasyTierProfileDraft {
  id?: string
  name: string
  description?: string
  preset?: EasyTierProfilePreset
  networkName: string
  autoStart?: boolean
  binary: EasyTierBinarySelection
  settings: Partial<EasyTierProfileSettings> & Pick<EasyTierProfileSettings, 'hostname'>
  target?: EasyTierGameTarget
  managedInstanceId?: string
  capabilities?: EasyTierBinaryCapabilities
  migration?: EasyTierProfileMigration
  createdAt?: string
  updatedAt?: string
}

export interface EasyTierProfileSecrets {
  networkSecret?: string
  localPrivateKey?: string
  credentialFileContent?: string
}

export interface EasyTierProfileWriteRequest {
  profile: EasyTierProfileDraft | EasyTierProfile
  secrets?: EasyTierProfileSecrets
  preserveExistingSecrets?: boolean
}

export interface EasyTierProfilePaths {
  directory: string
  manifestPath: string
  secretsPath: string
  configPath: string
  credentialPath: string
}

export interface EasyTierLegacyManifest {
  profile?: string
  tool?: string
  startCommand?: string
  relativeStartCommand?: string
  workingDirectory?: string
  executablePath?: string
  savedAt?: string
  formValues?: Record<string, unknown>
  migratedToProfileId?: string
  migratedAt?: string
}

export interface EasyTierLegacyMigrationResult {
  profileId: string
  legacyManifestPath: string
  backupDirectory: string
  managedInstanceId?: string
  status: 'migrated' | 'already-migrated' | 'skipped'
  reason?: string
}

export interface EasyTierNodeSummary {
  virtualIpv4?: string
  hostname?: string
  instanceName?: string
  publicKey?: string
  version?: string
  uptimeSeconds?: number
  natType?: string
}

export interface EasyTierPeerSummary {
  id: string
  hostname?: string
  virtualIpv4?: string
  publicKey?: string
  latencyMs?: number
  lossRate?: number
  natType?: string
  tunnelProtocol?: string
  direct: boolean
}

export interface EasyTierRouteSummary {
  destination: string
  nextHop?: string
  interface?: string
  metric?: number
  proxy: boolean
}

export interface EasyTierTrafficStats {
  rxBytes: number
  txBytes: number
  rxPackets?: number
  txPackets?: number
  activeConnections?: number
}

export interface EasyTierRuntimeSnapshot {
  profileId: string
  state: EasyTierRuntimeState
  capturedAt: string
  node?: EasyTierNodeSummary
  peers: EasyTierPeerSummary[]
  routes: EasyTierRouteSummary[]
  traffic?: EasyTierTrafficStats
  raw?: {
    node?: unknown
    peers?: unknown
    routes?: unknown
    stats?: unknown
  }
  warnings: string[]
  error?: string
}

export type EasyTierRuntimeAction =
  | { type: 'connector-add'; uri: string }
  | { type: 'connector-remove'; uri: string }
  | { type: 'mapped-listener-add'; uri: string }
  | { type: 'mapped-listener-remove'; uri: string }
  | { type: 'port-forward-add'; value: EasyTierPortForwardConfig }
  | { type: 'port-forward-remove'; id: string }
  | { type: 'tcp-whitelist-set'; values: string[] }
  | { type: 'udp-whitelist-set'; values: string[] }
  | { type: 'logger-set'; value: EasyTierLoggingConfig }

export interface EasyTierRuntimeActionResult {
  profile: EasyTierProfile
  snapshot: EasyTierRuntimeSnapshot
}

export interface EasyTierCredentialSummary {
  id: string
  groups: string[]
  allowRelay: boolean
  allowedProxyCidrs: string[]
  reusable: boolean
  expiresAt?: string
  revoked: boolean
}

export interface EasyTierCredentialCreateResult {
  credential: EasyTierCredentialSummary
  secret: string
}
