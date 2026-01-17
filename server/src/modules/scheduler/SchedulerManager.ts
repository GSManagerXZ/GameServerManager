import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import winston from 'winston'
import cron from 'node-cron'
import cronParser from 'cron-parser'
import { GameManager } from '../game/GameManager.js'
import { InstanceManager } from '../instance/InstanceManager.js'
import { TerminalManager } from '../terminal/TerminalManager.js'

// ES模块中获取__dirname的替代方案
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface ScheduledTask {
  id: string
  name: string
  type: 'power' | 'command' | 'backup' | 'system'
  instanceId?: string
  instanceName?: string
  action?: 'start' | 'stop' | 'restart'
  command?: string
  // 备份相关
  backupSourcePath?: string
  backupName?: string
  maxKeep?: number
  checkInstanceRunning?: boolean
  // 系统任务相关
  systemAction?: 'steam_update'
  schedule: string
  enabled: boolean
  nextRun?: string
  lastRun?: string
  createdAt: string
  updatedAt: string
  // 系统任务标识，不允许删除和编辑
  isSystemTask?: boolean
}

interface ScheduledTaskWithJob extends ScheduledTask {
  job?: cron.ScheduledTask
}

export class SchedulerManager extends EventEmitter {
  private tasks: Map<string, ScheduledTaskWithJob> = new Map()
  private configPath: string
  private logger: winston.Logger
  private gameManager: GameManager | null = null
  private instanceManager: InstanceManager | null = null
  private terminalManager: TerminalManager | null = null

  constructor(dataDir: string, logger: winston.Logger) {
    super()
    this.configPath = path.join(dataDir, 'scheduled-tasks.json')
    this.logger = logger
    this.loadTasks().then(() => {
      this.initializeSystemTasks()
    })
  }

  setGameManager(gameManager: GameManager) {
    this.gameManager = gameManager
  }

  setInstanceManager(instanceManager: InstanceManager) {
    this.instanceManager = instanceManager
  }

  setTerminalManager(terminalManager: TerminalManager) {
    this.terminalManager = terminalManager
  }

  private async initializeSystemTasks(): Promise<void> {
    try {
      // 检查是否已存在Steam更新任务
      const existingSteamTask = Array.from(this.tasks.values()).find(
        task => task.isSystemTask && task.systemAction === 'steam_update'
      )

      if (!existingSteamTask) {
        // 创建Steam更新任务
        const steamUpdateTask: ScheduledTask = {
          id: 'system-steam-update',
          name: '更新Steam游戏部署清单',
          type: 'system',
          systemAction: 'steam_update',
          schedule: '0 0 * * *', // 每天凌晨00:00
          enabled: true,
          isSystemTask: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          nextRun: this.getNextRunTime('0 0 * * *')
        }

        this.tasks.set(steamUpdateTask.id, steamUpdateTask)
        
        if (steamUpdateTask.enabled) {
          this.scheduleTask(steamUpdateTask.id)
        }
        
        await this.saveTasks()
        this.logger.info('已创建系统任务: 更新Steam游戏部署清单')
      } else {
        this.logger.info('Steam更新任务已存在，跳过创建')
      }
    } catch (error) {
      this.logger.error('初始化系统任务失败:', error)
    }
  }

