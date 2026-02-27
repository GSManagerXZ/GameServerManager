/**
 * get7zBinaryName() 单元测试
 * 验证各平台/架构组合的 7z 二进制文件命名规则
 * 
 * 关键点:
 * - 命名格式: 7z_{platform}_{arch}
 * - Windows 追加 .exe
 * - darwin/x64 直接使用 x64（不映射为 amd64，与 file_zip 不同）
 * - 不支持的平台/架构抛出错误
 */

import { ZipToolsManager } from '../utils/zipToolsManager.js'

// mock logger 避免测试时写日志文件
jest.mock('../utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

/**
 * 辅助函数: 临时修改 process.platform 和 process.arch
 * process.platform 是只读属性，需要用 Object.defineProperty 覆盖
 */
function withPlatformArch(platform: string, arch: string, fn: () => void) {
  const originalPlatform = process.platform
  const originalArch = process.arch
  Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, writable: true, configurable: true })
  try {
    fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true, configurable: true })
    Object.defineProperty(process, 'arch', { value: originalArch, writable: true, configurable: true })
  }
}

describe('get7zBinaryName()', () => {
  let manager: ZipToolsManager

  beforeEach(() => {
    manager = new ZipToolsManager()
  })

  // --- 支持的平台/架构组合 ---

  it('linux/x64 应返回 7z_linux_x64', () => {
    withPlatformArch('linux', 'x64', () => {
      expect(manager.get7zBinaryName()).toBe('7z_linux_x64')
    })
  })

  it('linux/arm64 应返回 7z_linux_arm64', () => {
    withPlatformArch('linux', 'arm64', () => {
      expect(manager.get7zBinaryName()).toBe('7z_linux_arm64')
    })
  })

  it('win32/x64 应返回 7z_win32_x64.exe（带 .exe 后缀）', () => {
    withPlatformArch('win32', 'x64', () => {
      expect(manager.get7zBinaryName()).toBe('7z_win32_x64.exe')
    })
  })

  it('win32/arm64 应返回 7z_win32_arm64.exe（带 .exe 后缀）', () => {
    withPlatformArch('win32', 'arm64', () => {
      expect(manager.get7zBinaryName()).toBe('7z_win32_arm64.exe')
    })
  })

  it('darwin/x64 应返回 7z_darwin_x64（不映射为 amd64）', () => {
    withPlatformArch('darwin', 'x64', () => {
      // 关键: 与 file_zip 不同，7z 的 darwin/x64 直接使用 x64
      expect(manager.get7zBinaryName()).toBe('7z_darwin_x64')
      expect(manager.get7zBinaryName()).not.toContain('amd64')
    })
  })

  it('darwin/arm64 应返回 7z_darwin_arm64', () => {
    withPlatformArch('darwin', 'arm64', () => {
      expect(manager.get7zBinaryName()).toBe('7z_darwin_arm64')
    })
  })

  // --- 不支持的平台/架构 ---

  it('不支持的平台应抛出错误', () => {
    withPlatformArch('freebsd', 'x64', () => {
      expect(() => manager.get7zBinaryName()).toThrow('不支持的操作系统平台')
    })
  })

  it('不支持的架构应抛出错误', () => {
    withPlatformArch('linux', 'ia32', () => {
      expect(() => manager.get7zBinaryName()).toThrow('不支持的 CPU 架构')
    })
  })

  // --- 与 getBinaryName() 的对比验证 ---

  it('darwin/x64 下 get7zBinaryName 和 getBinaryName 的架构标识不同', () => {
    withPlatformArch('darwin', 'x64', () => {
      const sevenZName = manager.get7zBinaryName()
      const zipName = manager.getBinaryName()
      // 7z 使用 x64，file_zip 使用 amd64
      expect(sevenZName).toContain('x64')
      expect(zipName).toContain('amd64')
    })
  })
})
