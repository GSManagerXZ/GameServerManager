import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { backupManager } from '../modules/backup/BackupManager.js'
import logger from '../utils/logger.js'

const router = Router()

router.use(authenticateToken)

// 列出所有备份
router.get('/', async (req: Request, res: Response) => {
  try {
    const data = await backupManager.listBackups()
    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('获取备份列表失败:', error)
    res.status(500).json({ success: false, message: error.message || '获取备份列表失败' })
  }
})

// 立即创建备份（可选，便于手动触发）
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { backupName, sourcePath, maxKeep = 10 } = req.body || {}
    if (!backupName || !sourcePath) {
      return res.status(400).json({ success: false, message: '缺少必要参数: backupName 或 sourcePath' })
    }
    const result = await backupManager.createBackup(String(backupName), String(sourcePath), Number(maxKeep))
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('创建备份失败:', error)
    res.status(500).json({ success: false, message: error.message || '创建备份失败' })
  }
})

// 恢复指定备份
router.post('/restore', async (req: Request, res: Response) => {
  try {
    const { backupName, fileName } = req.body || {}
    if (!backupName || !fileName) {
      return res.status(400).json({ success: false, message: '缺少必要参数: backupName 或 fileName' })
    }
    const data = await backupManager.restoreBackup(String(backupName), String(fileName))
    res.json({ success: true, data, message: '恢复任务已完成' })
  } catch (error: any) {
    logger.error('恢复备份失败:', error)
    res.status(500).json({ success: false, message: error.message || '恢复备份失败' })
  }
})

// 删除某个备份文件
router.delete('/file', async (req: Request, res: Response) => {
  try {
    const { backupName, fileName } = (req.query || {}) as { backupName?: string; fileName?: string }
    if (!backupName || !fileName) {
      return res.status(400).json({ success: false, message: '缺少必要参数: backupName 或 fileName' })
    }
    await backupManager.deleteBackupFile(String(backupName), String(fileName))
    res.json({ success: true, message: '删除成功' })
  } catch (error: any) {
    logger.error('删除备份文件失败:', error)
    res.status(500).json({ success: false, message: error.message || '删除备份文件失败' })
  }
})

// 删除整个备份文件夹
router.delete('/folder', async (req: Request, res: Response) => {
  try {
    const { backupName } = (req.query || {}) as { backupName?: string }
    if (!backupName) {
      return res.status(400).json({ success: false, message: '缺少必要参数: backupName' })
    }
    await backupManager.deleteBackupFolder(String(backupName))
    res.json({ success: true, message: '备份文件夹已删除' })
  } catch (error: any) {
    logger.error('删除备份文件夹失败:', error)
    res.status(500).json({ success: false, message: error.message || '删除备份文件夹失败' })
  }
})

// 下载备份文件
router.get('/download', async (req: Request, res: Response) => {
  try {
    const { backupName, fileName } = (req.query || {}) as { backupName?: string; fileName?: string }
    if (!backupName || !fileName) {
      return res.status(400).json({ success: false, message: '缺少必要参数: backupName 或 fileName' })
    }
    const filePath = await backupManager.getBackupFilePath(String(backupName), String(fileName))
    
    // 设置响应头，告诉浏览器下载文件
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
    res.setHeader('Content-Type', 'application/octet-stream')
    
    // 发送文件
    res.sendFile(filePath, (err) => {
      if (err) {
        logger.error('下载备份文件失败:', err)
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: '下载备份文件失败' })
        }
      }
    })
  } catch (error: any) {
    logger.error('下载备份文件失败:', error)
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message || '下载备份文件失败' })
    }
  }
})

export default router


