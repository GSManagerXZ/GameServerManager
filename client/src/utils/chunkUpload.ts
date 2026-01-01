/**
 * 文件分片上传工具类
 * 支持大文件分片上传、断点续传、自动重试
 */

export interface ChunkUploadOptions {
  file: File
  targetPath: string
  chunkSize?: number // 默认50MB
  maxRetries?: number // 单个分片最大重试次数
  onProgress?: (progress: number) => void
  onChunkProgress?: (chunkIndex: number, totalChunks: number, chunkProgress: number) => void
  onDetailProgress?: (detail: UploadDetailProgress) => void // 详细进度回调
  onError?: (error: Error) => void
  signal?: AbortSignal // 支持取消上传
  conflictStrategy?: 'replace' | 'rename' // 文件冲突处理策略
}

export interface ChunkProgressInfo {
  chunkIndex: number
  status: 'pending' | 'uploading' | 'completed' | 'error' | 'retrying'
  progress: number // 0-100
  size: number
  uploadedSize: number
  retryCount?: number
  error?: string
}

export interface UploadDetailProgress {
  phase: 'preparing' | 'uploading' | 'merging' | 'completed' | 'error'
  phaseText: string
  currentChunk: number
  totalChunks: number
  uploadedChunks: number
  uploadedSize: number
  totalSize: number
  percentage: number
  speed: number // bytes/s
  speedText: string
  remainingTime: number // seconds
  remainingTimeText: string
  currentBatch: number
  totalBatches: number
  chunksProgress: ChunkProgressInfo[] // 所有分片的进度
  mergingProgress?: number // 合并进度 0-100
  retryInfo?: {
    chunkIndex: number
    retryCount: number
    maxRetries: number
  }
  errorMessage?: string
}

export interface ChunkInfo {
  chunkIndex: number
  chunkSize: number
  start: number
  end: number
  hash: string
}

export interface UploadProgress {
  uploadedChunks: number
  totalChunks: number
  uploadedSize: number
  totalSize: number
  percentage: number
  speed: number // bytes/s
  remainingTime: number // seconds
}

export class ChunkUploader {
  private static readonly DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024 // 50MB
  private static readonly MIN_CHUNK_SIZE = 1 * 1024 * 1024 // 1MB
  private static readonly MAX_RETRIES = 5 // 增加重试次数
  private static readonly CONCURRENT_UPLOADS = 3 // 并发数
  private static readonly CHUNK_UPLOAD_TIMEOUT = 300000 // 单个分片上传超时时间：5分钟（50MB需要更长时间）
  private static readonly RETRY_BASE_DELAY = 2000 // 重试基础延迟：2秒

  private file: File
  private targetPath: string
  private chunkSize: number
  private maxRetries: number
  private onProgress?: (progress: number) => void
  private onChunkProgress?: (chunkIndex: number, totalChunks: number, chunkProgress: number) => void
  private onDetailProgress?: (detail: UploadDetailProgress) => void
  private onError?: (error: Error) => void
  private signal?: AbortSignal
  private conflictStrategy: 'replace' | 'rename'

  private uploadId: string
  private chunks: ChunkInfo[] = []
  private uploadedChunks: Set<number> = new Set()
  private uploadStartTime: number = 0
  private uploadedSize: number = 0
  private retryCount: Map<number, number> = new Map()
  private aborted: boolean = false
  private currentChunk: number = 0
  private currentBatch: number = 0
  private totalBatches: number = 0
  private chunksProgressMap: Map<number, ChunkProgressInfo> = new Map()

  constructor(options: ChunkUploadOptions) {
    this.file = options.file
    this.targetPath = options.targetPath
    this.chunkSize = options.chunkSize || ChunkUploader.DEFAULT_CHUNK_SIZE
    this.maxRetries = options.maxRetries || ChunkUploader.MAX_RETRIES
    this.onProgress = options.onProgress
    this.onChunkProgress = options.onChunkProgress
    this.onDetailProgress = options.onDetailProgress
    this.onError = options.onError
    this.signal = options.signal
    this.conflictStrategy = options.conflictStrategy || 'rename'

    // 生成唯一的上传ID
    this.uploadId = this.generateUploadId()

    // 监听取消信号
    if (this.signal) {
      this.signal.addEventListener('abort', () => {
        this.aborted = true
      })
    }
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
  }

