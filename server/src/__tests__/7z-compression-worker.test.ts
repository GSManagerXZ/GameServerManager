/**
 * CompressionWorker 7z 格式路由的单元测试
 * 验证 format === '7z' 和 ext === '.7z' 能正确路由到对应的 7z 方法
 *
 * 关键验证点:
 * - compressFiles: format === '7z' 路由到 zipToolsManager.compress7z
 * - extractArchive: ext === '.7z' 路由到 zipToolsManager.extract7z
 * - 现有格式（zip, tar 等）不受影响
 */

// mock logger
jest.mock('../utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// mock tar 模块
jest.mock('tar', () => ({
  create: jest.fn().mockResolvedValue(undefined),
  extract: jest.fn().mockResolvedValue(undefined),
}))

// mock tarSecurityFilter
jest.mock('../utils/tarSecurityFilter.js', () => ({
  createTarSecurityFilter: jest.fn(() => () => true),
}))

// mock fs 模块（compressionWorker 使用 { promises as fs } from 'fs'）
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 1024 }),
    chmod: jest.fn().mockResolvedValue(undefined),
  },
  createWriteStream: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    pipe: jest.fn().mockReturnThis(),
  })),
  createReadStream: jest.fn(() => ({
    pipe: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
  })),
}))

// mock zipToolsManager
jest.mock('../utils/zipToolsManager.js', () => ({
  zipToolsManager: {
    compress7z: jest.fn().mockResolvedValue(undefined),
    extract7z: jest.fn().mockResolvedValue(undefined),
    compressZip: jest.fn().mockResolvedValue(undefined),
    extractZip: jest.fn().mockResolvedValue(undefined),
  },
}))

// mock taskManager
jest.mock('../modules/task/taskManager.js', () => ({
  taskManager: {
    updateTask: jest.fn(),
  },
  TaskManager: jest.fn(),
}))

import { CompressionWorker } from '../modules/task/compressionWorker.js'
import { zipToolsManager } from '../utils/zipToolsManager.js'
import { taskManager } from '../modules/task/taskManager.js'

describe('CompressionWorker 7z 格式路由', () => {
  let worker: CompressionWorker

  beforeEach(() => {
    worker = new CompressionWorker()
    jest.clearAllMocks()
  })

  // --- 压缩路由测试 ---

  describe('compressFiles - 7z 格式路由', () => {
    it('format === "7z" 应路由到 zipToolsManager.compress7z', async () => {
      const sourcePaths = ['/data/source/file1.txt', '/data/source/file2.txt']
      const archivePath = '/data/output/archive.7z'

      await worker.compressFiles('task-1', sourcePaths, archivePath, '7z', 5)

      expect(zipToolsManager.compress7z).toHaveBeenCalledTimes(1)
      // 验证传递了正确的参数
      expect(zipToolsManager.compress7z).toHaveBeenCalledWith(
        archivePath,
        expect.any(Array), // 相对路径的文件列表
        expect.any(String)  // cwd
      )
    })

    it('format === "7z" 不应调用 compressZip', async () => {
      await worker.compressFiles(
        'task-1',
        ['/data/source/file.txt'],
        '/data/output/archive.7z',
        '7z',
        5
      )

      expect(zipToolsManager.compressZip).not.toHaveBeenCalled()
    })

    it('format === "zip" 应路由到 compressZip（不影响现有逻辑）', async () => {
      await worker.compressFiles(
        'task-1',
        ['/data/source/file.txt'],
        '/data/output/archive.zip',
        'zip',
        5
      )

      expect(zipToolsManager.compressZip).toHaveBeenCalledTimes(1)
      expect(zipToolsManager.compress7z).not.toHaveBeenCalled()
    })

    it('7z 压缩完成后应更新任务状态为 completed', async () => {
      await worker.compressFiles(
        'task-1',
        ['/data/source/file.txt'],
        '/data/output/archive.7z',
        '7z',
        5
      )

      // 最后一次 updateTask 调用应设置 status 为 completed
      const lastCall = (taskManager.updateTask as jest.Mock).mock.calls.slice(-1)[0]
      expect(lastCall[1]).toMatchObject({ status: 'completed' })
    })
  })

  // --- 解压路由测试 ---

  describe('extractArchive - .7z 扩展名路由', () => {
    it('ext === ".7z" 应路由到 zipToolsManager.extract7z', async () => {
      const archivePath = '/data/test/archive.7z'
      const targetPath = '/data/test/output'

      await worker.extractArchive('task-2', archivePath, targetPath)

      expect(zipToolsManager.extract7z).toHaveBeenCalledTimes(1)
      expect(zipToolsManager.extract7z).toHaveBeenCalledWith(archivePath, targetPath)
    })

    it('ext === ".7z" 不应调用 extractZip', async () => {
      await worker.extractArchive('task-2', '/data/archive.7z', '/data/output')

      expect(zipToolsManager.extractZip).not.toHaveBeenCalled()
    })

    it('ext === ".zip" 应路由到 extractZip（不影响现有逻辑）', async () => {
      await worker.extractArchive('task-2', '/data/archive.zip', '/data/output')

      expect(zipToolsManager.extractZip).toHaveBeenCalledTimes(1)
      expect(zipToolsManager.extract7z).not.toHaveBeenCalled()
    })

    it('7z 解压完成后应更新任务状态为 completed', async () => {
      await worker.extractArchive('task-2', '/data/archive.7z', '/data/output')

      const lastCall = (taskManager.updateTask as jest.Mock).mock.calls.slice(-1)[0]
      expect(lastCall[1]).toMatchObject({ status: 'completed' })
    })

    it('不支持的格式应抛出错误并包含 .7z 在支持列表中', async () => {
      await expect(
        worker.extractArchive('task-2', '/data/archive.rar', '/data/output')
      ).rejects.toThrow('不支持的压缩格式')
    })
  })
})
