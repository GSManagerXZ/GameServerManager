import { promises as fs } from 'fs'
import path from 'path'
import { taskManager } from './taskManager.js'
import { Server as SocketIOServer } from 'socket.io'

let io: SocketIOServer | null = null

export function setFileOperationDependencies(socketIO: SocketIOServer) {
  io = socketIO
}

interface FileOperationData {
  sourcePaths: string[]
  targetPath: string
  operation: 'copy' | 'move'
  conflictStrategy?: 'replace' | 'rename' | 'skip'
}

// 计算目录大小和文件数量
async function calculateDirectoryStats(dirPath: string): Promise<{ totalSize: number; totalFiles: number }> {
  let totalSize = 0
  let totalFiles = 0

  async function traverse(currentPath: string) {
    try {
      const stats = await fs.stat(currentPath)
      if (stats.isFile()) {
        totalSize += stats.size
        totalFiles++
      } else if (stats.isDirectory()) {
        const items = await fs.readdir(currentPath)
        for (const item of items) {
          await traverse(path.join(currentPath, item))
        }
      }
    } catch (error) {
      // 跳过无法访问的文件
    }
  }

  await traverse(dirPath)
  return { totalSize, totalFiles }
}

// 递归复制目录
async function copyDirectoryWithProgress(
  src: string, 
  dest: string, 
  taskId: string,
  onProgress: (copiedSize: number, copiedFiles: number) => void
): Promise<{ copiedSize: number; copiedFiles: number }> {
  let copiedSize = 0
  let copiedFiles = 0

  await fs.mkdir(dest, { recursive: true })
  const items = await fs.readdir(src)

  for (const item of items) {
    const srcPath = path.join(src, item)
    const destPath = path.join(dest, item)
    
    try {
      const stats = await fs.stat(srcPath)
      
      if (stats.isDirectory()) {
        const result = await copyDirectoryWithProgress(srcPath, destPath, taskId, onProgress)
        copiedSize += result.copiedSize
        copiedFiles += result.copiedFiles
      } else {
        await fs.copyFile(srcPath, destPath)
        copiedSize += stats.size
        copiedFiles++
        onProgress(copiedSize, copiedFiles)
      }
    } catch (error) {
      console.error(`复制文件失败: ${srcPath}`, error)
      // 继续处理其他文件
    }
  }

  return { copiedSize, copiedFiles }
}

// 递归移动目录
async function moveDirectoryWithProgress(
  src: string, 
  dest: string, 
  taskId: string,
  onProgress: (movedSize: number, movedFiles: number) => void
): Promise<{ movedSize: number; movedFiles: number }> {
  // 先尝试直接重命名
  try {
    await fs.rename(src, dest)
    // 如果成功，计算移动的文件统计
    const stats = await calculateDirectoryStats(dest)
    onProgress(stats.totalSize, stats.totalFiles)
    return { movedSize: stats.totalSize, movedFiles: stats.totalFiles }
  } catch (renameError: any) {
    // 如果重命名失败（跨设备等），使用复制+删除
    if (renameError.code === 'EXDEV') {
      const result = await copyDirectoryWithProgress(src, dest, taskId, onProgress)
      await fs.rm(src, { recursive: true })
      return { movedSize: result.copiedSize, movedFiles: result.copiedFiles }
    } else {
      throw renameError
    }
  }
}

