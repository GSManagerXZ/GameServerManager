import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'fs/promises'
import path from 'path'
import winston from 'winston'
import { ConfigManager } from '../config/ConfigManager.js'
import { CaptchaManager } from './CaptchaManager.js'

export interface User {
  id: string
  username: string
  password: string
  role: 'admin' | 'user'
  createdAt: string
  lastLogin?: string
  loginAttempts: number
  lockedUntil?: string
}

export interface LoginAttempt {
  username: string
  ip: string
  timestamp: string
  success: boolean
}

export interface AuthResult {
  success: boolean
  token?: string
  user?: Omit<User, 'password'>
  message: string
  requireCaptcha?: boolean
}

export class AuthManager {
  private users: Map<string, User> = new Map()
  private loginAttempts: LoginAttempt[] = []
  private usersFilePath: string
  private attemptsFilePath: string
  private logger: winston.Logger
  private configManager: ConfigManager
  private captchaManager: CaptchaManager
  private failedAttempts: Map<string, number> = new Map() // 跟踪每个用户名的失败次数

  constructor(configManager: ConfigManager, logger: winston.Logger) {
    this.configManager = configManager
    this.logger = logger
    this.usersFilePath = path.join(process.cwd(), 'data', 'users.json')
    this.attemptsFilePath = path.join(process.cwd(), 'data', 'login_attempts.json')
    this.captchaManager = new CaptchaManager(logger)
  }

  async initialize(): Promise<void> {
    try {
      // 确保data目录存在
      const dataDir = path.dirname(this.usersFilePath)
      await fs.mkdir(dataDir, { recursive: true })

      // 初始化验证码管理器
      await this.captchaManager.initialize()

      // 加载用户数据
      await this.loadUsers()
      await this.loadLoginAttempts()

      // 不再自动创建默认管理员账户，改为在前端检测到无用户时提示注册

      this.logger.info('认证管理器初始化完成')
    } catch (error) {
      this.logger.error('认证管理器初始化失败:', error)
      throw error
    }
  }

