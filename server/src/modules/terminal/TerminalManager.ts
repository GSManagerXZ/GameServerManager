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

const execAsync = promisify(exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface PtySession {
  id: string
  name: string // 终端会话名称
  process: ChildProcess
  socket: Socket
  workingDirectory: string
  createdAt: Date
  lastActivity: Date
  disconnected?: boolean
  disconnectedAt?: Date
  outputBuffer: string[] // 存储终端输出历史
  streamForwardProcess?: ChildProcess // 输出流转发进程
  enableStreamForward?: boolean // 是否启用输出流转发
  programPath?: string // 程序启动参数的绝对路径
  autoCloseOnForwardExit?: boolean // 转发进程退出时是否自动关闭终端会话
  fallbackRetried?: boolean // 是否已尝试过回退重试
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

export class TerminalManager {
  private sessions: Map<string, PtySession> = new Map()
  private io: SocketIOServer
  private logger: winston.Logger
  private ptyPath: string
  private sessionManager: TerminalSessionManager
  private configManager: ConfigManager

  constructor(io: SocketIOServer, logger: winston.Logger, configManager: ConfigManager) {
    this.io = io
    this.logger = logger
    this.configManager = configManager
    this.sessionManager = new TerminalSessionManager(logger)
    
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
    
    // 通过 ptyManager 获取 PTY 路径（已在启动时确保下载）
    try {
      this.ptyPath = await ptyManager.getPtyPath()
      this.logger.info(`终端管理器初始化完成，PTY路径: ${this.ptyPath}`)
    } catch (error: any) {
      this.logger.error(`无法找到 PTY 文件: ${error.message}`)
      // 使用 ptyManager 获取平台对应的文件名作为备用路径
      try {
        const ptyFileName = ptyManager.getBinaryName()
        this.ptyPath = path.join(process.cwd(), 'data', 'lib', ptyFileName)
        this.logger.warn(`使用备用 PTY 路径: ${this.ptyPath}`)
      } catch (nameError: any) {
        this.logger.error(`无法获取 PTY 文件名: ${nameError.message}`)
      }
    }
  }

  /**
   * 创建新的PTY会话
   */
  public async createPty(socket: Socket, data: CreatePtyData): Promise<void> {
    try {
      const { sessionId, name, cols, rows, workingDirectory = process.cwd(), enableStreamForward = false, programPath, autoCloseOnForwardExit = false, terminalUser } = data
      const sessionName = name || `终端会话 ${sessionId.slice(-8)}`

       // 获取终端配置和默认用户（提升到方法开始处）
      const terminalConfig = this.configManager.getTerminalConfig()
      // 优先使用传入的terminalUser，如果没有则使用配置的defaultUser
      const defaultUser = terminalUser || terminalConfig.defaultUser

      // 如果是Linux系统且使用非root用户，先设置工作目录权限为777
      if (os.platform() === 'linux' && defaultUser && defaultUser.trim() !== '' && defaultUser !== 'root') {
        try {
          await this.setDirectoryPermissions777(workingDirectory)
          this.logger.info(`已为非root用户 ${defaultUser} 设置工作目录权限为777: ${workingDirectory}`)
        } catch (error) {
          this.logger.warn(`设置工作目录权限失败: ${error}`)
        }
      }
      
      // 验证输出流转发参数
      if (enableStreamForward && os.platform() !== 'win32') {
        this.logger.warn(`输出流转发功能仅在Windows平台支持，当前平台: ${os.platform()}`)
        socket.emit('terminal-error', {
          sessionId,
          error: '输出流转发功能仅在Windows平台支持'
        })
        return
      }
      
      if (enableStreamForward && !programPath) {
        this.logger.warn(`启用输出流转发时必须提供程序启动命令`)
        socket.emit('terminal-error', {
          sessionId,
          error: '启用输出流转发时必须提供程序启动命令'
        })
        return
      }
      
      if (enableStreamForward && programPath) {
        // 解析命令行，检查可执行文件路径是否为绝对路径
        const commandLine = programPath.trim()
        let executablePath: string
        
        if (commandLine.startsWith('"')) {
          // 处理带引号的可执行文件路径
          const endQuoteIndex = commandLine.indexOf('"', 1)
          if (endQuoteIndex === -1) {
            this.logger.warn(`未找到匹配的引号: ${commandLine}`)
            socket.emit('terminal-error', {
              sessionId,
              error: '未找到匹配的引号'
            })
            return
          }
          executablePath = commandLine.substring(1, endQuoteIndex)
        } else {
          // 处理不带引号的路径
          const parts = commandLine.split(/\s+/)
          executablePath = parts[0]
        }
        
        if (!path.isAbsolute(executablePath)) {
          this.logger.warn(`可执行文件路径必须是绝对路径: ${executablePath}`)
          socket.emit('terminal-error', {
            sessionId,
            error: '可执行文件路径必须是绝对路径'
          })
          return
        }
      }
      
      this.logger.info(`创建PTY会话: ${sessionId} (${sessionName}), 大小: ${cols}x${rows}`)
      
      // 检查会话是否已存在
      if (this.sessions.has(sessionId)) {
        this.logger.warn(`会话 ${sessionId} 已存在，先关闭旧会话`)
        this.closePty(socket, { sessionId })
      }
      
      // 构建PTY命令参数
      const args = [
        '-dir', workingDirectory,
        '-size', `${cols},${rows}`,
        '-coder', 'UTF-8'
      ]
      
      // 根据操作系统设置默认shell
      if (os.platform() === 'win32') {
        args.push('-cmd', JSON.stringify(['powershell.exe']))
      } else {
        // Linux下检查是否配置了默认用户
        if (defaultUser && defaultUser.trim() !== '') {
          // 检查用户是否存在
          const userExists = await this.checkUserExists(defaultUser)
          if (userExists) {
            // 检查sudo命令是否存在
            const sudoExists = await this.checkCommandExists('sudo')
            
            if (sudoExists) {
              // 如果sudo存在，使用sudo切换用户，使用简化的方式
              args.push('-cmd', JSON.stringify([
                'sudo', '-u', defaultUser, '/bin/bash', '-c', 
                `cd "${workingDirectory}" && /bin/bash --login`
              ]))
              this.logger.info(`使用sudo切换到默认用户启动终端: ${defaultUser}，工作目录: ${workingDirectory}`)
            } else {
              // 如果sudo不存在，检查su命令
              const suExists = await this.checkCommandExists('su')
              
              if (suExists) {
                // 使用su命令切换用户，使用简化的方式
                args.push('-cmd', JSON.stringify([
                  'su', defaultUser, '-c', 
                  `cd "${workingDirectory}" && /bin/bash --login`
                ]))
                this.logger.info(`使用su切换到默认用户启动终端: ${defaultUser}，工作目录: ${workingDirectory}`)
              } else {
                // 既没有sudo也没有su，记录警告并使用当前用户
                this.logger.warn(`系统中既没有sudo也没有su命令，无法切换到用户 '${defaultUser}'，使用当前用户`)
                args.push('-cmd', JSON.stringify(['/bin/bash', '--login']))
              }
            }
          } else {
            // 用户不存在，记录警告并使用默认bash
            this.logger.warn(`配置的默认用户 '${defaultUser}' 不存在，使用默认bash`)
            args.push('-cmd', JSON.stringify(['/bin/bash', '--login']))
          }
        } else {
          // 没有配置默认用户，使用默认bash
          args.push('-cmd', JSON.stringify(['/bin/bash', '--login']))
        }
      }
      
      this.logger.info(`启动PTY进程: ${this.ptyPath} ${args.join(' ')}`)
      
      // 启动PTY进程
      const ptyProcess = spawn(this.ptyPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDirectory,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        },
        // Linux下创建新的进程组，确保信号正确传递
        detached: os.platform() !== 'win32'
      })
      
      this.logger.info(`PTY进程已启动，PID: ${ptyProcess.pid}`)
      
      // 创建会话对象
      const session: PtySession = {
        id: sessionId,
        name: sessionName,
        process: ptyProcess,
        socket,
        workingDirectory,
        createdAt: new Date(),
        lastActivity: new Date(),
        outputBuffer: [],
        enableStreamForward,
        programPath,
        autoCloseOnForwardExit
      }
      
      // 保存会话到内存
      this.sessions.set(sessionId, session)
      
      // 持久化保存会话信息
      this.sessionManager.saveSession({
        id: sessionId,
        name: sessionName,
        workingDirectory,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        isActive: true
      }).catch(error => {
        this.logger.error(`保存会话到配置文件失败: ${sessionId}`, error)
      })
      
      // 处理PTY输出
      ptyProcess.stdout?.on('data', (data: Buffer) => {
        session.lastActivity = new Date()
        const output = data.toString()
        
        // 保存到输出缓存，限制缓存大小为1000条
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift() // 移除最旧的输出
        }
        
        this.logger.debug(`PTY输出 ${sessionId}: ${JSON.stringify(output)}`)
        socket.emit('terminal-output', {
          sessionId,
          data: output
        })
      })
      
      // 处理PTY错误输出
      ptyProcess.stderr?.on('data', (data: Buffer) => {
        session.lastActivity = new Date()
        const output = data.toString()
        
        // 保存到输出缓存，限制缓存大小为1000条
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift() // 移除最旧的输出
        }
        
        this.logger.warn(`PTY错误输出 ${sessionId}: ${JSON.stringify(output)}`)
        socket.emit('terminal-output', {
          sessionId,
          data: output
        })
      })
      
      // 处理进程退出
      ptyProcess.on('exit', (code, signal) => {
        this.logger.info(`PTY进程退出: ${sessionId}, 退出码: ${code}, 信号: ${signal}`)
        
        // 如果退出码为0但进程立即退出，可能是命令执行有问题
        if (code === 0 && (Date.now() - session.createdAt.getTime()) < 1000) {
          this.logger.warn(`PTY进程启动后立即退出，可能是用户切换命令有问题: ${sessionId}`)
          this.logger.warn(`使用的命令参数: ${JSON.stringify(args)}`)
          
          // 如果是用户切换失败，尝试使用当前用户重新启动
          if (defaultUser && defaultUser.trim() !== '' && !session.fallbackRetried) {
            this.logger.info(`尝试使用当前用户重新启动终端: ${sessionId}`)
            session.fallbackRetried = true
            
            // 使用当前用户重新启动
            setTimeout(() => {
              this.createPtyFallback(sessionId, sessionName, workingDirectory, socket, enableStreamForward, programPath, autoCloseOnForwardExit)
            }, 100)
            return
          }
        }
        
        // 清理输出流转发进程
        if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
          this.logger.info(`PTY退出时清理输出流转发进程: ${sessionId}`)
          this.forceKillProcess(session.streamForwardProcess, '输出流转发进程', () => {
            session.streamForwardProcess = undefined
          })
        }
        
        socket.emit('terminal-exit', {
          sessionId,
          code: code || 0,
          signal
        })
        
        // 从内存中删除会话
        this.sessions.delete(sessionId)
        
        // 从持久化存储中删除会话
        this.sessionManager.removeSession(sessionId).catch(error => {
          this.logger.error(`PTY退出时从配置文件删除会话失败: ${sessionId}`, error)
        })
      })
      
      // 处理进程错误
      ptyProcess.on('error', (error) => {
        this.logger.error(`PTY进程错误 ${sessionId}:`, error)
        
        // 清理输出流转发进程
        if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
          this.logger.info(`PTY错误时清理输出流转发进程: ${sessionId}`)
          this.forceKillProcess(session.streamForwardProcess, '输出流转发进程', () => {
            session.streamForwardProcess = undefined
          })
        }
        
        socket.emit('terminal-error', {
          sessionId,
          error: error.message
        })
        
        // 从内存中删除会话
        this.sessions.delete(sessionId)
        
        // 从持久化存储中删除会话
        this.sessionManager.removeSession(sessionId).catch(error => {
          this.logger.error(`PTY错误时从配置文件删除会话失败: ${sessionId}`, error)
        })
      })
      
      // Linux下设置进程组，确保信号正确传递
      if (os.platform() !== 'win32' && ptyProcess.pid) {
        try {
          // 将PTY进程设置为新进程组的组长
          process.kill(-ptyProcess.pid, 0) // 测试进程组是否存在
          this.logger.info(`PTY进程组设置成功: ${ptyProcess.pid}`)
        } catch (error) {
          this.logger.warn(`设置PTY进程组失败: ${error}`)
        }
      }
      
      // 如果启用了输出流转发，启动转发进程
      if (enableStreamForward && programPath) {
        this.startStreamForwardProcess(session, programPath)
      }
      
      // 发送创建成功事件
      socket.emit('pty-created', {
        sessionId,
        workingDirectory
      })
      
      this.logger.info(`PTY会话创建成功: ${sessionId}`)
      
      // 发送初始欢迎信息和提示符
      setTimeout(() => {
        if (ptyProcess.stdin && !ptyProcess.stdin.destroyed) {
          // 发送一个回车来触发初始提示符
          ptyProcess.stdin.write('\r')
        }
      }, 500) // 延迟500ms确保PTY完全初始化
      
    } catch (error) {
      this.logger.error(`创建PTY会话失败:`, error)
      socket.emit('terminal-error', {
        sessionId: data.sessionId,
        error: error instanceof Error ? error.message : '未知错误'
      })
    }
  }

  /**
   * 强制终止进程
   */
  private forceKillProcess(process: any, processName: string, onKilled?: () => void): void {
    if (!process || process.killed) {
      onKilled?.()
      return
    }

    const pid = process.pid
    this.logger.info(`开始强制终止${processName}，PID: ${pid}`)

    // 监听进程退出事件
    const onExit = () => {
      this.logger.info(`${processName}已退出: ${pid}`)
      onKilled?.()
    }
    
    process.once('exit', onExit)

    try {
      // Linux下优先处理进程组
      if (os.platform() !== 'win32' && pid) {
        try {
          // 首先尝试向整个进程组发送SIGINT信号
          process.kill(-pid, 'SIGINT')
          this.logger.info(`已向${processName}进程组发送SIGINT信号: -${pid}`)
        } catch (error) {
          // 如果进程组不存在，向单个进程发送信号
          this.logger.warn(`向进程组发送信号失败，尝试向单个进程发送: ${error}`)
          process.kill('SIGINT')
          this.logger.info(`已向${processName}发送SIGINT信号: ${pid}`)
        }
      } else {
        // Windows下直接向进程发送信号
        process.kill('SIGINT')
        this.logger.info(`已向${processName}发送SIGINT信号: ${pid}`)
      }

      // 设置2秒超时，如果进程还没退出就使用SIGTERM
      setTimeout(() => {
        if (!process.killed) {
          this.logger.warn(`${processName}未响应SIGINT信号，尝试SIGTERM: ${pid}`)
          try {
            if (os.platform() !== 'win32' && pid) {
              try {
                // 向进程组发送SIGTERM
                process.kill(-pid, 'SIGTERM')
                this.logger.info(`已向${processName}进程组发送SIGTERM信号: -${pid}`)
              } catch (error) {
                // 向单个进程发送SIGTERM
                process.kill('SIGTERM')
                this.logger.info(`已向${processName}发送SIGTERM信号: ${pid}`)
              }
            } else {
              process.kill('SIGTERM')
            }
          } catch (error) {
            this.logger.warn(`发送SIGTERM信号失败:`, error)
          }

          // 再等待2秒，如果还没退出就强制杀死
          setTimeout(() => {
            if (!process.killed) {
              this.logger.warn(`${processName}未响应SIGTERM信号，强制杀死: ${pid}`)
              try {
                if (os.platform() !== 'win32' && pid) {
                  try {
                    // 向进程组发送SIGKILL
                    process.kill(-pid, 'SIGKILL')
                    this.logger.info(`已向${processName}进程组发送SIGKILL信号: -${pid}`)
                  } catch (error) {
                    // 向单个进程发送SIGKILL
                    process.kill('SIGKILL')
                    this.logger.info(`已向${processName}发送SIGKILL信号: ${pid}`)
                  }
                } else {
                  process.kill('SIGKILL')
                }
              } catch (error) {
                this.logger.error(`强制杀死进程失败:`, error)
                
                // 在Windows上尝试使用taskkill命令
                if (os.platform() === 'win32' && pid) {
                  exec(`taskkill /F /PID ${pid}`, (error: any) => {
                    if (error) {
                      this.logger.error(`taskkill命令执行失败:`, error)
                    } else {
                      this.logger.info(`使用taskkill成功终止${processName}: ${pid}`)
                    }
                    // 即使taskkill失败，也调用回调函数清理引用
                    if (!process.killed) {
                      process.removeListener('exit', onExit)
                      onKilled?.()
                    }
                  })
                } else {
                  // 非Windows平台，尝试使用系统命令强制杀死进程组
                  if (pid) {
                    exec(`pkill -9 -g ${pid}`, (error: any) => {
                      if (error) {
                        this.logger.error(`pkill命令执行失败:`, error)
                      } else {
                        this.logger.info(`使用pkill成功终止${processName}进程组: ${pid}`)
                      }
                      // 强制清理引用
                      if (!process.killed) {
                        process.removeListener('exit', onExit)
                        onKilled?.()
                      }
                    })
                  } else {
                    // 如果所有方法都失败，强制清理引用
                    process.removeListener('exit', onExit)
                    onKilled?.()
                  }
                }
              }
            }
          }, 2000)
        }
      }, 2000)

    } catch (error) {
      this.logger.error(`强制终止${processName}失败:`, error)
      process.removeListener('exit', onExit)
      onKilled?.()
    }
  }

  /**
   * 重启输出流转发进程
   */
  public restartStreamForwardProcess(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || !session.enableStreamForward || !session.programPath) {
      this.logger.warn(`无法重启转发进程: 会话不存在或未启用输出流转发: ${sessionId}`)
      return false
    }

    // 先终止现有进程
    if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
      this.forceKillProcess(session.streamForwardProcess, '输出流转发进程', () => {
        session.streamForwardProcess = undefined
        // 重新启动进程
        this.startStreamForwardProcess(session, session.programPath!)
      })
    } else {
      // 直接启动新进程
      this.startStreamForwardProcess(session, session.programPath)
    }

    return true
  }

  /**
   * 启动输出流转发进程
   */
  private startStreamForwardProcess(session: PtySession, programPath: string): void {
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
      const forwardProcess = spawn(executablePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: session.workingDirectory,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        },
        detached: os.platform() !== 'win32' // 在非Windows平台创建独立进程组
      })
      
      session.streamForwardProcess = forwardProcess
      
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
        
        // 如果配置了自动关闭，且转发进程异常退出，则关闭整个终端会话
        if (session.autoCloseOnForwardExit && (code !== 0 || signal)) {
          session.socket.emit('terminal-output', {
            sessionId: session.id,
            data: `\r\n[转发进程异常退出，正在关闭终端会话...]\r\n`
          })
          
          // 延迟关闭，让用户看到消息
          setTimeout(() => {
            this.closePty(session.socket, { sessionId: session.id })
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
        
        session.streamForwardProcess = undefined
      })
      
      // 处理转发进程错误
      forwardProcess.on('error', (error: NodeJS.ErrnoException) => {
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
        session.streamForwardProcess = undefined
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
    try {
      const { sessionId, data: inputData } = data
      const session = this.sessions.get(sessionId)
      
      if (!session) {
        this.logger.warn(`会话不存在: ${sessionId}`)
        socket.emit('terminal-error', {
          sessionId,
          error: '会话不存在'
        })
        return
      }
      
      // 如果会话之前断开连接，现在重新连接
      if (session.disconnected) {
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
          
          const success = this.restartStreamForwardProcess(sessionId)
          if (!success) {
            session.socket.emit('terminal-output', {
              sessionId: session.id,
              data: `\r\n[重启转发进程失败]\r\n`
            })
          }
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
          if (session.process.stdin && !session.process.stdin.destroyed) {
            session.process.stdin.write(inputData)
          }
          return
        }
        
        // 如果有输出流转发进程，优先处理它
        if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
          const pid = session.streamForwardProcess.pid
          this.logger.info(`向输出流转发进程(PID: ${pid})及其子进程发送${controlChar.name}信号...`)

          if (os.platform() === 'win32') {
            // Windows下的处理
            if (controlChar.signal === 'SIGINT') {
              // 使用 taskkill /T 来优雅地终止整个进程树
              exec(`taskkill /PID ${pid} /T`, (err) => {
                if (err) {
                  this.logger.error(`使用 taskkill /T 终止进程树 PID: ${pid} 失败:`, err)
                  // 作为后备，尝试原来的方法
                  try {
                    session.streamForwardProcess.kill('SIGINT')
                  } catch (killError) {
                    this.logger.error(`后备的 kill SIGINT 信号也失败了:`, killError)
                  }
                } else {
                  this.logger.info(`成功通过 taskkill /T 向进程树 PID: ${pid} 发送关闭信号`)
                }
              })
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
          if (session.process.stdin && !session.process.stdin.destroyed) {
            session.process.stdin.write(inputData)
          }
        }
        return
      }
      
      // 发送输入到PTY进程
      if (session.process.stdin && !session.process.stdin.destroyed) {
        session.process.stdin.write(inputData)
      } else {
        this.logger.warn(`PTY进程stdin不可用: ${sessionId}`)
      }
      
      // 如果启用了输出流转发，也将输入转发到目标进程
      if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
        if (session.streamForwardProcess.stdin && !session.streamForwardProcess.stdin.destroyed) {
          session.streamForwardProcess.stdin.write(inputData)
        }
      }
      
    } catch (error) {
      this.logger.error(`处理终端输入失败:`, error)
      socket.emit('terminal-error', {
        sessionId: data.sessionId,
        error: error instanceof Error ? error.message : '未知错误'
      })
    }
  }

  /**
   * 调整终端大小
   */
  public resizeTerminal(socket: Socket, data: TerminalResizeData): void {
    try {
      const { sessionId, cols, rows } = data
      const session = this.sessions.get(sessionId)
      
      if (!session) {
        this.logger.warn(`会话不存在: ${sessionId}`)
        return
      }
      
      this.logger.info(`调整终端大小: ${sessionId}, ${cols}x${rows}`)
      
      // 更新最后活动时间
      session.lastActivity = new Date()
      
      // 注意：由于PTY进程的限制，我们无法直接获取当前终端大小
      // 这里直接进行大小调整操作，让PTY进程处理实际的大小变化
      
      // 由于当前PTY程序在启动时设置固定大小，动态调整大小功能有限
      // 我们只发送SIGWINCH信号通知进程窗口大小变化，不发送可见的命令到终端
      
      // 发送SIGWINCH信号通知子进程窗口大小变化
      try {
        if (session.process.pid && !session.process.killed) {
          process.kill(session.process.pid, 'SIGWINCH')
          this.logger.info(`已发送SIGWINCH信号调整终端大小: ${sessionId}, ${cols}x${rows}`)
        }
      } catch (signalError) {
        this.logger.debug(`发送SIGWINCH信号失败: ${signalError}`)
      }
      
      // 通知前端大小调整完成
      session.socket.emit('terminal-resized', {
        sessionId,
        cols,
        rows
      })
      
    } catch (error) {
      this.logger.error(`调整终端大小失败:`, error)
    }
  }

  /**
   * 关闭PTY会话
   */
  public closePty(socket: Socket, data: { sessionId: string }): void {
    try {
      const { sessionId } = data
      const session = this.sessions.get(sessionId)
      
      if (!session) {
        this.logger.warn(`尝试关闭不存在的会话: ${sessionId}`)
        return
      }
      
      this.logger.info(`关闭PTY会话: ${sessionId}`)
      
      // 终止输出流转发进程
      if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
        this.logger.info(`终止输出流转发进程: ${sessionId}`)
        
        // 关闭输入流
        if (session.streamForwardProcess.stdin && !session.streamForwardProcess.stdin.destroyed) {
          session.streamForwardProcess.stdin.end()
        }
        
        // 使用强制终止方法
        this.forceKillProcess(session.streamForwardProcess, '输出流转发进程', () => {
          session.streamForwardProcess = undefined
        })
      }
      
      // 终止PTY进程
      if (!session.process.killed) {
        // 关闭输入流
        if (session.process.stdin && !session.process.stdin.destroyed) {
          session.process.stdin.end()
        }
        
        // 发送SIGTERM信号
        session.process.kill('SIGTERM')
        
        // 如果进程在3秒内没有退出，强制杀死
        setTimeout(() => {
          if (!session.process.killed) {
            this.logger.warn(`强制终止PTY进程: ${sessionId}`)
            session.process.kill('SIGKILL')
          }
        }, 3000)
      }
      
      // 从会话列表中移除
      this.sessions.delete(sessionId)
      
      // 从持久化存储中移除会话
      this.sessionManager.removeSession(sessionId).catch(error => {
        this.logger.error(`从配置文件删除会话失败: ${sessionId}`, error)
      })
      
      // 通知客户端会话已关闭
      socket.emit('pty-closed', { sessionId })
      
    } catch (error) {
      this.logger.error(`关闭PTY会话失败:`, error)
    }
  }

  /**
   * 处理客户端断开连接
   */
  public handleDisconnect(socket: Socket): void {
    try {
      // 找到属于该socket的所有会话并标记为断开状态
      const sessionsToMark: string[] = []
      
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.socket.id === socket.id) {
          sessionsToMark.push(sessionId)
        }
      }
      
      for (const sessionId of sessionsToMark) {
        const session = this.sessions.get(sessionId)
        if (session) {
          // 标记会话为断开状态，但不关闭PTY进程
          session.disconnected = true
          session.disconnectedAt = new Date()
          session.lastActivity = new Date()
          
          // 更新持久化状态
          this.sessionManager.setSessionActive(sessionId, false).catch(error => {
            this.logger.error(`更新会话断开状态失败: ${sessionId}`, error)
          })
          
          this.logger.info(`会话 ${sessionId} 已标记为断开状态`)
        }
      }
      
      if (sessionsToMark.length > 0) {
        this.logger.info(`客户端断开连接，标记了 ${sessionsToMark.length} 个会话为断开状态`)
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
          this.closePty(session.socket, { sessionId })
        }
      }
      
    } catch (error) {
      this.logger.error(`清理不活跃会话失败:`, error)
    }
  }

  /**
   * 重新连接现有会话
   */
  public reconnectSession(socket: Socket, sessionId: string): boolean {
    try {
      const session = this.sessions.get(sessionId)
      
      if (!session) {
        this.logger.warn(`尝试重连不存在的会话: ${sessionId}`)
        return false
      }
      
      // 更新socket连接
      session.socket = socket
      session.disconnected = false
      session.disconnectedAt = undefined
      session.lastActivity = new Date()
      
      // 更新持久化状态
      this.sessionManager.setSessionActive(sessionId, true).catch(error => {
        this.logger.error(`更新会话重连状态失败: ${sessionId}`, error)
      })

      this.logger.info(`会话 ${sessionId} 重新连接成功`)
      
      // 重新设置PTY输出监听
      session.process.stdout?.removeAllListeners('data')
      session.process.stderr?.removeAllListeners('data')
      
      // 发送历史输出给重连的客户端（只发送一次）
      if (session.outputBuffer.length > 0) {
        const historicalOutput = session.outputBuffer.join('')
        socket.emit('terminal-output', {
          sessionId: session.id,
          data: historicalOutput,
          isHistorical: true
        })
      }
      
      session.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString()
        
        // 保存到输出缓存，限制缓存大小为1000条
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift() // 移除最旧的输出
        }
        
        socket.emit('terminal-output', {
          sessionId: session.id,
          data: output
        })
      })
      
      session.process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        
        // 保存到输出缓存，限制缓存大小为1000条
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift() // 移除最旧的输出
        }
        
        socket.emit('terminal-output', {
          sessionId: session.id,
          data: output
        })
      })
      
      return true
    } catch (error) {
      this.logger.error(`重连会话失败:`, error)
      return false
    }
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

  /**
   * 使用当前用户创建PTY会话（回退方案）
   */
  private async createPtyFallback(sessionId: string, sessionName: string, workingDirectory: string, socket: Socket, enableStreamForward?: boolean, programPath?: string, autoCloseOnForwardExit?: boolean): Promise<void> {
    try {
      this.logger.info(`使用当前用户创建PTY回退会话: ${sessionId}`)
      
      // 构建PTY命令参数，使用当前用户
      const args = [
        '-dir', workingDirectory,
        '-size', '100,30', // 使用默认大小
        '-coder', 'UTF-8'
      ]
      
      // 使用默认bash，不切换用户
      args.push('-cmd', JSON.stringify(['/bin/bash', '--login']))
      this.logger.info(`使用当前用户启动终端，工作目录: ${workingDirectory}`)
      
      this.logger.info(`启动PTY回退进程: ${this.ptyPath} ${args.join(' ')}`)
      
      // 启动PTY进程
      const ptyProcess = spawn(this.ptyPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDirectory,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        },
        detached: os.platform() !== 'win32'
      })
      
      this.logger.info(`PTY回退进程已启动，PID: ${ptyProcess.pid}`)
      
      // 创建会话对象
      const session: PtySession = {
        id: sessionId,
        name: sessionName,
        process: ptyProcess,
        socket,
        workingDirectory,
        createdAt: new Date(),
        lastActivity: new Date(),
        outputBuffer: [],
        enableStreamForward,
        programPath,
        autoCloseOnForwardExit,
        fallbackRetried: true // 标记为已重试
      }
      
      // 保存会话到内存
      this.sessions.set(sessionId, session)
      
      // 处理PTY输出
      ptyProcess.stdout?.on('data', (data: Buffer) => {
        session.lastActivity = new Date()
        const output = data.toString()
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift()
        }
        socket.emit('terminal-output', { sessionId, data: output })
      })
      
      // 处理PTY错误输出
      ptyProcess.stderr?.on('data', (data: Buffer) => {
        session.lastActivity = new Date()
        const output = data.toString()
        session.outputBuffer.push(output)
        if (session.outputBuffer.length > 1000) {
          session.outputBuffer.shift()
        }
        socket.emit('terminal-output', { sessionId, data: output })
      })
      
      // 处理进程退出
      ptyProcess.on('exit', (code, signal) => {
        this.logger.info(`PTY回退进程退出: ${sessionId}, 退出码: ${code}, 信号: ${signal}`)
        socket.emit('terminal-exit', { sessionId, code: code || 0, signal })
        this.sessions.delete(sessionId)
      })
      
      // 处理进程错误
      ptyProcess.on('error', (error) => {
        this.logger.error(`PTY回退进程错误 ${sessionId}:`, error)
        socket.emit('terminal-error', { sessionId, error: error.message })
        this.sessions.delete(sessionId)
      })
      
      // 发送创建成功事件
      socket.emit('pty-created', { sessionId, workingDirectory })
      this.logger.info(`PTY回退会话创建成功: ${sessionId}`)
      
    } catch (error) {
      this.logger.error(`创建PTY回退会话失败:`, error)
      socket.emit('terminal-error', {
        sessionId,
        error: error instanceof Error ? error.message : '未知错误'
      })
    }
  }

  /**
   * 清理所有会话
   */
  public cleanup(): void {
    this.logger.info('开始清理所有终端会话...')
    
    for (const [sessionId, session] of this.sessions.entries()) {
      try {
        // 清理输出流转发进程
        if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
          this.logger.info(`清理输出流转发进程: ${sessionId}`)
          
          // 关闭输入流
          if (session.streamForwardProcess.stdin && !session.streamForwardProcess.stdin.destroyed) {
            session.streamForwardProcess.stdin.end()
          }
          
          session.streamForwardProcess.kill('SIGTERM')
          
          // 延迟强制杀死
          setTimeout(() => {
            if (session.streamForwardProcess && !session.streamForwardProcess.killed) {
              session.streamForwardProcess.kill('SIGKILL')
            }
          }, 1000)
        }
        
        // 清理PTY进程
        if (!session.process.killed) {
          // 关闭输入流
          if (session.process.stdin && !session.process.stdin.destroyed) {
            session.process.stdin.end()
          }
          
          session.process.kill('SIGTERM')
          
          // 延迟强制杀死
          setTimeout(() => {
            if (!session.process.killed) {
              session.process.kill('SIGKILL')
            }
          }, 1000)
        }
      } catch (error) {
        this.logger.error(`清理会话 ${sessionId} 失败:`, error)
      }
    }
    
    this.sessions.clear()
    this.logger.info('所有终端会话已清理完成')
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
    if (this.io) {
      const room = this.io.sockets.adapter.rooms.get('terminal-processes')
      if (!room || room.size === 0) {
        // 没有客户端订阅了，停止监控
        this.stopActiveProcessesMonitoring()
      }
    }
  }
}