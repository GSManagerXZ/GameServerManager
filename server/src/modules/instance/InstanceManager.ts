import { EventEmitter } from 'events'
import fs from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { TerminalManager } from '../terminal/TerminalManager.js'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface Instance {
  id: string
  name: string
  description: string
  workingDirectory: string
  startCommand: string
  autoStart: boolean
  stopCommand: 'ctrl+c' | 'stop' | 'exit' | 'quit'
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'error'
  pid?: number
  createdAt: string
  lastStarted?: string
  lastStopped?: string
  enableStreamForward?: boolean
  programPath?: string
  terminalSessionId?: string
  terminalUser?: string
}

export interface CreateInstanceRequest {
  name: string
  description: string
  workingDirectory: string
  startCommand: string
  autoStart: boolean
  stopCommand: 'ctrl+c' | 'stop' | 'exit' | 'quit'
  enableStreamForward?: boolean
  programPath?: string
  terminalUser?: string
}

export class InstanceManager extends EventEmitter {
  private instances: Map<string, Instance> = new Map()
  private configPath: string
  private saveTimeout: NodeJS.Timeout | null = null
  private logger: any
  private terminalManager: TerminalManager

  constructor(terminalManager: TerminalManager, logger: any, configPath: string = './data/instances.json') {
    super()
    this.logger = logger
    this.terminalManager = terminalManager
    this.configPath = configPath
  }
  
  // 获取系统负载信息
  private async getSystemLoad(): Promise<{ cpuUsage: number; memoryUsage: number }> {
    const os = await import('os')
    
    // 获取内存使用率
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = totalMemory - freeMemory
    const memoryUsage = (usedMemory / totalMemory) * 100
    
    // 获取CPU使用率
    const cpuUsage = await this.getCpuUsage()
    
    return {
      cpuUsage,
      memoryUsage
    }
  }
  
