import { EventEmitter } from 'events'
import fs from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { TerminalManager, CloseResult } from '../terminal/TerminalManager.js'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { JavaManager } from '../environment/javaManager.js'

const execAsync = promisify(exec)

export type InstanceType = 'generic' | 'minecraft-java' | 'minecraft-bedrock'

export interface SteamInstanceConfig {
  appId: string
  gameKey: string
  branch: string
}

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
  instanceType?: InstanceType
  javaVersion?: string
  steam?: SteamInstanceConfig
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
  instanceType?: InstanceType
  javaVersion?: string
  steam?: SteamInstanceConfig
}

export interface InstanceOperationLockRequest {
  token: string
  reason: string
}

interface PendingInstanceSave {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

export type InstanceTerminalLifecycleResult =
  | { status: 'close-initiated'; terminalSessionId: string }
  | { status: 'closed'; terminalSessionId: string }
  | { status: 'still-running'; terminalSessionId: string }

export class InstanceManager extends EventEmitter {
  private instances: Map<string, Instance> = new Map()
  private operationLocks: Map<string, { token: string; reason: string }> = new Map()
  private configPath: string
  private saveTimeout: NodeJS.Timeout | null = null
  private pendingSave: PendingInstanceSave | null = null
  private saveInProgress = false
  private saveRequested = false
  /** 真实写盘完成的 generation；每次成功写盘递增。 */
  private saveEpoch = 0
  /**
   * 最近一次真实写盘失败的 generation 与错误（成功后清除）。
   * 供 durability barrier 观察"刚被 fire-and-forget 消费者捕获的失败"：
   * flushPendingSave 失败会先清空 pendingSave，仅看 pendingSave 会误判成功。
   */
  private lastSaveFailure: { epoch: number; error: unknown } | null = null
  /** 关闭开始即置位：之后所有实例保存跳过 debounce，立即串行 flush，保证 shutdown 期写入不丢失。 */
  private shuttingDown = false
  /** 数据类 mutation（create/update/delete）串行队列，保证失败回滚不产生逆序覆盖。 */
  private mutationChain: Promise<void> = Promise.resolve()
  private logger: any
  private terminalManager: TerminalManager
  private javaManager: JavaManager

