/**
 * extract7z / compress7z 参数构建的单元测试
 * 通过 mock child_process.spawn 验证传递给 7z 二进制的命令行参数格式
 *
 * 关键验证点:
 * - extract7z 参数: ['x', archivePath, `-o${targetDir}`]（-o 和路径之间无空格）
 * - compress7z 参数: ['a', archivePath, ...files]，cwd 设置正确
 */

import { ZipToolsManager } from '../utils/zipToolsManager.js'
import path from 'path'

// mock logger
jest.mock('../utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// mock fs/promises（避免真实文件系统操作）
jest.mock('fs/promises', () => ({
  access: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 1024 }),
  unlink: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
}))

// 用于捕获 spawn 调用参数
let spawnCallArgs: { command: string; args: string[]; options: any } | null = null

// mock child_process.spawn，模拟进程立即成功退出
jest.mock('child_process', () => {
  const { EventEmitter } = require('events')
  const { Readable } = require('stream')

  return {
    spawn: jest.fn((command: string, args: string[], options: any) => {
      // 记录调用参数
      spawnCallArgs = { command, args, options }

      // 创建模拟子进程
      const child = new EventEmitter()
      child.stdout = new Readable({ read() { this.push(null) } })
      child.stderr = new Readable({ read() { this.push(null) } })
      child.stdio = ['ignore', child.stdout, child.stderr]

      // 异步触发成功退出
      process.nextTick(() => child.emit('close', 0))

      return child
    }),
  }
})

describe('extract7z / compress7z 参数构建', () => {
  let manager: ZipToolsManager

  beforeEach(() => {
    manager = new ZipToolsManager()
    spawnCallArgs = null

    // mock ensure7zInstalled 和 get7zPath，跳过真实的安装检测
    jest.spyOn(manager, 'ensure7zInstalled').mockResolvedValue(undefined)
    jest.spyOn(manager, 'get7zPath').mockResolvedValue('/mock/path/to/7z_linux_x64')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // --- extract7z 参数验证 ---

  describe('extract7z', () => {
    it('应使用正确的参数格式: x {archivePath} -o{targetDir}', async () => {
      const archivePath = '/data/test/archive.7z'
      const targetDir = '/data/test/output'

      await manager.extract7z(archivePath, targetDir)

      expect(spawnCallArgs).not.toBeNull()
      expect(spawnCallArgs!.args[0]).toBe('x')
      expect(spawnCallArgs!.args[1]).toBe(archivePath)
      // -o 和目标目录之间没有空格
      expect(spawnCallArgs!.args[2]).toBe(`-o${path.resolve(targetDir)}`)
    })

    it('应调用正确的 7z 二进制路径', async () => {
      await manager.extract7z('/test.7z', '/output')

      expect(spawnCallArgs!.command).toBe('/mock/path/to/7z_linux_x64')
    })

    it('参数数组长度应为 3（x, archivePath, -oTargetDir）', async () => {
      await manager.extract7z('/test.7z', '/output')

      expect(spawnCallArgs!.args).toHaveLength(3)
    })

    it('应在调用前确保 7z 已安装', async () => {
      await manager.extract7z('/test.7z', '/output')

      expect(manager.ensure7zInstalled).toHaveBeenCalled()
    })

    it('-o 参数应使用 path.resolve 处理目标目录', async () => {
      const targetDir = 'relative/path/output'
      await manager.extract7z('/test.7z', targetDir)

      // 验证 -o 后面跟的是绝对路径
      const oArg = spawnCallArgs!.args[2]
      expect(oArg.startsWith('-o')).toBe(true)
      const resolvedDir = oArg.substring(2)
      expect(path.isAbsolute(resolvedDir)).toBe(true)
    })
  })

  // --- compress7z 参数验证 ---

  describe('compress7z', () => {
    it('应使用正确的参数格式: a {archivePath} {files...}', async () => {
      const archivePath = '/data/test/output.7z'
      const files = ['file1.txt', 'file2.txt']
      const cwd = '/data/test/source'

      await manager.compress7z(archivePath, files, cwd)

      expect(spawnCallArgs).not.toBeNull()
      expect(spawnCallArgs!.args[0]).toBe('a')
      expect(spawnCallArgs!.args[1]).toBe(archivePath)
      expect(spawnCallArgs!.args.slice(2)).toEqual(files)
    })

    it('应正确设置 cwd 为工作目录', async () => {
      const cwd = '/data/test/source'
      await manager.compress7z('/output.7z', ['file.txt'], cwd)

      expect(spawnCallArgs!.options.cwd).toBe(cwd)
    })

    it('应支持多个文件参数', async () => {
      const files = ['a.txt', 'b.log', 'subdir/c.dat']
      await manager.compress7z('/output.7z', files, '/cwd')

      // 参数: ['a', archivePath, 'a.txt', 'b.log', 'subdir/c.dat']
      expect(spawnCallArgs!.args).toHaveLength(2 + files.length)
      expect(spawnCallArgs!.args.slice(2)).toEqual(files)
    })

    it('应调用正确的 7z 二进制路径', async () => {
      await manager.compress7z('/output.7z', ['file.txt'], '/cwd')

      expect(spawnCallArgs!.command).toBe('/mock/path/to/7z_linux_x64')
    })

    it('应在调用前确保 7z 已安装', async () => {
      await manager.compress7z('/output.7z', ['file.txt'], '/cwd')

      expect(manager.ensure7zInstalled).toHaveBeenCalled()
    })
  })
})
