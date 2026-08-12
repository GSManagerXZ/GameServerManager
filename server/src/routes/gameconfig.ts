import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { GameConfigManager } from '../modules/gameConfig/GameConfigManager.js'
import { InstanceManager } from '../modules/instance/InstanceManager.js'
import logger from '../utils/logger.js'
import path from 'path'

const router = Router()
const gameConfigManager = new GameConfigManager()
let instanceManager: InstanceManager

// 设置InstanceManager
export function setInstanceManager(manager: InstanceManager) {
  instanceManager = manager
}

// 获取所有可用的游戏配置模板
router.get('/templates', authenticateToken, async (req: Request, res: Response) => {
  try {
    const templates = await gameConfigManager.getAvailableGameConfigs()
    
    res.json({
      success: true,
      data: templates.map(template => ({
        id: template.meta.game_name,
        name: template.meta.game_name,
        game_name: template.meta.game_name,
        config_file: template.meta.config_file,
        parser: template.meta.parser || 'configobj'
      }))
    })
  } catch (error) {
    logger.error('获取游戏配置模板失败:', error)
    res.status(500).json({
      success: false,
      message: '获取游戏配置模板失败'
    })
  }
})

// 获取指定游戏的配置模板详情
router.get('/templates/:gameName', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameName } = req.params
    const template = await gameConfigManager.getGameConfigSchema(gameName)
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的游戏配置模板'
      })
    }

    res.json({
      success: true,
      data: template
    })
  } catch (error) {
    logger.error('获取游戏配置模板详情失败:', error)
    res.status(500).json({
      success: false,
      message: '获取游戏配置模板详情失败'
    })
  }
})

// 读取实例的游戏配置
router.get('/instances/:instanceId/:gameName', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { instanceId, gameName } = req.params
    
    // 获取实例信息
    if (!instanceManager) {
      return res.status(500).json({
        success: false,
        message: 'InstanceManager 未初始化'
      })
    }
    
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的实例'
      })
    }
    
    // 获取配置模板
    const template = await gameConfigManager.getGameConfigSchema(gameName)
    if (!template) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的游戏配置模板'
      })
    }

    // 使用实例的真实工作目录
    const instancePath = instance.workingDirectory
    logger.info(`读取实例 ${instanceId} 的配置，工作目录: ${instancePath}`, { service: 'gsm3-server' })
    
    // 检查配置文件是否存在
    const configFilePath = path.join(instancePath, template.meta.config_file)
    try {
      await import('fs/promises').then(fs => fs.access(configFilePath))
      // 配置文件存在，正常读取
      const configData = await gameConfigManager.readGameConfig(instancePath, template)
      
      res.json({
        success: true,
        data: {
          template,
          config: configData,
          configExists: true
        }
      })
    } catch {
      // 配置文件不存在，返回默认配置和提示
      const defaultConfig = gameConfigManager.getDefaultValues(template)
      
      res.json({
        success: true,
        data: {
          template,
          config: defaultConfig,
          configExists: false,
          configFilePath: template.meta.config_file
        }
      })
    }
  } catch (error) {
    logger.error('读取实例游戏配置失败:', error)
    res.status(500).json({
      success: false,
      message: '读取实例游戏配置失败'
    })
  }
})

// 创建配置文件
router.post('/instances/:instanceId/:gameName/create', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { instanceId, gameName } = req.params

    // 获取实例信息
    if (!instanceManager) {
      return res.status(500).json({
        success: false,
        message: 'InstanceManager 未初始化'
      })
    }
    
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的实例'
      })
    }

    // 获取配置模板
    const template = await gameConfigManager.getGameConfigSchema(gameName)
    if (!template) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的游戏配置模板'
      })
    }

    // 使用实例的真实工作目录
    const instancePath = instance.workingDirectory
    logger.info(`为实例 ${instanceId} 创建配置文件，工作目录: ${instancePath}`, { service: 'gsm3-server' })
    
    // 获取默认配置并保存
    const defaultConfig = gameConfigManager.getDefaultValues(template)
    const success = await gameConfigManager.saveGameConfig(instancePath, template, defaultConfig)
    
    if (success) {
      res.json({
        success: true,
        message: '配置文件创建成功',
        data: {
          template,
          config: defaultConfig,
          configExists: true
        }
      })
    } else {
      res.status(500).json({
        success: false,
        message: '配置文件创建失败'
      })
    }
  } catch (error) {
    logger.error('创建配置文件失败:', error)
    res.status(500).json({
      success: false,
      message: '创建配置文件失败'
    })
  }
})

