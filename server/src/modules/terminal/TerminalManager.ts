import { spawn, ChildProcess } from 'child_process'
import { Server as SocketIOServer, Socket } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import winston from 'winston'
import path from 'path'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import { fileURLToPath } from 'url'
import os from 'os'
import { promisify } from 'util'
import { exec } from 'child_process'
import { TerminalSessionManager, PersistedTerminalSession } from './TerminalSessionManager.js'
import { ConfigManager } from '../config/ConfigManager.js'
import { ptyManager } from '../../utils/ptyManager.js'
import { buildUtf8LocaleEnv } from '../../utils/filenameEncoding.js'
import { StreamingRedactor } from '../../utils/streamingRedactor.js'
import { buildChildProcessEnvironment } from '../../utils/childProcessEnvironment.js'
import {
  createPtyControlChannel,
  PtyControlChannel,
  PtySize,
  removePtyControlEndpoint,
  validatePtySize
} from '../../utils/ptyControlChannel.js'

const execAsync = promisify(exec)
const buildManagedChildEnvironment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => (
  buildUtf8LocaleEnv(buildChildProcessEnvironment(overrides))
)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface PtySession {
  id: string
  name: string // 终端会话名称
  state: 'ready' | 'closing'
  size: PtySize
  process: ChildProcess
  control: PtyControlChannel
  endpoint: string
  socket: Socket
  workingDirectory: string
  createdAt: Date
  lastActivity: Date
  disconnected?: boolean
  disconnectedAt?: Date
  outputBuffer: string[] // 存储终端输出历史
  streamForwardProcess?: ChildProcess // 输出流转发进程
  pendingForwardAutoCloseProcess?: ChildProcess
  streamForwardRestartGeneration: number
  enableStreamForward?: boolean // 是否启用输出流转发
  programPath?: string // 程序启动参数的绝对路径
  autoCloseOnForwardExit?: boolean // 转发进程退出时是否自动关闭终端会话
  fallbackRetried?: boolean // 是否已尝试过回退重试
  stdoutRedactor: StreamingRedactor
  stderrRedactor: StreamingRedactor
  onOutput?: (output: string) => void
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  exitNotified?: boolean
  closePromise?: Promise<CloseResult>
  controlClosePromise?: Promise<void>
  finalizationPromise?: Promise<CloseResult>
  closeContext?: CloseContext
  persistenceRemoval?: Promise<void>
  activePersistenceOwned: boolean
  processExited: boolean
  processExitCode?: number | null
  processExitSignal?: NodeJS.Signals | null
  processErrorSent?: boolean
  finalEventSent: boolean
  publicCloseRequesters?: Map<string, Socket>
  publicCloseAckedIds?: Set<string>
  notifyRetainedOnTimeout?: boolean
  retainedTimeoutNotified?: boolean
}

interface CreatePtyData {
  sessionId: string
  name?: string // 会话名称
  cols: number
  rows: number
  workingDirectory?: string
  enableStreamForward?: boolean // 是否启用输出流转发
  programPath?: string // 程序启动参数的绝对路径
  autoCloseOnForwardExit?: boolean // 转发进程退出时是否自动关闭终端会话
  terminalUser?: string // 指定的终端用户
}

interface TerminalInputData {
  sessionId: string
  data: string
}

interface TerminalResizeData {
  sessionId: string
  cols: number
  rows: number
}

export interface ManagedProcessOptions {
  executablePath: string
  args: string[]
  workingDirectory: string
  input?: string
  redactValues?: string[]
  timeoutMs?: number
  onOutput?: (output: string) => void
}

export interface PtyRuntimeOptions {
  command?: string[]
  environmentOverrides?: NodeJS.ProcessEnv
  redactValues?: string[]
  onOutput?: (output: string) => void
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export type CloseResult = 'closed' | 'not-found' | 'still-running'
export type CreatePtyResult =
  | { status: 'ready'; sessionId: string }
  | { status: 'failed-closed'; sessionId: string; error: string }
  | { status: 'failed-retained'; sessionId: string; error: string }
export type ReconnectResult = 'ready' | 'pending' | 'closing' | 'not-found'

interface CloseContext {
  readonly intentional: boolean
  readonly emitEvents: boolean
  readonly emitTimeoutError: boolean
}

interface CloseRequestOptions extends CloseContext {
  readonly publicRequester?: Socket
  readonly notifyRetained?: boolean
}

type CreateAttemptPhase =
  | 'starting'
  | 'fallback'
  | 'closing'
  | 'close-retained'

interface CreateCancellationToken {
  cancelled: boolean
}

interface CreateAttempt {
  id: string
  name: string
  phase: CreateAttemptPhase
  cancellation: CreateCancellationToken
  createSize: PtySize
  process?: ChildProcess
  control?: PtyControlChannel
  endpoint?: string
  socket: Socket
  workingDirectory: string
  createdAt: Date
  lastActivity: Date
  outputBuffer: string[]
  streamForwardProcess?: ChildProcess
  enableStreamForward?: boolean
  programPath?: string
  autoCloseOnForwardExit?: boolean
  stdoutRedactor: StreamingRedactor
  stderrRedactor: StreamingRedactor
  onOutput?: (output: string) => void
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  exitNotified?: boolean
  runtimeOptions: PtyRuntimeOptions
  selectedUser: string
  fallbackEligibleFromConfiguredDefault: boolean
  terminalEnv: NodeJS.ProcessEnv
  closePromise?: Promise<CloseResult>
  controlClosePromise?: Promise<void>
  finalizationPromise?: Promise<CloseResult>
  closeContext?: CloseContext
  activePersistenceOwned: boolean
  processExited: boolean
  processExitCode?: number | null
  processExitSignal?: NodeJS.Signals | null
  processError?: Error
  failureMessage?: string
  finalEventSent: boolean
  publicCloseRequesters?: Map<string, Socket>
  publicCloseAckedIds?: Set<string>
  notifyRetainedOnTimeout?: boolean
  retainedTimeoutNotified?: boolean
}

export interface TerminalManagerDependencies {
  spawnPty?: typeof spawn
  createControlChannel?: typeof createPtyControlChannel
}

interface PtyProcessOutcome {
  kind: 'close' | 'error'
  code: number | null
  signal: NodeJS.Signals | null
  error?: Error
  elapsedMs: number
}

interface PtyProcessLaunch {
  process: ChildProcess
  control: PtyControlChannel
  endpoint: string
  outcome: Promise<PtyProcessOutcome>
}

interface ManagedProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  output: string
}

export class TerminalManager {
  private sessions: Map<string, PtySession> = new Map()
  private managedProcesses: Set<ChildProcess> = new Set()
  private createAttempts = new Map<string, CreateAttempt>()
  private persistenceOperations = new Map<string, Promise<void>>()
  private internallyStoppedForwardProcesses = new WeakSet<ChildProcess>()
  private ptyStdinHandlers = new WeakSet<ChildProcess>()
  private forwardStdinHandlers = new WeakSet<ChildProcess>()
  private acceptingTerminalOperations = true
  private io: SocketIOServer
  private logger: winston.Logger
  private ptyPath: string
  private sessionManager: TerminalSessionManager
  private configManager: ConfigManager
  private readonly spawnPty: typeof spawn
  private readonly createControlChannel: typeof createPtyControlChannel

  constructor(
    io: SocketIOServer,
    logger: winston.Logger,
    configManager: ConfigManager,
    dependencies: TerminalManagerDependencies = {}
  ) {
    this.io = io
    this.logger = logger
    this.configManager = configManager
    this.sessionManager = new TerminalSessionManager(logger)
    this.spawnPty = dependencies.spawnPty ?? spawn
    this.createControlChannel = dependencies.createControlChannel ?? createPtyControlChannel
    
    // PTY 路径将在 initialize() 中通过 ptyManager 异步获取
    this.ptyPath = ''
    
    // 定期清理不活跃的会话 - 已禁用
    // setInterval(() => {
    //   this.cleanupInactiveSessions()
    // }, 5 * 60 * 1000) // 每5分钟检查一次
    
    // 定期清理过期的持久化会话 - 已禁用
    // setInterval(() => {
    //   this.sessionManager.cleanupExpiredSessions()
    // }, 24 * 60 * 60 * 1000) // 每24小时清理一次
  }
  
  /**
   * 初始化终端管理器
   * 通过 ptyManager 获取 PTY 二进制文件路径
   */
  async initialize(): Promise<void> {
    await this.sessionManager.initialize()
    
    // 仅使用已经过固定清单校验和本机能力探测的 PTY 路径。
    try {
      this.ptyPath = await ptyManager.getPtyPath()
      this.logger.info(`终端管理器初始化完成，PTY路径: ${this.ptyPath}`)
    } catch (error: any) {
      this.ptyPath = ''
      this.logger.error(`PTY 能力不可用，终端会话将无法创建: ${error.message}`)
    }
  }

  public async runManagedProcess(options: ManagedProcessOptions): Promise<ManagedProcessResult> {
    const {
      executablePath,
      args,
      workingDirectory,
      input,
      redactValues = [],
      timeoutMs = 30 * 60 * 1000,
      onOutput
    } = options
    return new Promise((resolve, reject) => {
      let settled = false
      let processError: Error | null = null
      let forceKillTimer: NodeJS.Timeout | null = null
      const child = spawn(executablePath, args, {
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        cwd: workingDirectory,
        env: buildManagedChildEnvironment(),
        shell: false,
        windowsHide: true
      })
      this.managedProcesses.add(child)
      const outputChunks: string[] = []
      let outputLengthBytes = 0
      const maxOutputLength = 10 * 1024 * 1024
      const stdoutRedactor = new StreamingRedactor(redactValues)
      const stderrRedactor = new StreamingRedactor(redactValues)
      const clearTimers = () => {
        clearTimeout(timeoutTimer)
        if (forceKillTimer) clearTimeout(forceKillTimer)
      }
      const stopProcess = (error: Error) => {
        if (processError || settled) return
        processError = error
        try {
          child.kill()
        } catch (killError) {
          this.logger.warn('终止托管进程失败，将继续尝试强制终止', killError)
        }
        forceKillTimer = setTimeout(() => {
          if (settled) return
          try {
            child.kill('SIGKILL')
          } catch (killError) {
            this.logger.error('强制终止托管进程失败', killError)
          }
        }, 5000)
        forceKillTimer.unref?.()
      }
      const appendOutput = (output: string) => {
        if (!output) return

        outputLengthBytes += Buffer.byteLength(output)
        if (outputLengthBytes > maxOutputLength) {
          stopProcess(new Error('托管进程输出过大'))
          return
        }
        outputChunks.push(output)
        try {
          onOutput?.(output)
        } catch (error) {
          this.logger.warn('托管进程输出回调执行失败', error)
        }
      }
      const flushOutput = () => {
        appendOutput(stdoutRedactor.end())
        appendOutput(stderrRedactor.end())
      }
      const timeoutTimer = setTimeout(() => {
        stopProcess(new Error(`托管进程执行超时（${Math.ceil(timeoutMs / 60000)}分钟）`))
      }, timeoutMs)
      timeoutTimer.unref?.()
      child.stdout?.on('data', (data: Buffer) => appendOutput(stdoutRedactor.write(data)))
      child.stderr?.on('data', (data: Buffer) => appendOutput(stderrRedactor.write(data)))
      child.stdin?.on('error', error => stopProcess(error))
      child.once('error', error => {
        stopProcess(error)
      })
      child.once('close', (code, signal) => {
        if (settled) return
        settled = true
        this.managedProcesses.delete(child)
        flushOutput()
        clearTimers()
        if (processError) {
          reject(processError)
          return
        }
        resolve({ code, signal, output: outputChunks.join('') })
      })
      if (input !== undefined) {
        child.stdin?.end(input)
      }
    })
  }

  /**
   * 创建新的PTY会话
   */
  public async createPty(
    socket: Socket,
    data: CreatePtyData,
    runtimeOptions: PtyRuntimeOptions = {}
  ): Promise<CreatePtyResult> {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : ''
    let attempt: CreateAttempt

    try {
      if (!this.acceptingTerminalOperations) {
        const error = '终端管理器正在关闭'
        this.emitTerminalError(socket, sessionId, 'create', error)
        return { status: 'failed-closed', sessionId, error }
      }
      if (!this.ptyPath) {
        const error = 'PTY 能力不可用：可信 PTY 运行时未初始化'
        this.logger.error(`创建PTY会话失败: ${error}`)
        this.emitTerminalError(socket, sessionId, 'create', error)
        return { status: 'failed-closed', sessionId, error }
      }
      if (!data || typeof data.sessionId !== 'string' || data.sessionId.trim() === '') {
        throw new Error('会话ID不能为空')
      }

      const createSize = validatePtySize(data.cols, data.rows)
      const workingDirectory = path.resolve(data.workingDirectory ?? process.cwd())
      const enableStreamForward = data.enableStreamForward ?? false
      const autoCloseOnForwardExit = data.autoCloseOnForwardExit ?? false
      this.validateStreamForwardArguments(enableStreamForward, data.programPath)

      const terminalConfig = this.configManager.getTerminalConfig()
      const configuredDefaultUser = terminalConfig.defaultUser || ''
      const selectedUser = data.terminalUser || configuredDefaultUser
      const environmentOverrides = runtimeOptions.environmentOverrides ?? {}
      const terminalEnv = buildManagedChildEnvironment({
        ...environmentOverrides,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      })
      const sessionName = data.name || `终端会话 ${sessionId.slice(-8)}`

      if (
        this.sessions.has(sessionId) ||
        this.createAttempts.has(sessionId)
      ) {
        const error = '会话ID已存在'
        this.emitTerminalError(socket, sessionId, 'create', error)
        return { status: 'failed-closed', sessionId, error }
      }

      attempt = this.createAttemptRecord({
        sessionId,
        sessionName,
        socket,
        workingDirectory,
        createSize,
        enableStreamForward,
        programPath: data.programPath,
        autoCloseOnForwardExit,
        runtimeOptions,
        selectedUser,
        fallbackEligibleFromConfiguredDefault: configuredDefaultUser.trim() !== '',
        terminalEnv
      })
      this.createAttempts.set(sessionId, attempt)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      this.logger.error(`创建PTY会话失败: ${message}`)
      this.emitTerminalError(socket, sessionId, 'create', message)
      return { status: 'failed-closed', sessionId, error: message }
    }

    try {
      this.logger.info(
        `创建PTY会话: ${attempt.id} (${attempt.name}), ` +
        `大小: ${attempt.createSize.cols}x${attempt.createSize.rows}`
      )

      await this.prepareAttemptDirectory(attempt)
      if (!this.isActiveAttempt(attempt)) {
        return this.resolveCreatePtyResult(attempt)
      }

      const primaryCommand = await this.buildPrimaryCommand(attempt)
      if (!this.isActiveAttempt(attempt) || !primaryCommand) {
        return this.resolveCreatePtyResult(attempt)
      }

      const primary = await this.launchAttemptProcess(
        attempt,
        primaryCommand,
        'PTY进程'
      )
      if (!this.isActiveAttempt(attempt) || !primary) {
        return this.resolveCreatePtyResult(attempt)
      }

      await this.establishPrimaryAttempt(attempt, primary)
    } catch (error) {
      if (!this.isActiveAttempt(attempt)) {
        return this.resolveCreatePtyResult(attempt)
      }
      const message = error instanceof Error ? error.message : '未知错误'
      this.logger.error(`创建PTY会话失败: ${attempt.id}`, error)
      await this.failCreateAttempt(attempt, message)
    }

    return this.resolveCreatePtyResult(attempt)
  }