  private async loadTasks(): Promise<void> {
    try {
      // 确保数据目录存在
      await fs.mkdir(path.dirname(this.configPath), { recursive: true })
      
      try {
        const data = await fs.readFile(this.configPath, 'utf-8')
        const tasks: ScheduledTask[] = JSON.parse(data)
        
        for (const task of tasks) {
          // 确保任务有正确的nextRun时间
          if (!task.nextRun || new Date(task.nextRun) <= new Date()) {
            task.nextRun = this.getNextRunTime(task.schedule)
          }
          
          this.tasks.set(task.id, task)
          if (task.enabled) {
            this.scheduleTask(task.id)
          }
        }
        
        this.logger.info(`加载了 ${tasks.length} 个定时任务`)
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          this.logger.error('加载定时任务失败:', error)
        }
      }
    } catch (error) {
      this.logger.error('创建定时任务数据目录失败:', error)
    }
  }

  private async saveTasks(): Promise<void> {
    try {
      const tasks = Array.from(this.tasks.values()).map(task => {
        const { job, ...taskData } = task
        return taskData
      })
      await fs.writeFile(this.configPath, JSON.stringify(tasks, null, 2))
    } catch (error) {
      this.logger.error('保存定时任务失败:', error)
      throw error
    }
  }

  private scheduleTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task || !task.enabled) {
      return
    }

    try {
      // 验证cron表达式
      if (!cron.validate(task.schedule)) {
        this.logger.error(`无效的cron表达式: ${task.schedule}`)
        return
      }

      // 如果已经有任务在运行，先停止
      if (task.job) {
        task.job.stop()
      }

      // 创建新的定时任务
      task.job = cron.schedule(task.schedule, async () => {
        this.logger.info(`[Scheduler] Cron callback triggered for task: ${task.name} (${taskId})`);
        await this.executeTask(taskId)
      }, {
        scheduled: false
      })

      // 设置下次执行时间
      task.nextRun = this.getNextRunTime(task.schedule)
      
      task.job.start()
      
      this.logger.info(`定时任务已调度: ${task.name} (${task.schedule}), 下次执行: ${task.nextRun}`)
    } catch (error) {
      this.logger.error(`调度定时任务失败: ${task.name}`, error)
    }
  }

  private unscheduleTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (task && task.job) {
      task.job.stop()
      delete task.job
      this.logger.info(`定时任务已停止: ${task.name}`)
    }
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task || !task.enabled) {
      return
    }

    await this.executeTaskDirectly(taskId)
  }

  private async executeTaskDirectly(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) {
      return
    }

    this.logger.info(`执行定时任务: ${task.name} (实例: ${task.instanceName || task.instanceId || '未知'})`)
    
    try {
      if (task.type === 'power' && task.instanceId && task.action) {
        await this.executePowerAction(task.instanceId, task.action)
      } else if (task.type === 'command' && task.instanceId && task.command) {
        await this.executeCommand(task.instanceId, task.command)
      } else if (task.type === 'backup') {
        await this.executeBackup(task)
      } else if (task.type === 'system' && task.systemAction) {
        await this.executeSystemAction(task.systemAction)
      }

      // 更新最后执行时间和下次执行时间
      task.lastRun = new Date().toISOString()
      task.nextRun = this.getNextRunTime(task.schedule)
      task.updatedAt = new Date().toISOString()
      
      await this.saveTasks()
      
      this.emit('taskExecuted', {
        taskId,
        taskName: task.name,
        success: true
      })
      
      this.logger.info(`定时任务执行成功: ${task.name} (实例: ${task.instanceName || task.instanceId || '未知'})`)
    } catch (error) {
      this.logger.error(`定时任务执行失败: ${task.name} (实例: ${task.instanceName || task.instanceId || '未知'})`, error)
      
      this.emit('taskExecuted', {
        taskId,
        taskName: task.name,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async executePowerAction(instanceId: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    if (!this.instanceManager) {
      throw new Error('InstanceManager未设置')
    }

    switch (action) {
      case 'start':
        await this.instanceManager.startInstance(instanceId)
        break
      case 'stop':
        await this.instanceManager.stopInstance(instanceId)
        break
      case 'restart':
        await this.instanceManager.restartInstance(instanceId)
        break
      default:
        throw new Error(`未知的电源操作: ${action}`)
    }
  }

  private async executeCommand(instanceId: string, command: string): Promise<void> {
    if (!this.instanceManager) {
      throw new Error('InstanceManager未设置')
    }

    if (!this.terminalManager) {
      throw new Error('TerminalManager未设置')
    }

    // 获取实例信息
    const instance = this.instanceManager.getInstance(instanceId)
    if (!instance) {
      throw new Error('实例不存在')
    }

    if (instance.status !== 'running' || !instance.terminalSessionId) {
      throw new Error('实例未在运行或终端会话不存在')
    }

    // 通过TerminalManager发送命令到实例的终端会话
    try {
      // 创建一个模拟的socket对象，因为handleInput需要socket参数
      const mockSocket = {
        emit: () => {},
        id: 'scheduler-mock'
      } as any

      // 发送命令到终端会话，确保命令以换行符结尾，并添加额外的回车确保执行
      const commandWithNewline = command.endsWith('\n') ? command : command + '\n'
      
      this.terminalManager.handleInput(mockSocket, {
        sessionId: instance.terminalSessionId,
        data: commandWithNewline
      })
      
      // 发送额外的回车符确保命令执行
      setTimeout(() => {
        this.terminalManager.handleInput(mockSocket, {
          sessionId: instance.terminalSessionId,
          data: '\r'
        })
      }, 100) // 延迟100ms确保命令先发送完成

      this.logger.info(`已向实例 ${instanceId} 的终端会话发送命令: ${command}`)
    } catch (error) {
      this.logger.error(`向终端会话发送命令失败: ${instanceId}`, error)
      throw new Error(`发送命令失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async executeBackup(task: ScheduledTask): Promise<void> {
    // 校验参数
    if (!task.backupSourcePath || !task.backupName) {
      throw new Error('备份任务参数不完整')
    }

    // 若需要检查实例运行状态
    if (task.checkInstanceRunning && task.instanceId) {
      if (!this.instanceManager) {
        throw new Error('InstanceManager未设置')
      }
      const instance = this.instanceManager.getInstance(task.instanceId)
      if (!instance) throw new Error('关联实例不存在')
      if (instance.status !== 'running') {
        // 不抛错，记录跳过
        this.logger.info(`备份任务跳过（实例未运行）: ${task.name}`)
        return
      }
    }

    // 动态导入 BackupManager，避免循环依赖
    const { backupManager } = await import('../backup/BackupManager.js')
    await backupManager.createBackup(task.backupName!, task.backupSourcePath!, Number(task.maxKeep || 0))
  }

  private async executeSystemAction(systemAction: 'steam_update'): Promise<void> {
    if (systemAction === 'steam_update') {
      await this.updateSteamGameList()
    } else {
      throw new Error(`未知的系统操作: ${systemAction}`)
    }
  }

  private async updateSteamGameList(): Promise<void> {
    try {
      const axios = (await import('axios')).default
      const remoteUrl = 'http://api.gsm.xiaozhuhouses.asia:8082/disk1/GSM3/installgame.json'
      
      // 使用多个路径尝试
      const baseDir = process.cwd()
      const possiblePaths = [
        path.join(baseDir, 'data', 'games', 'installgame.json'),           // 打包后的路径
        path.join(baseDir, 'server', 'data', 'games', 'installgame.json'), // 开发环境路径
        path.join(__dirname, '../data/games/installgame.json')             // 相对路径
      ]
      
      let gamesFilePath = null
      for (const filePath of possiblePaths) {
        try {
          await fs.access(filePath)
          gamesFilePath = filePath
          break
        } catch {
          // 文件不存在，继续尝试下一个路径
        }
      }
      
      // 如果找不到现有文件，使用第一个路径作为目标路径
      if (!gamesFilePath) {
        gamesFilePath = possiblePaths[0]
      }
      
      this.logger.info('开始更新Steam游戏部署清单', { remoteUrl, localPath: gamesFilePath })
      
      // 确保目录存在
      const gamesDir = path.dirname(gamesFilePath)
      try {
        await fs.access(gamesDir)
      } catch {
        await fs.mkdir(gamesDir, { recursive: true })
        this.logger.info('创建games目录:', gamesDir)
      }
      
      // 不备份现有文件，直接覆盖
      
      // 从远程URL下载最新的游戏清单
      const response = await axios.get(remoteUrl, {
        timeout: 30000, // 30秒超时
        headers: {
          'User-Agent': 'GSManager3/1.0'
        }
      })
      
      // 验证响应数据格式
      if (typeof response.data !== 'object' || response.data === null) {
        throw new Error('远程数据格式无效：不是有效的JSON对象')
      }
      
      // 简单验证数据结构
      const gameKeys = Object.keys(response.data)
      if (gameKeys.length === 0) {
        throw new Error('远程数据为空')
      }
      
      // 检查第一个游戏是否有必要的字段
      const firstGame = response.data[gameKeys[0]]
      if (!firstGame || typeof firstGame !== 'object' || !firstGame.game_nameCN || !firstGame.appid) {
        throw new Error('远程数据格式无效：缺少必要的游戏信息字段')
      }
      
      // 将数据写入本地文件
      await fs.writeFile(gamesFilePath, JSON.stringify(response.data, null, 2), 'utf-8')
      
      this.logger.info('Steam游戏部署清单更新成功', {
        gameCount: gameKeys.length,
        fileSize: JSON.stringify(response.data).length
      })
      
    } catch (error: any) {
      this.logger.error('更新Steam游戏部署清单失败:', error)
      throw new Error(`更新Steam游戏部署清单失败: ${error.message}`)
    }
  }

  private getNextRunTime(schedule: string): string {
    try {
      // 使用cron-parser库精确计算下次执行时间
      const interval = cronParser.parseExpression(schedule, {
        tz: 'Asia/Shanghai'
      })
      const nextRun = interval.next().toDate()
      return nextRun.toISOString()
    } catch (error) {
      this.logger.error(`计算下次执行时间失败: ${schedule}`, error)
      return new Date().toISOString()
    }
  }

  // 公共API方法
  async createTask(taskData: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScheduledTask> {
    const task: ScheduledTask = {
      ...taskData,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextRun: this.getNextRunTime(taskData.schedule)
    }

    // 验证cron表达式
    if (!cron.validate(task.schedule)) {
      throw new Error('无效的cron表达式')
    }

    this.tasks.set(task.id, task)
    
    if (task.enabled) {
      this.scheduleTask(task.id)
    }
    
    await this.saveTasks()
    
    this.logger.info(`创建定时任务: ${task.name}`)
    
    // 返回时排除job属性以避免循环引用
    const { job, ...resultTask } = this.tasks.get(task.id)!
    return resultTask
  }

  async updateTask(taskId: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('定时任务不存在')
    }

    // 系统任务不允许编辑
    if (task.isSystemTask) {
      throw new Error('系统任务不允许编辑')
    }

    // 如果更新了schedule，验证新的cron表达式
    if (updates.schedule && !cron.validate(updates.schedule)) {
      throw new Error('无效的cron表达式')
    }

    // 停止当前任务
    this.unscheduleTask(taskId)

    // 更新任务数据
    const updatedTask = {
      ...task,
      ...updates,
      updatedAt: new Date().toISOString(),
      // 如果schedule被更新，重新计算nextRun时间
      nextRun: updates.schedule ? this.getNextRunTime(updates.schedule) : task.nextRun
    }
    
    this.tasks.set(taskId, updatedTask)
    
    // 如果任务启用，重新调度
    if (updatedTask.enabled) {
      this.scheduleTask(taskId)
    }
    
    await this.saveTasks()
    
    this.logger.info(`更新定时任务: ${updatedTask.name}`)
    
    // 返回时排除job属性以避免循环引用
    const { job, ...resultTask } = updatedTask
    return resultTask
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('定时任务不存在')
    }

    // 系统任务不允许删除
    if (task.isSystemTask) {
      throw new Error('系统任务不允许删除')
    }

    // 停止任务
    this.unscheduleTask(taskId)
    
    // 删除任务
    this.tasks.delete(taskId)
    
    await this.saveTasks()
    
    this.logger.info(`删除定时任务: ${task.name}`)
  }

  async toggleTask(taskId: string, enabled: boolean): Promise<ScheduledTask> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('定时任务不存在')
    }

    if (enabled) {
      task.enabled = true
      this.scheduleTask(taskId)
    } else {
      task.enabled = false
      this.unscheduleTask(taskId)
    }

    task.updatedAt = new Date().toISOString()
    await this.saveTasks()
    
    this.logger.info(`${enabled ? '启用' : '禁用'}定时任务: ${task.name}`)
    
    // 返回时排除job属性以避免循环引用
    const { job, ...resultTask } = task
    return resultTask
  }

  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).map(task => {
      const { job, ...taskData } = task
      return taskData
    })
  }

  getTask(taskId: string): ScheduledTask | undefined {
    const task = this.tasks.get(taskId)
    if (task) {
      const { job, ...taskData } = task
      return taskData
    }
    return undefined
  }

  // 立即执行任务
  async executeTaskImmediately(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('定时任务不存在')
    }

    this.logger.info(`立即执行定时任务: ${task.name}`)
    
    // 立即执行不受任务启用状态影响，直接调用执行逻辑
    await this.executeTaskDirectly(taskId)
  }

  // 清理所有任务
  destroy(): void {
    for (const task of this.tasks.values()) {
      if (task.job) {
        task.job.stop()
      }
    }
    this.tasks.clear()
    this.logger.info('定时任务管理器已销毁')
  }
}