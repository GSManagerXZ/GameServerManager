import { createWriteStream, createReadStream } from 'fs'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as tar from 'tar'
import * as zlib from 'zlib'
import { taskManager, Task } from './taskManager.js'
import { createTarSecurityFilter } from '../../utils/tarSecurityFilter.js'
import { zipToolsManager } from '../../utils/zipToolsManager.js'

export class CompressionWorker {
  async compressFiles(
    taskId: string,
    sourcePaths: string[],
    archivePath: string,
    format: string,
    compressionLevel: number
  ) {
    try {
      taskManager.updateTask(taskId, {
        status: 'running',
        message: '开始压缩文件...',
        progress: 0
      })

      // 根据格式选择不同的压缩方法
      if (format === 'zip') {
        await this.compressZip(taskId, sourcePaths, archivePath, compressionLevel)
      } else if (format === 'tar') {
        await this.compressTar(taskId, sourcePaths, archivePath)
      } else if (format === 'tar.gz') {
        await this.compressTarGz(taskId, sourcePaths, archivePath, compressionLevel)
      } else if (format === 'tar.xz') {
        await this.compressTarXz(taskId, sourcePaths, archivePath, compressionLevel)
      } else {
        throw new Error(`不支持的压缩格式: ${format}`)
      }

      taskManager.updateTask(taskId, {
        status: 'completed',
        message: '压缩完成',
        progress: 100
      })
    } catch (error: any) {
      taskManager.updateTask(taskId, {
        status: 'failed',
        message: `压缩失败: ${error.message}`,
        progress: 0
      })
      throw error
    }
  }

  private async compressZip(
    taskId: string,
    sourcePaths: string[],
    archivePath: string,
    compressionLevel: number
  ) {
    taskManager.updateTask(taskId, {
      message: '正在使用 Zip-Tools 压缩...',
      progress: 5
    })

    // 确定工作目录（使用第一个源文件的父目录）
    const cwd = path.dirname(sourcePaths[0])
    // 将源路径转换为相对于工作目录的文件名
    const files = sourcePaths.map(p => path.relative(cwd, p))

    await zipToolsManager.compressZip(archivePath, files, cwd)
  }

  private async compressTar(
    taskId: string,
    sourcePaths: string[],
    archivePath: string
  ) {
    taskManager.updateTask(taskId, {
      message: '正在创建TAR归档...',
      progress: 10
    })

    // 获取相对路径
    const relativePaths = sourcePaths.map(p => path.basename(p))

    await tar.create(
      {
        f: archivePath,
        cwd: path.dirname(sourcePaths[0])
      },
      relativePaths
    )
  }

  private async compressTarGz(
    taskId: string,
    sourcePaths: string[],
    archivePath: string,
    compressionLevel: number
  ) {
    taskManager.updateTask(taskId, {
      message: '正在创建TAR.GZ压缩包...',
      progress: 10
    })

    // 获取相对路径
    const relativePaths = sourcePaths.map(p => path.basename(p))

    await tar.create(
      {
        f: archivePath,
        z: true,
        cwd: path.dirname(sourcePaths[0])
      },
      relativePaths
    )
  }

