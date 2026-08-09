import { randomBytes } from 'node:crypto'
import {
  close as closeFileDescriptor,
  constants as fsConstants,
  createWriteStream,
  fchmod as fchmodFileDescriptor,
  fstat as fstatFileDescriptor,
  open as openFileDescriptor
} from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  unlink
} from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface CreatePtyControlChannelOptions {
  sessionId: string
  logger: {
    debug(message: string): void
    warn(message: string): void
    error(message: string): void
  }
  platform?: NodeJS.Platform
  directoryCandidates?: string[]
}

export interface PtySize {
  cols: number
  rows: number
}

export interface PtyControlChannel {
  readonly endpoint: string
  waitUntilReady(timeoutMs: number): Promise<void>
  enqueueResize(size: PtySize): Promise<'written' | 'skipped'>
  close(): Promise<void>
}

interface PtyControlWriter {
  write(
    frame: Buffer,
    callback: (error?: Error | null) => void
  ): boolean
  destroy(error?: Error): void
}

interface PtyControlTransport {
  waitUntilReady(timeoutMs: number): Promise<PtyControlWriter>
  destroyWriter(): void
  close(): Promise<void>
}

type ResizeResult = 'written' | 'skipped'

interface ResizeRequest {
  size: PtySize
  promise: Promise<ResizeResult>
  resolve(result: ResizeResult): void
  reject(error: unknown): void
}

interface ReadinessAttempt {
  promise: Promise<void>
  cancelled: boolean
  resolve(): void
  reject(error: unknown): void
}

function sizesEqual(left: PtySize | null, right: PtySize): boolean {
  return left !== null && left.cols === right.cols && left.rows === right.rows
}

export function validatePtySize(cols: unknown, rows: unknown): PtySize {
  if (!Number.isSafeInteger(cols) || (cols as number) < 2 || (cols as number) > 1000) {
    throw new Error('PTY cols 必须是 2 到 1000 之间的安全整数')
  }
  if (!Number.isSafeInteger(rows) || (rows as number) < 1 || (rows as number) > 1000) {
    throw new Error('PTY rows 必须是 1 到 1000 之间的安全整数')
  }

  return { cols: cols as number, rows: rows as number }
}

export function encodePtyResizeFrame(size: PtySize): Buffer {
  const payload = Buffer.from(
    JSON.stringify({ width: size.cols, height: size.rows }),
    'utf8'
  )
  if (payload.length > 0xffff) {
    throw new Error('PTY RESIZE payload 超过 uint16 长度限制')
  }

  const frame = Buffer.allocUnsafe(3 + payload.length)
  frame.writeUInt8(4, 0)
  frame.writeUInt16BE(payload.length, 1)
  payload.copy(frame, 3)
  return frame
}

class PtyControlChannelQueue implements PtyControlChannel {
  private writer: PtyControlWriter | null = null
  private readyPromise: Promise<void> | null = null
  private readinessAttempt: ReadinessAttempt | null = null
  private currentWrite: ResizeRequest | null = null
  private pendingResize: ResizeRequest | null = null
  private lastWrittenSize: PtySize | null = null
  private closed = false
  private closePromise: Promise<void> | null = null
  private readonly unsettledResizeOperations = new Set<Promise<ResizeResult>>()

  constructor(
    readonly endpoint: string,
    private readonly transport: PtyControlTransport
  ) {}

  waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.writer) {
      return Promise.resolve()
    }
    if (this.closed) {
      return Promise.reject(new Error('PTY control channel 已关闭'))
    }
    if (this.readyPromise) {
      return this.readyPromise
    }

    let resolveReadiness!: () => void
    let rejectReadiness!: (error: unknown) => void
    const readiness = new Promise<void>((resolve, reject) => {
      resolveReadiness = resolve
      rejectReadiness = reject
    })
    const attempt: ReadinessAttempt = {
      promise: readiness,
      cancelled: false,
      resolve: resolveReadiness,
      reject: rejectReadiness
    }

    this.readyPromise = readiness
    this.readinessAttempt = attempt
    void readiness.catch(() => {})

    const transportReadiness = Promise.resolve().then(() => {
      if (attempt.cancelled) {
        return null
      }
      return this.transport.waitUntilReady(timeoutMs)
    })
    void transportReadiness.then(
      writer => {
        if (!writer) {
          return
        }
        if (
          attempt.cancelled ||
          this.closed ||
          this.readinessAttempt !== attempt
        ) {
          try {
            writer.destroy()
          } catch {
            // 关闭已由队列完成；迟到 writer 的销毁错误不能重新打开生命周期。
          }
          return
        }

        this.writer = writer
        this.readinessAttempt = null
        attempt.resolve()
      },
      error => {
        if (attempt.cancelled || this.readinessAttempt !== attempt) {
          return
        }
        this.readinessAttempt = null
        this.readyPromise = null
        attempt.reject(error)
      }
    ).catch(() => {})

    return readiness
  }

  enqueueResize(size: PtySize): Promise<ResizeResult> {
    if (this.closed) {
      return Promise.resolve('skipped')
    }
    if (!this.writer) {
      return Promise.reject(new Error('PTY control channel 尚未就绪'))
    }

    if (this.currentWrite) {
      if (sizesEqual(this.currentWrite.size, size)) {
        if (this.pendingResize) {
          this.pendingResize.resolve('skipped')
          this.pendingResize = null
        }
        return Promise.resolve('skipped')
      }
      if (sizesEqual(this.pendingResize?.size ?? null, size)) {
        return Promise.resolve('skipped')
      }

      const request = this.createResizeRequest(size)
      if (this.pendingResize) {
        this.pendingResize.resolve('skipped')
      }
      this.pendingResize = request
      return request.promise
    }

    if (sizesEqual(this.lastWrittenSize, size)) {
      return Promise.resolve('skipped')
    }

    const request = this.createResizeRequest(size)
    this.startWrite(request)
    return request.promise
  }

  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise
    }

    let resolveClose!: () => void
    let rejectClose!: (error: unknown) => void
    const closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve
      rejectClose = reject
    })
    this.closePromise = closePromise
    this.closed = true

    const readiness = this.readinessAttempt
    if (readiness) {
      readiness.cancelled = true
      this.readinessAttempt = null
      this.readyPromise = null
      readiness.reject(new Error('PTY control channel 已关闭'))
    }

    const current = this.currentWrite
    this.currentWrite = null
    if (current) {
      current.resolve('skipped')
    }
    if (this.pendingResize) {
      this.pendingResize.resolve('skipped')
      this.pendingResize = null
    }

    const resizeOperations = [...this.unsettledResizeOperations]
    void this.finishClose(resizeOperations).then(resolveClose, rejectClose)
    return closePromise
  }

  private async finishClose(
    resizeOperations: Promise<ResizeResult>[]
  ): Promise<void> {
    let destroyError: unknown
    try {
      this.transport.destroyWriter()
    } catch (error) {
      destroyError = error
    }

    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.transport.close()),
      ...resizeOperations
    ])
    const transportResult = results[0]
    if (destroyError && transportResult.status === 'rejected') {
      throw new (globalThis as any).AggregateError(
        [destroyError, transportResult.reason],
        'PTY control channel 关闭失败'
      )
    }
    if (destroyError) {
      throw destroyError
    }
    if (transportResult.status === 'rejected') {
      throw transportResult.reason
    }
  }

  private createResizeRequest(size: PtySize): ResizeRequest {
    let resolve!: (result: ResizeResult) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<ResizeResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const request = {
      size: { cols: size.cols, rows: size.rows },
      promise,
      resolve,
      reject
    }

    this.unsettledResizeOperations.add(promise)
    void promise.then(
      () => this.unsettledResizeOperations.delete(promise),
      () => this.unsettledResizeOperations.delete(promise)
    )
    return request
  }

  private startWrite(request: ResizeRequest): void {
    this.currentWrite = request

    try {
      const frame = encodePtyResizeFrame(request.size)
      this.writer!.write(frame, error => {
        this.finishWrite(request, error ?? null)
      })
    } catch (error) {
      this.finishWrite(request, error)
    }
  }

  private finishWrite(request: ResizeRequest, error: unknown): void {
    if (this.currentWrite !== request) {
      return
    }

    this.currentWrite = null
    if (error) {
      if (this.closed) {
        request.resolve('skipped')
      } else {
        request.reject(error)
      }
    } else {
      this.lastWrittenSize = request.size
      request.resolve('written')
    }

    if (this.closed) {
      return
    }

    const next = this.pendingResize
    this.pendingResize = null
    if (next) {
      this.startWrite(next)
    }
  }
}

type PtyControlFailureStage =
  | 'directory'
  | 'path'
  | 'lstat'
  | 'chmod'
  | 'open'
  | 'connect'

interface TransportReadinessAttempt {
  stage: PtyControlFailureStage
  cancelled: boolean
  cancellation: Promise<never>
  cancel(error: Error): void
}

class PtyControlStageError extends Error {
  constructor(
    readonly stage: PtyControlFailureStage,
    message: string
  ) {
    super(message)
    this.name = 'PtyControlStageError'
  }
}

const WINDOWS_PIPE_CONNECT_RETRY_DELAY_MS = 25

interface PosixSecurityFlags {
  noFollow: number
  directory: number
}

interface PosixControlDirectory {
  path: string
  dev: number
  ino: number
  uid: number
}

interface PosixControlTestHooks {
  noFollowFlag?: number | null
  beforeDirectoryFchmod?(directory: string): Promise<void> | void
  beforeFifoFchmod?(endpoint: string): Promise<void> | void
  beforeRemovalPathLstat?(endpoint: string): Promise<void> | void
  beforeEndpointQuarantineRename?(endpoint: string): Promise<void> | void
  renameEndpointForRemoval?(source: string, destination: string): Promise<void>
  restoreEndpointForRemoval?(source: string, destination: string): Promise<void>
  closeRemovalDescriptor?(descriptor: number): Promise<void>
}

const posixControlTestHooksSymbol = Symbol.for(
  'gsm3.ptyControlChannel.testHooks'
)

function getPosixControlTestHooks(): PosixControlTestHooks {
  if (process.env.NODE_ENV !== 'test') {
    return {}
  }
  const testGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown
  }
  return (testGlobal[posixControlTestHooksSymbol] ?? {}) as PosixControlTestHooks
}

