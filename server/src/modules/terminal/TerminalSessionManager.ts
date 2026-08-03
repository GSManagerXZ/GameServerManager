import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import winston from 'winston'

// 终端会话持久化数据接口
export interface PersistedTerminalSession {
  id: string
  name: string
  workingDirectory: string
  createdAt: string
  lastActivity: string
  isActive: boolean
}

// 终端会话配置文件结构
interface TerminalSessionsConfig {
  sessions: PersistedTerminalSession[]
  lastUpdated: string
}

/**
 * 终端会话持久化管理器
 * 负责将终端会话信息保存到本地配置文件
 */
export class TerminalSessionManager {
  private configDir: string
  private configPath: string
  private logger: winston.Logger
  private config: TerminalSessionsConfig
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(logger: winston.Logger) {
    this.logger = logger
    
    // 设置配置文件目录（项目data目录）
    this.configDir = path.join(process.cwd(), 'data')
    this.configPath = path.join(this.configDir, 'terminal-sessions.json')
    
    // 初始化默认配置
    this.config = {
      sessions: [],
      lastUpdated: new Date().toISOString()
    }
  }

  /**
   * 初始化会话管理器
   */
  async initialize(): Promise<void> {
    try {
      // 确保配置目录存在
      await this.ensureConfigDirectory()
      
      // 加载现有配置
      await this.loadConfig()
      
      this.logger.info('终端会话管理器初始化完成')
    } catch (error) {
      this.logger.error('终端会话管理器初始化失败:', error)
      throw error
    }
  }

  /**
   * 确保配置目录存在
   */
  private async ensureConfigDirectory(): Promise<void> {
    try {
      await fs.access(this.configDir)
    } catch {
      // 目录不存在，创建它
      await fs.mkdir(this.configDir, { recursive: true })
      this.logger.info(`创建配置目录: ${this.configDir}`)
    }
  }

  /**
   * 加载配置文件
   */
  private async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      this.config = JSON.parse(data)
      this.logger.info('终端会话配置加载成功')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，使用默认配置
        this.logger.info('终端会话配置文件不存在，使用默认配置')
        await this.saveConfig()
      } else {
        this.logger.error('加载终端会话配置失败:', error)
        throw error
      }
    }
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  /**
   * 使用同目录临时文件和原子 rename 保存完整配置。
   */
  private async saveConfig(): Promise<void> {
    this.config.lastUpdated = new Date().toISOString()
    const tempPath = path.join(
      this.configDir,
      `.${path.basename(this.configPath)}.${process.pid}.${randomUUID()}.tmp`
    )
    try {
      await fs.writeFile(tempPath, JSON.stringify(this.config, null, 2), 'utf-8')
      await fs.rename(tempPath, this.configPath)
      this.logger.debug('终端会话配置保存成功')
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
      this.logger.error('保存终端会话配置失败:', error)
      throw error
    }
  }

  /**
   * 保存终端会话
   */
  async saveSession(sessionData: {
    id: string
    name: string
    workingDirectory: string
    createdAt: Date
    lastActivity: Date
    isActive: boolean
  }): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const persistedSession: PersistedTerminalSession = {
          id: sessionData.id,
          name: sessionData.name,
          workingDirectory: sessionData.workingDirectory,
          createdAt: sessionData.createdAt.toISOString(),
          lastActivity: sessionData.lastActivity.toISOString(),
          isActive: sessionData.isActive
        }

        const existingIndex = this.config.sessions.findIndex(
          session => session.id === sessionData.id
        )
        if (existingIndex >= 0) {
          this.config.sessions[existingIndex] = persistedSession
          this.logger.debug(`更新终端会话: ${sessionData.id} - ${sessionData.name}`)
        } else {
          this.config.sessions.push(persistedSession)
          this.logger.debug(`保存新终端会话: ${sessionData.id} - ${sessionData.name}`)
        }

        await this.saveConfig()
      })
    } catch (error) {
      this.logger.error('保存终端会话失败:', error)
      throw error
    }
  }

  /**
   * 更新会话名称
   */
  async updateSessionName(sessionId: string, newName: string): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const session = this.config.sessions.find(s => s.id === sessionId)
        if (session) {
          session.name = newName
          session.lastActivity = new Date().toISOString()
          await this.saveConfig()
          this.logger.info(`更新终端会话名称: ${sessionId} -> ${newName}`)
        } else {
          this.logger.warn(`尝试更新不存在的会话名称: ${sessionId}`)
        }
      })
    } catch (error) {
      this.logger.error('更新会话名称失败:', error)
      throw error
    }
  }

  /**
   * 删除会话
   */
  async removeSession(sessionId: string): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const initialLength = this.config.sessions.length
        this.config.sessions = this.config.sessions.filter(s => s.id !== sessionId)
        if (this.config.sessions.length < initialLength) {
          await this.saveConfig()
          this.logger.info(`删除终端会话: ${sessionId}`)
        } else {
          this.logger.debug(`尝试删除不存在的会话: ${sessionId}`)
        }
      })
    } catch (error) {
      this.logger.error('删除会话失败:', error)
      throw error
    }
  }

  /**
   * 获取所有保存的会话
   */
  getSavedSessions(): PersistedTerminalSession[] {
    return [...this.config.sessions]
  }

  /**
   * 获取特定会话
   */
  getSession(sessionId: string): PersistedTerminalSession | undefined {
    return this.config.sessions.find(s => s.id === sessionId)
  }

  /**
   * 清理过期会话（超过7天未活动的会话）
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const now = new Date()
        const expirationThreshold = 7 * 24 * 60 * 60 * 1000 // 7天
        const initialLength = this.config.sessions.length
        this.config.sessions = this.config.sessions.filter(session => {
          const lastActivity = new Date(session.lastActivity)
          const timeDiff = now.getTime() - lastActivity.getTime()
          return timeDiff < expirationThreshold
        })

        const removedCount = initialLength - this.config.sessions.length
        if (removedCount > 0) {
          await this.saveConfig()
          this.logger.info(`清理了 ${removedCount} 个过期的终端会话`)
        }
      })
    } catch (error) {
      this.logger.error('清理过期会话失败:', error)
    }
  }

  /**
   * 设置会话活动状态
   */
  async setSessionActive(sessionId: string, isActive: boolean): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const session = this.config.sessions.find(s => s.id === sessionId)
        if (session) {
          session.isActive = isActive
          session.lastActivity = new Date().toISOString()
          await this.saveConfig()
          this.logger.debug(`设置会话活动状态: ${sessionId} -> ${isActive}`)
        }
      })
    } catch (error) {
      this.logger.error('设置会话活动状态失败:', error)
      throw error
    }
  }

  /**
   * 获取配置文件路径（用于调试）
   */
  getConfigPath(): string {
    return this.configPath
  }
}