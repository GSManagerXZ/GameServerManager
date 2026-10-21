import fs from 'fs'
import os from 'os'
import path from 'path'

// taskManager 依赖 uuid v14（纯 ESM），Jest 的 CJS 运行时无法直接加载，这里用轻量假实现替换
jest.mock('../modules/task/taskManager.js', () => {
  const tasks = new Map<string, any>()
  const taskManager = {
    __updates: [] as any[],
    createTask: (type: string, data: any) => {
      const id = 'test-task'
      tasks.set(id, { id, type, status: 'pending', progress: 0, message: '任务已创建', data })
      return id
    },
    updateTask: (id: string, updates: any) => {
      const task = tasks.get(id)
      if (!task) return
      Object.assign(task, updates)
      taskManager.__updates.push({ progress: task.progress, message: task.message, status: task.status })
    },
    getTask: (id: string) => tasks.get(id)
  }
  return { taskManager }
})

import { taskManager } from '../modules/task/taskManager.js'
import { executeFileOperation } from '../modules/task/fileOperationWorker.js'

interface TaskUpdate {
  progress: number
  message: string
  status: string
}

function getUpdates(): TaskUpdate[] {
  return (taskManager as any).__updates
}

function resetUpdates() {
  ;(taskManager as any).__updates.length = 0
}

function getFinishedUpdate(): TaskUpdate {
  const updates = getUpdates()
  return updates[updates.length - 1]
}

// 进度条只应前进：任一时刻的百分比都不得小于上一次上报值
function expectMonotonicProgress() {
  const percentages = getUpdates().map((item) => item.progress)
  for (let i = 1; i < percentages.length; i++) {
    expect(percentages[i]).toBeGreaterThanOrEqual(percentages[i - 1])
  }
}

function writeFileWithSize(filePath: string, size: number) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, Buffer.alloc(size, 'a'))
}

// 递归统计目录下的文件数，用于确认「复制结果本身正确，只是上报数字错误」
function countFiles(dirPath: string): number {
  let count = 0
  for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const itemPath = path.join(dirPath, item.name)
    if (item.isDirectory()) {
      count += countFiles(itemPath)
    } else {
      count++
    }
  }
  return count
}

describe('文件复制/移动任务的进度统计', () => {
  let workDir: string

  beforeEach(() => {
    resetUpdates()
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-file-op-'))
  })

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  it('复制含多个同级子目录的目录：进度不倒退，完成消息文件数正确', async () => {
    const sourceDir = path.join(workDir, 'source')
    const targetDir = path.join(workDir, 'target')
    // 两个同级子目录，各 2 个 10 字节文件（合计 4 个文件 / 40 字节）
    writeFileWithSize(path.join(sourceDir, 'alpha', 'a1.txt'), 10)
    writeFileWithSize(path.join(sourceDir, 'alpha', 'a2.txt'), 10)
    writeFileWithSize(path.join(sourceDir, 'beta', 'b1.txt'), 10)
    writeFileWithSize(path.join(sourceDir, 'beta', 'b2.txt'), 10)
    fs.mkdirSync(targetDir, { recursive: true })

    const taskId = taskManager.createTask('copy', {
      sourcePaths: [sourceDir],
      targetPath: targetDir,
      operation: 'copy',
      conflictStrategy: 'replace'
    })
    await executeFileOperation(taskId)

    // 复制结果本身完全正确（4 个文件都在目标目录），出错的只是上报的进度与文件数
    expect(countFiles(path.join(targetDir, 'source'))).toBe(4)
    expectMonotonicProgress()

    const finished = getFinishedUpdate()
    expect(finished.status).toBe('completed')
    expect(finished.progress).toBe(100)
    expect(finished.message).toContain('4 个文件')
  })

  it('同时复制一个文件和一个目录：进度不倒退，完成消息文件数正确', async () => {
    const looseFile = path.join(workDir, 'loose.txt')
    const sourceDir = path.join(workDir, 'source')
    const targetDir = path.join(workDir, 'target')
    writeFileWithSize(looseFile, 100)
    writeFileWithSize(path.join(sourceDir, 'c1.txt'), 10)
    writeFileWithSize(path.join(sourceDir, 'c2.txt'), 10)
    fs.mkdirSync(targetDir, { recursive: true })

    const taskId = taskManager.createTask('copy', {
      sourcePaths: [looseFile, sourceDir],
      targetPath: targetDir,
      operation: 'copy',
      conflictStrategy: 'replace'
    })
    await executeFileOperation(taskId)

    expectMonotonicProgress()

    const finished = getFinishedUpdate()
    expect(finished.status).toBe('completed')
    expect(finished.progress).toBe(100)
    expect(finished.message).toContain('3 个文件')
  })

  it('同时移动多个目录：进度不倒退，完成消息文件数正确', async () => {
    const firstDir = path.join(workDir, 'first')
    const secondDir = path.join(workDir, 'second')
    const targetDir = path.join(workDir, 'target')
    writeFileWithSize(path.join(firstDir, 'f1.txt'), 10)
    writeFileWithSize(path.join(secondDir, 's1.txt'), 10)
    fs.mkdirSync(targetDir, { recursive: true })

    const taskId = taskManager.createTask('move', {
      sourcePaths: [firstDir, secondDir],
      targetPath: targetDir,
      operation: 'move',
      conflictStrategy: 'replace'
    })
    await executeFileOperation(taskId)

    expectMonotonicProgress()

    const finished = getFinishedUpdate()
    expect(finished.status).toBe('completed')
    expect(finished.message).toContain('2 个文件')
  })

  it('复制不含子目录的目录：进度与文件数保持正确', async () => {
    const sourceDir = path.join(workDir, 'source')
    const targetDir = path.join(workDir, 'target')
    writeFileWithSize(path.join(sourceDir, 'a.txt'), 10)
    writeFileWithSize(path.join(sourceDir, 'b.txt'), 10)
    writeFileWithSize(path.join(sourceDir, 'c.txt'), 10)
    fs.mkdirSync(targetDir, { recursive: true })

    const taskId = taskManager.createTask('copy', {
      sourcePaths: [sourceDir],
      targetPath: targetDir,
      operation: 'copy',
      conflictStrategy: 'replace'
    })
    await executeFileOperation(taskId)

    expectMonotonicProgress()

    const finished = getFinishedUpdate()
    expect(finished.status).toBe('completed')
    expect(finished.progress).toBe(100)
    expect(finished.message).toContain('3 个文件')
  })
})
