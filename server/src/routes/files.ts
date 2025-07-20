import { Router, Request, Response } from 'express'
import { promises as fs } from 'fs'
import * as fsSync from 'fs'
import path from 'path'
import multer from 'multer'
import { createReadStream, createWriteStream } from 'fs'
import archiver from 'archiver'
import unzipper from 'unzipper'
import * as tar from 'tar'
import * as zlib from 'zlib'
import mime from 'mime-types'
import { exec } from 'child_process'
import { promisify } from 'util'
import { authenticateToken, authenticateTokenFlexible } from '../middleware/auth.js'
import { taskManager } from '../modules/task/taskManager.js'
import { compressionWorker } from '../modules/task/compressionWorker.js'
import { executeFileOperation } from '../modules/task/fileOperationWorker.js'

const execAsync = promisify(exec)

const router = Router()

// 处理中文文件名编码的工具函数
const fixChineseFilename = (filename: string): string => {
  if (!filename) return filename
  
  try {
    // 如果文件名包含乱码字符，尝试多种编码方式修复
    if (filename.includes('�') || /[\x80-\xFF]/.test(filename)) {
      // 尝试从 latin1 转换为 utf8
      const buffer = Buffer.from(filename, 'latin1')
      const utf8Name = buffer.toString('utf8')
      
      // 验证转换后的文件名是否有效
      if (!utf8Name.includes('�') && utf8Name.length > 0) {
        return utf8Name
      }
      
      // 如果 latin1 转换失败，尝试 binary 转换
      const binaryBuffer = Buffer.from(filename, 'binary')
      const binaryUtf8 = binaryBuffer.toString('utf8')
      
      if (!binaryUtf8.includes('�') && binaryUtf8.length > 0) {
        return binaryUtf8
      }
    }
    
    // 如果没有编码问题，直接返回原文件名
    return filename
  } catch (error) {
    console.warn('Failed to fix filename encoding:', error)
    return filename
  }
}

// 验证文件名是否安全
const isSafeFilename = (filename: string): boolean => {
  if (!filename || filename.length === 0) return false
  
  // 检查是否包含危险字符
  const dangerousChars = /[<>:"/\\|?*\x00-\x1f]/
  if (dangerousChars.test(filename)) return false
  
  // 检查是否为保留名称（Windows）
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
  if (reservedNames.test(filename)) return false
  
  return true
}

// 配置文件上传
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), 'uploads')
      cb(null, uploadDir)
    },
    filename: (req, file, cb) => {
      // 处理中文文件名编码问题
      let originalName = fixChineseFilename(file.originalname)
      
      console.log('Original filename:', file.originalname)
      console.log('Fixed filename:', originalName)
      
      // 如果文件名仍然不安全，生成安全的文件名
      if (!isSafeFilename(originalName)) {
        const timestamp = Date.now()
        const ext = path.extname(file.originalname) || '.tmp'
        originalName = `upload-${timestamp}${ext}`
        console.log('Using fallback filename:', originalName)
      }
      
      cb(null, originalName)
    }
  }),
  fileFilter: (req, file, cb) => {
    // 在过滤器中也处理文件名编码
    file.originalname = fixChineseFilename(file.originalname)
    console.log('FileFilter - processed filename:', file.originalname)
    cb(null, true)
  }
})

// 安全路径检查
const isValidPath = (filePath: string): boolean => {
  if (!filePath || typeof filePath !== 'string') {
    return false
  }
  
  // 先解码URL编码的路径
  const decodedPath = decodeURIComponent(filePath)
  
  const normalizedPath = path.normalize(decodedPath)
  
  // 检查是否包含危险的路径遍历
  if (normalizedPath.includes('..')) {
    return false
  }
  
  // 在Windows上，路径可能以盘符开头（如 C:\）或UNC路径（如 \\server\share）
  // 在Unix系统上，绝对路径以 / 开头
  const isAbsolute = path.isAbsolute(normalizedPath)
  
  // 特殊处理 Windows 盘符路径（如 D: 或 D:/）
  const isWindowsDrive = process.platform === 'win32' && /^[A-Za-z]:[\\/]?$/.test(normalizedPath)
  
  return isAbsolute || isWindowsDrive
}
// 修复Windows路径格式的工具函数
const fixWindowsPath = (filePath: string): string => {
  if (!filePath) return filePath
  
  // 解码URL编码的路径
  let decodedPath = decodeURIComponent(filePath)
  
  // 在Windows系统中，如果路径以 /C: 或 \C: 或 /D: 或 \D: 等格式开头，移除前面的斜杠
  if (process.platform === 'win32' && /^[\/\\][A-Za-z]:/.test(decodedPath)) {
    decodedPath = decodedPath.substring(1)
  }
  
  // 在Windows系统中，如果路径是盘符格式（如 D: 或 D:/），转换为根目录格式（如 D:\）
  if (process.platform === 'win32') {
    if (/^[A-Za-z]:$/.test(decodedPath)) {
      // D: -> D:\
      decodedPath = decodedPath + '\\'
    } else if (/^[A-Za-z]:\/+$/.test(decodedPath)) {
      // D:/ 或 D:/// -> D:\
      decodedPath = decodedPath.charAt(0) + decodedPath.charAt(1) + '\\'
    }
  }
  
  return decodedPath
}