  private resolveCreatePtyResult(attempt: CreateAttempt): CreatePtyResult {
    if (this.sessions.has(attempt.id)) {
      return { status: 'ready', sessionId: attempt.id }
    }

    const error = attempt.failureMessage ?? '终端会话创建未完成'
    if (this.createAttempts.get(attempt.id) === attempt) {
      return { status: 'failed-retained', sessionId: attempt.id, error }
    }
    return { status: 'failed-closed', sessionId: attempt.id, error }
  }

  private createAttemptRecord(options: {
    sessionId: string
    sessionName: string
    socket: Socket
    workingDirectory: string
    createSize: PtySize
    enableStreamForward: boolean
    programPath?: string
    autoCloseOnForwardExit: boolean
    runtimeOptions: PtyRuntimeOptions
    selectedUser: string
    fallbackEligibleFromConfiguredDefault: boolean
    terminalEnv: NodeJS.ProcessEnv
  }): CreateAttempt {
    const now = new Date()
    const redactValues = options.runtimeOptions.redactValues ?? []
    return {
      id: options.sessionId,
      name: options.sessionName,
      phase: 'starting',
      cancellation: { cancelled: false },
      createSize: {
        cols: options.createSize.cols,
        rows: options.createSize.rows
      },
      socket: options.socket,
      workingDirectory: options.workingDirectory,
      createdAt: now,
      lastActivity: now,
      outputBuffer: [],
      enableStreamForward: options.enableStreamForward,
      programPath: options.programPath,
      autoCloseOnForwardExit: options.autoCloseOnForwardExit,
      stdoutRedactor: new StreamingRedactor(redactValues),
      stderrRedactor: new StreamingRedactor(redactValues),
      onOutput: options.runtimeOptions.onOutput,
      onExit: options.runtimeOptions.onExit,
      runtimeOptions: options.runtimeOptions,
      selectedUser: options.selectedUser,
      fallbackEligibleFromConfiguredDefault:
        options.fallbackEligibleFromConfiguredDefault,
      terminalEnv: options.terminalEnv,
      activePersistenceOwned: false,
      processExited: false,
      finalEventSent: false
    }
  }

  private validateStreamForwardArguments(
    enableStreamForward: boolean,
    programPath?: string
  ): void {
    if (enableStreamForward && os.platform() !== 'win32') {
      throw new Error('输出流转发功能仅在Windows平台支持')
    }
    if (enableStreamForward && !programPath) {
      throw new Error('启用输出流转发时必须提供程序启动命令')
    }
    if (!enableStreamForward || !programPath) return

    const commandLine = programPath.trim()
    let executablePath: string
    if (commandLine.startsWith('"')) {
      const endQuoteIndex = commandLine.indexOf('"', 1)
      if (endQuoteIndex === -1) {
        throw new Error('未找到匹配的引号')
      }
      executablePath = commandLine.substring(1, endQuoteIndex)
    } else {
      executablePath = commandLine.split(/\s+/)[0]
    }

    if (!path.isAbsolute(executablePath)) {
      throw new Error('可执行文件路径必须是绝对路径')
    }
  }

  private isActiveAttempt(attempt: CreateAttempt): boolean {
    return !attempt.cancellation.cancelled &&
      this.createAttempts.get(attempt.id) === attempt
  }

  private hasAttemptIdentity(attempt: CreateAttempt): boolean {
    return this.createAttempts.get(attempt.id) === attempt
  }

  private async prepareAttemptDirectory(attempt: CreateAttempt): Promise<void> {
    if (!this.isActiveAttempt(attempt)) return
    if (
      os.platform() !== 'linux' ||
      !attempt.selectedUser ||
      attempt.selectedUser.trim() === '' ||
      attempt.selectedUser === 'root'
    ) {
      return
    }

    try {
      await this.setDirectoryPermissions777(attempt.workingDirectory)
      if (!this.isActiveAttempt(attempt)) return
      this.logger.info(
        `已为非root用户 ${attempt.selectedUser} 设置工作目录权限为777: ` +
        attempt.workingDirectory
      )
    } catch (error) {
      if (!this.isActiveAttempt(attempt)) return
      this.logger.warn(`设置工作目录权限失败: ${error}`)
    }
  }

  private async buildPrimaryCommand(
    attempt: CreateAttempt
  ): Promise<string[] | null> {
    if (!this.isActiveAttempt(attempt)) return null

    const command = attempt.runtimeOptions.command
    if (command && command.length > 0) {
      return [...command]
    }
    if (os.platform() === 'win32') {
      return ['powershell.exe']
    }
    if (!attempt.selectedUser || attempt.selectedUser.trim() === '') {
      return ['/bin/bash', '--login']
    }

    const userExists = await this.checkUserExists(attempt.selectedUser)
    if (!this.isActiveAttempt(attempt)) return null
    if (!userExists) {
      this.logger.warn(
        `配置的默认用户 '${attempt.selectedUser}' 不存在，使用默认bash`
      )
      return ['/bin/bash', '--login']
    }

    const environmentOverrides = attempt.runtimeOptions.environmentOverrides ?? {}
    const preservedEnvironmentNames = Object.keys(environmentOverrides)
      .filter(name => /^[A-Z_][A-Z0-9_]*$/i.test(name))
    const shellLocaleEnvArgs = this.buildShellLocaleEnvArgs(attempt.terminalEnv)
    const shellLocaleExport = this.buildShellLocaleExport(attempt.terminalEnv)
    const sudoExists = await this.checkCommandExists('sudo')
    if (!this.isActiveAttempt(attempt)) return null
    if (sudoExists) {
      this.logger.info(
        `使用sudo切换到默认用户启动终端: ${attempt.selectedUser}，` +
        `工作目录: ${attempt.workingDirectory}`
      )
      return [
        'sudo',
        ...(preservedEnvironmentNames.length > 0
          ? [`--preserve-env=${preservedEnvironmentNames.join(',')}`]
          : []),
        '-u', attempt.selectedUser,
        'env',
        ...shellLocaleEnvArgs,
        '/bin/bash', '-c',
        `cd "${attempt.workingDirectory}" && exec /bin/bash --login`
      ]
    }

    const suExists = await this.checkCommandExists('su')
    if (!this.isActiveAttempt(attempt)) return null
    if (suExists) {
      this.logger.info(
        `使用su切换到默认用户启动终端: ${attempt.selectedUser}，` +
        `工作目录: ${attempt.workingDirectory}`
      )
      return [
        'su',
        ...(preservedEnvironmentNames.length > 0 ? ['-m'] : []),
        attempt.selectedUser, '-c',
        `${shellLocaleExport}; ` +
        `cd "${attempt.workingDirectory}" && exec /bin/bash --login`
      ]
    }

    this.logger.warn(
      `系统中既没有sudo也没有su命令，无法切换到用户 ` +
      `'${attempt.selectedUser}'，使用当前用户`
    )
    return ['/bin/bash', '--login']
  }

  private async launchAttemptProcess(
    attempt: CreateAttempt,
    command: string[],
    processLabel: string
  ): Promise<PtyProcessLaunch | null> {
    if (!this.isActiveAttempt(attempt)) return null

    const control = await this.createControlChannel({
      sessionId: attempt.id,
      logger: this.logger
    })
    if (!this.isActiveAttempt(attempt)) {
      await this.closeControlQuietly(attempt.id, control)
      return null
    }

    attempt.control = control
    attempt.endpoint = control.endpoint
    attempt.controlClosePromise = undefined
    attempt.finalizationPromise = undefined
    attempt.closeContext = undefined
    attempt.processExited = false
    attempt.processExitCode = undefined
    attempt.processExitSignal = undefined
    attempt.processError = undefined

    const args = [
      '-dir', attempt.workingDirectory,
      '-size', `${attempt.createSize.cols},${attempt.createSize.rows}`,
      '-coder', 'UTF-8',
      '-fifo', control.endpoint,
      '-cmd', JSON.stringify(command)
    ]
    const startedAt = Date.now()

    this.logger.info(
      `启动${processLabel}: sessionId=${attempt.id}, ` +
      `cwd=${attempt.workingDirectory}, ` +
      `size=${attempt.createSize.cols}x${attempt.createSize.rows}`
    )
    let ptyProcess: ChildProcess
    try {
      ptyProcess = this.spawnPty(this.ptyPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: attempt.workingDirectory,
        env: attempt.terminalEnv,
        detached: os.platform() !== 'win32'
      })
    } catch (error) {
      attempt.processExited = true
      await this.closeControlQuietly(attempt.id, control)
      if (this.isActiveAttempt(attempt) && attempt.control === control) {
        await this.removeEndpointQuietly(attempt.id, control.endpoint)
      }
      if (this.isActiveAttempt(attempt) && attempt.control === control) {
        attempt.control = undefined
        attempt.endpoint = undefined
      }
      throw error
    }

    if (!this.isActiveAttempt(attempt)) {
      try {
        ptyProcess.kill('SIGTERM')
      } catch (error) {
        this.logger.warn(`取消创建时终止PTY进程失败: ${attempt.id}`, error)
      }
      await this.closeControlQuietly(attempt.id, control)
      return null
    }

    attempt.process = ptyProcess
    const outcome = this.registerPtyProcessHandlers(
      attempt.id,
      ptyProcess,
      startedAt
    )
    this.logger.info(`${processLabel}已启动，PID: ${ptyProcess.pid}`)

    if (os.platform() !== 'win32' && ptyProcess.pid) {
      try {
        process.kill(-ptyProcess.pid, 0)
        this.logger.info(`PTY进程组设置成功: ${ptyProcess.pid}`)
      } catch (error) {
        this.logger.warn(`设置PTY进程组失败: ${error}`)
      }
    }

