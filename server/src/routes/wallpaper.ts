import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { promises as fs } from 'fs'
import { authenticateToken } from '../middleware/auth.js'

const router = Router()

// 配置multer存储
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const baseDir = process.cwd()
    const possiblePaths = [
      path.join(baseDir, 'data', 'wallpapers'),
      path.join(baseDir, 'server', 'data', 'wallpapers'),
    ]

    let uploadPath = possiblePaths[0]
    
    // 尝试找到正确的路径
    for (const p of possiblePaths) {
      try {
        await fs.access(path.dirname(p))
        uploadPath = p
        break
      } catch (error) {
        // 继续尝试下一个路径
      }
    }

    // 确保目录存在
    try {
      await fs.mkdir(uploadPath, { recursive: true })
    } catch (error) {
      console.error('创建壁纸目录失败:', error)
    }

    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    const type = req.body.type || 'main' // main 或 login
    const ext = path.extname(file.originalname)
    const filename = `wallpaper-${type}-${Date.now()}${ext}`
    cb(null, filename)
  }
})

// 文件过滤器
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('只支持 JPG, PNG, GIF 和 WEBP 格式的图片'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  }
})

// 上传壁纸
router.post('/upload', authenticateToken, upload.single('wallpaper'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请选择要上传的图片'
      })
    }

    const type = req.body.type || 'main'
    const imageUrl = `/api/wallpaper/image/${req.file.filename}`

    res.json({
      success: true,
      message: '壁纸上传成功',
      data: {
        imageUrl,
        type,
        filename: req.file.filename
      }
    })
  } catch (error: any) {
    console.error('上传壁纸失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '上传壁纸失败'
    })
  }
})

// 获取壁纸图片
router.get('/image/:filename', async (req, res) => {
  try {
    const { filename } = req.params
    const baseDir = process.cwd()
    const possiblePaths = [
      path.join(baseDir, 'data', 'wallpapers', filename),
      path.join(baseDir, 'server', 'data', 'wallpapers', filename),
    ]

    let imagePath = ''
    for (const p of possiblePaths) {
      try {
        await fs.access(p)
        imagePath = p
        break
      } catch (error) {
        // 继续尝试下一个路径
      }
    }

    if (!imagePath) {
      return res.status(404).json({
        success: false,
        message: '壁纸文件不存在'
      })
    }

    res.sendFile(imagePath)
  } catch (error) {
    console.error('获取壁纸失败:', error)
    res.status(500).json({
      success: false,
      message: '获取壁纸失败'
    })
  }
})

// 删除壁纸
router.delete('/delete/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params
    const baseDir = process.cwd()
    const possiblePaths = [
      path.join(baseDir, 'data', 'wallpapers', filename),
      path.join(baseDir, 'server', 'data', 'wallpapers', filename),
    ]

    let imagePath = ''
    for (const p of possiblePaths) {
      try {
        await fs.access(p)
        imagePath = p
        break
      } catch (error) {
        // 继续尝试下一个路径
      }
    }

    if (imagePath) {
      await fs.unlink(imagePath)
    }

    res.json({
      success: true,
      message: '壁纸删除成功'
    })
  } catch (error) {
    console.error('删除壁纸失败:', error)
    res.status(500).json({
      success: false,
      message: '删除壁纸失败'
    })
  }
})

export default router

