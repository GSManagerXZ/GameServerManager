import { promises as fs } from 'fs'
import path from 'path'
import * as tar from 'tar'
import { createReadStream, createWriteStream } from 'fs'
import * as zlib from 'zlib'

export interface BackupInfo {
  name: string
  baseDir: string
  files: {
    fileName: string
    size: number
    modified: string
  }[]
  meta?: {
    sourcePath?: string
  }
}

export class BackupManager {
  private backupRoot: string

  constructor() {
    const baseDir = process.cwd()
    const possiblePaths = [
      path.join(baseDir, 'data', 'backupdata'),
      path.join(baseDir, 'server', 'data', 'backupdata')
    ]
    this.backupRoot = possiblePaths[0]
    for (const p of possiblePaths) {
      this.backupRoot = p
      break
    }
  }

  private async ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true })
  }

  async listBackups(): Promise<BackupInfo[]> {
    await this.ensureDir(this.backupRoot)
    const entries = await fs.readdir(this.backupRoot, { withFileTypes: true })
    const result: BackupInfo[] = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const backupDir = path.join(this.backupRoot, e.name)
      const files = await fs.readdir(backupDir)
      const detailed: BackupInfo['files'] = []
      for (const f of files) {
        if (f === 'data.json') continue
        const full = path.join(backupDir, f)
        const stat = await fs.stat(full)
        if (stat.isFile()) {
          detailed.push({ fileName: f, size: stat.size, modified: stat.mtime.toISOString() })
        }
      }
      // 读取元信息
      let meta: BackupInfo['meta'] = {}
      try {
        const metaRaw = await fs.readFile(path.join(backupDir, 'data.json'), 'utf-8')
        meta = JSON.parse(metaRaw)
      } catch {}
      result.push({ name: e.name, baseDir: backupDir, files: detailed.sort((a,b)=>a.fileName.localeCompare(b.fileName)), meta })
    }
    return result
  }

  private formatTimestamp(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}_${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  async createBackup(backupName: string, sourcePath: string, maxKeep: number): Promise<{ archivePath: string }> {
    if (!backupName || !sourcePath) throw new Error('参数缺失: backupName 或 sourcePath')
    const backupDir = path.join(this.backupRoot, backupName)
    await this.ensureDir(backupDir)

    // 写入meta
    await fs.writeFile(path.join(backupDir, 'data.json'), JSON.stringify({ sourcePath }, null, 2))

    const timestamp = this.formatTimestamp(new Date())
    const archivePath = path.join(backupDir, `${timestamp}.tar.xz`)

    // 使用tar创建tar，再用gzip模拟xz（项目现有实现如此）
    const tempTarPath = archivePath.replace('.tar.xz', '.tar')
    // 允许备份目录或单个文件
    const sourceStat = await fs.stat(sourcePath)
    const cwd = sourceStat.isDirectory() ? path.dirname(sourcePath) : path.dirname(sourcePath)
    const entries: string[] = [path.basename(sourcePath)]

    await tar.create({ f: tempTarPath, cwd }, entries)

    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(tempTarPath)
      const writeStream = createWriteStream(archivePath)
      const gzip = zlib.createGzip({ level: 6 })
      readStream.pipe(gzip).pipe(writeStream)
        .on('finish', async () => {
          try { await fs.unlink(tempTarPath) } catch {}
          resolve()
        })
        .on('error', reject)
    })

    // 清理超过maxKeep的旧备份
    if (Number.isFinite(maxKeep) && maxKeep > 0) {
      const items = (await fs.readdir(backupDir))
        .filter(f => f.endsWith('.tar.xz'))
        .sort()
      if (items.length > maxKeep) {
        const removeCount = items.length - maxKeep
        for (let i = 0; i < removeCount; i++) {
          const toRemove = path.join(backupDir, items[i])
          try { await fs.unlink(toRemove) } catch {}
        }
      }
    }

    return { archivePath }
  }

  async restoreBackup(backupName: string, fileName: string): Promise<{ targetPath: string }> {
    const backupDir = path.join(this.backupRoot, backupName)
    const metaRaw = await fs.readFile(path.join(backupDir, 'data.json'), 'utf-8')
    const meta = JSON.parse(metaRaw) as { sourcePath: string }
    const targetPath = meta.sourcePath
    // 为确保恢复后的文件完全一致：先删除原路径，再进行解压
    // 安全校验：必须是绝对路径且长度>1
    if (!path.isAbsolute(targetPath)) {
      throw new Error('恢复目标路径不是绝对路径，已阻止操作')
    }
    if (targetPath.trim().length < 2) {
      throw new Error('恢复目标路径不合法，已阻止操作')
    }
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
    } catch {}
    // 确保父目录存在（tar 解压会在父目录下创建同名目录/文件）
    await this.ensureDir(path.dirname(targetPath))

    const archivePath = path.join(backupDir, fileName)
    // 解压：由于项目已有针对 tar.xz 的抽取逻辑在 files 路由的工具函数中，这里直接采用 tar 解包 gzip 流
    // 简化：先gunzip写入临时tar，再tar.extract
    const tempTarPath = archivePath.replace(/\.(tar\.xz|txz)$/i, '.tar')
    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(archivePath)
      const gunzip = zlib.createGunzip()
      const writeStream = createWriteStream(tempTarPath)
      readStream.pipe(gunzip).pipe(writeStream)
        .on('finish', () => resolve())
        .on('error', reject)
    })

    await tar.extract({ file: tempTarPath, cwd: path.dirname(targetPath) } as any)
    try { await fs.unlink(tempTarPath) } catch {}
    return { targetPath }
  }

  async deleteBackupFile(backupName: string, fileName: string): Promise<void> {
    const backupDir = path.join(this.backupRoot, backupName)
    const target = path.join(backupDir, fileName)
    await fs.unlink(target)
  }

  async deleteBackupFolder(backupName: string): Promise<void> {
    const dir = path.join(this.backupRoot, backupName)
    await fs.rm(dir, { recursive: true, force: true })
  }
}

export const backupManager = new BackupManager()


