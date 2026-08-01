import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  buildEasyTierToml,
  createSecretPresence,
  normalizeEasyTierFlags,
  normalizeEasyTierProfile,
  normalizeEasyTierSecrets,
  redactSecrets
} from './easytierConfig.js'
import {
  EasyTierLegacyManifest,
  EasyTierLegacyMigrationResult,
  EasyTierProfile,
  EasyTierProfileDraft,
  EasyTierProfilePaths,
  EasyTierProfileSecrets,
  EasyTierProfileWriteRequest
} from './easytierTypes.js'
import { EasyTierSecretCipher } from './easytierSecretCipher.js'
import { getDefaultEasyTierDataRoot } from './easytierPaths.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MANIFEST_FILE = 'profile.json'
const SECRETS_FILE = 'secrets.enc.json'
const LEGACY_SECRETS_FILE = 'secrets.json'
const CONFIG_FILE = 'easytier.toml'
const CREDENTIAL_FILE = 'credential.toml'

export interface EasyTierProfileStoreOptions {
  dataRoot?: string
  legacyRoots?: string[]
  now?: () => Date
}

export type LegacyInstanceResolver = (manifest: EasyTierLegacyManifest, manifestPath: string) => Promise<string | undefined>

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const getDefaultLegacyRoots = (): string[] => {
  const baseDir = process.cwd()
  return Array.from(new Set([
    path.join(baseDir, 'data', 'tunnels'),
    path.join(baseDir, 'server', 'data', 'tunnels'),
    path.join(__dirname, '../../data/tunnels'),
    path.join(__dirname, '../../../data/tunnels')
  ]))
}

const assertInsideDirectory = (targetPath: string, rootPath: string): void => {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径超出 EasyTier 数据目录: ${targetPath}`)
  }
}

const sanitizeTimestamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-')

const readJson = async <T>(filePath: string): Promise<T> => {
  const content = await fs.readFile(filePath, 'utf-8')
  try {
    return JSON.parse(content) as T
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`JSON 文件格式无效: ${filePath}: ${reason}`)
  }
}

const writeFileWithMode = async (filePath: string, content: string, mode = 0o600): Promise<void> => {
  await fs.writeFile(filePath, content, { encoding: 'utf-8', mode })
  if (process.platform !== 'win32') await fs.chmod(filePath, mode)
}

const ensurePrivateDirectory = async (directory: string): Promise<void> => {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700)
}

const replaceFileAtomically = async (filePath: string, content: string, mode = 0o600): Promise<void> => {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  const replacementBackup = `${filePath}.replace-backup-${process.pid}-${randomUUID()}`
  let preserveBackup = false
  await writeFileWithMode(temporaryPath, content, mode)
  try {
    if (process.platform === 'win32' && await pathExists(filePath)) {
      await fs.rename(filePath, replacementBackup)
      try {
        await fs.rename(temporaryPath, filePath)
        await fs.rm(replacementBackup, { force: true })
      } catch (error) {
        try {
          await fs.rename(replacementBackup, filePath)
        } catch (rollbackError) {
          preserveBackup = true
          throw new Error(
            `替换文件失败，且无法恢复原文件；备份保留在 ${replacementBackup}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          )
        }
        throw error
      }
    } else {
      await fs.rename(temporaryPath, filePath)
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    if (!preserveBackup) await fs.rm(replacementBackup, { force: true }).catch(() => {})
  }
}

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return fallback
}

const normalizeNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean)
}

const normalizeLegacyCompressionAlgo = (value: unknown): number => {
  if (value === 2) return 2
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'zstd' || normalized === '2' ? 2 : 1
}

const getLegacyValue = <T>(values: Record<string, unknown>, key: string, fallback: T): T => {
  const value = values[key]
  return value === undefined || value === null || value === '' ? fallback : value as T
}