    return {
      process: ptyProcess,
      control,
      endpoint: control.endpoint,
      outcome
    }
  }

  private observeControlReadiness(control: PtyControlChannel): Promise<{
    ready: boolean
    error?: unknown
  }> {
    return control.waitUntilReady(3000).then(
      () => ({ ready: true }),
      error => ({ ready: false, error })
    )
  }

  private async establishPrimaryAttempt(
    attempt: CreateAttempt,
    launch: PtyProcessLaunch
  ): Promise<void> {
    const readiness = this.observeControlReadiness(launch.control)
    const stability = await Promise.race([
      launch.outcome.then(outcome => ({ stable: false as const, outcome })),
      new Promise<{ stable: true }>(resolve => {
        setTimeout(() => resolve({ stable: true }), 1000)
      })
    ])
    if (!this.isActiveAttempt(attempt)) return

    if ('outcome' in stability) {
      const outcome = stability.outcome
      if (this.shouldFallback(attempt, outcome)) {
        await this.retireExitedLaunch(attempt, launch)
        if (!this.isActiveAttempt(attempt)) return

        attempt.phase = 'fallback'
        this.logger.info(`尝试使用当前用户重新启动终端: ${attempt.id}`)
        const fallback = await this.launchAttemptProcess(
          attempt,
          ['/bin/bash', '--login'],
          'PTY回退进程'
        )
        if (!this.isActiveAttempt(attempt) || !fallback) return
        await this.establishFallbackAttempt(attempt, fallback)
        return
      }

      await this.failCreateAttempt(
        attempt,
        this.describeStartupOutcome(outcome)
      )
      return
    }

    const readinessResult = await readiness
    if (!this.isActiveAttempt(attempt)) return
    if (!readinessResult.ready) {
      await this.failCreateAttempt(
        attempt,
        this.describeReadinessError(readinessResult.error)
      )
      return
    }
    if (
      attempt.processError ||
      attempt.processExited ||
      attempt.process !== launch.process ||
      attempt.control !== launch.control
    ) {
      await this.failCreateAttempt(
        attempt,
        attempt.processError?.message || 'PTY进程在创建完成前退出'
      )
      return
    }

    await this.promoteAttempt(attempt, launch)
  }

  private async establishFallbackAttempt(
    attempt: CreateAttempt,
    launch: PtyProcessLaunch
  ): Promise<void> {
    const readiness = this.observeControlReadiness(launch.control)
    const result = await Promise.race([
      readiness.then(value => ({ kind: 'readiness' as const, value })),
      launch.outcome.then(value => ({ kind: 'outcome' as const, value }))
    ])
    if (!this.isActiveAttempt(attempt)) return

    if (result.kind === 'outcome') {
      await this.failCreateAttempt(
        attempt,
        this.describeStartupOutcome(result.value)
      )
      return
    }
    if (!result.value.ready) {
      await this.failCreateAttempt(
        attempt,
        this.describeReadinessError(result.value.error)
      )
      return
    }
    if (
      attempt.processError ||
      attempt.processExited ||
      attempt.process !== launch.process ||
      attempt.control !== launch.control
    ) {
      await this.failCreateAttempt(
        attempt,
        attempt.processError?.message || 'PTY回退进程在创建完成前退出'
      )
      return
    }

    await this.promoteAttempt(attempt, launch)
  }

  private shouldFallback(
    attempt: CreateAttempt,
    outcome: PtyProcessOutcome
  ): boolean {
    return attempt.runtimeOptions.command === undefined &&
      attempt.fallbackEligibleFromConfiguredDefault &&
      outcome.kind === 'close' &&
      outcome.code === 0 &&
      outcome.elapsedMs < 1000
  }

  private describeStartupOutcome(outcome: PtyProcessOutcome): string {
    if (outcome.kind === 'error') {
      return outcome.error?.message || 'PTY进程启动失败'
    }
    return `PTY进程在创建期间退出（退出码: ${outcome.code ?? 'null'}，` +
      `信号: ${outcome.signal ?? 'none'}）`
  }

  private describeReadinessError(error: unknown): string {
    if (error instanceof Error) {
      return `PTY控制通道未就绪: ${error.message}`
    }
    return 'PTY控制通道未就绪'
  }

  private async retireExitedLaunch(
    attempt: CreateAttempt,
    launch: PtyProcessLaunch
  ): Promise<void> {
    if (
      !this.isActiveAttempt(attempt) ||
      attempt.process !== launch.process ||
      !attempt.processExited
    ) {
      return
    }

    await this.closeControlQuietly(attempt.id, launch.control)
    if (!this.isActiveAttempt(attempt)) return

    await this.removeEndpointQuietly(attempt.id, launch.endpoint)
    if (!this.isActiveAttempt(attempt)) return
    if (attempt.process === launch.process) {
      attempt.process = undefined
    }
    if (attempt.control === launch.control) {
      attempt.control = undefined
      attempt.endpoint = undefined
    }
  }

  private runPersistenceOperation<T>(
    sessionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.persistenceOperations.get(sessionId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const barrier = result.then(() => undefined, () => undefined)
    this.persistenceOperations.set(sessionId, barrier)
    void barrier.then(() => {
      if (this.persistenceOperations.get(sessionId) === barrier) {
        this.persistenceOperations.delete(sessionId)
      }
    })
    return result
  }

  private hasReplacementPersistenceOwner(
    sessionId: string,
    owner: PtySession | CreateAttempt
  ): boolean {
    const currentSession = this.sessions.get(sessionId)
    if (
      currentSession &&
      currentSession !== owner &&
      currentSession.activePersistenceOwned
    ) {
      return true
    }
    const currentAttempt = this.createAttempts.get(sessionId)
    return Boolean(
      currentAttempt &&
      currentAttempt !== owner &&
      currentAttempt.activePersistenceOwned
    )
  }

  private async removePersistenceWithRetry(
    sessionId: string,
    owner: PtySession | CreateAttempt,
    maxAttempts = 2
  ): Promise<void> {
    let lastError: unknown
    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      try {
        await this.runPersistenceOperation(sessionId, async () => {
          if (this.hasReplacementPersistenceOwner(sessionId, owner)) {
            owner.activePersistenceOwned = false
            return
          }
          await this.sessionManager.removeSession(sessionId)
          owner.activePersistenceOwned = false
        })
        return
      } catch (error) {
        lastError = error
        if (attemptNumber < maxAttempts) {
          this.logger.warn(
            `删除PTY会话持久化失败，将重试: ${sessionId}`,
            error
          )
        }
      }
    }
    throw lastError
  }

  private async promoteAttempt(
    attempt: CreateAttempt,
    launch: PtyProcessLaunch
  ): Promise<void> {
    if (
      !this.isActiveAttempt(attempt) ||
      attempt.processError ||
      attempt.processExited ||
      attempt.process !== launch.process ||
      attempt.control !== launch.control
    ) {
      return
    }

    let promoted = false
    let rollbackRetry: Promise<void> | undefined
    await this.runPersistenceOperation(attempt.id, async () => {
      let activeSaved = false
      attempt.activePersistenceOwned = false
      try {
        await this.sessionManager.saveSession({
          id: attempt.id,
          name: attempt.name,
          workingDirectory: attempt.workingDirectory,
          createdAt: attempt.createdAt,
          lastActivity: attempt.lastActivity,
          isActive: true
        })
        activeSaved = true
        attempt.activePersistenceOwned = true
      } catch (error) {
        this.logger.error(`保存会话到配置文件失败: ${attempt.id}`, error)
      }

      const canPromote =
        this.isActiveAttempt(attempt) &&
        !attempt.processError &&
        !attempt.processExited &&
        attempt.process === launch.process &&
        attempt.control === launch.control
      if (!canPromote) {
        if (activeSaved) {
          if (this.hasReplacementPersistenceOwner(attempt.id, attempt)) {
            attempt.activePersistenceOwned = false
          } else {
            try {
              await this.sessionManager.removeSession(attempt.id)
              attempt.activePersistenceOwned = false
            } catch (error) {
              this.logger.error(`回滚未完成PTY会话失败: ${attempt.id}`, error)
              rollbackRetry = this.removePersistenceWithRetry(
                attempt.id,
                attempt,
                1
              )
            }
          }
        }
        return
      }

      const session: PtySession = {
        id: attempt.id,
        name: attempt.name,
        state: 'ready',
        size: {
          cols: attempt.createSize.cols,
          rows: attempt.createSize.rows
        },
        process: launch.process,
        control: launch.control,
        endpoint: launch.endpoint,
        socket: attempt.socket,
        workingDirectory: attempt.workingDirectory,
        createdAt: attempt.createdAt,
        lastActivity: attempt.lastActivity,
        outputBuffer: attempt.outputBuffer,
        streamForwardProcess: attempt.streamForwardProcess,
        streamForwardRestartGeneration: 0,
        enableStreamForward: attempt.enableStreamForward,
        programPath: attempt.programPath,
        autoCloseOnForwardExit: attempt.autoCloseOnForwardExit,
        fallbackRetried: attempt.phase === 'fallback',
        stdoutRedactor: attempt.stdoutRedactor,
        stderrRedactor: attempt.stderrRedactor,
        onOutput: attempt.onOutput,
        onExit: attempt.onExit,
        exitNotified: attempt.exitNotified,
        activePersistenceOwned: attempt.activePersistenceOwned,
        processExited: false,
        finalEventSent: false
      }

      this.sessions.set(attempt.id, session)
      attempt.activePersistenceOwned = false
      this.createAttempts.delete(attempt.id)
      session.socket.emit('pty-created', {
        sessionId: session.id,
        workingDirectory: session.workingDirectory
      })
      this.logger.info(`PTY会话创建成功: ${session.id}`)

      if (session.enableStreamForward && session.programPath) {
        this.startStreamForwardProcess(session, session.programPath)
      }

      setTimeout(() => {
        const current = this.sessions.get(session.id)
        if (
          current !== session ||
          current.state !== 'ready' ||
          current.process !== launch.process ||
          current.processExited
        ) {
          return
        }
        this.writePtyStdin(current, '\r')
      }, 500)
      promoted = true
    })

    if (rollbackRetry) {
      try {
        await rollbackRetry
      } catch (error) {
        this.logger.error(`重试回滚未完成PTY会话失败: ${attempt.id}`, error)
      }
    }

    if (
      !promoted &&
      this.isActiveAttempt(attempt) &&
      (attempt.processError || attempt.processExited)
    ) {
      await this.failCreateAttempt(
        attempt,
        attempt.processError?.message || 'PTY进程在创建完成前退出'
      )
    }
  }

  private registerPtyProcessHandlers(
    sessionId: string,
    ptyProcess: ChildProcess,
    startedAt: number
  ): Promise<PtyProcessOutcome> {
    this.installPtyStdinErrorHandler(sessionId, ptyProcess)
    let settled = false
    let resolveOutcome!: (outcome: PtyProcessOutcome) => void
    const outcome = new Promise<PtyProcessOutcome>(resolve => {
      resolveOutcome = resolve
    })
    const settleOutcome = (value: PtyProcessOutcome) => {
      if (settled) return
      settled = true
      resolveOutcome(value)
    }

    ptyProcess.stdout?.on('data', (data: Buffer) => {
      const owner = this.resolveProcessOwner(sessionId, ptyProcess)
      if (!owner || !this.canForwardPtyOutput(owner)) return
      this.emitPtyOutput(owner, owner.stdoutRedactor.write(data))
    })
    ptyProcess.stdout?.once('end', () => {
      const owner = this.resolveProcessOwner(sessionId, ptyProcess)
      if (!owner || !this.canForwardPtyOutput(owner)) return
      this.emitPtyOutput(owner, owner.stdoutRedactor.end())
    })
    ptyProcess.stderr?.on('data', (data: Buffer) => {
      const owner = this.resolveProcessOwner(sessionId, ptyProcess)
      if (!owner || !this.canForwardPtyOutput(owner)) return
      this.emitPtyOutput(owner, owner.stderrRedactor.write(data), true)
    })
    ptyProcess.stderr?.once('end', () => {
      const owner = this.resolveProcessOwner(sessionId, ptyProcess)
      if (!owner || !this.canForwardPtyOutput(owner)) return
      this.emitPtyOutput(owner, owner.stderrRedactor.end(), true)
    })

    const observeProcessExit = (
      code: number | null,
      signal: NodeJS.Signals | null
    ) => {
      const current = this.resolveProcessOwner(sessionId, ptyProcess)
      if (!current) return

      this.ensureCloseContext(current, {
        intentional: false,
        emitEvents: true,
        emitTimeoutError: false
      })
      const firstObservation = !current.processExited
      if (firstObservation) {
        current.processExited = true
        current.processExitCode = code
        current.processExitSignal = signal
        this.logger.info(
          `PTY进程退出: ${sessionId}, 退出码: ${code}, 信号: ${signal}`
        )
      }

      if ('phase' in current) {
        if (
          current.cancellation.cancelled ||
          current.phase === 'closing' ||
          current.phase === 'close-retained'
        ) {
          void this.finalizeConfirmedExit(current).catch(error => {
            this.logger.error(`清理已退出PTY创建尝试失败: ${sessionId}`, error)
          })
        }
        return
      }

      void this.finalizeConfirmedExit(current).catch(error => {
        this.logger.error(`清理已退出PTY会话失败: ${sessionId}`, error)
      })
    }

    const settleCloseOutcome = (
      code: number | null,
      signal: NodeJS.Signals | null
    ) => {
      settleOutcome({
        kind: 'close',
        code,
        signal,
        elapsedMs: Date.now() - startedAt
      })
      observeProcessExit(code, signal)
    }

    ptyProcess.once('exit', settleCloseOutcome)
    ptyProcess.once('close', settleCloseOutcome)

    ptyProcess.on('error', (error: Error) => {
      settleOutcome({
        kind: 'error',
        code: null,
        signal: null,
        error,
        elapsedMs: Date.now() - startedAt
      })
      const current = this.resolveProcessOwner(sessionId, ptyProcess)
      if (!current) return

      if (!('phase' in current)) {
        this.ensureCloseContext(current, {
          intentional: false,
          emitEvents: true,
          emitTimeoutError: false
        })
      }
      this.logger.error(`PTY进程错误 ${sessionId}:`, error)
      if ('phase' in current) {
        if (
          !current.cancellation.cancelled &&
          this.createAttempts.get(sessionId) === current
        ) {
          current.processError = error
        }
        return
      }
      this.handlePromotedSessionProcessError(
        sessionId,
        ptyProcess,
        error
      )
    })

    return outcome
  }

  private installPtyStdinErrorHandler(
    sessionId: string,
    ptyProcess: ChildProcess
  ): void {
    const stdin = ptyProcess.stdin
    if (!stdin) return
    if (!this.ptyStdinHandlers) {
      this.ptyStdinHandlers = new WeakSet<ChildProcess>()
    }
    if (this.ptyStdinHandlers.has(ptyProcess)) return

    this.ptyStdinHandlers.add(ptyProcess)
    stdin.on('error', (error: NodeJS.ErrnoException) => {
      this.handlePtyStdinError(sessionId, ptyProcess, error)
    })
  }

  private isExpectedClosingStdinError(error: NodeJS.ErrnoException): boolean {
    return error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED'
  }

  private handlePtyStdinError(
    sessionId: string,
    ptyProcess: ChildProcess,
    error: NodeJS.ErrnoException
  ): void {
    const owner = this.resolveProcessOwner(sessionId, ptyProcess)
    if (!owner) return

    const closing = owner.processExited || (
      this.isSessionTarget(owner)
        ? owner.state === 'closing'
        : owner.cancellation.cancelled ||
          owner.phase === 'closing' ||
          owner.phase === 'close-retained'
    )
    if (closing) {
      if (this.isExpectedClosingStdinError(error)) {
        this.logger.debug(`PTY进程stdin在关闭期间已不可写: ${sessionId}`)
      } else {
        this.logger.warn(`PTY进程stdin在关闭期间发生错误: ${sessionId}`, error)
      }
      return
    }

    if (!this.isSessionTarget(owner)) {
      if (owner.processError) return
      owner.processError = error
      void this.failCreateAttempt(owner, error.message || 'PTY进程stdin写入失败')
        .catch(closeError => {
          this.logger.error(`PTY创建期间stdin错误清理失败: ${sessionId}`, closeError)
        })
      return
    }

    if (owner.state !== 'ready' || owner.processErrorSent) {
      return
    }
    owner.processErrorSent = true
    owner.state = 'closing'
    this.logger.error(`PTY进程stdin写入失败: ${sessionId}`, error)
    this.emitTerminalError(
      owner.socket,
      sessionId,
      'input',
      error.message || 'PTY进程stdin写入失败'
    )
    void this.requestTargetClose(owner, {
      intentional: false,
      emitEvents: true,
      emitTimeoutError: false,
      notifyRetained: true
    }).catch(closeError => {
      this.logger.error(`PTY进程stdin错误后关闭失败: ${sessionId}`, closeError)
    })
  }

  private writePtyStdin(session: PtySession, data: string): boolean {
    if (
      this.sessions.get(session.id) !== session ||
      session.state !== 'ready' ||
      session.processExited
    ) {
      return false
    }

    const stdin = session.process.stdin
    if (
      !stdin ||
      stdin.destroyed ||
      stdin.writableEnded ||
      stdin.writable === false
    ) {
      this.handlePtyStdinError(
        session.id,
        session.process,
        Object.assign(new Error('PTY进程stdin不可用'), {
          code: 'ERR_STREAM_DESTROYED'
        })
      )
      return false
    }

    try {
      stdin.write(data)
      return true
    } catch (error) {
      this.handlePtyStdinError(
        session.id,
        session.process,
        error instanceof Error ? error : new Error(String(error))
      )
      return false
    }
  }

  private endPtyStdin(target: PtySession | CreateAttempt): void {
    if (!this.ownsTarget(target) || !target.process) return
    const stdin = target.process.stdin
    if (
      !stdin ||
      stdin.destroyed ||
      stdin.writableEnded ||
      stdin.writable === false
    ) {
      return
    }

    try {
      stdin.end()
    } catch (error) {
      this.handlePtyStdinError(
        target.id,
        target.process,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * 为输出流转发进程的 stdin 安装永久 'error' listener，与主 PTY stdin 一致。
   * 必须在任何 write/end 之前调用；异步 EPIPE 只能由 'error' 事件消费。
   */
  private installForwardStdinErrorHandler(
    session: PtySession,
    forwardProcess: ChildProcess
  ): void {
    const stdin = forwardProcess.stdin
    if (!stdin) return
    if (this.forwardStdinHandlers.has(forwardProcess)) return

    this.forwardStdinHandlers.add(forwardProcess)
    stdin.on('error', (error: NodeJS.ErrnoException) => {
      this.handleForwardStdinError(session, forwardProcess, error)
    })
  }

  /**
   * 归一化输出流转发进程 stdin 的错误：
   * 旧 child 迟到的 EPIPE/ERR_STREAM_DESTROYED 必须先做 identity 校验（与主 PTY
   * resolveProcessOwner 同等）：restart/internal-stop 后旧 child 的迟到错误不得关闭
   * 健康的新 child/session；确认是当前 child 后，closing/confirmed-exit 阶段的
   * EPIPE/ERR_STREAM_DESTROYED 视为预期关闭结果；ready 阶段真实写失败只报告一次
   * input error，并进入统一 bounded shutdown。
   */
  private handleForwardStdinError(
    session: PtySession,
    forwardProcess: ChildProcess,
    error: NodeJS.ErrnoException
  ): void {
    if (
      this.sessions.get(session.id) !== session ||
      session.streamForwardProcess !== forwardProcess
    ) {
      this.logger.debug(
        `忽略旧输出流转发进程stdin错误: ${session.id}（当前进程已替换或会话已移除）`
      )
      return
    }

    const closing =
      session.processExited ||
      session.state === 'closing' ||
      this.internallyStoppedForwardProcesses.has(forwardProcess)
    if (closing) {
      if (this.isExpectedClosingStdinError(error)) {
        this.logger.debug(`输出流转发进程stdin在关闭期间已不可写: ${session.id}`)
      } else {
        this.logger.warn(
          `输出流转发进程stdin在关闭期间发生错误: ${session.id}`,
          error
        )
      }
      return
    }

    if (session.state !== 'ready' || session.processErrorSent) {
      return
    }
    session.processErrorSent = true
    session.state = 'closing'
    this.logger.error(`输出流转发进程stdin写入失败: ${session.id}`, error)
    this.emitTerminalError(
      session.socket,
      session.id,
      'input',
      error.message || '输出流转发进程stdin写入失败'
    )
    void this.requestTargetClose(session, {
      intentional: false,
      emitEvents: true,
      emitTimeoutError: false,
      notifyRetained: true
    }).catch(closeError => {
      this.logger.error(
        `输出流转发进程stdin错误后关闭失败: ${session.id}`,
        closeError
      )
    })
  }

  private writeForwardStdin(session: PtySession, data: string): boolean {
    if (
      this.sessions.get(session.id) !== session ||
      session.state !== 'ready' ||
      session.processExited
    ) {
      return false
    }

    const forwardProcess = session.streamForwardProcess
    if (!forwardProcess || forwardProcess.killed) {
      return false
    }
    const stdin = forwardProcess.stdin
    if (
      !stdin ||
      stdin.destroyed ||
      stdin.writableEnded ||
      stdin.writable === false
    ) {
      this.handleForwardStdinError(
        session,
        forwardProcess,
        Object.assign(new Error('输出流转发进程stdin不可用'), {
          code: 'ERR_STREAM_DESTROYED'
        })
      )
      return false
    }

    try {
      stdin.write(data)
      return true
    } catch (error) {
      this.handleForwardStdinError(
        session,
        forwardProcess,
        error instanceof Error ? error : new Error(String(error))
      )
      return false
    }
  }

  private endForwardStdin(
    session: PtySession,
    forwardProcess: ChildProcess
  ): void {
    const stdin = forwardProcess.stdin
    if (
      !stdin ||
      stdin.destroyed ||
      stdin.writableEnded ||
      stdin.writable === false
    ) {
      return
    }

    try {
      stdin.end()
    } catch (error) {
      this.handleForwardStdinError(
        session,
        forwardProcess,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  private resolveProcessOwner(
    sessionId: string,
    ptyProcess: ChildProcess
  ): PtySession | CreateAttempt | undefined {
    const session = this.sessions.get(sessionId)
    if (session?.process === ptyProcess) {
      return session
    }
    const attempt = this.createAttempts.get(sessionId)
    if (attempt?.process === ptyProcess) {
      return attempt
    }
    return undefined
  }

  private canForwardPtyOutput(owner: PtySession | CreateAttempt): boolean {
    if ('phase' in owner) {
      return !owner.cancellation.cancelled &&
        this.createAttempts.get(owner.id) === owner
    }
    return this.sessions.get(owner.id) === owner
  }

  private emitPtyOutput(
    owner: PtySession | CreateAttempt,
    output: string,
    isError = false
  ): void {
    if (!output) return
    if ('phase' in owner) {
      if (
        owner.cancellation.cancelled ||
        this.createAttempts.get(owner.id) !== owner
      ) {
        return
      }
    } else if (this.sessions.get(owner.id) !== owner) {
      return
    }
    owner.lastActivity = new Date()
    owner.outputBuffer.push(output)
    if (owner.outputBuffer.length > 1000) {
      owner.outputBuffer.shift()
    }
    try {
      owner.onOutput?.(output)
    } catch (error) {
      this.logger.warn(`PTY输出回调执行失败: ${owner.id}`, error)
    }
    if (isError) {
      this.logger.warn(`PTY错误输出 ${owner.id}: ${JSON.stringify(output)}`)
    } else {
      this.logger.debug(`PTY输出 ${owner.id}: ${JSON.stringify(output)}`)
    }
    owner.socket.emit('terminal-output', { sessionId: owner.id, data: output })
  }

  private handlePromotedSessionProcessError(
    sessionId: string,
    ptyProcess: ChildProcess,
    error: Error
  ): void {
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      session.process !== ptyProcess ||
      session.processErrorSent
    ) {
      return
    }

    session.processErrorSent = true
    session.state = 'closing'
    this.emitTerminalError(session.socket, sessionId, 'input', error.message)
    void this.requestTargetClose(session, {
      intentional: false,
      emitEvents: true,
      emitTimeoutError: false,
      notifyRetained: true
    }).catch(closeError => {
      this.logger.error(`PTY进程错误后关闭失败: ${sessionId}`, closeError)
    })
  }

  private cancelStreamForwardRestart(session: PtySession): void {
    session.streamForwardRestartGeneration += 1
  }

  private async stopSessionStreamForward(
    session: PtySession,
    logMessage: string
  ): Promise<boolean> {
    this.cancelStreamForwardRestart(session)
    const forwardProcess = session.streamForwardProcess
    if (!forwardProcess) {
      return true
    }

    this.internallyStoppedForwardProcesses.add(forwardProcess)
    if (session.pendingForwardAutoCloseProcess === forwardProcess) {
      session.pendingForwardAutoCloseProcess = undefined
    }
    this.logger.info(`${logMessage}: ${session.id}`)
    this.endForwardStdin(session, forwardProcess)

    const exited = await this.forceKillProcess(forwardProcess, '输出流转发进程')
    if (exited && session.streamForwardProcess === forwardProcess) {
      session.streamForwardProcess = undefined
    }
    return exited
  }

  private removeSessionPersistence(session: PtySession): Promise<void> {
    if (session.persistenceRemoval) {
      return session.persistenceRemoval
    }

    const removal = this.removePersistenceWithRetry(session.id, session)
    session.persistenceRemoval = removal
    void removal.catch(() => {
      if (session.persistenceRemoval === removal) {
        session.persistenceRemoval = undefined
      }
    })
    return removal
  }

  private createDeferred<T>(): {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  } {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }

  private ensureCloseContext(
    target: PtySession | CreateAttempt,
    requested: CloseContext
  ): CloseContext {
    if (target.closeContext) {
      return target.closeContext
    }

    const context = Object.freeze({
      intentional: requested.intentional,
      emitEvents: requested.emitEvents,
      emitTimeoutError: requested.emitTimeoutError
    })
    target.closeContext = context
    return context
  }

  private isSessionTarget(
    target: PtySession | CreateAttempt
  ): target is PtySession {
    return 'state' in target
  }

  private ownsTarget(target: PtySession | CreateAttempt): boolean {
    if (this.isSessionTarget(target)) {
      return this.sessions.get(target.id) === target
    }
    return this.createAttempts.get(target.id) === target
  }

  private closeTargetControl(
    target: PtySession | CreateAttempt
  ): Promise<void> {
    if (target.controlClosePromise) {
      return target.controlClosePromise
    }

    const deferred = this.createDeferred<void>()
    target.controlClosePromise = deferred.promise
    const control = target.control
    if (!control) {
      deferred.resolve()
      return deferred.promise
    }

    void this.closeControlQuietly(target.id, control).then(
      deferred.resolve,
      deferred.reject
    )
    return deferred.promise
  }

  private finalizeConfirmedExit(
    target: PtySession | CreateAttempt
  ): Promise<CloseResult> {
    if (!target.processExited) {
      return Promise.resolve('still-running')
    }
    if (target.finalizationPromise) {
      return target.finalizationPromise
    }

    this.ensureCloseContext(target, {
      intentional: false,
      emitEvents: true,
      emitTimeoutError: false
    })
    const deferred = this.createDeferred<CloseResult>()
    target.finalizationPromise = deferred.promise
    void this.finishConfirmedExit(target).then(
      result => {
        if (
          result === 'still-running' &&
          target.finalizationPromise === deferred.promise
        ) {
          target.finalizationPromise = undefined
        }
        deferred.resolve(result)
      },
      error => {
        if (target.finalizationPromise === deferred.promise) {
          target.finalizationPromise = undefined
        }
        deferred.reject(error)
      }
    )
    return deferred.promise
  }

  private async finishConfirmedExit(
    target: PtySession | CreateAttempt
  ): Promise<CloseResult> {
    if (!target.processExited) {
      return 'still-running'
    }

    let forwardExited = true
    try {
      forwardExited = this.isSessionTarget(target)
        ? await this.stopSessionStreamForward(target, 'PTY退出时清理输出流转发进程')
        : await this.stopAttemptStreamForward(target)
    } catch (error) {
      forwardExited = false
      this.logger.warn(`PTY退出时清理输出流转发进程失败: ${target.id}`, error)
    }
    if (!forwardExited) {
      this.retainTargetAfterCloseTimeout(target)
      return 'still-running'
    }

    const ownedBeforeCleanup = this.ownsTarget(target)
    await this.closeTargetControl(target)
    if (!target.processExited) {
      return 'still-running'
    }

    const stillOwned = this.ownsTarget(target)
    if (stillOwned) {
      if (this.isSessionTarget(target)) {
        this.sessions.delete(target.id)
      } else {
        this.createAttempts.delete(target.id)
      }
    }
    if (ownedBeforeCleanup && stillOwned) {
      this.emitTargetFinalEvent(target)
      this.notifyTargetExitCallback(target)
    }

    try {
      if (target.activePersistenceOwned) {
        if (this.isSessionTarget(target)) {
          await this.removeSessionPersistence(target)
        } else {
          await this.removePersistenceWithRetry(target.id, target)
        }
      }
    } catch (error) {
      this.logger.error(`PTY退出时从配置文件删除会话失败: ${target.id}`, error)
    }

    if (target.endpoint) {
      await this.removeEndpointQuietly(target.id, target.endpoint)
    }
    return 'closed'
  }

  private registerPublicCloseRequester(
    target: PtySession | CreateAttempt,
    socket: Socket
  ): void {
    if (!target.publicCloseRequesters) {
      target.publicCloseRequesters = new Map()
    }
    if (!target.publicCloseAckedIds) {
      target.publicCloseAckedIds = new Set()
    }
    if (target.publicCloseAckedIds.has(socket.id)) {
      return
    }
    target.publicCloseRequesters.set(socket.id, socket)
  }

  private markTargetSocketAcked(
    target: PtySession | CreateAttempt,
    socket: Socket
  ): void {
    if (!target.publicCloseAckedIds) {
      target.publicCloseAckedIds = new Set()
    }
    target.publicCloseAckedIds.add(socket.id)
    target.publicCloseRequesters?.delete(socket.id)
  }

  /**
   * 每个 public requester 在 confirmed removal 后恰好收到一次 pty-closed；
   * requester 覆盖/重置不会让早期 requester 丢 ACK，final events 不会重复。
   */
  private emitPublicCloseAck(target: PtySession | CreateAttempt): void {
    const requesters = target.publicCloseRequesters
    if (!requesters || requesters.size === 0) {
      return
    }
    if (!target.publicCloseAckedIds) {
      target.publicCloseAckedIds = new Set()
    }

    for (const [socketId, requester] of [...requesters.entries()]) {
      requesters.delete(socketId)
      target.publicCloseAckedIds.add(socketId)
      requester.emit('pty-closed', { sessionId: target.id })
    }
  }

  private notifyTargetExitCallback(target: PtySession | CreateAttempt): void {
    if (!target.process || target.exitNotified) {
      return
    }

    target.exitNotified = true
    try {
      target.onExit?.(
        target.processExitCode ?? 0,
        target.processExitSignal ?? null
      )
    } catch (error) {
      this.logger.warn(`PTY退出回调执行失败: ${target.id}`, error)
    }
  }

  private emitTargetFinalEvent(target: PtySession | CreateAttempt): void {
    const context = this.ensureCloseContext(target, {
      intentional: false,
      emitEvents: true,
      emitTimeoutError: false
    })

    if (!target.finalEventSent && context.emitEvents) {
      if (!this.isSessionTarget(target)) {
        if (context.intentional) {
          target.finalEventSent = true
          target.socket.emit('pty-closed', { sessionId: target.id })
          this.markTargetSocketAcked(target, target.socket)
        }
      } else {
        target.finalEventSent = true
        if (context.intentional) {
          target.socket.emit('pty-closed', { sessionId: target.id })
          this.markTargetSocketAcked(target, target.socket)
        } else {
          target.socket.emit('terminal-exit', {
            sessionId: target.id,
            code: target.processExitCode ?? 0,
            signal: target.processExitSignal ?? null
          })
        }
      }
    }

    this.emitPublicCloseAck(target)
  }

  private async failCreateAttempt(
    attempt: CreateAttempt,
    error: string
  ): Promise<void> {
    if (!this.isActiveAttempt(attempt)) return

    attempt.failureMessage = error
    attempt.finalEventSent = true
    this.emitTerminalError(attempt.socket, attempt.id, 'create', error)
    await this.requestTargetClose(attempt, {
      intentional: false,
      emitEvents: false,
      emitTimeoutError: false,
      notifyRetained: true
    })
  }

  private async closeControlQuietly(
    sessionId: string,
    control: PtyControlChannel
  ): Promise<void> {
    try {
      await control.close()
    } catch (error) {
      this.logger.warn(`关闭PTY控制通道失败: ${sessionId}`, error)
    }
  }

  private async removeEndpointQuietly(
    sessionId: string,
    endpoint: string
  ): Promise<void> {
    try {
      await removePtyControlEndpoint(endpoint)
    } catch (error) {
      this.logger.warn(`删除PTY控制端点失败: ${sessionId}`, error)
    }
  }

  private emitTerminalError(
    socket: Socket,
    sessionId: string,
    operation: 'create' | 'input' | 'resize' | 'close',
    error: string,
    details: { retained?: boolean } = {}
  ): void {
    socket.emit('terminal-error', { sessionId, operation, error, ...details })
  }

  private hasChildProcessExited(child: ChildProcess): boolean {
    if (child.exitCode !== null && child.exitCode !== undefined) {
      return true
    }
    if (child.signalCode !== null && child.signalCode !== undefined) {
      return true
    }

    const pid = child.pid
    if (!pid) {
      return false
    }
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }

  private waitForChildProcessExit(
    child: ChildProcess,
    timeoutMs: number
  ): Promise<boolean> {
    if (this.hasChildProcessExited(child)) {
      return Promise.resolve(true)
    }

    return new Promise(resolve => {
      let settled = false
      let timer: NodeJS.Timeout
      const finish = (exited: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.removeListener('exit', onExit)
        child.removeListener('close', onExit)
        resolve(exited)
      }
      const onExit = () => finish(true)

      child.once('exit', onExit)
      child.once('close', onExit)
      timer = setTimeout(() => finish(this.hasChildProcessExited(child)), timeoutMs)
      timer.unref?.()
      if (this.hasChildProcessExited(child)) {
        finish(true)
      }
    })
  }

  private sendChildProcessSignal(
    child: ChildProcess,
    processName: string,
    signal: NodeJS.Signals
  ): void {
    const pid = child.pid
    if (os.platform() !== 'win32' && pid) {
      try {
        process.kill(-pid, signal)
        this.logger.info(`已向${processName}进程组发送${signal}信号: -${pid}`)
        return
      } catch (error) {
        this.logger.warn(`向${processName}进程组发送${signal}失败，尝试主进程: ${error}`)
      }
    }

    try {
      child.kill(signal)
      this.logger.info(`已向${processName}发送${signal}信号: ${pid}`)
    } catch (error) {
      this.logger.warn(`向${processName}发送${signal}信号失败:`, error)
    }
  }

  /**
   * 逐级终止进程，并且只在 exit/close 或 PID 不存在时确认退出。
   */
  private async forceKillProcess(
    child: ChildProcess | undefined,
    processName: string,
    onKilled?: () => void
  ): Promise<boolean> {
    if (!child) {
      onKilled?.()
      return true
    }

    const complete = () => {
      this.logger.info(`${processName}已确认退出: ${child.pid}`)
      try {
        onKilled?.()
      } catch (error) {
        this.logger.warn(`${processName}退出回调执行失败:`, error)
      }
      return true
    }
    if (this.hasChildProcessExited(child)) {
      return complete()
    }

    const pid = child.pid
    this.logger.info(`开始终止${processName}，PID: ${pid}`)
    this.sendChildProcessSignal(child, processName, 'SIGINT')
    if (await this.waitForChildProcessExit(child, 2000)) {
      return complete()
    }

    this.logger.warn(`${processName}未响应SIGINT，尝试SIGTERM: ${pid}`)
    this.sendChildProcessSignal(child, processName, 'SIGTERM')
    if (await this.waitForChildProcessExit(child, 2000)) {
      return complete()
    }

    this.logger.warn(`${processName}未响应SIGTERM，尝试SIGKILL: ${pid}`)
    this.sendChildProcessSignal(child, processName, 'SIGKILL')
    if (await this.waitForChildProcessExit(child, 1000)) {
      return complete()
    }

    if (os.platform() === 'win32' && pid) {
      try {
        await execAsync(`taskkill /F /T /PID ${pid}`, { timeout: 3000 })
      } catch (error) {
        this.logger.warn(`taskkill终止${processName}失败:`, error)
      }
      if (await this.waitForChildProcessExit(child, 1000)) {
        return complete()
      }
    }

    this.logger.error(`${processName}在终止期限内仍未确认退出: ${pid}`)
    return false
  }

  /**
   * 重启输出流转发进程
   */
  public async restartStreamForwardProcess(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      session.state !== 'ready' ||
      !session.enableStreamForward ||
      !session.programPath
    ) {
      this.logger.warn(`无法重启转发进程: 会话不存在或未启用输出流转发: ${sessionId}`)
      return false
    }

    const programPath = session.programPath
    const restartGeneration = session.streamForwardRestartGeneration + 1
    session.streamForwardRestartGeneration = restartGeneration

    const forwardProcess = session.streamForwardProcess
    if (forwardProcess) {
      this.internallyStoppedForwardProcesses.add(forwardProcess)
      if (session.pendingForwardAutoCloseProcess === forwardProcess) {
        session.pendingForwardAutoCloseProcess = undefined
      }
      const exited = await this.forceKillProcess(forwardProcess, '输出流转发进程')
      if (!exited) {
        return false
      }
      if (
        this.sessions.get(sessionId) !== session ||
        session.state !== 'ready' ||
        session.streamForwardRestartGeneration !== restartGeneration ||
        (session.streamForwardProcess &&
          session.streamForwardProcess !== forwardProcess)
      ) {
        return false
      }
      if (session.streamForwardProcess === forwardProcess) {
        session.streamForwardProcess = undefined
      }
    }

    this.startStreamForwardProcess(session, programPath)
    return true
  }

  /**
   * 启动输出流转发进程
   */
  private startStreamForwardProcess(session: PtySession, programPath: string): void {
    this.cancelStreamForwardRestart(session)
    try {
      this.logger.info(`启动输出流转发进程: ${programPath}`)
      
      // 解析程序路径和参数
      // 支持带引号的路径，例如: "C:\\Program Files\\MyApp\\app.exe" arg1 arg2
      const commandLine = programPath.trim()
      let executablePath: string
      let args: string[]
      
      if (commandLine.startsWith('"')) {
        // 处理带引号的可执行文件路径
        const endQuoteIndex = commandLine.indexOf('"', 1)
        if (endQuoteIndex === -1) {
          throw new Error('未找到匹配的引号')
        }
        executablePath = commandLine.substring(1, endQuoteIndex)
        const remainingArgs = commandLine.substring(endQuoteIndex + 1).trim()
        args = remainingArgs ? remainingArgs.split(/\s+/) : []
      } else {
        // 处理不带引号的路径
        const parts = commandLine.split(/\s+/)
        executablePath = parts[0]
        args = parts.slice(1)
      }
      
      this.logger.info(`可执行文件路径: ${executablePath}`)
      this.logger.info(`参数列表: ${JSON.stringify(args)}`)
      
      // 启动目标程序进程
      // 在Windows上使用PTY包装，避免stdout块缓冲导致输出不实时
      let forwardProcess: ChildProcess
      if (os.platform() === 'win32' && this.ptyPath) {
        const ptyArgs = [
          '-dir', session.workingDirectory,
          '-size', '100,30',
          '-coder', 'UTF-8',
          '-cmd', JSON.stringify([executablePath, ...args])
        ]
        this.logger.info(`使用PTY包装转发进程以避免stdout缓冲: ${this.ptyPath}`)
        forwardProcess = spawn(this.ptyPath, ptyArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: session.workingDirectory,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor'
          }
        })
      } else {
        forwardProcess = spawn(executablePath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: session.workingDirectory,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor'
          },
          detached: os.platform() !== 'win32' // 在非Windows平台创建独立进程组
        })
      }
      
      session.pendingForwardAutoCloseProcess = undefined
      session.streamForwardProcess = forwardProcess
      // 永久 stdin error listener：任何 write/end 之前安装，防止异步 EPIPE 逃逸为 uncaughtException
      this.installForwardStdinErrorHandler(session, forwardProcess)
      
      this.logger.info(`输出流转发进程已启动，PID: ${forwardProcess.pid}`)
      
      // 添加进程启动成功通知
      let startupMessage = `\r\n[输出流转发进程已启动，PID: ${forwardProcess.pid}]\r\n`
      startupMessage += `[程序路径: ${executablePath}]\r\n`
      if (session.autoCloseOnForwardExit) {
        startupMessage += `[注意: 转发进程异常退出时将自动关闭终端会话]\r\n`
      }
      startupMessage += `[可用命令: restart-forward (重启转发进程), session-status (查看状态)]\r\n`
      
      session.socket.emit('terminal-output', {
        sessionId: session.id,
        data: startupMessage
      })
      
      // 处理转发进程的输出，将其转发到终端
      forwardProcess.stdout?.on('data', (data: Buffer) => {
        session.lastActivity = new Date()
        const output = data.toString()
        
        // 保存到输出缓存
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift()
        }
        
        this.logger.debug(`转发进程输出 ${session.id}: ${JSON.stringify(output)}`)
        session.socket.emit('terminal-output', {
          sessionId: session.id,
          data: output
        })
      })
      
      // 处理转发进程的错误输出
      forwardProcess.stderr?.on('data', (data: Buffer) => {
        session.lastActivity = new Date()
        const output = data.toString()
        
        // 保存到输出缓存
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift()
        }
        
        this.logger.warn(`转发进程错误输出 ${session.id}: ${JSON.stringify(output)}`)
        session.socket.emit('terminal-output', {
          sessionId: session.id,
          data: output
        })
      })
      
      // 处理转发进程退出
      forwardProcess.on('exit', (code, signal) => {
        if (this.internallyStoppedForwardProcesses.delete(forwardProcess)) {
          if (session.streamForwardProcess === forwardProcess) {
            session.streamForwardProcess = undefined
          }
          if (session.pendingForwardAutoCloseProcess === forwardProcess) {
            session.pendingForwardAutoCloseProcess = undefined
          }
          // 首次 forward shutdown 返回 false（retained）时，后续 child exit 必须
          // 重新触发 finalizeConfirmedExit，不能只清引用：PTY 进程已退出后，
          // target/map/endpoint/persistence 不应继续 retained。
          if (
            this.sessions.get(session.id) === session &&
            session.processExited
          ) {
            void this.finalizeConfirmedExit(session).catch(error => {
              this.logger.error(`清理已退出PTY会话失败: ${session.id}`, error)
            })
          }
          return
        }
        if (
          session.streamForwardProcess &&
          session.streamForwardProcess !== forwardProcess
        ) {
          return
        }

        this.logger.info(`转发进程退出: ${session.id}, 退出码: ${code}, 信号: ${signal}`)
        
        let exitMessage: string
        if (signal) {
          // 被信号终止
          exitMessage = `\r\n[转发进程被信号终止: ${signal}]\r\n`
        } else if (code === null) {
          // 异常退出，没有退出码
          exitMessage = `\r\n[转发进程异常退出]\r\n`
        } else if (code === 0) {
          // 正常退出
          exitMessage = `\r\n[转发进程正常退出]\r\n`
        } else {
          // 错误退出
          exitMessage = `\r\n[转发进程退出，错误码: ${code}]\r\n`
        }
        
        session.socket.emit('terminal-output', {
          sessionId: session.id,
          data: exitMessage
        })

        if (session.streamForwardProcess === forwardProcess) {
          session.streamForwardProcess = undefined
        }

        // 如果配置了自动关闭，则在转发进程退出后关闭终端会话
        if (session.autoCloseOnForwardExit) {
          session.pendingForwardAutoCloseProcess = forwardProcess
          session.socket.emit('terminal-output', {
            sessionId: session.id,
            data: `\r\n[转发进程已退出，正在关闭终端会话...]\r\n`
          })

          // 延迟关闭，让用户看到消息
          setTimeout(() => {
            if (
              this.sessions.get(session.id) !== session ||
              session.pendingForwardAutoCloseProcess !== forwardProcess ||
              session.streamForwardProcess
            ) {
              return
            }
            session.pendingForwardAutoCloseProcess = undefined
            void this.closePty(session.socket, { sessionId: session.id })
              .catch(error => {
                this.logger.error(`转发进程退出后关闭PTY会话失败: ${session.id}`, error)
              })
          }, 2000)
        } else {
          // 如果是异常退出或错误退出，提供重启选项
          if (code !== 0 || signal) {
            session.socket.emit('terminal-output', {
              sessionId: session.id,
              data: `\r\n[提示: 输入 'restart-forward' 可重启转发进程]\r\n`
            })
          }
        }
      })
      
      // 处理转发进程错误
      forwardProcess.on('error', (error: NodeJS.ErrnoException) => {
        if (
          this.internallyStoppedForwardProcesses.has(forwardProcess) ||
          (session.streamForwardProcess &&
            session.streamForwardProcess !== forwardProcess)
        ) {
          return
        }
        this.logger.error(`转发进程错误 ${session.id}:`, error)
        
        let errorMessage: string
        if (error.code === 'ENOENT') {
          errorMessage = `\r\n[转发进程启动失败: 找不到可执行文件]\r\n`
        } else if (error.code === 'EACCES') {
          errorMessage = `\r\n[转发进程启动失败: 权限不足]\r\n`
        } else if (error.code === 'EMFILE' || error.code === 'ENFILE') {
          errorMessage = `\r\n[转发进程启动失败: 系统资源不足]\r\n`
        } else {
          errorMessage = `\r\n[转发进程错误: ${error.message}]\r\n`
        }
        
        session.socket.emit('terminal-output', {
          sessionId: session.id,
          data: errorMessage
        })
        if (session.streamForwardProcess === forwardProcess) {
          session.streamForwardProcess = undefined
        }
      })
      
      // 将终端输入转发到目标进程
      // 注意：这里我们不直接转发所有输入，而是让用户通过特殊命令来与转发进程交互
      
    } catch (error) {
      this.logger.error(`启动输出流转发进程失败:`, error)
      session.socket.emit('terminal-output', {
        sessionId: session.id,
        data: `\r\n[启动转发进程失败: ${error instanceof Error ? error.message : '未知错误'}]\r\n`
      })
    }
  }

  /**
   * 处理终端输入
   */
  public handleInput(socket: Socket, data: TerminalInputData): void {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : ''
    try {
      if (typeof data?.data !== 'string') {
        this.emitTerminalError(socket, sessionId, 'input', '终端输入无效')
        return
      }
      const inputData = data.data
      const session = this.sessions.get(sessionId)

      if (!session) {
        this.logger.warn(`会话不存在: ${sessionId}`)
        this.emitTerminalError(socket, sessionId, 'input', '会话不存在')
        return
      }
      if (session.state !== 'ready') {
        return
      }

      // 如果会话之前断开连接，现在重新连接
      // 仅当传入的是真实的Socket.IO socket时才替换（避免虚拟socket覆盖）
      if (session.disconnected && (socket as any).connected !== undefined) {
        session.disconnected = false
        session.disconnectedAt = undefined
        session.socket = socket
        this.logger.info(`会话 ${sessionId} 重新连接成功`)
      }

      // 更新最后活动时间
      session.lastActivity = new Date()
      
      // 检查是否为重启转发进程命令
      if (inputData.trim() === 'restart-forward') {
        if (session.enableStreamForward && session.programPath) {
          session.socket.emit('terminal-output', {
            sessionId: session.id,
            data: `\r\n[正在重启输出流转发进程...]\r\n`
          })
          
          void this.restartStreamForwardProcess(sessionId).then(
            success => {
              if (!success && this.sessions.get(sessionId) === session) {
                session.socket.emit('terminal-output', {
                  sessionId: session.id,
                  data: `\r\n[重启转发进程失败]\r\n`
                })
              }
            },
            error => {
              this.logger.error(`重启输出流转发进程失败: ${sessionId}`, error)
              if (this.sessions.get(sessionId) === session) {
                session.socket.emit('terminal-output', {
                  sessionId: session.id,
                  data: `\r\n[重启转发进程失败]\r\n`
                })
              }
            }
          )
        } else {
          session.socket.emit('terminal-output', {
            sessionId: session.id,
            data: `\r\n[当前会话未启用输出流转发]\r\n`
          })
        }
        return
      }
      
      // 检查是否为查看会话状态命令
      if (inputData.trim() === 'session-status') {
        const status = this.getSessionStatusInfo(session)
        session.socket.emit('terminal-output', {
          sessionId: session.id,
          data: status
        })
        return
      }
      
      // 检查是否为控制字符
      const controlChar = this.detectControlCharacter(inputData)
      if (controlChar) {
        this.logger.info(`检测到控制字符: ${controlChar.name} (${controlChar.code}) - ${sessionId}`)
        
        // 对于某些控制字符，直接传递给PTY而不发送信号
        if (controlChar.signal === 'EOF' || controlChar.signal === 'KILL_LINE' || controlChar.signal === 'CLEAR') {
          this.logger.info(`直接传递控制字符 ${controlChar.name} 到 PTY 进程: ${sessionId}`)
          this.writePtyStdin(session, inputData)
          return
        }
        
        // 如果有输出流转发进程，优先处理它
        if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
          // 捕获调用时刻的转发进程引用：异步 taskkill fallback 只作用于该进程，
          // restart 替换 child 后旧 taskkill 失败不得误杀健康的新 child。
          const targetForwardProcess = session.streamForwardProcess
          const pid = targetForwardProcess.pid
          this.logger.info(`向输出流转发进程(PID: ${pid})及其子进程发送${controlChar.name}信号...`)

          if (os.platform() === 'win32') {
            // Windows下的处理
            if (controlChar.signal === 'SIGINT') {
              // 使用 taskkill /T 来优雅地终止整个进程树（有界超时，避免 exec 挂起）
              void execAsync(`taskkill /PID ${pid} /T`, { timeout: 3000 }).then(
                () => {
                  this.logger.info(`成功通过 taskkill /T 向进程树 PID: ${pid} 发送关闭信号`)
                },
                (taskkillError) => {
                  this.logger.error(`使用 taskkill /T 终止进程树 PID: ${pid} 失败:`, taskkillError)
                  // 作为后备，尝试原来的方法（仅作用于调用时刻捕获的进程，做 identity 校验）
                  if (
                    this.sessions.get(session.id) === session &&
                    session.streamForwardProcess === targetForwardProcess
                  ) {
                    try {
                      targetForwardProcess.kill('SIGINT')
                    } catch (killError) {
                      this.logger.error(`后备的 kill SIGINT 信号也失败了:`, killError)
                    }
                  } else {
                    this.logger.debug(`输出流转发进程已替换，跳过后备 kill: ${session.id}`)
                  }
                }
              )
            } else {
              // 其他信号直接发送，但需要确保是有效的信号类型
              if (typeof controlChar.signal === 'string' && controlChar.signal.startsWith('SIG')) {
                try {
                  session.streamForwardProcess.kill(controlChar.signal as NodeJS.Signals)
                } catch (error) {
                  this.logger.error(`发送${controlChar.signal}信号失败:`, error)
                }
              } else {
                this.logger.warn(`Windows下不支持的信号类型: ${controlChar.signal}`)
              }
            }
          } else {
            // Linux/macOS下的处理
            if (typeof controlChar.signal === 'string' && controlChar.signal.startsWith('SIG')) {
              try {
                // 向整个进程组发送信号
                process.kill(-pid, controlChar.signal as NodeJS.Signals)
                this.logger.info(`成功向进程组 -${pid} 发送 ${controlChar.signal} 信号`)
              } catch (error) {
                this.logger.error(`向进程组 -${pid} 发送${controlChar.signal}失败，将只发送给主进程:`, error)
                try {
                  session.streamForwardProcess.kill(controlChar.signal as NodeJS.Signals)
                } catch (killError) {
                  this.logger.error(`向主进程发送${controlChar.signal}失败:`, killError)
                }
              }
            } else {
              this.logger.warn(`Linux/macOS下不支持的信号类型: ${controlChar.signal}`)
            }
          }
        } else {
          // 如果没有输出流转发进程，则将控制字符发送到PTY进程
          this.logger.info(`向 PTY 进程发送 ${controlChar.name}: ${sessionId}`)
          this.writePtyStdin(session, inputData)
        }
        return
      }

      // 发送输入到PTY进程
      this.writePtyStdin(session, inputData)
      
      // 如果启用了输出流转发，也将输入转发到目标进程
      if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
        this.writeForwardStdin(session, inputData)
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      this.logger.error(`处理终端输入失败:`, error)
      this.emitTerminalError(socket, sessionId, 'input', message)
    }
  }

  /**
   * 调整终端大小
   */
  public async resizeTerminal(
    socket: Socket,
    data: TerminalResizeData
  ): Promise<void> {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : ''
    let size: PtySize
    try {
      size = validatePtySize(data?.cols, data?.rows)
    } catch (error) {
      const message = error instanceof Error ? error.message : '终端大小无效'
      this.emitTerminalError(socket, sessionId, 'resize', message)
      return
    }

    const session = this.sessions.get(sessionId)
    if (!session || session.state !== 'ready') {
      return
    }

    const control = session.control
    try {
      const result = await control.enqueueResize(size)
      const current = this.sessions.get(sessionId)
      if (
        current !== session ||
        current.state !== 'ready' ||
        current.control !== control ||
        result !== 'written'
      ) {
        return
      }

      current.size = { cols: size.cols, rows: size.rows }
      current.lastActivity = new Date()
      socket.emit('terminal-resized', {
        sessionId,
        cols: size.cols,
        rows: size.rows
      })
    } catch (error) {
      const current = this.sessions.get(sessionId)
      if (
        current !== session ||
        current.state !== 'ready' ||
        current.control !== control
      ) {
        return
      }

      this.ensureCloseContext(session, {
        intentional: false,
        emitEvents: true,
        emitTimeoutError: false
      })
      this.logger.error(`调整终端大小失败: ${sessionId}`, error)
      this.emitTerminalError(
        socket,
        sessionId,
        'resize',
        'PTY 控制通道写入 resize 失败'
      )
      await this.terminateSession(session, { intentional: false })
    }
  }

  private async terminateSession(
    session: PtySession,
    options: { intentional: boolean }
  ): Promise<void> {
    if (this.sessions.get(session.id) !== session) {
      return
    }
    if (!options.intentional) {
      session.processErrorSent = true
    }

    await this.requestTargetClose(session, {
      intentional: options.intentional,
      emitEvents: true,
      emitTimeoutError: false,
      notifyRetained: !options.intentional
    })
  }

  private requestTargetClose(
    target: PtySession | CreateAttempt,
    options: CloseRequestOptions
  ): Promise<CloseResult> {
    if (options.publicRequester) {
      this.registerPublicCloseRequester(target, options.publicRequester)
    }
    if (options.notifyRetained) {
      target.notifyRetainedOnTimeout = true
      target.retainedTimeoutNotified = false
    }
    if (target.closePromise) {
      return target.closePromise
    }

    this.ensureCloseContext(target, options)
    if (this.isSessionTarget(target)) {
      target.state = 'closing'
    } else {
      target.cancellation.cancelled = true
      target.phase = 'closing'
    }

    const deferred = this.createDeferred<CloseResult>()
    target.closePromise = deferred.promise
    void this.closeTarget(target).then(
      result => {
        if (
          result === 'still-running' &&
          target.closePromise === deferred.promise
        ) {
          target.closePromise = undefined
        }
        deferred.resolve(result)
      },
      error => {
        if (target.closePromise === deferred.promise) {
          target.closePromise = undefined
        }
        deferred.reject(error)
      }
    )
    return deferred.promise
  }

  private async closeTarget(
    target: PtySession | CreateAttempt
  ): Promise<CloseResult> {
    await this.closeTargetControl(target)

    let forwardExited = true
    try {
      forwardExited = this.isSessionTarget(target)
        ? await this.stopSessionStreamForward(target, '终止输出流转发进程')
        : await this.stopAttemptStreamForward(target)
    } catch (error) {
      forwardExited = false
      this.logger.warn(`终止输出流转发进程失败: ${target.id}`, error)
    }

    const finalize = (): Promise<CloseResult> => {
      if (!forwardExited) {
        this.retainTargetAfterCloseTimeout(target)
        return Promise.resolve('still-running')
      }
      return this.finalizeConfirmedExit(target)
    }

    const ptyProcess = target.process
    if (!ptyProcess) {
      target.processExited = true
      target.processExitCode = 0
      target.processExitSignal = null
      return finalize()
    }

    this.endPtyStdin(target)

    if (!target.processExited) {
      try {
        ptyProcess.kill('SIGTERM')
      } catch (error) {
        this.logger.warn(`向PTY进程发送SIGTERM失败: ${target.id}`, error)
      }
    }
    if (await this.waitForTargetExit(target, 3000)) {
      return finalize()
    }

    this.logger.warn(`PTY进程未响应SIGTERM，发送SIGKILL: ${target.id}`)
    try {
      ptyProcess.kill('SIGKILL')
    } catch (error) {
      this.logger.warn(`向PTY进程发送SIGKILL失败: ${target.id}`, error)
    }
    if (await this.waitForTargetExit(target, 1000)) {
      return finalize()
    }

    this.retainTargetAfterCloseTimeout(target)
    return 'still-running'
  }

  private retainTargetAfterCloseTimeout(
    target: PtySession | CreateAttempt
  ): void {
    if (this.isSessionTarget(target)) {
      target.state = 'closing'
    } else {
      target.phase = 'close-retained'
    }

    const shouldNotify =
      target.notifyRetainedOnTimeout || target.closeContext?.emitTimeoutError
    if (!shouldNotify || target.retainedTimeoutNotified) {
      return
    }

    target.retainedTimeoutNotified = true
    target.notifyRetainedOnTimeout = false
    const requesters = target.publicCloseRequesters
    // N6-I2：retained 通知发给全部仍连接的 public close requester（handleDisconnect
    // 已移除断开 socket），而不是只通知最后一个——否则其余 requester 的客户端
    // ACK-owned 队列永久停在 awaitingCloseAck。一次性 flag 语义保持：每轮每个
    // requester 恰好一次（retainedTimeoutNotified）；requester 不在此处移出 Map，
    // confirmed removal 的 pty-closed ACK 仍由 emitPublicCloseAck 恰好一次发出。
    if (requesters && requesters.size > 0) {
      for (const requester of [...requesters.values()]) {
        this.emitTerminalError(
          requester,
          target.id,
          'close',
          'PTY进程未在关闭期限内退出，已保留会话以便重试',
          { retained: true }
        )
      }
    } else {
      this.emitTerminalError(
        target.socket,
        target.id,
        'close',
        'PTY进程未在关闭期限内退出，已保留会话以便重试',
        { retained: true }
      )
    }
  }

  private async stopAttemptStreamForward(attempt: CreateAttempt): Promise<boolean> {
    const forwardProcess = attempt.streamForwardProcess
    if (!forwardProcess) {
      return true
    }

    this.internallyStoppedForwardProcesses.add(forwardProcess)
    if (forwardProcess.stdin && !forwardProcess.stdin.destroyed) {
      try {
        forwardProcess.stdin.end()
      } catch (error) {
        this.logger.warn(`关闭创建尝试的输出流转发stdin失败: ${attempt.id}`, error)
      }
    }

    const exited = await this.forceKillProcess(
      forwardProcess,
      '创建尝试的输出流转发进程'
    )
    if (exited && attempt.streamForwardProcess === forwardProcess) {
      attempt.streamForwardProcess = undefined
    }
    return exited
  }

  private waitForTargetExit(
    target: PtySession | CreateAttempt,
    timeoutMs: number
  ): Promise<boolean> {
    if (target.processExited || !target.process) {
      return Promise.resolve(true)
    }

    const ptyProcess = target.process
    return new Promise(resolve => {
      let settled = false
      let timer: NodeJS.Timeout
      const finish = (exited: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ptyProcess.removeListener('exit', onExit)
        ptyProcess.removeListener('close', onExit)
        resolve(exited)
      }
      const onExit = (
        code: number | null,
        signal: NodeJS.Signals | null
      ) => {
        if (!target.processExited) {
          target.processExited = true
          target.processExitCode = code
          target.processExitSignal = signal
        }
        finish(true)
      }

      ptyProcess.once('exit', onExit)
      ptyProcess.once('close', onExit)
      timer = setTimeout(() => finish(target.processExited), timeoutMs)
      timer.unref?.()
      if (target.processExited) {
        finish(true)
      }
    })
  }

  /**
   * 关闭PTY会话或仍处于创建阶段的PTY目标。
   */
  public closePty(
    socket: Socket,
    data: { sessionId: string }
  ): Promise<CloseResult> {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : ''
    const target = this.sessions.get(sessionId) ?? this.createAttempts.get(sessionId)
    if (!target) {
      this.logger.warn(`尝试关闭不存在的会话: ${sessionId}`)
      socket.emit('pty-closed', { sessionId })
      return Promise.resolve('not-found')
    }

    target.socket = socket
    const closePromise = this.requestTargetClose(target, {
      intentional: true,
      emitEvents: true,
      emitTimeoutError: true,
      publicRequester: socket,
      notifyRetained: true
    })
    this.logger.info(`关闭PTY会话: ${sessionId}`)
    return closePromise
  }

  /**
   * 客户端断开时从所有目标的 publicCloseRequester 集合中移除该 socket：
   * 避免长期 retained target 累积对已断开 Socket 的强引用。
   */
  private removeDisconnectedPublicRequester(socket: Socket): void {
    for (const target of [...this.sessions.values(), ...this.createAttempts.values()]) {
      target.publicCloseRequesters?.delete(socket.id)
    }
  }

  /**
   * 处理客户端断开连接
   */
  public handleDisconnect(socket: Socket): void {
    try {
      this.removeDisconnectedPublicRequester(socket)
      let markedSessionCount = 0
      for (const session of this.sessions.values()) {
        if (session.socket.id !== socket.id) continue

        session.disconnected = true
        session.disconnectedAt = new Date()
        session.lastActivity = new Date()
        markedSessionCount += 1
        void this.sessionManager.setSessionActive(session.id, false).catch(error => {
          this.logger.error(`更新会话断开状态失败: ${session.id}`, error)
        })
        this.logger.info(`会话 ${session.id} 已标记为断开状态`)
      }

      for (const attempt of this.createAttempts.values()) {
        if (
          attempt.socket.id !== socket.id ||
          (attempt.phase !== 'starting' && attempt.phase !== 'fallback')
        ) {
          continue
        }

        const termination = this.requestTargetClose(attempt, {
          intentional: true,
          emitEvents: false,
          emitTimeoutError: false
        })
        void termination.then(
          result => {
            if (result === 'still-running') {
              this.logger.error(
                `客户端断开后PTY创建尝试仍在运行: ${attempt.id}`
              )
            }
          },
          error => {
            this.logger.error(`客户端断开后终止PTY创建尝试失败: ${attempt.id}`, error)
          }
        )
      }

      if (markedSessionCount > 0) {
        this.logger.info(
          `客户端断开连接，标记了 ${markedSessionCount} 个会话为断开状态`
        )
      }
    } catch (error) {
      this.logger.error(`处理客户端断开连接失败:`, error)
    }
  }

  /**
   * 清理不活跃的会话
   */
  private cleanupInactiveSessions(): void {
    try {
      const now = new Date()
      const inactiveThreshold = 30 * 60 * 1000 // 30分钟
      const disconnectedThreshold = 5 * 60 * 1000 // 断开连接5分钟后清理
      const sessionsToClose: string[] = []
      
      for (const [sessionId, session] of this.sessions.entries()) {
        const inactiveTime = now.getTime() - session.lastActivity.getTime()
        const disconnectedTime = session.disconnectedAt ? now.getTime() - session.disconnectedAt.getTime() : 0
        
        // 如果会话断开连接超过5分钟，或者不活跃超过30分钟，则清理
        if ((session.disconnected && disconnectedTime > disconnectedThreshold) || 
            (!session.disconnected && inactiveTime > inactiveThreshold)) {
          sessionsToClose.push(sessionId)
        }
      }
      
      for (const sessionId of sessionsToClose) {
        const session = this.sessions.get(sessionId)
        if (session) {
          this.logger.info(`清理会话: ${sessionId} (${session.disconnected ? '断开连接' : '不活跃'})`)
          void this.closePty(session.socket, { sessionId }).catch(error => {
            this.logger.error(`清理不活跃PTY会话失败: ${sessionId}`, error)
          })
        }
      }
      
    } catch (error) {
      this.logger.error(`清理不活跃会话失败:`, error)
    }
  }

  /**
   * 重新连接现有会话
   */
  public async reconnectSession(
    socket: Socket,
    sessionId: string
  ): Promise<ReconnectResult> {
    try {
      while (true) {
        const session = this.sessions.get(sessionId)
        if (session) {
          session.socket = socket
          session.disconnected = false
          session.disconnectedAt = undefined
          session.lastActivity = new Date()
          if (session.state === 'ready') {
            void this.sessionManager.setSessionActive(sessionId, true).catch(error => {
              this.logger.error(`更新会话重连状态失败: ${sessionId}`, error)
            })
          }

          this.logger.info(`会话 ${sessionId} 重新连接成功`)
          if (session.outputBuffer.length > 0) {
            socket.emit('terminal-output', {
              sessionId: session.id,
              data: session.outputBuffer.join(''),
              isHistorical: true
            })
          }
          return session.state
        }

        const attempt = this.createAttempts.get(sessionId)
        if (!attempt) {
          this.logger.warn(`尝试重连不存在的会话: ${sessionId}`)
          return 'not-found'
        }

        attempt.socket = socket
        attempt.lastActivity = new Date()
        if (attempt.phase === 'close-retained') {
          // N2-I2：close-retained create attempt 纳入 reconnect/owner 可见性——
          // 新 socket 重连即重新驱动 bounded close，并注册为该次 close 的 public requester
          // （I2 多 requester ACK）：关闭确认时向新 socket 发 pty-closed；仍超时保留时
          // 向新 socket 发 terminal-error {retained:true}。不再让唯一 cleanup handle
          // 只存在于已断开的客户端内存中。关闭本身有界（SIGTERM 3s + SIGKILL 1s）。
          this.logger.info(`保留的PTY创建尝试 ${sessionId} 重新连接，重新驱动有界关闭`)
          const closePromise = this.requestTargetClose(attempt, {
            intentional: true,
            emitEvents: true,
            emitTimeoutError: true,
            publicRequester: socket,
            notifyRetained: true
          })
          void closePromise.then(
            result => {
              if (result === 'still-running') {
                this.logger.error(
                  `重新连接后关闭保留的PTY创建尝试仍超时: ${sessionId}，继续保留待重试`
                )
              }
            },
            error => {
              this.logger.error(`重新连接后关闭保留的PTY创建尝试失败: ${sessionId}`, error)
            }
          )
          return 'closing'
        }
        if (attempt.phase === 'closing') {
          const closePromise = attempt.closePromise ?? this.requestTargetClose(attempt, {
            intentional: false,
            emitEvents: false,
            emitTimeoutError: false
          })
          try {
            await closePromise
          } catch (error) {
            this.logger.error(`等待PTY创建尝试关闭失败: ${sessionId}`, error)
            if (this.createAttempts.get(sessionId) === attempt) {
              return 'closing'
            }
          }
          if (
            this.createAttempts.get(sessionId) === attempt &&
            attempt.phase === 'closing'
          ) {
            return 'closing'
          }
          continue
        }

        this.logger.info(`创建中的PTY尝试 ${sessionId} 已绑定新连接`)
        return 'pending'
      }
    } catch (error) {
      this.logger.error(`重连会话失败:`, error)
      const session = this.sessions.get(sessionId)
      if (session) {
        session.socket = socket
        session.lastActivity = new Date()
        return session.state
      }

      const attempt = this.createAttempts.get(sessionId)
      if (!attempt) {
        return 'not-found'
      }
      attempt.socket = socket
      attempt.lastActivity = new Date()
      return attempt.phase === 'closing' || attempt.phase === 'close-retained'
        ? 'closing'
        : 'pending'
    }
  }

  public hasTarget(sessionId: string): boolean {
    return this.sessions.has(sessionId) || this.createAttempts.has(sessionId)
  }

  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }
  
  /**
   * 更新会话名称
   */
  public async updateSessionName(sessionId: string, newName: string): Promise<boolean> {
    try {
      const session = this.sessions.get(sessionId)
      
      if (!session) {
        this.logger.warn(`尝试更新不存在的会话名称: ${sessionId}`)
        return false
      }
      
      // 更新内存中的会话名称
      session.name = newName
      session.lastActivity = new Date()
      
      // 更新持久化存储中的会话名称
      await this.sessionManager.updateSessionName(sessionId, newName)
      
      this.logger.info(`会话名称已更新: ${sessionId} -> ${newName}`)
      return true
    } catch (error) {
      this.logger.error(`更新会话名称失败: ${sessionId}`, error)
      return false
    }
  }
  
  /**
   * 获取所有活跃会话
   */
  public getActiveSessions(): Array<{ id: string; name: string; workingDirectory: string; createdAt: Date; lastActivity: Date; hasStreamForward: boolean; streamForwardStatus: string }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      name: session.name,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      hasStreamForward: session.enableStreamForward || false,
      streamForwardStatus: this.getStreamForwardStatus(session)
    }))
  }

  /**
   * 获取输出流转发进程状态
   */
  private getStreamForwardStatus(session: PtySession): string {
    if (!session.enableStreamForward) {
      return '未启用'
    }
    
    if (!session.streamForwardProcess) {
      return '未运行'
    }
    
    if (session.streamForwardProcess.killed) {
      return '已终止'
    }
    
    return `运行中 (PID: ${session.streamForwardProcess.pid})`
  }

  /**
   * 获取会话状态信息
   */
  private getSessionStatusInfo(session: PtySession): string {
    const now = new Date()
    const uptime = Math.floor((now.getTime() - session.createdAt.getTime()) / 1000)
    const lastActivity = Math.floor((now.getTime() - session.lastActivity.getTime()) / 1000)
    
    let statusInfo = `\r\n=== 会话状态信息 ===\r\n`
    statusInfo += `会话ID: ${session.id}\r\n`
    statusInfo += `会话名称: ${session.name}\r\n`
    statusInfo += `工作目录: ${session.workingDirectory}\r\n`
    statusInfo += `运行时间: ${uptime}秒\r\n`
    statusInfo += `最后活动: ${lastActivity}秒前\r\n`
    statusInfo += `PTY进程PID: ${session.process.pid}\r\n`
    statusInfo += `PTY进程状态: ${session.process.killed ? '已终止' : '运行中'}\r\n`
    
    if (session.enableStreamForward) {
      statusInfo += `输出流转发: 已启用\r\n`
      statusInfo += `转发程序: ${session.programPath || '未设置'}\r\n`
      statusInfo += `转发进程状态: ${this.getStreamForwardStatus(session)}\r\n`
      statusInfo += `自动关闭: ${session.autoCloseOnForwardExit ? '是' : '否'}\r\n`
    } else {
      statusInfo += `输出流转发: 未启用\r\n`
    }
    
    statusInfo += `输出缓存: ${session.outputBuffer.length}条记录\r\n`
    statusInfo += `连接状态: ${session.disconnected ? '已断开' : '已连接'}\r\n`
    statusInfo += `===================\r\n`
    
    return statusInfo
  }

  /**
   * 获取活跃会话统计
   */
  public getSessionStats(): { total: number; sessions: Array<{ id: string; name: string; createdAt: Date; lastActivity: Date; disconnected?: boolean }> } {
    const sessions = Array.from(this.sessions.values())
      .map(session => ({
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        disconnected: session.disconnected
      }))
    
    return {
      total: sessions.length,
      sessions
    }
  }
  
  /**
   * 获取保存的会话列表
   */
  public getSavedSessions(): PersistedTerminalSession[] {
    return this.sessionManager.getSavedSessions()
  }

  /**
   * 获取活跃终端进程信息
   */
  public async getActiveTerminalProcesses(): Promise<Array<{ id: string; name: string; pid: number; cpu: number; memory: number; status: string; createdAt: string; command: string }>> {
    const activeProcesses: Array<{ id: string; name: string; pid: number; cpu: number; memory: number; status: string; createdAt: string; command: string }> = []
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.disconnected && session.process && !session.process.killed) {
        const pid = session.process.pid || 0
        let cpu = 0
        let memory = 0
        
        // 获取进程的CPU和内存使用情况
        if (pid > 0) {
          try {
            const processStats = await this.getProcessStats(pid)
            cpu = processStats.cpu
            memory = processStats.memory
          } catch (error) {
            this.logger.warn(`获取进程 ${pid} 统计信息失败:`, error)
          }
        }
        
        activeProcesses.push({
          id: session.id,
          name: session.name,
          pid,
          cpu,
          memory,
          status: 'running',
          createdAt: session.createdAt.toISOString(),
          command: 'terminal session'
        })
      }
    }
    
    return activeProcesses
  }

  /**
   * 获取进程统计信息
   */
  private async getProcessStats(pid: number): Promise<{ cpu: number; memory: number }> {
    try {
      const platform = os.platform()
      
      if (platform === 'win32') {
        // Windows: 使用 wmic 命令获取进程信息
        const { stdout } = await execAsync(`wmic process where "ProcessId=${pid}" get PageFileUsage,WorkingSetSize /format:csv`)
        const lines = stdout.trim().split('\n')
        if (lines.length > 1) {
          const data = lines[1].split(',')
          const memory = parseInt(data[1]) || 0 // WorkingSetSize in bytes
          return { cpu: 0, memory: memory / 1024 / 1024 } // Convert to MB
        }
      } else {
        // Linux/Unix: 使用 ps 命令获取进程信息
        const { stdout } = await execAsync(`ps -p ${pid} -o %cpu,%mem --no-headers`)
        const parts = stdout.trim().split(/\s+/)
        if (parts.length >= 2) {
          const cpu = parseFloat(parts[0]) || 0
          const memory = parseFloat(parts[1]) || 0
          return { cpu, memory }
        }
      }
    } catch (error) {
      this.logger.warn(`获取进程 ${pid} 统计信息失败:`, error)
    }
    
    return { cpu: 0, memory: 0 }
  }

  /**
   * 检查系统命令是否存在
   */
  private async checkCommandExists(command: string): Promise<boolean> {
    try {
      if (os.platform() === 'win32') {
        // Windows下使用where命令
        await execAsync(`where ${command}`)
        return true
      } else {
        // Linux/Unix下使用which命令
        await execAsync(`which ${command}`)
        return true
      }
    } catch (error) {
      this.logger.debug(`命令 '${command}' 不存在:`, error)
      return false
    }
  }

  /**
   * 检查Linux用户是否存在
   */
  private async checkUserExists(username: string): Promise<boolean> {
    try {
      // 在Linux系统中使用id命令检查用户是否存在
      if (os.platform() !== 'linux') {
        return false
      }

      const { stdout } = await execAsync(`id -u ${username}`)
      // 如果命令成功执行且返回了用户ID，说明用户存在
      return stdout.trim() !== ''
    } catch (error) {
      // 如果命令执行失败，说明用户不存在
      this.logger.debug(`检查用户 '${username}' 是否存在时出错:`, error)
      return false
    }
  }

  /**
   * 为非root用户设置目录权限为777（递归）
   */
  private async setDirectoryPermissions777(directoryPath: string): Promise<void> {
    try {
      // 仅在Linux系统下执行
      if (os.platform() !== 'linux') {
        return
      }

      // 检查目录是否存在
      try {
        await fsPromises.access(directoryPath, fs.constants.F_OK)
      } catch {
        this.logger.warn(`目录不存在，跳过权限设置: ${directoryPath}`)
        return
      }

      // 使用chmod命令递归设置权限为777
      const chmodCommand = `chmod -R 777 "${directoryPath}"`
      await execAsync(chmodCommand)

      this.logger.info(`已递归设置目录权限为777: ${directoryPath}`)
    } catch (error) {
      this.logger.error(`设置目录权限失败: ${directoryPath}`, error)
      throw error
    }
  }

  /**
   * 检测控制字符
   * @param input 输入字符
   * @returns 控制字符信息或null
   */
  private detectControlCharacter(input: string): { name: string; code: string; signal: NodeJS.Signals | string } | null {
    const controlChars: Record<string, { name: string; code: string; signal: NodeJS.Signals | string }> = {
      '\x03': { name: 'Ctrl+C', code: '\\x03', signal: 'SIGINT' as NodeJS.Signals },    // 中断信号
      '\x1a': { name: 'Ctrl+Z', code: '\\x1a', signal: 'SIGTSTP' as NodeJS.Signals },   // 暂停信号
      '\x1c': { name: 'Ctrl+\\', code: '\\x1c', signal: 'SIGQUIT' as NodeJS.Signals },  // 退出信号
      '\x04': { name: 'Ctrl+D', code: '\\x04', signal: 'EOF' },       // 文件结束
      '\x15': { name: 'Ctrl+U', code: '\\x15', signal: 'KILL_LINE' }, // 删除行
      '\x0c': { name: 'Ctrl+L', code: '\\x0c', signal: 'CLEAR' },     // 清屏
    }
    
    return controlChars[input] || null
  }

  private buildShellLocaleEnvArgs(env: NodeJS.ProcessEnv): string[] {
    const keys = ['LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES']
    const args = keys
      .map(key => {
        const value = env[key]
        return value ? `${key}=${value}` : null
      })
      .filter((value): value is string => Boolean(value))

    if (env.LANGUAGE) {
      args.push(`LANGUAGE=${env.LANGUAGE}`)
    }

    return args
  }

  private buildShellLocaleExport(env: NodeJS.ProcessEnv): string {
    return this.buildShellLocaleEnvArgs(env)
      .map(entry => {
        const separatorIndex = entry.indexOf('=')
        const key = entry.slice(0, separatorIndex)
        const value = entry.slice(separatorIndex + 1)
        return `export ${key}=${this.quoteShellValue(value)}`
      })
      .join('; ')
  }

  private quoteShellValue(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`
  }

  /**
   * 清理所有托管进程。
   */
  private async cleanupManagedProcesses(): Promise<void> {
    const processes = Array.from(this.managedProcesses)
    if (processes.length === 0) return

    this.logger.info(`开始清理 ${processes.length} 个托管进程...`)
    await Promise.all(processes.map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) {
        this.managedProcesses.delete(child)
        resolve()
        return
      }

      let completed = false
      let forceKillTimer: NodeJS.Timeout | null = null
      let settleTimer: NodeJS.Timeout | null = null
      const finish = () => {
        if (completed) return
        completed = true
        if (forceKillTimer) clearTimeout(forceKillTimer)
        if (settleTimer) clearTimeout(settleTimer)
        child.removeListener('close', finish)
        child.removeListener('error', finish)
        this.managedProcesses.delete(child)
        resolve()
      }

      child.once('close', finish)
      child.once('error', finish)

      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.end()
        }
        child.kill('SIGTERM')
      } catch (error) {
        this.logger.warn('终止托管进程失败，将继续尝试强制终止', error)
      }

      forceKillTimer = setTimeout(() => {
        if (completed) return
        try {
          child.kill('SIGKILL')
        } catch (error) {
          this.logger.error('强制终止托管进程失败', error)
        }
      }, 1000)

      settleTimer = setTimeout(() => {
        this.logger.warn('等待托管进程退出超时，继续关闭服务器', { pid: child.pid })
        finish()
      }, 3000)
    })))
    this.logger.info('托管进程已清理完成')
  }

  /**
   * 在有界等待内清理所有PTY目标；未确认退出的目标继续保留引用。
   */
  public async cleanup(): Promise<void> {
    this.logger.info('开始清理所有终端会话...')
    this.acceptingTerminalOperations = false
    this.stopActiveProcessesMonitoring()
    const managedProcessCleanup = this.cleanupManagedProcesses()

    const attempts = [...this.createAttempts.values()]
    const sessions = [...this.sessions.values()]
    for (const attempt of attempts) {
      attempt.cancellation.cancelled = true
    }

    const targets: Array<PtySession | CreateAttempt> = []
    const tasks: Array<Promise<CloseResult>> = []
    const seenTargets = new Set<PtySession | CreateAttempt>()
    const collect = (target: PtySession | CreateAttempt) => {
      if (seenTargets.has(target)) return
      seenTargets.add(target)
      targets.push(target)
      tasks.push(this.requestTargetClose(target, {
        intentional: true,
        emitEvents: false,
        emitTimeoutError: false
      }))
    }

    attempts.forEach(collect)
    sessions.forEach(collect)
    const results = await Promise.allSettled(tasks)
    await managedProcessCleanup

    results.forEach((result, index) => {
      const target = targets[index]
      if (result.status === 'rejected') {
        this.logger.error(`清理PTY目标失败: ${target.id}`, result.reason)
        return
      }
      if (result.value === 'still-running') {
        this.logger.error(`清理期限结束后PTY目标仍在运行: ${target.id}`)
      }
    })
    this.logger.info('终端会话有界清理流程已完成')
  }

  // WebSocket 相关方法
  private activeProcessesInterval?: NodeJS.Timeout

  /**
   * 设置 Socket.IO 实例
   */
  public setSocketIO(io: SocketIOServer): void {
    this.io = io
    this.startActiveProcessesMonitoring()
  }

  /**
   * 开始监控活跃进程
   */
  private startActiveProcessesMonitoring(): void {
    if (this.activeProcessesInterval) {
      clearInterval(this.activeProcessesInterval)
    }

    // 每5秒推送一次活跃进程数据
    this.activeProcessesInterval = setInterval(async () => {
      if (this.io) {
        const room = this.io.sockets.adapter.rooms.get('terminal-processes')
        if (room && room.size > 0) {
          try {
            const activeProcesses = await this.getActiveTerminalProcesses()
            this.io.to('terminal-processes').emit('terminal-processes-update', {
              success: true,
              data: activeProcesses,
              timestamp: new Date().toISOString()
            })
          } catch (error) {
            this.logger.error('推送终端活跃进程数据失败:', error)
            this.io.to('terminal-processes').emit('terminal-processes-update', {
              success: false,
              error: error instanceof Error ? error.message : '获取活跃进程失败',
              timestamp: new Date().toISOString()
            })
          }
        }
      }
    }, 5000)

    this.logger.info('终端活跃进程监控已启动')
  }

  /**
   * 停止监控活跃进程
   */
  private stopActiveProcessesMonitoring(): void {
    if (this.activeProcessesInterval) {
      clearInterval(this.activeProcessesInterval)
      this.activeProcessesInterval = undefined
      this.logger.info('终端活跃进程监控已停止')
    }
  }

  /**
   * 向单个客户端发送活跃进程数据
   */
  public async sendActiveProcessesToClient(socket: Socket): Promise<void> {
    try {
      const activeProcesses = await this.getActiveTerminalProcesses()
      socket.emit('terminal-processes-update', {
        success: true,
        data: activeProcesses,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      this.logger.error('向客户端发送终端活跃进程数据失败:', error)
      socket.emit('terminal-processes-update', {
        success: false,
        error: error instanceof Error ? error.message : '获取活跃进程失败',
        timestamp: new Date().toISOString()
      })
    }
  }

  /**
   * 处理客户端断开连接
   */
  public handleClientDisconnect(): void {
    try {
      if (this.io) {
        const room = this.io.sockets.adapter.rooms.get('terminal-processes')
        if (!room || room.size === 0) {
          // 没有客户端订阅了，停止监控
          this.stopActiveProcessesMonitoring()
        }
      }
    } catch (error) {
      this.logger.error('处理客户端断开后的终端进程订阅检查失败:', error)
    }
  }
}
