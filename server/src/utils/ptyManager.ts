import { constants as fsConstants } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import logger from './logger.js'
import {
  ensurePtyAsset,
  getPtyAsset,
  probePtyAsset,
  verifyPtyAsset
} from './ptyAssets.js'

/**
 * PTY 二进制文件管理器
 * 负责按固定清单解析、校验、探测和安装 PTY 二进制文件。
 */
class PtyManager {
  /** 获取当前平台对应的固定 PTY 二进制文件名。 */
  getBinaryName(): string {
    return getPtyAsset().name
  }

  /**
   * 获取 lib 目录的候选路径列表。
   * 顺序兼容打包、开发、Docker 内置资产和旧版 Docker 布局。
   */
  private getLibDirCandidates(): string[] {
    const baseDir = process.cwd()
    return Array.from(new Set([
      ...this.getWritableLibDirCandidates(),
      path.join(baseDir, 'builtin', 'data', 'lib'), // 当前 Docker 镜像内置资产目录
      path.join(baseDir, '..', 'data', 'lib')       // 兼容旧版 Docker/启动脚本布局
    ]))
  }

  /** 获取允许服务端下载或替换资产的运行时目录。 */
  private getWritableLibDirCandidates(): string[] {
    const baseDir = process.cwd()
    return [
      path.join(baseDir, 'data', 'lib'),
      path.join(baseDir, 'server', 'data', 'lib')
    ]
  }

  /** 优先使用第一个已存在目录；均不存在时创建第一个可写目录。 */
  private async getTargetDir(): Promise<string> {
    const candidates = this.getWritableLibDirCandidates()

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate)
        if (!stat.isDirectory()) {
          throw new Error(`PTY 候选路径不是目录: ${candidate}`)
        }
        return candidate
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          continue
        }
        throw error
      }
    }

    for (const candidate of candidates) {
      try {
        await fs.mkdir(candidate, { recursive: true })
        await fs.access(candidate, fsConstants.W_OK)
        return candidate
      } catch (error) {
        logger.warn(`PTY 候选目录不可写: ${candidate}`)
      }
    }

    throw new Error(`无法创建可写的 PTY lib 目录，已尝试: ${candidates.join(', ')}`)
  }

  /**
   * 返回经过固定清单校验和本机能力探测的 PTY 路径。
   * 缺失、损坏或不支持 -fifo 的资产会在选定候选目录中被固定版本替换。
   */
  async getPtyPath(): Promise<string> {
    const asset = getPtyAsset()

    for (const candidate of this.getLibDirCandidates()) {
      const targetPath = path.join(candidate, asset.name)
      if (!await verifyPtyAsset(targetPath, asset)) {
        continue
      }

      try {
        await probePtyAsset(targetPath, asset)
        return targetPath
      } catch {
        logger.warn(`PTY 资产能力探测失败，将尝试其他路径: ${targetPath}`)
      }
    }

    const targetDir = await this.getTargetDir()
    return ensurePtyAsset({ asset, targetDir, logger })
  }

  /** 检查首个已存在候选目录中的 PTY 是否可信且可用，不触发下载。 */
  async isInstalled(): Promise<boolean> {
    const asset = getPtyAsset()

    for (const candidate of this.getLibDirCandidates()) {
      try {
        const stat = await fs.stat(candidate)
        if (!stat.isDirectory()) {
          return false
        }
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          continue
        }
        return false
      }

      const targetPath = path.join(candidate, asset.name)
      if (!await verifyPtyAsset(targetPath, asset)) {
        continue
      }
      try {
        await probePtyAsset(targetPath, asset)
        return true
      } catch {
        continue
      }
    }

    return false
  }

  /** 安装或替换当前平台的固定 PTY 资产。 */
  async download(): Promise<void> {
    await this.getPtyPath()
  }

  /** 服务启动时确保可信 PTY 资产可用。 */
  async ensureInstalled(): Promise<void> {
    const ptyPath = await this.getPtyPath()
    logger.info(`PTY 已就绪: ${ptyPath}`)
  }
}

/** 导出单例实例 */
export const ptyManager = new PtyManager()

/** 导出类本身（用于测试） */
export { PtyManager }