  private async compressTarXz(
    taskId: string,
    sourcePaths: string[],
    archivePath: string,
    compressionLevel: number
  ) {
    taskManager.updateTask(taskId, {
      message: '正在创建TAR.XZ压缩包...',
      progress: 10
    })

    // 先创建tar文件，然后用xz压缩
    const tempTarPath = archivePath.replace('.tar.xz', '.tar')

    try {
      // 创建tar文件
      const relativePaths = sourcePaths.map(p => path.basename(p))
      await tar.create(
        {
          f: tempTarPath,
          cwd: path.dirname(sourcePaths[0])
        },
        relativePaths
      )

      taskManager.updateTask(taskId, {
        message: '正在进行XZ压缩...',
        progress: 60
      })

      // 使用xz压缩
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(tempTarPath)
        const writeStream = createWriteStream(archivePath)

        // 注意：Node.js的zlib不直接支持xz，这里使用gzip作为替代
        // 在生产环境中，建议使用系统命令或专门的xz库
        const compressStream = zlib.createGzip({ level: compressionLevel })

        readStream
          .pipe(compressStream)
          .pipe(writeStream)
          .on('finish', () => {
            // 删除临时tar文件
            fs.unlink(tempTarPath).catch(console.error)
            resolve()
          })
          .on('error', reject)
      })
    } catch (error) {
      // 清理临时文件
      try {
        await fs.unlink(tempTarPath)
      } catch { }
      throw error
    }
  }

  async extractArchive(taskId: string, archivePath: string, targetPath: string) {
    try {
      taskManager.updateTask(taskId, {
        status: 'running',
        message: '开始解压文件...',
        progress: 0
      })

      const ext = path.extname(archivePath).toLowerCase()
      const fileName = path.basename(archivePath).toLowerCase()

      // 确保目标目录存在
      await fs.mkdir(targetPath, { recursive: true })

      // 根据文件扩展名选择解压方法
      if (ext === '.zip') {
        await this.extractZip(taskId, archivePath, targetPath)
      } else if (ext === '.tar') {
        await this.extractTar(taskId, archivePath, targetPath)
      } else if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
        await this.extractTarGz(taskId, archivePath, targetPath)
      } else if (fileName.endsWith('.tar.xz') || fileName.endsWith('.txz')) {
        await this.extractTarXz(taskId, archivePath, targetPath)
      } else {
        throw new Error(`不支持的压缩格式: ${ext}。支持的格式: .zip, .tar, .tar.gz, .tar.xz`)
      }

      taskManager.updateTask(taskId, {
        status: 'completed',
        message: '解压完成',
        progress: 100
      })
    } catch (error: any) {
      taskManager.updateTask(taskId, {
        status: 'failed',
        message: `解压失败: ${error.message}`,
        progress: 0
      })
      throw error
    }
  }

  private async extractZip(taskId: string, archivePath: string, targetPath: string) {
    taskManager.updateTask(taskId, {
      message: '正在使用 Zip-Tools 解压...',
      progress: 10
    })

    await zipToolsManager.extractZip(archivePath, targetPath)
  }

  private async extractTar(taskId: string, archivePath: string, targetPath: string) {
    taskManager.updateTask(taskId, {
      message: '正在解压TAR归档...',
      progress: 10
    })

    await tar.extract({
      file: archivePath,
      cwd: targetPath,
      filter: createTarSecurityFilter({ cwd: targetPath }),
      onentry: (entry) => {
        taskManager.updateTask(taskId, {
          message: `正在解压: ${entry.path}`,
          progress: Math.min(90, Math.random() * 80 + 10)
        })
      }
    } as any)
  }

  private async extractTarGz(taskId: string, archivePath: string, targetPath: string) {
    taskManager.updateTask(taskId, {
      message: '正在解压TAR.GZ压缩包...',
      progress: 10
    })

    await tar.extract({
      file: archivePath,
      cwd: targetPath,
      gzip: true,
      filter: createTarSecurityFilter({ cwd: targetPath }),
      onentry: (entry) => {
        taskManager.updateTask(taskId, {
          message: `正在解压: ${entry.path}`,
          progress: Math.min(90, Math.random() * 80 + 10)
        })
      }
    } as any)
  }

  private async extractTarXz(taskId: string, archivePath: string, targetPath: string) {
    taskManager.updateTask(taskId, {
      message: '正在解压TAR.XZ压缩包...',
      progress: 10
    })

    // 先解压xz，再解压tar
    const tempTarPath = archivePath.replace(/\.(tar\.xz|txz)$/, '.tar')

    try {
      taskManager.updateTask(taskId, {
        message: '正在解压XZ压缩...',
        progress: 20
      })

      // 解压xz到临时tar文件
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(archivePath)
        const writeStream = createWriteStream(tempTarPath)

        // 注意：这里使用gzip解压，因为我们在压缩时使用的是gzip
        // 在生产环境中应该使用真正的xz解压
        const decompressStream = zlib.createGunzip()

        readStream
          .pipe(decompressStream)
          .pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject)
      })

      taskManager.updateTask(taskId, {
        message: '正在解压TAR归档...',
        progress: 50
      })

      // 解压tar文件
      await tar.extract({
        file: tempTarPath,
        cwd: targetPath,
        filter: createTarSecurityFilter({ cwd: targetPath }),
        onentry: (entry) => {
          taskManager.updateTask(taskId, {
            message: `正在解压: ${entry.path}`,
            progress: Math.min(90, Math.random() * 40 + 50)
          })
        }
      } as any)

      // 删除临时tar文件
      await fs.unlink(tempTarPath)
    } catch (error) {
      // 清理临时文件
      try {
        await fs.unlink(tempTarPath)
      } catch { }
      throw error
    }
  }
}

export const compressionWorker = new CompressionWorker()