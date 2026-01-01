import axios, { AxiosInstance } from 'axios'
import { FileItem, FileOperationResult, FileSearchResult, FileContent, Task, FileListResponse } from '@/types/file'
import { useNotificationStore } from '@/stores/notificationStore'

const API_BASE = '/api/files'

export class FileApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: '',
      timeout: 0, // 取消超时限制
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // 请求拦截器 - 自动添加认证token
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('gsm3_token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // 响应拦截器 - 处理401错误
    this.client.interceptors.response.use(
      (response) => {
        return response
      },
      (error) => {
        if (error.response?.status === 401) {
          // 添加消息通知
          try {
            const { addNotification } = useNotificationStore.getState()
            addNotification({
              type: 'error',
              title: '认证失败',
              message: '您的登录状态已过期，请退出重新登录',
              duration: 5000
            })
          } catch (notificationError) {
            console.error('添加通知失败:', notificationError)
          }
        }
        return Promise.reject(error)
      }
    )
  }
  // 获取目录内容
  async listDirectory(path: string = '/', page: number = 1, pageSize: number = 50): Promise<FileListResponse> {
    const response = await this.client.get(`${API_BASE}/list`, {
      params: { path, page, pageSize }
    })
    return response.data.data
  }

  // 读取文件内容
  async readFile(path: string, encoding?: string): Promise<FileContent> {
    const response = await this.client.get(`${API_BASE}/read-content`, {
      params: {
        path,
        ...(encoding && { encoding })
      }
    })
    return response.data.data
  }

  // 获取图片预览URL
  getImagePreviewUrl(path: string): string {
    // 将Windows路径转换为Unix风格，然后对路径进行编码
    // 但不要对整个路径进行encodeURIComponent，因为这会编码斜杠
    const normalizedPath = path.replace(/\\/g, '/')
    const encodedPath = normalizedPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
    // 确保返回完整的URL路径
    return `${window.location.origin}${API_BASE}/preview?path=${encodedPath}`
  }

  // 保存文件内容
  async saveFile(path: string, content: string, encoding: string = 'utf-8'): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/save`, {
      path,
      content,
      encoding: encoding || 'utf-8'
    })
    return response.data
  }

  // 创建文件
  async createFile(path: string, content: string = '', encoding: string = 'utf-8'): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/create`, {
      path,
      content,
      encoding
    })
    return response.data
  }

  // 创建目录
  async createDirectory(path: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/mkdir`, {
      dirPath: path
    })
    return response.data
  }

  // 删除文件或目录
  async deleteItems(paths: string[]): Promise<FileOperationResult> {
    const response = await this.client.delete(`${API_BASE}/delete`, {
      data: { paths }
    })
    return response.data
  }

  // 重命名文件或目录
  async renameItem(oldPath: string, newPath: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/rename`, {
      oldPath,
      newPath
    })
    return response.data
  }

  // 复制文件或目录
  async copyItem(sourcePath: string, targetPath: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/copy`, {
      sourcePath,
      targetPath
    })
    return response.data
  }

  // 批量复制文件或目录
  async copyItems(sourcePaths: string[], targetPath: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/copy`, {
      sourcePaths,
      targetPath
    })
    return response.data
  }

  // 移动文件或目录
  async moveItem(sourcePath: string, targetPath: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/move`, {
      sourcePath,
      targetPath
    })
    return response.data
  }

  // 批量移动文件或目录
  async moveItems(sourcePaths: string[], targetPath: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/move`, {
      sourcePaths,
      targetPath
    })
    return response.data
  }

  // 搜索文件
  async searchFiles(
    searchPath: string,
    query: string,
    type: string = 'all',
    caseSensitive: boolean = false,
    maxResults: number = 100
  ): Promise<FileSearchResult> {
    const response = await this.client.get(`${API_BASE}/search`, {
      params: {
        path: searchPath,
        query,
        type,
        case_sensitive: caseSensitive,
        max_results: maxResults
      }
    })
    return response.data
  }

  // 下载文件（立即触发下载）
  downloadFile(path: string): void {
    const token = localStorage.getItem('gsm3_token')

    // 构建带认证的URL
    const baseUrl = `${API_BASE}/download?path=${encodeURIComponent(path)}`
    const url = token ? `${baseUrl}&token=${encodeURIComponent(token)}` : baseUrl

    // 方法1：使用隐藏的iframe进行下载（推荐，支持认证）
    try {
      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.style.position = 'absolute'
      iframe.style.left = '-9999px'
      iframe.style.top = '-9999px'
      iframe.name = 'download_iframe_' + Date.now()

      document.body.appendChild(iframe)

      // 直接设置iframe的src来触发下载
      iframe.src = url

      // 清理DOM元素
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe)
        }
      }, 5000) // 增加清理时间，确保下载完成

      console.log('开始下载文件:', path)
    } catch (error) {
      console.error('iframe下载失败，尝试备用方法:', error)

      // 方法2：备用方案 - 使用隐藏的链接点击
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = ''
        link.style.display = 'none'
        link.target = '_blank'

        document.body.appendChild(link)
        link.click()

        // 清理DOM元素
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link)
          }
        }, 1000)

        console.log('使用链接点击下载文件:', path)
      } catch (fallbackError) {
        console.error('链接下载也失败了，尝试最后的方法:', fallbackError)

        // 方法3：最后的备用方案 - 直接跳转
        try {
          window.open(url, '_blank')
          console.log('使用window.open下载文件:', path)
        } catch (finalError) {
          console.error('所有下载方法都失败了:', finalError)
          // 显示错误提示
          alert('下载失败，请稍后重试')
        }
      }
    }
  }

  // 创建下载任务（带进度）
  async createDownloadTask(path: string): Promise<{ taskId: string; message: string }> {
    const response = await this.client.get(`${API_BASE}/download`, {
      params: {
        path,
        withProgress: 'true'
      }
    })
    return response.data
  }

  // 执行下载任务
  downloadFileWithProgress(taskId: string): void {
    const token = localStorage.getItem('gsm3_token')
    const url = `${API_BASE}/download-task/${taskId}`

    // 创建一个临时的a标签进行下载
    const link = document.createElement('a')
    link.href = url
    link.style.display = 'none'

    // 添加认证头
    if (token) {
      // 对于直接下载链接，我们需要在URL中包含token或使用其他方式
      // 这里我们使用fetch来处理认证
      fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`下载失败: ${response.status}`)
          }

          // 从响应头中获取文件名
          const contentDisposition = response.headers.get('Content-Disposition')
          let fileName = 'download'

          if (contentDisposition) {
            const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/)
            if (utf8Match) {
              try {
                fileName = decodeURIComponent(utf8Match[1])
              } catch (e) {
                console.warn('Failed to decode UTF-8 filename:', e)
              }
            } else {
              const normalMatch = contentDisposition.match(/filename="([^"]+)"/)
              if (normalMatch) {
                fileName = normalMatch[1]
              }
            }
          }

          return response.blob().then(blob => ({ blob, fileName }))
        })
        .then(({ blob, fileName }) => {
          const downloadUrl = window.URL.createObjectURL(blob)
          link.href = downloadUrl
          link.download = fileName
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          window.URL.revokeObjectURL(downloadUrl)

          console.log('文件下载成功:', fileName)
        })
        .catch(error => {
          console.error('下载失败:', error)
        })
    }
  }

  // 检查文件上传冲突
  async checkUploadConflicts(
    targetPath: string,
    fileNames: string[]
  ): Promise<{
    hasConflicts: boolean
    conflicts: Array<{
      fileName: string
      exists: boolean
      existingSize?: number
      existingModified?: Date
    }>
  }> {
    const response = await this.client.post(`${API_BASE}/upload/check-conflict`, {
      targetPath,
      fileNames
    })
    return response.data.data
  }

  // 上传文件
  async uploadFiles(
    targetPath: string,
    files: FileList,
    onProgress?: (progress: { fileName: string; progress: number; status: 'uploading' | 'completed' | 'error' }) => void,
    conflictStrategy: 'replace' | 'rename' | 'skip' = 'rename'
  ): Promise<FileOperationResult> {
    const formData = new FormData()
    formData.append('targetPath', targetPath)
    formData.append('conflictStrategy', conflictStrategy)

    // 处理文件名编码，确保中文文件名正确传输
    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      // 检查文件名是否包含中文字符
      const hasChineseChars = /[\u4e00-\u9fa5]/.test(file.name)

      if (hasChineseChars) {
        // 对于包含中文的文件名，创建一个新的File对象确保编码正确
        const blob = new Blob([file], { type: file.type })
        const newFile = new File([blob], file.name, {
          type: file.type,
          lastModified: file.lastModified
        })
        formData.append('files', newFile, file.name)
        console.log('Uploading Chinese filename:', file.name)
      } else {
        formData.append('files', file)
      }
    }

    // 创建可取消的请求
    const controller = new AbortController()

    try {
      const response = await this.client.post(`${API_BASE}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 300000, // 5分钟超时
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            // 对于多文件上传，这里简化处理，显示总体进度
            onProgress({
              fileName: files.length === 1 ? files[0].name : `${files.length} 个文件`,
              progress,
              status: progress === 100 ? 'completed' : 'uploading'
            })
          }
        }
      })
      return response.data
    } catch (error: any) {
      // 如果是取消请求，不报错
      if (error.name === 'CanceledError') {
        console.log('上传已取消')
      }
      throw error
    }
  }

  // 上传单个文件（小文件，直接上传）
  async uploadSingleFile(
    targetPath: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<FileOperationResult> {
    const formData = new FormData()
    formData.append('targetPath', targetPath)

    // 检查文件名是否包含中文字符
    const hasChineseChars = /[\u4e00-\u9fa5]/.test(file.name)

    if (hasChineseChars) {
      const blob = new Blob([file], { type: file.type })
      const newFile = new File([blob], file.name, {
        type: file.type,
        lastModified: file.lastModified
      })
      formData.append('files', newFile, file.name)
    } else {
      formData.append('files', file)
    }

    const response = await this.client.post(`${API_BASE}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 300000, // 5分钟超时
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          onProgress(progress)
        }
      }
    })
    return response.data
  }

  // 压缩文件
  async compressFiles(
    sourcePaths: string[],
    targetPath: string,
    archiveName: string,
    format: string = 'zip',
    compressionLevel: number = 6
  ): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/compress`, {
      sourcePaths,
      targetPath,
      archiveName,
      format,
      compressionLevel
    })
    return response.data
  }

  // 解压文件
  async extractArchive(archivePath: string, targetPath: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/extract`, {
      archivePath,
      targetPath
    })
    return response.data
  }

  // 获取所有任务
  async getTasks(): Promise<Task[]> {
    const response = await this.client.get(`${API_BASE}/tasks`)
    return response.data.data
  }

  // 获取活动任务
  async getActiveTasks(): Promise<Task[]> {
    const response = await this.client.get(`${API_BASE}/tasks/active`)
    return response.data.data
  }

  // 获取单个任务状态
  async getTask(taskId: string): Promise<Task> {
    const response = await this.client.get(`${API_BASE}/tasks/${taskId}`)
    return response.data.data
  }

  // 删除任务
  async deleteTask(taskId: string): Promise<FileOperationResult> {
    const response = await this.client.delete(`${API_BASE}/tasks/${taskId}`)
    return response.data
  }

  // 获取系统盘符
  async getDrives(): Promise<Array<{ label: string; value: string; type: string }>> {
    const response = await this.client.get(`${API_BASE}/drives`)
    return response.data.data
  }

  // 获取文件权限信息
  async getFilePermissions(path: string): Promise<{
    owner: string
    group: string
    permissions: {
      owner: { read: boolean; write: boolean; execute: boolean }
      group: { read: boolean; write: boolean; execute: boolean }
      others: { read: boolean; write: boolean; execute: boolean }
    }
    octal: string
  }> {
    const response = await this.client.get(`${API_BASE}/permissions`, {
      params: { path }
    })
    return response.data.data
  }

  // 修改文件权限
  async setFilePermissions(
    path: string,
    permissions: {
      owner: { read: boolean; write: boolean; execute: boolean }
      group: { read: boolean; write: boolean; execute: boolean }
      others: { read: boolean; write: boolean; execute: boolean }
    },
    recursive?: boolean
  ): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/permissions`, {
      path,
      permissions,
      recursive
    })
    return response.data
  }

  // 修改文件所有者
  async setFileOwnership(
    path: string,
    owner?: string,
    group?: string,
    recursive?: boolean
  ): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/ownership`, {
      path,
      owner,
      group,
      recursive
    })
    return response.data
  }

  // 获取收藏列表
  async getFavorites(): Promise<Array<{
    path: string
    name: string
    type: 'file' | 'directory'
    exists: boolean
  }>> {
    const response = await this.client.get(`${API_BASE}/favorites`)
    return response.data.data
  }

  // 添加收藏
  async addFavorite(path: string): Promise<FileOperationResult> {
    const response = await this.client.post(`${API_BASE}/favorites`, {
      path
    })
    return response.data
  }

  // 移除收藏
  async removeFavorite(path: string): Promise<FileOperationResult> {
    const response = await this.client.delete(`${API_BASE}/favorites`, {
      data: { path }
    })
    return response.data
  }

  // 检查是否已收藏
  async checkFavorite(path: string): Promise<boolean> {
    const response = await this.client.get(`${API_BASE}/favorites/check`, {
      params: { path }
    })
    return response.data.data.isFavorited
  }
}

export const fileApiClient = new FileApiClient()