function requirePosixSecurityFlags(): PosixSecurityFlags {
  const hooks = getPosixControlTestHooks()
  const noFollow = Object.prototype.hasOwnProperty.call(hooks, 'noFollowFlag')
    ? hooks.noFollowFlag
    : fsConstants.O_NOFOLLOW
  if (typeof noFollow !== 'number' || noFollow <= 0) {
    throw new PtyControlStageError(
      'directory',
      'PTY control POSIX security flag O_NOFOLLOW unavailable stage=directory'
    )
  }
  if (typeof fsConstants.O_DIRECTORY !== 'number' || fsConstants.O_DIRECTORY <= 0) {
    throw new PtyControlStageError(
      'directory',
      'PTY control POSIX security flag O_DIRECTORY unavailable stage=directory'
    )
  }
  return {
    noFollow,
    directory: fsConstants.O_DIRECTORY
  }
}

function createTransportReadinessAttempt(): TransportReadinessAttempt {
  let rejectCancellation!: (error: Error) => void
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject
  })
  void cancellation.catch(() => {})

  return {
    stage: 'path',
    cancelled: false,
    cancellation,
    cancel(error: Error) {
      if (this.cancelled) {
        return
      }
      this.cancelled = true
      rejectCancellation(error)
    }
  }
}

function assertReadinessActive(
  attempt: TransportReadinessAttempt,
  deadline: number,
  closed: boolean
): void {
  if (closed || attempt.cancelled) {
    throw new PtyControlStageError(
      attempt.stage,
      `PTY control channel closed stage=${attempt.stage}`
    )
  }
  if (Date.now() >= deadline) {
    throw new PtyControlStageError(
      attempt.stage,
      `PTY control readiness timed out stage=${attempt.stage}`
    )
  }
}

async function runReadinessStage<T>(
  attempt: TransportReadinessAttempt,
  deadline: number,
  stage: PtyControlFailureStage,
  isClosed: () => boolean,
  operation: () => Promise<T>
): Promise<T> {
  attempt.stage = stage
  assertReadinessActive(attempt, deadline, isClosed())

  const remainingMs = deadline - Date.now()
  let timeout: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new PtyControlStageError(
        stage,
        `PTY control readiness timed out stage=${stage}`
      ))
    }, remainingMs)
  })

  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      attempt.cancellation,
      timeoutPromise
    ])
    assertReadinessActive(attempt, deadline, isClosed())
    return result
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function waitForRetryDelay(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10))
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
}

function isRecoverableWindowsPipeConnectError(error: unknown): boolean {
  if (error instanceof PtyControlStageError) {
    return false
  }
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
  return code === 'ENOENT' ||
    code === 'ECONNREFUSED' ||
    code === 'EBUSY' ||
    code === 'EAGAIN'
}

function normalizeReadinessError(
  error: unknown,
  stage: PtyControlFailureStage
): Error {
  if (error instanceof PtyControlStageError) {
    return error
  }
  return new PtyControlStageError(
    stage,
    `PTY control readiness failed stage=${stage}`
  )
}

function logPtyControlFailure(
  options: CreatePtyControlChannelOptions,
  platform: NodeJS.Platform,
  stage: PtyControlFailureStage,
  reason?: unknown
): void {
  try {
    const reasonMessage = reason instanceof Error && reason.message
      ? ` reason=${reason.message}`
      : ''
    options.logger.warn(
      `PTY control failure platform=${platform} sessionId=${options.sessionId} stage=${stage}${reasonMessage}`
    )
  } catch {
    // 日志失败不能改变控制通道的安全清理与错误语义。
  }
}

function getDefaultPosixControlDirectoryCandidates(): string[] {
  const uidSuffix = typeof process.geteuid === 'function'
    ? String(process.geteuid())
    : 'unknown'
  const candidates = [
    path.join(process.cwd(), 'data', 'terminal-control'),
    path.join(process.cwd(), 'server', 'data', 'terminal-control'),
    path.join(tmpdir(), `gsm3-terminal-control-${uidSuffix}`)
  ]

  return [...new Set(candidates.map(candidate => path.resolve(candidate)))]
}

function closeDescriptorQuietly(descriptor: number): void {
  closeFileDescriptor(descriptor, () => {})
}

