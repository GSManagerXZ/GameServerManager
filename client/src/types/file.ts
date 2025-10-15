export interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modified: string
}

export interface FilePagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface FileListResponse {
  files: FileItem[]
  pagination: FilePagination
}

export interface FileOperationResult {
  success: boolean
  status: 'success' | 'error'
  message: string
  taskId?: string
  data?: any
}

export interface FileUploadProgress {
  fileName: string
  progress: number
  status: 'uploading' | 'completed' | 'error'
}

export interface FileSearchResult {
  status: 'success' | 'error'
  results: FileItem[]
  total_found: number
  truncated: boolean
}

export interface FileContent {
  content: string
  encoding: string
  detectedEncoding?: string
  confidence?: number
  isIncompatible?: boolean
  size: number
  modified: string
}

export interface Task {
  id: string
  type: 'compress' | 'extract' | 'copy' | 'move' | 'download'
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  message: string
  createdAt: string
  updatedAt: string
  data: any
}