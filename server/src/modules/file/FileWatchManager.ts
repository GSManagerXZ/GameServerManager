import { EventEmitter } from 'events'
import { watch, FSWatcher } from 'fs'
import { stat } from 'fs/promises'
import * as path from 'path'
import { Socket } from 'socket.io'
import type { Logger } from 'winston'

interface WatchedFile {
  filePath: string
  watcher: FSWatcher
  lastModified: number
  socketIds: Set<string>
  ignoreNextChange: boolean // 忽略下一次变化（用于保存操作）
}

export class FileWatchManager extends EventEmitter {
  private watchedFiles: Map<string, WatchedFile> = new Map()
  private logger: Logger

  constructor(logger: Logger) {
    super()
    this.logger = logger
  }

  /**
   * 开始监视文件
   */
  async watchFile(socket: Socket, filePath: string): Promise<boolean> {
    try {
      // 标准化路径
      const normalizedPath = path.normalize(filePath)
      
      // 检查文件是否存在
      const stats = await stat(normalizedPath)
      if (!stats.isFile()) {
        this.logger.warn(`路径不是文件: ${normalizedPath}`)
        return false
      }

      const currentModified = stats.mtimeMs

      // 如果文件已经被监视，只需添加socket ID
      if (this.watchedFiles.has(normalizedPath)) {
        const watchedFile = this.watchedFiles.get(normalizedPath)!
        watchedFile.socketIds.add(socket.id)
        this.logger.info(`Socket ${socket.id} 加入监视文件: ${normalizedPath}`)
        return true
      }

      // 创建新的文件监视器
      const watcher = watch(normalizedPath, { persistent: false }, async (eventType, filename) => {
        if (eventType === 'change') {
          try {
            // 获取新的修改时间
            const newStats = await stat(normalizedPath)
            const watchedFile = this.watchedFiles.get(normalizedPath)
            
            if (watchedFile && newStats.mtimeMs > watchedFile.lastModified) {
              // 检查是否应该忽略这次变化（通常是保存操作导致的）
              if (watchedFile.ignoreNextChange) {
                this.logger.info(`忽略文件变化（保存操作）: ${normalizedPath}`)
                watchedFile.lastModified = newStats.mtimeMs
                watchedFile.ignoreNextChange = false
                return
              }
              
              // 文件确实被修改了
              watchedFile.lastModified = newStats.mtimeMs
              
              this.logger.info(`检测到文件变化: ${normalizedPath}`)
              
              // 通知所有监视此文件的客户端
              watchedFile.socketIds.forEach(socketId => {
                // 通过socket.io发送文件变化事件
                const targetSocket = this.findSocket(socketId)
                if (targetSocket) {
                  targetSocket.emit('file-changed', {
                    filePath: normalizedPath,
                    modifiedTime: newStats.mtimeMs
                  })
                }
              })
            }
          } catch (error: any) {
            this.logger.error(`检查文件状态失败: ${normalizedPath}`, error)
          }
        }
      })

      watcher.on('error', (error) => {
        this.logger.error(`文件监视器错误: ${normalizedPath}`, error)
        this.unwatchFile(socket, normalizedPath)
      })

      // 保存监视信息
      this.watchedFiles.set(normalizedPath, {
        filePath: normalizedPath,
        watcher,
        lastModified: currentModified,
        socketIds: new Set([socket.id]),
        ignoreNextChange: false
      })

      this.logger.info(`开始监视文件: ${normalizedPath}`)
      return true
    } catch (error: any) {
      this.logger.error(`监视文件失败: ${filePath}`, error)
      return false
    }
  }

  /**
   * 停止监视文件
   */
  unwatchFile(socket: Socket, filePath: string): void {
    const normalizedPath = path.normalize(filePath)
    const watchedFile = this.watchedFiles.get(normalizedPath)

    if (!watchedFile) {
      return
    }

    // 移除socket ID
    watchedFile.socketIds.delete(socket.id)

    // 如果没有客户端监视此文件，关闭监视器
    if (watchedFile.socketIds.size === 0) {
      watchedFile.watcher.close()
      this.watchedFiles.delete(normalizedPath)
      this.logger.info(`停止监视文件: ${normalizedPath}`)
    } else {
      this.logger.info(`Socket ${socket.id} 取消监视文件: ${normalizedPath}`)
    }
  }

  /**
   * 停止监视所有文件（当socket断开时）
   */
  unwatchAllFilesForSocket(socket: Socket): void {
    const filesToUnwatch: string[] = []

    // 收集需要取消监视的文件
    this.watchedFiles.forEach((watchedFile, filePath) => {
      if (watchedFile.socketIds.has(socket.id)) {
        filesToUnwatch.push(filePath)
      }
    })

    // 取消监视
    filesToUnwatch.forEach(filePath => {
      this.unwatchFile(socket, filePath)
    })

    if (filesToUnwatch.length > 0) {
      this.logger.info(`Socket ${socket.id} 断开连接，取消监视 ${filesToUnwatch.length} 个文件`)
    }
  }

  /**
   * 获取监视统计信息
   */
  getWatchStats(): {
    totalFiles: number
    files: Array<{ path: string; watcherCount: number }>
  } {
    const files = Array.from(this.watchedFiles.entries()).map(([path, info]) => ({
      path,
      watcherCount: info.socketIds.size
    }))

    return {
      totalFiles: this.watchedFiles.size,
      files
    }
  }

  /**
   * 忽略下一次文件变化（用于保存操作）
   */
  ignoreNextChange(filePath: string): void {
    const normalizedPath = path.normalize(filePath)
    const watchedFile = this.watchedFiles.get(normalizedPath)
    
    if (watchedFile) {
      watchedFile.ignoreNextChange = true
      this.logger.info(`设置忽略下一次变化: ${normalizedPath}`)
    }
  }

  /**
   * 查找socket（需要从外部注入socket.io实例来实现）
   */
  private socketIoInstance: any = null

  setSocketIO(io: any) {
    this.socketIoInstance = io
  }

  private findSocket(socketId: string): Socket | null {
    if (!this.socketIoInstance) {
      return null
    }
    return this.socketIoInstance.sockets.sockets.get(socketId) || null
  }

  /**
   * 清理所有监视器
   */
  cleanup(): void {
    this.watchedFiles.forEach(watchedFile => {
      watchedFile.watcher.close()
    })
    this.watchedFiles.clear()
    this.logger.info('所有文件监视器已清理')
  }
}