// 保存实例的游戏配置
router.post('/instances/:instanceId/:gameName', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { instanceId, gameName } = req.params
    const { config } = req.body

    if (!config) {
      return res.status(400).json({
        success: false,
        message: '缺少配置数据'
      })
    }

    // 获取实例信息
    if (!instanceManager) {
      return res.status(500).json({
        success: false,
        message: 'InstanceManager 未初始化'
      })
    }
    
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的实例'
      })
    }

    // 获取配置模板
    const template = await gameConfigManager.getGameConfigSchema(gameName)
    if (!template) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的游戏配置模板'
      })
    }

    // 使用实例的真实工作目录
    const instancePath = instance.workingDirectory
    logger.info(`保存实例 ${instanceId} 的配置，工作目录: ${instancePath}`, { service: 'gsm3-server' })
    
    // 保存配置
    const success = await gameConfigManager.saveGameConfig(instancePath, template, config)
    
    if (success) {
      res.json({
        success: true,
        message: '配置保存成功'
      })
    } else {
      res.status(500).json({
        success: false,
        message: '配置保存失败'
      })
    }
  } catch (error) {
    logger.error('保存实例游戏配置失败:', error)
    res.status(500).json({
      success: false,
      message: '保存实例游戏配置失败'
    })
  }
})

// 验证配置数据
router.post('/validate/:gameName', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameName } = req.params
    const { config } = req.body

    if (!config) {
      return res.status(400).json({
        success: false,
        message: '缺少配置数据'
      })
    }

    // 获取配置模板
    const template = await gameConfigManager.getGameConfigSchema(gameName)
    if (!template) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的游戏配置模板'
      })
    }

    // 验证配置数据
    const errors: string[] = []
    
    for (const section of template.sections) {
      const sectionData = config[section.key]
      if (!sectionData) {
        errors.push(`缺少配置节: ${section.key}`)
        continue
      }

      for (const field of section.fields) {
        const value = sectionData[field.name]
        
        // 检查必填字段
        if (value === undefined || value === null) {
          if (field.default === undefined) {
            errors.push(`${section.key}.${field.name}: 缺少必填字段`)
          }
          continue
        }

        // 类型验证
        switch (field.type) {
          case 'number':
            if (isNaN(Number(value))) {
              errors.push(`${section.key}.${field.name}: 必须是数字`)
            }
            break
          case 'boolean':
            if (typeof value !== 'boolean') {
              errors.push(`${section.key}.${field.name}: 必须是布尔值`)
            }
            break
          case 'select':
            if (field.options && !field.options.some(opt => opt.value === value)) {
              errors.push(`${section.key}.${field.name}: 无效的选项值`)
            }
            break
        }
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        message: '配置验证失败',
        errors
      })
    } else {
      res.json({
        success: true,
        message: '配置验证通过'
      })
    }
  } catch (error) {
    logger.error('验证配置数据失败:', error)
    res.status(500).json({
      success: false,
      message: '验证配置数据失败'
    })
  }
})

// 获取配置文件的原始内容
router.get('/instances/:instanceId/:gameName/raw', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { instanceId, gameName } = req.params

    if (!instanceManager) {
      return res.status(500).json({
        success: false,
        message: 'InstanceManager 未初始化'
      })
    }

    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的实例'
      })
    }
    
    // 获取配置模板
    const template = await gameConfigManager.getGameConfigSchema(gameName)
    if (!template) {
      return res.status(404).json({
        success: false,
        message: '未找到指定的游戏配置模板'
      })
    }

    // 使用实例的真实工作目录，避免非默认实例目录读取 raw 配置失败。
    const instancePath = instance.workingDirectory
    const configFilePath = path.join(instancePath, template.meta.config_file)
    
    try {
      const fs = await import('fs/promises')
      const content = await fs.readFile(configFilePath, 'utf-8')
      
      res.json({
        success: true,
        data: {
          content,
          path: template.meta.config_file,
          parser: template.meta.parser || 'configobj'
        }
      })
    } catch (error) {
      res.status(404).json({
        success: false,
        message: '配置文件不存在'
      })
    }
  } catch (error) {
    logger.error('获取配置文件原始内容失败:', error)
    res.status(500).json({
      success: false,
      message: '获取配置文件原始内容失败'
    })
  }
})

export default router
