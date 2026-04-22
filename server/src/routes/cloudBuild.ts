import { Router } from 'express'
import axios from 'axios'
import { authenticateToken } from '../middleware/auth.js'
import path from 'path'
import fs from 'fs-extra'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { zipToolsManager } from '../utils/zipToolsManager.js'

const router = Router()

const CLOUD_BUILD_SERVER = 'https://tools.xiaozhuhouses.asia'
const DEFAULT_USER_AGENT = 'GSM3-CloudBuild/1.0'
const CLOUD_BUILD_TOOLS = {
  javaCore: {
    key: 'minecraft-java-core-assembler',
    label: '我的世界Java核心开服包'
  },
  modpack: {
    key: 'minecraft-modpack-assembler',
    label: '我的世界整合包构建'
  }
} as const
const MODPACK_PLATFORMS = ['modrinth'] as const

const buildHeaders = (extraHeaders: Record<string, string> = {}) => ({
  Accept: 'application/json',
  'User-Agent': DEFAULT_USER_AGENT,
  ...extraHeaders
})

const getCloudBuildTempDir = (): string => {
  const baseDir = process.cwd()
  const possiblePaths = [
    path.join(baseDir, 'server', 'data', 'cloud-build', 'temp'),
    path.join(baseDir, 'data', 'cloud-build', 'temp')
  ]

  const existingPath = possiblePaths.find(targetPath => fs.existsSync(targetPath))
  return existingPath || possiblePaths[0]
}

const resolveDownloadUrl = (downloadUrl: string): string => {
  if (/^https?:\/\//i.test(downloadUrl)) {
    return downloadUrl
  }

  return new URL(downloadUrl, CLOUD_BUILD_SERVER).toString()
}

const getArchiveFileName = (downloadUrl: string, archiveFileName?: string): string => {
  const safeFileName = archiveFileName?.trim()
  if (safeFileName) {
    return safeFileName.replace(/[<>:"|?*]/g, '')
  }

  try {
    const url = new URL(resolveDownloadUrl(downloadUrl))
    const fileName = path.basename(url.pathname)
    if (fileName && fileName !== '/') {
      return fileName.replace(/[<>:"|?*]/g, '') || `cloud-build-${Date.now()}.zip`
    }
  } catch {
    // 这里忽略解析错误，回退到默认文件名
  }

  return `cloud-build-${Date.now()}.zip`
}

const normalizeExtractedDirectory = async (targetPath: string): Promise<void> => {
  const rootEntries = await fs.readdir(targetPath, { withFileTypes: true })

  if (rootEntries.length !== 1 || !rootEntries[0].isDirectory()) {
    return
  }

  const wrappedDirectoryName = rootEntries[0].name
  const wrappedDirectoryPath = path.join(targetPath, wrappedDirectoryName)
  const wrappedEntries = await fs.readdir(wrappedDirectoryPath, { withFileTypes: true })

  for (const entry of wrappedEntries) {
    const sourcePath = path.join(wrappedDirectoryPath, entry.name)
    const destinationPath = path.join(targetPath, entry.name)

    if (await fs.pathExists(destinationPath)) {
      throw new Error(`解压结果整理失败，目标目录中已存在同名文件或目录: ${entry.name}`)
    }

    await fs.move(sourcePath, destinationPath)
  }

  await fs.remove(wrappedDirectoryPath)
}

const detectStartCommand = async (targetPath: string): Promise<{ startCommand: string; fileCount: number }> => {
  const files = await fs.readdir(targetPath)
  let startCommand = ''

  if (process.platform === 'win32') {
    const runBat = files.find(file => file.toLowerCase() === 'run.bat')
    const startBat = files.find(file => file.toLowerCase() === 'start.bat')

    if (runBat) {
      startCommand = `.\\${runBat}`
    } else if (startBat) {
      startCommand = `.\\${startBat}`
    }
  } else {
    const runSh = files.find(file => file.toLowerCase() === 'run.sh')
    const startSh = files.find(file => file.toLowerCase() === 'start.sh')

    if (runSh) {
      startCommand = `bash ${runSh}`
    } else if (startSh) {
      startCommand = `bash ${startSh}`
    }
  }

  return {
    startCommand,
    fileCount: files.length
  }
}

const requestCatalog = async (coreType?: string) => {
  const params = coreType ? { coreType } : undefined

  return axios.get(
    `${CLOUD_BUILD_SERVER}/api/tools/${CLOUD_BUILD_TOOLS.javaCore.key}/catalog`,
    {
      params,
      timeout: 30000,
      headers: buildHeaders()
    }
  )
}

const createBuildTask = async (toolKey: string, params: Record<string, string>) => {
  return axios.post(
    `${CLOUD_BUILD_SERVER}/api/open/tools/${toolKey}/execute`,
    {
      params
    },
    {
      timeout: 60000,
      headers: buildHeaders({
        'Content-Type': 'application/json'
      })
    }
  )
}

const queryBuildTaskStatus = async (toolKey: string, requestId: string, accessToken: string) => {
  return axios.get(
    `${CLOUD_BUILD_SERVER}/api/open/tools/${toolKey}/tasks/${encodeURIComponent(requestId)}`,
    {
      timeout: 30000,
      headers: buildHeaders({
        'X-Task-Access-Token': accessToken
      })
    }
  )
}

router.get('/catalog', authenticateToken, async (req, res) => {
  try {
    const coreType = typeof req.query.coreType === 'string' ? req.query.coreType.trim() : ''
    const response = await requestCatalog(coreType)

    res.json({
      success: true,
      message: '获取云构建目录成功',
      data: response.data
    })
  } catch (error: any) {
    console.error('获取云构建目录失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '获取云构建目录失败',
      error: error.message
    })
  }
})

router.post('/build', authenticateToken, async (req, res) => {
  try {
    const { coreType, version, mcVersion } = req.body

    if (!coreType || !version || !mcVersion) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：coreType、version 和 mcVersion'
      })
    }

    const response = await createBuildTask(CLOUD_BUILD_TOOLS.javaCore.key, {
      coreType,
      version,
      mcVersion
    })

    res.json({
      success: true,
      message: response.data?.message || '云构建任务已提交',
      data: response.data
    })
  } catch (error: any) {
    console.error('创建云构建任务失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '创建云构建任务失败',
      error: error.message
    })
  }
})

