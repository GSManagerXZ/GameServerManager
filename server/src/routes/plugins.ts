import express from 'express'
import path from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { authenticateToken, requireAdmin } from '../middleware/auth.js'
import type { PluginManager } from '../modules/plugin/PluginManager.js'

const router = express.Router()

let pluginManager: PluginManager

export function setPluginManager(manager: PluginManager) {
  pluginManager = manager
}

// 获取所有插件列表
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const plugins = pluginManager.getPlugins()
    res.json({
      success: true,
      data: plugins
    })
  } catch (error) {
    console.error('获取插件列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取插件列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取单个插件信息
router.get('/:name', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params
    const plugin = pluginManager.getPlugin(name)
    
    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      data: plugin
    })
  } catch (error) {
    console.error('获取插件信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取插件信息失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 启用插件
router.post('/:name/enable', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params
    const success = await pluginManager.enablePlugin(name)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      message: '插件已启用'
    })
  } catch (error) {
    console.error('启用插件失败:', error)
    res.status(500).json({
      success: false,
      message: '启用插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 禁用插件
router.post('/:name/disable', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params
    const success = await pluginManager.disablePlugin(name)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      message: '插件已禁用'
    })
  } catch (error) {
    console.error('禁用插件失败:', error)
    res.status(500).json({
      success: false,
      message: '禁用插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 创建新插件
router.post('/create', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, displayName, description, version, author, category, icon } = req.body
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: '插件名称不能为空'
      })
    }

    // 验证插件名称格式（只允许字母、数字、下划线、连字符）
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({
        success: false,
        message: '插件名称只能包含字母、数字、下划线和连字符'
      })
    }

    const success = await pluginManager.createPlugin(name, {
      displayName,
      description,
      version,
      author,
      category,
      icon
    })
    
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '插件已存在或创建失败'
      })
    }

    res.json({
      success: true,
      message: '插件创建成功'
    })
  } catch (error) {
    console.error('创建插件失败:', error)
    res.status(500).json({
      success: false,
      message: '创建插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 删除插件
router.delete('/:name', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params
    const success = await pluginManager.deletePlugin(name)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      message: '插件删除成功'
    })
  } catch (error) {
    console.error('删除插件失败:', error)
    res.status(500).json({
      success: false,
      message: '删除插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 已启用插件的界面资源可供 iframe 直接加载；JSON/TXT 数据文件仍要求认证。
router.get('/:name/files/*', (req, res, next) => {
  const filePath = String(req.params[0] || 'index.html')
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.json' || extension === '.txt') {
    return authenticateToken(req, res, next)
  }
  next()
}, async (req, res) => {
  await handleFileRequest(req, res)
})

// 处理文件请求的通用函数
async function handleFileRequest(req: any, res: any) {
  try {
    const { name } = req.params
    const filePath = String(req.params[0] || 'index.html').replace(/\\/g, '/')
    
    const plugin = pluginManager.getPlugin(name)
    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }
    if (!plugin.enabled || !plugin.hasWebInterface) {
      return res.status(403).json({
        success: false,
        message: '插件未启用或没有 Web 界面'
      })
    }
    if (filePath.includes('\0') || path.isAbsolute(filePath) || filePath.split('/').some(segment => segment === '..' || segment.startsWith('.'))) {
      return res.status(403).json({ success: false, message: '访问被拒绝' })
    }

    const pluginPath = path.resolve(pluginManager.getPluginPath(name))
    const fullPath = path.resolve(pluginPath, filePath)
    
    // 安全检查：确保文件路径在插件目录内
    const relativePath = path.relative(pluginPath, fullPath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝'
      })
    }

    try {
      const [realPluginPath, realFullPath] = await Promise.all([
        fs.realpath(pluginPath),
        fs.realpath(fullPath)
      ])
      const realRelativePath = path.relative(realPluginPath, realFullPath)
      if (!realRelativePath || realRelativePath.startsWith('..') || path.isAbsolute(realRelativePath)) {
        return res.status(403).json({ success: false, message: '访问被拒绝' })
      }
      const stats = await fs.stat(realFullPath)
      if (!stats.isFile()) {
        return res.status(404).json({
          success: false,
          message: '文件不存在'
        })
      }

      // 根据文件扩展名设置Content-Type
      const ext = path.extname(filePath).toLowerCase()
      const contentTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.avif': 'image/avif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.eot': 'application/vnd.ms-fontobject',
        '.wasm': 'application/wasm',
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm'
      }
      const contentType = contentTypes[ext]
      if (!contentType) return res.status(415).json({ success: false, message: '不支持的插件资源类型' })
      res.setHeader('Content-Type', contentType)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
      res.setHeader('Cache-Control', ext === '.html' ? 'no-store' : 'private, max-age=300')
      if (ext === '.html') {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; form-action 'none'; object-src 'none'; base-uri 'none'"
        )
      } else if (ext === '.svg') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      }
      res.send(await fs.readFile(realFullPath))
    } catch (fileError) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      })
    }
  } catch (error) {
    console.error('获取插件文件失败:', error)
    res.status(500).json({
      success: false,
      message: '获取插件文件失败'
    })
  }
}

