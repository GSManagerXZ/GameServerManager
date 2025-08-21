import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import winston from 'winston'

export interface AppConfig {
  jwt: {
    secret: string
    expiresIn: string
  }
  auth: {
    maxLoginAttempts: number
    lockoutDuration: number
    sessionTimeout: number
  }
  server: {
    port: number
    host: string
    corsOrigin: string
  }
  steamcmd: {
    installMode: 'online' | 'manual'
    installPath: string
    isInstalled: boolean
    version?: string
    lastChecked?: string
  }
  terminal: {
    defaultUser: string // 默认用户（仅Linux下有效）
  }
  game: {
    defaultInstallPath: string // 游戏默认安装路径
  }
  sponsor?: {
    key: string
    isValid: boolean
    expiryTime?: string
    validatedAt: string
  }
}

export class ConfigManager {
  private config: AppConfig
  private configPath: string
  private logger: winston.Logger

  constructor(logger: winston.Logger) {
    this.logger = logger
    this.configPath = path.join(process.cwd(), 'data', 'config.json')
    this.config = this.getDefaultConfig()
  }

  private getDefaultConfig(): AppConfig {
    return {
      jwt: {
        secret: this.generateJWTSecret(),
        expiresIn: '24h'
      },
      auth: {
        maxLoginAttempts: 5,
        lockoutDuration: 15 * 60 * 1000, // 15分钟
        sessionTimeout: 24 * 60 * 60 * 1000 // 24小时
      },
      server: {
        port: parseInt(process.env.PORT || '3001', 10),
        host: process.env.HOST || '0.0.0.0',
        corsOrigin: process.env.CLIENT_URL || 'http://localhost:3000'
      },
      steamcmd: {
        installMode: 'online',
        installPath: '',
        isInstalled: false
      },
      terminal: {
        defaultUser: '' // 默认为空，表示不切换用户
      },
      game: {
        defaultInstallPath: '' // 默认为空，用户需要设置
      }
    }
  }

  private generateJWTSecret(): string {
    return crypto.randomBytes(64).toString('hex')
  }

  async initialize(): Promise<void> {
    try {
      // 确保data目录存在
      const dataDir = path.dirname(this.configPath)
      await fs.mkdir(dataDir, { recursive: true })

      // 尝试加载现有配置
      await this.loadConfig()
      
      this.logger.info('配置管理器初始化完成')
    } catch (error) {
      this.logger.error('配置管理器初始化失败:', error)
      throw error
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8')
      const savedConfig = JSON.parse(configData) as Partial<AppConfig>
      
      // 合并默认配置和保存的配置
      this.config = this.mergeConfig(this.getDefaultConfig(), savedConfig)
      
      this.logger.info('配置文件加载成功')
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 配置文件不存在，创建新的
        this.logger.info('配置文件不存在，创建新的配置文件')
        await this.saveConfig()
      } else {
        this.logger.error('加载配置文件失败:', error)
        throw error
      }
    }
  }

  private mergeConfig(defaultConfig: AppConfig, savedConfig: Partial<AppConfig>): AppConfig {
    return {
      jwt: {
        ...defaultConfig.jwt,
        ...savedConfig.jwt
      },
      auth: {
        ...defaultConfig.auth,
        ...savedConfig.auth
      },
      server: {
        ...defaultConfig.server,
        ...savedConfig.server
      },
      steamcmd: {
        ...defaultConfig.steamcmd,
        ...savedConfig.steamcmd
      },
      terminal: {
        ...defaultConfig.terminal,
        ...savedConfig.terminal
      },
      game: {
        ...defaultConfig.game,
        ...savedConfig.game
      },
      sponsor: savedConfig.sponsor ? {
        ...savedConfig.sponsor
      } : undefined
    }
  }

  async saveConfig(): Promise<void> {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
      this.logger.info('配置文件保存成功')
    } catch (error) {
      this.logger.error('保存配置文件失败:', error)
      throw error
    }
  }

  getConfig(): AppConfig {
    return { ...this.config }
  }

  async updateConfig(updates: Partial<AppConfig>): Promise<void> {
    this.config = this.mergeConfig(this.config, updates)
    await this.saveConfig()
  }

  // 重新生成JWT密钥
  async regenerateJWTSecret(): Promise<void> {
    this.config.jwt.secret = this.generateJWTSecret()
    await this.saveConfig()
    this.logger.info('JWT密钥已重新生成')
  }

  getJWTSecret(): string {
    return this.config.jwt.secret
  }

  getJWTConfig() {
    return this.config.jwt
  }

  getAuthConfig() {
    return this.config.auth
  }

  getServerConfig() {
    return this.config.server
  }

  getSteamCMDConfig() {
    return this.config.steamcmd
  }

  async updateSteamCMDConfig(updates: Partial<AppConfig['steamcmd']>): Promise<void> {
    this.logger.info('Updating SteamCMD config with:', updates)
    this.config.steamcmd = {
      ...this.config.steamcmd,
      ...updates
    }
    this.logger.info('New SteamCMD config is:', this.config.steamcmd)
    await this.saveConfig()
    this.logger.info('SteamCMD配置已更新')
  }

  getTerminalConfig() {
    return this.config.terminal
  }

  async updateTerminalConfig(updates: Partial<AppConfig['terminal']>): Promise<void> {
    this.config.terminal = {
      ...this.config.terminal,
      ...updates
    }
    await this.saveConfig()
    this.logger.info('终端配置已更新')
  }

  getGameConfig() {
    return this.config.game
  }

  async updateGameConfig(updates: Partial<AppConfig['game']>): Promise<void> {
    this.config.game = {
      ...this.config.game,
      ...updates
    }
    await this.saveConfig()
    this.logger.info('游戏配置已更新')
  }

  getSponsorConfig() {
    return this.config.sponsor
  }

  async updateSponsorConfig(sponsorData: {
    key: string
    isValid: boolean
    expiryTime?: string
  }): Promise<void> {
    this.config.sponsor = {
      ...sponsorData,
      validatedAt: new Date().toISOString()
    }
    await this.saveConfig()
    this.logger.info('赞助者密钥配置已更新')
  }

  async clearSponsorConfig(): Promise<void> {
    delete this.config.sponsor
    await this.saveConfig()
    this.logger.info('赞助者密钥配置已清除')
  }
}