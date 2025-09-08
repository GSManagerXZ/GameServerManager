import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import type { ConfigManager } from '../../config/ConfigManager.js'
import type {
  DeveloperAuth,
  DeveloperJWTPayload,
  ProductionPackageResult,
  GameConfig,
  GameConfigData
} from '../types/developer.js'
import logger from '../../../utils/logger.js'

/**
 * 开发者服务类
 */
export class DeveloperService {
  private configManager: ConfigManager

  constructor(configManager: ConfigManager) {
    this.configManager = configManager
  }

  /**
   * 检查开发者认证状态
   */
  async checkAuthStatus(userPayload?: DeveloperJWTPayload): Promise<DeveloperAuth> {
    const hasPassword = this.configManager.hasDeveloperPassword()
    const isAuthenticated = userPayload?.type === 'developer'

    return {
      hasPassword,
      isAuthenticated
    }
  }

  /**
   * 设置开发者密码
   */
  async setPassword(password: string): Promise<string> {
    // 验证密码
    if (!password || typeof password !== 'string') {
      throw new Error('密码不能为空')
    }

    if (password.length < 6) {
      throw new Error('密码长度至少需要6位')
    }

    // 检查是否已经设置过密码
    if (this.configManager.hasDeveloperPassword()) {
      throw new Error('开发者密码已设置，请使用登录接口')
    }

    // 生成盐值和哈希
    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(password, salt)

    // 保存到配置
    await this.configManager.setDeveloperPassword(passwordHash, salt)

    // 生成开发者token
    return this.generateToken()
  }

  /**
   * 开发者登录
   */
  async login(password: string): Promise<string> {
    // 验证密码
    if (!password || typeof password !== 'string') {
      throw new Error('密码不能为空')
    }

    // 检查是否设置过密码
    if (!this.configManager.hasDeveloperPassword()) {
      throw new Error('请先设置开发者密码')
    }

    const developerConfig = this.configManager.getDeveloperConfig()
    if (!developerConfig) {
      throw new Error('开发者配置不存在')
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, developerConfig.passwordHash)
    if (!isValid) {
      throw new Error('开发者密码错误')
    }

    // 生成开发者token
    return this.generateToken()
  }

  /**
   * 执行正式环境封装
   */
  async executeProductionPackage(): Promise<ProductionPackageResult> {
    logger.info('开始执行正式环境封装')

    // 检查当前环境，确定正确的data目录路径
    const currentDir = process.cwd()
    let dataDir: string

    // 如果当前在server目录下（开发环境）
    if (currentDir.endsWith('server')) {
      dataDir = path.join(currentDir, 'data')
    } else {
      // 如果在项目根目录（正式环境）
      dataDir = path.join(currentDir, 'server', 'data')
    }

    logger.info(`数据目录路径: ${dataDir}`)

    // 检查目录是否存在
    try {
      await fs.access(dataDir)
    } catch (error) {
      throw new Error(`数据目录不存在: ${dataDir}`)
    }

    // 读取目录内容
    const items = await fs.readdir(dataDir, { withFileTypes: true })

    let deletedFiles = 0
    let preservedDirs = 0
    let preservedFiles = 0

    for (const item of items) {
      const itemPath = path.join(dataDir, item.name)

      if (item.isDirectory()) {
        // 保留目录结构
        preservedDirs++
        logger.info(`保留目录: ${item.name}`)
      } else if (item.isFile() && item.name !== 'instances.json') {
        // 删除文件（除了instances.json）
        try {
          await fs.unlink(itemPath)
          deletedFiles++
          logger.info(`删除文件: ${item.name}`)
        } catch (error) {
          logger.error(`删除文件失败 ${item.name}:`, error)
        }
      } else if (item.name === 'instances.json') {
        preservedFiles++
        logger.info(`保留文件: ${item.name}`)
      }
    }
    
    const result: ProductionPackageResult = {
      deletedFiles,
      preservedDirs,
      preservedFiles,
      dataDir
    }

    logger.info(`正式环境封装完成: 删除了${deletedFiles}个文件，保留了${preservedDirs}个目录，保留了${preservedFiles}个文件`)

    // 延迟退出程序
    setTimeout(() => {
      logger.info('正式环境封装完成，程序退出')
      process.exit(0)
    }, 1000)

    return result
  }