const normalizeStoredProfile = (profile: EasyTierProfile): EasyTierProfile => ({
  ...profile,
  settings: {
    ...profile.settings,
    flags: normalizeEasyTierFlags(profile.settings.flags),
    aclDefaultAction: profile.settings.aclDefaultAction === 'deny' ? 'deny' : 'allow'
  }
})

export class EasyTierProfileStore {
  readonly dataRoot: string
  readonly profilesRoot: string
  readonly backupsRoot: string
  readonly migrationBackupsRoot: string
  readonly deletedRoot: string
  readonly legacyRoots: string[]

  private readonly now: () => Date
  private readonly secretCipher: EasyTierSecretCipher

  constructor(options: EasyTierProfileStoreOptions = {}) {
    this.dataRoot = path.resolve(options.dataRoot || getDefaultEasyTierDataRoot())
    this.profilesRoot = path.join(this.dataRoot, 'profiles')
    this.backupsRoot = path.join(this.dataRoot, 'backups')
    this.migrationBackupsRoot = path.join(this.dataRoot, 'migration-backups')
    this.deletedRoot = path.join(this.dataRoot, 'deleted')
    this.legacyRoots = (options.legacyRoots || getDefaultLegacyRoots()).map(root => path.resolve(root))
    this.now = options.now || (() => new Date())
    this.secretCipher = new EasyTierSecretCipher(this.dataRoot)
  }

  async initialize(): Promise<void> {
    const directories = [
      this.dataRoot,
      this.profilesRoot,
      this.backupsRoot,
      this.migrationBackupsRoot,
      this.deletedRoot
    ]
    await Promise.all(directories.map(directory => ensurePrivateDirectory(directory)))
    await this.secretCipher.initialize()
  }