function closeDescriptor(descriptor: number): Promise<void> {
  return new Promise((resolve, reject) => {
    closeFileDescriptor(descriptor, error => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function fstatDescriptor(descriptor: number): Promise<import('node:fs').Stats> {
  return new Promise((resolve, reject) => {
    fstatFileDescriptor(descriptor, (error, stats) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stats)
    })
  })
}

function fchmodDescriptor(descriptor: number, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    fchmodFileDescriptor(descriptor, mode, error => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function getEffectiveUserId(stage: PtyControlFailureStage): number {
  if (typeof process.geteuid !== 'function') {
    throw new PtyControlStageError(
      stage,
      `PTY control POSIX owner verification unavailable stage=${stage}`
    )
  }
  return process.geteuid()
}

function sameFileIdentity(
  left: Pick<import('node:fs').Stats, 'dev' | 'ino'>,
  right: Pick<import('node:fs').Stats, 'dev' | 'ino'>
): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertControlledDirectoryStats(
  stats: import('node:fs').Stats,
  effectiveUserId: number,
  stage: PtyControlFailureStage,
  expected?: PosixControlDirectory
): void {
  if (!stats.isDirectory() || stats.uid !== effectiveUserId) {
    throw new PtyControlStageError(
      stage,
      `PTY control directory ownership verification failed stage=${stage}`
    )
  }
  if ((stats.mode & 0o777) !== 0o700) {
    throw new PtyControlStageError(
      stage,
      `PTY control directory permissions verification failed stage=${stage}`
    )
  }
  if (expected && !sameFileIdentity(stats, expected)) {
    throw new PtyControlStageError(
      stage,
      `PTY control directory identity changed stage=${stage}`
    )
  }
}

async function assertDirectoryPathIsControlled(
  directory: string,
  stats: import('node:fs').Stats,
  effectiveUserId: number,
  stage: PtyControlFailureStage
): Promise<string> {
  const controlledDirectory = await realpath(path.resolve(directory))
  const pathnameStats = await lstat(controlledDirectory)
  if (
    pathnameStats.isSymbolicLink() ||
    !sameFileIdentity(pathnameStats, stats)
  ) {
    throw new PtyControlStageError(
      stage,
      `PTY control directory identity changed stage=${stage}`
    )
  }

  let childPath = controlledDirectory
  let childStats = pathnameStats
  while (true) {
    const parentPath = path.dirname(childPath)
    if (parentPath === childPath) {
      break
    }
    const parentStats = await lstat(parentPath)
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
      throw new PtyControlStageError(
        stage,
        `PTY control directory ancestor verification failed stage=${stage}`
      )
    }
    if ((parentStats.mode & 0o022) !== 0) {
      const sticky = (parentStats.mode & 0o1000) !== 0
      if (!sticky || childStats.uid !== effectiveUserId) {
        throw new PtyControlStageError(
          stage,
          `PTY control directory ancestor permissions unsafe stage=${stage}`
        )
      }
    }
    childPath = parentPath
    childStats = parentStats
  }
  return controlledDirectory
}

function openDescriptor(
  endpoint: string,
  flags: number,
  canUseDescriptor: () => boolean
): Promise<number> {
  return new Promise((resolve, reject) => {
    openFileDescriptor(endpoint, flags, (error, descriptor) => {
      if (error) {
        reject(error)
        return
      }
      if (!canUseDescriptor()) {
        closeDescriptorQuietly(descriptor)
        reject(new PtyControlStageError(
          'open',
          'PTY control readiness timed out stage=open'
        ))
        return
      }
      resolve(descriptor)
    })
  })
}

async function validateControlDirectory(
  directory: PosixControlDirectory,
  flags: PosixSecurityFlags,
  stage: PtyControlFailureStage
): Promise<void> {
  const effectiveUserId = getEffectiveUserId(stage)
  let descriptor: number | null = null
  try {
    descriptor = await openDescriptor(
      directory.path,
      fsConstants.O_RDONLY | flags.directory | flags.noFollow,
      () => true
    )
    const stats = await fstatDescriptor(descriptor)
    assertControlledDirectoryStats(stats, effectiveUserId, stage, directory)
    await assertDirectoryPathIsControlled(
      directory.path,
      stats,
      effectiveUserId,
      stage
    )
  } finally {
    if (descriptor !== null) {
      closeDescriptorQuietly(descriptor)
    }
  }
}

const ignoreWriterError = () => {}

class PosixPtyControlTransport implements PtyControlTransport {
  private writer: PtyControlWriter | null = null
  private partialWriter: PtyControlWriter | null = null
  private partialDescriptor: number | null = null
  private activeAttempt: TransportReadinessAttempt | null = null
  private closed = false

  constructor(
    private readonly endpoint: string,
    private readonly controlDirectory: PosixControlDirectory,
    private readonly securityFlags: PosixSecurityFlags,
    private readonly options: CreatePtyControlChannelOptions,
    private readonly platform: NodeJS.Platform
  ) {}

  async waitUntilReady(timeoutMs: number): Promise<PtyControlWriter> {
    if (this.writer) {
      return this.writer
    }
    if (this.closed) {
      throw new PtyControlStageError('path', 'PTY control channel closed stage=path')
    }

    const attempt = createTransportReadinessAttempt()
    const deadline = Date.now() + Math.max(0, timeoutMs)
    this.activeAttempt = attempt
    let stage: PtyControlFailureStage = 'path'

    try {
      await this.waitForPath(attempt, deadline)

      stage = 'lstat'
      const stats = await runReadinessStage(
        attempt,
        deadline,
        stage,
        () => this.closed,
        () => lstat(this.endpoint)
      )
      if (stats.isSymbolicLink()) {
        throw new PtyControlStageError(
          stage,
          'PTY control endpoint is a symbolic link stage=lstat'
        )
      }
      if (!stats.isFIFO()) {
        throw new PtyControlStageError(
          stage,
          'PTY control endpoint is not a FIFO stage=lstat'
        )
      }

      stage = 'chmod'
      const fifoIdentity = await this.secureFifoPermissions(attempt, deadline)

      stage = 'open'
      const writer = await this.openWriter(attempt, deadline, fifoIdentity)
      assertReadinessActive(attempt, deadline, this.closed)
      this.writer = writer
      if (this.partialWriter === writer) {
        this.partialWriter = null
      }
      return writer
    } catch (error) {
      this.destroyPartialWriter()
      logPtyControlFailure(this.options, this.platform, stage)
      throw normalizeReadinessError(error, stage)
    } finally {
      if (this.activeAttempt === attempt) {
        this.activeAttempt = null
      }
    }
  }

  destroyWriter(): void {
    this.closed = true
    const attempt = this.activeAttempt
    if (attempt) {
      attempt.cancel(new PtyControlStageError(
        attempt.stage,
        `PTY control channel closed stage=${attempt.stage}`
      ))
    }
    this.destroyPartialWriter()

    const writer = this.writer
    this.writer = null
    if (writer) {
      writer.destroy()
    }
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.destroyWriter()
    }
  }

  private async validateDirectory(
    attempt: TransportReadinessAttempt,
    deadline: number,
    stage: PtyControlFailureStage
  ): Promise<void> {
    await runReadinessStage(
      attempt,
      deadline,
      stage,
      () => this.closed,
      () => validateControlDirectory(
        this.controlDirectory,
        this.securityFlags,
        stage
      )
    )
  }

  private async waitForPath(
    attempt: TransportReadinessAttempt,
    deadline: number
  ): Promise<void> {
    await this.validateDirectory(attempt, deadline, 'path')
    while (true) {
      try {
        await runReadinessStage(
          attempt,
          deadline,
          'path',
          () => this.closed,
          () => lstat(this.endpoint).then(() => undefined)
        )
        await this.validateDirectory(attempt, deadline, 'path')
        return
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) {
          throw error
        }
      }

      await runReadinessStage(
        attempt,
        deadline,
        'path',
        () => this.closed,
        waitForRetryDelay
      )
    }
  }

  private async secureFifoPermissions(
    attempt: TransportReadinessAttempt,
    deadline: number
  ): Promise<import('node:fs').Stats> {
    await this.validateDirectory(attempt, deadline, 'chmod')
    const flags = fsConstants.O_RDONLY |
      fsConstants.O_NONBLOCK |
      this.securityFlags.noFollow
    const descriptor = await runReadinessStage(
      attempt,
      deadline,
      'chmod',
      () => this.closed,
      () => openDescriptor(
        this.endpoint,
        flags,
        () => !this.closed && !attempt.cancelled && Date.now() < deadline
      )
    )
    this.partialDescriptor = descriptor

    try {
      const initialStats = await runReadinessStage(
        attempt,
        deadline,
        'chmod',
        () => this.closed,
        () => fstatDescriptor(descriptor)
      )
      const effectiveUserId = getEffectiveUserId('chmod')
      if (!initialStats.isFIFO() || initialStats.uid !== effectiveUserId) {
        throw new PtyControlStageError(
          'chmod',
          'PTY control endpoint FIFO ownership verification failed stage=chmod'
        )
      }

      await getPosixControlTestHooks().beforeFifoFchmod?.(this.endpoint)
      await runReadinessStage(
        attempt,
        deadline,
        'chmod',
        () => this.closed,
        () => fchmodDescriptor(descriptor, 0o600)
      )
      const securedStats = await runReadinessStage(
        attempt,
        deadline,
        'chmod',
        () => this.closed,
        () => fstatDescriptor(descriptor)
      )
      if (
        !securedStats.isFIFO() ||
        securedStats.uid !== effectiveUserId ||
        (securedStats.mode & 0o777) !== 0o600 ||
        !sameFileIdentity(initialStats, securedStats)
      ) {
        throw new PtyControlStageError(
          'chmod',
          'PTY control endpoint FIFO verification failed stage=chmod'
        )
      }
      await runReadinessStage(
        attempt,
        deadline,
        'chmod',
        () => this.closed,
        () => {
          if (this.partialDescriptor === descriptor) {
            this.partialDescriptor = null
          }
          return closeDescriptor(descriptor)
        }
      )
      return securedStats
    } finally {
      if (this.partialDescriptor === descriptor) {
        this.partialDescriptor = null
        closeDescriptorQuietly(descriptor)
      }
    }
  }

  private async openWriter(
    attempt: TransportReadinessAttempt,
    deadline: number,
    fifoIdentity: import('node:fs').Stats
  ): Promise<PtyControlWriter> {
    const flags = fsConstants.O_WRONLY |
      fsConstants.O_NONBLOCK |
      this.securityFlags.noFollow

    while (true) {
      await this.validateDirectory(attempt, deadline, 'open')
      let descriptor: number
      try {
        descriptor = await runReadinessStage(
          attempt,
          deadline,
          'open',
          () => this.closed,
          () => openDescriptor(
            this.endpoint,
            flags,
            () => !this.closed && !attempt.cancelled && Date.now() < deadline
          )
        )
      } catch (error) {
        if (!hasErrorCode(error, 'ENXIO')) {
          throw error
        }
        await runReadinessStage(
          attempt,
          deadline,
          'open',
          () => this.closed,
          waitForRetryDelay
        )
        continue
      }

      this.partialDescriptor = descriptor
      try {
        const stats = await runReadinessStage(
          attempt,
          deadline,
          'open',
          () => this.closed,
          () => fstatDescriptor(descriptor)
        )
        if (
          !stats.isFIFO() ||
          stats.uid !== fifoIdentity.uid ||
          (stats.mode & 0o777) !== 0o600 ||
          !sameFileIdentity(stats, fifoIdentity)
        ) {
          throw new PtyControlStageError(
            'open',
            'PTY control endpoint FIFO identity changed stage=open'
          )
        }

        const stream = createWriteStream(this.endpoint, {
          fd: descriptor,
          autoClose: true
        })
        const writer = stream as PtyControlWriter
        this.partialDescriptor = null
        this.partialWriter = writer
        stream.on('error', ignoreWriterError)
        assertReadinessActive(attempt, deadline, this.closed)
        return writer
      } catch (error) {
        if (this.partialDescriptor === descriptor) {
          this.partialDescriptor = null
          closeDescriptorQuietly(descriptor)
        }
        throw error
      }
    }
  }

  private destroyPartialWriter(): void {
    const partialWriter = this.partialWriter
    this.partialWriter = null
    if (partialWriter) {
      try {
        partialWriter.destroy()
      } catch {
        // Readiness 失败只负责无参数销毁 partial writer。
      }
    }

    const descriptor = this.partialDescriptor
    this.partialDescriptor = null
    if (descriptor !== null) {
      closeDescriptorQuietly(descriptor)
    }
  }
}

class WindowsPtyControlTransport implements PtyControlTransport {
  private writer: PtyControlWriter | null = null
  private partialSocket: net.Socket | null = null
  private activeAttempt: TransportReadinessAttempt | null = null
  private closed = false

  constructor(
    private readonly endpoint: string,
    private readonly options: CreatePtyControlChannelOptions,
    private readonly platform: NodeJS.Platform
  ) {}

  async waitUntilReady(timeoutMs: number): Promise<PtyControlWriter> {
    if (this.writer) {
      return this.writer
    }
    if (this.closed) {
      throw new PtyControlStageError('connect', 'PTY control channel closed stage=connect')
    }

    const attempt = createTransportReadinessAttempt()
    attempt.stage = 'connect'
    const deadline = Date.now() + Math.max(0, timeoutMs)
    this.activeAttempt = attempt
    let cleanupListeners = () => {}

    try {
      let lastError: unknown
      while (!this.closed && Date.now() <= deadline) {
        assertReadinessActive(attempt, deadline, this.closed)
        cleanupListeners = () => {}
        const socket = net.createConnection(this.endpoint)
        this.partialSocket = socket
        socket.on('error', ignoreWriterError)

        const connected = new Promise<void>((resolve, reject) => {
          const onConnect = () => {
            cleanupListeners()
            resolve()
          }
          const onError = (error: Error) => {
            cleanupListeners()
            reject(error)
          }
          const onClose = () => {
            cleanupListeners()
            reject(new PtyControlStageError(
              'connect',
              'PTY control connection closed stage=connect'
            ))
          }
          cleanupListeners = () => {
            socket.off('connect', onConnect)
            socket.off('error', onError)
            socket.off('close', onClose)
          }
          socket.once('connect', onConnect)
          socket.once('error', onError)
          socket.once('close', onClose)
        })

        try {
          await runReadinessStage(
            attempt,
            deadline,
            'connect',
            () => this.closed,
            () => connected
          )
          assertReadinessActive(attempt, deadline, this.closed)
          this.writer = socket
          this.partialSocket = null
          return socket
        } catch (error) {
          lastError = error
          cleanupListeners()
          if (this.partialSocket === socket) {
            this.partialSocket = null
          }
          socket.destroy()
          if (!isRecoverableWindowsPipeConnectError(error) || Date.now() >= deadline) {
            throw error
          }
          await runReadinessStage(
            attempt,
            deadline,
            'connect',
            () => this.closed,
            async () => {
              await new Promise(resolve => setTimeout(resolve, WINDOWS_PIPE_CONNECT_RETRY_DELAY_MS))
            }
          )
        }
      }
      throw lastError ?? new PtyControlStageError(
        'connect',
        'PTY control readiness timed out stage=connect'
      )
    } catch (error) {
      cleanupListeners()
      this.destroyPartialSocket()
      logPtyControlFailure(this.options, this.platform, 'connect')
      throw normalizeReadinessError(error, 'connect')
    } finally {
      if (this.activeAttempt === attempt) {
        this.activeAttempt = null
      }
    }
  }

  destroyWriter(): void {
    this.closed = true
    const attempt = this.activeAttempt
    if (attempt) {
      attempt.cancel(new PtyControlStageError(
        'connect',
        'PTY control channel closed stage=connect'
      ))
    }
    this.destroyPartialSocket()

    const writer = this.writer
    this.writer = null
    if (writer) {
      writer.destroy()
    }
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.destroyWriter()
    }
  }

  private destroyPartialSocket(): void {
    const socket = this.partialSocket
    this.partialSocket = null
    if (socket) {
      try {
        socket.destroy()
      } catch {
        // Readiness 失败只负责无参数销毁 partial writer。
      }
    }
  }
}

