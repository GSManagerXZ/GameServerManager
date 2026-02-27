/**
 * download7z 双源回退逻辑的单元测试
 * 通过 mock downloadFromUrl 私有方法验证下载回退策略
 *
 * 关键验证点:
 * - 主源（自建镜像）成功时不尝试备源
 * - 主源失败时回退到备源（GitHub Releases latest）
 * - 两个源都失败时抛出错误
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

describe('download7z 双源回退逻辑', () => {
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

  it('主源成功时不应尝试备源', async () => {
    // 主源下载成功
    downloadFromUrlMock.mockResolvedValueOnce(undefined)

    await manager.download7z()

    // downloadFromUrl 只被调用一次（主源）
    expect(downloadFromUrlMock).toHaveBeenCalledTimes(1)
    // 验证调用的是主源 URL（自建镜像）
    const firstCallUrl = downloadFromUrlMock.mock.calls[0][0] as string
    expect(firstCallUrl).not.toContain('github.com')
  })

  it('主源失败时应回退到备源（GitHub）', async () => {
    // 主源失败
    downloadFromUrlMock.mockRejectedValueOnce(new Error('主源连接超时'))
    // 备源成功
    downloadFromUrlMock.mockResolvedValueOnce(undefined)

    await manager.download7z()

    // downloadFromUrl 被调用两次
    expect(downloadFromUrlMock).toHaveBeenCalledTimes(2)
    // 第二次调用应使用 GitHub URL
    const secondCallUrl = downloadFromUrlMock.mock.calls[1][0] as string
    expect(secondCallUrl).toContain('github.com')
    expect(secondCallUrl).toContain('MCSManager/Zip-Tools')
  })

  it('两个源都失败时应抛出错误', async () => {
    // 两个源都失败
    downloadFromUrlMock.mockRejectedValueOnce(new Error('主源失败'))
    downloadFromUrlMock.mockRejectedValueOnce(new Error('备源失败'))

    await expect(manager.download7z()).rejects.toThrow('两个源均不可用')
  })

  it('主源失败后应清理残留文件', async () => {
    // 主源失败
    downloadFromUrlMock.mockRejectedValueOnce(new Error('下载失败'))
    // 备源成功
    downloadFromUrlMock.mockResolvedValueOnce(undefined)

    await manager.download7z()

    // 主源失败后应尝试 unlink 清理残留
    expect(fs.unlink).toHaveBeenCalled()
  })

  it('两个源都失败时应清理残留文件', async () => {
    downloadFromUrlMock.mockRejectedValueOnce(new Error('主源失败'))
    downloadFromUrlMock.mockRejectedValueOnce(new Error('备源失败'))

    await expect(manager.download7z()).rejects.toThrow()

    // 两次失败都应尝试清理
    expect(fs.unlink).toHaveBeenCalledTimes(2)
  })

  it('备源 URL 应使用 latest 版本路径', async () => {
    downloadFromUrlMock.mockRejectedValueOnce(new Error('主源失败'))
    downloadFromUrlMock.mockResolvedValueOnce(undefined)

    await manager.download7z()

    const secondCallUrl = downloadFromUrlMock.mock.calls[1][0] as string
    expect(secondCallUrl).toContain('/releases/latest/download/')
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
