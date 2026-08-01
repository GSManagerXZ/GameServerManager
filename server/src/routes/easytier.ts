import { Request, Response, Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import path from 'path'
import {
  authenticateToken,
  requireAdmin,
  type AuthenticatedRequest
} from '../middleware/auth.js'
import type { InstanceManager } from '../modules/instance/InstanceManager.js'
import { EasyTierCommandError } from '../modules/easytier/EasyTierCommandRunner.js'
import { EasyTierInstallError, EasyTierInstaller } from '../modules/easytier/EasyTierInstaller.js'
import {
  EasyTierCompatibilityError,
  EasyTierManager,
  EasyTierNotFoundError
} from '../modules/easytier/EasyTierManager.js'
import { EasyTierSecurityService } from '../modules/easytier/EasyTierSecurityService.js'
import { EasyTierWebError, EasyTierWebManager } from '../modules/easytier/EasyTierWebManager.js'
import { EasyTierValidationError } from '../modules/easytier/easytierConfig.js'
import type {
  EasyTierBinarySelection,
  EasyTierProfileDraft,
  EasyTierProfileSecrets,
  EasyTierRuntimeAction,
  EasyTierWebSettingsInput
} from '../modules/easytier/easytierTypes.js'
import logger from '../utils/logger.js'

interface ProfileRequestBody {
  profile?: EasyTierProfileDraft
  secrets?: EasyTierProfileSecrets
  createInstance?: boolean
  clearSecrets?: boolean
}

const handleError = (res: Response, error: unknown, operation: string): void => {
  if (error instanceof EasyTierValidationError) {
    res.status(400).json({
      success: false,
      code: error.code,
      message: error.message,
      field: error.field
    })
    return
  }
  if (error instanceof EasyTierNotFoundError) {
    res.status(404).json({ success: false, code: error.code, message: error.message })
    return
  }
  if (error instanceof EasyTierCompatibilityError) {
    res.status(409).json({
      success: false,
      code: error.code,
      message: error.message,
      capabilities: error.capabilities
    })
    return
  }
  if (error instanceof EasyTierCommandError) {
    res.status(422).json({ success: false, code: error.code, message: error.message })
    return
  }
  if (error instanceof EasyTierInstallError || error instanceof EasyTierWebError) {
    res.status(error.status).json({ success: false, code: error.code, message: error.message })
    return
  }

  logger.error(`EasyTier ${operation}失败:`, error)
  res.status(500).json({
    success: false,
    code: 'EASYTIER_INTERNAL_ERROR',
    message: `${operation}失败，请查看服务端日志`
  })
}

const getBody = (req: Request): ProfileRequestBody => req.body || {}

export const createEasyTierRouter = (
  manager: EasyTierManager,
  installer: EasyTierInstaller,
  webManager: EasyTierWebManager,
  instanceManager: InstanceManager
): Router => {
  const router = Router()
  const securityService = new EasyTierSecurityService(manager)
  const easyTierRateLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: request => (
      (request as AuthenticatedRequest).user?.userId || 'authenticated-admin'
    ),
    validate: {
      xForwardedForHeader: false
    },
    message: {
      success: false,
      code: 'EASYTIER_RATE_LIMITED',
      message: 'EasyTier 操作过于频繁，请稍后重试'
    }
  })
  let profileOperationTails = new Map<string, Promise<void>>()

  const withProfileOperation = async <T>(
    profileId: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    const previous = profileOperationTails.get(profileId) || Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>(resolve => {
      release = resolve
    })
    profileOperationTails = new Map(profileOperationTails).set(profileId, current)
    await previous
    try {
      return await operation()
    } finally {
      release?.()
      if (profileOperationTails.get(profileId) === current) {
        const nextTails = new Map(profileOperationTails)
        nextTails.delete(profileId)
        profileOperationTails = nextTails
      }
    }
  }

  router.use(authenticateToken, requireAdmin, easyTierRateLimiter)

  router.get('/installation', async (_req, res) => {
    try {
      res.json({ success: true, data: await installer.getStatus() })
    } catch (error) {
      handleError(res, error, '获取安装状态')
    }
  })

  router.post('/installation', async (req, res) => {
    try {
      const force = req.body?.force === true
      if (force) {
        const currentInstallation = (await installer.getStatus()).installation
        if (currentInstallation) {
          const installationDirectory = path.resolve(currentInstallation.directory)
          const activeInstances = instanceManager.getInstances().filter(instance => {
            if (!['running', 'starting', 'stopping'].includes(instance.status) || !instance.programPath) return false
            const executablePath = path.resolve(instance.programPath)
            const relative = path.relative(installationDirectory, executablePath)
            return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
          })
          if (activeInstances.length > 0) {
            throw new EasyTierInstallError(
              `请先停止正在使用 EasyTier ${currentInstallation.version} 的实例: ${activeInstances.map(item => item.name).join('、')}`,
              'EASYTIER_INSTALLATION_IN_USE',
              409
            )
          }
        }
      }
      const installation = await installer.installRecommended(force)
      const web = await webManager.adoptInstallation(installation)
      res.json({
        success: true,
        data: {
          installation: await installer.getStatus(),
          web
        }
      })
    } catch (error) {
      handleError(res, error, '安装 EasyTier')
    }
  })

  router.get('/web', async (_req, res) => {
    try {
      res.json({ success: true, data: await webManager.getStatus() })
    } catch (error) {
      handleError(res, error, '获取 Web 控制台状态')
    }
  })

  router.put('/web', async (req, res) => {
    try {
      const settings = (req.body?.settings || req.body || {}) as EasyTierWebSettingsInput
      res.json({
        success: true,
        data: await webManager.saveSettings(settings, req.body?.restartIfRunning === true)
      })
    } catch (error) {
      handleError(res, error, '保存 Web 控制台配置')
    }
  })

  router.post('/web/start', async (_req, res) => {
    try {
      res.json({ success: true, data: await webManager.start() })
    } catch (error) {
      handleError(res, error, '启动 Web 控制台')
    }
  })

  router.post('/web/stop', async (_req, res) => {
    try {
      res.json({ success: true, data: await webManager.stop() })
    } catch (error) {
      handleError(res, error, '停止 Web 控制台')
    }
  })

  router.post('/web/restart', async (_req, res) => {
    try {
      res.json({ success: true, data: await webManager.restart() })
    } catch (error) {
      handleError(res, error, '重启 Web 控制台')
    }
  })

  router.get('/profiles', async (_req, res) => {
    try {
      res.json({ success: true, data: await manager.listProfileViews() })
    } catch (error) {
      handleError(res, error, '获取 profile 列表')
    }
  })

  router.get('/profiles/:profileId', async (req, res) => {
    try {
      res.json({ success: true, data: await manager.getProfileView(req.params.profileId) })
    } catch (error) {
      handleError(res, error, '获取 profile')
    }
  })

  router.post('/capabilities', async (req, res) => {
    try {
      const selection = (req.body || {}) as EasyTierBinarySelection
      res.json({ success: true, data: await manager.detectCapabilities(selection) })
    } catch (error) {
      handleError(res, error, '检测二进制能力')
    }
  })

  router.post('/profiles', async (req, res) => {
    const body = getBody(req)
    if (!body.profile) {
      res.status(400).json({ success: false, code: 'EASYTIER_PROFILE_REQUIRED', message: '缺少 profile 数据' })
      return
    }
    try {
      const view = await withProfileOperation('__profile-config__', () => manager.createProfile(
        body.profile as EasyTierProfileDraft,
        body.secrets || {},
        { createInstance: body.createInstance !== false }
      ))
      res.status(201).json({ success: true, data: view })
    } catch (error) {
      handleError(res, error, '创建 profile')
    }
  })

  router.put('/profiles/:profileId', async (req, res) => {
    const body = getBody(req)
    if (!body.profile) {
      res.status(400).json({ success: false, code: 'EASYTIER_PROFILE_REQUIRED', message: '缺少 profile 数据' })
      return
    }
    try {
      const view = await withProfileOperation(
        '__profile-config__',
        () => withProfileOperation(req.params.profileId, () => manager.updateProfile(
          req.params.profileId,
          body.profile as EasyTierProfileDraft,
          body.secrets || {},
          {
            createInstance: body.createInstance === true,
            preserveExistingSecrets: body.clearSecrets !== true
          }
        ))
      )
      res.json({ success: true, data: view })
    } catch (error) {
      handleError(res, error, '更新 profile')
    }
  })

  router.delete('/profiles/:profileId', async (req, res) => {
    try {
      const deleteInstance = String(req.query.deleteInstance ?? 'true').toLowerCase() !== 'false'
      const result = await withProfileOperation(
        req.params.profileId,
        () => manager.deleteProfile(req.params.profileId, deleteInstance)
      )
      res.json({ success: true, data: result })
    } catch (error) {
      handleError(res, error, '删除 profile')
    }
  })

  router.post('/profiles/:profileId/capabilities/refresh', async (req, res) => {
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => manager.refreshProfileCapabilities(req.params.profileId)
        )
      })
    } catch (error) {
      handleError(res, error, '刷新 profile 能力')
    }
  })

  router.post('/profiles/:profileId/upsert-instance', async (req, res) => {
    try {
      const instance = await withProfileOperation(
        req.params.profileId,
        () => manager.upsertManagedInstance(req.params.profileId)
      )
      res.json({
        success: true,
        data: { id: instance.id, name: instance.name, status: instance.status }
      })
    } catch (error) {
      handleError(res, error, '同步托管实例')
    }
  })

  router.post('/profiles/:profileId/start', async (req, res) => {
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => manager.startProfile(req.params.profileId)
        )
      })
    } catch (error) {
      handleError(res, error, '启动 profile')
    }
  })

  router.post('/profiles/:profileId/stop', async (req, res) => {
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => manager.stopProfile(req.params.profileId)
        )
      })
    } catch (error) {
      handleError(res, error, '停止 profile')
    }
  })

  router.post('/profiles/:profileId/restart', async (req, res) => {
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => manager.restartProfile(req.params.profileId)
        )
      })
    } catch (error) {
      handleError(res, error, '重启 profile')
    }
  })

  router.get('/profiles/:profileId/status', async (req, res) => {
    try {
      res.json({ success: true, data: await manager.getProfileView(req.params.profileId) })
    } catch (error) {
      handleError(res, error, '获取 profile 状态')
    }
  })

  router.get('/profiles/:profileId/snapshot', async (req, res) => {
    try {
      res.json({ success: true, data: await manager.getRuntimeSnapshot(req.params.profileId) })
    } catch (error) {
      handleError(res, error, '获取运行时快照')
    }
  })

  router.post('/profiles/:profileId/actions', async (req, res) => {
    const action = req.body?.action as EasyTierRuntimeAction | undefined
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      res.status(400).json({ success: false, code: 'EASYTIER_ACTION_REQUIRED', message: '缺少运行时 action 数据' })
      return
    }
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => manager.executeRuntimeAction(req.params.profileId, action)
        )
      })
    } catch (error) {
      handleError(res, error, '执行运行时操作')
    }
  })

  router.get('/profiles/:profileId/security', async (req, res) => {
    try {
      res.json({ success: true, data: await securityService.getOverview(req.params.profileId) })
    } catch (error) {
      handleError(res, error, '获取安全配置')
    }
  })

  router.put('/profiles/:profileId/security', async (req, res) => {
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => securityService.updateConfiguration(req.params.profileId, req.body || {})
        )
      })
    } catch (error) {
      handleError(res, error, '更新安全配置')
    }
  })

  router.post('/profiles/:profileId/security/static-key/generate', async (req, res) => {
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => securityService.generateStaticKey(req.params.profileId)
        )
      })
    } catch (error) {
      handleError(res, error, '生成静态密钥')
    }
  })

  router.get('/profiles/:profileId/security/credentials', async (req, res) => {
    try {
      res.json({ success: true, data: await securityService.listCredentials(req.params.profileId) })
    } catch (error) {
      handleError(res, error, '获取临时凭据')
    }
  })

  router.post('/profiles/:profileId/security/credentials', async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => securityService.generateCredential(req.params.profileId, req.body || {})
        )
      })
    } catch (error) {
      handleError(res, error, '生成临时凭据')
    }
  })

  router.delete('/profiles/:profileId/security/credentials/:credentialId', async (req, res) => {
    try {
      res.json({
        success: true,
        data: await withProfileOperation(
          req.params.profileId,
          () => securityService.revokeCredential(req.params.profileId, req.params.credentialId)
        )
      })
    } catch (error) {
      handleError(res, error, '撤销临时凭据')
    }
  })

  router.get('/profiles/:profileId/security/acl/stats', async (req, res) => {
    try {
      res.json({ success: true, data: await securityService.getAclStats(req.params.profileId) })
    } catch (error) {
      handleError(res, error, '获取 ACL 统计')
    }
  })

  return router
}