router.get('/build/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params
    const accessToken = typeof req.query.accessToken === 'string' ? req.query.accessToken.trim() : ''

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：accessToken'
      })
    }

    const response = await queryBuildTaskStatus(
      CLOUD_BUILD_TOOLS.javaCore.key,
      requestId,
      accessToken
    )

    res.json({
      success: true,
      message: response.data?.message || '查询云构建任务状态成功',
      data: response.data
    })
  } catch (error: any) {
    console.error('查询云构建任务状态失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '查询云构建任务状态失败',
      error: error.message
    })
  }
})

router.post('/modpack/build', authenticateToken, async (req, res) => {
  try {
    const platform = typeof req.body.platform === 'string' ? req.body.platform.trim().toLowerCase() : 'modrinth'
    const source = typeof req.body.source === 'string' ? req.body.source.trim() : ''
    const version = typeof req.body.version === 'string' ? req.body.version.trim() : ''

    if (!source) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：source'
      })
    }

    if (!MODPACK_PLATFORMS.includes(platform as typeof MODPACK_PLATFORMS[number])) {
      return res.status(400).json({
        success: false,
        message: `暂不支持的平台：${platform}`
      })
    }

    const response = await createBuildTask(CLOUD_BUILD_TOOLS.modpack.key, {
      platform,
      source,
      version
    })

    res.json({
      success: true,
      message: response.data?.message || '整合包构建任务已提交',
      data: response.data
    })
  } catch (error: any) {
    console.error('创建整合包构建任务失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '创建整合包构建任务失败',
      error: error.message
    })
  }
})

router.get('/modpack/build/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params
    const accessToken = typeof req.query.accessToken === 'string' ? req.query.accessToken.trim() : ''

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：accessToken'
      })
    }

    const response = await queryBuildTaskStatus(
      CLOUD_BUILD_TOOLS.modpack.key,
      requestId,
      accessToken
    )

    res.json({
      success: true,
      message: response.data?.message || '查询整合包构建任务状态成功',
      data: response.data
    })
  } catch (error: any) {
    console.error('查询整合包构建任务状态失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '查询整合包构建任务状态失败',
      error: error.message
    })
  }
})

router.post('/download', authenticateToken, async (req, res) => {
  let tempArchivePath = ''

  try {
    const { downloadUrl, targetPath, archiveFileName } = req.body

    if (!downloadUrl || !targetPath) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：downloadUrl 和 targetPath'
      })
    }

    const finalDownloadUrl = resolveDownloadUrl(downloadUrl)
    const tempDir = getCloudBuildTempDir()
    const finalArchiveFileName = getArchiveFileName(finalDownloadUrl, archiveFileName)

    await fs.ensureDir(targetPath)
    await fs.ensureDir(tempDir)

    tempArchivePath = path.join(tempDir, finalArchiveFileName)

    const downloadResponse = await axios.get(finalDownloadUrl, {
      responseType: 'stream',
      timeout: 300000,
      headers: buildHeaders()
    })

    await pipeline(downloadResponse.data, createWriteStream(tempArchivePath))
    await zipToolsManager.extractZip(tempArchivePath, targetPath)
    await normalizeExtractedDirectory(targetPath)

    const { startCommand, fileCount } = await detectStartCommand(targetPath)

    res.json({
      success: true,
      message: '下载并解压成功',
      data: {
        targetPath,
        startCommand,
        files: fileCount
      }
    })
  } catch (error: any) {
    console.error('下载并解压云构建文件失败:', error.message)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || '下载并解压云构建文件失败',
      error: error.message
    })
  } finally {
    if (tempArchivePath) {
      await fs.remove(tempArchivePath).catch(() => {})
    }
  }
})

export default router