async function selectPosixControlDirectory(
  options: CreatePtyControlChannelOptions,
  platform: NodeJS.Platform,
  securityFlags: PosixSecurityFlags
): Promise<PosixControlDirectory> {
  const directoryCandidates = options.directoryCandidates ??
    getDefaultPosixControlDirectoryCandidates()

  for (const rawCandidate of directoryCandidates) {
    let descriptor: number | null = null
    try {
      const candidate = path.resolve(rawCandidate)
      await mkdir(candidate, { recursive: true })
      const effectiveUserId = getEffectiveUserId('directory')
      descriptor = await openDescriptor(
        candidate,
        fsConstants.O_RDONLY |
          securityFlags.directory |
          securityFlags.noFollow,
        () => true
      )
      const initialStats = await fstatDescriptor(descriptor)
      if (!initialStats.isDirectory() || initialStats.uid !== effectiveUserId) {
        throw new PtyControlStageError(
          'directory',
          'PTY control directory ownership verification failed stage=directory'
        )
      }
      await assertDirectoryPathIsControlled(
        candidate,
        initialStats,
        effectiveUserId,
        'directory'
      )

      await getPosixControlTestHooks().beforeDirectoryFchmod?.(candidate)
      await fchmodDescriptor(descriptor, 0o700)
      const securedStats = await fstatDescriptor(descriptor)
      if (!sameFileIdentity(initialStats, securedStats)) {
        throw new PtyControlStageError(
          'directory',
          'PTY control directory identity changed stage=directory'
        )
      }
      assertControlledDirectoryStats(
        securedStats,
        effectiveUserId,
        'directory'
      )
      const controlledCandidate = await assertDirectoryPathIsControlled(
        candidate,
        securedStats,
        effectiveUserId,
        'directory'
      )
      return {
        path: controlledCandidate,
        dev: securedStats.dev,
        ino: securedStats.ino,
        uid: securedStats.uid
      }
    } catch (error) {
      logPtyControlFailure(options, platform, 'directory', error)
    } finally {
      if (descriptor !== null) {
        closeDescriptorQuietly(descriptor)
      }
    }
  }

  throw new PtyControlStageError(
    'directory',
    `PTY control directory unavailable platform=${platform} sessionId=${options.sessionId} stage=directory`
  )
}

