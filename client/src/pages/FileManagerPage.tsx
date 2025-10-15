import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Button, 
  Input, 
  Breadcrumb, 
  Spin, 
  Empty, 
  message, 
  Tooltip,
  Space,
  Tabs,
  Card,
  Modal,
  Progress,
  Badge,
  Drawer,
  Select
} from 'antd'
import {
  HomeOutlined,
  FolderOutlined,
  PlusOutlined,
  UploadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
  LeftOutlined,
  RightOutlined,
  FileTextOutlined,
  SaveOutlined,
  CloseOutlined,
  CopyOutlined,
  ScissorOutlined,
  SnippetsOutlined,
  FileAddOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  BellOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  HddOutlined,
  EyeOutlined,
  EyeInvisibleOutlined
} from '@ant-design/icons'
import { useFileStore } from '@/stores/fileStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSystemStore } from '@/stores/systemStore'
import { useMusicStore } from '@/stores/musicStore'
import { useThemeStore } from '@/stores/themeStore'
import { FileGridItem } from '@/components/FileGridItem'
import { FileListItem } from '@/components/FileListItem'
import { FileContextMenu } from '@/components/FileContextMenu'
import { 
  CreateDialog, 
  RenameDialog, 
  UploadDialog, 
  DeleteConfirmDialog 
} from '@/components/FileDialogs'
import { CompressDialog } from '@/components/CompressDialog'
import { PermissionsDialog } from '@/components/PermissionsDialog'
import { MonacoEditor, type LineEndingType } from '@/components/MonacoEditor'
import { ImagePreview } from '@/components/ImagePreview'
import { EncodingConfirmDialog } from '@/components/EncodingConfirmDialog'
import { FileItem } from '@/types/file'
import { fileApiClient } from '@/utils/fileApi'
import { isTextFile, isImageFile } from '@/utils/format'
import { normalizePath, getDirectoryPath, getBasename } from '@/utils/pathUtils'
import { useTouchAdaptation } from '@/hooks/useTouchAdaptation'
import { useLongPress } from '@/utils/touchUtils'
import { TouchHelpTooltip } from '@/components/TouchHelpTooltip'