  /**
   * 格式化速度
   */
  private formatSpeed(bytesPerSecond: number): string {
    return this.formatSize(bytesPerSecond) + '/s'
  }

  /**
   * 格式化时间
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}秒`
    if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
    return `${Math.round(seconds / 3600)}小时`
  }

  /**
   * 更新分片进度
   */
  private updateChunkProgress(chunkIndex: number, status: ChunkProgressInfo['status'], progress: number = 0, uploadedSize: number = 0) {
    const chunk = this.chunks[chunkIndex]
    if (!chunk) return

    const existingProgress = this.chunksProgressMap.get(chunkIndex) || {
      chunkIndex,
      status: 'pending',
      progress: 0,
      size: chunk.chunkSize,
      uploadedSize: 0
    }

    this.chunksProgressMap.set(chunkIndex, {
      ...existingProgress,
      status,
      progress,
      uploadedSize,
      retryCount: this.retryCount.get(chunkIndex)
    })
  }

  /**
   * 发送详细进度
   */
  private sendDetailProgress(phase: UploadDetailProgress['phase'], phaseText: string, extra?: Partial<UploadDetailProgress>) {
    if (!this.onDetailProgress) return

    const elapsed = Date.now() - this.uploadStartTime
    const speed = elapsed > 0 ? (this.uploadedSize / elapsed) * 1000 : 0
    const remainingSize = this.file.size - this.uploadedSize
    const remainingTime = speed > 0 ? remainingSize / speed : 0
    const percentage = this.file.size > 0 ? Math.round((this.uploadedSize / this.file.size) * 100) : 0

    // 获取所有分片进度（按索引排序）
    const chunksProgress = Array.from(this.chunksProgressMap.values())
      .sort((a, b) => a.chunkIndex - b.chunkIndex)

    this.onDetailProgress({
      phase,
      phaseText,
      currentChunk: this.currentChunk,
      totalChunks: this.chunks.length,
      uploadedChunks: this.uploadedChunks.size,
      uploadedSize: this.uploadedSize,
      totalSize: this.file.size,
      percentage,
      speed,
      speedText: this.formatSpeed(speed),
      remainingTime,
      remainingTimeText: this.formatTime(remainingTime),
      currentBatch: this.currentBatch,
      totalBatches: this.totalBatches,
      chunksProgress,
      ...extra
    })
  }

  /**
   * 生成上传ID
   */
  private generateUploadId(): string {
    return `upload_${this.file.name}_${this.file.size}_${Date.now()}`
  }