export async function createPtyControlChannel(
  options: CreatePtyControlChannelOptions
): Promise<PtyControlChannel> {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    const endpoint = `\\\\.\\pipe\\gsm3-pty-${randomBytes(16).toString('hex')}`
    return new PtyControlChannelQueue(
      endpoint,
      new WindowsPtyControlTransport(endpoint, options, platform)
    )
  }

  let securityFlags: PosixSecurityFlags
  try {
    securityFlags = requirePosixSecurityFlags()
  } catch (error) {
    logPtyControlFailure(options, platform, 'directory')
    throw error
  }
  const directory = await selectPosixControlDirectory(
    options,
    platform,
    securityFlags
  )
  const endpoint = path.join(
    directory.path,
    `gsm3-pty-${randomBytes(16).toString('hex')}`
  )
  return new PtyControlChannelQueue(
    endpoint,
    new PosixPtyControlTransport(
      endpoint,
      directory,
      securityFlags,
      options,
      platform
    )
  )
}

async function inspectPrivateControlDirectory(
  directoryPath: string,
  securityFlags: PosixSecurityFlags
): Promise<PosixControlDirectory> {
  const resolvedDirectory = path.resolve(directoryPath)
  const effectiveUserId = getEffectiveUserId('lstat')
  let descriptor: number | null = null
  try {
    descriptor = await openDescriptor(
      resolvedDirectory,
      fsConstants.O_RDONLY |
        securityFlags.directory |
        securityFlags.noFollow,
      () => true
    )
    const stats = await fstatDescriptor(descriptor)
    assertControlledDirectoryStats(stats, effectiveUserId, 'lstat')
    const controlledDirectory = await assertDirectoryPathIsControlled(
      resolvedDirectory,
      stats,
      effectiveUserId,
      'lstat'
    )
    return {
      path: controlledDirectory,
      dev: stats.dev,
      ino: stats.ino,
      uid: stats.uid
    }
  } finally {
    if (descriptor !== null) {
      closeDescriptorQuietly(descriptor)
    }
  }
}

