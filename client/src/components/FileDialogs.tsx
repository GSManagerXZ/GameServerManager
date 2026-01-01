import React, { useState, useEffect, useRef } from 'react'
import { Modal, Form, Input, Upload, message, Progress, Button, Space, Alert } from 'antd'
import { InboxOutlined, CloseCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import type { UploadProps, UploadFile } from 'antd'
import { FileUploadProgress } from '@/types/file'

const { Dragger } = Upload

interface CreateDialogProps {
  visible: boolean
  type: 'file' | 'folder'
  onConfirm: (name: string) => void
  onCancel: () => void
}

export const CreateDialog: React.FC<CreateDialogProps> = ({
  visible,
  type,
  onConfirm,
  onCancel
}) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<any>(null)

  useEffect(() => {
    if (visible) {
      form.resetFields()
      // 延迟聚焦，确保Modal完全打开后再聚焦
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 100)
    }
  }, [visible, form])

  const handleOk = async () => {
    try {
      setLoading(true)
      const values = await form.validateFields()
      onConfirm(values.name)
      form.resetFields()
    } catch (error) {
      // 验证失败
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleOk()
    }
  }

  return (
    <Modal
      title={`创建${type === 'file' ? '文件' : '文件夹'}`}
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        className="mt-4"
        onFinish={handleOk}
      >
        <Form.Item
          name="name"
          label={`${type === 'file' ? '文件' : '文件夹'}名称`}
          rules={[
            { required: true, message: '请输入名称' },
            {
              pattern: /^[^<>:"/\\|?*]+$/,
              message: '名称不能包含特殊字符'
            }
          ]}
        >
          <Input
            ref={inputRef}
            placeholder={`请输入${type === 'file' ? '文件' : '文件夹'}名称`}
            onKeyDown={handleKeyDown}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

interface RenameDialogProps {
  visible: boolean
  currentName: string
  onConfirm: (newName: string) => void
  onCancel: () => void
}

export const RenameDialog: React.FC<RenameDialogProps> = ({
  visible,
  currentName,
  onConfirm,
  onCancel
}) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<any>(null)

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({ name: currentName })
      // 延迟聚焦，确保Modal完全打开后再聚焦
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          // 选中文件名（不包括扩展名）
          const lastDotIndex = currentName.lastIndexOf('.')
          if (lastDotIndex > 0) {
            // 有扩展名，选中文件名部分
            inputRef.current.setSelectionRange(0, lastDotIndex)
          } else {
            // 没有扩展名或是隐藏文件，选中全部
            inputRef.current.select()
          }
        }
      }, 100)
    }
  }, [visible, currentName, form])

  const handleOk = async () => {
    try {
      setLoading(true)
      const values = await form.validateFields()
      onConfirm(values.name)
      form.resetFields()
    } catch (error) {
      // 验证失败
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleOk()
    }
  }

  return (
    <Modal
      title="重命名"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        className="mt-4"
        onFinish={handleOk}
      >
        <Form.Item
          name="name"
          label="新名称"
          rules={[
            { required: true, message: '请输入新名称' },
            {
              pattern: /^[^<>:"/\\|?*]+$/,
              message: '名称不能包含特殊字符'
            }
          ]}
        >
          <Input
            ref={inputRef}
            placeholder="请输入新名称"
            onKeyDown={handleKeyDown}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

interface FileUploadState {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
  speed?: number // bytes/s
  remainingTime?: number // seconds
}

interface ChunkProgressInfo {
  chunkIndex: number
  status: 'pending' | 'uploading' | 'completed' | 'error' | 'retrying'
  progress: number
  size: number
  uploadedSize: number
  retryCount?: number
  error?: string
}

interface UploadDetailInfo {
  phase: string
  phaseText: string
  currentChunk: number
  totalChunks: number
  uploadedChunks: number
  uploadedSize: number
  totalSize: number
  percentage: number
  speed: number
  speedText: string
  remainingTime: number
  remainingTimeText: string
  currentBatch: number
  totalBatches: number
  chunksProgress: ChunkProgressInfo[]
  mergingProgress?: number
  retryInfo?: {
    chunkIndex: number
    retryCount: number
    maxRetries: number
  }
  errorMessage?: string
}

interface UploadDialogProps {
  visible: boolean
  targetPath: string // 上传目标路径
  onConfirm: (files: FileList, onProgress?: (progress: FileUploadProgress) => void, signal?: AbortSignal, conflictStrategy?: 'replace' | 'rename') => void
  onCancel: () => void
}

// 文件冲突信息接口
interface FileConflict {
  fileName: string
  exists: boolean
  existingSize?: number
  existingModified?: Date
}

export const UploadDialog: React.FC<UploadDialogProps> = ({
  visible,
  targetPath,
  onConfirm,
  onCancel
}) => {
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [uploadProgress, setUploadProgress] = useState<FileUploadProgress | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fileUploadStates, setFileUploadStates] = useState<Map<string, FileUploadState>>(new Map())
  const [overallProgress, setOverallProgress] = useState(0)
  const [uploadDetail, setUploadDetail] = useState<UploadDetailInfo | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isCancelledRef = useRef(false)

  // 冲突检测相关状态
  const [isCheckingConflict, setIsCheckingConflict] = useState(false)
  const [conflictModalVisible, setConflictModalVisible] = useState(false)
  const [conflictFiles, setConflictFiles] = useState<FileConflict[]>([])
  const pendingFilesRef = useRef<FileList | null>(null)

  const uploadProps: UploadProps = {
    name: 'files',
    multiple: true,
    beforeUpload: (file) => {
      // 验证文件名是否包含中文字符
      const hasChineseChars = /[\u4e00-\u9fa5]/.test(file.name)

      // 检查文件名是否安全
      const dangerousChars = /[<>:"/\\|?*\x00-\x1f]/
      if (dangerousChars.test(file.name)) {
        message.error(`文件名 "${file.name}" 包含不安全的字符，请重命名后再上传`)
        return Upload.LIST_IGNORE
      }

      // 检查文件名长度
      if (file.name.length > 255) {
        message.error(`文件名 "${file.name}" 过长，请使用较短的文件名`)
        return Upload.LIST_IGNORE
      }

      const uploadFile: UploadFile = {
        uid: file.name + file.size + Date.now(),
        name: file.name,
        size: file.size,
        status: 'done',
        originFileObj: file as any
      }

      setFileList(prev => [...prev, uploadFile])

      if (hasChineseChars) {
        console.log('Added Chinese filename to upload list:', file.name)
      }

      return false // 阻止自动上传
    },
    onRemove: (file) => {
      setFileList(prev => prev.filter(f => f.uid !== file.uid))
    },
    fileList: fileList,
    showUploadList: {
      showPreviewIcon: false,
      showRemoveIcon: true,
      showDownloadIcon: false
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  // 执行实际上传
  const executeUpload = async (files: FileList, conflictStrategy: 'replace' | 'rename' = 'rename') => {
    setLoading(true)
    setIsUploading(true)
    isCancelledRef.current = false

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController()

    // 初始化文件上传状态
    const initialStates = new Map<string, FileUploadState>()
    fileList.forEach(uploadFile => {
      if (uploadFile.originFileObj) {
        initialStates.set(uploadFile.uid, {
          file: uploadFile.originFileObj as File,
          progress: 0,
          status: 'pending'
        })
      }
    })
    setFileUploadStates(initialStates)

    try {
      // 更新进度回调
      const onProgressUpdate = (progress: FileUploadProgress & { detail?: any }) => {
        // 如果已取消，不更新进度
        if (isCancelledRef.current) {
          return
        }

        setUploadProgress(progress)

        // 更新详细进度信息
        if (progress.detail) {
          setUploadDetail(progress.detail)
        }

        // 更新整体进度
        if (progress.status === 'completed') {
          setOverallProgress(100)
        } else if (progress.status === 'uploading') {
          setOverallProgress(progress.progress)
        }
      }

      await onConfirm(files, onProgressUpdate, abortControllerRef.current.signal, conflictStrategy)

      // 如果没有被取消，显示成功状态
      if (!isCancelledRef.current) {
        // 上传成功，等待一会儿让用户看到完成状态
        await new Promise(resolve => setTimeout(resolve, 1000))
        setFileList([])
        setFileUploadStates(new Map())
        setOverallProgress(0)
      }
    } catch (error: any) {
      // 如果是取消操作，不显示错误
      if (error.name === 'AbortError' || error.message === 'Upload aborted' || isCancelledRef.current) {
        console.log('上传已取消')
      } else {
        message.error(error.message || '上传失败')
      }
    } finally {
      if (!isCancelledRef.current) {
        setLoading(false)
        setIsUploading(false)
        setUploadProgress(null)
      }
    }
  }

  const handleOk = async () => {
    if (fileList.length === 0) {
      message.warning('请选择要上传的文件')
      return
    }

    // 创建一个真正的FileList对象
    const dataTransfer = new DataTransfer()
    fileList.forEach(uploadFile => {
      if (uploadFile.originFileObj) {
        dataTransfer.items.add(uploadFile.originFileObj as File)
      }
    })
    const files = dataTransfer.files

    // 检查文件冲突
    setIsCheckingConflict(true)
    try {
      const fileNames = Array.from(files).map(f => f.name)
      const response = await fetch('/api/files/upload/check-conflict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('gsm3_token')}`
        },
        body: JSON.stringify({
          targetPath,
          fileNames
        })
      })

      const result = await response.json()

      if (result.success && result.data.hasConflicts) {
        // 存在冲突，显示确认弹窗
        const existingConflicts = result.data.conflicts.filter((c: FileConflict) => c.exists)
        setConflictFiles(existingConflicts)
        pendingFilesRef.current = files
        setConflictModalVisible(true)
      } else {
        // 没有冲突，直接上传
        await executeUpload(files, 'rename')
      }
    } catch (error: any) {
      console.error('检查文件冲突失败:', error)
      // 检查失败，继续上传（使用默认的重命名策略）
      await executeUpload(files, 'rename')
    } finally {
      setIsCheckingConflict(false)
    }
  }

  // 处理冲突选择：替换
  const handleConflictReplace = async () => {
    setConflictModalVisible(false)
    if (pendingFilesRef.current) {
      await executeUpload(pendingFilesRef.current, 'replace')
      pendingFilesRef.current = null
    }
  }

  // 处理冲突选择：重命名
  const handleConflictRename = async () => {
    setConflictModalVisible(false)
    if (pendingFilesRef.current) {
      await executeUpload(pendingFilesRef.current, 'rename')
      pendingFilesRef.current = null
    }
  }

  // 取消冲突处理
  const handleConflictCancel = () => {
    setConflictModalVisible(false)
    pendingFilesRef.current = null
  }

  const handleCancel = () => {
    if (isUploading) {
      // 正在上传，执行取消操作
      isCancelledRef.current = true

      // 取消所有正在进行的上传
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      message.info('正在取消上传...')

      // 延迟一点再重置状态，确保取消信号已传递
      setTimeout(() => {
        setFileList([])
        setFileUploadStates(new Map())
        setOverallProgress(0)
        setIsUploading(false)
        setLoading(false)
        setUploadProgress(null)
        abortControllerRef.current = null
        onCancel()
      }, 300)
    } else {
      // 未开始上传，直接取消
      setFileList([])
      setFileUploadStates(new Map())
      setOverallProgress(0)
      onCancel()
    }
  }

  // 格式化速度
  const formatSpeed = (bytesPerSecond: number): string => {
    return formatFileSize(bytesPerSecond) + '/s'
  }

  // 格式化剩余时间
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}秒`
    if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
    return `${Math.round(seconds / 3600)}小时`
  }

  return (
    <>
      <Modal
        title={
          <div className="flex items-center justify-between">
            <span>上传文件</span>
            {isUploading && (
              <span className="text-sm font-normal text-gray-500">
                正在上传...
              </span>
            )}
          </div>
        }
        open={visible}
        onOk={handleOk}
        onCancel={handleCancel}
        confirmLoading={loading}
        destroyOnHidden
        width={700}
        footer={
          isUploading ? [
            <Button key="cancel" onClick={handleCancel} danger>
              取消上传
            </Button>
          ] : [
            <Button key="cancel" onClick={handleCancel}>
              取消
            </Button>,
            <Button
              key="submit"
              type="primary"
              loading={loading}
              onClick={handleOk}
              disabled={fileList.length === 0}
            >
              开始上传
            </Button>
          ]
        }
      >
        <div className="mt-4">
          {!isUploading && (
            <>
              <Dragger
                {...uploadProps}
                disabled={isUploading}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined className="text-4xl text-blue-500" />
                </p>
                <p className="ant-upload-text text-lg font-medium">
                  点击或拖拽文件到此区域上传
                </p>
                <p className="ant-upload-hint text-gray-500">
                  支持单个或批量上传文件，大文件将自动使用分片上传
                </p>
              </Dragger>

              {fileList.length > 0 && (
                <Alert
                  className="mt-4"
                  message={`已选择 ${fileList.length} 个文件，总大小: ${formatFileSize(
                    fileList.reduce((sum, f) => sum + (f.size || 0), 0)
                  )}`}
                  type="info"
                  showIcon
                />
              )}
            </>
          )}

          {isUploading && uploadProgress && (
            <div className="space-y-4">
              {/* 整体进度 */}
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">
                    {uploadDetail?.phaseText || '上传中...'}
                  </span>
                  <span className="text-sm text-gray-600">
                    {uploadProgress.fileName}
                  </span>
                </div>
                <Progress
                  percent={uploadProgress.progress}
                  status={
                    uploadProgress.status === 'completed' ? 'success' :
                      uploadProgress.status === 'error' ? 'exception' :
                        'active'
                  }
                  strokeColor={{
                    '0%': '#108ee9',
                    '100%': '#87d068',
                  }}
                />

                {/* 详细上传信息 */}
                {uploadDetail && (uploadProgress.status === 'uploading' || uploadDetail.phase === 'merging') && (
                  <div className="mt-3 space-y-3">
                    {/* 基础统计信息 */}
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2 text-xs">
                      {/* 分片信息 */}
                      {uploadDetail.totalChunks > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600 dark:text-gray-400">分片进度:</span>
                          <span className="font-medium">
                            {uploadDetail.uploadedChunks}/{uploadDetail.totalChunks} 个分片
                            {uploadDetail.totalBatches > 0 && ` (批次 ${uploadDetail.currentBatch}/${uploadDetail.totalBatches})`}
                          </span>
                        </div>
                      )}

                      {/* 已上传大小 */}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 dark:text-gray-400">已上传:</span>
                        <span className="font-medium">
                          {formatFileSize(uploadDetail.uploadedSize)} / {formatFileSize(uploadDetail.totalSize)}
                        </span>
                      </div>

                      {/* 上传速度 */}
                      {uploadDetail.speed > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600 dark:text-gray-400">上传速度:</span>
                          <span className="font-medium text-blue-600">{uploadDetail.speedText}</span>
                        </div>
                      )}

                      {/* 剩余时间 */}
                      {uploadDetail.remainingTime > 0 && uploadDetail.speed > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600 dark:text-gray-400">预计剩余:</span>
                          <span className="font-medium text-orange-600">{uploadDetail.remainingTimeText}</span>
                        </div>
                      )}

                      {/* 重试信息 */}
                      {uploadDetail.retryInfo && (
                        <div className="flex items-center justify-between text-yellow-600 dark:text-yellow-500">
                          <span>⚠️ 重试中:</span>
                          <span className="font-medium">
                            分片 {uploadDetail.retryInfo.chunkIndex + 1}
                            ({uploadDetail.retryInfo.retryCount}/{uploadDetail.retryInfo.maxRetries})
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 文件合并进度 */}
                    {uploadDetail.phase === 'merging' && uploadDetail.mergingProgress !== undefined && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <div className="flex items-center justify-between mb-2 text-xs">
                          <span className="font-medium text-blue-700 dark:text-blue-300">
                            🔗 正在写入文件...
                          </span>
                          <span className="text-blue-600 dark:text-blue-400">
                            {uploadDetail.mergingProgress}%
                          </span>
                        </div>
                        <Progress
                          percent={uploadDetail.mergingProgress}
                          size="small"
                          strokeColor="#3b82f6"
                          showInfo={false}
                        />
                      </div>
                    )}

                    {/* 分片列表 */}
                    {uploadDetail.chunksProgress && uploadDetail.chunksProgress.length > 0 && uploadDetail.phase === 'uploading' && (
                      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            分片详情
                          </span>
                          <span className="text-xs text-gray-500">
                            显示前 {Math.min(uploadDetail.chunksProgress.length, 10)} 个
                          </span>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {uploadDetail.chunksProgress.slice(0, 50).map((chunk) => {
                            const getStatusColor = () => {
                              switch (chunk.status) {
                                case 'completed': return 'text-green-600 dark:text-green-400'
                                case 'uploading': return 'text-blue-600 dark:text-blue-400'
                                case 'retrying': return 'text-yellow-600 dark:text-yellow-400'
                                case 'error': return 'text-red-600 dark:text-red-400'
                                default: return 'text-gray-400 dark:text-gray-600'
                              }
                            }

                            const getStatusIcon = () => {
                              switch (chunk.status) {
                                case 'completed': return '✓'
                                case 'uploading': return '↑'
                                case 'retrying': return '↻'
                                case 'error': return '✗'
                                default: return '○'
                              }
                            }

                            return (
                              <div
                                key={chunk.chunkIndex}
                                className={`flex items-center justify-between p-2 rounded text-xs ${chunk.status === 'uploading' ? 'bg-blue-100 dark:bg-blue-900/30' :
                                  chunk.status === 'completed' ? 'bg-green-50 dark:bg-green-900/20' :
                                    chunk.status === 'retrying' ? 'bg-yellow-50 dark:bg-yellow-900/20' :
                                      chunk.status === 'error' ? 'bg-red-50 dark:bg-red-900/20' :
                                        'bg-white dark:bg-gray-700'
                                  }`}
                              >
                                <div className="flex items-center space-x-2 flex-1 min-w-0">
                                  <span className={`font-medium ${getStatusColor()}`}>
                                    {getStatusIcon()}
                                  </span>
                                  <span className="font-medium truncate">
                                    #{chunk.chunkIndex + 1}
                                  </span>
                                  <span className="text-gray-500 text-[10px]">
                                    {formatFileSize(chunk.size)}
                                  </span>
                                  {chunk.retryCount && chunk.retryCount > 0 && (
                                    <span className="text-yellow-600 text-[10px]">
                                      (重试{chunk.retryCount})
                                    </span>
                                  )}
                                </div>
                                {chunk.status === 'uploading' && (
                                  <div className="flex items-center space-x-2 ml-2">
                                    <div className="w-16">
                                      <Progress
                                        percent={chunk.progress}
                                        size="small"
                                        showInfo={false}
                                        strokeWidth={3}
                                      />
                                    </div>
                                    <span className="text-[10px] text-gray-600 w-8 text-right">
                                      {Math.round(chunk.progress)}%
                                    </span>
                                  </div>
                                )}
                                {chunk.status === 'completed' && (
                                  <span className="text-[10px] text-green-600 dark:text-green-400">
                                    完成
                                  </span>
                                )}
                                {chunk.status === 'error' && chunk.error && (
                                  <span className="text-[10px] text-red-600 truncate max-w-[100px]" title={chunk.error}>
                                    {chunk.error}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                          {uploadDetail.chunksProgress.length > 50 && (
                            <div className="text-center text-xs text-gray-500 py-2">
                              ... 还有 {uploadDetail.chunksProgress.length - 50} 个分片
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {uploadProgress.status === 'completed' && (
                  <div className="mt-2 flex items-center text-sm text-green-600">
                    <CheckCircleOutlined className="mr-1" />
                    上传完成
                  </div>
                )}

                {uploadProgress.status === 'error' && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center text-sm text-red-600">
                      <CloseCircleOutlined className="mr-1" />
                      上传失败
                    </div>
                    {uploadDetail?.errorMessage && (
                      <div className="text-xs text-red-500 ml-5">
                        {uploadDetail.errorMessage}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 文件列表 */}
              {fileList.length > 1 && (
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {fileList.map((file) => {
                    const state = fileUploadStates.get(file.uid)
                    return (
                      <div
                        key={file.uid}
                        className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium truncate flex-1">
                            {file.name}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">
                            {formatFileSize(file.size || 0)}
                          </span>
                        </div>
                        {state && (
                          <Progress
                            percent={state.progress}
                            size="small"
                            status={
                              state.status === 'completed' ? 'success' :
                                state.status === 'error' ? 'exception' :
                                  state.status === 'uploading' ? 'active' :
                                    'normal'
                            }
                            showInfo={false}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* 文件冲突确认弹窗 */}
      <Modal
        title={
          <div className="flex items-center">
            <ExclamationCircleOutlined className="text-yellow-500 mr-2 text-lg" />
            <span>文件已存在</span>
          </div>
        }
        open={conflictModalVisible}
        onCancel={handleConflictCancel}
        zIndex={1100}
        footer={[
          <Button key="cancel" onClick={handleConflictCancel}>
            取消
          </Button>,
          <Button key="rename" onClick={handleConflictRename}>
            保留两者（重命名）
          </Button>,
          <Button key="replace" type="primary" danger onClick={handleConflictReplace}>
            替换
          </Button>
        ]}
        width={500}
      >
        <div className="py-4">
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            以下 {conflictFiles.length} 个文件在目标位置已存在，请选择处理方式：
          </p>
          <div className="max-h-48 overflow-y-auto border rounded-lg dark:border-gray-600">
            {conflictFiles.map((conflict, index) => (
              <div
                key={conflict.fileName}
                className={`flex items-center justify-between p-3 ${index !== conflictFiles.length - 1 ? 'border-b dark:border-gray-600' : ''
                  }`}
              >
                <div className="flex items-center min-w-0 flex-1">
                  <span className="truncate font-medium">{conflict.fileName}</span>
                </div>
                {conflict.existingSize !== undefined && (
                  <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">
                    {formatFileSize(conflict.existingSize)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            <p><strong>替换</strong>：将覆盖目标位置的现有文件</p>
            <p><strong>保留两者</strong>：将以新名称（添加序号）保存上传的文件</p>
          </div>
        </div>
      </Modal>
    </>
  )
}

interface DeleteConfirmDialogProps {
  visible: boolean
  fileNames: string[]
  onConfirm: () => void
  onCancel: () => void
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  visible,
  fileNames,
  onConfirm,
  onCancel
}) => {
  const [loading, setLoading] = useState(false)

  const handleOk = async () => {
    setLoading(true)
    try {
      onConfirm()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="确认删除"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
    >
      <div className="mt-4">
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          确定要删除以下{fileNames.length}个项目吗？此操作不可撤销。
        </p>
        <div className="max-h-40 overflow-y-auto bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          {fileNames.map((name, index) => (
            <div key={`${name}-${index}`} className="text-sm text-gray-600 dark:text-gray-400 py-1">
              {name}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}