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
  security: {
    tokenResetRule: 'startup' | 'expire' // 令牌重置规则：启动时重置、过期自动重置
    tokenExpireHours: number | null // 令牌到期时间（小时），null表示永不到期
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
  developer?: {
    passwordHash: string
    salt: string
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
      security: {
        tokenResetRule: 'startup', // 默认启动时重置
        tokenExpireHours: 24 // 默认24小时
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
      
      // 检查是否需要启动时重置令牌
      await this.checkAndResetTokenOnStartup()
      
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
      security: {
        ...defaultConfig.security,
        ...savedConfig.security
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
      } : undefined,
      developer: savedConfig.developer ? {
        ...savedConfig.developer
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

  // 开发者配置相关方法
  getDeveloperConfig() {
    return this.config.developer
  }

  hasDeveloperPassword(): boolean {
    return !!(this.config.developer?.passwordHash && this.config.developer?.salt)
  }

  async setDeveloperPassword(passwordHash: string, salt: string): Promise<void> {
    this.config.developer = {
      passwordHash,
      salt
    }
    await this.saveConfig()
    this.logger.info('开发者密码已设置')
  }

  async clearDeveloperConfig(): Promise<void> {
    delete this.config.developer
    await this.saveConfig()
    this.logger.info('开发者配置已清除')
  }

  // 安全配置相关方法
  getSecurityConfig() {
    return this.config.security
  }

  async updateSecurityConfig(updates: Partial<AppConfig['security']>): Promise<void> {
    this.config.security = {
      ...this.config.security,
      ...updates
    }
    await this.saveConfig()
    this.logger.info('安全配置已更新')
  }

  // 更新JWT配置（包括到期时间）
  async updateJWTConfig(updates: Partial<AppConfig['jwt']>): Promise<void> {
    this.config.jwt = {
      ...this.config.jwt,
      ...updates
    }
    await this.saveConfig()
    this.logger.info('JWT配置已更新')
  }

  // 检查并重置令牌（启动时调用）
  private async checkAndResetTokenOnStartup(): Promise<void> {
    const securityConfig = this.config.security
    
    if (securityConfig.tokenResetRule === 'startup') {
      // 检查是否有启动标记文件
      const startupFlagPath = path.join(path.dirname(this.configPath), '.last_startup')
      
      try {
        const lastStartup = await fs.readFile(startupFlagPath, 'utf-8')
        const lastStartupTime = new Date(lastStartup)
        const now = new Date()
        
        // 如果距离上次启动超过1分钟，则重置令牌
        const timeDiff = now.getTime() - lastStartupTime.getTime()
        if (timeDiff > 60000) { // 1分钟
          await this.regenerateJWTSecret()
          this.logger.info('启动时重置JWT密钥（距离上次启动超过1分钟）')
        } else {
          this.logger.info('启动时跳过JWT密钥重置（距离上次启动不足1分钟）') 
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // 文件不存在，说明是首次启动或很久没启动，重置令牌
          await this.regenerateJWTSecret()
          this.logger.info('启动时重置JWT密钥（首次启动或启动标记文件不存在）')
        } else {
          this.logger.error('检查启动标记文件失败:', error)
        }
      }
      
      // 更新启动标记文件
      try {
        await fs.writeFile(startupFlagPath, new Date().toISOString(), 'utf-8')
      } catch (error) {
        this.logger.error('更新启动标记文件失败:', error)
      }
    }
  }
}