async function renameEndpointForRemoval(
  source: string,
  destination: string
): Promise<void> {
  const hook = getPosixControlTestHooks().renameEndpointForRemoval
  if (hook) {
    await hook(source, destination)
    return
  }
  await rename(source, destination)
}

async function restoreQuarantinedEndpoint(
  quarantineEndpoint: string,
  endpoint: string
): Promise<void> {
  try {
    const hook = getPosixControlTestHooks().restoreEndpointForRemoval
    if (hook) {
      await hook(quarantineEndpoint, endpoint)
      return
    }
    await link(quarantineEndpoint, endpoint)
  } catch {
    // 私有目录中的隔离对象保留原状，避免覆盖或 unlink 未验证对象。
  }
}

async function closeRemovalDescriptor(descriptor: number): Promise<void> {
  const hook = getPosixControlTestHooks().closeRemovalDescriptor
  if (hook) {
    await hook(descriptor)
    return
  }
  await closeDescriptor(descriptor)
}

function sanitizePtyControlRemovalError(error: unknown): PtyControlStageError {
  if (error instanceof PtyControlStageError) {
    return error
  }
  return new PtyControlStageError(
    'lstat',
    'PTY control endpoint removal failed stage=lstat'
  )
}

async function removePosixPtyControlEndpoint(endpoint: string): Promise<void> {
  const securityFlags = requirePosixSecurityFlags()
  let directory: PosixControlDirectory
  try {
    directory = await inspectPrivateControlDirectory(
      path.dirname(endpoint),
      securityFlags
    )
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return
    }
    throw error
  }
  const resolvedEndpoint = path.join(directory.path, path.basename(endpoint))

  let descriptor: number | null = null
  try {
    try {
      descriptor = await openDescriptor(
        resolvedEndpoint,
        fsConstants.O_RDONLY |
          fsConstants.O_NONBLOCK |
          securityFlags.noFollow,
        () => true
      )
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return
      }
      if (hasErrorCode(error, 'ELOOP')) {
        throw new PtyControlStageError(
          'lstat',
          'PTY control endpoint is a symbolic link stage=lstat'
        )
      }
      throw error
    }

    const pinnedStats = await fstatDescriptor(descriptor)
    if (!pinnedStats.isFIFO()) {
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint is not a FIFO stage=lstat'
      )
    }
    if (pinnedStats.uid !== directory.uid) {
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint ownership verification failed stage=lstat'
      )
    }

    await getPosixControlTestHooks().beforeRemovalPathLstat?.(resolvedEndpoint)

    let pathnameStats: Awaited<ReturnType<typeof lstat>>
    try {
      pathnameStats = await lstat(resolvedEndpoint)
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return
      }
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint cleanup failed stage=lstat'
      )
    }
    if (pathnameStats.isSymbolicLink()) {
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint is a symbolic link stage=lstat'
      )
    }
    if (!pathnameStats.isFIFO()) {
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint is not a FIFO stage=lstat'
      )
    }
    if (pathnameStats.uid !== pinnedStats.uid) {
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint ownership verification failed stage=lstat'
      )
    }
    if (!sameFileIdentity(pathnameStats, pinnedStats)) {
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint identity changed stage=lstat'
      )
    }

    // 保持权威 FIFO fd 打开，阻止 unlink 后的 inode generation 被立即复用。
    await getPosixControlTestHooks().beforeEndpointQuarantineRename?.(
      resolvedEndpoint
    )
    await validateControlDirectory(directory, securityFlags, 'lstat')
    const quarantineEndpoint = path.join(
      directory.path,
      `.gsm3-pty-remove-${randomBytes(16).toString('hex')}`
    )
    try {
      await renameEndpointForRemoval(resolvedEndpoint, quarantineEndpoint)
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return
      }
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint quarantine failed stage=lstat'
      )
    }

    let quarantinedStats: Awaited<ReturnType<typeof lstat>>
    try {
      quarantinedStats = await lstat(quarantineEndpoint)
    } catch {
      await restoreQuarantinedEndpoint(quarantineEndpoint, resolvedEndpoint)
      throw new PtyControlStageError(
        'lstat',
        'PTY control quarantined endpoint verification failed stage=lstat'
      )
    }
    if (quarantinedStats.isSymbolicLink() || !quarantinedStats.isFIFO()) {
      await restoreQuarantinedEndpoint(quarantineEndpoint, resolvedEndpoint)
      throw new PtyControlStageError(
        'lstat',
        quarantinedStats.isSymbolicLink()
          ? 'PTY control endpoint is a symbolic link stage=lstat'
          : 'PTY control endpoint is not a FIFO stage=lstat'
      )
    }
    if (
      quarantinedStats.uid !== pinnedStats.uid ||
      !sameFileIdentity(quarantinedStats, pinnedStats)
    ) {
      await restoreQuarantinedEndpoint(quarantineEndpoint, resolvedEndpoint)
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint identity changed stage=lstat'
      )
    }

    try {
      await unlink(quarantineEndpoint)
    } catch {
      await restoreQuarantinedEndpoint(quarantineEndpoint, resolvedEndpoint)
      throw new PtyControlStageError(
        'lstat',
        'PTY control endpoint cleanup failed stage=lstat'
      )
    }
  } finally {
    if (descriptor !== null) {
      await closeRemovalDescriptor(descriptor)
    }
  }
}

export async function removePtyControlEndpoint(
  endpoint: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform === 'win32') {
    return
  }

  // POSIX DAC boundary: effective UID is the OS security principal. Once the
  // parent is eUID-owned, 0700, and ancestor-protected, other UIDs cannot race
  // its entries. Malicious same-eUID processes are outside this boundary because
  // they can already modify the same-UID service data and process.
  try {
    await removePosixPtyControlEndpoint(endpoint)
  } catch (error) {
    throw sanitizePtyControlRemovalError(error)
  }
}