  private async loadUsers(): Promise<void> {
    try {
      const usersData = await fs.readFile(this.usersFilePath, 'utf-8')
      const users = JSON.parse(usersData) as User[]
      
      this.users.clear()
      users.forEach(user => {
        this.users.set(user.username, user)
      })
      
      this.logger.info(`加载了 ${users.length} 个用户`)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.info('用户文件不存在，将创建新文件')
      } else {
        this.logger.error('加载用户文件失败:', error)
        throw error
      }
    }
  }

  private async loadLoginAttempts(): Promise<void> {
    try {
      const attemptsData = await fs.readFile(this.attemptsFilePath, 'utf-8')
      this.loginAttempts = JSON.parse(attemptsData) as LoginAttempt[]
      
      // 清理过期的登录尝试记录（保留最近24小时）
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      this.loginAttempts = this.loginAttempts.filter(
        attempt => new Date(attempt.timestamp) > oneDayAgo
      )
      
      this.logger.info(`加载了 ${this.loginAttempts.length} 条登录尝试记录`)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.info('登录尝试文件不存在，将创建新文件')
        this.loginAttempts = []
      } else {
        this.logger.error('加载登录尝试文件失败:', error)
        throw error
      }
    }
  }

  private async saveUsers(): Promise<void> {
    try {
      const users = Array.from(this.users.values())
      await fs.writeFile(this.usersFilePath, JSON.stringify(users, null, 2), 'utf-8')
    } catch (error) {
      this.logger.error('保存用户文件失败:', error)
      throw error
    }
  }

  private async saveLoginAttempts(): Promise<void> {
    try {
      await fs.writeFile(this.attemptsFilePath, JSON.stringify(this.loginAttempts, null, 2), 'utf-8')
    } catch (error) {
      this.logger.error('保存登录尝试文件失败:', error)
      throw error
    }
  }

  private async createDefaultAdmin(): Promise<void> {
    const defaultPassword = 'admin123'
    const hashedPassword = await bcrypt.hash(defaultPassword, 12)
    
    const adminUser: User = {
      id: 'admin',
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date().toISOString(),
      loginAttempts: 0
    }

    this.users.set('admin', adminUser)
    await this.saveUsers()
    
    this.logger.warn(`创建了默认管理员账户: admin / ${defaultPassword}`)
    this.logger.warn('请立即登录并修改默认密码！')
  }

  async login(username: string, password: string, ip: string, captchaId?: string, captchaCode?: string): Promise<AuthResult> {
    const user = this.users.get(username)
    
    // 记录登录尝试
    const attempt: LoginAttempt = {
      username,
      ip,
      timestamp: new Date().toISOString(),
      success: false
    }

    // 检查是否需要验证码
    const failedCount = this.failedAttempts.get(username) || 0
    const requireCaptcha = failedCount >= 1

    if (requireCaptcha) {
      if (!captchaId || !captchaCode) {
        return {
          success: false,
          message: '请输入验证码',
          requireCaptcha: true
        }
      }

      // 验证验证码
      if (!this.captchaManager.verifyCaptcha(captchaId, captchaCode)) {
        this.loginAttempts.push(attempt)
        await this.saveLoginAttempts()
        return {
          success: false,
          message: '验证码错误或已过期',
          requireCaptcha: true
        }
      }
    }

    if (!user) {
      // 增加失败次数
      this.failedAttempts.set(username, failedCount + 1)
      
      this.loginAttempts.push(attempt)
      await this.saveLoginAttempts()
      return {
        success: false,
        message: '用户名或密码错误',
        requireCaptcha: this.failedAttempts.get(username)! >= 1
      }
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password)
    
    if (!isValidPassword) {
      // 增加失败次数
      this.failedAttempts.set(username, failedCount + 1)
      
      this.loginAttempts.push(attempt)
      await this.saveLoginAttempts()
      
      return {
        success: false,
        message: '用户名或密码错误',
        requireCaptcha: this.failedAttempts.get(username)! >= 1
      }
    }

    // 登录成功，清除失败次数
    this.failedAttempts.delete(username)
    
    // 更新最后登录时间
    user.lastLogin = new Date().toISOString()
    await this.saveUsers()

    // 记录成功的登录尝试
    attempt.success = true
    this.loginAttempts.push(attempt)
    await this.saveLoginAttempts()

    // 生成JWT token
    const jwtConfig = this.configManager.getJWTConfig()
    const securityConfig = this.configManager.getSecurityConfig()
    
    // 根据安全配置决定过期时间
    let expiresIn: string | number | undefined
    if (securityConfig.tokenExpireHours !== null) {
      expiresIn = `${securityConfig.tokenExpireHours}h`
    } else {
      // 永不到期的情况，设置为很长的过期时间
      expiresIn = '876000h' // 100年
    }
    
    const signOptions: jwt.SignOptions = {}
    if (expiresIn) {
      signOptions.expiresIn = expiresIn as any
    }
    
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role
      },
      jwtConfig.secret,
      signOptions
    )

    this.logger.info(`用户 ${username} 登录成功`)

    return {
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        loginAttempts: user.loginAttempts
      },
      message: '登录成功'
    }
  }

  // isAccountLocked方法已移除

  verifyToken(token: string): any {
    try {
      const jwtSecret = this.configManager.getJWTSecret()
      return jwt.verify(token, jwtSecret)
    } catch (error) {
      return null
    }
  }

  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const user = this.users.get(username)
    
    if (!user) {
      return {
        success: false,
        message: '用户不存在'
      }
    }

    // 验证旧密码
    const isValidOldPassword = await bcrypt.compare(oldPassword, user.password)
    if (!isValidOldPassword) {
      return {
        success: false,
        message: '原密码错误'
      }
    }

    // 加密新密码
    const hashedNewPassword = await bcrypt.hash(newPassword, 12)
    user.password = hashedNewPassword
    
    await this.saveUsers()
    
    this.logger.info(`用户 ${username} 修改密码成功`)
    
    return {
      success: true,
      message: '密码修改成功'
    }
  }

  async changeUsername(currentUsername: string, newUsername: string): Promise<{ success: boolean; message: string }> {
    const user = this.users.get(currentUsername)
    
    if (!user) {
      return {
        success: false,
        message: '用户不存在'
      }
    }

    // 检查新用户名是否已存在
    if (this.users.has(newUsername)) {
      return {
        success: false,
        message: '用户名已存在'
      }
    }

    // 验证新用户名格式
    if (!/^[a-zA-Z0-9]{3,30}$/.test(newUsername)) {
      return {
        success: false,
        message: '用户名只能包含字母和数字，长度为3-30个字符'
      }
    }

    // 更新用户名
    user.username = newUsername
    
    // 删除旧的用户名映射，添加新的
    this.users.delete(currentUsername)
    this.users.set(newUsername, user)
    
    await this.saveUsers()
    
    this.logger.info(`用户 ${currentUsername} 修改用户名为 ${newUsername} 成功`)
    
    return {
      success: true,
      message: '用户名修改成功'
    }
  }

  getUsers(): Omit<User, 'password'>[] {
    return Array.from(this.users.values()).map(user => ({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      loginAttempts: user.loginAttempts,
      lockedUntil: user.lockedUntil
    }))
  }

  getLoginAttempts(limit: number = 100): LoginAttempt[] {
    return this.loginAttempts
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)
  }

  generateCaptcha() {
    return this.captchaManager.generateCaptcha()
  }

  checkIfRequireCaptcha(username: string): boolean {
    const failedCount = this.failedAttempts.get(username) || 0
    return failedCount >= 1
  }

  // 检查是否有用户存在
  hasUsers(): boolean {
    return this.users.size > 0
  }

  // 注册新用户
  async register(username: string, password: string, role: 'admin' | 'user' = 'admin'): Promise<{ success: boolean; message: string; user?: Omit<User, 'password'> }> {
    // 验证用户名格式
    if (!/^[a-zA-Z0-9]{3,30}$/.test(username)) {
      return {
        success: false,
        message: '用户名只能包含字母和数字，长度为3-30个字符'
      }
    }

    // 验证密码长度
    if (password.length < 6) {
      return {
        success: false,
        message: '密码长度至少为6个字符'
      }
    }

    // 检查用户名是否已存在
    if (this.users.has(username)) {
      return {
        success: false,
        message: '用户名已存在'
      }
    }

    try {
      // 加密密码
      const hashedPassword = await bcrypt.hash(password, 12)
      
      // 创建新用户
      const newUser: User = {
        id: username,
        username,
        password: hashedPassword,
        role,
        createdAt: new Date().toISOString(),
        loginAttempts: 0
      }

      this.users.set(username, newUser)
      await this.saveUsers()
      
      this.logger.info(`新用户注册成功: ${username} (${role})`)
      
      return {
        success: true,
        message: '注册成功',
        user: {
          id: newUser.id,
          username: newUser.username,
          role: newUser.role,
          createdAt: newUser.createdAt,
          loginAttempts: newUser.loginAttempts
        }
      }
    } catch (error) {
      this.logger.error('用户注册失败:', error)
      return {
        success: false,
        message: '注册失败，请稍后重试'
      }
    }
  }
}