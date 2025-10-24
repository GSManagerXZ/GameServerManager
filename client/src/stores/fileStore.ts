import { create } from 'zustand'
import { FileItem, Task, FileOperationResult, FilePagination } from '@/types/file'
import { fileApiClient } from '@/utils/fileApi'

interface FileStore {
  // 状态
  currentPath: string
  files: FileItem[]
  selectedFiles: Set<string>
  loading: boolean
  error: string | null
  
  // 分页相关
  pagination: FilePagination
  loadingMore: boolean
  
  // 剪贴板相关
  clipboard: {
    items: string[] // 文件路径数组
    operation: 'copy' | 'cut' | null // 操作类型
  }
  
  // 编辑器相关
  openFiles: Map<string, string> // path -> content
  originalFiles: Map<string, string> // path -> original content
  fileEncodings: Map<string, string> // path -> encoding
  activeFile: string | null
  
  // 文件监视相关
  watchedFiles: Set<string> // 被监视的文件路径
  fileChangedDialog: {
    visible: boolean
    filePath: string
    fileName: string
  } | null
  
  // 任务相关
  tasks: Task[]
  activeTasks: Task[]
  
  // 收藏相关
  favorites: Array<{
    path: string
    name: string
    type: 'file' | 'directory'
    exists: boolean
  }>
  
  // 操作方法
  setCurrentPath: (path: string) => void
  loadFiles: (path?: string, reset?: boolean) => Promise<void>
  loadMoreFiles: () => Promise<void>
  selectFile: (path: string) => void
  selectMultipleFiles: (paths: string[]) => void
  unselectFile: (path: string) => void
  clearSelection: () => void
  toggleFileSelection: (path: string) => void
  
  // 文件操作
  createFile: (name: string, content?: string) => Promise<boolean>
  createDirectory: (name: string) => Promise<boolean>
  deleteSelectedFiles: () => Promise<boolean>
  renameFile: (oldPath: string, newName: string) => Promise<boolean>
  uploadFiles: (files: FileList, onProgress?: (progress: { fileName: string; progress: number; status: 'uploading' | 'completed' | 'error' }) => void) => Promise<boolean>
  downloadFile: (path: string) => void
  downloadFileWithProgress: (path: string) => Promise<{ taskId: string; message: string }>
  
  // 剪贴板操作
  copyFiles: (filePaths: string[]) => void
  cutFiles: (filePaths: string[]) => void
  pasteFiles: (targetPath: string) => Promise<{ taskId?: string; success: boolean; message: string }>
  clearClipboard: () => void
  
  // 压缩解压操作
  compressFiles: (filePaths: string[], archiveName: string, format?: string) => Promise<boolean>
  extractArchive: (archivePath: string) => Promise<boolean>
  
  // 编辑器操作
  openFile: (path: string, encoding?: string) => Promise<{ isIncompatible: boolean; detectedEncoding: string; confidence: number; content: string }>
  closeFile: (path: string) => void
  saveFile: (path: string, content: string, encoding?: string) => Promise<boolean>
  setActiveFile: (path: string | null) => void
  updateFileContent: (path: string, content: string) => void
  isFileModified: (path: string) => boolean
  
  // 文件监视操作
  watchFile: (path: string) => void
  unwatchFile: (path: string) => void
  handleFileChanged: (filePath: string) => void
  reloadChangedFile: (filePath: string) => Promise<void>
  dismissFileChangedDialog: () => void
  
  // 任务管理
  loadTasks: () => Promise<void>
  loadActiveTasks: () => Promise<void>
  getTask: (taskId: string) => Promise<Task | null>
  deleteTask: (taskId: string) => Promise<FileOperationResult>
  
  // 收藏管理
  loadFavorites: () => Promise<void>
  addFavorite: (path: string) => Promise<boolean>
  removeFavorite: (path: string) => Promise<boolean>
  checkFavorite: (path: string) => Promise<boolean>
  