// 获取目录列表
router.get('/list', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: dirPath = '/' } = req.query
    
    if (!isValidPath(dirPath as string)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedDirPath = fixWindowsPath(dirPath as string)

    const stats = await fs.stat(fixedDirPath)
    if (!stats.isDirectory()) {
      return res.status(400).json({
        status: 'error',
        message: '指定路径不是目录'
      })
    }

    const items = await fs.readdir(fixedDirPath)
    const files = []

    for (const item of items) {
      const itemPath = path.join(fixedDirPath, item)
      try {
        const itemStats = await fs.stat(itemPath)
        files.push({
          name: item,
          path: itemPath,
          type: itemStats.isDirectory() ? 'directory' : 'file',
          size: itemStats.size,
          modified: itemStats.mtime.toISOString()
        })
      } catch (error) {
        // 跳过无法访问的文件
        continue
      }
    }

    res.json({
      status: 'success',
      data: files
    })
  } catch (error: any) {
    console.error('List request - Error occurred:', error)
    console.error('List request - Error stack:', error.stack)
    
    // 确保响应还没有发送
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: error.message || '文件列表获取失败'
      })
    }
  }
})

// 读取文件内容（流式传输）
router.get('/read', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.query

    if (!isValidPath(filePath as string)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedFilePath = fixWindowsPath(filePath as string)

    const stats = await fs.stat(fixedFilePath)
    if (!stats.isFile()) {
      return res.status(400).json({
        status: 'error',
        message: '指定路径不是文件'
      })
    }

    // 使用 mime-types 获取 Content-Type
    const contentType = mime.lookup(fixedFilePath) || 'application/octet-stream'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', stats.size.toString())

    // 创建文件流并 pipe 到响应
    const stream = createReadStream(fixedFilePath)
    stream.pipe(res)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ status: 'error', message: '文件未找到' })
    }
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 读取文本文件内容（JSON格式）
router.get('/read-content', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.query

    if (!isValidPath(filePath as string)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedFilePath = fixWindowsPath(filePath as string)

    const stats = await fs.stat(fixedFilePath)
    if (!stats.isFile()) {
      return res.status(400).json({
        status: 'error',
        message: '指定路径不是文件'
      })
    }

    // 读取文件内容
    const content = await fs.readFile(fixedFilePath, 'utf-8')
    
    res.json({
      status: 'success',
      data: {
        content: content,
        encoding: 'utf-8',
        size: stats.size,
        modified: stats.mtime
      }
    })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ status: 'error', message: '文件未找到' })
    }
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 预览图片文件
router.get('/preview', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.query
    
    console.log('Preview request - Original path:', filePath)
    
    if (!filePath) {
      return res.status(400).json({
        status: 'error',
        message: '缺少文件路径'
      })
    }
    
    const decodedFilePath = decodeURIComponent(filePath as string)
    console.log('Preview request - Decoded path:', decodedFilePath)
    
    // 处理相对路径，转换为基于工作目录的绝对路径
    let absoluteFilePath: string
    if (path.isAbsolute(decodedFilePath)) {
      absoluteFilePath = decodedFilePath
    } else {
      // 相对路径，基于工作目录解析
      absoluteFilePath = path.resolve(process.cwd(), decodedFilePath)
    }
    
    console.log('Preview request - Absolute path:', absoluteFilePath)
    
    // 基本安全检查：确保路径不包含危险的遍历
    const normalizedPath = path.normalize(absoluteFilePath)
    if (normalizedPath.includes('..')) {
      console.log('Preview request - Path contains dangerous traversal')
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    console.log('Preview request - Checking file stats for:', absoluteFilePath)
    
    // 检查文件是否存在
    try {
      await fs.access(absoluteFilePath)
    } catch (accessError) {
      return res.status(404).json({
        status: 'error',
        message: '文件不存在或无法访问'
      })
    }
    
    const stats = await fs.stat(absoluteFilePath)
    
    if (!stats.isFile()) {
      return res.status(400).json({
        status: 'error',
        message: '指定路径不是文件'
      })
    }

    // 获取文件扩展名并设置对应的Content-Type
    const ext = path.extname(absoluteFilePath).toLowerCase()
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    }

    const contentType = mimeTypes[ext] || 'application/octet-stream'
    
    console.log('Preview request - Reading file:', absoluteFilePath)
    console.log('Preview request - Content type:', contentType)
    console.log('Preview request - File extension:', ext)
    
    // 读取文件为Buffer
    const fileBuffer = await fs.readFile(absoluteFilePath)
    
    console.log('Preview request - File buffer length:', fileBuffer.length)
    console.log('Preview request - Buffer first 10 bytes:', fileBuffer.slice(0, 10))
    
    // 设置响应头
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', fileBuffer.length)
    res.setHeader('Cache-Control', 'public, max-age=3600') // 缓存1小时
    
    console.log('Preview request - Sending response with headers:', {
      'Content-Type': contentType,
      'Content-Length': fileBuffer.length
    })
    
    // 发送文件数据
    res.send(fileBuffer)
    console.log('Preview request - Response sent successfully')
  } catch (error: any) {
    res.status(500).json({
      success: false,
      status: 'error',
      message: error.message
    })
  }
})

