import type { Socket } from 'socket.io'
import type winston from 'winston'
import type { TerminalManager } from '../modules/terminal/TerminalManager.js'

type TerminalSocketManager = Pick<
  TerminalManager,
  | 'createPty'
  | 'handleInput'
  | 'resizeTerminal'
  | 'closePty'
  | 'reconnectSession'
  | 'hasTarget'
>

type TerminalLogger = Pick<winston.Logger, 'error'>

type PayloadRecord = Record<string, unknown>

function normalizeRecord(payload: unknown): PayloadRecord {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }
  return payload as PayloadRecord
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN
}

function createSafeSocketHandler<T>(
  eventName: string,
  logger: TerminalLogger,
  normalize: (payload: unknown) => T,
  handler: (payload: T) => void | Promise<void>
): (payload: unknown) => void {
  return (payload: unknown): void => {
    void Promise.resolve()
      .then(() => normalize(payload))
      .then(handler)
      .catch(error => {
        logger.error(`终端 Socket 事件处理失败(${eventName}):`, error)
      })
  }
}

export function registerTerminalSocketHandlers(
  socket: Socket,
  terminalManager: TerminalSocketManager,
  logger: TerminalLogger
): void {
  socket.on('create-pty', createSafeSocketHandler(
    'create-pty',
    logger,
    payload => {
      const data = normalizeRecord(payload)
      const cwd = normalizeOptionalString(data.cwd)
      const workingDirectory = cwd ?? normalizeOptionalString(data.workingDirectory)
      return {
        sessionId: normalizeString(data.sessionId),
        name: normalizeOptionalString(data.name),
        cols: normalizeNumber(data.cols),
        rows: normalizeNumber(data.rows),
        workingDirectory,
        enableStreamForward: data.enableStreamForward === true,
        programPath: normalizeOptionalString(data.programPath),
        autoCloseOnForwardExit: data.autoCloseOnForwardExit === true,
        terminalUser: normalizeOptionalString(data.terminalUser)
      }
    },
    async data => {
      await terminalManager.createPty(socket, data)
    }
  ))

  socket.on('terminal-input', createSafeSocketHandler(
    'terminal-input',
    logger,
    payload => {
      const data = normalizeRecord(payload)
      return {
        sessionId: normalizeString(data.sessionId),
        data: normalizeString(data.data)
      }
    },
    async data => {
      await terminalManager.handleInput(socket, data)
    }
  ))

  socket.on('terminal-resize', createSafeSocketHandler(
    'terminal-resize',
    logger,
    payload => {
      const data = normalizeRecord(payload)
      return {
        sessionId: normalizeString(data.sessionId),
        cols: normalizeNumber(data.cols),
        rows: normalizeNumber(data.rows)
      }
    },
    async data => {
      await terminalManager.resizeTerminal(socket, data)
    }
  ))

  socket.on('close-pty', createSafeSocketHandler(
    'close-pty',
    logger,
    payload => {
      const data = normalizeRecord(payload)
      return { sessionId: normalizeString(data.sessionId) }
    },
    async data => {
      await terminalManager.closePty(socket, data)
    }
  ))

  socket.on('reconnect-session', createSafeSocketHandler(
    'reconnect-session',
    logger,
    payload => {
      const data = normalizeRecord(payload)
      return { sessionId: normalizeString(data.sessionId) }
    },
    async data => {
      const result = await terminalManager.reconnectSession(socket, data.sessionId)
      if (result === 'pending') {
        return
      }
      if (result === 'not-found') {
        socket.emit('session-reconnect-failed', { sessionId: data.sessionId })
        return
      }
      socket.emit('session-reconnected', {
        sessionId: data.sessionId,
        state: result
      })
    }
  ))
}
