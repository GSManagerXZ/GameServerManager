import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'fs/promises'
import path from 'path'
import type { ConfigManager } from '../../config/ConfigManager.js'
import type { 
  DeveloperAuth, 
  DeveloperJWTPayload, 
  ProductionPackageResult 
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
