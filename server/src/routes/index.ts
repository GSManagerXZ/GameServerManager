import { Router } from 'express'
import terminalRoutes from './terminal.js'
import gameRoutes from './games.js'
import systemRoutes from './system.js'
import fileRoutes from './files.js'
import instanceRoutes from './instances.js'
import { minecraftRouter } from './minecraft.js'
import onlineDeployRoutes from './onlineDeploy.js'
import configRoutes from './config.js'
import taskRoutes from './tasks.js'
import gameConfigRoutes from './gameconfig.js'
import settingsRoutes from './settings.js'
import environmentRoutes from './environment.js'
import backupRoutes from './backup.js'
import networkRoutes from './network.js'

const router = Router()

// 健康检查
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

// API版本信息
router.get('/version', (req, res) => {
  res.json({
    version: process.env.npm_package_version || '1.0.0',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  })
})

// 注册子路由
router.use('/terminal', terminalRoutes)
router.use('/games', gameRoutes)
router.use('/system', systemRoutes)
router.use('/files', fileRoutes)
router.use('/instances', instanceRoutes)
router.use('/minecraft', minecraftRouter)
router.use('/online-deploy', onlineDeployRoutes)
router.use('/config', configRoutes)
router.use('/tasks', taskRoutes)
router.use('/gameconfig', gameConfigRoutes)
router.use('/settings', settingsRoutes)
router.use('/environment', environmentRoutes)
router.use('/backup', backupRoutes)
router.use('/network', networkRoutes)

export default router