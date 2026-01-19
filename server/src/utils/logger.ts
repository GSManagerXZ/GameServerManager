import winston from 'winston'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import type { Server as SocketIOServer } from 'socket.io'

// 确保日志目录存在
const logDir = path.resolve(process.cwd(), 'logs')
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

// 创建日志事件发射器（用于实时日志广播）
class ConsoleLogBuffer extends EventEmitter {
  private buffer: string[] = []
  private maxBufferSize = 500 // 保留最近500条日志
  private io: SocketIOServer | null = null
  private originalStdoutWrite: typeof process.stdout.write | null = null
  private originalStderrWrite: typeof process.stderr.write | null = null
  private isCapturing = false

  // 设置 Socket.IO 实例
  setSocketIO(io: SocketIOServer) {
    this.io = io
  }

  // 开始捕获 stdout/stderr
  startCapturing() {
    if (this.isCapturing) return
    this.isCapturing = true

    // 保存原始方法
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout)
    this.originalStderrWrite = process.stderr.write.bind(process.stderr)

    // 拦截 stdout
    process.stdout.write = ((chunk: any, encoding?: any, callback?: any): boolean => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      // 按行分割并添加到缓冲区（过滤空行）
      const lines = text.split('\n').filter((line: string) => line.trim())
      lines.forEach((line: string) => this.addLog(line))
      // 调用原始方法
      return this.originalStdoutWrite!(chunk, encoding, callback)
    }) as typeof process.stdout.write

    // 拦截 stderr
    process.stderr.write = ((chunk: any, encoding?: any, callback?: any): boolean => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      const lines = text.split('\n').filter((line: string) => line.trim())
      lines.forEach((line: string) => this.addLog(`[ERROR] ${line}`))
      return this.originalStderrWrite!(chunk, encoding, callback)
    }) as typeof process.stderr.write
  }

  // 停止捕获
  stopCapturing() {
    if (!this.isCapturing) return
    this.isCapturing = false

    if (this.originalStdoutWrite) {
      process.stdout.write = this.originalStdoutWrite
    }
    if (this.originalStderrWrite) {
      process.stderr.write = this.originalStderrWrite
    }
  }

  addLog(log: string) {
    // 去除 ANSI 颜色代码
    const cleanLog = log.replace(/\x1B\[[0-9;]*[mGKH]/g, '')

    this.buffer.push(cleanLog)
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift()
    }
    this.emit('log', cleanLog)

    // 通过 Socket.io 广播到订阅的房间
    if (this.io) {
      this.io.to('console-logs').emit('console-log', { line: cleanLog })
    }
  }

  getRecentLogs(count: number = 100): string[] {
    return this.buffer.slice(-count)
  }

  clear() {
    this.buffer = []
  }
}

export const consoleLogBuffer = new ConsoleLogBuffer()

// 启动时自动开始捕获
consoleLogBuffer.startCapturing()

// 自定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`
  })
)

// 创建日志器
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // 控制台输出（stdout 拦截会自动捕获）
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),


    // 所有日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),

    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),

    // 终端日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'terminal.log'),
      level: 'info',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 3,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [TERMINAL]: ${message}`
        })
      )
    }),

    // 游戏日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'games.log'),
      level: 'info',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 3,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [GAMES]: ${message}`
        })
      )
    }),

    // 系统监控日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'system.log'),
      level: 'info',
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 3,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [SYSTEM]: ${message}`
        })
      )
    })
  ],

  // 处理未捕获的异常
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    })
  ],

  // 处理未处理的Promise拒绝
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    })
  ]
})

// 创建专用日志器
export const terminalLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, message }) => {
      return `${timestamp} ${message}`
    })
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'terminal.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 3,
      tailable: true
    })
  ]
})

export const gameLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, message }) => {
      return `${timestamp} ${message}`
    })
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'games.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 3,
      tailable: true
    })
  ]
})

export const systemLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, message }) => {
      return `${timestamp} ${message}`
    })
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'system.log'),
      maxsize: 20 * 1024 * 1024,
      maxFiles: 3,
      tailable: true
    })
  ]
})

// 在生产环境中不输出到控制台
if (process.env.NODE_ENV === 'production') {
  logger.remove(logger.transports[0]) // 移除控制台传输
}

export default logger