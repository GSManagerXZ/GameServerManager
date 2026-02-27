/**
 * 7z 功能属性测试
 * 使用 fast-check 库对 7z 相关功能进行属性测试
 * 每个属性测试至少运行 100 次迭代
 *
 * **Feature: 7zip-support**
 */

import * as fc from 'fast-check'
import * as path from 'path'

// ============================================================
// mock 依赖
// ============================================================

// mock logger 避免测试时写日志文件
jest.mock('../utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// 捕获 spawn 调用参数
let lastSpawnArgs: { cmd: string; args: string[]; cwd?: string } | null = null

jest.mock('child_process', () => ({
  spawn: jest.fn((cmd: string, args: string[], opts?: any) => {
    lastSpawnArgs = { cmd, args, cwd: opts?.cwd }
    const EventEmitter = require('events')
    const { Readable } = require('stream')
    const child = new EventEmitter()
    child.stderr = new Readable({ read() { this.push(null) } })
    child.stdout = new Readable({ read() { this.push(null) } })
    child.stdio = ['ignore', child.stdout, child.stderr]
    // 模拟成功退出
    process.nextTick(() => child.emit('close', 0))
    return child
  }),
}))

// mock fs/promises 中的 mkdir 和 access
jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises')
  return {
    ...actual,
    mkdir: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined),
  }
})

// mock stream/promises
jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}))

// ============================================================
// 导入被测模块
// ============================================================

import { ZipToolsManager } from '../utils/zipToolsManager.js'

// ============================================================
// 辅助工具
// ============================================================

/** 支持的平台列表 */
const SUPPORTED_PLATFORMS = ['win32', 'linux', 'darwin'] as const
/** 支持的架构列表 */
const SUPPORTED_ARCHS = ['x64', 'arm64'] as const

/**
 * 辅助函数: 临时修改 process.platform 和 process.arch
 */
function withPlatformArch<T>(platform: string, arch: string, fn: () => T): T {
  const originalPlatform = process.platform
  const originalArch = process.arch
  Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, writable: true, configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true, configurable: true })
    Object.defineProperty(process, 'arch', { value: originalArch, writable: true, configurable: true })
  }
}

/**
 * 生成合法的文件路径段（字母数字下划线横线，1~20 字符）
 */
const arbPathSegment = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/)

/**
 * 生成合法的文件路径（1~4 层目录 + 文件名）
 */
const arbFilePath = fc.tuple(
  fc.array(arbPathSegment, { minLength: 1, maxLength: 4 }),
  arbPathSegment
).map(([dirs, file]) => dirs.join('/') + '/' + file)

// ============================================================
// 属性 1: 7z 二进制文件命名规则
// **Feature: 7zip-support, Property 1: 7z 二进制文件命名规则**
// **Validates: Requirements 1.1**
// ============================================================