  getProfilePaths(profileId: string): EasyTierProfilePaths {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profileId)) {
      throw new Error('EasyTier profile ID 格式无效')
    }
    const directory = path.join(this.profilesRoot, profileId)
    assertInsideDirectory(directory, this.profilesRoot)
    return {
      directory,
      manifestPath: path.join(directory, MANIFEST_FILE),
      secretsPath: path.join(directory, SECRETS_FILE),
      configPath: path.join(directory, CONFIG_FILE),
      credentialPath: path.join(directory, CREDENTIAL_FILE)
    }
  }

  async hasProfile(profileId: string): Promise<boolean> {
    return pathExists(this.getProfilePaths(profileId).manifestPath)
  }

  async listProfiles(): Promise<EasyTierProfile[]> {
    await this.initialize()
    const entries = await fs.readdir(this.profilesRoot, { withFileTypes: true })
    const profiles = await Promise.all(entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async entry => {
        try {
          return await this.getProfile(entry.name)
        } catch {
          return null
        }
      }))

    return profiles
      .filter((profile): profile is EasyTierProfile => Boolean(profile))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  async getProfile(profileId: string): Promise<EasyTierProfile> {
    const paths = this.getProfilePaths(profileId)
    return normalizeStoredProfile(await readJson<EasyTierProfile>(paths.manifestPath))
  }

  async getSecrets(profileId: string): Promise<EasyTierProfileSecrets> {
    const paths = this.getProfilePaths(profileId)
    if (await pathExists(paths.secretsPath)) {
      const encrypted = await fs.readFile(paths.secretsPath, 'utf-8')
      return normalizeEasyTierSecrets(await this.secretCipher.decrypt<EasyTierProfileSecrets>(encrypted))
    }

    const legacyPath = path.join(paths.directory, LEGACY_SECRETS_FILE)
    if (!await pathExists(legacyPath)) return {}
    const secrets = normalizeEasyTierSecrets(await readJson<EasyTierProfileSecrets>(legacyPath))
    await replaceFileAtomically(paths.secretsPath, await this.secretCipher.encrypt(secrets))
    await fs.rm(legacyPath, { force: true })
    return secrets
  }

  async getRuntimeBundle(profileId: string, runtimeDirectory?: string): Promise<{
    profile: EasyTierProfile
    secrets: EasyTierProfileSecrets
    paths: EasyTierProfilePaths
  }> {
    const defaultPaths = this.getProfilePaths(profileId)
    if (!runtimeDirectory || path.resolve(runtimeDirectory) === defaultPaths.directory) {
      const profile = await this.getProfile(profileId)
      const secrets = await this.getSecrets(profileId)
      return this.captureRuntimeCredentialFile(profile, secrets, defaultPaths)
    }

    const directory = path.resolve(runtimeDirectory)
    assertInsideDirectory(directory, this.deletedRoot)
    const paths: EasyTierProfilePaths = {
      directory,
      manifestPath: path.join(directory, MANIFEST_FILE),
      secretsPath: path.join(directory, SECRETS_FILE),
      configPath: path.join(directory, CONFIG_FILE),
      credentialPath: path.join(directory, CREDENTIAL_FILE)
    }
    const profile = normalizeStoredProfile(await readJson<EasyTierProfile>(paths.manifestPath))
    if (profile.id !== profileId) throw new Error('EasyTier 运行目录与 profile 不匹配')
    const encrypted = await fs.readFile(paths.secretsPath, 'utf-8')
    const secrets = normalizeEasyTierSecrets(await this.secretCipher.decrypt<EasyTierProfileSecrets>(encrypted))
    return this.captureRuntimeCredentialFile(profile, secrets, paths)
  }

  private async captureRuntimeCredentialFile(
    profile: EasyTierProfile,
    secrets: EasyTierProfileSecrets,
    paths: EasyTierProfilePaths
  ): Promise<{
    profile: EasyTierProfile
    secrets: EasyTierProfileSecrets
    paths: EasyTierProfilePaths
  }> {
    if (!await pathExists(paths.credentialPath)) return { profile, secrets, paths }

    const credentialFileContent = (await fs.readFile(paths.credentialPath, 'utf-8')).trim()
    const normalizedSecrets = normalizeEasyTierSecrets({
      ...secrets,
      ...(credentialFileContent ? { credentialFileContent } : {})
    })
    const normalizedProfile = {
      ...profile,
      secretPresence: createSecretPresence(normalizedSecrets)
    }

    await replaceFileAtomically(paths.secretsPath, await this.secretCipher.encrypt(normalizedSecrets))
    await replaceFileAtomically(paths.manifestPath, `${JSON.stringify(normalizedProfile, null, 2)}\n`)
    await fs.rm(paths.credentialPath, { force: true })
    return { profile: normalizedProfile, secrets: normalizedSecrets, paths }
  }

  async saveRuntimeSecrets(
    profile: EasyTierProfile,
    secrets: EasyTierProfileSecrets,
    runtimeDirectory?: string
  ): Promise<void> {
    const defaultDirectory = this.getProfilePaths(profile.id).directory
    if (!runtimeDirectory || path.resolve(runtimeDirectory) === defaultDirectory) {
      await this.saveProfileInPlace({ profile, secrets, preserveExistingSecrets: false })
      return
    }

    const directory = path.resolve(runtimeDirectory)
    assertInsideDirectory(directory, this.deletedRoot)
    const normalizedSecrets = normalizeEasyTierSecrets(secrets)
    await replaceFileAtomically(
      path.join(directory, SECRETS_FILE),
      await this.secretCipher.encrypt(normalizedSecrets)
    )
    await replaceFileAtomically(
      path.join(directory, MANIFEST_FILE),
      `${JSON.stringify({
        ...profile,
        secretPresence: createSecretPresence(normalizedSecrets),
        updatedAt: this.now().toISOString()
      }, null, 2)}\n`
    )
  }

  async saveProfile(request: EasyTierProfileWriteRequest): Promise<EasyTierProfile> {
    await this.initialize()
    const requestedId = request.profile.id
    const existingBundle = requestedId && await pathExists(this.getProfilePaths(requestedId).manifestPath)
      ? await this.getRuntimeBundle(requestedId)
      : undefined
    const existingProfile = existingBundle?.profile
    const existingSecrets = existingBundle && request.preserveExistingSecrets !== false
      ? existingBundle.secrets
      : {}
    const incomingSecrets = normalizeEasyTierSecrets(request.secrets || {})
    const mergedSecrets = normalizeEasyTierSecrets({ ...existingSecrets, ...incomingSecrets })
    const profile = normalizeEasyTierProfile({
      ...request.profile,
      ...(existingProfile ? { createdAt: existingProfile.createdAt } : {})
    }, mergedSecrets, this.now())
    const paths = this.getProfilePaths(profile.id)
    const transactionId = `${sanitizeTimestamp(this.now())}-${process.pid}-${randomUUID()}`
    const stagingDirectory = path.join(this.profilesRoot, `.staging-${profile.id}-${transactionId}`)
    const backupDirectory = path.join(this.backupsRoot, profile.id, transactionId)

    assertInsideDirectory(stagingDirectory, this.profilesRoot)
    assertInsideDirectory(backupDirectory, this.backupsRoot)

    await fs.rm(stagingDirectory, { recursive: true, force: true })
    await fs.mkdir(stagingDirectory, { recursive: true, mode: 0o700 })
    const stagingPaths: EasyTierProfilePaths = {
      directory: stagingDirectory,
      manifestPath: path.join(stagingDirectory, MANIFEST_FILE),
      secretsPath: path.join(stagingDirectory, SECRETS_FILE),
      configPath: path.join(stagingDirectory, CONFIG_FILE),
      credentialPath: path.join(stagingDirectory, CREDENTIAL_FILE)
    }

    const configContent = buildEasyTierToml(profile, mergedSecrets, paths.credentialPath)
    await writeFileWithMode(stagingPaths.manifestPath, `${JSON.stringify(profile, null, 2)}\n`)
    await writeFileWithMode(stagingPaths.secretsPath, await this.secretCipher.encrypt(mergedSecrets))
    await writeFileWithMode(stagingPaths.configPath, configContent)

    let previousProfileMoved = false
    try {
      if (await pathExists(paths.directory)) {
        await fs.mkdir(path.dirname(backupDirectory), { recursive: true, mode: 0o700 })
        await fs.rename(paths.directory, backupDirectory)
        previousProfileMoved = true
      }
      await fs.rename(stagingDirectory, paths.directory)
      if (process.platform !== 'win32') await fs.chmod(paths.directory, 0o700)
      await this.pruneProfileBackups(profile.id).catch(() => {})
      return profile
    } catch (error) {
      await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {})
      if (previousProfileMoved && !await pathExists(paths.directory)) {
        await fs.rename(backupDirectory, paths.directory).catch(() => {})
      }
      throw error
    }
  }

  async saveProfileInPlace(request: EasyTierProfileWriteRequest): Promise<EasyTierProfile> {
    await this.initialize()
    if (!request.profile.id) throw new Error('原地保存 EasyTier profile 时必须提供 ID')
    const existingBundle = await this.getRuntimeBundle(request.profile.id)
    const existingProfile = existingBundle.profile
    const existingSecrets = request.preserveExistingSecrets === false
      ? {}
      : existingBundle.secrets
    const mergedSecrets = normalizeEasyTierSecrets({
      ...existingSecrets,
      ...normalizeEasyTierSecrets(request.secrets || {})
    })
    const profile = normalizeEasyTierProfile({
      ...request.profile,
      id: existingProfile.id,
      createdAt: existingProfile.createdAt
    }, mergedSecrets, this.now())
    const paths = this.getProfilePaths(profile.id)
    const backupDirectory = path.join(
      this.backupsRoot,
      profile.id,
      `${sanitizeTimestamp(this.now())}-in-place-${randomUUID()}`
    )
    await ensurePrivateDirectory(backupDirectory)

    const targets = [paths.manifestPath, paths.secretsPath, paths.configPath]
    for (const target of targets) {
      if (await pathExists(target)) {
        const backupPath = path.join(backupDirectory, path.basename(target))
        await fs.copyFile(target, backupPath)
        if (process.platform !== 'win32') await fs.chmod(backupPath, 0o600)
      }
    }

    try {
      await replaceFileAtomically(paths.secretsPath, await this.secretCipher.encrypt(mergedSecrets))
      await replaceFileAtomically(
        paths.configPath,
        buildEasyTierToml(profile, mergedSecrets, paths.credentialPath)
      )
      await replaceFileAtomically(paths.manifestPath, `${JSON.stringify(profile, null, 2)}\n`)
      await this.pruneProfileBackups(profile.id).catch(() => {})
      return profile
    } catch (error) {
      for (const target of targets) {
        const backupPath = path.join(backupDirectory, path.basename(target))
        if (await pathExists(backupPath)) {
          await replaceFileAtomically(target, await fs.readFile(backupPath, 'utf-8')).catch(() => {})
        } else {
          await fs.rm(target, { force: true }).catch(() => {})
        }
      }
      throw error
    }
  }

  async deleteProfileData(profileId: string): Promise<string | null> {
    await this.initialize()
    const paths = this.getProfilePaths(profileId)
    if (!await pathExists(paths.directory)) return null

    await this.getRuntimeBundle(profileId)

    const deletedDirectory = path.join(this.deletedRoot, profileId, sanitizeTimestamp(this.now()))
    assertInsideDirectory(deletedDirectory, this.deletedRoot)
    await fs.mkdir(path.dirname(deletedDirectory), { recursive: true, mode: 0o700 })
    await fs.rename(paths.directory, deletedDirectory)
    return deletedDirectory
  }

  async discardProfileData(profileId: string): Promise<void> {
    await this.initialize()
    const paths = this.getProfilePaths(profileId)
    assertInsideDirectory(paths.directory, this.profilesRoot)
    await fs.rm(paths.directory, { recursive: true, force: true })
  }

  async restoreProfileData(profileId: string, archivedDirectory: string): Promise<void> {
    const paths = this.getProfilePaths(profileId)
    assertInsideDirectory(archivedDirectory, this.deletedRoot)
    if (await pathExists(paths.directory)) {
      throw new Error(`无法恢复 EasyTier profile，目标目录已存在: ${profileId}`)
    }
    if (!await pathExists(archivedDirectory)) {
      throw new Error(`无法恢复 EasyTier profile，归档目录不存在: ${archivedDirectory}`)
    }
    await fs.rename(archivedDirectory, paths.directory)
  }

  async prepareDetachedArchive(profile: EasyTierProfile, archivedDirectory: string): Promise<void> {
    assertInsideDirectory(archivedDirectory, this.deletedRoot)
    const secretsPath = path.join(archivedDirectory, SECRETS_FILE)
    const configPath = path.join(archivedDirectory, CONFIG_FILE)
    const credentialPath = path.join(archivedDirectory, CREDENTIAL_FILE)
    const secrets = await this.secretCipher.decrypt<EasyTierProfileSecrets>(await fs.readFile(secretsPath, 'utf-8'))
    await replaceFileAtomically(
      configPath,
      buildEasyTierToml(profile, normalizeEasyTierSecrets(secrets), credentialPath)
    )
  }

  async migrateLegacyProfiles(resolveManagedInstanceId?: LegacyInstanceResolver): Promise<EasyTierLegacyMigrationResult[]> {
    await this.initialize()
    const results: EasyTierLegacyMigrationResult[] = []

    for (const legacyRoot of this.legacyRoots) {
      if (!await pathExists(legacyRoot)) continue
      const entries = await fs.readdir(legacyRoot, { withFileTypes: true })
      for (const entry of entries.filter(item => item.isDirectory())) {
        const legacyDirectory = path.join(legacyRoot, entry.name)
        const manifestPath = path.join(legacyDirectory, 'manifest.json')
        if (!await pathExists(manifestPath)) continue

        let manifest: EasyTierLegacyManifest
        try {
          manifest = await readJson<EasyTierLegacyManifest>(manifestPath)
        } catch (error) {
          results.push({
            profileId: '',
            legacyManifestPath: manifestPath,
            backupDirectory: '',
            status: 'skipped',
            reason: error instanceof Error ? error.message : '旧配置无法解析'
          })
          continue
        }

        if (String(manifest.tool || '').toLowerCase() !== 'easytier') continue
        let profileId: string
        let existingPaths: EasyTierProfilePaths
        try {
          profileId = manifest.migratedToProfileId || this.createLegacyProfileId(manifestPath)
          existingPaths = this.getProfilePaths(profileId)
        } catch (error) {
          results.push({
            profileId: '',
            legacyManifestPath: manifestPath,
            backupDirectory: '',
            status: 'skipped',
            reason: error instanceof Error ? error.message : '旧配置 profile ID 无效'
          })
          continue
        }
        if (await pathExists(existingPaths.manifestPath)) {
          const existingProfile = await this.getProfile(profileId)
          if (!manifest.migratedToProfileId) {
            const marker = `[MIGRATED TO EasyTier profile ${profileId}]`
            await this.replaceLegacyManifest(manifestPath, {
              ...manifest,
              formValues: redactSecrets(manifest.formValues || {}),
              startCommand: manifest.startCommand ? marker : undefined,
              relativeStartCommand: manifest.relativeStartCommand ? marker : undefined,
              migratedToProfileId: profileId,
              migratedAt: existingProfile.migration?.migratedAt || this.now().toISOString()
            })
          }
          results.push({
            profileId,
            legacyManifestPath: manifestPath,
            backupDirectory: existingProfile.migration?.backupDirectory || '',
            managedInstanceId: existingProfile.managedInstanceId,
            status: 'already-migrated'
          })
          continue
        }

        const migratedAt = this.now().toISOString()
        const backupDirectory = path.join(
          this.migrationBackupsRoot,
          profileId,
          sanitizeTimestamp(this.now())
        )
        assertInsideDirectory(backupDirectory, this.migrationBackupsRoot)
        await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 })

        const values = manifest.formValues || {}
        const secrets = this.extractLegacySecrets(values)
        const migratedCommandMarker = `[MIGRATED TO EasyTier profile ${profileId}]`
        const redactedManifest = redactSecrets({
          ...manifest,
          startCommand: manifest.startCommand ? migratedCommandMarker : undefined,
          relativeStartCommand: manifest.relativeStartCommand ? migratedCommandMarker : undefined
        })
        const rollbackSecrets = {
          ...secrets,
          legacyStartCommand: manifest.startCommand,
          legacyRelativeStartCommand: manifest.relativeStartCommand
        }
        await writeFileWithMode(path.join(backupDirectory, 'legacy-manifest.redacted.json'), `${JSON.stringify(redactedManifest, null, 2)}\n`)
        await writeFileWithMode(
          path.join(backupDirectory, 'rollback-secrets.enc.json'),
          await this.secretCipher.encrypt(rollbackSecrets)
        )

        const managedInstanceId = resolveManagedInstanceId
          ? await resolveManagedInstanceId(manifest, manifestPath)
          : undefined
        const draft = await this.createDraftFromLegacyManifest(
          profileId,
          manifest,
          legacyDirectory,
          manifestPath,
          backupDirectory,
          migratedAt,
          managedInstanceId
        )
        const profile = await this.saveProfile({ profile: draft, secrets, preserveExistingSecrets: false })

        const sanitizedLegacyValues = redactSecrets(values)
        const sanitizedLegacyManifest: EasyTierLegacyManifest = {
          ...manifest,
          formValues: sanitizedLegacyValues,
          startCommand: manifest.startCommand ? migratedCommandMarker : undefined,
          relativeStartCommand: manifest.relativeStartCommand ? migratedCommandMarker : undefined,
          migratedToProfileId: profile.id,
          migratedAt
        }
        await this.replaceLegacyManifest(manifestPath, sanitizedLegacyManifest)

        results.push({
          profileId: profile.id,
          legacyManifestPath: manifestPath,
          backupDirectory,
          managedInstanceId,
          status: 'migrated'
        })
      }
    }

    return results
  }

  private createLegacyProfileId(manifestPath: string): string {
    return `legacy-${createHash('sha256').update(path.resolve(manifestPath)).digest('hex').slice(0, 16)}`
  }

  private extractLegacySecrets(values: Record<string, unknown>): EasyTierProfileSecrets {
    return normalizeEasyTierSecrets({
      networkSecret: typeof values.networkSecret === 'string' ? values.networkSecret : undefined,
      localPrivateKey: typeof values.localPrivateKey === 'string' ? values.localPrivateKey : undefined,
      credentialFileContent: typeof values.credentialFileContent === 'string' ? values.credentialFileContent : undefined
    })
  }

  private async createDraftFromLegacyManifest(
    profileId: string,
    manifest: EasyTierLegacyManifest,
    legacyDirectory: string,
    manifestPath: string,
    backupDirectory: string,
    migratedAt: string,
    managedInstanceId?: string
  ): Promise<EasyTierProfileDraft> {
    const values = manifest.formValues || {}
    const profileName = String(getLegacyValue(values, 'profile', manifest.profile || path.basename(legacyDirectory)))
    const hostname = String(getLegacyValue(values, 'hostname', `gsm-${profileId.slice(-8)}`))
    const corePath = String(manifest.executablePath || getLegacyValue(values, 'executablePath', 'easytier-core'))
    const cliCandidate = path.join(path.dirname(corePath), process.platform === 'win32' ? 'easytier-cli.exe' : 'easytier-cli')
    const cliPath = await pathExists(cliCandidate) ? cliCandidate : undefined
    const peers = normalizeList(values.peers).map(uri => ({ uri }))
    const proxyNetworks = normalizeList(values.proxyNetworks).map(cidr => ({ cidr }))
    const routes = normalizeList(values.manualRoutes)
    const exitNodes = normalizeList(values.exitNodes)
    const enableExitNode = normalizeBoolean(values.enableExitNode)
    const vpnPortal = typeof values.vpnPortal === 'string' && values.vpnPortal.trim()
      ? this.parseLegacyVpnPortal(values.vpnPortal)
      : undefined
    const preset = enableExitNode
      ? 'exit-node'
      : vpnPortal
        ? 'vpn-portal'
        : proxyNetworks.length > 0
          ? 'subnet-gateway'
          : normalizeBoolean(values.noTun)
            ? 'shared-node'
            : 'game-node'
    const localPort = normalizeNumber(values.localPort, 25565)

    return {
      id: profileId,
      name: profileName,
      description: `从 tunnel-helper 迁移的 EasyTier 配置：${manifest.profile || profileName}`,
      preset,
      networkName: String(getLegacyValue(values, 'networkName', 'EasyTier')),
      autoStart: normalizeBoolean(values.autoStart),
      binary: { corePath, ...(cliPath ? { cliPath } : {}) },
      settings: {
        hostname,
        instanceName: String(getLegacyValue(values, 'instanceName', hostname)),
        ipv4: normalizeBoolean(values.dhcp, true) ? undefined : String(getLegacyValue(values, 'ipv4', '')) || undefined,
        ipv6: String(getLegacyValue(values, 'ipv6', '')) || undefined,
        dhcp: normalizeBoolean(values.dhcp, true),
        noListener: normalizeBoolean(values.noListener),
        peers,
        proxyNetworks,
        routes,
        exitNodes,
        ...(vpnPortal ? { vpnPortal } : {}),
        socks5Proxy: String(getLegacyValue(values, 'socks5', '')) || undefined,
        externalNode: String(getLegacyValue(values, 'externalNode', '')) || undefined,
        rpcPortal: String(getLegacyValue(values, 'rpcPortal', '')) || undefined,
        flags: {
          default_protocol: String(getLegacyValue(values, 'defaultProtocol', 'tcp')),
          enable_ipv6: !normalizeBoolean(values.disableIpv6),
          enable_encryption: !normalizeBoolean(values.disableEncryption),
          latency_first: normalizeBoolean(values.latencyFirst),
          enable_exit_node: enableExitNode,
          no_tun: normalizeBoolean(values.noTun),
          use_smoltcp: normalizeBoolean(values.useSmoltcp),
          disable_p2p: normalizeBoolean(values.disableP2p),
          accept_dns: normalizeBoolean(values.acceptDns),
          private_mode: normalizeBoolean(values.privateMode),
          enable_kcp_proxy: normalizeBoolean(values.enableKcpProxy),
          enable_quic_proxy: normalizeBoolean(values.enableQuicProxy),
          proxy_forward_by_system: normalizeBoolean(values.proxyForwardBySystem),
          lazy_p2p: normalizeBoolean(values.lazyP2p),
          p2p_only: normalizeBoolean(values.p2pOnly),
          need_p2p: normalizeBoolean(values.needP2p),
          mtu: normalizeNumber(values.mtu, 1380),
          dev_name: String(getLegacyValue(values, 'devName', '')),
          data_compress_algo: normalizeLegacyCompressionAlgo(getLegacyValue(values, 'compression', 'none')),
          encryption_algorithm: String(getLegacyValue(values, 'encryptionAlgorithm', 'aes-gcm'))
        }
      },
      target: {
        address: String(getLegacyValue(values, 'localAddress', '127.0.0.1')),
        port: Math.min(65535, Math.max(1, Math.trunc(localPort))),
        protocol: 'both'
      },
      ...(managedInstanceId ? { managedInstanceId } : {}),
      migration: {
        source: 'tunnel-helper',
        legacyDirectory,
        legacyManifestPath: manifestPath,
        backupDirectory,
        migratedAt,
        legacyProfileName: manifest.profile || profileName
      },
      createdAt: manifest.savedAt,
      updatedAt: migratedAt
    }
  }

  private parseLegacyVpnPortal(value: string): { clientCidr: string; wireguardListen: string } | undefined {
    const separator = value.lastIndexOf(':')
    if (separator <= 0) return undefined
    const clientCidr = value.slice(0, separator).trim()
    const wireguardListen = value.slice(separator + 1).trim()
    if (!clientCidr || !wireguardListen) return undefined
    return {
      clientCidr,
      wireguardListen: /^\d+$/.test(wireguardListen) ? `0.0.0.0:${wireguardListen}` : wireguardListen
    }
  }

  private async replaceLegacyManifest(manifestPath: string, manifest: EasyTierLegacyManifest): Promise<void> {
    const temporaryPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
    await writeFileWithMode(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`)
    try {
      if (process.platform === 'win32' && await pathExists(manifestPath)) {
        const replacementBackup = `${manifestPath}.replace-backup`
        await fs.rm(replacementBackup, { force: true })
        await fs.rename(manifestPath, replacementBackup)
        try {
          await fs.rename(temporaryPath, manifestPath)
          await fs.rm(replacementBackup, { force: true })
        } catch (error) {
          await fs.rename(replacementBackup, manifestPath).catch(() => {})
          throw error
        }
      } else {
        await fs.rename(temporaryPath, manifestPath)
      }
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
    }
  }

  private async pruneProfileBackups(profileId: string, keep = 10): Promise<void> {
    const profileBackupRoot = path.join(this.backupsRoot, profileId)
    if (!await pathExists(profileBackupRoot)) return
    const entries = (await fs.readdir(profileBackupRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((left, right) => right.localeCompare(left))
    await Promise.all(entries.slice(keep).map(entry => (
      fs.rm(path.join(profileBackupRoot, entry), { recursive: true, force: true })
    )))
  }
}