// 更新插件文件内容
router.put('/:name/files/*', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params
    const filePath = String(req.params[0] || '').replace(/\\/g, '/')
    const { content } = req.body
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '文件路径不能为空'
      })
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ success: false, message: '文件内容必须是字符串' })
    }
    if (Buffer.byteLength(content, 'utf-8') > 2 * 1024 * 1024) {
      return res.status(413).json({ success: false, message: '插件文件不能超过 2 MiB' })
    }
    if (filePath.includes('\0') || path.isAbsolute(filePath) || filePath.split('/').some(segment => !segment || segment === '..' || segment.startsWith('.'))) {
      return res.status(403).json({ success: false, message: '访问被拒绝' })
    }

    const plugin = pluginManager.getPlugin(name)
    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    const pluginPath = path.resolve(pluginManager.getPluginPath(name))
    const fullPath = path.resolve(pluginPath, filePath)
    
    // 安全检查：确保文件路径在插件目录内
    const relativePath = path.relative(pluginPath, fullPath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝'
      })
    }

    // 确保目录存在
    const dir = path.dirname(fullPath)
    await fs.mkdir(dir, { recursive: true })
    const [realPluginPath, realDirectoryPath] = await Promise.all([
      fs.realpath(pluginPath),
      fs.realpath(dir)
    ])
    const realDirectoryRelativePath = path.relative(realPluginPath, realDirectoryPath)
    if (realDirectoryRelativePath.startsWith('..') || path.isAbsolute(realDirectoryRelativePath)) {
      return res.status(403).json({ success: false, message: '访问被拒绝' })
    }

    // 先写入同目录临时文件，再原子替换目标，避免跟随目标位置的符号链接。
    const destinationPath = path.join(realDirectoryPath, path.basename(fullPath))
    const temporaryPath = path.join(realDirectoryPath, `.${path.basename(fullPath)}.${randomUUID()}.tmp`)
    const replacementBackup = path.join(realDirectoryPath, `.${path.basename(fullPath)}.${randomUUID()}.backup`)
    let preserveBackup = false
    try {
      await fs.writeFile(temporaryPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
      const existing = await fs.lstat(destinationPath).catch(() => undefined)
      if (existing?.isDirectory()) {
        return res.status(400).json({ success: false, message: '目标路径是目录' })
      }
      if (process.platform === 'win32' && existing) {
        await fs.rename(destinationPath, replacementBackup)
        try {
          await fs.rename(temporaryPath, destinationPath)
          await fs.rm(replacementBackup, { force: true })
        } catch (error) {
          try {
            await fs.rename(replacementBackup, destinationPath)
          } catch (rollbackError) {
            preserveBackup = true
            throw new Error(
              `替换插件文件失败，且无法恢复原文件；备份保留在 ${replacementBackup}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            )
          }
          throw error
        }
      } else {
        await fs.rename(temporaryPath, destinationPath)
      }
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      if (!preserveBackup) await fs.rm(replacementBackup, { force: true }).catch(() => undefined)
    }

    res.json({
      success: true,
      message: '文件保存成功'
    })
  } catch (error) {
    console.error('保存插件文件失败:', error)
    res.status(500).json({
      success: false,
      message: '保存插件文件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

export default router