// 执行文件操作任务
export async function executeFileOperation(taskId: string) {
  const task = taskManager.getTask(taskId)
  if (!task || task.type !== 'copy' && task.type !== 'move') {
    return
  }

  try {
    taskManager.updateTask(taskId, {
      status: 'running',
      message: '正在准备文件操作...'
    })

    // 通过WebSocket发送任务更新
    if (io) {
      io.emit('task-updated', task)
    }

    const data: FileOperationData = task.data
    const { sourcePaths, targetPath, operation, conflictStrategy = 'replace' } = data

    // 计算总的文件大小和数量
    let totalSize = 0
    let totalFiles = 0
    
    taskManager.updateTask(taskId, {
      message: '正在计算文件大小...'
    })

    for (const sourcePath of sourcePaths) {
      try {
        const stats = await fs.stat(sourcePath)
        if (stats.isFile()) {
          totalSize += stats.size
          totalFiles++
        } else if (stats.isDirectory()) {
          const dirStats = await calculateDirectoryStats(sourcePath)
          totalSize += dirStats.totalSize
          totalFiles += dirStats.totalFiles
        }
      } catch (error) {
        console.error(`无法访问文件: ${sourcePath}`, error)
      }
    }

    let processedSize = 0
    let processedFiles = 0

    const updateProgress = (addedSize: number, addedFiles: number) => {
      processedSize += addedSize
      processedFiles += addedFiles
      
      const progress = totalSize > 0 ? Math.round((processedSize / totalSize) * 100) : 0
      const message = `${operation === 'copy' ? '复制' : '移动'}中... (${processedFiles}/${totalFiles} 个文件)`
      
      taskManager.updateTask(taskId, {
        progress,
        message
      })

      // 通过WebSocket发送进度更新
      if (io) {
        const updatedTask = taskManager.getTask(taskId)
        if (updatedTask) {
          io.emit('task-updated', updatedTask)
        }
      }
    }

    // 处理每个源文件/目录
    for (const sourcePath of sourcePaths) {
      try {
        const fileName = path.basename(sourcePath)
        let targetFilePath = path.join(targetPath, fileName)
        
        const stats = await fs.stat(sourcePath)

        // 检查目标是否已存在，根据冲突策略处理
        const targetExists = await fs.access(targetFilePath).then(() => true).catch(() => false)
        if (targetExists) {
          if (conflictStrategy === 'skip') {
            // 跳过已存在的文件
            if (stats.isFile()) {
              updateProgress(stats.size, 1)
            } else if (stats.isDirectory()) {
              const dirStats = await calculateDirectoryStats(sourcePath)
              updateProgress(dirStats.totalSize, dirStats.totalFiles)
            }
            continue
          } else if (conflictStrategy === 'rename') {
            // 自动重命名：添加序号
            const ext = path.extname(fileName)
            const nameWithoutExt = path.basename(fileName, ext)
            let counter = 1
            while (await fs.access(targetFilePath).then(() => true).catch(() => false)) {
              targetFilePath = path.join(targetPath, `${nameWithoutExt}(${counter})${ext}`)
              counter++
            }
          } else {
            // replace策略：删除已存在的目标
            const targetStats = await fs.stat(targetFilePath)
            if (targetStats.isDirectory()) {
              await fs.rm(targetFilePath, { recursive: true })
            } else {
              await fs.unlink(targetFilePath)
            }
          }
        }
        
        if (stats.isFile()) {
          if (operation === 'copy') {
            await fs.copyFile(sourcePath, targetFilePath)
          } else {
            await fs.rename(sourcePath, targetFilePath)
          }
          updateProgress(stats.size, 1)
        } else if (stats.isDirectory()) {
          if (operation === 'copy') {
            await copyDirectoryWithProgress(sourcePath, targetFilePath, taskId, (size, files) => {
              updateProgress(size - processedSize, files - processedFiles)
            })
          } else {
            await moveDirectoryWithProgress(sourcePath, targetFilePath, taskId, (size, files) => {
              updateProgress(size - processedSize, files - processedFiles)
            })
          }
        }
      } catch (error) {
        console.error(`${operation === 'copy' ? '复制' : '移动'}失败: ${sourcePath}`, error)
        // 继续处理其他文件
      }
    }

    taskManager.updateTask(taskId, {
      status: 'completed',
      progress: 100,
      message: `${operation === 'copy' ? '复制' : '移动'}完成！处理了 ${processedFiles} 个文件`
    })

    // 通过WebSocket发送完成通知
    if (io) {
      const completedTask = taskManager.getTask(taskId)
      if (completedTask) {
        io.emit('task-updated', completedTask)
      }
    }

  } catch (error: any) {
    console.error(`文件操作任务失败 (${taskId}):`, error)
    
    taskManager.updateTask(taskId, {
      status: 'failed',
      message: `操作失败: ${error.message}`
    })

    // 通过WebSocket发送失败通知
    if (io) {
      const failedTask = taskManager.getTask(taskId)
      if (failedTask) {
        io.emit('task-updated', failedTask)
      }
    }
  }
}