  constructor(terminalManager: TerminalManager, logger: any, configPath: string = './data/instances.json') {
    super()
    this.logger = logger
    this.terminalManager = terminalManager
    this.configPath = configPath
    this.javaManager = new JavaManager()
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

  // 检测工作目录中的启动脚本
  private async detectStartScript(workingDirectory: string): Promise<string | null> {
    try {
      const files = await fs.readdir(workingDirectory)
      const platform = os.platform()

      // 根据平台定义启动脚本文件名优先级
      const scriptNames = platform === 'win32'
        ? ['start.bat', 'run.bat', 'start.cmd', 'run.cmd']
        : ['start.sh', 'run.sh']

      // 按优先级查找启动脚本
      for (const scriptName of scriptNames) {
        if (files.includes(scriptName)) {
          this.logger.info(`检测到启动脚本: ${scriptName}`)
          return scriptName
        }
      }

      return null
    } catch (error) {
      this.logger.error('检测启动脚本失败:', error)
      return null
    }
  }

  // 检测工作目录中的jar文件
  private async detectJarFile(workingDirectory: string): Promise<string | null> {
    try {
      const files = await fs.readdir(workingDirectory)
      const jarFiles = files.filter(file => file.endsWith('.jar'))

      if (jarFiles.length === 0) {
        return null
      }

      // 如果只有一个jar文件，直接返回
      if (jarFiles.length === 1) {
        return jarFiles[0]
      }

      // 如果有多个jar文件，优先选择包含server的文件名
      const serverJar = jarFiles.find(file => file.toLowerCase().includes('server'))
      if (serverJar) {
        return serverJar
      }

      // 否则返回第一个jar文件
      return jarFiles[0]
    } catch (error) {
      this.logger.error('检测jar文件失败:', error)
      return null
    }
  }

  // 获取Java路径
  private async getJavaPath(javaVersion?: string): Promise<string> {
    // 如果未指定Java版本，使用系统PATH中的java
    if (!javaVersion) {
      return 'java'
    }

    try {
      // 从JavaManager获取Java环境列表
      const javaEnvironments = await this.javaManager.getJavaEnvironments()

      // 查找匹配的Java版本
      const javaEnv = javaEnvironments.find(env => env.version === javaVersion)

      if (javaEnv && javaEnv.installed && javaEnv.javaExecutable) {
        this.logger.info(`找到Java ${javaVersion} 路径: ${javaEnv.javaExecutable}`)
        // 返回带引号的路径（处理包含空格的情况）
        return `"${javaEnv.javaExecutable}"`
      }

      // 如果没有找到指定版本的Java，回退到系统PATH中的java
      this.logger.warn(`未找到已安装的Java版本 ${javaVersion}，使用系统PATH中的java`)
      return 'java'
    } catch (error) {
      this.logger.error(`获取Java路径失败:`, error)
      this.logger.warn(`回退到系统PATH中的java`)
      return 'java'
    }
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
        // 迁移旧的 auto-detect-jar 占位符
        let startCommand = instanceData.startCommand
        if (startCommand === 'auto-detect-jar') {
          startCommand = 'echo Minecraft Java Edition'
          this.logger.info(`迁移实例 ${instanceData.name} 的旧启动命令占位符`)
        }

        const instance: Instance = {
          ...instanceData,
          startCommand,
          status: 'stopped', // 重启后所有实例都是停止状态
          pid: undefined,
          terminalSessionId: undefined,
          enableStreamForward: instanceData.enableStreamForward ?? false,
          programPath: instanceData.programPath ?? '',
          terminalUser: instanceData.terminalUser ?? '',
          instanceType: instanceData.instanceType ?? 'generic',
          javaVersion: instanceData.javaVersion ?? undefined,
          steam: instanceData.steam && instanceData.steam.appId
            ? {
                appId: String(instanceData.steam.appId),
                gameKey: String(instanceData.steam.gameKey || ''),
                branch: String(instanceData.steam.branch || 'public')
              }
            : undefined
        }
        this.instances.set(instance.id, instance)
      }

      this.logger.info(`已加载 ${this.instances.size} 个实例配置`)

      // 启动自动启动的实例
      void this.startAutoStartInstances().catch(error => {
        this.logger.error('自动启动实例任务失败:', error)
      })
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.info('实例配置文件不存在，将创建新文件')
        await this.saveInstances()
      } else {
        this.logger.error('加载实例配置失败:', error)
      }
    }
  }

  private serializeInstances(): string {
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
      terminalUser: instance.terminalUser,
      instanceType: instance.instanceType,
      javaVersion: instance.javaVersion,
      steam: instance.steam
    }))
    return JSON.stringify(instancesData, null, 2)
  }

  private createPendingSave(): PendingInstanceSave {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }

  /**
   * 数据类 mutation（create/update/delete）串行执行：共享同一个 pending save 的并发回滚
   * 若无序恢复旧快照会产生逆序覆盖（U1 A→B、U2 B→C，P reject 后 U1 恢复 A、U2 再恢复 B，
   * 失败 mutation B 留在 map）。串行化后每个 mutation 的 rollback 都是对"最后写入值"的恢复，
   * 最终内存状态与磁盘一致。前一 mutation 失败不阻塞后续（then(fn, fn)）。
   *
   * N3-I1：start/stop/close/restart 等 lifecycle 操作也经此队列进入同一 per-instance 串行域，
   * 与 CRUD 共用单条串行链（不得为 lifecycle 另开第二条写路径）。链内互斥保证操作期间
   * map entry 不会被并发 update 替换或 delete 删除；配套 identity 重校验（assertInstanceIdentity）
   * 在每次 await 后防御性确认 `this.instances.get(id) === instance`。
   */
  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    // N-I3b：shutdown 一旦开始（cleanup 置 shuttingDown），所有公开 CRUD/lifecycle
    // wrapper 拒绝新请求（可重试错误）。已准入（在置位前入链）的 mutation 由 cleanup
    // 在 drain 阶段等待其 settle；置位后的新入链请求立即拒绝，不再追加到链尾。
    if (this.shuttingDown) {
      return Promise.reject(new Error('服务器正在关闭，请稍后重试'))
    }
    const run = this.mutationChain.then(operation, operation)
    this.mutationChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /**
   * 校验 map 中仍是该对象：lifecycle/CRUD 共用串行队列后正常情况下恒为真；
   * 若对象已被替换或删除（防御性路径），不得继续在 detached 对象上写状态/owner——
   * 否则 live PTY 脱离 map，stop/delete/status/shutdown 均不可见。
   */
  private assertInstanceIdentity(id: string, instance: Instance): void {
    if (this.instances.get(id) !== instance) {
      throw new Error('实例已被修改或删除，启动操作已中止')
    }
  }

  // 防抖请求共享同一个 promise，直到真实写盘完成后才 settle。
  // 关闭期间（shuttingDown）跳过防抖：立即串行 flush，保证 shutdown 期每个 mutation 都真实落盘。
  private saveInstances(): Promise<void> {
    if (this.shuttingDown) {
      return this.flushSaveNow()
    }

    this.saveRequested = true
    if (!this.pendingSave) {
      this.pendingSave = this.createPendingSave()
    }

    if (!this.saveInProgress) {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout)
      }
      this.saveTimeout = setTimeout(() => {
        this.saveTimeout = null
        void this.flushPendingSave().catch(error => {
          this.logger.error('保存实例配置失败:', error)
        })
      }, 1000)
    }

    return this.pendingSave.promise
  }

  /** 关闭期间跳过 1000ms 防抖，立即 flush 当前（或新建的）pending 并等待真实写盘 settle。 */
  private async flushSaveNow(): Promise<void> {
    // 置 dirty 请求：若另一份写盘正在 in-flight，其 do-while 循环看到该标志会
    // 在完成后续写下一快照（否则共享 pending 的调用方会在旧快照上误判成功）。
    this.saveRequested = true
    let pending = this.pendingSave
    if (!pending) {
      this.pendingSave = this.createPendingSave()
      pending = this.pendingSave
    }
    await this.flushPendingSave()
    await pending.promise
  }

  private async writeInstancesToDisk(): Promise<void> {
    await fs.writeFile(this.configPath, this.serializeInstances())
    this.logger.debug('实例配置已保存')
    this.saveEpoch += 1
    this.lastSaveFailure = null
  }

  private async flushPendingSave(): Promise<void> {
    const pending = this.pendingSave
    if (!pending) {
      return
    }
    if (this.saveInProgress) {
      return pending.promise
    }

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
    }
    this.saveInProgress = true
    try {
      do {
        this.saveRequested = false
        await this.writeInstancesToDisk()
      } while (this.saveRequested)

      if (this.pendingSave === pending) {
        this.pendingSave = null
      }
      pending.resolve()
    } catch (error) {
      this.saveRequested = false
      if (this.pendingSave === pending) {
        this.pendingSave = null
      }
      // 记录失败的 save generation：barrier 即使采样不到 pendingSave 也能观察到该失败。
      this.saveEpoch += 1
      this.lastSaveFailure = { epoch: this.saveEpoch, error }
      // 失败只通过共享 pending promise 的 rejection 传播（单一来源、单一消费者），
      // 不再在此处二次 throw，避免 cleanup() 中 `await finalSave` 变成无人消费的 rejection。
      pending.reject(error)
    } finally {
      this.saveInProgress = false
    }
  }

  /**
   * 触发挂起的保存并等待真实写盘 settle（成功或失败都通过共享 pending promise 传播）。
   * 供 stop/close 的 callback 路径与 shutdown 使用：callback 清 ID 不能绕过 awaited save。
   * 即使 flush 失败后 pendingSave 已被清空、rejection 已被 fire-and-forget 消费者捕获，
   * 也能通过 lastSaveFailure generation 观察到刚发生的真实失败。
   *
   * N-I3a barrier 语义：入口采样目标 epoch，随后等待"采样时在途/挂起 + 采样后产生"的
   * 全部 mutation generation 真实落盘（每次写盘成功/失败都递增 saveEpoch）后才 resolve；
   * 任何真实失败（含已被 fire-and-forget 消费的失败 generation）都以 throw 传播，
   * closeTerminal/stopInstance 不得在真实失败后返回 closed。
   */
  private async awaitPendingSaveDurability(): Promise<void> {
    // 采样目标 epoch：仅统计采样点之后的 generation（失败水印在后续成功写盘时由
    // writeInstancesToDisk 清空，与 round-3 语义一致：被消费的失败在下次成功前必须抛错）。
    const targetEpoch = this.saveEpoch
    while (true) {
      const pending = this.pendingSave
      if (pending) {
        // 与 flushSaveNow 一致置 dirty：若另一份写盘 in-flight，其 do-while 在完成后续写
        // 下一快照，覆盖"采样后产生且尚未序列化"的 mutation generation，再 resolve 共享 pending。
        this.saveRequested = true
        await this.flushPendingSave()
        await pending.promise
      }
      if (this.lastSaveFailure) {
        throw this.lastSaveFailure.error
      }
      if (
        this.saveEpoch >= targetEpoch &&
        !this.saveInProgress &&
        !this.saveRequested &&
        !this.pendingSave &&
        !this.saveTimeout
      ) {
        return
      }
      // 仍有在途写/dirty 请求/新 pending（采样后产生的 generation）：继续等待落盘。
    }
  }

  /**
   * 强制 flush 挂起的实例保存；供 shutdown 在 TerminalManager.cleanup 之后
   * 调用，确保其触发的最新最终状态落盘后才退出进程。
   * 使用立即写盘语义：即使没有挂起保存也会写入当前状态（对上次失败的写盘做最终重试）。
   */
  public async flushPendingSaves(): Promise<void> {
    await this.flushSaveNow()
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

  public acquireOperationLock(id: string, token: string, reason: string): boolean {
    if (!this.instances.has(id) || this.operationLocks.has(id)) {
      return false
    }

    this.operationLocks.set(id, { token, reason })
    return true
  }

  public releaseOperationLock(id: string, token: string): void {
    const lock = this.operationLocks.get(id)
    if (lock?.token === token) {
      this.operationLocks.delete(id)
    }
  }

  public getOperationLockReason(id: string): string | undefined {
    return this.operationLocks.get(id)?.reason
  }

  private assertOperationLockOwner(id: string, operationToken?: string): void {
    const lock = this.operationLocks.get(id)
    if (lock && lock.token !== operationToken) {
      throw new Error(`实例正在${lock.reason}，请等待操作完成后再修改`)
    }
  }

  // 创建实例
  public createInstance(
    data: CreateInstanceRequest,
    operationLock?: InstanceOperationLockRequest
  ): Promise<Instance> {
    return this.enqueueMutation(async () => {
      const id = uuidv4()
      const instance: Instance = {
        id,
        ...data,
        status: 'stopped',
        createdAt: new Date().toISOString()
      }

      this.instances.set(id, instance)
      if (operationLock) {
        this.operationLocks.set(id, operationLock)
      }
      try {
        await this.saveInstances()
      } catch (error) {
        this.instances.delete(id)
        if (operationLock) this.releaseOperationLock(id, operationLock.token)
        throw error
      }

      this.logger.info(`创建实例: ${instance.name} (${id})`)
      this.emit('instance-created', instance)

      return this.getInstance(id)!
    })
  }

  // 更新实例
  public updateInstance(
    id: string,
    data: CreateInstanceRequest,
    operationToken?: string
  ): Promise<Instance | null> {
    return this.enqueueMutation(async () => {
      const instance = this.instances.get(id)
      if (!instance) {
        return null
      }
      this.assertOperationLockOwner(id, operationToken)

      // N3-I1：不得把 live/retained terminal owner 复制到新 map object——`{...instance,...data}`
      // 会保留旧 terminalSessionId，而旧 PTY callback 捕获的是旧对象、其 identity guard 在
      // 对象替换后直接返回，map/磁盘将永久保留 stale error/stopping + session 组合。
      // 与 start 的 I9 守卫一致：先完成 confirmed close（closeTerminal/delete）再修改配置。
      if (
        instance.terminalSessionId &&
        this.terminalManager.hasTarget(instance.terminalSessionId)
      ) {
        throw new Error('实例终端会话仍在运行或保留中，请先关闭终端后重试')
      }

      // 如果实例正在运行，不允许修改某些关键配置
      if (instance.status === 'running') {
        throw new Error('无法修改正在运行实例的配置')
      }

      const updatedInstance: Instance = {
        ...instance,
        ...data
      }

      this.instances.set(id, updatedInstance)
      try {
        await this.saveInstances()
      } catch (error) {
        // 真实写失败：仅当 map 中仍是我们写入的对象时恢复旧对象（串行队列保证这一点），
        // 与 createInstance 的 rollback 一致；失败 mutation 不留在内存。
        this.instances.set(id, instance)
        throw error
      }

      this.logger.info(`更新实例: ${updatedInstance.name} (${id})`)
      this.emit('instance-updated', updatedInstance)

      return this.getInstance(id)!
    })
  }

  // 删除实例
  public deleteInstance(id: string, operationToken?: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const instance = this.instances.get(id)
      if (!instance) {
        return false
      }
      this.assertOperationLockOwner(id, operationToken)

      // 只有终端目标确认删除后才能移除实例元数据。
      if (instance.terminalSessionId) {
        const closeResult = await this.closeTerminalInternal(id)
        if (closeResult.status === 'still-running') {
          throw new Error('实例终端仍在运行，请稍后重试删除')
        }
      }

      this.instances.delete(id)
      try {
        await this.saveInstances()
      } catch (error) {
        // 真实写失败：恢复实例，与 createInstance 的 rollback 一致
        this.instances.set(id, instance)
        throw error
      }

      this.logger.info(`删除实例: ${instance.name} (${id})`)
      this.emit('instance-deleted', { id, name: instance.name })

      return true
    })
  }

  // 启动实例
  // N3-I1：lifecycle 与 CRUD 进入同一串行队列；internal body 在每次 await 后重校验对象 identity。
  public startInstance(id: string): Promise<{ success: boolean; terminalSessionId?: string }> {
    return this.enqueueMutation(() => this.startInstanceInternal(id))
  }

  private async startInstanceInternal(id: string): Promise<{ success: boolean; terminalSessionId?: string }> {
    const instance = this.instances.get(id)
    if (!instance) {
      throw new Error('实例不存在')
    }

    const operationLock = this.operationLocks.get(id)
    if (operationLock) {
      throw new Error(`实例正在${operationLock.reason}，请等待操作完成后再启动`)
    }

    if (instance.status === 'running') {
      throw new Error('实例已在运行')
    }

    if (instance.status === 'starting') {
      throw new Error('实例正在启动中')
    }

    // retained ownership 闭环：error/stopping 实例若仍持有 live/retained 终端目标，
    // 下一次 start 必须拒绝而不是覆盖旧 owner；先完成 confirmed close 再重试。
    if (
      instance.terminalSessionId &&
      this.terminalManager.hasTarget(instance.terminalSessionId)
    ) {
      throw new Error('实例终端会话仍在运行或保留中，请先关闭终端后重试')
    }

    let retainedTerminalSessionId: string | undefined
    let startCommandTimer: NodeJS.Timeout | undefined
    let createdSessionId: string | undefined
    let terminalFinalized = false
    let terminalOwnershipConsumed = false
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
      this.assertInstanceIdentity(id, instance)

      // 根据平台检查和处理启动命令
      const platform = os.platform()
      let startCommand = instance.startCommand.trim()

      // 我的世界Java版 - 自动检测启动脚本或jar文件
      if (instance.instanceType === 'minecraft-java') {
        // 优先检测启动脚本
        const startScript = await this.detectStartScript(instance.workingDirectory)
        this.assertInstanceIdentity(id, instance)

        if (startScript) {
          // 检测到启动脚本，直接使用脚本启动
          if (platform === 'win32') {
            startCommand = startScript
          } else {
            // Linux/Mac 平台，使用 ./ 前缀
            startCommand = `./${startScript}`
          }
          this.logger.info(`我的世界Java版检测到启动脚本: ${startCommand}`)
        } else {
          // 未检测到启动脚本，使用jar文件启动
          const jarFile = await this.detectJarFile(instance.workingDirectory)
          this.assertInstanceIdentity(id, instance)
          if (!jarFile) {
            const errorMsg = `启动失败：工作目录中未找到启动脚本或.jar文件\n\n请确保工作目录（${instance.workingDirectory}）中包含以下文件之一：\n` +
              (platform === 'win32'
                ? '• 启动脚本：start.bat, run.bat, start.cmd, run.cmd\n• 或服务端核心：.jar文件'
                : '• 启动脚本：start.sh, run.sh\n• 或服务端核心：.jar文件')
            this.logger.error(errorMsg)
            throw new Error(errorMsg)
          }

          // 获取Java路径
          const javaPath = await this.getJavaPath(instance.javaVersion)
          this.assertInstanceIdentity(id, instance)

          // 构建启动命令
          // 在Windows PowerShell中，如果路径包含引号，需要使用 & 调用运算符
          if (platform === 'win32' && javaPath.startsWith('"')) {
            startCommand = `& ${javaPath} -jar ${jarFile} nogui`
          } else {
            startCommand = `${javaPath} -jar ${jarFile} nogui`
          }
          this.logger.info(`我的世界Java版自动生成启动命令: ${startCommand}`)
        }
      }

      // 我的世界基岩版 - 检测对应平台的启动文件
      if (instance.instanceType === 'minecraft-bedrock') {
        const bedrockExecutable = platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server'
        const bedrockPath = path.join(instance.workingDirectory, bedrockExecutable)

        try {
          await fs.access(bedrockPath)
          this.assertInstanceIdentity(id, instance)
          this.logger.info(`我的世界基岩版检测到启动文件: ${bedrockExecutable}`)
        } catch {
          const errorMsg = `启动失败：工作目录中未找到基岩版服务端启动文件\n\n请确保工作目录（${instance.workingDirectory}）中包含以下文件：\n` +
            (platform === 'win32'
              ? '• 基岩版服务端：bedrock_server.exe'
              : '• 基岩版服务端：bedrock_server')
          this.logger.error(errorMsg)
          throw new Error(errorMsg)
        }
      }

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
          this.assertInstanceIdentity(id, instance)

          // 添加可执行权限
          this.logger.info(`为文件添加可执行权限: ${fullPath}`)
          await execAsync(`chmod +x "${fullPath}"`)
          this.assertInstanceIdentity(id, instance)
          this.logger.info(`已为 ${scriptPath} 添加可执行权限`)
        } catch (error: any) {
          // N3-I1(b)：identity 丢失不是 chmod 失败——不得在此吞掉（否则会在已替换/删除的
          // 对象上继续启动），必须向外传播，由外层 catch 做 detached 回收/拒绝。
          if (this.instances.get(id) !== instance) {
            throw error
          }
          if (error.code === 'ENOENT') {
            this.logger.warn(`启动脚本不存在: ${fullPath}，将尝试继续启动`)
          } else {
            this.logger.warn(`添加可执行权限失败: ${error.message}，将尝试继续启动`)
          }
        }
      }

      // 生成终端会话ID
      const terminalSessionId = `instance-${id}-${Date.now()}`
      const handleTerminalFinalized = () => {
        terminalFinalized = true
        if (this.instances.get(id) !== instance) {
          // N3-I1：map 中对象已被替换/删除：不在 detached 旧对象上写状态/触发保存
          this.logger.warn(`实例 ${instance.name} 已被修改或删除，忽略旧终端退出回调: ${terminalSessionId}`)
          return
        }
        if (instance.terminalSessionId !== terminalSessionId) {
          return
        }
        terminalOwnershipConsumed = true
        this.logger.info(`实例 ${instance.name} 终端会话退出`)
        instance.status = 'stopped'
        instance.pid = undefined
        instance.terminalSessionId = undefined
        instance.lastStopped = new Date().toISOString()
        this.emit('instance-status-changed', { id, status: 'stopped' })
        void this.saveInstances().catch(error => {
          this.logger.error(`保存实例 ${instance.name} 的退出状态失败:`, error)
        })
      }

      // 创建一个虚拟socket对象用于终端管理器
      const virtualSocket = {
        id: terminalSessionId,
        emit: (event: string, data: any) => {
          if (event === 'terminal-output') {
            this.emit('instance-output', { id, data: data.data })
          } else if (event === 'terminal-exit') {
            handleTerminalFinalized()
          } else if (event === 'terminal-error') {
            if (this.instances.get(id) !== instance) {
              this.logger.warn(`实例 ${instance.name} 已被修改或删除，忽略旧终端错误事件: ${terminalSessionId}`)
              return
            }
            if (instance.terminalSessionId !== terminalSessionId) {
              this.logger.info(`忽略旧终端会话错误事件: ${terminalSessionId} (当前: ${instance.terminalSessionId})`)
              return
            }
            this.logger.error(`实例 ${instance.name} 终端错误:`, data.error)
            instance.status = 'error'
            instance.pid = undefined
            if (!data.retained && !this.terminalManager.hasTarget(terminalSessionId)) {
              instance.terminalSessionId = undefined
            }
            this.emit('instance-status-changed', { id, status: 'error' })
            void this.saveInstances().catch(error => {
              this.logger.error(`保存实例 ${instance.name} 的错误状态失败:`, error)
            })
          }
        }
      } as any

      const createResult = await this.terminalManager.createPty(virtualSocket, {
        sessionId: terminalSessionId,
        name: `实例: ${instance.name} (${instance.id})`,
        cols: 100,
        rows: 30,
        workingDirectory: instance.workingDirectory,
        enableStreamForward: instance.enableStreamForward || false,
        programPath: instance.programPath || '',
        autoCloseOnForwardExit: instance.enableStreamForward || false,
        terminalUser: instance.terminalUser
      }, {
        onExit: handleTerminalFinalized
      })
      // N3-I1(b)：先记录已创建的 session ID，再做 identity 校验——若 identity 在
      // createPty 返回后的窗口丢失（防御性路径），catch 仍能以 createdSessionId 对
      // 该 session 执行 bounded close 回收，而不是无 session 可关。
      createdSessionId = createResult.sessionId
      this.assertInstanceIdentity(id, instance)
      if (createResult.status !== 'ready') {
        if (
          createResult.status === 'failed-retained' &&
          !terminalFinalized &&
          this.terminalManager.hasTarget(createResult.sessionId)
        ) {
          retainedTerminalSessionId = createResult.sessionId
        }
        throw new Error(createResult.error)
      }
      if (terminalFinalized || !this.terminalManager.hasSession(createResult.sessionId)) {
        throw new Error('终端会话在创建完成后立即退出')
      }

      instance.terminalSessionId = createResult.sessionId

      // 更新实例状态
      instance.status = 'running'
      instance.lastStarted = new Date().toISOString()

      this.logger.info(`启动实例: ${instance.name} (终端会话: ${terminalSessionId}), 启动命令: ${startCommand}`)

      this.emit('instance-status-changed', { id, status: 'running' })

      // 启动命令必须与持久化成功绑定：先完成可观察的持久化并成功，才安排启动命令；
      // 保存失败则保留 live owner、不安排命令、API 返回失败（既有 owner guard 继续生效）。
      await this.saveInstances()

      // awaited save 窗口内 terminal 可能已退出（callback 清 owner、改 stopped）：
      // 返回前重查，已退出则返回失败（可重试），不得返回 success。
      // N2-I4 扩展：同时校验 map identity（未被替换/删除）与 status 仍为 running
      // （save 窗口内 terminal-error 可把状态改为 error 但仍保留 live target）。
      if (
        this.instances.get(id) !== instance ||
        terminalFinalized ||
        instance.status !== 'running' ||
        instance.terminalSessionId !== terminalSessionId ||
        !this.terminalManager.hasSession(createResult.sessionId)
      ) {
        throw new Error('终端会话在启动保存期间已退出，请重试启动')
      }

      // 只有在未启用输出流转发时才执行启动命令
      // 启用输出流转发时，程序会通过programPath直接启动，避免重复执行
      if (!instance.enableStreamForward) {
        // 延迟执行启动命令，确保终端完全初始化
        // timer 句柄被捕获：保存失败时可取消，避免 API 返回失败后仍启动游戏
        startCommandTimer = setTimeout(() => {
          if (instance.terminalSessionId !== terminalSessionId) {
            return
          }
          this.terminalManager.handleInput(virtualSocket, {
            sessionId: terminalSessionId,
            data: startCommand + '\r'  // 使用动态生成的启动命令
          })
        }, 1000)
      }

      return { success: true, terminalSessionId }
    } catch (error) {
      this.logger.error(`启动实例 ${instance.name} 失败:`, error)
      if (startCommandTimer) {
        clearTimeout(startCommandTimer)
        startCommandTimer = undefined
      }
      if (this.instances.get(id) !== instance) {
        // N3-I1：map entry 已被并发 update 替换或 delete 删除——不得在 detached 旧对象上
        // 写状态/owner、不得向 map/磁盘写 detached 状态；对已创建的 live PTY 执行 bounded
        // close 回收（仍 running 则由服务端 retained 语义保留，可经 close/重连路径回收）。
        if (createdSessionId && this.terminalManager.hasTarget(createdSessionId)) {
          this.logger.warn(`实例 ${instance.name} 已被修改或删除，回收已创建的终端会话: ${createdSessionId}`)
          void this.terminalManager.closePty(
            { id: createdSessionId, emit: () => {} } as any,
            { sessionId: createdSessionId }
          ).catch((closeError: unknown) => {
            this.logger.error(`回收已创建的终端会话失败: ${createdSessionId}`, closeError)
          })
        }
        throw error
      }
      if (terminalOwnershipConsumed) {
        // callback 已消费归属并置 stopped（终端在保存窗口内退出）：
        // 保持 stopped 状态，允许直接重试启动，不覆盖为 error。
      } else {
        instance.status = 'error'
        instance.pid = undefined
        if (retainedTerminalSessionId !== undefined) {
          instance.terminalSessionId = retainedTerminalSessionId
        }
        // ready 分支的 save 失败：保留 live terminal owner（不清 terminalSessionId），
        // 并已取消启动命令 timer；API 返回失败但不会产生业务 orphan。
        this.emit('instance-status-changed', { id, status: 'error' })
      }
      throw error
    }
  }

  // 重启实例
  // N5-I1：拆分为链内发起 → 链外等待 → 链内裁决/重启 的流水线；长等待（优雅停止 10s、
  // bounded close 4s）不持有全局 mutationChain，不再阻塞其它实例的 CRUD/lifecycle。
  public async restartInstance(id: string): Promise<{ success: boolean; terminalSessionId?: string }> {
    const restartDeadline = Date.now() + 20_000
    try {
      // Phase 1（链内）：校验 + 捕获 + 发起停止/关闭（无终端则直接进入启动阶段）
      const phase1 = await this.enqueueMutation(async () => {
        const instance = this.instances.get(id)
        if (!instance) {
          throw new Error('实例不存在')
        }
        this.logger.info(`重启实例: ${instance.name}`)
        if (!instance.terminalSessionId) {
          return { mode: 'start-only' } as { mode: 'start-only' }
        }
        if (instance.status === 'running') {
          return { mode: 'stop', ...this.stopInitiateSerial(id) } as const
        }
        return { mode: 'close', ...this.closeInitiateSerial(id) } as const
      })

      // Phase 2（链外）：等待优雅退出 / bounded close 完成
      let closeOutcome: InstanceTerminalLifecycleResult | null = null
      if (phase1.mode === 'stop') {
        closeOutcome = await this.stopReleaseAwaitAndFinalize(id, phase1)
      } else if (phase1.mode === 'close') {
        const closeResult = await phase1.closePromise
        closeOutcome = await this.enqueueMutation(() =>
          this.closeFinalizeSerial(id, phase1, closeResult)
        )
      }

      // Phase 3（链内）：still-running/超时裁决 + 重新启动（start 全程链内，保留 N3-I1 串行域）
      return this.enqueueMutation(async () => {
        if (closeOutcome && closeOutcome.status === 'still-running') {
          throw new Error('实例终端仍在运行，请稍后重试重启')
        }
        if (Date.now() > restartDeadline) {
          throw new Error('实例停止超时，请稍后重试重启')
        }
        const result = await this.startInstanceInternal(id)
        this.logger.info(`实例 ${id} 重启完成`)
        return result
      })
    } catch (error) {
      this.logger.error(`重启实例 ${id} 失败:`, error)
      throw error
    }
  }

  private async waitForTerminalRelease(
    instance: Instance,
    terminalSessionId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (
        instance.terminalSessionId !== terminalSessionId ||
        !this.terminalManager.hasTarget(terminalSessionId)
      ) {
        return true
      }
      await this.delay(100)
    }
    return instance.terminalSessionId !== terminalSessionId ||
      !this.terminalManager.hasTarget(terminalSessionId)
  }

  /**
   * 停止：链内"发起"（校验 + 置 stopping + 发停止命令），不做任何等待。
   * N5-I1：与最终落盘分离，调用方在链外等待 release 后再回到链内落盘，
   * 10s 优雅等待不再独占全局 mutationChain。
   */
  private stopInitiateSerial(id: string): { instance: Instance; terminalSessionId: string } {
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

    const terminalSessionId = instance.terminalSessionId
    instance.status = 'stopping'
    this.emit('instance-status-changed', { id, status: 'stopping' })
    this.logger.info(`停止实例: ${instance.name} (终端会话: ${terminalSessionId})`)

    const virtualSocket = {
      id: terminalSessionId,
      emit: () => {}
    } as any
    const stopInput = instance.stopCommand === 'ctrl+c'
      ? '\u0003'
      : `${instance.stopCommand}\r`
    this.terminalManager.handleInput(virtualSocket, {
      sessionId: terminalSessionId,
      data: stopInput
    })
    return { instance, terminalSessionId }
  }

  /**
   * 停止最终落盘（链内）：优雅等待成功后的状态清理。map 对象已被替换/删除时
   * 不在 detached 对象上写状态（N3-I1），直接按已释放返回 closed。
   */
  private async stopFinalizeSerial(
    id: string,
    captured: { instance: Instance; terminalSessionId: string }
  ): Promise<InstanceTerminalLifecycleResult> {
    const { instance, terminalSessionId } = captured
    if (this.instances.get(id) !== instance) {
      this.logger.warn(
        `实例 ${instance.name} 在停止等待期间已被修改或删除，跳过旧会话状态落盘`
      )
      return { status: 'closed', terminalSessionId }
    }
    if (instance.terminalSessionId === terminalSessionId) {
      await this.markInstanceTerminalClosed(id, instance, terminalSessionId)
    } else {
      // callback 已清 ID：其 fire-and-forget save 必须真正落盘后才可返回成功
      await this.awaitPendingSaveDurability()
    }
    return { status: 'closed', terminalSessionId }
  }

  /**
   * 关闭：链内"发起"（校验 + 发起 bounded closePty，返回 closePromise handle）。
   * 可复用 stop 已捕获的实例/会话（stop 优雅等待失败后的升级路径）。
   */
  private closeInitiateSerial(
    id: string,
    captured?: { instance: Instance; terminalSessionId: string }
  ): { instance: Instance; terminalSessionId: string; closePromise: Promise<CloseResult> } {
    const instance = captured?.instance ?? this.instances.get(id)
    if (!instance) {
      throw new Error('实例不存在')
    }
    const terminalSessionId = captured?.terminalSessionId ?? instance.terminalSessionId
    if (!terminalSessionId) {
      throw new Error('终端会话不存在')
    }

    this.logger.info(`关闭实例终端: ${instance.name} (终端会话: ${terminalSessionId})`)
    const virtualSocket = {
      id: terminalSessionId,
      emit: () => {}
    } as any

    const closePromise = this.terminalManager.closePty(virtualSocket, {
      sessionId: terminalSessionId
    })
    return { instance, terminalSessionId, closePromise }
  }

  /**
   * 关闭最终裁决与落盘（链内）：still-running/hasTarget 保留实例状态；
   * map 对象已被替换/删除时不在 detached 对象上写状态（N3-I1）。
   */
  private async closeFinalizeSerial(
    id: string,
    init: { instance: Instance; terminalSessionId: string },
    closeResult: CloseResult
  ): Promise<InstanceTerminalLifecycleResult> {
    const { instance, terminalSessionId } = init
    if (this.instances.get(id) !== instance) {
      this.logger.warn(
        `实例 ${instance.name} 在关闭等待期间已被修改或删除，跳过旧会话状态落盘`
      )
      return {
        status: closeResult === 'still-running' ? 'still-running' : 'closed',
        terminalSessionId
      }
    }
    if (
      closeResult === 'still-running' ||
      this.terminalManager.hasTarget(terminalSessionId)
    ) {
      this.logger.error(
        `实例 ${instance.name} 的终端进程仍在运行，保留实例状态，需要手动重试关闭终端`
      )
      return { status: 'still-running', terminalSessionId }
    }

    if (instance.terminalSessionId === terminalSessionId) {
      await this.markInstanceTerminalClosed(id, instance, terminalSessionId)
    } else {
      // callback 已清 ID：其 fire-and-forget save 必须真正落盘后才可返回成功
      await this.awaitPendingSaveDurability()
    }
    return { status: 'closed', terminalSessionId }
  }

  /**
   * 停止的链外等待 + 链内落盘流水线（公开 stopInstance 使用）：
   * 链内发起 → 链外等待优雅退出（最长 10s）→ 链内落盘；优雅退出失败则
   * 链内发起 bounded close → 链外等待（SIGTERM 3s + SIGKILL 1s）→ 链内裁决。
   */
  private async stopReleaseAwaitAndFinalize(
    id: string,
    captured: { instance: Instance; terminalSessionId: string }
  ): Promise<InstanceTerminalLifecycleResult> {
    if (await this.waitForTerminalRelease(captured.instance, captured.terminalSessionId, 10_000)) {
      return this.enqueueMutation(() => this.stopFinalizeSerial(id, captured))
    }

    this.logger.warn(`实例 ${captured.instance.name} 未能优雅退出，强制关闭终端会话`)
    const escalated = await this.enqueueMutation(async () => this.closeInitiateSerial(id, captured))
    const closeResult = await escalated.closePromise
    return this.enqueueMutation(() => this.closeFinalizeSerial(id, escalated, closeResult))
  }

  /**
   * 链内完整停止（供 cleanup 等 admission 已冻结、串行域已排空的调用方使用；
   * 等待在调用方上下文中进行，多个实例可并行）。
   */
  private async stopInstanceInternal(id: string): Promise<InstanceTerminalLifecycleResult> {
    const captured = this.stopInitiateSerial(id)
    try {
      if (await this.waitForTerminalRelease(captured.instance, captured.terminalSessionId, 10_000)) {
        return await this.stopFinalizeSerial(id, captured)
      }

      this.logger.warn(`实例 ${captured.instance.name} 未能优雅退出，强制关闭终端会话`)
      const escalated = this.closeInitiateSerial(id, captured)
      const closeResult = await escalated.closePromise
      return await this.closeFinalizeSerial(id, escalated, closeResult)
    } catch (error) {
      this.logger.error(`停止实例 ${captured.instance.name} 失败:`, error)
      if (
        this.instances.get(id) === captured.instance &&
        captured.instance.terminalSessionId === captured.terminalSessionId
      ) {
        captured.instance.status = 'error'
      }
      throw error
    }
  }

  // 停止实例：等待 10 秒优雅退出，然后进入 bounded 强制关闭。
  // N5-I1：公开 wrapper 只把"发起"留在链内，10s 优雅等待在链外进行，
  // 唤醒后重新入链做 identity 校验与最终状态落盘——长等待不再阻塞其它实例 CRUD。
  public async stopInstance(id: string): Promise<InstanceTerminalLifecycleResult> {
    const captured = await this.enqueueMutation(async () => this.stopInitiateSerial(id))
    try {
      return await this.stopReleaseAwaitAndFinalize(id, captured)
    } catch (error) {
      this.logger.error(`停止实例 ${captured.instance.name} 失败:`, error)
      if (
        this.instances.get(id) === captured.instance &&
        captured.instance.terminalSessionId === captured.terminalSessionId
      ) {
        captured.instance.status = 'error'
      }
      throw error
    }
  }

  private async markInstanceTerminalClosed(
    id: string,
    instance: Instance,
    terminalSessionId: string
  ): Promise<void> {
    if (instance.terminalSessionId !== terminalSessionId) {
      this.logger.warn(`实例 ${instance.name} 的终端归属已变化，跳过旧会话状态清理`)
      return
    }

    const stateSnapshot = {
      status: instance.status,
      pid: instance.pid,
      terminalSessionId: instance.terminalSessionId,
      lastStopped: instance.lastStopped
    }
    const stoppedAt = new Date().toISOString()
    instance.status = 'stopped'
    instance.pid = undefined
    instance.terminalSessionId = undefined
    instance.lastStopped = stoppedAt
    try {
      await this.saveInstances()
    } catch (saveError) {
      if (
        instance.status === 'stopped' &&
        instance.pid === undefined &&
        instance.terminalSessionId === undefined &&
        instance.lastStopped === stoppedAt
      ) {
        instance.status = stateSnapshot.status
        instance.pid = stateSnapshot.pid
        instance.terminalSessionId = stateSnapshot.terminalSessionId
        instance.lastStopped = stateSnapshot.lastStopped
      } else {
        this.logger.warn(
          `实例 ${instance.name} 在保存停止状态失败期间归属已变化，跳过旧状态回滚`
        )
      }
      throw saveError
    }
    if (
      instance.status === 'stopped' &&
      instance.pid === undefined &&
      instance.terminalSessionId === undefined &&
      instance.lastStopped === stoppedAt
    ) {
      this.emit('instance-status-changed', { id, status: 'stopped' })
    }
  }

  // 关闭终端
  // N5-I1：链内发起 closePty → 链外等待 bounded close（SIGTERM 3s + SIGKILL 1s）→
  // 链内裁决/落盘；等待期间不持有全局 mutationChain。
  public async closeTerminal(id: string): Promise<InstanceTerminalLifecycleResult> {
    const init = await this.enqueueMutation(async () => this.closeInitiateSerial(id))
    try {
      const closeResult = await init.closePromise
      return await this.enqueueMutation(() => this.closeFinalizeSerial(id, init, closeResult))
    } catch (error) {
      this.logger.error(`关闭实例 ${init.instance.name} 终端失败:`, error)
      throw error
    }
  }

  /** 链内完整关闭（供 delete/cleanup 等链内或冻结上下文调用；等待在调用方上下文中进行）。 */
  private async closeTerminalInternal(id: string): Promise<InstanceTerminalLifecycleResult> {
    const init = this.closeInitiateSerial(id)
    const closeResult = await init.closePromise
    return this.closeFinalizeSerial(id, init, closeResult)
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
    // 冻结准入：shuttingDown 置位后所有公开 CRUD/lifecycle wrapper 拒绝新请求（可重试），
    // 且新 save 跳过 debounce、立即串行 flush。之后才 drain 已准入 mutation 链尾——
    // 保证"已准入 async handler 的写回"在 final flush 之前完成并真实落盘。
    this.shuttingDown = true
    await this.mutationChain.catch(() => {})

    // N5-I1：admission 已冻结 + 链已排空，直接并行（Promise.allSettled）执行 internal
    // 停止，不再经全局 mutationChain 逐个串行——多个不响应实例不会各自独占 10s 优雅等待
    // 耗尽 shutdown 预算；每个实例仍保持独立 fault isolation。
    const runningInstances = Array.from(this.instances.values())
      .filter(instance => instance.status === 'running' && instance.terminalSessionId)

    await Promise.allSettled(runningInstances.map(instance =>
      this.stopInstanceInternal(instance.id).catch(error => {
        this.logger.error(`清理时停止实例 ${instance.name} 失败:`, error)
      })
    ))

    // N3-I1(c)：回收非 running 但仍持有 live/retained target 的 owner（error/stopping/
    // 启动失败保留/关闭超时保留），与 delete 的 confirmed-close-first 语义一致：
    // 先 bounded close，再按结果落盘最终状态；仍 running 的目标由 TerminalManager.cleanup
    // 统一有界关闭兜底。
    const retainedOwners = Array.from(this.instances.values())
      .filter(instance =>
        instance.terminalSessionId &&
        this.terminalManager.hasTarget(instance.terminalSessionId)
      )

    await Promise.allSettled(retainedOwners.map(instance =>
      this.closeTerminalInternal(instance.id).catch(error => {
        this.logger.error(`清理时关闭实例 ${instance.name} 的保留终端失败:`, error)
      })
    ))

    // 保存并刷新最终状态（shuttingDown 模式下为立即写盘，不会在真实写盘前清掉 debounce timer）。
    await this.flushPendingSaves()
  }
}

export default InstanceManager
