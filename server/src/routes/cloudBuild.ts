import { Router } from 'express'
import axios from 'axios'
import { authenticateToken } from '../middleware/auth.js'
import path from 'path'
import fs from 'fs-extra'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { zipToolsManager } from '../utils/zipToolsManager.js'

const router = Router()

// MSL云构建服务器地址
const MSL_BUILD_SERVER = 'https://download.mc.xiaozhuhouses.asia:4433'
// const MSL_BUILD_SERVER = 'http://127.0.0.1:3000'

// 获取核心列表
router.get('/:type/cores', authenticateToken, async (req, res) => {
  try {
    const { type } = req.params
    
    const response = await axios.get(`${MSL_BUILD_SERVER}/api/${type}/cores`, {
      timeout: 30000 // 30秒超时
    })

    res.json(response.data)
  } catch (error: any) {
    console.error('获取云构建核心列表失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '无法连接到MSL云构建服务',
      error: error.message
    })
  }
})

// 创建构建任务
router.post('/build', authenticateToken, async (req, res) => {
  try {
    const { coreName, version, type = 'msl_Official' } = req.body

    if (!coreName || !version) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：coreName 和 version'
      })
    }

    const response = await axios.post(`${MSL_BUILD_SERVER}/api/build`, {
      coreName,
      version,
      type
    }, {
      timeout: 60000 // 60秒超时
    })

    res.json(response.data)
  } catch (error: any) {
    console.error('创建云构建任务失败:', error.message)
    
    // 如果是429错误（超限），保留原始状态码
    if (error.response?.status === 429) {
      return res.status(429).json(error.response.data)
    }

    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '创建构建任务失败',
      error: error.message
    })
  }
})

// 查询构建任务状态
router.get('/build/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params

    const response = await axios.get(`${MSL_BUILD_SERVER}/api/build/${taskId}`, {
      timeout: 30000
    })

    res.json(response.data)
  } catch (error: any) {
    console.error('查询构建任务状态失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '查询构建任务状态失败',
      error: error.message
    })
  }
})

// 下载并解压到目标目录
router.post('/download', authenticateToken, async (req, res) => {
  try {
    const { downloadUrl, fileName, coreName, version, targetPath } = req.body

    if (!targetPath) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：targetPath'
      })
    }

    let finalDownloadUrl = downloadUrl

    // 如果提供了 fileName 而不是 downloadUrl，需要先生成下载链接
    if (!downloadUrl && fileName) {
      const linkResponse = await axios.post(`${MSL_BUILD_SERVER}/api/download`, {
        fileName,
        coreName,
        version
      }, {
        timeout: 30000
      })

      if (!linkResponse.data.success || !linkResponse.data.data.downloadUrl) {
        throw new Error('生成下载链接失败')
      }

      finalDownloadUrl = linkResponse.data.data.downloadUrl
    }

    if (!finalDownloadUrl) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：downloadUrl 或 fileName'
      })
    }

    // 1. 使用 downloadUrl
    const downloadFileName = fileName || `${coreName}-${version}.zip`

    // 2. 确保目标目录存在
    await fs.ensureDir(targetPath)

    // 3. 下载文件到临时目录
    const tempDir = path.join(process.cwd(), 'server', 'temp')
    await fs.ensureDir(tempDir)
    const tempFilePath = path.join(tempDir, downloadFileName)

    const downloadResponse = await axios({
      method: 'get',
      url: `${MSL_BUILD_SERVER}${finalDownloadUrl}`,
      responseType: 'stream',
      timeout: 300000 // 5分钟
    })

    // 使用stream写入文件
    await pipeline(
      downloadResponse.data,
      createWriteStream(tempFilePath)
    )

    // 4. 使用 Zip-Tools 解压文件
    await zipToolsManager.extractZip(tempFilePath, targetPath)

    // 5. 删除临时文件
    await fs.remove(tempFilePath)

    // 6. 检测启动脚本
    const files = await fs.readdir(targetPath)
    let startCommand = ''
    const isWindows = process.platform === 'win32'

    // 根据平台优先选择对应的启动脚本
    if (isWindows) {
      // Windows平台：优先 run.bat > start.bat
      const runBat = files.find(file => file.toLowerCase() === 'run.bat')
      const startBat = files.find(file => file.toLowerCase() === 'start.bat')

      if (runBat) {
        startCommand = `.\\${runBat}`
      } else if (startBat) {
        startCommand = `.\\${startBat}`
      }
    } else {
      // Linux/Mac平台：优先 run.sh > start.sh
      const runSh = files.find(file => file.toLowerCase() === 'run.sh')
      const startSh = files.find(file => file.toLowerCase() === 'start.sh')

      if (runSh) {
        startCommand = `bash ${runSh}`
      } else if (startSh) {
        startCommand = `bash ${startSh}`
      }
    }

    res.json({
      success: true,
      message: '下载并解压成功',
      data: {
        targetPath,
        startCommand,
        files: files.length
      }
    })
  } catch (error: any) {
    console.error('下载并解压失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '下载并解压失败',
      error: error.message
    })
  }
})

// 下载文件（代理）
router.get('/download/:linkId', authenticateToken, async (req, res) => {
  try {
    const { linkId } = req.params

    const response = await axios.get(`${MSL_BUILD_SERVER}/api/download/${linkId}`, {
      responseType: 'stream',
      timeout: 300000 // 5分钟超时，因为可能是大文件
    })

    // 设置响应头
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/zip')
    res.setHeader('Content-Disposition', response.headers['content-disposition'] || 'attachment')
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length'])
    }

    // 将流传输给客户端
    response.data.pipe(res)
  } catch (error: any) {
    console.error('下载文件失败:', error.message)
    
    if (!res.headersSent) {
      res.status(error.response?.status || 500).json({
        success: false,
        message: error.response?.data?.message || '下载文件失败',
        error: error.message
      })
    }
  }
})

// 获取统计数据
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const response = await axios.get(`${MSL_BUILD_SERVER}/api/stats`, {
      timeout: 30000
    })

    res.json(response.data)
  } catch (error: any) {
    console.error('获取云构建统计数据失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '获取统计数据失败',
      error: error.message
    })
  }
})

// 获取 Modrinth 缓存列表
router.get('/cache/modrinth', authenticateToken, async (req, res) => {
  try {
    const response = await axios.get(`${MSL_BUILD_SERVER}/api/cache/modrinth`, {
      timeout: 30000
    })

    res.json(response.data)
  } catch (error: any) {
    console.error('获取 Modrinth 缓存列表失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '获取 Modrinth 缓存列表失败',
      error: error.message
    })
  }
})

export default router