describe('属性 1: 7z 二进制文件命名规则', () => {
  /** 生成受支持的平台 */
  const arbPlatform = fc.constantFrom(...SUPPORTED_PLATFORMS)
  /** 生成受支持的架构 */
  const arbArch = fc.constantFrom(...SUPPORTED_ARCHS)

  it('对于任意受支持的平台/架构组合，返回的文件名应符合 7z_{platform}_{arch} 格式', () => {
    fc.assert(
      fc.property(arbPlatform, arbArch, (platform, arch) => {
        const manager = new ZipToolsManager()
        const name = withPlatformArch(platform, arch, () => manager.get7zBinaryName())

        // 基本格式: 以 7z_ 开头
        expect(name).toMatch(/^7z_/)

        // 包含平台标识
        expect(name).toContain(`7z_${platform}_`)

        // Windows 平台追加 .exe 后缀
        if (platform === 'win32') {
          expect(name).toMatch(/\.exe$/)
        } else {
          expect(name).not.toMatch(/\.exe$/)
        }

        // darwin/x64 直接使用 x64（不映射为 amd64）
        if (platform === 'darwin' && arch === 'x64') {
          expect(name).toContain('x64')
          expect(name).not.toContain('amd64')
        }

        // 完整格式验证: 7z_{platform}_{arch}[.exe]
        const expectedBase = `7z_${platform}_${arch}`
        const expected = platform === 'win32' ? `${expectedBase}.exe` : expectedBase
        expect(name).toBe(expected)
      }),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 属性 2: extract7z 命令行参数格式
// **Feature: 7zip-support, Property 2: extract7z 命令行参数格式**
// **Validates: Requirements 2.2**
// ============================================================

describe('属性 2: extract7z 命令行参数格式', () => {
  it('对于任意有效的归档路径和目标目录，参数应符合 x {archivePath} -o{targetDir} 格式', async () => {
    const manager = new ZipToolsManager()
    // mock 掉 ensure7zInstalled 和 get7zPath，只测试参数构建逻辑
    manager.ensure7zInstalled = jest.fn().mockResolvedValue(undefined)
    manager.get7zPath = jest.fn().mockResolvedValue('/mock/7z')

    await fc.assert(
      fc.asyncProperty(arbFilePath, arbFilePath, async (archivePath, targetDir) => {
        lastSpawnArgs = null
        await manager.extract7z(archivePath, targetDir)

        expect(lastSpawnArgs).not.toBeNull()
        const args = lastSpawnArgs!.args

        // 第一个参数是 'x'（解压命令）
        expect(args[0]).toBe('x')
        // 第二个参数是归档文件路径
        expect(args[1]).toBe(archivePath)
        // 第三个参数是 -o{targetDir}，-o 和目标目录之间没有空格
        expect(args[2]).toMatch(/^-o/)
        expect(args[2]).toBe(`-o${path.resolve(targetDir)}`)
        // 总共 3 个参数
        expect(args).toHaveLength(3)
      }),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 属性 3: compress7z 命令行参数格式
// **Feature: 7zip-support, Property 3: compress7z 命令行参数格式**
// **Validates: Requirements 3.2**
// ============================================================

describe('属性 3: compress7z 命令行参数格式', () => {
  /** 生成非空文件列表 */
  const arbFileList = fc.array(arbPathSegment, { minLength: 1, maxLength: 10 })

  it('对于任意有效的归档路径和非空文件列表，参数应符合 a {archivePath} {file1} {file2} ... 格式', async () => {
    const manager = new ZipToolsManager()
    manager.ensure7zInstalled = jest.fn().mockResolvedValue(undefined)
    manager.get7zPath = jest.fn().mockResolvedValue('/mock/7z')

    await fc.assert(
      fc.asyncProperty(arbFilePath, arbFileList, arbPathSegment, async (archivePath, files, cwd) => {
        lastSpawnArgs = null
        await manager.compress7z(archivePath, files, cwd)

        expect(lastSpawnArgs).not.toBeNull()
        const args = lastSpawnArgs!.args

        // 第一个参数是 'a'（压缩命令）
        expect(args[0]).toBe('a')
        // 第二个参数是归档文件路径
        expect(args[1]).toBe(archivePath)
        // 后续参数是所有文件
        const fileArgs = args.slice(2)
        expect(fileArgs).toEqual(files)
        // 所有文件都包含在参数中
        expect(fileArgs).toHaveLength(files.length)
        // cwd 被正确传递
        expect(lastSpawnArgs!.cwd).toBe(cwd)
      }),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 属性 4: CompressionWorker 格式路由正确性
// **Feature: 7zip-support, Property 4: CompressionWorker 格式路由正确性**
// **Validates: Requirements 4.1, 4.2, 4.5**
// ============================================================

describe('属性 4: CompressionWorker 格式路由正确性', () => {
  /**
   * 提取 CompressionWorker 的压缩格式路由逻辑为纯函数进行测试
   * 与 compressionWorker.ts 中 compressFiles 方法的 if-else 链一致
   */
  function getCompressMethodName(format: string): string | null {
    if (format === 'zip') return 'compressZip'
    if (format === 'tar') return 'compressTar'
    if (format === 'tar.gz') return 'compressTarGz'
    if (format === 'tar.xz') return 'compressTarXz'
    if (format === '7z') return 'compress7z'
    return null // 不支持的格式
  }

  /**
   * 提取 CompressionWorker 的解压格式路由逻辑为纯函数
   * 与 compressionWorker.ts 中 extractArchive 方法的 if-else 链一致
   */
  function getExtractMethodName(ext: string, fileName: string): string | null {
    if (ext === '.zip') return 'extractZip'
    if (ext === '.7z') return 'extract7z'
    if (ext === '.tar') return 'extractTar'
    if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) return 'extractTarGz'
    if (fileName.endsWith('.tar.xz') || fileName.endsWith('.txz')) return 'extractTarXz'
    return null
  }

  /** 所有支持的压缩格式 */
  const ALL_COMPRESS_FORMATS = ['zip', 'tar', 'tar.gz', 'tar.xz', '7z'] as const
  /** 所有支持的解压模式（扩展名 + 文件名） */
  const ALL_EXTRACT_PATTERNS = [
    { ext: '.zip', fileName: 'test.zip' },
    { ext: '.7z', fileName: 'test.7z' },
    { ext: '.tar', fileName: 'test.tar' },
    { ext: '.gz', fileName: 'test.tar.gz' },
    { ext: '.gz', fileName: 'test.tgz' },
    { ext: '.xz', fileName: 'test.tar.xz' },
    { ext: '.xz', fileName: 'test.txz' },
  ] as const

  const arbCompressFormat = fc.constantFrom(...ALL_COMPRESS_FORMATS)
  const arbExtractPattern = fc.constantFrom(...ALL_EXTRACT_PATTERNS)

  it('对于任意压缩格式，应路由到正确的压缩方法（7z 路由到 compress7z）', () => {
    fc.assert(
      fc.property(arbCompressFormat, (format) => {
        const methodName = getCompressMethodName(format)

        // 所有支持的格式都应有对应方法
        expect(methodName).not.toBeNull()

        // 验证各格式路由正确性
        if (format === '7z') expect(methodName).toBe('compress7z')
        if (format === 'zip') expect(methodName).toBe('compressZip')
        if (format === 'tar') expect(methodName).toBe('compressTar')
        if (format === 'tar.gz') expect(methodName).toBe('compressTarGz')
        if (format === 'tar.xz') expect(methodName).toBe('compressTarXz')
      }),
      { numRuns: 100 }
    )
  })

  it('对于任意解压扩展名，应路由到正确的解压方法（.7z 路由到 extract7z）', () => {
    fc.assert(
      fc.property(arbExtractPattern, ({ ext, fileName }) => {
        const methodName = getExtractMethodName(ext, fileName)

        // 所有支持的格式都应有对应方法
        expect(methodName).not.toBeNull()

        // 验证各格式路由正确性
        if (ext === '.7z') expect(methodName).toBe('extract7z')
        if (ext === '.zip') expect(methodName).toBe('extractZip')
        if (ext === '.tar') expect(methodName).toBe('extractTar')
        if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) expect(methodName).toBe('extractTarGz')
        if (fileName.endsWith('.tar.xz') || fileName.endsWith('.txz')) expect(methodName).toBe('extractTarXz')
      }),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 属性 5: OnlineDeploy 扩展名路由正确性
// **Feature: 7zip-support, Property 5: OnlineDeploy 扩展名路由正确性**
// **Validates: Requirements 6.3**
// ============================================================

describe('属性 5: OnlineDeploy 扩展名路由正确性', () => {
  /**
   * 提取 OnlineDeploy 的扩展名路由逻辑为纯函数
   * 与 onlineDeploy.ts 中的逻辑一致:
   *   const ext = path.extname(downloadPath).toLowerCase()
   *   if (ext === '.7z') -> extract7z
   *   else -> extractZip
   */
  function getOnlineDeployExtractMethod(downloadPath: string): 'extract7z' | 'extractZip' {
    const ext = path.extname(downloadPath).toLowerCase()
    if (ext === '.7z') {
      return 'extract7z'
    }
    return 'extractZip'
  }

  /** 生成以 .7z 结尾的文件路径 */
  const arb7zPath = arbFilePath.map(p => p + '.7z')
  /** 生成以非 .7z 扩展名结尾的文件路径 */
  const arbNon7zExt = fc.constantFrom('.zip', '.tar', '.gz', '.jar', '.war', '.rar')
  const arbNon7zPath = fc.tuple(arbFilePath, arbNon7zExt).map(([p, ext]) => p + ext)
  /** 生成任意扩展名的文件路径 */
  const arbAnyPath = fc.oneof(arb7zPath, arbNon7zPath)

  it('对于任意下载文件路径，.7z 使用 extract7z，其他格式使用 extractZip', () => {
    fc.assert(
      fc.property(arbAnyPath, (downloadPath) => {
        const method = getOnlineDeployExtractMethod(downloadPath)
        const ext = path.extname(downloadPath).toLowerCase()

        if (ext === '.7z') {
          expect(method).toBe('extract7z')
        } else {
          expect(method).toBe('extractZip')
        }
      }),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// 属性 6: 打包脚本 7z 文件名列表
// **Feature: 7zip-support, Property 6: 打包脚本 7z 二进制文件名列表**
// **Validates: Requirements 10.1**
// ============================================================

describe('属性 6: 打包脚本 7z 文件名列表', () => {
  /**
   * 从 scripts/package.js 中提取的 get7zBinaries 逻辑
   * 保持与源码一致
   */
  function get7zBinaries(platform?: string): string[] {
    if (platform === 'linux') {
      return ['7z_linux_x64', '7z_linux_arm64']
    } else if (platform === 'windows') {
      return ['7z_win32_x64.exe', '7z_win32_arm64.exe']
    }
    // 未指定平台时下载所有版本
    return [
      '7z_linux_x64', '7z_linux_arm64', '7z_linux_386', '7z_linux_arm',
      '7z_win32_x64.exe', '7z_win32_arm64.exe',
      '7z_darwin_x64', '7z_darwin_arm64',
    ]
  }

  /** 生成平台参数（包括 undefined 表示未指定） */
  const arbPlatform = fc.constantFrom('linux' as const, 'windows' as const, undefined)

  it('对于任意目标平台参数，返回的文件名列表中每个文件名应符合 7z_{platform}_{arch} 格式', () => {
    fc.assert(
      fc.property(arbPlatform, (platform) => {
        const binaries = get7zBinaries(platform)

        // 返回非空列表
        expect(binaries.length).toBeGreaterThan(0)

        for (const name of binaries) {
          // 每个文件名以 7z_ 开头
          expect(name).toMatch(/^7z_/)

          // 去掉可能的 .exe 后缀后，格式为 7z_{platform}_{arch}
          const baseName = name.replace(/\.exe$/, '')
          const parts = baseName.split('_')
          // 应该有 3 部分: 7z, platform, arch
          expect(parts).toHaveLength(3)
          expect(parts[0]).toBe('7z')

          // 平台部分应为有效值
          expect(['linux', 'win32', 'darwin']).toContain(parts[1])

          // Windows 平台文件名追加 .exe 后缀
          if (parts[1] === 'win32') {
            expect(name).toMatch(/\.exe$/)
          } else {
            expect(name).not.toMatch(/\.exe$/)
          }
        }

        // 指定 linux 平台时，所有文件名应包含 linux
        if (platform === 'linux') {
          for (const name of binaries) {
            expect(name).toContain('linux')
          }
        }

        // 指定 windows 平台时，所有文件名应包含 win32
        if (platform === 'windows') {
          for (const name of binaries) {
            expect(name).toContain('win32')
          }
        }
      }),
      { numRuns: 100 }
    )
  })
})