  /**
   * 计算文件分片
   */
  private async calculateChunks(): Promise<void> {
    const totalChunks = Math.ceil(this.file.size / this.chunkSize)
    this.chunks = []

    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize
      const end = Math.min(start + this.chunkSize, this.file.size)
      const chunk = this.file.slice(start, end)

      // 计算分片hash用于校验
      const hash = await this.calculateHash(chunk)

      this.chunks.push({
        chunkIndex: i,
        chunkSize: end - start,
        start,
        end,
        hash
      })

      // 初始化分片进度
      this.updateChunkProgress(i, 'pending', 0, 0)
    }
  }

  /**
   * 计算分片hash
   */
  private async calculateHash(blob: Blob): Promise<string> {
    try {
      // 检查 crypto.subtle 是否可用（仅在安全上下文中可用）
      if (!crypto || !crypto.subtle || !crypto.subtle.digest) {
        console.warn('crypto.subtle 不可用，跳过hash计算')
        return 'skip'
      }

      const buffer = await blob.arrayBuffer()
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    } catch (error) {
      console.warn('计算hash失败，跳过hash计算:', error)
      return 'skip'
    }
  }

  /**
   * 检查已上传的分片（断点续传）
   */
  private async checkUploadedChunks(): Promise<void> {
    try {
      const token = localStorage.getItem('gsm3_token')
      const response = await fetch('/api/files/upload/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          uploadId: this.uploadId,
          fileName: this.file.name,
          fileSize: this.file.size,
          totalChunks: this.chunks.length
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.uploadedChunks && Array.isArray(data.uploadedChunks)) {
          data.uploadedChunks.forEach((chunkIndex: number) => {
            this.uploadedChunks.add(chunkIndex)
            const chunk = this.chunks[chunkIndex]
            if (chunk) {
              this.uploadedSize += chunk.chunkSize
            }
          })
          console.log(`断点续传: 已上传 ${this.uploadedChunks.size}/${this.chunks.length} 个分片`)
        }
      }
    } catch (error) {
      console.warn('检查已上传分片失败，将从头开始上传:', error)
      // 失败不影响上传流程，从头开始上传
    }
  }

  /**
   * 上传单个分片
   */
  private async uploadChunk(chunkInfo: ChunkInfo): Promise<void> {
    if (this.aborted) {
      throw new Error('Upload aborted')
    }

    const { chunkIndex, start, end, hash } = chunkInfo
    const chunk = this.file.slice(start, end)

    const formData = new FormData()
    formData.append('uploadId', this.uploadId)
    formData.append('fileName', this.file.name)
    formData.append('fileSize', this.file.size.toString())
    formData.append('chunkIndex', chunkIndex.toString())
    formData.append('totalChunks', this.chunks.length.toString())
    formData.append('chunkHash', hash)
    formData.append('targetPath', this.targetPath)
    // 创建一个带有正确文件名的Blob，而不是直接append chunk
    const chunkBlob = new Blob([chunk], { type: 'application/octet-stream' })
    const chunkFileName = `${this.file.name}.part${chunkIndex}`
    formData.append('chunk', chunkBlob, chunkFileName)

    const token = localStorage.getItem('gsm3_token')

    // 使用 XMLHttpRequest 以支持进度回调
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      // 监听上传进度
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const chunkProgress = (event.loaded / event.total) * 100

          // 更新分片进度
          this.updateChunkProgress(chunkIndex, 'uploading', chunkProgress, event.loaded)
          this.sendDetailProgress('uploading', `正在上传分片 ${chunkIndex + 1}/${this.chunks.length}`)

          if (this.onChunkProgress) {
            this.onChunkProgress(chunkIndex, this.chunks.length, chunkProgress)
          }
        }
      })

      // 监听完成
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            if (response.success) {
              this.uploadedChunks.add(chunkIndex)
              this.uploadedSize += chunkInfo.chunkSize
              this.updateProgress()
              resolve()
            } else {
              reject(new Error(response.message || '分片上传失败'))
            }
          } catch (error) {
            reject(new Error('解析响应失败'))
          }
        } else {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`))
        }
      })

      // 监听错误
      xhr.addEventListener('error', () => {
        reject(new Error('网络错误'))
      })

      xhr.addEventListener('abort', () => {
        reject(new Error('上传已取消'))
      })

      // 监听超时 - 增加到2分钟
      xhr.timeout = ChunkUploader.CHUNK_UPLOAD_TIMEOUT
      xhr.addEventListener('timeout', () => {
        reject(new Error('上传超时，请检查网络连接'))
      })

      // 取消信号
      if (this.signal) {
        this.signal.addEventListener('abort', () => {
          xhr.abort()
        })
      }

      xhr.open('POST', '/api/files/upload/chunk')
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }
      xhr.send(formData)
    })
  }

  /**
   * 上传单个分片（带重试）
   */
  private async uploadChunkWithRetry(chunkInfo: ChunkInfo): Promise<void> {
    const { chunkIndex } = chunkInfo
    let lastError: Error | null = null

    this.currentChunk = chunkIndex

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (this.aborted) {
          throw new Error('Upload aborted')
        }

        // 标记为上传中
        this.updateChunkProgress(chunkIndex, 'uploading', 0, 0)
        this.sendDetailProgress('uploading', `正在上传分片 ${chunkIndex + 1}/${this.chunks.length}`)

        await this.uploadChunk(chunkInfo)
        this.retryCount.delete(chunkIndex)

        // 标记为完成
        this.updateChunkProgress(chunkIndex, 'completed', 100, chunkInfo.chunkSize)
        this.sendDetailProgress('uploading', `分片 ${chunkIndex + 1} 上传完成`)

        // 上传成功后，添加短暂延迟，避免请求过快
        if (chunkIndex % 10 === 0) {
          // 每10个分片休息一下，减轻服务器压力
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        return
      } catch (error) {
        lastError = error as Error
        const currentRetry = attempt + 1
        this.retryCount.set(chunkIndex, currentRetry)

        // 标记为错误或重试中
        this.updateChunkProgress(chunkIndex, attempt < this.maxRetries ? 'retrying' : 'error', 0, 0)

        if (attempt < this.maxRetries) {
          // 优化重试策略：使用更长的延迟，并添加随机抖动
          const baseDelay = ChunkUploader.RETRY_BASE_DELAY * Math.pow(2, attempt)
          const jitter = Math.random() * 1000 // 随机0-1秒
          const delay = Math.min(baseDelay + jitter, 30000) // 最大30秒

          console.warn(`分片 ${chunkIndex} 上传失败（${lastError?.message}），${delay.toFixed(0)}ms 后进行第 ${currentRetry} 次重试...`)

          // 发送重试信息
          this.sendDetailProgress('uploading', `分片 ${chunkIndex + 1} 重试中...`, {
            retryInfo: {
              chunkIndex,
              retryCount: currentRetry,
              maxRetries: this.maxRetries
            }
          })

          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          // 所有重试都失败，标记为错误
          const progressInfo = this.chunksProgressMap.get(chunkIndex)
          if (progressInfo) {
            progressInfo.error = lastError?.message
          }
        }
      }
    }

    throw new Error(`分片 ${chunkIndex} 上传失败，已重试 ${this.maxRetries} 次: ${lastError?.message}`)
  }

  /**
   * 更新进度
   */
  private updateProgress(): void {
    if (this.onProgress) {
      const percentage = Math.round((this.uploadedSize / this.file.size) * 100)
      this.onProgress(percentage)
    }
  }

  /**
   * 合并分片
   */
  private async mergeChunks(): Promise<void> {
    const token = localStorage.getItem('gsm3_token')

    // 模拟合并进度（因为后端合并是同步的，我们模拟一个进度）
    const simulateMergingProgress = async () => {
      for (let i = 0; i <= 100; i += 10) {
        if (this.aborted) break
        this.sendDetailProgress('merging', '正在合并文件...', { mergingProgress: i })
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // 启动进度模拟
    const progressPromise = simulateMergingProgress()

    // 实际合并请求
    const mergePromise = fetch('/api/files/upload/merge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` || ''
      },
      body: JSON.stringify({
        uploadId: this.uploadId,
        fileName: this.file.name,
        fileSize: this.file.size,
        totalChunks: this.chunks.length,
        targetPath: this.targetPath,
        conflictStrategy: this.conflictStrategy
      })
    })

    const response = await mergePromise

    // 确保进度达到100%
    this.sendDetailProgress('merging', '正在合并文件...', { mergingProgress: 100 })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || '合并文件失败')
    }

    const data = await response.json()
    if (!data.success) {
      throw new Error(data.message || '合并文件失败')
    }
  }

  /**
   * 开始上传
   */
  async upload(): Promise<void> {
    try {
      this.uploadStartTime = Date.now()

      // 1. 计算分片
      this.sendDetailProgress('preparing', '正在准备上传...')
      console.log(`开始分片上传: ${this.file.name} (${(this.file.size / 1024 / 1024).toFixed(2)} MB)`)
      await this.calculateChunks()
      console.log(`文件已分为 ${this.chunks.length} 个分片，并发数: ${ChunkUploader.CONCURRENT_UPLOADS}`)

      // 2. 检查已上传的分片（断点续传）
      this.sendDetailProgress('preparing', '检查断点续传...')
      await this.checkUploadedChunks()

      // 标记已上传的分片为完成状态
      this.uploadedChunks.forEach(chunkIndex => {
        const chunk = this.chunks[chunkIndex]
        if (chunk) {
          this.updateChunkProgress(chunkIndex, 'completed', 100, chunk.chunkSize)
        }
      })

      // 3. 上传未完成的分片
      const chunksToUpload = this.chunks.filter(chunk => !this.uploadedChunks.has(chunk.chunkIndex))

      if (chunksToUpload.length === 0) {
        console.log('所有分片已上传，直接合并')
        this.sendDetailProgress('merging', '所有分片已存在，正在合并...')
      } else {
        console.log(`需要上传 ${chunksToUpload.length} 个分片，已完成 ${this.uploadedChunks.size} 个`)

        // 并发上传（使用队列控制，避免一次性发送太多请求）
        const concurrency = ChunkUploader.CONCURRENT_UPLOADS
        this.totalBatches = Math.ceil(chunksToUpload.length / concurrency)

        for (let i = 0; i < chunksToUpload.length; i += concurrency) {
          if (this.aborted) {
            throw new Error('Upload aborted')
          }

          this.currentBatch = Math.floor(i / concurrency) + 1
          const batch = chunksToUpload.slice(i, i + concurrency)
          const batchProgress = Math.round(((i + batch.length) / chunksToUpload.length) * 100)
          console.log(`上传批次 ${this.currentBatch}/${this.totalBatches}，进度: ${batchProgress}%`)

          this.sendDetailProgress('uploading', `上传批次 ${this.currentBatch}/${this.totalBatches}`)

          // 并发上传当前批次
          await Promise.all(batch.map(chunk => this.uploadChunkWithRetry(chunk)))

          // 批次之间添加短暂延迟，避免请求过快
          if (i + concurrency < chunksToUpload.length) {
            await new Promise(resolve => setTimeout(resolve, 200))
          }
        }
      }

      // 4. 合并分片
      console.log('所有分片上传完成，开始合并文件...')
      this.sendDetailProgress('merging', '正在合并文件...')
      await this.mergeChunks()

      const duration = (Date.now() - this.uploadStartTime) / 1000
      const speed = this.file.size / duration / 1024 / 1024 // MB/s
      console.log(`文件上传成功！耗时: ${duration.toFixed(2)}秒，平均速度: ${speed.toFixed(2)} MB/s`)

      // 5. 更新最终进度
      if (this.onProgress) {
        this.onProgress(100)
      }

      this.sendDetailProgress('completed', '上传完成！', {
        percentage: 100,
        uploadedSize: this.file.size
      })

    } catch (error) {
      console.error('文件上传失败:', error)

      this.sendDetailProgress('error', '上传失败', {
        errorMessage: (error as Error).message
      })

      if (this.onError) {
        this.onError(error as Error)
      }
      throw error
    }
  }

  /**
   * 判断文件是否需要分片上传
   */
  static shouldUseChunkUpload(fileSize: number): boolean {
    // 大于10MB的文件使用分片上传（提高阈值，减少小文件使用分片）
    return fileSize > 10 * 1024 * 1024
  }

  /**
   * 获取当前上传进度信息
   */
  getProgress(): UploadProgress {
    const uploadedSize = Array.from(this.uploadedChunks)
      .map(idx => this.chunks[idx]?.chunkSize || 0)
      .reduce((sum, size) => sum + size, 0)

    const percentage = this.file.size > 0 ? Math.round((uploadedSize / this.file.size) * 100) : 0
    const elapsed = Date.now() - this.uploadStartTime
    const speed = elapsed > 0 ? (uploadedSize / elapsed) * 1000 : 0 // bytes/s
    const remainingSize = this.file.size - uploadedSize
    const remainingTime = speed > 0 ? remainingSize / speed : 0

    return {
      uploadedChunks: this.uploadedChunks.size,
      totalChunks: this.chunks.length,
      uploadedSize,
      totalSize: this.file.size,
      percentage,
      speed,
      remainingTime
    }
  }
}