// 创建文件
router.post('/create', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: filePath, content = '', encoding = 'utf-8' } = req.body
    
    if (!filePath) {
      return res.status(400).json({
        status: 'error',
        message: '缺少文件路径'
      })
    }
    
    if (!isValidPath(filePath)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedFilePath = fixWindowsPath(filePath)

    // 检查文件是否已存在
    try {
      await fs.access(fixedFilePath)
      return res.status(400).json({
        status: 'error',
        message: '文件已存在'
      })
    } catch {
      // 文件不存在，可以创建
    }

    // 确保父目录存在
    const parentDir = path.dirname(fixedFilePath)
    await fs.mkdir(parentDir, { recursive: true })
    
    // 创建文件
    await fs.writeFile(fixedFilePath, content, encoding)
    
    res.json({
      status: 'success',
      message: '文件创建成功'
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      status: 'error',
      message: error.message
    })
  }
})

// 保存文件内容
router.post('/save', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: filePath, content, encoding = 'utf-8' } = req.body
    
    if (!isValidPath(filePath)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedFilePath = fixWindowsPath(filePath)

    await fs.writeFile(fixedFilePath, content, encoding)
    
    res.json({
      status: 'success',
      message: '文件保存成功'
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 创建目录
// 原有的mkdir路由已移除，使用插件API专用的mkdir路由

// 删除文件或目录
router.delete('/delete', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { paths } = req.body
    
    if (!Array.isArray(paths)) {
      return res.status(400).json({
        status: 'error',
        message: '路径必须是数组'
      })
    }

    for (const filePath of paths) {
      if (!isValidPath(filePath)) {
        return res.status(400).json({
          status: 'error',
          message: `无效的路径: ${filePath}`
        })
      }

      // 修复Windows路径格式
      const fixedFilePath = fixWindowsPath(filePath)

      const stats = await fs.stat(fixedFilePath)
      if (stats.isDirectory()) {
        await fs.rm(fixedFilePath, { recursive: true, force: true })
      } else {
        await fs.unlink(fixedFilePath)
      }
    }
    
    res.json({
      status: 'success',
      message: '删除成功'
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 重命名文件或目录
router.post('/rename', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { oldPath, newPath } = req.body
    
    // 添加调试日志
    console.log('重命名请求:', { oldPath, newPath })
    console.log('oldPath验证:', isValidPath(oldPath))
    console.log('newPath验证:', isValidPath(newPath))
    
    if (!oldPath || !newPath) {
      return res.status(400).json({
        status: 'error',
        message: '缺少必要的路径参数'
      })
    }
    
    if (!isValidPath(oldPath) || !isValidPath(newPath)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedOldPath = fixWindowsPath(oldPath)
    const fixedNewPath = fixWindowsPath(newPath)

    await fs.rename(fixedOldPath, fixedNewPath)
    
    res.json({
      status: 'success',
      message: '重命名成功'
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 复制文件或目录（异步任务）
router.post('/copy', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { sourcePath, targetPath, sourcePaths } = req.body
    
    // 支持单个文件或多个文件
    const sources = sourcePaths || [sourcePath]
    
    if (!sources || sources.length === 0) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: '缺少源文件路径'
      })
    }

    if (!targetPath) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: '缺少目标路径'
      })
    }

    // 验证所有路径
    for (const source of sources) {
      if (!isValidPath(source)) {
        return res.status(400).json({
          success: false,
          status: 'error',
          message: `无效的源路径: ${source}`
        })
      }
    }

    if (!isValidPath(targetPath)) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: '无效的目标路径'
      })
    }

    // 修复Windows路径格式
    const fixedSources = sources.map(source => fixWindowsPath(source))
    const fixedTargetPath = fixWindowsPath(targetPath)

    // 验证源文件存在
    for (const source of fixedSources) {
      try {
        await fs.access(source)
      } catch (error) {
        return res.status(400).json({
          success: false,
          status: 'error',
          message: `源文件不存在: ${source}`
        })
      }
    }

    // 确保目标目录存在
    await fs.mkdir(fixedTargetPath, { recursive: true })

    // 创建复制任务
    const taskId = taskManager.createTask('copy', {
      sourcePaths: fixedSources,
      targetPath: fixedTargetPath,
      operation: 'copy'
    })

    // 异步执行文件复制
    setImmediate(() => {
      executeFileOperation(taskId)
    })

    res.json({
      success: true,
      status: 'success',
      message: '复制任务已创建',
      taskId
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 移动文件或目录（异步任务）
router.post('/move', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { sourcePath, targetPath, sourcePaths } = req.body
    
    // 支持单个文件或多个文件
    const sources = sourcePaths || [sourcePath]
    
    if (!sources || sources.length === 0) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: '缺少源文件路径'
      })
    }

    if (!targetPath) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: '缺少目标路径'
      })
    }

    // 验证所有路径
    for (const source of sources) {
      if (!isValidPath(source)) {
        return res.status(400).json({
          success: false,
          status: 'error',
          message: `无效的源路径: ${source}`
        })
      }
    }

    if (!isValidPath(targetPath)) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: '无效的目标路径'
      })
    }

    // 修复Windows路径格式
    const fixedSources = sources.map(source => fixWindowsPath(source))
    const fixedTargetPath = fixWindowsPath(targetPath)

    // 验证源文件存在
    for (const source of fixedSources) {
      try {
        await fs.access(source)
      } catch (error) {
        return res.status(400).json({
          success: false,
          status: 'error',
          message: `源文件不存在: ${source}`
        })
      }
    }

    // 确保目标目录存在
    await fs.mkdir(fixedTargetPath, { recursive: true })

    // 创建移动任务
    const taskId = taskManager.createTask('move', {
      sourcePaths: fixedSources,
      targetPath: fixedTargetPath,
      operation: 'move'
    })

    // 异步执行文件移动
    setImmediate(() => {
      executeFileOperation(taskId)
    })

    res.json({
      success: true,
      status: 'success',
      message: '移动任务已创建',
      taskId
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 搜索文件
router.get('/search', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { 
      path: searchPath = '/home',
      query,
      type = 'all',
      case_sensitive = false,
      max_results = 100
    } = req.query
    
    if (!query) {
      return res.status(400).json({
        status: 'error',
        message: '搜索关键词不能为空'
      })
    }

    if (!isValidPath(searchPath as string)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedSearchPath = fixWindowsPath(searchPath as string)

    const results = await searchFiles(
      fixedSearchPath,
      query as string,
      type as string,
      case_sensitive === 'true',
      parseInt(max_results as string)
    )
    
    res.json({
      status: 'success',
      results,
      total_found: results.length,
      truncated: results.length >= parseInt(max_results as string)
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 下载文件
router.get('/download', authenticateTokenFlexible, async (req: Request, res: Response) => {
  try {
    const { path: filePath, withProgress } = req.query
    
    if (!isValidPath(filePath as string)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 修复Windows路径格式
    const fixedFilePath = fixWindowsPath(filePath as string)

    const stats = await fs.stat(fixedFilePath)
    if (!stats.isFile()) {
      return res.status(400).json({
        status: 'error',
        message: '指定路径不是文件'
      })
    }

    const fileName = path.basename(fixedFilePath)
    
    // 如果请求进度跟踪，创建下载任务
    if (withProgress === 'true') {
      const taskId = taskManager.createTask('download', {
        filePath: fixedFilePath,
        fileName,
        fileSize: stats.size
      })
      
      // 返回任务ID，前端可以通过任务ID跟踪进度
      return res.json({
        status: 'success',
        taskId,
        message: '下载任务已创建'
      })
    }
    
    // 处理中文文件名的下载头
    // 使用 RFC 5987 标准编码中文文件名
    const encodedFileName = encodeURIComponent(fileName)
    const asciiFileName = fileName.replace(/[^\x00-\x7F]/g, '_') // 替换非ASCII字符为下划线作为fallback
    
    res.setHeader('Content-Disposition', 
      `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', stats.size.toString())
    
    const fileStream = createReadStream(fixedFilePath)
    fileStream.pipe(res)
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 上传文件
router.post('/upload', authenticateToken, upload.array('files'), async (req: Request, res: Response) => {
  console.log('Upload request received:')
  console.log('Body:', req.body)
  console.log('Files:', req.files)
  console.log('Files length:', req.files?.length)
  
  try {
    const { targetPath } = req.body
    const files = req.files as Express.Multer.File[]

    if (!targetPath) {
      console.log('Error: Invalid target path')
      return res.status(400).json({ success: false, message: 'Invalid target path' })
    }

    if (!files || files.length === 0) {
      console.log('Error: No files uploaded')
      return res.status(400).json({ success: false, message: 'No files uploaded' })
    }

    // 修复Windows路径格式
    const fixedTargetPath = fixWindowsPath(targetPath)
    console.log('Original target path:', targetPath)
    console.log('Fixed target path:', fixedTargetPath)
    
    // 处理Windows路径格式，确保使用绝对路径
    let fullTargetPath: string
    if (path.isAbsolute(fixedTargetPath)) {
      fullTargetPath = fixedTargetPath
    } else {
      // 如果是相对路径，转换为绝对路径（基于当前工作目录）
      fullTargetPath = path.resolve(process.cwd(), fixedTargetPath.replace(/^\//, ''))
    }
    
    console.log('Resolved target path:', fullTargetPath)

    // 确保目标目录存在
    await fs.mkdir(fullTargetPath, { recursive: true })

    // 移动文件到目标目录
    const results = []
    for (const file of files) {
      try {
        // 使用改进的文件名处理函数
        let originalName = fixChineseFilename(file.originalname)
        
        console.log(`Processing file: ${file.originalname} -> ${originalName}`)
        
        // 如果文件名仍然不安全，生成安全的文件名
        if (!isSafeFilename(originalName)) {
          const timestamp = Date.now()
          const ext = path.extname(file.originalname) || '.tmp'
          originalName = `upload-${timestamp}${ext}`
          console.log(`Using fallback filename: ${originalName}`)
        }
        
        // 检查目标文件是否已存在，如果存在则添加序号
        let finalFileName = originalName
        let counter = 1
        while (await fs.access(path.join(fullTargetPath, finalFileName)).then(() => true).catch(() => false)) {
          const ext = path.extname(originalName)
          const nameWithoutExt = path.basename(originalName, ext)
          finalFileName = `${nameWithoutExt}(${counter})${ext}`
          counter++
        }
        
        const targetFilePath = path.join(fullTargetPath, finalFileName)
        console.log(`Moving file from ${file.path} to ${targetFilePath}`)
        
        // 使用diskStorage时，文件已经在临时目录中，需要移动到目标目录
        try {
          await fs.rename(file.path, targetFilePath)
        } catch (renameError: any) {
          // 如果是跨设备链接错误，使用复制+删除的方式
          if (renameError.code === 'EXDEV') {
            console.log(`Cross-device rename failed, using copy+unlink for ${file.originalname}`)
            await fs.copyFile(file.path, targetFilePath)
            await fs.unlink(file.path)
          } else {
            throw renameError
          }
        }
        results.push({ name: finalFileName, success: true })
      } catch (error: any) {
        console.error(`Failed to move file ${file.originalname}:`, error)
        results.push({ name: file.originalname, success: false, error: error.message })
        
        // 清理已上传的文件
        try {
          const fileExists = await fs.stat(file.path).then(() => true).catch(() => false)
          if (fileExists) {
            await fs.unlink(file.path)
          }
        } catch (unlinkError) {
          console.error(`Failed to cleanup file ${file.path}:`, unlinkError)
        }
      }
    }

    res.json({
      success: true,
      message: `Successfully uploaded ${results.filter(r => r.success).length} of ${files.length} files`,
      data: results
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    res.status(500).json({ success: false, message: 'Upload failed', error: error.message })
  }
})

// 压缩文件夹
router.post('/compress', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { 
      sourcePaths, 
      targetPath, 
      archiveName, 
      format = 'zip', 
      compressionLevel = 6 
    } = req.body
    
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: '源路径不能为空'
      })
    }

    // 修复Windows路径格式
    const fixedSourcePaths = sourcePaths.map(sourcePath => fixWindowsPath(sourcePath))
    const fixedTargetPath = fixWindowsPath(targetPath)

    for (const sourcePath of fixedSourcePaths) {
      if (!isValidPath(sourcePath)) {
        return res.status(400).json({
          status: 'error',
          message: `无效的源路径: ${sourcePath}`
        })
      }
    }

    if (!isValidPath(fixedTargetPath)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的目标路径'
      })
    }

    const archivePath = path.join(fixedTargetPath, archiveName)
    
    // 创建异步任务
    const taskId = taskManager.createTask('compress', {
      sourcePaths: fixedSourcePaths,
      archivePath,
      format,
      compressionLevel
    })
    
    // 异步执行压缩
    compressionWorker.compressFiles(taskId, fixedSourcePaths, archivePath, format, compressionLevel)
      .catch(error => {
        console.error('压缩任务失败:', error)
      })
    
    res.json({
      status: 'success',
      message: '解压/压缩命令已下发',
      taskId,
      archivePath
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 解压文件
router.post('/extract', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { archivePath, targetPath } = req.body
    
    // 修复Windows路径格式
    const fixedArchivePath = fixWindowsPath(archivePath)
    const fixedTargetPath = fixWindowsPath(targetPath)
    
    if (!isValidPath(fixedArchivePath) || !isValidPath(fixedTargetPath)) {
      return res.status(400).json({
        status: 'error',
        message: '无效的路径'
      })
    }

    // 创建异步任务
    const taskId = taskManager.createTask('extract', {
      archivePath: fixedArchivePath,
      targetPath: fixedTargetPath
    })
    
    // 异步执行解压
    compressionWorker.extractArchive(taskId, fixedArchivePath, fixedTargetPath)
      .catch(error => {
        console.error('解压任务失败:', error)
      })
    
    res.json({
      status: 'success',
      message: '解压/压缩命令已下发',
      taskId
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 辅助函数
async function copyDirectory(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true })
  const items = await fs.readdir(src)
  
  for (const item of items) {
    const srcPath = path.join(src, item)
    const destPath = path.join(dest, item)
    const stats = await fs.stat(srcPath)
    
    if (stats.isDirectory()) {
      await copyDirectory(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

async function searchFiles(
  searchPath: string, 
  query: string, 
  type: string, 
  caseSensitive: boolean, 
  maxResults: number
): Promise<any[]> {
  const results: any[] = []
  const searchQuery = caseSensitive ? query : query.toLowerCase()
  
  async function searchRecursive(currentPath: string) {
    if (results.length >= maxResults) return
    
    try {
      const items = await fs.readdir(currentPath)
      
      for (const item of items) {
        if (results.length >= maxResults) break
        
        const itemPath = path.join(currentPath, item)
        const stats = await fs.stat(itemPath)
        const itemName = caseSensitive ? item : item.toLowerCase()
        
        if (itemName.includes(searchQuery)) {
          if (type === 'all' || 
              (type === 'file' && stats.isFile()) || 
              (type === 'directory' && stats.isDirectory())) {
            results.push({
              name: item,
              path: itemPath,
              type: stats.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              modified: stats.mtime.toISOString(),
              parent_dir: currentPath
            })
          }
        }
        
        if (stats.isDirectory()) {
          await searchRecursive(itemPath)
        }
      }
    } catch (error) {
      // 跳过无法访问的目录
    }
  }
  
  await searchRecursive(searchPath)
  return results
}

async function compressFiles(
  sourcePaths: string[], 
  archivePath: string, 
  format: string, 
  compressionLevel: number
) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const output = createWriteStream(archivePath)
      const archive = archiver(format as any, {
        zlib: { level: compressionLevel }
      })
      
      output.on('close', () => resolve())
      archive.on('error', (err) => reject(err))
      
      archive.pipe(output)
      
      for (const sourcePath of sourcePaths) {
        const stats = await fs.stat(sourcePath)
        const name = path.basename(sourcePath)
        
        if (stats.isDirectory()) {
          archive.directory(sourcePath, name)
        } else {
          archive.file(sourcePath, { name })
        }
      }
      
      archive.finalize()
    } catch (error) {
      reject(error)
    }
  })
}

async function extractArchive(archivePath: string, targetPath: string) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const ext = path.extname(archivePath).toLowerCase()
      const fileName = path.basename(archivePath).toLowerCase()
      
      // 确保目标目录存在
      await fs.mkdir(targetPath, { recursive: true })
      
      if (ext === '.zip') {
        createReadStream(archivePath)
          .pipe(unzipper.Extract({ path: targetPath }))
          .on('close', () => resolve())
          .on('error', (err) => reject(err))
      } else if (ext === '.tar') {
        await tar.extract({
          file: archivePath,
          cwd: targetPath
        })
        resolve()
      } else if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
        await tar.extract({
          file: archivePath,
          cwd: targetPath,
          gzip: true
        } as any)
        resolve()
      } else if (fileName.endsWith('.tar.xz') || fileName.endsWith('.txz')) {
        // 对于tar.xz，先解压xz再解压tar
        const tempTarPath = archivePath.replace(/\.(tar\.xz|txz)$/, '.tar')
        
        try {
          // 解压xz到临时tar文件
          await new Promise<void>((resolveXz, rejectXz) => {
            const readStream = createReadStream(archivePath)
            const writeStream = createWriteStream(tempTarPath)
            const decompressStream = zlib.createGunzip() // 注意：这里使用gzip，实际应该是xz
            
            readStream
              .pipe(decompressStream)
              .pipe(writeStream)
              .on('finish', resolveXz)
              .on('error', rejectXz)
          })
          
          // 解压tar文件
          await tar.extract({
            file: tempTarPath,
            cwd: targetPath
          })
          
          // 删除临时tar文件
          await fs.unlink(tempTarPath)
          resolve()
        } catch (error) {
          // 清理临时文件
          try {
            await fs.unlink(tempTarPath)
          } catch {}
          reject(error)
        }
      } else {
        // 对于其他格式，返回不支持的错误
        reject(new Error(`不支持的压缩格式: ${ext}。支持的格式: .zip, .tar, .tar.gz, .tar.xz`))
      }
    } catch (error) {
      reject(error)
    }
  })
}

// ==================== 插件文件操作API ====================

// 读取文件内容（POST方法，用于插件API）
router.post('/read', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { filePath, encoding = 'utf-8' } = req.body
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '缺少文件路径参数'
      })
    }
    
    // 将相对路径转换为绝对路径（相对于data目录）
    const dataDir = path.join(process.cwd(), 'data')
    const fullPath = path.resolve(dataDir, filePath)
    
    // 安全检查：确保文件在data目录内
    if (!fullPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：文件路径超出允许范围'
      })
    }
    
    const content = await fs.readFile(fullPath, encoding)
    res.json({
      success: true,
      data: { content, encoding, filePath }
    })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      })
    }
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 写入文件内容
router.post('/write', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { filePath, content, encoding = 'utf-8' } = req.body
    
    if (!filePath || content === undefined) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }
    
    const dataDir = path.join(process.cwd(), 'data')
    const fullPath = path.resolve(dataDir, filePath)
    
    if (!fullPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：文件路径超出允许范围'
      })
    }
    
    // 确保目录存在
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    
    await fs.writeFile(fullPath, content, encoding)
    res.json({
      success: true,
      message: '文件写入成功',
      data: { filePath, size: Buffer.byteLength(content, encoding) }
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 删除文件
router.delete('/delete', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '缺少文件路径参数'
      })
    }
    
    const dataDir = path.join(process.cwd(), 'data')
    const fullPath = path.resolve(dataDir, filePath)
    
    if (!fullPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：文件路径超出允许范围'
      })
    }
    
    await fs.unlink(fullPath)
    res.json({
      success: true,
      message: '文件删除成功',
      data: { filePath }
    })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      })
    }
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 创建目录
router.post('/mkdir', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { dirPath, recursive = true } = req.body
    
    if (!dirPath) {
      return res.status(400).json({
        success: false,
        message: '缺少目录路径参数'
      })
    }
    
    const fullPath = path.resolve(dirPath)

    try {
      const stats = await fs.stat(fullPath)
      if (stats.isDirectory()) {
        // 目录已存在，操作成功
        return res.json({
          success: true,
          message: '目录已存在',
          data: { dirPath: fullPath }
        })
      } else {
        // 路径存在但不是目录（即文件）
        return res.status(409).json({
          success: false,
          message: '同名文件已存在，无法创建目录'
        })
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 路径不存在，可以创建
        await fs.mkdir(fullPath, { recursive })
        return res.json({
          success: true,
          message: '目录创建成功',
          data: { dirPath: fullPath }
        })
      }
      // 其他 fs.stat 错误
      throw error
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 删除目录
router.delete('/rmdir', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { dirPath, recursive = false } = req.body
    
    if (!dirPath) {
      return res.status(400).json({
        success: false,
        message: '缺少目录路径参数'
      })
    }
    
    const dataDir = path.join(process.cwd(), 'data')
    const fullPath = path.resolve(dataDir, dirPath)
    
    if (!fullPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：目录路径超出允许范围'
      })
    }
    
    if (recursive) {
      await fs.rm(fullPath, { recursive: true, force: true })
    } else {
      await fs.rmdir(fullPath)
    }
    
    res.json({
      success: true,
      message: '目录删除成功',
      data: { dirPath }
    })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        message: '目录不存在'
      })
    }
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 列出目录内容（POST方法，用于插件API）
router.post('/list', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { dirPath = '', includeHidden = false } = req.body
    
    const dataDir = path.join(process.cwd(), 'data')
    const fullPath = dirPath ? path.resolve(dataDir, dirPath) : dataDir
    
    if (!fullPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：目录路径超出允许范围'
      })
    }
    
    const stats = await fs.stat(fullPath)
    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        message: '指定路径不是目录'
      })
    }
    
    const items = await fs.readdir(fullPath)
    const files = []
    
    for (const item of items) {
      // 跳过隐藏文件（除非明确要求包含）
      if (!includeHidden && item.startsWith('.')) {
        continue
      }
      
      const itemPath = path.join(fullPath, item)
      try {
        const itemStats = await fs.stat(itemPath)
        files.push({
          name: item,
          path: path.relative(dataDir, itemPath),
          type: itemStats.isDirectory() ? 'directory' : 'file',
          size: itemStats.size,
          modified: itemStats.mtime.toISOString(),
          created: itemStats.birthtime.toISOString()
        })
      } catch (error) {
        // 跳过无法访问的文件
        continue
      }
    }
    
    res.json({
      success: true,
      data: files
    })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        message: '目录不存在'
      })
    }
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 获取文件或目录信息
router.post('/info', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: itemPath } = req.body
    
    if (!itemPath) {
      return res.status(400).json({
        success: false,
        message: '缺少路径参数'
      })
    }
    
    const dataDir = path.join(process.cwd(), 'data')
    const fullPath = path.resolve(dataDir, itemPath)
    
    if (!fullPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：路径超出允许范围'
      })
    }
    
    const stats = await fs.stat(fullPath)
    const info = {
      name: path.basename(fullPath),
      path: path.relative(dataDir, fullPath),
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
      accessed: stats.atime.toISOString(),
      permissions: stats.mode.toString(8),
      isReadable: true,
      isWritable: true
    }
    
    res.json({
      success: true,
      data: info
    })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        message: '文件或目录不存在'
      })
    }
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 检查文件或目录是否存在
router.post('/exists', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { path: itemPath } = req.body
    
    if (!itemPath) {
      return res.status(400).json({
        success: false,
        message: '缺少路径参数'
      })
    }
    
    const dataDir = path.join(process.cwd(), 'data')
    const fullPath = path.resolve(dataDir, itemPath)
    
    if (!fullPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：路径超出允许范围'
      })
    }
    
    try {
      const stats = await fs.stat(fullPath)
      res.json({
        success: true,
        data: {
          exists: true,
          type: stats.isDirectory() ? 'directory' : 'file'
        }
      })
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.json({
          success: true,
          data: {
            exists: false
          }
        })
      } else {
        throw error
      }
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// 搜索文件
router.post('/search', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { pattern, searchPath = '', recursive = true } = req.body
    
    if (!pattern) {
      return res.status(400).json({
        success: false,
        message: '缺少搜索模式参数'
      })
    }
    
    const dataDir = path.join(process.cwd(), 'data')
    const fullSearchPath = searchPath ? path.resolve(dataDir, searchPath) : dataDir
    
    if (!fullSearchPath.startsWith(dataDir)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝：搜索路径超出允许范围'
      })
    }
    
    const results: any[] = []
    
    async function searchRecursive(currentPath: string) {
      try {
        const items = await fs.readdir(currentPath)
        
        for (const item of items) {
          const itemPath = path.join(currentPath, item)
          const stats = await fs.stat(itemPath)
          
          // 简单的通配符匹配
          const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i')
          if (regex.test(item)) {
            results.push({
              name: item,
              path: path.relative(dataDir, itemPath),
              type: stats.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              modified: stats.mtime.toISOString()
            })
          }
          
          if (recursive && stats.isDirectory()) {
            await searchRecursive(itemPath)
          }
        }
      } catch (error) {
        // 跳过无法访问的目录
      }
    }
    
    await searchRecursive(fullSearchPath)
    
    res.json({
      success: true,
      data: results
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})

// ==================== 任务管理API ====================

// 获取任务状态
router.get('/tasks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const tasks = taskManager.getAllTasks()
    res.json({
      status: 'success',
      data: tasks
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 获取活动任务
router.get('/tasks/active', authenticateToken, async (req: Request, res: Response) => {
  try {
    const tasks = taskManager.getActiveTasks()
    res.json({
      status: 'success',
      data: tasks
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 获取单个任务状态
router.get('/tasks/:taskId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params
    const task = taskManager.getTask(taskId)
    
    if (!task) {
      return res.status(404).json({
        status: 'error',
        message: '任务不存在'
      })
    }
    
    res.json({
      status: 'success',
      data: task
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 删除任务
router.delete('/tasks/:taskId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params
    const task = taskManager.getTask(taskId)
    
    if (!task) {
      return res.status(404).json({
        status: 'error',
        message: '任务不存在'
      })
    }
    
    if (task.status === 'running') {
      return res.status(400).json({
        status: 'error',
        message: '无法删除正在运行的任务'
      })
    }
    
    taskManager.deleteTask(taskId)
    
    res.json({
      status: 'success',
      message: '任务已删除'
    })
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 执行下载任务
router.get('/download-task/:taskId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params
    const task = taskManager.getTask(taskId)
    
    if (!task) {
      return res.status(404).json({
        status: 'error',
        message: '任务不存在'
      })
    }
    
    if (task.type !== 'download') {
      return res.status(400).json({
        status: 'error',
        message: '任务类型不正确'
      })
    }
    
    const { filePath, fileName, fileSize } = task.data
    
    // 更新任务状态为运行中
    taskManager.updateTask(taskId, {
      status: 'running',
      message: '开始下载'
    })
    
    // 处理中文文件名的下载头
    const encodedFileName = encodeURIComponent(fileName)
    const asciiFileName = fileName.replace(/[^\x00-\x7F]/g, '_')
    
    res.setHeader('Content-Disposition', 
      `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', fileSize.toString())
    
    const fileStream = createReadStream(filePath)
    let downloadedBytes = 0
    
    // 监听数据传输进度
    fileStream.on('data', (chunk) => {
      downloadedBytes += chunk.length
      const progress = Math.round((downloadedBytes / fileSize) * 100)
      
      // 更新任务进度
      taskManager.updateTask(taskId, {
        progress,
        message: `下载中... ${progress}%`
      })
    })
    
    // 下载完成
    fileStream.on('end', () => {
      taskManager.updateTask(taskId, {
        status: 'completed',
        progress: 100,
        message: '下载完成'
      })
    })
    
    // 下载出错
    fileStream.on('error', (error) => {
      taskManager.updateTask(taskId, {
        status: 'failed',
        message: `下载失败: ${error.message}`
      })
    })
    
    // 客户端断开连接
    res.on('close', () => {
      if (!res.headersSent) {
        taskManager.updateTask(taskId, {
          status: 'failed',
          message: '下载被中断'
        })
      }
    })
    
    fileStream.pipe(res)
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message
    })
  }
})

// 获取系统盘符
router.get('/drives', authenticateToken, async (req: Request, res: Response) => {
  try {
    const drives: Array<{ label: string; value: string; type: string }> = []
    
    if (process.platform === 'win32') {
      // Windows系统 - 获取所有盘符
      try {
        const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption,description,drivetype')
        const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('Caption'))
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 5) {
            const caption = parts[0] // 盘符 (如 C:)
            const driveType = parseInt(parts[2]) // 驱动器类型
            
            if (caption && caption.match(/^[A-Z]:$/)) {
              let type = 'unknown'
              switch (driveType) {
                case 2: type = 'removable'; break  // 可移动磁盘
                case 3: type = 'fixed'; break      // 固定磁盘
                case 4: type = 'network'; break    // 网络磁盘
                case 5: type = 'cdrom'; break      // 光盘
                default: type = 'unknown'; break
              }
              
              drives.push({
                label: `${caption}\\`,
                value: `${caption}\\`,
                type: type
              })
            }
          }
        }
      } catch (error) {
        // 如果wmic命令失败，使用备用方法
        console.warn('wmic命令失败，使用备用方法获取盘符:', error)
        
        // 尝试常见的盘符
        const commonDrives = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:', 'K:', 'L:', 'M:', 'N:', 'O:', 'P:', 'Q:', 'R:', 'S:', 'T:', 'U:', 'V:', 'W:', 'X:', 'Y:', 'Z:']
        
        for (const drive of commonDrives) {
          try {
            const drivePath = `${drive}\\`
            await fs.access(drivePath)
            drives.push({
              label: drivePath,
              value: drivePath,
              type: 'fixed'
            })
          } catch (error) {
            // 盘符不存在，跳过
          }
        }
      }
    } else {
      // Linux/Unix系统 - 只显示根目录
      drives.push({
        label: '根目录 (/)',
        value: '/',
        type: 'fixed'
      })
    }
    
    // 如果没有找到任何盘符，至少返回当前工作目录
    if (drives.length === 0) {
      const cwd = process.cwd()
      const rootPath = process.platform === 'win32' ? path.parse(cwd).root : '/'
      drives.push({
        label: process.platform === 'win32' ? rootPath : '根目录 (/)',
        value: rootPath,
        type: 'fixed'
      })
    }
    
    res.json({
      status: 'success',
      data: drives
    })
  } catch (error: any) {
    console.error('获取盘符失败:', error)
    res.status(500).json({
      status: 'error',
      message: error.message || '获取盘符失败'
    })
  }
})

export default router