  /**
   * 获取installgame.json文件路径
   */
  private getInstallGameJsonPath(): string {
    const baseDir = process.cwd()
    const possiblePaths = [
      path.join(baseDir, 'data', 'games', 'installgame.json'),           // 打包后的路径
      path.join(baseDir, 'server', 'data', 'games', 'installgame.json'), // 开发环境路径
    ]

    for (const possiblePath of possiblePaths) {
      try {
        fsSync.accessSync(possiblePath, fsSync.constants.F_OK)
        return possiblePath
      } catch {
        // 继续尝试下一个路径
      }
    }

    // 如果都不存在，返回默认路径（会在后续操作中创建）
    return possiblePaths[0]
  }

  /**
   * 获取游戏配置列表
   */
  async getGameConfigs(): Promise<GameConfigData> {
    try {
      const filePath = this.getInstallGameJsonPath()
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，返回空对象
        return {}
      }
      throw error
    }
  }

  /**
   * 保存游戏配置到文件
   */
  private async saveGameConfigs(configs: GameConfigData): Promise<void> {
    const filePath = this.getInstallGameJsonPath()

    // 确保目录存在
    const dir = path.dirname(filePath)
    try {
      await fs.access(dir)
    } catch {
      await fs.mkdir(dir, { recursive: true })
    }

    // 保存文件，格式化JSON
    await fs.writeFile(filePath, JSON.stringify(configs, null, 2), 'utf-8')
    logger.info(`游戏配置已保存到: ${filePath}`)
  }

  /**
   * 创建游戏配置
   */
  async createGameConfig(config: GameConfig): Promise<GameConfig> {
    const configs = await this.getGameConfigs()

    // 检查是否已存在
    if (configs[config.key]) {
      throw new Error(`游戏配置 "${config.key}" 已存在`)
    }

    // 验证必填字段
    if (!config.key || !config.game_nameCN || !config.appid) {
      throw new Error('游戏标识、中文名和App ID为必填字段')
    }

    // 添加新配置
    const { key, ...configData } = config
    configs[key] = configData

    await this.saveGameConfigs(configs)

    logger.info(`创建游戏配置: ${config.key}`)
    return config
  }

  /**
   * 更新游戏配置
   */
  async updateGameConfig(key: string, configData: Omit<GameConfig, 'key'>): Promise<GameConfig> {
    const configs = await this.getGameConfigs()

    // 检查是否存在
    if (!configs[key]) {
      throw new Error(`游戏配置 "${key}" 不存在`)
    }

    // 验证必填字段
    if (!configData.game_nameCN || !configData.appid) {
      throw new Error('中文名和App ID为必填字段')
    }

    // 更新配置
    configs[key] = configData

    await this.saveGameConfigs(configs)

    logger.info(`更新游戏配置: ${key}`)
    return { key, ...configData }
  }

  /**
   * 删除游戏配置
   */
  async deleteGameConfig(key: string): Promise<void> {
    const configs = await this.getGameConfigs()

    // 检查是否存在
    if (!configs[key]) {
      throw new Error(`游戏配置 "${key}" 不存在`)
    }

    // 删除配置
    delete configs[key]

    await this.saveGameConfigs(configs)

    logger.info(`删除游戏配置: ${key}`)
  }

  /**
   * 生成开发者JWT令牌
   */
  private generateToken(): string {
    const jwtSecret = this.configManager.getJWTSecret()
    const payload: DeveloperJWTPayload = {
      type: 'developer',
      timestamp: Date.now()
    }

    return jwt.sign(payload, jwtSecret, { expiresIn: '24h' })
  }
}
