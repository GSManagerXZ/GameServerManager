/**
 * download7z GitHub 下载逻辑的单元测试
 * 通过 mock downloadFromUrl 私有方法验证下载地址和失败处理
 *
 * 关键验证点:
 * - 只使用 GitHub Releases latest
 * - GitHub 下载失败时抛出错误
 * - 失败时清理残留文件
 */

import { ZipToolsManager } from '../utils/zipToolsManager.js'

// mock logger
jest.mock('../utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// mock fs/promises
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 1024 }),
  chmod: jest.fn().mockResolvedValue(undefined),
}))

// mock fs（createWriteStream）
jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
}))

// mock stream/promises
jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}))

import fs from 'fs/promises'

describe('download7z GitHub 下载逻辑', () => {
  let manager: ZipToolsManager
  let downloadFromUrlMock: jest.SpyInstance

  beforeEach(() => {
    manager = new ZipToolsManager()
    jest.clearAllMocks()

    // mock 私有方法 downloadFromUrl，通过原型访问
    downloadFromUrlMock = jest.spyOn(
      manager as any,
      'downloadFromUrl'
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('应从 GitHub 下载且只调用一次', async () => {
    downloadFromUrlMock.mockResolvedValueOnce(undefined)

    await manager.download7z()

    expect(downloadFromUrlMock).toHaveBeenCalledTimes(1)
    const firstCallUrl = downloadFromUrlMock.mock.calls[0][0] as string
    expect(firstCallUrl).toContain('https://github.com/MCSManager/Zip-Tools/releases/latest/download/')
  })

  it('GitHub 下载失败时应抛出错误并清理残留文件', async () => {
    downloadFromUrlMock.mockRejectedValueOnce(new Error('连接超时'))

    await expect(manager.download7z()).rejects.toThrow('7z 下载失败（GitHub）')
    expect(downloadFromUrlMock).toHaveBeenCalledTimes(1)
    expect(fs.unlink).toHaveBeenCalled()
  })

  it('下载的文件名应与 get7zBinaryName() 一致', async () => {
    downloadFromUrlMock.mockResolvedValueOnce(undefined)

    const expectedBinaryName = manager.get7zBinaryName()
    await manager.download7z()

    // 验证 URL 中包含正确的二进制文件名
    const firstCallUrl = downloadFromUrlMock.mock.calls[0][0] as string
    expect(firstCallUrl).toContain(expectedBinaryName)
    // 验证目标路径中包含正确的二进制文件名
    const firstCallTargetPath = downloadFromUrlMock.mock.calls[0][1] as string
    expect(firstCallTargetPath).toContain(expectedBinaryName)
  })
})