  // 获取CPU使用率
  private async getCpuUsage(): Promise<number> {
    const os = await import('os')
    
    return new Promise((resolve) => {
      const cpus = os.cpus()
      const startMeasure = cpus.map(cpu => {
        const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0)
        const idle = cpu.times.idle
        return { total, idle }
      })
      
      setTimeout(() => {
        const endMeasure = os.cpus().map(cpu => {
          const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0)
          const idle = cpu.times.idle
          return { total, idle }
        })
        
        let totalUsage = 0
        for (let i = 0; i < startMeasure.length; i++) {
          const totalDiff = endMeasure[i].total - startMeasure[i].total
          const idleDiff = endMeasure[i].idle - startMeasure[i].idle
          const usage = 100 - (100 * idleDiff / totalDiff)
          totalUsage += usage
        }
        
        const avgUsage = totalUsage / cpus.length
        resolve(Math.round(avgUsage * 100) / 100)
      }, 100)
    })
  }
  
  // 等待系统负载降低
  private async waitForLoadDecrease(): Promise<void> {
    const maxWaitTime = 300000 // 最大等待5分钟
    const checkInterval = 5000 // 每5秒检查一次
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      const systemLoad = await this.getSystemLoad()
      
      // 如果内存使用率超过90%，直接退出
      if (systemLoad.memoryUsage > 90) {
        this.logger.warn(`内存使用率过高 (${systemLoad.memoryUsage.toFixed(1)}%)，停止等待`)
        throw new Error('内存使用率过高，终止启动')
      }
      
      // 如果CPU使用率降到85%以下，继续启动
      if (systemLoad.cpuUsage <= 85) {
        this.logger.info(`CPU使用率已降低到 ${systemLoad.cpuUsage.toFixed(1)}%，继续启动`)
        return
      }
      
      this.logger.info(`等待CPU负载降低，当前: CPU ${systemLoad.cpuUsage.toFixed(1)}%, 内存 ${systemLoad.memoryUsage.toFixed(1)}%`)
      await this.delay(checkInterval)
    }
    
    this.logger.warn('等待超时，继续启动剩余实例')
  }
  
  // 延迟函数
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 初始化实例管理器
  public async initialize(): Promise<void> {
    this.logger.info('初始化实例管理器...')
    await this.loadInstances()
    this.logger.info('实例管理器初始化完成')
  }

  // 加载实例配置
  private async loadInstances(): Promise<void> {
    try {
      // 确保配置目录存在
      const configDir = path.dirname(this.configPath)
      await fs.mkdir(configDir, { recursive: true })

      // 尝试读取配置文件
      const data = await fs.readFile(this.configPath, 'utf-8')
      const instancesData = JSON.parse(data)
      
      for (const instanceData of instancesData) {
        const instance: Instance = {
          ...instanceData,
          status: 'stopped', // 重启后所有实例都是停止状态
          pid: undefined,
          terminalSessionId: undefined,
          enableStreamForward: instanceData.enableStreamForward ?? false,
          programPath: instanceData.programPath ?? '',
          terminalUser: instanceData.terminalUser ?? ''
        }
        this.instances.set(instance.id, instance)
      }
      
      this.logger.info(`已加载 ${this.instances.size} 个实例配置`)
      
      // 启动自动启动的实例
      this.startAutoStartInstances()
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.info('实例配置文件不存在，将创建新文件')
        await this.saveInstances()
      } else {
        this.logger.error('加载实例配置失败:', error)
      }
    }
  }

  // 保存实例配置
  private async saveInstances(): Promise<void> {
    try {
      // 防抖保存
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout)
      }
      
      this.saveTimeout = setTimeout(async () => {
        const instancesData = Array.from(this.instances.values()).map(instance => ({
          id: instance.id,
          name: instance.name,
          description: instance.description,
          workingDirectory: instance.workingDirectory,
          startCommand: instance.startCommand,
          autoStart: instance.autoStart,
          stopCommand: instance.stopCommand,
          createdAt: instance.createdAt,
          lastStarted: instance.lastStarted,
          lastStopped: instance.lastStopped,
          enableStreamForward: instance.enableStreamForward,
          programPath: instance.programPath,
          terminalUser: instance.terminalUser
        }))
        
        await fs.writeFile(this.configPath, JSON.stringify(instancesData, null, 2))
        this.logger.debug('实例配置已保存')
      }, 1000)
    } catch (error) {
      this.logger.error('保存实例配置失败:', error)
    }
  }

  // 启动自动启动的实例（错峰启动）
  private async startAutoStartInstances(): Promise<void> {
    const autoStartInstances = Array.from(this.instances.values()).filter(instance => instance.autoStart)
    
    if (autoStartInstances.length === 0) {
      return
    }
    
    this.logger.info(`开始错峰启动 ${autoStartInstances.length} 个自动启动实例`)
    
    for (let i = 0; i < autoStartInstances.length; i++) {
      const instance = autoStartInstances[i]
      
      try {
        // 检查系统负载
        const systemLoad = await this.getSystemLoad()
        
        // 如果内存使用率超过90%，直接终止启动
        if (systemLoad.memoryUsage > 90) {
          this.logger.warn(`内存使用率过高 (${systemLoad.memoryUsage.toFixed(1)}%)，终止剩余实例启动`)
          break
        }
        
        // 如果CPU使用率超过90%，等待负载降低
        if (systemLoad.cpuUsage > 90) {
          this.logger.warn(`CPU使用率过高 (${systemLoad.cpuUsage.toFixed(1)}%)，等待负载降低后继续启动`)
          await this.waitForLoadDecrease()
        }
        
        this.logger.info(`错峰启动实例 (${i + 1}/${autoStartInstances.length}): ${instance.name}`)
        await this.startInstance(instance.id)
        
        // 启动间隔，避免同时启动造成负载峰值
        if (i < autoStartInstances.length - 1) {
          await this.delay(2000) // 2秒间隔
        }
        
      } catch (error) {
        this.logger.error(`启动实例 ${instance.name} 失败:`, error)
        // 继续启动下一个实例
      }
    }
    
    this.logger.info('错峰启动完成')
  }

  // 获取所有实例
  public getInstances(): Instance[] {
    return Array.from(this.instances.values())
  }

  // 获取单个实例
  public getInstance(id: string): Instance | undefined {
    return this.instances.get(id)
  }

  // 创建实例
  public async createInstance(data: CreateInstanceRequest): Promise<Instance> {
    const id = uuidv4()
    const instance: Instance = {
      id,
      ...data,
      status: 'stopped',
      createdAt: new Date().toISOString()
    }
    
    this.instances.set(id, instance)
    await this.saveInstances()
    
    this.logger.info(`创建实例: ${instance.name} (${id})`)
    this.emit('instance-created', instance)
    
    return this.getInstance(id)!
  }

  // 更新实例
  public async updateInstance(id: string, data: CreateInstanceRequest): Promise<Instance | null> {
    const instance = this.instances.get(id)
    if (!instance) {
      return null
    }
    
    // 如果实例正在运行，不允许修改某些关键配置
    if (instance.status === 'running') {
      throw new Error('无法修改正在运行的实例配置')
    }
    
    const updatedInstance: Instance = {
      ...instance,
      ...data
    }
    
    this.instances.set(id, updatedInstance)
    await this.saveInstances()
    
    this.logger.info(`更新实例: ${updatedInstance.name} (${id})`)
    this.emit('instance-updated', updatedInstance)
    
    return this.getInstance(id)!
  }

  // 删除实例
  public async deleteInstance(id: string): Promise<boolean> {
    const instance = this.instances.get(id)
    if (!instance) {
      return false
    }
    
    // 如果实例正在运行，先停止它
    if (instance.status === 'running') {
      await this.stopInstance(id)
    }
    
    this.instances.delete(id)
    await this.saveInstances()
    
    this.logger.info(`删除实例: ${instance.name} (${id})`)
    this.emit('instance-deleted', { id, name: instance.name })
    
    return true
  }

  // 启动实例
  public async startInstance(id: string): Promise<{ success: boolean; terminalSessionId?: string }> {
    const instance = this.instances.get(id)
    if (!instance) {
      throw new Error('实例不存在')
    }
    
    if (instance.status === 'running') {
      throw new Error('实例已在运行')
    }
    
    if (instance.status === 'starting') {
      throw new Error('实例正在启动中')
    }
    
    try {
      // 更新状态为启动中
      instance.status = 'starting'
      this.emit('instance-status-changed', { id, status: 'starting' })
      
      // 检查工作目录是否存在
      try {
        await fs.access(instance.workingDirectory)
      } catch {
        throw new Error(`工作目录不存在: ${instance.workingDirectory}`)
      }
      
      // 根据平台检查和处理启动命令
      const platform = os.platform()
      const startCommand = instance.startCommand.trim()
      
      // 检查是否是 ./ 开头的命令
      if (startCommand.startsWith('./') && (platform === 'linux' || platform === 'darwin')) {
        // Linux/Mac 平台：自动为文件添加可执行权限
        // 提取文件名（处理可能有参数的情况）
        const commandParts = startCommand.split(/\s+/)
        const scriptPath = commandParts[0].substring(2) // 去掉 ./
        const fullPath = path.join(instance.workingDirectory, scriptPath)
        
        try {
          // 检查文件是否存在
          await fs.access(fullPath)
          
          // 添加可执行权限
          this.logger.info(`为文件添加可执行权限: ${fullPath}`)
          await execAsync(`chmod +x "${fullPath}"`)
          this.logger.info(`已为 ${scriptPath} 添加可执行权限`)
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            this.logger.warn(`启动脚本不存在: ${fullPath}，将尝试继续启动`)
          } else {
            this.logger.warn(`添加可执行权限失败: ${error.message}，将尝试继续启动`)
          }
        }
      }
      
      // 生成终端会话ID
      const terminalSessionId = `instance-${id}-${Date.now()}`
      
      // 创建一个虚拟socket对象用于终端管理器
      const virtualSocket = {
        id: terminalSessionId,
        emit: (event: string, data: any) => {
          // 转发终端输出事件
          if (event === 'terminal-output') {
            this.emit('instance-output', { id, data: data.data })
          } else if (event === 'terminal-exit') {
            this.logger.info(`实例 ${instance.name} 终端会话退出`)
            instance.status = 'stopped'
            instance.pid = undefined
            instance.terminalSessionId = undefined
            instance.lastStopped = new Date().toISOString()
            this.emit('instance-status-changed', { id, status: 'stopped' })
            this.saveInstances()
          } else if (event === 'terminal-error') {
            this.logger.error(`实例 ${instance.name} 终端错误:`, data.error)
            instance.status = 'error'
            instance.pid = undefined
            instance.terminalSessionId = undefined
            this.emit('instance-status-changed', { id, status: 'error' })
            this.saveInstances()
          }
        }
      } as any
      
      // 等待终端会话创建完成
      const terminalCreated = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('终端会话创建超时'))
        }, 5000)
        
        const originalEmit = virtualSocket.emit
        virtualSocket.emit = (event: string, data: any) => {
          if (event === 'pty-created') {
            clearTimeout(timeout)
            resolve(data)
          } else if (event === 'terminal-error') {
            clearTimeout(timeout)
            reject(new Error(data.error))
          }
          
          // 调用原始的emit方法处理其他事件
          originalEmit.call(virtualSocket, event, data)
        }
      })
      
      // 通过终端管理器创建PTY会话
      // 使用更大的默认终端大小，前端会根据实际容器大小进行调整
      await this.terminalManager.createPty(virtualSocket, {
        sessionId: terminalSessionId,
        name: `实例: ${instance.name} (${instance.id})`,
        cols: 100,
        rows: 30,
        workingDirectory: instance.workingDirectory,
        enableStreamForward: instance.enableStreamForward || false,
        programPath: instance.programPath || '',
        terminalUser: instance.terminalUser
      })
      
      // 等待终端创建完成
      await terminalCreated
      
      // 保存终端会话ID
      instance.terminalSessionId = terminalSessionId
      
      // 只有在未启用输出流转发时才执行启动命令
      // 启用输出流转发时，程序会通过programPath直接启动，避免重复执行
      if (!instance.enableStreamForward) {
        // 延迟执行启动命令，确保终端完全初始化
        setTimeout(() => {
          this.terminalManager.handleInput(virtualSocket, {
            sessionId: terminalSessionId,
            data: instance.startCommand + '\r'
          })
        }, 1000)
      }
      
      // 更新实例状态
      instance.status = 'running'
      instance.lastStarted = new Date().toISOString()
      
      this.logger.info(`启动实例: ${instance.name} (终端会话: ${terminalSessionId})`)
      
      this.emit('instance-status-changed', { id, status: 'running' })
      await this.saveInstances()
      
      return { success: true, terminalSessionId }
    } catch (error) {
      this.logger.error(`启动实例 ${instance.name} 失败:`, error)
      instance.status = 'error'
      instance.pid = undefined
      instance.terminalSessionId = undefined
      this.emit('instance-status-changed', { id, status: 'error' })
      throw error
    }
  }

  // 重启实例
  public async restartInstance(id: string): Promise<{ success: boolean; terminalSessionId?: string }> {
    const instance = this.instances.get(id)
    if (!instance) {
      throw new Error('实例不存在')
    }
    
    try {
      this.logger.info(`重启实例: ${instance.name}`)
      
      // 如果实例正在运行，先停止它
      if (instance.status === 'running') {
        await this.stopInstance(id)
        
        // 等待实例完全停止
        await new Promise(resolve => {
          const checkStatus = () => {
            if (instance.status === 'stopped' || instance.status === 'error') {
              resolve(void 0)
            } else {
              setTimeout(checkStatus, 500)
            }
          }
          checkStatus()
        })
        
        // 额外等待2秒确保旧终端会话完全清理
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      
      // 重新启动实例
      const result = await this.startInstance(id)
      this.logger.info(`实例 ${instance.name} 重启完成`)
      
      return result
    } catch (error) {
      this.logger.error(`重启实例 ${instance.name} 失败:`, error)
      throw error
    }
  }

  // 停止实例
  public async stopInstance(id: string): Promise<boolean> {
    const instance = this.instances.get(id)
    if (!instance) {
      throw new Error('实例不存在')
    }
    
    if (instance.status !== 'running') {
      throw new Error('实例未在运行')
    }
    
    if (!instance.terminalSessionId) {
      throw new Error('终端会话ID不存在')
    }
    
    try {
      instance.status = 'stopping'
      this.emit('instance-status-changed', { id, status: 'stopping' })
      
      this.logger.info(`停止实例: ${instance.name} (终端会话: ${instance.terminalSessionId})`)
      
      // 创建虚拟socket用于终端操作
      const virtualSocket = {
        id: instance.terminalSessionId,
        emit: () => {}
      } as any
      
      // 根据配置的停止命令发送相应的输入
      switch (instance.stopCommand) {
        case 'ctrl+c':
          // 发送 Ctrl+C 字符 (ASCII 3)
          this.terminalManager.handleInput(virtualSocket, {
            sessionId: instance.terminalSessionId,
            data: '\u0003' // Ctrl+C
          })
          break
        case 'stop':
          // 向终端输入 'stop' 命令
          this.terminalManager.handleInput(virtualSocket, {
            sessionId: instance.terminalSessionId,
            data: 'stop\r'
          })
          break
        case 'exit':
          // 向终端输入 'exit' 命令
          this.terminalManager.handleInput(virtualSocket, {
            sessionId: instance.terminalSessionId,
            data: 'exit\r'
          })
          break
        case 'quit':
          // 向终端输入 'quit' 命令
          this.terminalManager.handleInput(virtualSocket, {
            sessionId: instance.terminalSessionId,
            data: 'quit\r'
          })
          break
      }
      
      // 等待一段时间后如果实例仍在运行，则强制关闭终端会话
      setTimeout(() => {
        if (instance.status === 'stopping') {
          this.logger.warn(`实例 ${instance.name} 未能优雅退出，强制关闭终端会话`)
          this.terminalManager.closePty(virtualSocket, {
            sessionId: instance.terminalSessionId!
          })
          
          // 手动更新实例状态
          instance.status = 'stopped'
          instance.pid = undefined
          instance.terminalSessionId = undefined
          instance.lastStopped = new Date().toISOString()
          this.emit('instance-status-changed', { id, status: 'stopped' })
          this.saveInstances()
        }
      }, 10000) // 10秒超时
      
      return true
    } catch (error) {
      this.logger.error(`停止实例 ${instance.name} 失败:`, error)
      instance.status = 'error'
      throw error
    }
  }

  // 关闭终端
  public async closeTerminal(id: string): Promise<boolean> {
    const instance = this.instances.get(id)
    if (!instance) {
      throw new Error('实例不存在')
    }
    
    if (!instance.terminalSessionId) {
      throw new Error('终端会话不存在')
    }
    
    try {
      this.logger.info(`关闭实例终端: ${instance.name} (终端会话: ${instance.terminalSessionId})`)
      
      // 创建虚拟socket用于终端操作
      const virtualSocket = {
        id: instance.terminalSessionId,
        emit: () => {}
      } as any
      
      // 强制关闭终端会话
      this.terminalManager.closePty(virtualSocket, {
        sessionId: instance.terminalSessionId
      })
      
      // 更新实例状态
      instance.status = 'stopped'
      instance.pid = undefined
      instance.terminalSessionId = undefined
      instance.lastStopped = new Date().toISOString()
      
      this.emit('instance-status-changed', { id, status: 'stopped' })
      await this.saveInstances()
      
      return true
    } catch (error) {
      this.logger.error(`关闭实例 ${instance.name} 终端失败:`, error)
      throw error
    }
  }

  // 获取实例状态
  public getInstanceStatus(id: string): { status: string; pid?: number } | null {
    const instance = this.instances.get(id)
    if (!instance) {
      return null
    }
    
    return {
      status: instance.status,
      pid: instance.pid
    }
  }

  // 向实例发送输入
  public sendInput(id: string, input: string): boolean {
    const instance = this.instances.get(id)
    if (!instance || !instance.terminalSessionId || instance.status !== 'running') {
      return false
    }
    
    try {
      // 创建虚拟socket用于终端操作
      const virtualSocket = {
        id: instance.terminalSessionId,
        emit: () => {}
      } as any
      
      this.terminalManager.handleInput(virtualSocket, {
        sessionId: instance.terminalSessionId,
        data: input
      })
      
      return true
    } catch (error) {
      this.logger.error(`向实例 ${instance.name} 发送输入失败:`, error)
      return false
    }
  }

  // 清理资源
  public async cleanup(): Promise<void> {
    this.logger.info('清理实例管理器资源...')
    
    // 停止所有运行中的实例
    const runningInstances = Array.from(this.instances.values())
      .filter(instance => instance.status === 'running')
    
    for (const instance of runningInstances) {
      try {
        await this.stopInstance(instance.id)
      } catch (error) {
        this.logger.error(`清理时停止实例 ${instance.name} 失败:`, error)
      }
    }
    
    // 保存最终状态
    await this.saveInstances()
    
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }
  }
}

export default InstanceManager