  // 工具方法
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useFileStore = create<FileStore>((set, get) => ({
  // 初始状态
  currentPath: '/',
  files: [],
  selectedFiles: new Set(),
  loading: false,
  error: null,
  pagination: {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    hasMore: false
  },
  loadingMore: false,
  clipboard: {
    items: [],
    operation: null
  },
  openFiles: new Map(),
  originalFiles: new Map(),
  fileEncodings: new Map(),
  activeFile: null,
  watchedFiles: new Set(),
  fileChangedDialog: null,
  tasks: [],
  activeTasks: [],
  favorites: [],

  // 设置当前路径
  setCurrentPath: (path: string) => {
    const currentState = get()
    // 只有当路径真正改变时才更新状态和加载文件
    if (currentState.currentPath !== path) {
      set({ currentPath: path })
      get().loadFiles(path)
    }
  },

  // 加载文件列表
  loadFiles: async (path?: string, reset: boolean = true) => {
    const targetPath = path || get().currentPath
    const currentState = get()
    
    // 如果是重置加载，设置loading状态
    if (reset) {
      set({ loading: true, error: null })
    }
    
    try {
      const page = reset ? 1 : currentState.pagination.page + 1
      const response = await fileApiClient.listDirectory(targetPath, page, 50)
      
      let newFiles: FileItem[]
      if (reset) {
        // 重置加载，替换所有文件
        newFiles = response.files
      } else {
        // 追加加载，合并文件列表
        newFiles = [...currentState.files, ...response.files]
      }
      
      set({ 
        files: newFiles,
        currentPath: targetPath,
        pagination: response.pagination,
        loading: false,
        loadingMore: false,
        selectedFiles: reset ? new Set() : currentState.selectedFiles // 重置时清空选择
      })
    } catch (error: any) {
      set({ 
        error: error.message || '加载文件列表失败', 
        loading: false,
        loadingMore: false
      })
    }
  },

  // 加载更多文件
  loadMoreFiles: async () => {
    const { pagination, loadingMore } = get()
    
    // 如果正在加载或没有更多数据，直接返回
    if (loadingMore || !pagination.hasMore) {
      return
    }
    
    set({ loadingMore: true })
    await get().loadFiles(undefined, false)
  },

  // 选择文件
  selectFile: (path: string) => {
    const selectedFiles = new Set(get().selectedFiles)
    selectedFiles.add(path)
    set({ selectedFiles })
  },

  // 选择多个文件
  selectMultipleFiles: (paths: string[]) => {
    const selectedFiles = new Set(get().selectedFiles)
    paths.forEach(path => selectedFiles.add(path))
    set({ selectedFiles })
  },

  // 取消选择文件
  unselectFile: (path: string) => {
    const selectedFiles = new Set(get().selectedFiles)
    selectedFiles.delete(path)
    set({ selectedFiles })
  },

  // 清空选择
  clearSelection: () => {
    set({ selectedFiles: new Set() })
  },

  // 切换文件选择状态
  toggleFileSelection: (path: string) => {
    const selectedFiles = new Set(get().selectedFiles)
    if (selectedFiles.has(path)) {
      selectedFiles.delete(path)
    } else {
      selectedFiles.add(path)
    }
    set({ selectedFiles })
  },

  // 创建文件
  createFile: async (name: string, content: string = '') => {
    const { currentPath } = get()
    const newPath = `${currentPath}/${name}`.replace(/\/+/g, '/')
    
    try {
      await fileApiClient.createFile(newPath, content)
      await get().loadFiles()
      return true
    } catch (error: any) {
      set({ error: error.message || '创建文件失败' })
      return false
    }
  },

  // 创建目录
  createDirectory: async (name: string) => {
    const { currentPath } = get()
    const newPath = `${currentPath}/${name}`.replace(/\/+/g, '/')
    
    try {
      await fileApiClient.createDirectory(newPath)
      await get().loadFiles()
      return true
    } catch (error: any) {
      set({ error: error.message || '创建目录失败' })
      return false
    }
  },

  // 删除选中的文件
  deleteSelectedFiles: async () => {
    const { selectedFiles } = get()
    if (selectedFiles.size === 0) return false
    
    try {
      await fileApiClient.deleteItems(Array.from(selectedFiles))
      await get().loadFiles()
      set({ selectedFiles: new Set() })
      return true
    } catch (error: any) {
      set({ error: error.message || '删除文件失败' })
      return false
    }
  },

  // 重命名文件
  renameFile: async (oldPath: string, newName: string) => {
    // 兼容Windows和Unix路径分隔符
    const separator = oldPath.includes('\\') ? '\\' : '/'
    const pathParts = oldPath.split(separator)
    pathParts[pathParts.length - 1] = newName
    const newPath = pathParts.join(separator)
    
    try {
      await fileApiClient.renameItem(oldPath, newPath)
      await get().loadFiles()
      return true
    } catch (error: any) {
      set({ error: error.message || '重命名失败' })
      return false
    }
  },

  // 上传文件
  uploadFiles: async (files: FileList, onProgress?: (progress: { fileName: string; progress: number; status: 'uploading' | 'completed' | 'error' }) => void) => {
    const { currentPath } = get()
    
    try {
      await fileApiClient.uploadFiles(currentPath, files, onProgress)
      await get().loadFiles()
      return true
    } catch (error: any) {
      set({ error: error.message || '上传文件失败' })
      if (onProgress) {
        onProgress({
          fileName: files.length === 1 ? files[0].name : `${files.length} 个文件`,
          progress: 0,
          status: 'error'
        })
      }
      return false
    }
  },

  // 下载文件（直接下载）
  downloadFile: (path: string) => {
    fileApiClient.downloadFile(path)
  },

  // 下载文件（带进度）
  downloadFileWithProgress: async (path: string) => {
    try {
      const result = await fileApiClient.createDownloadTask(path)
      // 立即刷新活动任务列表
      await get().loadActiveTasks()
      // 开始下载
      fileApiClient.downloadFileWithProgress(result.taskId)
      return result
    } catch (error: any) {
      set({ error: error.message || '创建下载任务失败' })
      throw error
    }
  },

  // 打开文件
  openFile: async (path: string, encoding?: string) => {
    const { openFiles, originalFiles, fileEncodings } = get()
    
    if (openFiles.has(path)) {
      set({ activeFile: path })
      // 如果文件已打开，返回默认值
      return { 
        isIncompatible: false, 
        detectedEncoding: fileEncodings.get(path) || 'utf-8', 
        confidence: 1, 
        content: openFiles.get(path) || '' 
      }
    }
    
    try {
      const fileContent = await fileApiClient.readFile(path, encoding)
      
      // 检查返回的数据是否有效
      if (!fileContent || typeof fileContent.content === 'undefined') {
        throw new Error('文件内容为空或格式错误')
      }
      
      const newOpenFiles = new Map(openFiles)
      const newOriginalFiles = new Map(originalFiles)
      const newFileEncodings = new Map(fileEncodings)
      
      newOpenFiles.set(path, fileContent.content || '')
      newOriginalFiles.set(path, fileContent.content || '')
      // 保存文件的原始编码
      newFileEncodings.set(path, fileContent.encoding || 'utf-8')
      
      set({ 
        openFiles: newOpenFiles,
        originalFiles: newOriginalFiles,
        fileEncodings: newFileEncodings,
        activeFile: path 
      })
      
      // 返回编码信息
      return {
        isIncompatible: fileContent.isIncompatible || false,
        detectedEncoding: fileContent.detectedEncoding || 'utf-8',
        confidence: fileContent.confidence || 1,
        content: fileContent.content || ''
      }
    } catch (error: any) {
      set({ error: error.message || '打开文件失败' })
      console.error('打开文件失败:', error)
      throw error
    }
  },

  // 关闭文件
  closeFile: (path: string) => {
    const { openFiles, originalFiles, fileEncodings, activeFile } = get()
    const newOpenFiles = new Map(openFiles)
    const newOriginalFiles = new Map(originalFiles)
    const newFileEncodings = new Map(fileEncodings)
    
    newOpenFiles.delete(path)
    newOriginalFiles.delete(path)
    newFileEncodings.delete(path)
    
    // 停止监视该文件
    get().unwatchFile(path)
    
    const newActiveFile = activeFile === path ? 
      (newOpenFiles.size > 0 ? Array.from(newOpenFiles.keys())[0] : null) : 
      activeFile
    
    set({ 
      openFiles: newOpenFiles,
      originalFiles: newOriginalFiles,
      fileEncodings: newFileEncodings,
      activeFile: newActiveFile 
    })
  },

  // 保存文件
  saveFile: async (path: string, content: string, encoding: string = 'utf-8') => {
    try {
      await fileApiClient.saveFile(path, content, encoding)
      const { openFiles, originalFiles } = get()
      const newOpenFiles = new Map(openFiles)
      const newOriginalFiles = new Map(originalFiles)
      newOpenFiles.set(path, content)
      newOriginalFiles.set(path, content) // 保存后更新原始内容
      
      set({ 
        openFiles: newOpenFiles,
        originalFiles: newOriginalFiles
      })
      return true
    } catch (error: any) {
      set({ error: error.message || '保存文件失败' })
      return false
    }
  },

  // 设置活动文件
  setActiveFile: (path: string | null) => {
    set({ activeFile: path })
  },

  // 设置加载状态
  setLoading: (loading: boolean) => {
    set({ loading })
  },

  // 设置错误信息
  setError: (error: string | null) => {
    set({ error })
  },

  // 复制文件到剪贴板
  copyFiles: (filePaths: string[]) => {
    set({ 
      clipboard: {
        items: [...filePaths],
        operation: 'copy'
      }
    })
  },

  // 剪切文件到剪贴板
  cutFiles: (filePaths: string[]) => {
    set({ 
      clipboard: {
        items: [...filePaths],
        operation: 'cut'
      }
    })
  },

  // 粘贴文件
  pasteFiles: async (targetPath: string): Promise<{ taskId?: string; success: boolean; message: string }> => {
    const { clipboard } = get()
    if (!clipboard.items.length) {
      return { success: false, message: '剪贴板为空' }
    }

    try {
      let result
      const sourcePaths = clipboard.items
      
      if (clipboard.operation === 'copy') {
        // 批量复制
        result = await fileApiClient.copyItems(sourcePaths, targetPath)
      } else {
        // 批量移动
        result = await fileApiClient.moveItems(sourcePaths, targetPath)
        // 移动操作后清空剪贴板
        set(state => ({
          clipboard: { items: [], operation: null }
        }))
      }

      if (result.success) {
        // 刷新文件列表
        await get().loadFiles()
        return { 
          taskId: result.taskId, 
          success: true, 
          message: clipboard.operation === 'copy' ? '复制任务已创建' : '移动任务已创建' 
        }
      } else {
        return { success: false, message: result.message || '操作失败' }
      }
    } catch (error) {
      console.error('粘贴文件失败:', error)
      return { success: false, message: '粘贴文件失败' }
    }
  },

  // 清空剪贴板
  clearClipboard: () => {
    set({ 
      clipboard: {
        items: [],
        operation: null
      }
    })
  },

  // 压缩文件
  compressFiles: async (filePaths: string[], archiveName: string, format: string = 'zip') => {
    const { currentPath } = get()
    
    try {
      const result = await fileApiClient.compressFiles(filePaths, currentPath, archiveName, format)
      // 立即刷新活动任务列表
      await get().loadActiveTasks()
      return true
    } catch (error: any) {
      set({ error: error.message || '压缩文件失败' })
      return false
    }
  },

  // 解压文件
  extractArchive: async (archivePath: string) => {
    const { currentPath } = get()
    
    try {
      const result = await fileApiClient.extractArchive(archivePath, currentPath)
      // 立即刷新活动任务列表
      await get().loadActiveTasks()
      return true
    } catch (error: any) {
      set({ error: error.message || '解压文件失败' })
      return false
    }
  },

  // 更新文件内容
  updateFileContent: (path: string, content: string) => {
    const { openFiles } = get()
    const newOpenFiles = new Map(openFiles)
    newOpenFiles.set(path, content)
    set({ openFiles: newOpenFiles })
  },

  // 检查文件是否已修改
  isFileModified: (path: string) => {
    const { openFiles, originalFiles } = get()
    const currentContent = openFiles.get(path)
    const originalContent = originalFiles.get(path)
    return currentContent !== originalContent
  },
  
  // 任务管理
  loadTasks: async () => {
    try {
      const tasks = await fileApiClient.getTasks()
      set({ tasks })
    } catch (error: any) {
      set({ error: error.message || '加载任务列表失败' })
    }
  },

  loadActiveTasks: async () => {
    try {
      const activeTasks = await fileApiClient.getActiveTasks()
      set({ activeTasks })
    } catch (error: any) {
      set({ error: error.message || '加载活动任务失败' })
    }
  },

  getTask: async (taskId: string) => {
    try {
      return await fileApiClient.getTask(taskId)
    } catch (error: any) {
      set({ error: error.message || '获取任务状态失败' })
      return null
    }
  },

  deleteTask: async (taskId: string) => {
    try {
      const result = await fileApiClient.deleteTask(taskId)
      if (result.status === 'success') {
        // 刷新任务列表
        await get().loadActiveTasks()
        await get().loadTasks()
      }
      return result
    } catch (error: any) {
      set({ error: error.message || '删除任务失败' })
      return { 
        success: false, 
        status: 'error', 
        message: error.message || '删除任务失败' 
      }
    }
  },

  // 开始监视文件（通过WebSocket）
  watchFile: (path: string) => {
    const { watchedFiles } = get()
    if (!watchedFiles.has(path)) {
      const newWatchedFiles = new Set(watchedFiles)
      newWatchedFiles.add(path)
      set({ watchedFiles: newWatchedFiles })
      
      // 通过socket发送监视请求
      // 注意：这个方法会在FileManagerPage中调用，那里会处理socket通信
    }
  },

  // 停止监视文件
  unwatchFile: (path: string) => {
    const { watchedFiles } = get()
    if (watchedFiles.has(path)) {
      const newWatchedFiles = new Set(watchedFiles)
      newWatchedFiles.delete(path)
      set({ watchedFiles: newWatchedFiles })
      
      // 通过socket发送取消监视请求
      // 注意：这个方法会在FileManagerPage中调用，那里会处理socket通信
    }
  },

  // 处理文件变化通知
  handleFileChanged: (filePath: string) => {
    const { openFiles } = get()
    
    // 确保文件当前已打开
    if (!openFiles.has(filePath)) {
      return
    }
    
    // 检查文件是否有未保存的修改
    const isModified = get().isFileModified(filePath)
    
    if (isModified) {
      // 有未保存的修改，显示确认对话框
      const fileName = filePath.split(/[/\\]/).pop() || filePath
      set({
        fileChangedDialog: {
          visible: true,
          filePath,
          fileName
        }
      })
    } else {
      // 没有修改，自动重新加载
      get().reloadChangedFile(filePath)
    }
  },

  // 重新加载已变化的文件
  reloadChangedFile: async (filePath: string) => {
    try {
      const { fileEncodings } = get()
      const encoding = fileEncodings.get(filePath)
      
      // 重新读取文件内容
      const fileContent = await fileApiClient.readFile(filePath, encoding)
      
      const { openFiles, originalFiles } = get()
      const newOpenFiles = new Map(openFiles)
      const newOriginalFiles = new Map(originalFiles)
      
      newOpenFiles.set(filePath, fileContent.content || '')
      newOriginalFiles.set(filePath, fileContent.content || '')
      
      set({ 
        openFiles: newOpenFiles,
        originalFiles: newOriginalFiles,
        fileChangedDialog: null
      })
    } catch (error: any) {
      set({ error: error.message || '重新加载文件失败' })
      console.error('重新加载文件失败:', error)
    }
  },

  // 关闭文件变化对话框
  dismissFileChangedDialog: () => {
    set({ fileChangedDialog: null })
  },

  // 收藏管理
  loadFavorites: async () => {
    try {
      const favorites = await fileApiClient.getFavorites()
      set({ favorites })
    } catch (error: any) {
      set({ error: error.message || '加载收藏列表失败' })
    }
  },

  addFavorite: async (path: string) => {
    try {
      await fileApiClient.addFavorite(path)
      await get().loadFavorites()
      return true
    } catch (error: any) {
      set({ error: error.message || '添加收藏失败' })
      return false
    }
  },

  removeFavorite: async (path: string) => {
    try {
      await fileApiClient.removeFavorite(path)
      await get().loadFavorites()
      return true
    } catch (error: any) {
      set({ error: error.message || '移除收藏失败' })
      return false
    }
  },

  checkFavorite: async (path: string) => {
    try {
      return await fileApiClient.checkFavorite(path)
    } catch (error: any) {
      set({ error: error.message || '检查收藏状态失败' })
      return false
    }
  }
}))