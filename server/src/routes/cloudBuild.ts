import { Router } from 'express'
import axios from 'axios'
import { authenticateToken } from '../middleware/auth.js'
import path from 'path'
import fs from 'fs-extra'
import AdmZip from 'adm-zip'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'

const router = Router()

// MSL云构建服务器地址
const MSL_BUILD_SERVER = 'https://download.mc.xiaozhuhouses.asia:4433'

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
    const { fileName, taskId, coreName, version, targetPath } = req.body

    if (!targetPath) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：targetPath'
      })
    }

    // 1. 生成下载链接
    const linkResponse = await axios.post(`${MSL_BUILD_SERVER}/api/download`, {
      fileName,
      taskId,
      coreName,
      version
    }, {
      timeout: 30000
    })

    if (!linkResponse.data.success || !linkResponse.data.data.downloadUrl) {
      throw new Error('生成下载链接失败')
    }

    const downloadUrl = linkResponse.data.data.downloadUrl
    const downloadFileName = linkResponse.data.data.fileName || `${coreName}-${version}.zip`

    // 2. 确保目标目录存在
    await fs.ensureDir(targetPath)

    // 3. 下载文件到临时目录
    const tempDir = path.join(process.cwd(), 'server', 'temp')
    await fs.ensureDir(tempDir)
    const tempFilePath = path.join(tempDir, downloadFileName)

    console.log(`正在下载文件到: ${tempFilePath}`)

    const downloadResponse = await axios({
      method: 'get',
      url: `${MSL_BUILD_SERVER}${downloadUrl}`,
      responseType: 'stream',
      timeout: 300000 // 5分钟
    })

    // 使用stream写入文件
    await pipeline(
      downloadResponse.data,
      createWriteStream(tempFilePath)
    )

    console.log(`文件下载完成，开始解压到: ${targetPath}`)

    // 4. 解压文件
    const zip = new AdmZip(tempFilePath)
    zip.extractAllTo(targetPath, true)

    console.log('文件解压完成')

    // 5. 删除临时文件
    await fs.remove(tempFilePath)

    // 6. 检测启动脚本
    const files = await fs.readdir(targetPath)
    let startCommand = ''
    const isWindows = process.platform === 'win32'
    
    // 检测是否有run文件
    const runFile = files.find(file => 
      file.toLowerCase().startsWith('run') && 
      (file.endsWith('.bat') || file.endsWith('.sh') || !file.includes('.'))
    )

    if (runFile) {
      // 如果存在run文件，优先使用
      if (isWindows) {
        startCommand = `.\\${runFile}`
      } else {
        startCommand = runFile.endsWith('.sh') ? `bash ${runFile}` : `./${runFile}`
      }
    } else {
      // 检测start文件
      const hasStartBat = files.includes('start.bat')
      const hasStartSh = files.includes('start.sh')
      
      if (hasStartBat && hasStartSh) {
        // 根据当前平台选择
        startCommand = isWindows ? '.\\start.bat' : 'bash start.sh'
      } else if (hasStartBat) {
        startCommand = '.\\start.bat'
      } else if (hasStartSh) {
        startCommand = 'bash start.sh'
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

export default router

