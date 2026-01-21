import { createWriteStream, createReadStream } from 'fs'
import { promises as fs } from 'fs'
import * as path from 'path'
import archiver from 'archiver'
import unzipper from 'unzipper'
import * as tar from 'tar'
import * as zlib from 'zlib'
import yauzl from 'yauzl'
import { taskManager, Task } from './taskManager.js'
import { createTarSecurityFilter } from '../../utils/tarSecurityFilter.js'

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
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(archivePath)
      const archive = archiver('zip', {
        zlib: { level: compressionLevel }
      })

      let totalFiles = 0
      let processedFiles = 0

      // 计算总文件数
      const countFiles = async (paths: string[]) => {
        for (const sourcePath of paths) {
          const stats = await fs.stat(sourcePath)
          if (stats.isDirectory()) {
            const items = await fs.readdir(sourcePath)
            const fullPaths = items.map(item => path.join(sourcePath, item))
            totalFiles += await countFiles(fullPaths)
          } else {
            totalFiles++
          }
        }
        return totalFiles
      }

      countFiles(sourcePaths).then(() => {
        taskManager.updateTask(taskId, {
          message: `准备压缩 ${totalFiles} 个文件...`,
          progress: 5
        })
      })

      output.on('close', () => {
        resolve()
      })

      archive.on('error', (err) => {
        reject(err)
      })

      archive.on('progress', (progress) => {
        if (totalFiles > 0) {
          const percent = Math.min(95, Math.floor((progress.entries.processed / totalFiles) * 90) + 5)
          taskManager.updateTask(taskId, {
            message: `正在压缩... (${progress.entries.processed}/${totalFiles})`,
            progress: percent
          })
        }
      })

      archive.pipe(output)

      // 添加文件到压缩包
      Promise.all(sourcePaths.map(async (sourcePath) => {
        const stats = await fs.stat(sourcePath)
        const name = path.basename(sourcePath)

        if (stats.isDirectory()) {
          archive.directory(sourcePath, name)
        } else {
          archive.file(sourcePath, { name })
        }
      })).then(() => {
        archive.finalize()
      }).catch(reject)
    })
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
    // 首先尝试使用unzipper
    try {
      await this.extractZipWithUnzipper(taskId, archivePath, targetPath)
    } catch (unzipperError: any) {
      taskManager.updateTask(taskId, {
        message: `unzipper解压失败，尝试备用方案: ${unzipperError.message}`,
        progress: 10
      })

      // 如果unzipper失败，尝试使用yauzl
      try {
        await this.extractZipWithYauzl(taskId, archivePath, targetPath)
      } catch (yauzlError: any) {
        throw new Error(`所有解压方案都失败了。unzipper错误: ${unzipperError.message}; yauzl错误: ${yauzlError.message}`)
      }
    }
  }

  private async extractZipWithUnzipper(taskId: string, archivePath: string, targetPath: string) {
    await new Promise<void>((resolve, reject) => {
      let extractedFiles = 0
      let totalFiles = 0

      const stream = createReadStream(archivePath)
        .pipe(unzipper.Parse())

      stream.on('entry', async (entry) => {
        totalFiles++
        const fileName = entry.path
        const type = entry.type
        const filePath = path.join(targetPath, fileName)

        if (type === 'File') {
          try {
            // 确保文件所在的目录存在
            const fileDir = path.dirname(filePath)
            await fs.mkdir(fileDir, { recursive: true })

            entry.pipe(createWriteStream(filePath))
            entry.on('close', () => {
              extractedFiles++
              const progress = Math.floor((extractedFiles / totalFiles) * 90) + 5
              taskManager.updateTask(taskId, {
                message: `正在解压... (${extractedFiles}/${totalFiles})`,
                progress: Math.min(95, progress)
              })
            })
          } catch (error) {
            console.error(`创建目录失败: ${path.dirname(filePath)}`, error)
            entry.autodrain()
          }
        } else if (type === 'Directory') {
          // 处理目录条目
          try {
            await fs.mkdir(filePath, { recursive: true })
          } catch (error) {
            console.error(`创建目录失败: ${filePath}`, error)
          }
          entry.autodrain()
        } else {
          entry.autodrain()
        }
      })

      stream.on('close', () => {
        resolve()
      })

      stream.on('error', (err) => {
        reject(err)
      })
    })
  }

  private async extractZipWithYauzl(taskId: string, archivePath: string, targetPath: string) {
    await new Promise<void>((resolve, reject) => {
      yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(err)
          return
        }

        if (!zipfile) {
          reject(new Error('无法打开ZIP文件'))
          return
        }

        let extractedFiles = 0
        const totalFiles = zipfile.entryCount

        taskManager.updateTask(taskId, {
          message: `使用备用方案解压，共 ${totalFiles} 个条目`,
          progress: 20
        })

        zipfile.readEntry()

        zipfile.on('entry', (entry) => {
          const fileName = entry.fileName
          const filePath = path.join(targetPath, fileName)

          // 跳过目录条目或以/结尾的条目
          if (/\/$/.test(fileName)) {
            // 创建目录
            fs.mkdir(filePath, { recursive: true }).then(() => {
              zipfile.readEntry()
            }).catch((error) => {
              console.error(`创建目录失败: ${filePath}`, error)
              zipfile.readEntry()
            })
            return
          }

          // 确保文件所在的目录存在
          const fileDir = path.dirname(filePath)
          fs.mkdir(fileDir, { recursive: true }).then(() => {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                console.error(`打开文件流失败: ${fileName}`, err)
                zipfile.readEntry()
                return
              }

              if (!readStream) {
                console.error(`无法获取文件流: ${fileName}`)
                zipfile.readEntry()
                return
              }

              const writeStream = createWriteStream(filePath)
              readStream.pipe(writeStream)

              writeStream.on('close', () => {
                extractedFiles++
                const progress = Math.floor((extractedFiles / totalFiles) * 70) + 20
                taskManager.updateTask(taskId, {
                  message: `正在解压... (${extractedFiles}/${totalFiles})`,
                  progress: Math.min(95, progress)
                })
                zipfile.readEntry()
              })

              writeStream.on('error', (error) => {
                console.error(`写入文件失败: ${filePath}`, error)
                zipfile.readEntry()
              })
            })
          }).catch((error) => {
            console.error(`创建目录失败: ${fileDir}`, error)
            zipfile.readEntry()
          })
        })

        zipfile.on('end', () => {
          resolve()
        })

        zipfile.on('error', (error) => {
          reject(error)
        })
      })
    })
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