const FileManagerPage: React.FC = () => {
  const {
    currentPath,
    files,
    selectedFiles,
    loading,
    error,
    clipboard,
    openFiles,
    fileEncodings,
    activeFile,
    tasks,
    activeTasks,
    pagination,
    loadingMore,
    setCurrentPath,
    loadFiles,
    loadMoreFiles,
    selectFile,
    unselectFile,
    clearSelection,
    toggleFileSelection,
    createFile,
    createDirectory,
    deleteSelectedFiles,
    renameFile,
    uploadFiles,
    downloadFile,
    downloadFileWithProgress,
    copyFiles,
    cutFiles,
    pasteFiles,
    clearClipboard,
    compressFiles,
    extractArchive,
    openFile,
    closeFile,
    saveFile,
    setActiveFile,
    setError,
    updateFileContent,
    isFileModified,
    loadTasks,
    loadActiveTasks,
    getTask,
    deleteTask
  } = useFileStore()
  
  const { addNotification } = useNotificationStore()
  const { fetchSystemInfo } = useSystemStore()
  const { addToPlaylist } = useMusicStore()
  const { theme } = useThemeStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  
  // 对话框状态
  const [createDialog, setCreateDialog] = useState<{
    visible: boolean
    type: 'file' | 'folder'
  }>({ visible: false, type: 'folder' })
  
  const [renameDialog, setRenameDialog] = useState<{
    visible: boolean
    file: FileItem | null
  }>({ visible: false, file: null })
  
  const [uploadDialog, setUploadDialog] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<{
    visible: boolean
    files: FileItem[]
  }>({ visible: false, files: [] })
  const [compressDialog, setCompressDialog] = useState<{
    visible: boolean
    files: FileItem[]
  }>({ visible: false, files: [] })
  
  const [permissionsDialog, setPermissionsDialog] = useState<{
    visible: boolean
    file: FileItem | null
  }>({ visible: false, file: null })
  
  // 路径输入
  const [pathInput, setPathInput] = useState('')
  const [isEditingPath, setIsEditingPath] = useState(false)
  
  // 搜索
  const [searchQuery, setSearchQuery] = useState('')
  
  // 历史记录
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  
  // 编辑器模态框
  const [editorModalVisible, setEditorModalVisible] = useState(false)
  
  // 编辑器换行符类型选项
  const [lineEnding, setLineEnding] = useState<LineEndingType>(() => {
    const saved = localStorage.getItem('fileManager_lineEnding') as LineEndingType
    return saved || 'LF'
  })
  
  // 当前活动文件的编码
  const [currentFileEncoding, setCurrentFileEncoding] = useState<string>('utf-8')
  
  // 图片预览模态框
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false)
  const [previewImagePath, setPreviewImagePath] = useState('')
  const [previewImageName, setPreviewImageName] = useState('')
  
  // 任务状态抽屉
  const [taskDrawerVisible, setTaskDrawerVisible] = useState(false)
  
  // 编码确认对话框
  const [encodingDialog, setEncodingDialog] = useState<{
    visible: boolean
    filePath: string
    fileName: string
    detectedEncoding: string
    confidence: number
  }>({ visible: false, filePath: '', fileName: '', detectedEncoding: '', confidence: 0 })
  
  // 监听活动文件变化，更新当前文件编码
  React.useEffect(() => {
    if (activeFile && fileEncodings.has(activeFile)) {
      setCurrentFileEncoding(fileEncodings.get(activeFile) || 'utf-8')
    }
  }, [activeFile, fileEncodings])
  
  // 触摸适配
  const touchAdaptation = useTouchAdaptation()

  // 视图模式
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    // 小屏模式默认使用列表视图
    if (touchAdaptation.shouldUseListView) {
      return 'list'
    }
    const saved = localStorage.getItem('fileManager_viewMode')
    return (saved as 'grid' | 'list') || 'grid'
  })
  
  // 保存视图模式到localStorage
  const handleViewModeChange = (mode: 'grid' | 'list') => {
    // 小屏模式强制使用列表视图
    if (touchAdaptation.shouldUseListView) {
      setViewMode('list')
      localStorage.setItem('fileManager_viewMode', 'list')
    } else {
      setViewMode(mode)
      localStorage.setItem('fileManager_viewMode', mode)
    }
  }

  // 监听触摸适配状态变化，自动切换到列表视图
  React.useEffect(() => {
    if (touchAdaptation.shouldUseListView && viewMode !== 'list') {
      setViewMode('list')
    }
  }, [touchAdaptation.shouldUseListView, viewMode])

  // 右键菜单状态
  const [contextMenuInfo, setContextMenuInfo] = useState<{
    file: FileItem | null
    position: { x: number; y: number }
  } | null>(null);
  
  // 滚动防抖处理
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastScrollTopRef = useRef(0)
  const fileListContainerRef = useRef<HTMLDivElement>(null)
  const autoLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // 盘符选择状态
  const [drives, setDrives] = useState<Array<{ label: string; value: string; type: string }>>([])
  const [selectedDrive, setSelectedDrive] = useState<string>('')
  const [drivesLoading, setDrivesLoading] = useState(false)
  
  // 查找当前路径对应的盘符
  const findDriveForPath = useCallback((path: string, driveList: Array<{ label: string; value: string; type: string }>) => {
    if (!path || !driveList.length) return null
    
    const normalizedPath = normalizePath(path)
    
    // 对每个盘符进行匹配
    for (const drive of driveList) {
      const normalizedDriveValue = normalizePath(drive.value)
      
      // 确保盘符路径以 / 结尾进行比较
      const driveRoot = normalizedDriveValue.endsWith('/') ? normalizedDriveValue : normalizedDriveValue + '/'
      const pathToCheck = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/'
      
      // 检查路径是否以盘符开头
      if (pathToCheck.startsWith(driveRoot) || normalizedPath === normalizedDriveValue) {
        return drive
      }
      
      // 特殊处理：如果是 Windows 盘符格式（如 D: 和 D:/），也要匹配
      if (normalizedDriveValue.match(/^[A-Za-z]:\/?\/?$/)) {
        const drivePrefix = normalizedDriveValue.charAt(0) + ':'
        if (normalizedPath.startsWith(drivePrefix)) {
          return drive
        }
      }
    }
    
    return null
  }, [])

  // 加载系统盘符
  const loadDrives = useCallback(async () => {
    try {
      setDrivesLoading(true)
      const driveList = await fileApiClient.getDrives()
      setDrives(driveList)
      
      // 如果当前路径匹配某个盘符，设置为选中状态
      if (currentPath) {
        const currentDrive = findDriveForPath(currentPath, driveList)
        if (currentDrive) {
          setSelectedDrive(currentDrive.value)
        }
      }
    } catch (error: any) {
      console.error('加载盘符失败:', error)
      addNotification({
        type: 'error',
        title: '加载盘符失败',
        message: error.message || '无法获取系统盘符'
      })
    } finally {
      setDrivesLoading(false)
    }
  }, [currentPath, addNotification, findDriveForPath])
  
  // 导航到指定路径
  const navigateToPath = useCallback((newPath: string) => {
    const normalizedPath = normalizePath(newPath)
    
    // 更新历史记录
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(normalizedPath)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
    
    // 只更新 URL 参数，让 useEffect 监听 URL 变化来更新状态
    navigate(`/files?path=${encodeURIComponent(normalizedPath)}`, { replace: true })
  }, [history, historyIndex, navigate])
  
  // 切换盘符
  const handleDriveChange = useCallback((driveValue: string) => {
    setSelectedDrive(driveValue)
    navigateToPath(driveValue)
  }, [navigateToPath])

  // 右键菜单处理函数
  const handleContextMenuOpen = useCallback(async (file: FileItem) => {
    if (file.type === 'directory') {
      navigateToPath(file.path)
    } else {
      try {
        const result = await openFile(file.path)
        if (result.isIncompatible) {
          // 显示编码确认对话框（不支持的编码）
          setEncodingDialog({
            visible: true,
            filePath: file.path,
            fileName: file.name,
            detectedEncoding: result.detectedEncoding,
            confidence: result.confidence
          })
        } else {
          setEditorModalVisible(true)
        }
      } catch (error: any) {
        addNotification({
          type: 'error',
          title: '打开文件失败',
          message: error.message || '无法打开文件'
        })
      }
    }
  }, [navigateToPath, openFile, addNotification])
  
  const handleContextMenuRename = useCallback((file: FileItem) => {
    setRenameDialog({ visible: true, file })
  }, [])
  
  const handleContextMenuDelete = useCallback((files: FileItem[]) => {
    setDeleteDialog({ visible: true, files })
  }, [])
  
  const handleContextMenuDownload = useCallback((file: FileItem) => {
    fileApiClient.downloadFile(file.path)
    addNotification({
      type: 'success',
      title: '下载开始',
      message: `正在下载 ${file.name}`
    })
  }, [addNotification])

  const handleContextMenuDownloadWithProgress = useCallback(async (file: FileItem) => {
    try {
      const result = await downloadFileWithProgress(file.path)
      addNotification({
        type: 'success',
        title: '下载任务已创建',
        message: `正在下载 ${file.name}，任务ID: ${result.taskId}`
      })
    } catch (error: any) {
      addNotification({
        type: 'error',
        title: '创建下载任务失败',
        message: error.message || '未知错误'
      })
    }
  }, [downloadFileWithProgress, addNotification])
  
  const handleContextMenuCopy = useCallback((files: FileItem[]) => {
    const filePaths = files.map(file => file.path)
    copyFiles(filePaths)
    addNotification({
      type: 'success',
      title: '复制成功',
      message: `已复制 ${files.length} 个项目到剪贴板`
    })
  }, [copyFiles, addNotification])
  
  const handleContextMenuCut = useCallback((files: FileItem[]) => {
    const filePaths = files.map(file => file.path)
    cutFiles(filePaths)
    addNotification({
      type: 'success',
      title: '剪切成功',
      message: `已剪切 ${files.length} 个项目到剪贴板`
    })
  }, [cutFiles, addNotification])
  
  // 粘贴处理
  const handlePaste = useCallback(async () => {
    if (!clipboard.operation || clipboard.items.length === 0) {
      message.warning('剪贴板为空')
      return
    }
    
    const result = await pasteFiles(currentPath)
    if (result.success) {
      const operationText = clipboard.operation === 'copy' ? '复制' : '移动'
      if (result.taskId) {
        // 异步任务
        addNotification({
          type: 'success',
          title: `${operationText}任务已创建`,
          message: `正在${operationText} ${clipboard.items.length} 个项目，任务ID: ${result.taskId}`
        })
        // 刷新任务列表
        await loadTasks()
      } else {
        // 同步操作
        addNotification({
          type: 'success',
          title: '粘贴成功',
          message: `成功${operationText} ${clipboard.items.length} 个项目`
        })
      }
    } else {
      addNotification({
        type: 'error',
        title: '粘贴失败',
        message: result.message || '操作失败'
      })
    }
  }, [clipboard, pasteFiles, currentPath, addNotification, loadTasks])
  
  const handleContextMenuView = useCallback(async (file: FileItem) => {
    if (isTextFile(file.name)) {
      try {
        const result = await openFile(file.path)
        if (result.isIncompatible) {
          // 显示编码确认对话框（不支持的编码）
          setEncodingDialog({
            visible: true,
            filePath: file.path,
            fileName: file.name,
            detectedEncoding: result.detectedEncoding,
            confidence: result.confidence
          })
        } else {
          setEditorModalVisible(true)
        }
      } catch (error: any) {
        addNotification({
          type: 'error',
          title: '打开文件失败',
          message: error.message || '无法打开文件'
        })
      }
    } else if (isImageFile(file.name)) {
      setPreviewImagePath(file.path)
      setPreviewImageName(file.name)
      setImagePreviewVisible(true)
    } else {
      message.info('该文件类型不支持预览')
    }
  }, [openFile, addNotification])

  // 压缩处理
  const handleContextMenuCompress = useCallback((files: FileItem[]) => {
    setCompressDialog({ visible: true, files })
  }, [])

  // 解压处理
  const handleContextMenuExtract = useCallback(async (file: FileItem) => {
    const success = await extractArchive(file.path)
    if (success) {
      addNotification({
        type: 'success',
        title: '解压成功',
        message: `文件 "${file.name}" 解压完成`
      })
    }
  }, [extractArchive, addNotification])

  // 从此文件夹处打开终端
  const handleContextMenuOpenTerminal = useCallback((file: FileItem) => {
    // 如果是文件夹，使用文件夹路径；如果是空白区域（path为空），使用当前目录路径
    const targetPath = file.path || currentPath
    const targetName = file.name || '当前文件夹'
    
    if (file.type === 'directory' || !file.path) {
      // 导航到终端页面，并传递文件夹路径作为查询参数
      navigate(`/terminal?cwd=${encodeURIComponent(targetPath)}`)
      addNotification({
        type: 'success',
        title: '打开终端',
        message: `已在 "${targetName}" 中打开终端`
      })
    }
  }, [currentPath, navigate, addNotification])

  // 添加到播放列表
  const handleAddToPlaylist = useCallback((files: FileItem[]) => {
    addToPlaylist(files)
    addNotification({
      type: 'success',
      title: '添加成功',
      message: `已添加 ${files.length} 个文件到播放列表`
    })
  }, [addToPlaylist, addNotification])
  
  // 初始化
  useEffect(() => {
    // 检查 URL 参数中的路径
    const pathFromUrl = searchParams.get('path')
    if (pathFromUrl) {
      // 如果 URL 中有路径参数，直接加载文件（setCurrentPath 会在 fileStore 中自动调用 loadFiles）
      setCurrentPath(pathFromUrl)
    } else {
      // 否则加载默认路径
      loadFiles(undefined, true) // 重置分页
    }
    
    // 初始加载任务列表
    loadActiveTasks()
    
    // 加载系统盘符
    loadDrives()
    
    // 预加载系统信息（用于右键菜单权限判断）
    fetchSystemInfo()
  }, [searchParams, setCurrentPath, loadFiles, fetchSystemInfo])
  
  // 当路径变化时更新选中的盘符
  useEffect(() => {
    if (drives.length > 0 && currentPath) {
      const currentDrive = findDriveForPath(currentPath, drives)
      if (currentDrive && currentDrive.value !== selectedDrive) {
        setSelectedDrive(currentDrive.value)
      }
    }
  }, [currentPath, drives, selectedDrive, findDriveForPath])
  
  // 定期刷新活动任务
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeTasks.length > 0) {
        loadActiveTasks()
        // 如果有任务完成，刷新文件列表
        const hasCompletedTasks = activeTasks.some(task => 
          task.status === 'completed' || task.status === 'failed'
        )
        if (hasCompletedTasks) {
          loadFiles(undefined, true) // 重置分页
        }
      }
    }, 2000) // 每2秒刷新一次
    
    return () => clearInterval(interval)
  }, [activeTasks, loadFiles])
  
  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 检查焦点是否在输入框、文本区域或可编辑元素上
      const activeElement = document.activeElement
      const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.getAttribute('contenteditable') === 'true' ||
        activeElement.closest('.ant-input') ||
        activeElement.closest('.ant-select') ||
        activeElement.closest('[role="textbox"]')
      )
      
      // 如果焦点在输入框上，不处理文件操作快捷键
      if (isInputFocused) {
        return
      }
      
      // 处理单独的按键
      switch (event.key) {
        case 'F2':
          // F2重命名
          if (selectedFiles.size === 1) {
            event.preventDefault()
            const selectedPath = Array.from(selectedFiles)[0]
            const selectedFile = files.find(f => f.path === selectedPath)
            if (selectedFile) {
              handleContextMenuRename(selectedFile)
            }
          }
          break
        case 'Delete':
          // Delete删除
          if (selectedFiles.size > 0) {
            event.preventDefault()
            const selectedFileItems = Array.from(selectedFiles).map(path => 
              files.find(f => f.path === path)
            ).filter(Boolean) as FileItem[]
            handleContextMenuDelete(selectedFileItems)
          }
          break
      }
      
      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'c':
            if (selectedFiles.size > 0) {
              event.preventDefault()
              const selectedFileItems = Array.from(selectedFiles).map(path => 
                files.find(f => f.path === path)
              ).filter(Boolean) as FileItem[]
              handleContextMenuCopy(selectedFileItems)
            }
            break
          case 'x':
            if (selectedFiles.size > 0) {
              event.preventDefault()
              const selectedFileItems = Array.from(selectedFiles).map(path => 
                files.find(f => f.path === path)
              ).filter(Boolean) as FileItem[]
              handleContextMenuCut(selectedFileItems)
            }
            break
          case 'v':
            if (clipboard.operation && clipboard.items.length > 0) {
              event.preventDefault()
              handlePaste()
            }
            break
        }
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedFiles, files, clipboard, handleContextMenuRename, handleContextMenuDelete, handleContextMenuCopy, handleContextMenuCut, handlePaste])
  
  // 错误处理
  useEffect(() => {
    if (error) {
      addNotification({
        type: 'error',
        title: '操作失败',
        message: error
      })
      setError(null)
    }
  }, [error, addNotification, setError])
  
  // 检查是否需要自动加载更多文件
  const checkAutoLoadMore = useCallback(() => {
    if (!fileListContainerRef.current || loadingMore || !pagination.hasMore) {
      return
    }

    const container = fileListContainerRef.current
    const { scrollHeight, clientHeight } = container
    
    // 如果内容高度小于等于容器高度（没有滚动条），且还有更多文件，则自动加载
    if (scrollHeight <= clientHeight) {
      console.log('检测到内容高度不足以产生滚动，自动加载更多文件')
      loadMoreFiles()
    }
  }, [loadingMore, pagination.hasMore, loadMoreFiles])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      if (autoLoadTimeoutRef.current) {
        clearTimeout(autoLoadTimeoutRef.current)
      }
    }
  }, [])

  // 检查是否需要自动加载更多文件
  useEffect(() => {
    // 清除之前的定时器
    if (autoLoadTimeoutRef.current) {
      clearTimeout(autoLoadTimeoutRef.current)
    }

    // 延迟检查，确保DOM已经更新
    autoLoadTimeoutRef.current = setTimeout(() => {
      checkAutoLoadMore()
    }, 100)
  }, [files, pagination.hasMore, checkAutoLoadMore])
  
  // 获取显示路径（相对于当前盘符的路径）
  const getDisplayPath = () => {
    if (selectedDrive && currentPath) {
      const normalizedCurrentPath = normalizePath(currentPath)
      const normalizedDriveValue = normalizePath(selectedDrive)
      
      // 确保盘符路径以 / 结尾进行比较
      const driveRoot = normalizedDriveValue.endsWith('/') ? normalizedDriveValue : normalizedDriveValue + '/'
      
      if (normalizedCurrentPath.startsWith(driveRoot) || normalizedCurrentPath === normalizedDriveValue) {
        let relativePath = normalizedCurrentPath.slice(normalizedDriveValue.length)
        // 移除开头的斜杠
        if (relativePath.startsWith('/')) {
          relativePath = relativePath.slice(1)
        }
        // 如果是根目录，显示盘符
        return relativePath || normalizedDriveValue
      }
    }
    return currentPath
  }

  // 更新路径输入
  useEffect(() => {
    setPathInput(getDisplayPath())
  }, [currentPath, selectedDrive])
  
  // 后退
  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      const targetPath = history[newIndex]
      navigate(`/files?path=${encodeURIComponent(targetPath)}`, { replace: true })
    }
  }
  
  // 前进
  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      const targetPath = history[newIndex]
      navigate(`/files?path=${encodeURIComponent(targetPath)}`, { replace: true })
    }
  }
  
  // 上级目录
  const goUp = () => {
    const parentPath = getDirectoryPath(currentPath)
    if (parentPath !== currentPath) {
      navigateToPath(parentPath)
    }
  }
  
  // 处理路径输入
  const handlePathSubmit = () => {
    let inputPath = pathInput.trim()
    
    // 如果输入的是相对路径且有选中的盘符，转换为绝对路径
    if (selectedDrive && !inputPath.includes(':') && !inputPath.startsWith('/')) {
      // 确保盘符路径以正确的分隔符结尾
      let basePath = selectedDrive
      if (!basePath.endsWith('/') && !basePath.endsWith('\\')) {
        basePath += '/'
      }
      inputPath = basePath + inputPath
    }
    
    const trimmedInput = normalizePath(inputPath)
    const current = normalizePath(currentPath)
    if (trimmedInput && trimmedInput !== current) {
      navigateToPath(trimmedInput)
    }
    setIsEditingPath(false)
  }
  
  // 文件点击处理
  const handleFileClick = (file: FileItem, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd + 点击：多选
      toggleFileSelection(file.path)
    } else if (event.shiftKey && selectedFiles.size > 0) {
      // Shift + 点击：范围选择
      const lastSelected = Array.from(selectedFiles)[selectedFiles.size - 1]
      const lastIndex = files.findIndex(f => f.path === lastSelected)
      const currentIndex = files.findIndex(f => f.path === file.path)
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex)
        const end = Math.max(lastIndex, currentIndex)
        const rangeFiles = files.slice(start, end + 1).map(f => f.path)
        
        clearSelection()
        rangeFiles.forEach(path => selectFile(path))
      }
    } else {
      // 普通点击：单选
      clearSelection()
      selectFile(file.path)
    }
  }
  
  // 文件双击处理
  const handleFileDoubleClick = async (file: FileItem) => {
    if (file.type === 'directory') {
      navigateToPath(file.path)
    } else if (isImageFile(file.name)) {
      setPreviewImagePath(file.path)
      setPreviewImageName(file.name)
      setImagePreviewVisible(true)
    } else {
      // 默认使用文本编辑器打开所有非图片文件（包括无后缀文件和无标准后缀文件）
      try {
        const result = await openFile(file.path)
        if (result.isIncompatible) {
          // 显示编码确认对话框（不支持的编码）
          setEncodingDialog({
            visible: true,
            filePath: file.path,
            fileName: file.name,
            detectedEncoding: result.detectedEncoding,
            confidence: result.confidence
          })
        } else {
          setEditorModalVisible(true)
        }
      } catch (error: any) {
        addNotification({
          type: 'error',
          title: '打开文件失败',
          message: error.message || '无法打开文件'
        })
      }
    }
  }
  

  
  // 处理换行符类型变化
  const handleLineEndingChange = (newLineEnding: LineEndingType) => {
    setLineEnding(newLineEnding)
    localStorage.setItem('fileManager_lineEnding', newLineEnding)
  }
  
  // 创建具体类型文件的处理函数
  const handleCreateTextFile = async () => {
    const fileName = `新建文本文档.txt`
    const filePath = await createFile(fileName)
    if (typeof filePath === 'string') {
      addNotification({
        type: 'success',
        title: '创建成功',
        message: `文本文档 "${fileName}" 创建成功`
      })
      // 自动打开新创建的文件
      await openFile(filePath)
      setEditorModalVisible(true)
    }
  }
  
  const handleCreateJsonFile = async () => {
    const fileName = `新建文件.json`
    const filePath = await createFile(fileName, '{\n  \n}')
    if (typeof filePath === 'string') {
      addNotification({
        type: 'success',
        title: '创建成功',
        message: `JSON 文件 "${fileName}" 创建成功`
      })
      // 自动打开新创建的文件
      await openFile(filePath)
      setEditorModalVisible(true)
    }
  }
  
  const handleCreateIniFile = async () => {
    const fileName = `新建配置.ini`
    const filePath = await createFile(fileName, '; INI 配置文件\n[Section]\nkey=value\n')
    if (typeof filePath === 'string') {
      addNotification({
        type: 'success',
        title: '创建成功',
        message: `INI 文件 "${fileName}" 创建成功`
      })
      // 自动打开新创建的文件
      await openFile(filePath)
      setEditorModalVisible(true)
    }
  }
  
  // 编码转换确认处理
  const handleEncodingConvert = async () => {
    try {
      // 关闭当前文件（如果已打开）
      closeFile(encodingDialog.filePath)
      
      // 使用UTF-8编码重新打开文件（这会将原编码的内容转换为UTF-8字符串）
      const result = await openFile(encodingDialog.filePath, 'utf-8')
      
      // 立即保存文件，将内容以UTF-8编码写入磁盘
      const saveSuccess = await saveFile(encodingDialog.filePath, result.content, 'utf-8')
      
      if (!saveSuccess) {
        throw new Error('保存文件失败')
      }
      
      // 关闭编码确认对话框
      setEncodingDialog({ visible: false, filePath: '', fileName: '', detectedEncoding: '', confidence: 0 })
      
      // 打开编辑器
      setEditorModalVisible(true)
      
      addNotification({
        type: 'success',
        title: '编码转换成功',
        message: `文件已转换为 UTF-8 编码并保存`
      })
    } catch (error: any) {
      addNotification({
        type: 'error',
        title: '编码转换失败',
        message: error.message || '无法转换文件编码'
      })
    }
  }
  
  // 编码转换取消处理
  const handleEncodingCancel = () => {
    // 关闭文件
    closeFile(encodingDialog.filePath)
    
    // 关闭编码确认对话框
    setEncodingDialog({ visible: false, filePath: '', fileName: '', detectedEncoding: '', confidence: 0 })
    
    addNotification({
      type: 'info',
      title: '已取消',
      message: '建议您下载文件后使用本地编辑器编辑'
    })
  }
  
  
  // 对话框处理
  const handleCreateConfirm = async (name: string) => {
    if (createDialog.type === 'folder') {
      const success = await createDirectory(name)
      if (success) {
        addNotification({
          type: 'success',
          title: '创建成功',
          message: `文件夹 "${name}" 创建成功`
        })
      }
    } else {
      // 创建文件
      const filePath = await createFile(name)
      if (typeof filePath === 'string') {
        addNotification({
          type: 'success',
          title: '创建成功',
          message: `文件 "${name}" 创建成功`
        })
        // 自动打开新创建的文件
        await openFile(filePath)
        setEditorModalVisible(true)
      }
    }
    setCreateDialog({ visible: false, type: 'folder' })
  }
  
  const handleRenameConfirm = async (newName: string) => {
    if (renameDialog.file) {
      const success = await renameFile(renameDialog.file.path, newName)
      if (success) {
        addNotification({
          type: 'success',
          title: '重命名成功',
          message: `"${renameDialog.file.name}" 已重命名为 "${newName}"`
        })
      }
    }
    setRenameDialog({ visible: false, file: null })
  }
  
  const handleUploadConfirm = async (files: FileList, onProgress?: (progress: { fileName: string; progress: number; status: 'uploading' | 'completed' | 'error' }) => void) => {
    const success = await uploadFiles(files, onProgress)
    if (success) {
      addNotification({
        type: 'success',
        title: '上传成功',
        message: `成功上传 ${files.length} 个文件`
      })
      setUploadDialog(false)
    } else if (onProgress) {
      // 如果上传失败，通过进度回调通知错误状态
      onProgress({
        fileName: files.length === 1 ? files[0].name : `${files.length} 个文件`,
        progress: 0,
        status: 'error'
      })
    }
  }
  
  const handleDeleteConfirm = async () => {
    if (deleteDialog.files.length === 0) return
    
    // 先选中要删除的文件
    clearSelection()
    deleteDialog.files.forEach(file => selectFile(file.path))
    
    const success = await deleteSelectedFiles()
    if (success) {
      addNotification({
        type: 'success',
        title: '删除成功',
        message: `成功删除 ${deleteDialog.files.length} 个项目`
      })
    }
    setDeleteDialog({ visible: false, files: [] })
  }

  const handleCompressConfirm = async (archiveName: string, format: string, compressionLevel: number) => {
    const filePaths = compressDialog.files.map(file => file.path)
    const success = await compressFiles(filePaths, archiveName, format)
    if (success) {
      addNotification({
        type: 'success',
        title: '压缩任务已下发',
        message: `异步操作，详细进度可查看任务栏 "${archiveName}"`
      })
    }
    setCompressDialog({ visible: false, files: [] })
  }

  // 权限处理
  const handlePermissions = (file: FileItem) => {
    setPermissionsDialog({ visible: true, file })
  }
  
  // 编辑器相关
  const handleEditorChange = (path: string, content: string) => {
    updateFileContent(path, content)
  }

  const handleSaveFile = async (content?: string | React.MouseEvent) => {
    if (!activeFile) {
      addNotification({
        type: 'warning',
        title: '没有活动文件',
        message: '请先选择一个文件进行保存。'
      })
      return
    }

    let fileContent: string | undefined;
    
    if (typeof content === 'string') {
      fileContent = content;
    } else {
      fileContent = openFiles.get(activeFile);
    }

    if (fileContent === undefined) {
      addNotification({
        type: 'error',
        title: '无法保存文件',
        message: '找不到文件内容。'
      });
      return;
    }
    
    // 使用当前选择的编码保存
    await saveFile(activeFile, fileContent, currentFileEncoding)
  }
  
  
  // 生成面包屑
  const generateBreadcrumbs = () => {
    // 获取相对于当前盘符的路径
    let relativePath = currentPath
    let rootTitle = '根目录'
    let rootPath = '/'
    
    // 如果有选中的盘符，计算相对路径
    if (selectedDrive && currentPath.startsWith(selectedDrive)) {
      relativePath = currentPath.slice(selectedDrive.length)
      rootTitle = selectedDrive.replace(':', '')
      rootPath = selectedDrive
      
      // 移除开头的斜杠或反斜杠
      if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
        relativePath = relativePath.slice(1)
      }
    }
    
    const parts = relativePath.split(/[/\\]/).filter(Boolean)
    const items = [
      {
        title: (
          <span className="flex items-center cursor-pointer" onClick={() => navigateToPath(rootPath)}>
            <HddOutlined className="mr-1" />
            {rootTitle}
          </span>
        )
      }
    ]
    
    let currentBreadcrumbPath = rootPath
    parts.forEach((part, index) => {
      // 确保路径分隔符正确
      if (!currentBreadcrumbPath.endsWith('/') && !currentBreadcrumbPath.endsWith('\\')) {
        currentBreadcrumbPath += '/'
      }
      currentBreadcrumbPath += part
      const breadcrumbPath = currentBreadcrumbPath
      
      items.push({
        title: (
          <span 
            className="cursor-pointer hover:text-blue-500 text-gray-900 dark:text-white"
            onClick={() => navigateToPath(breadcrumbPath)}
          >
            {part}
          </span>
        )
      })
    })
    
    return items
  }
  
  // 过滤文件
  const filteredFiles = files.filter(file => 
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  // 获取任务状态图标
  const getTaskStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockCircleOutlined style={{ color: '#faad14' }} />
      case 'running':
        return <LoadingOutlined style={{ color: '#1890ff' }} />
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />
      case 'failed':
        return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
      default:
        return <ClockCircleOutlined />
    }
  }
  
  // 获取任务状态文本
  const getTaskStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return '等待中'
      case 'running':
        return '进行中'
      case 'completed':
        return '已完成'
      case 'failed':
        return '失败'
      default:
        return '未知'
    }
  }
  
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* 工具栏 */}
      <div className={`flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 file-manager-toolbar ${touchAdaptation.shouldShowMobileUI ? 'flex-wrap gap-2' : ''}`}>
        <div className="flex items-center space-x-2">
          {/* 盘符选择 */}
          <div className="mr-2">
            <Select
              value={selectedDrive}
              onChange={handleDriveChange}
              loading={drivesLoading}
              placeholder="盘符"
              size="small"
              style={{ width: 80, height: 25 }}
              suffixIcon={<HddOutlined />}
              options={drives}
            />
          </div>
          
          {/* 导航按钮 */}
          <Space>
            <Tooltip title="后退">
              <Button 
                icon={<LeftOutlined />} 
                disabled={historyIndex <= 0}
                onClick={goBack}
              />
            </Tooltip>
            <Tooltip title="前进">
              <Button 
                icon={<RightOutlined />} 
                disabled={historyIndex >= history.length - 1}
                onClick={goForward}
              />
            </Tooltip>
            <Tooltip title="上级目录">
              <Button 
                icon={<FolderOutlined />} 
                onClick={goUp}
              />
            </Tooltip>
            <Tooltip title="刷新">
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => loadFiles()}
                loading={loading}
              />
            </Tooltip>
          </Space>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* 视图切换 - 小屏模式下隐藏 */}
          {!touchAdaptation.shouldHideViewToggle && (
            <Space>
              <Tooltip title="网格视图">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Button
                    icon={<AppstoreOutlined />}
                    type={viewMode === 'grid' ? 'primary' : 'default'}
                    onClick={() => handleViewModeChange('grid')}
                  />
                </motion.div>
              </Tooltip>
              <Tooltip title="列表视图">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Button
                    icon={<UnorderedListOutlined />}
                    type={viewMode === 'list' ? 'primary' : 'default'}
                    onClick={() => handleViewModeChange('list')}
                  />
                </motion.div>
              </Tooltip>
            </Space>
          )}

          {/* 搜索 */}
          <Input
            placeholder="搜索文件..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={touchAdaptation.shouldShowMobileUI ? "w-32" : "w-64"}
          />

          {/* 操作按钮 */}
          <Space>
            <Tooltip title="新建文件夹">
              <Button
                icon={<PlusOutlined />}
                onClick={() => setCreateDialog({ visible: true, type: 'folder' })}
              >
                {!touchAdaptation.shouldShowMobileUI && "新建文件夹"}
              </Button>
            </Tooltip>
            <Tooltip title="新建文件">
              <Button
                icon={<FileAddOutlined />}
                onClick={() => setCreateDialog({ visible: true, type: 'file' })}
              >
                {!touchAdaptation.shouldShowMobileUI && "新建文件"}
              </Button>
            </Tooltip>
            <Tooltip title="上传文件">
              <Button
                icon={<UploadOutlined />}
                onClick={() => setUploadDialog(true)}
              >
                {!touchAdaptation.shouldShowMobileUI && "上传"}
              </Button>
            </Tooltip>

            {/* 文件操作按钮 - 小屏模式下隐藏 */}
            {!touchAdaptation.shouldShowMobileUI && (
              <div className="border-l border-gray-300 dark:border-gray-600 pl-2 ml-2">
                <Space>
                  <Tooltip title={selectedFiles.size > 0 ? `复制选中项 (${selectedFiles.size}) (Ctrl+C)` : "复制 (Ctrl+C)"}>
                    <Button
                      icon={<CopyOutlined />}
                      disabled={selectedFiles.size === 0}
                      onClick={() => {
                        const selectedFileItems = Array.from(selectedFiles).map(path =>
                          files.find(f => f.path === path)
                        ).filter(Boolean) as FileItem[]
                        handleContextMenuCopy(selectedFileItems)
                      }}
                    />
                  </Tooltip>
                  <Tooltip title={selectedFiles.size > 0 ? `剪切选中项 (${selectedFiles.size}) (Ctrl+X)` : "剪切 (Ctrl+X)"}>
                    <Button
                      icon={<ScissorOutlined />}
                      disabled={selectedFiles.size === 0}
                      onClick={() => {
                        const selectedFileItems = Array.from(selectedFiles).map(path =>
                          files.find(f => f.path === path)
                        ).filter(Boolean) as FileItem[]
                        handleContextMenuCut(selectedFileItems)
                      }}
                    />
                  </Tooltip>
                  <Tooltip title={clipboard.operation && clipboard.items.length > 0 ? `粘贴 ${clipboard.items.length} 个项目 (Ctrl+V)` : "粘贴 (Ctrl+V)"}>
                    <Button
                      icon={<SnippetsOutlined />}
                      disabled={!clipboard.operation || clipboard.items.length === 0}
                      type={clipboard.operation && clipboard.items.length > 0 ? "primary" : "default"}
                      onClick={handlePaste}
                    />
                  </Tooltip>
                  <Tooltip title={selectedFiles.size > 0 ? `删除选中项 (${selectedFiles.size}) (Delete)` : "删除 (Delete)"}>
                    <Button
                      icon={<DeleteOutlined />}
                      disabled={selectedFiles.size === 0}
                      danger
                      onClick={() => {
                        // 将选中的文件转换为FileItem数组
                        const selectedFileItems = files.filter(file => selectedFiles.has(file.path))
                        setDeleteDialog({ visible: true, files: selectedFileItems })
                      }}
                    />
                  </Tooltip>
                </Space>
              </div>
            )}

            {/* 任务状态按钮 */}
            <Tooltip title="查看任务状态">
              <Badge count={activeTasks.length} size="small">
                <Button
                  icon={<BellOutlined />}
                  onClick={() => setTaskDrawerVisible(true)}
                >
                  {!touchAdaptation.shouldShowMobileUI && "任务"}
                </Button>
              </Badge>
            </Tooltip>

            {/* 触摸帮助提示 */}
            <TouchHelpTooltip />
          </Space>
        </div>
      </div>
      
      {/* 路径栏 */}
      <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        {isEditingPath ? (
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onPressEnter={handlePathSubmit}
            onBlur={handlePathSubmit}
            autoFocus
          />
        ) : (
          <div onClick={() => setIsEditingPath(true)} className="cursor-pointer">
            <Breadcrumb items={generateBreadcrumbs()} />
          </div>
        )}
      </div>
      
      {/* 主内容区 */}
      <div 
        ref={fileListContainerRef}
        className="flex-1 p-4 overflow-auto"
        style={{ maxHeight: 'calc(100vh - 200px)' }}
        onContextMenu={(e) => {
          // 检查是否点击在空白区域（不是文件项）
          const target = e.target as HTMLElement
          const isFileItem = target.closest('[data-file-item]')
          
          if (!isFileItem) {
            e.preventDefault()
            // 清除选择
            clearSelection()
            // 设置空白区域右键菜单
            setContextMenuInfo({
              file: null, // null 表示空白区域
              position: { x: e.clientX, y: e.clientY }
            })
          }
        }}
        onClick={(e) => {
          // 点击空白区域时清除选择和关闭菜单
          const target = e.target as HTMLElement
          const isFileItem = target.closest('[data-file-item]')
          
          if (!isFileItem) {
            clearSelection()
            setContextMenuInfo(null)
          }
        }}
        onScroll={(e) => {
          const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
          const distanceFromBottom = scrollHeight - scrollTop - clientHeight
          
          // 清除之前的定时器
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current)
          }
          
          // 检查是否向下滚动
          const isScrollingDown = scrollTop > lastScrollTopRef.current
          lastScrollTopRef.current = scrollTop
          
          // 立即检查是否需要加载更多（针对快速滚动）
          if (distanceFromBottom <= 50 && pagination.hasMore && !loadingMore && isScrollingDown) {
            console.log('立即触发加载更多文件 - 距离底部:', distanceFromBottom, 'px')
            loadMoreFiles()
            return
          }
          
          // 防抖处理，延迟检查（针对慢速滚动）
          scrollTimeoutRef.current = setTimeout(() => {
            if (distanceFromBottom < 100 && pagination.hasMore && !loadingMore && isScrollingDown) {
              console.log('延迟触发加载更多文件 - 距离底部:', distanceFromBottom, 'px')
              loadMoreFiles()
            }
          }, 150)
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Spin size="large" />
          </div>
        ) : filteredFiles.length === 0 ? (
          <Empty 
            description="此文件夹为空"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <AnimatePresence mode="wait">
            {viewMode === 'grid' ? (
              <motion.div
                key="grid-view"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4"
              >
                {filteredFiles.map((file, index) => {
                  // 对于加载更多的情况，新加载的文件使用很小的延迟
                  const isNewlyLoaded = pagination.page > 1 && index >= (pagination.page - 1) * 50
                  const animationDelay = isNewlyLoaded ? Math.min((index % 5) * 0.01, 0.05) : Math.min(index * 0.02, 0.5)
                  
                  return (
                    <motion.div
                      key={file.path}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ 
                        duration: isNewlyLoaded ? 0.2 : 0.3, 
                        delay: animationDelay,
                        ease: "easeOut"
                      }}
                    >
                    <FileContextMenu
                      file={file}
                      selectedFiles={selectedFiles}
                      clipboard={clipboard}
                      onClose={() => setContextMenuInfo(null)}
                      onOpen={handleContextMenuOpen}
                      onRename={handleContextMenuRename}
                      onDelete={handleContextMenuDelete}
                      onDownload={handleContextMenuDownload}
                      onDownloadWithProgress={handleContextMenuDownloadWithProgress}
                      onCopy={handleContextMenuCopy}
                      onCut={handleContextMenuCut}
                      onPaste={handlePaste}
                      onView={handleContextMenuView}
                      onCompress={handleContextMenuCompress}
                      onExtract={handleContextMenuExtract}
                      onOpenTerminal={handleContextMenuOpenTerminal}
                      onAddToPlaylist={handleAddToPlaylist}
                      onCreateFile={() => setCreateDialog({ visible: true, type: 'file' })}
                      onCreateFolder={() => setCreateDialog({ visible: true, type: 'folder' })}
                      onCreateTextFile={handleCreateTextFile}
                      onCreateJsonFile={handleCreateJsonFile}
                      onCreateIniFile={handleCreateIniFile}
                      onPermissions={handlePermissions}
                      // 全局菜单控制
                      globalContextMenuInfo={contextMenuInfo}
                      setGlobalContextMenuInfo={setContextMenuInfo}
                    >
                      <FileGridItem
                        file={file}
                        isSelected={selectedFiles.has(file.path)}
                        onClick={handleFileClick}
                        onDoubleClick={handleFileDoubleClick}
                        onContextMenu={(file, event) => {
                          // 长按触发右键菜单
                          const position = event instanceof TouchEvent
                            ? { x: event.touches[0]?.clientX || 0, y: event.touches[0]?.clientY || 0 }
                            : { x: event.clientX, y: event.clientY }
                          setContextMenuInfo({ file, position })
                        }}
                      />
                    </FileContextMenu>
                  </motion.div>
                )})}
              </motion.div>
            ) : (
              <motion.div
                key="list-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="space-y-2"
              >
                {filteredFiles.map((file, index) => {
                  // 对于加载更多的情况，新加载的文件使用很小的延迟
                  const isNewlyLoaded = pagination.page > 1 && index >= (pagination.page - 1) * 50
                  const animationDelay = isNewlyLoaded ? Math.min((index % 5) * 0.01, 0.05) : Math.min(index * 0.02, 0.5)
                  
                  return (
                    <motion.div
                      key={file.path}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ 
                        duration: isNewlyLoaded ? 0.2 : 0.3, 
                        delay: animationDelay,
                        ease: "easeOut"
                      }}
                    >
                    <FileContextMenu
                      file={file}
                      selectedFiles={selectedFiles}
                      clipboard={clipboard}
                      onClose={() => setContextMenuInfo(null)}
                      onOpen={handleContextMenuOpen}
                      onRename={handleContextMenuRename}
                      onDelete={handleContextMenuDelete}
                      onDownload={handleContextMenuDownload}
                      onDownloadWithProgress={handleContextMenuDownloadWithProgress}
                      onCopy={handleContextMenuCopy}
                      onCut={handleContextMenuCut}
                      onPaste={handlePaste}
                      onView={handleContextMenuView}
                      onCompress={handleContextMenuCompress}
                      onExtract={handleContextMenuExtract}
                      onOpenTerminal={handleContextMenuOpenTerminal}
                      onAddToPlaylist={handleAddToPlaylist}
                      onCreateFile={() => setCreateDialog({ visible: true, type: 'file' })}
                      onCreateFolder={() => setCreateDialog({ visible: true, type: 'folder' })}
                      onCreateTextFile={handleCreateTextFile}
                      onCreateJsonFile={handleCreateJsonFile}
                      onCreateIniFile={handleCreateIniFile}
                      onPermissions={handlePermissions}
                      // 全局菜单控制
                      globalContextMenuInfo={contextMenuInfo}
                      setGlobalContextMenuInfo={setContextMenuInfo}
                      >
                      <FileListItem
                        file={file}
                        isSelected={selectedFiles.has(file.path)}
                        onClick={handleFileClick}
                        onDoubleClick={handleFileDoubleClick}
                        onContextMenu={(file, event) => {
                          // 长按触发右键菜单
                          const position = event instanceof TouchEvent
                            ? { x: event.touches[0]?.clientX || 0, y: event.touches[0]?.clientY || 0 }
                            : { x: event.clientX, y: event.clientY }
                          setContextMenuInfo({ file, position })
                        }}
                      />
                    </FileContextMenu>
                  </motion.div>
                )})}
              </motion.div>
            )}
          </AnimatePresence>
        )}
        
        {/* 加载更多指示器 */}
        {loadingMore && (
          <div className="flex items-center justify-center py-4">
            <Spin size="small" />
            <span className="ml-2 text-gray-500">加载更多...</span>
          </div>
        )}
        
        {/* 分页信息 */}
        {pagination.total > 0 && (
          <div className="text-center text-gray-500 text-sm mt-4">
            已显示 {files.length} / {pagination.total} 个项目
            {pagination.hasMore && ' (滚动到底部加载更多)'}
          </div>
        )}
      </div>
      
      {/* 空白区域右键菜单 */}
      <FileContextMenu
        file={null}
        selectedFiles={selectedFiles}
        clipboard={clipboard}
        onClose={() => setContextMenuInfo(null)}
        onPaste={handlePaste}
        onCreateFile={() => setCreateDialog({ visible: true, type: 'file' })}
        onCreateFolder={() => setCreateDialog({ visible: true, type: 'folder' })}
        onCreateTextFile={handleCreateTextFile}
        onCreateJsonFile={handleCreateJsonFile}
        onCreateIniFile={handleCreateIniFile}
        onOpenTerminal={handleContextMenuOpenTerminal}
        // 全局菜单控制
        globalContextMenuInfo={contextMenuInfo}
        setGlobalContextMenuInfo={setContextMenuInfo}
      >
        <div />
      </FileContextMenu>
      
      {/* 对话框 */}
      <CreateDialog
        visible={createDialog.visible}
        type={createDialog.type}
        onConfirm={handleCreateConfirm}
        onCancel={() => setCreateDialog({ visible: false, type: 'folder' })}
      />
      
      <RenameDialog
        visible={renameDialog.visible}
        currentName={renameDialog.file?.name || ''}
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameDialog({ visible: false, file: null })}
      />
      
      <UploadDialog
        visible={uploadDialog}
        onConfirm={handleUploadConfirm}
        onCancel={() => setUploadDialog(false)}
      />
      
      <DeleteConfirmDialog
        visible={deleteDialog.visible}
        fileNames={deleteDialog.files.map(file => file.name)}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteDialog({ visible: false, files: [] })}
      />
      
      <CompressDialog
        visible={compressDialog.visible}
        fileCount={compressDialog.files.length}
        onConfirm={handleCompressConfirm}
        onCancel={() => setCompressDialog({ visible: false, files: [] })}
      />
      
      <PermissionsDialog
        visible={permissionsDialog.visible}
        file={permissionsDialog.file}
        onClose={() => setPermissionsDialog({ visible: false, file: null })}
        onSuccess={async () => {
          // 刷新文件列表
          await loadFiles()
        }}
      />
      
      {/* 编辑器模态框 */}
      <Modal
        title="文本编辑器"
        open={editorModalVisible}
        onCancel={() => setEditorModalVisible(false)}
        width="90%"
        style={{ top: 20 }}
        styles={{ body: { height: '80vh', padding: 0 } }}
        footer={[
          <Button key="close" onClick={() => setEditorModalVisible(false)}>
            关闭
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            icon={<SaveOutlined />}
            onClick={() => handleSaveFile()}
            disabled={!activeFile}
          >
            保存
          </Button>
        ]}
      >
        {openFiles.size > 0 && (
          <div className="h-full flex flex-col">
            <Tabs
              type="editable-card"
              activeKey={activeFile || undefined}
              onChange={setActiveFile}
              onEdit={(targetKey, action) => {
                if (action === 'remove' && typeof targetKey === 'string') {
                  closeFile(targetKey)
                  if (openFiles.size === 1) {
                    setEditorModalVisible(false)
                  }
                } else if (action === 'add') {
                  // 点击+号创建新文件
                  setCreateDialog({ visible: true, type: 'file' })
                  setEditorModalVisible(false)
                }
              }}
              className="flex-1"
              items={Array.from(openFiles.entries()).map(([filePath, content]) => ({
                key: filePath,
                label: (
                  <span className="flex items-center">
                    <FileTextOutlined className="mr-1" />
                    {getBasename(filePath)}
                    {isFileModified(filePath) && (
                      <span 
                        className="ml-1 w-2 h-2 bg-orange-500 rounded-full" 
                        title="文件已修改"
                      />
                    )}
                  </span>
                ),
                closable: true,
                children: (
                  <div style={{ height: 'calc(80vh - 140px)' }}>
                    <MonacoEditor
                      value={content || ''}
                      onChange={(value) => handleEditorChange(filePath, value)}
                      fileName={getBasename(filePath)}
                      onSave={(value) => handleSaveFile(value)}
                      lineEnding={lineEnding}
                      onLineEndingChange={handleLineEndingChange}
                    />
                  </div>
                )
              }))}
            />
            
            {/* 换行符和编码选择器 */}
            <div 
              className="flex items-center justify-start px-4 py-2 space-x-6"
              style={{ 
                backgroundColor: theme === 'dark' ? '#1F1F1F' : '#FAFAFA'
              }}
            >
              <div className="flex items-center">
                <span className={`text-sm mr-3 ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  换行符:
                </span>
                <Select
                  value={lineEnding}
                  onChange={handleLineEndingChange}
                  size="small"
                  style={{ width: 80 }}
                  options={[
                    { value: 'LF', label: 'LF' },
                    { value: 'CRLF', label: 'CRLF' },
                    { value: 'CR', label: 'CR' }
                  ]}
                />
              </div>
              
              <div className="flex items-center">
                <span className={`text-sm mr-3 ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  编码:
                </span>
                <Select
                  value={currentFileEncoding}
                  disabled
                  size="small"
                  style={{ width: 140 }}
                  options={[
                    { value: 'utf-8', label: 'UTF-8' },
                    { value: 'utf-16le', label: 'UTF-16 LE' },
                    { value: 'utf-16be', label: 'UTF-16 BE' },
                    { value: 'gbk', label: 'GBK' },
                    { value: 'big5', label: 'Big5' },
                    { value: 'windows-1252', label: 'ANSI (西欧)' },
                    { value: 'iso-8859-1', label: 'ISO-8859-1' }
                  ]}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>
      
      {/* 图片预览模态框 */}
      <ImagePreview
        isOpen={imagePreviewVisible}
        onClose={() => setImagePreviewVisible(false)}
        imagePath={previewImagePath}
        fileName={previewImageName}
      />
      
      {/* 编码确认对话框 */}
      <EncodingConfirmDialog
        visible={encodingDialog.visible}
        fileName={encodingDialog.fileName}
        detectedEncoding={encodingDialog.detectedEncoding}
        confidence={encodingDialog.confidence}
        onConfirm={handleEncodingConvert}
        onCancel={handleEncodingCancel}
      />
      
      {/* 任务状态抽屉 */}
      <Drawer
        title="任务状态"
        placement="right"
        onClose={() => setTaskDrawerVisible(false)}
        open={taskDrawerVisible}
        width={400}
      >
        <div className="space-y-4">
          {activeTasks.length === 0 ? (
            <Empty 
              description="暂无活动任务"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            activeTasks.map((task) => (
              <Card key={task.id} size="small" className="mb-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    {getTaskStatusIcon(task.status)}
                    <span className="font-medium">
                      {task.type === 'compress' ? '压缩' : 
                       task.type === 'extract' ? '解压' :
                       task.type === 'copy' ? '复制' :
                       task.type === 'move' ? '移动' :
                       task.type === 'download' ? '下载' : task.type}
                    </span>
                    <span className="text-gray-500">
                      {getTaskStatusText(task.status)}
                    </span>
                  </div>
                  {(task.status === 'completed' || task.status === 'failed') && (
                    <Button 
                      size="small" 
                      type="text" 
                      danger
                      onClick={async () => {
                        try {
                          const result = await deleteTask(task.id)
                          if (result.status === 'success') {
                            addNotification({
                              type: 'success',
                              title: '删除成功',
                              message: '任务已删除'
                            })
                          } else {
                            addNotification({
                              type: 'error',
                              title: '删除失败',
                              message: result.message || '删除任务失败'
                            })
                          }
                        } catch (error: any) {
                          addNotification({
                            type: 'error',
                            title: '删除失败',
                            message: error.message || '删除任务失败'
                          })
                        }
                      }}
                    >
                      删除
                    </Button>
                  )}
                </div>
                
                {task.status === 'running' && (
                  <Progress 
                    percent={task.progress || 0} 
                    size="small"
                    status="active"
                  />
                )}
                
                {task.message && (
                  <div className="text-sm text-gray-600 mt-2">
                    {task.message}
                  </div>
                )}
                
                <div className="text-xs text-gray-400 mt-2">
                  创建时间: {new Date(task.createdAt).toLocaleString()}
                  {task.updatedAt && (
                    <div>
                      更新时间: {new Date(task.updatedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </Card>
            ))
          )}
          
          {activeTasks.length > 0 && (
            <div className="text-center pt-4">
              <Button 
                type="primary" 
                onClick={() => {
                  loadActiveTasks()
                  loadTasks()
                }}
              >
                刷新任务状态
              </Button>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  )
}

export default FileManagerPage