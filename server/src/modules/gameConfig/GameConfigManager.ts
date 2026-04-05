import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import YAML from 'yaml'
import PropertiesReader from 'properties-reader'
import TOML from 'smol-toml'
import logger from '../../utils/logger.js'

export interface GameConfigField {
  name: string
  display: string
  default: any
  type: 'string' | 'number' | 'boolean' | 'select' | 'nested'
  description?: string
  options?: Array<{ value: any; label: string }>
  nested_fields?: GameConfigField[]
}

export interface GameConfigSection {
  key: string
  fields: GameConfigField[]
}

export interface GameConfigMeta {
  game_name: string
  config_file: string
  parser?: string
}

export interface GameConfigSchema {
  meta: GameConfigMeta
  sections: GameConfigSection[]
}

export interface ParsedConfigData {
  [sectionKey: string]: {
    [fieldName: string]: any
  }
}

type RawConfigValue = string | number | boolean | bigint | null | undefined | Date | RawConfigObject | RawConfigValue[]

interface RawConfigObject {
  [key: string]: RawConfigValue
}

export class GameConfigManager {
  private configSchemasDir: string
  private supportedParsers: Map<string, (configPath: string, schema: GameConfigSchema) => Promise<ParsedConfigData>>
  private configsCache: GameConfigSchema[] | null = null

  constructor() {
    // 确保路径指向正确的配置目录
    // 使用 process.cwd() 作为基础路径，这样在打包后也能正确工作
    const baseDir = process.cwd()
    
    // 尝试多个可能的路径位置
    const possiblePaths = [
      path.join(baseDir, 'data', 'gameconfig'),           // 打包后的路径
      path.join(baseDir, 'server', 'data', 'gameconfig'), // 开发环境路径
      path.join(baseDir, '..', 'server', 'data', 'gameconfig'), // 其他可能的路径
    ]
    
    this.configSchemasDir = possiblePaths[0] // 默认使用第一个路径
    
    // 检查哪个路径存在
    for (const possiblePath of possiblePaths) {
      try {
        fsSync.accessSync(possiblePath)
        this.configSchemasDir = possiblePath
        break
      } catch {
        // 继续尝试下一个路径
      }
    }
    
    logger.info(`GameConfigManager 配置目录: ${this.configSchemasDir}`)
    this.supportedParsers = new Map([
      ['properties', this.parseWithProperties.bind(this)],
      ['configobj', this.parseWithConfigObj.bind(this)],
      ['yaml', this.parseWithYaml.bind(this)],
      ['ruamel.yaml', this.parseWithYaml.bind(this)],
      ['json', this.parseWithJson.bind(this)],
      ['toml', this.parseWithToml.bind(this)]
    ])
  }

  /**
   * 获取所有可用的游戏配置模板
   */
  async getAvailableGameConfigs(): Promise<GameConfigSchema[]> {
    if (this.configsCache) {
      return this.configsCache
    }

    try {
      const files = await fs.readdir(this.configSchemasDir)
      const ymlFiles = files.filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
      
      const configs: GameConfigSchema[] = []
      const loadedGames: string[] = []
      const failedFiles: string[] = []
      
      for (const file of ymlFiles) {
        try {
          const filePath = path.join(this.configSchemasDir, file)
          const content = await fs.readFile(filePath, 'utf-8')
          const schema = YAML.parse(content) as GameConfigSchema
          
          if (schema && schema.meta && schema.sections) {
            configs.push(schema)
            loadedGames.push(schema.meta.game_name)
          } else {
            failedFiles.push(file)
            logger.warn(`配置文件格式不正确: ${file}`)
          }
        } catch (error) {
          failedFiles.push(file)
          logger.warn(`解析配置模板文件失败: ${file}`, error)
        }
      }
      
      // 统一输出加载结果
      if (configs.length > 0) {
        logger.info(`成功加载 ${configs.length} 个游戏配置模板: ${loadedGames.join(', ')}`)
      }
      
      if (failedFiles.length > 0) {
        logger.warn(`${failedFiles.length} 个配置文件加载失败: ${failedFiles.join(', ')}`)
      }
      
      this.configsCache = configs
      return configs
    } catch (error) {
      logger.error('获取游戏配置模板失败:', error)
      throw new Error('获取游戏配置模板失败')
    }
  }

  /**
   * 根据游戏名称获取配置模板
   */
  async getGameConfigSchema(gameName: string): Promise<GameConfigSchema | null> {
    try {
      const configs = await this.getAvailableGameConfigs()
      return configs.find(config => config.meta.game_name === gameName) || null
    } catch (error) {
      logger.error(`获取游戏配置模板失败: ${gameName}`, error)
      return null
    }
  }

  /**
   * 读取游戏配置文件
   */
  async readGameConfig(serverPath: string, configSchema: GameConfigSchema): Promise<ParsedConfigData> {
    try {
      const configFilePath = configSchema.meta.config_file
      const fullConfigPath = path.join(serverPath, configFilePath)
      const parserType = configSchema.meta.parser || 'configobj'

      logger.debug(`正在读取配置文件: ${fullConfigPath}`)
      logger.debug(`使用解析器: ${parserType}`)

      // 检查配置文件是否存在
      try {
        await fs.access(fullConfigPath)
      } catch {
        throw new Error(`配置文件不存在: ${fullConfigPath}`)
      }

      const parser = this.supportedParsers.get(parserType)
      if (!parser) {
        throw new Error(`不支持的解析器类型: ${parserType}`)
      }

      return await parser(fullConfigPath, configSchema)
    } catch (error) {
      logger.error('读取游戏配置文件失败:', error)
      throw error
    }
  }

  /**
   * 保存游戏配置文件
   */
  async saveGameConfig(serverPath: string, configSchema: GameConfigSchema, configData: ParsedConfigData): Promise<boolean> {
    try {
      const configFilePath = configSchema.meta.config_file
      const fullConfigPath = path.join(serverPath, configFilePath)
      const parserType = configSchema.meta.parser || 'configobj'

      logger.debug(`正在保存配置文件: ${fullConfigPath}`)
      logger.debug(`使用解析器: ${parserType}`)

      // 确保目录存在
      const configDir = path.dirname(fullConfigPath)
      await fs.mkdir(configDir, { recursive: true })

      const mergedConfig = await this.mergeConfigWithExistingFile(fullConfigPath, configData, configSchema, parserType)

      switch (parserType) {
        case 'properties':
          await this.saveWithProperties(fullConfigPath, mergedConfig, configSchema)
          break
        case 'configobj':
          await this.saveWithConfigObj(fullConfigPath, mergedConfig, configSchema)
          break
        case 'yaml':
        case 'ruamel.yaml':
          await this.saveWithYaml(fullConfigPath, mergedConfig, configSchema)
          break
        case 'json':
          await this.saveWithJson(fullConfigPath, mergedConfig, configSchema)
          break
        case 'toml':
          await this.saveWithToml(fullConfigPath, mergedConfig, configSchema)
          break
        default:
          throw new Error(`不支持的解析器类型: ${parserType}`)
      }

      logger.info(`配置文件保存成功: ${fullConfigPath}`, { service: 'gsm3-server' })
      return true
    } catch (error) {
      logger.error('保存游戏配置文件失败:', error)
      return false
    }
  }

  /**
   * 获取默认配置值
   */
  getDefaultValues(configSchema: GameConfigSchema): ParsedConfigData {
    const result: ParsedConfigData = {}

    for (const section of configSchema.sections) {
      result[section.key] = {}
      
      for (const field of section.fields) {
        if (field.type === 'nested' && field.nested_fields) {
          // 处理嵌套字段
          const nestedValues: { [key: string]: any } = {}
          for (const nestedField of field.nested_fields) {
            nestedValues[nestedField.name] = nestedField.default
          }
          result[section.key][field.name] = nestedValues
        } else {
          result[section.key][field.name] = field.default
        }
      }
    }

    return result
  }

  /**
   * 使用Properties格式解析配置文件
   */
  private async parseWithProperties(configPath: string, configSchema: GameConfigSchema): Promise<ParsedConfigData> {
    try {
      const properties = PropertiesReader(configPath)
      const result: ParsedConfigData = {}

      for (const section of configSchema.sections) {
        result[section.key] = {}
        
        for (const field of section.fields) {
          const value = properties.get(field.name)
          if (value !== null) {
            result[section.key][field.name] = this.convertValue(value, field.type)
          } else {
            result[section.key][field.name] = field.default
          }
        }
      }

      return result
    } catch (error) {
      logger.error('Properties解析失败:', error)
      throw error
    }
  }

  /**
   * 使用ConfigObj格式解析配置文件（INI格式）
   */
  private async parseWithConfigObj(configPath: string, configSchema: GameConfigSchema): Promise<ParsedConfigData> {
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      const result: ParsedConfigData = {}

      // 简单的INI解析器
      const lines = content.split('\n')
      let currentSection = ''
      const parsedData: { [key: string]: { [key: string]: string } } = {}

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
          continue
        }

        // 检查是否是section
        const sectionMatch = trimmedLine.match(/^\[(.+)\]$/)
        if (sectionMatch) {
          currentSection = sectionMatch[1]
          if (!parsedData[currentSection]) {
            parsedData[currentSection] = {}
          }
          continue
        }

        // 解析键值对
        const keyValueMatch = trimmedLine.match(/^([^=]+)=(.*)$/)
        if (keyValueMatch && currentSection) {
          const key = keyValueMatch[1].trim()
          const value = keyValueMatch[2].trim()
          parsedData[currentSection][key] = value
        }
      }

      // 根据schema转换数据
      for (const section of configSchema.sections) {
        result[section.key] = {}
        const sectionData = parsedData[section.key] || {}
        
        for (const field of section.fields) {
          if (field.type === 'nested' && field.nested_fields) {
            // 处理嵌套字段（如幻兽帕鲁的OptionSettings）
            const nestedValue = sectionData[field.name] || field.default
            result[section.key][field.name] = this.parseNestedValue(nestedValue, field.nested_fields)
          } else {
            const value = sectionData[field.name]
            if (value !== undefined) {
              result[section.key][field.name] = this.convertValue(value, field.type)
            } else {
              result[section.key][field.name] = field.default
            }
          }
        }
      }

      return result
    } catch (error) {
      logger.error('ConfigObj解析失败:', error)
      throw error
    }
  }

  /**
   * 使用YAML格式解析配置文件
   */
  private async parseWithYaml(configPath: string, configSchema: GameConfigSchema): Promise<ParsedConfigData> {
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      const yamlData = YAML.parse(content) || {}
      const result: ParsedConfigData = {}

      for (const section of configSchema.sections) {
        result[section.key] = {}
        const sectionData = yamlData[section.key] || {}
        
        for (const field of section.fields) {
          const value = sectionData[field.name]
          if (value !== undefined) {
            result[section.key][field.name] = value
          } else {
            result[section.key][field.name] = field.default
          }
        }
      }

      return result
    } catch (error) {
      logger.error('YAML解析失败:', error)
      throw error
    }
  }

  /**
   * 使用JSON格式解析配置文件
   */
  private async parseWithJson(configPath: string, configSchema: GameConfigSchema): Promise<ParsedConfigData> {
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      const jsonData = JSON.parse(content)
      const result: ParsedConfigData = {}

      for (const section of configSchema.sections) {
        result[section.key] = {}
        // 如果 section.key 为空字符串，表示从 JSON 根级别读取（扁平结构）
        const sectionData = section.key === '' ? jsonData : (jsonData[section.key] || {})
        
        for (const field of section.fields) {
          if (field.type === 'nested' && field.nested_fields) {
            // 处理嵌套字段
            const nestedValue = sectionData[field.name]
            if (nestedValue !== undefined && typeof nestedValue === 'object') {
              // JSON格式的嵌套字段本身就是对象，直接使用
              result[section.key][field.name] = nestedValue
            } else {
              // 使用默认值填充嵌套字段
              const nestedDefaults: { [key: string]: any } = {}
              for (const nestedField of field.nested_fields) {
                nestedDefaults[nestedField.name] = nestedField.default
              }
              result[section.key][field.name] = nestedDefaults
            }
          } else {
            // 处理普通字段
            const value = sectionData[field.name]
            if (value !== undefined) {
              result[section.key][field.name] = value
            } else {
              result[section.key][field.name] = field.default
            }
          }
        }
      }

      return result
    } catch (error) {
      logger.error('JSON解析失败:', error)
      throw error
    }
  }

  /**
   * 解析嵌套值（如幻兽帕鲁的OptionSettings）
   */
  private parseNestedValue(value: string, nestedFields: GameConfigField[]): { [key: string]: any } {
    const result: { [key: string]: any } = {}
    
    if (typeof value === 'string') {
      // 移除括号
      const cleanValue = value.replace(/^\(|\)$/g, '')
      
      // 分割键值对
      const pairs = cleanValue.split(',')
      
      for (const pair of pairs) {
        const [key, val] = pair.split('=').map(s => s.trim())
        if (key && val !== undefined) {
          const field = nestedFields.find(f => f.name === key)
          if (field) {
            result[key] = this.convertValue(val, field.type)
          }
        }
      }
    }

    // 填充默认值
    for (const field of nestedFields) {
      if (!(field.name in result)) {
        result[field.name] = field.default
      }
    }

    return result
  }

  /**
   * 转换值类型
   */
  private convertValue(value: any, type: string): any {
    if (value === null || value === undefined) {
      return value
    }

    const strValue = String(value)

    switch (type) {
      case 'number':
        const num = Number(strValue)
        return isNaN(num) ? 0 : num
      case 'boolean':
        return strValue.toLowerCase() === 'true' || strValue === '1'
      case 'string':
      default:
        return strValue
    }
  }

  private async mergeConfigWithExistingFile(
    configPath: string,
    configData: ParsedConfigData,
    configSchema: GameConfigSchema,
    parserType: string
  ): Promise<RawConfigObject> {
    const existingConfig = await this.readRawConfig(configPath, parserType)

    switch (parserType) {
      case 'properties':
        return this.mergePropertiesConfig(existingConfig, configData, configSchema)
      case 'configobj':
        return this.mergeConfigObjConfig(existingConfig, configData, configSchema)
      case 'yaml':
      case 'ruamel.yaml':
      case 'json':
      case 'toml':
        return this.mergeStructuredConfig(existingConfig, configData, configSchema)
      default:
        throw new Error(`不支持的解析器类型: ${parserType}`)
    }
  }

  private async readRawConfig(configPath: string, parserType: string): Promise<RawConfigObject> {
    try {
      await fs.access(configPath)
    } catch {
      return {}
    }

    switch (parserType) {
      case 'properties':
        return await this.parseRawProperties(configPath)
      case 'configobj':
        return await this.parseRawConfigObj(configPath)
      case 'yaml':
      case 'ruamel.yaml':
        return await this.parseRawYaml(configPath)
      case 'json':
        return await this.parseRawJson(configPath)
      case 'toml':
        return await this.parseRawToml(configPath)
      default:
        return {}
    }
  }

  private async parseRawProperties(configPath: string): Promise<RawConfigObject> {
    const properties = PropertiesReader(configPath)
    const rawData = properties.getAllProperties() || {}
    return this.cloneRawObject(rawData)
  }

  private async parseRawConfigObj(configPath: string): Promise<RawConfigObject> {
    const content = await fs.readFile(configPath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const parsedData: RawConfigObject = {}
    let currentSection = ''

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
        continue
      }

      const sectionMatch = trimmedLine.match(/^\[(.+)\]$/)
      if (sectionMatch) {
        currentSection = sectionMatch[1]
        if (!this.isPlainObject(parsedData[currentSection])) {
          parsedData[currentSection] = {}
        }
        continue
      }

      const keyValueMatch = trimmedLine.match(/^([^=]+)=(.*)$/)
      if (keyValueMatch && currentSection) {
        const key = keyValueMatch[1].trim()
        const value = keyValueMatch[2].trim()
        const sectionData = this.ensureObjectContainer(parsedData, currentSection)
        sectionData[key] = value
      }
    }

    return parsedData
  }

  private async parseRawYaml(configPath: string): Promise<RawConfigObject> {
    const content = await fs.readFile(configPath, 'utf-8')
    const rawData = YAML.parse(content) || {}
    return this.cloneRawObject(rawData)
  }

  private async parseRawJson(configPath: string): Promise<RawConfigObject> {
    const content = await fs.readFile(configPath, 'utf-8')
    const rawData = JSON.parse(content)
    return this.cloneRawObject(rawData || {})
  }

  private async parseRawToml(configPath: string): Promise<RawConfigObject> {
    const content = await fs.readFile(configPath, 'utf-8')
    const rawData = TOML.parse(content) || {}
    return this.cloneRawObject(rawData)
  }

  private mergePropertiesConfig(
    existingConfig: RawConfigObject,
    configData: ParsedConfigData,
    configSchema: GameConfigSchema
  ): RawConfigObject {
    const mergedConfig = this.cloneRawObject(existingConfig)

    for (const section of configSchema.sections) {
      const sectionData = configData[section.key] || {}

      for (const field of section.fields) {
        const value = sectionData[field.name]
        if (value === undefined) {
          continue
        }

        mergedConfig[field.name] = field.type === 'nested' && field.nested_fields
          ? this.formatNestedValue(value, field.nested_fields, existingConfig[field.name])
          : this.normalizeScalarValue(value, field.type)
      }
    }

    return mergedConfig
  }

  private mergeConfigObjConfig(
    existingConfig: RawConfigObject,
    configData: ParsedConfigData,
    configSchema: GameConfigSchema
  ): RawConfigObject {
    const mergedConfig = this.cloneRawObject(existingConfig)

    for (const section of configSchema.sections) {
      const sectionData = configData[section.key] || {}
      const targetSection = this.ensureObjectContainer(mergedConfig, section.key)
      const existingSection = this.isPlainObject(existingConfig[section.key]) ? existingConfig[section.key] as RawConfigObject : {}

      for (const field of section.fields) {
        const value = sectionData[field.name]
        if (value === undefined) {
          continue
        }

        if (field.type === 'nested' && field.nested_fields) {
          targetSection[field.name] = this.formatNestedValue(value, field.nested_fields, existingSection[field.name])
        } else {
          targetSection[field.name] = this.normalizeScalarValue(value, field.type)
        }
      }
    }

    return mergedConfig
  }

  private mergeStructuredConfig(
    existingConfig: RawConfigObject,
    configData: ParsedConfigData,
    configSchema: GameConfigSchema
  ): RawConfigObject {
    const mergedConfig = this.cloneRawObject(existingConfig)

    for (const section of configSchema.sections) {
      const sectionData = configData[section.key] || {}
      const targetContainer = section.key === ''
        ? mergedConfig
        : this.ensureObjectContainer(mergedConfig, section.key)
      const existingContainer = section.key === ''
        ? existingConfig
        : (this.isPlainObject(existingConfig[section.key]) ? existingConfig[section.key] as RawConfigObject : {})

      for (const field of section.fields) {
        const value = sectionData[field.name]
        if (value === undefined) {
          continue
        }

        if (field.type === 'nested' && field.nested_fields && this.isPlainObject(value)) {
          const existingNested = this.isPlainObject(existingContainer[field.name])
            ? existingContainer[field.name] as RawConfigObject
            : {}
          targetContainer[field.name] = {
            ...this.cloneRawObject(existingNested),
            ...value
          }
        } else {
          targetContainer[field.name] = value
        }
      }
    }

    return mergedConfig
  }

  private isPlainObject(value: unknown): value is RawConfigObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private ensureObjectContainer(target: RawConfigObject, key: string): RawConfigObject {
    if (!this.isPlainObject(target[key])) {
      target[key] = {}
    }

    return target[key] as RawConfigObject
  }

  private cloneRawObject<T>(value: T): T {
    if (value === null || value === undefined) {
      return value
    }

    return structuredClone(value)
  }

  private normalizeScalarValue(value: any, type: string): string | number | boolean {
    switch (type) {
      case 'number':
        return Number(value)
      case 'boolean':
        return Boolean(value)
      case 'string':
      case 'select':
      default:
        return String(value)
    }
  }

  private parseLooseNestedPairs(value: any): RawConfigObject {
    const result: RawConfigObject = {}

    if (typeof value !== 'string') {
      return result
    }

    const cleanValue = value.replace(/^\(|\)$/g, '')
    if (!cleanValue) {
      return result
    }

    const pairs = cleanValue.split(',')
    for (const pair of pairs) {
      const equalIndex = pair.indexOf('=')
      if (equalIndex === -1) {
        continue
      }

      const key = pair.slice(0, equalIndex).trim()
      const fieldValue = pair.slice(equalIndex + 1).trim()
      if (key) {
        result[key] = fieldValue
      }
    }

    return result
  }

  /**
   * 保存为Properties格式
   */
  private async saveWithProperties(configPath: string, configData: RawConfigObject, configSchema: GameConfigSchema): Promise<void> {
    const lines: string[] = []

    for (const [key, value] of Object.entries(configData)) {
      if (value !== undefined && !this.isPlainObject(value)) {
        lines.push(`${key}=${value}`)
      }
    }

    await fs.writeFile(configPath, lines.join('\n'), 'utf-8')
  }

  /**
   * 保存为ConfigObj格式（INI格式）
   */
  private async saveWithConfigObj(configPath: string, configData: RawConfigObject, configSchema: GameConfigSchema): Promise<void> {
    const lines: string[] = []

    for (const [sectionKey, sectionValue] of Object.entries(configData)) {
      if (!this.isPlainObject(sectionValue)) {
        continue
      }

      lines.push(`[${sectionKey}]`)

      for (const [fieldName, fieldValue] of Object.entries(sectionValue)) {
        if (fieldValue !== undefined) {
          lines.push(`${fieldName}=${fieldValue}`)
        }
      }

      lines.push('')
    }

    await fs.writeFile(configPath, lines.join('\n'), 'utf-8')
  }

  /**
   * 保存为YAML格式
   */
  private async saveWithYaml(configPath: string, configData: RawConfigObject, configSchema: GameConfigSchema): Promise<void> {
    const yamlContent = YAML.stringify(configData)
    await fs.writeFile(configPath, yamlContent, 'utf-8')
  }

  /**
   * 保存为JSON格式
   */
  private async saveWithJson(configPath: string, configData: RawConfigObject, configSchema: GameConfigSchema): Promise<void> {
    // 检查是否为扁平结构（section.key 为空字符串）
    const isFlat = configSchema.sections.length === 1 && configSchema.sections[0].key === ''
    
    let jsonData: any
    if (isFlat) {
      // 扁平结构：直接将字段写入 JSON 根级别
      jsonData = configData
    } else {
      // 嵌套结构：保持原有结构
      jsonData = configData
    }
    
    const jsonContent = JSON.stringify(jsonData, null, 2)
    await fs.writeFile(configPath, jsonContent, 'utf-8')
  }

  /**
   * 格式化嵌套值
   */
  private formatNestedValue(value: any, nestedFields: GameConfigField[], existingValue?: any): string {
    if (typeof value === 'object' && value !== null) {
      const existingPairs = this.parseLooseNestedPairs(existingValue)
      const mergedPairs: RawConfigObject = {
        ...existingPairs,
        ...value
      }
      const pairs: string[] = []

      const schemaFieldNames = new Set(nestedFields.map(field => field.name))

      for (const field of nestedFields) {
        const fieldValue = mergedPairs[field.name]
        if (fieldValue !== undefined) {
          pairs.push(`${field.name}=${fieldValue}`)
        }
      }

      for (const [key, fieldValue] of Object.entries(mergedPairs)) {
        if (!schemaFieldNames.has(key) && fieldValue !== undefined) {
          pairs.push(`${key}=${fieldValue}`)
        }
      }

      return `(${pairs.join(',')})`
    }
    
    return String(value)
  }

  /**
   * 使用TOML格式解析配置文件
   */
  private async parseWithToml(configPath: string, configSchema: GameConfigSchema): Promise<ParsedConfigData> {
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      const tomlData = TOML.parse(content) || {}
      const result: ParsedConfigData = {}

      for (const section of configSchema.sections) {
        result[section.key] = {}
        const sectionData = tomlData[section.key] || {}
        
        for (const field of section.fields) {
          const value = sectionData[field.name]
          if (value !== undefined) {
            result[section.key][field.name] = value
          } else {
            result[section.key][field.name] = field.default
          }
        }
      }

      return result
    } catch (error) {
      logger.error('TOML解析失败:', error)
      throw error
    }
  }

  /**
   * 保存为TOML格式
   */
  private async saveWithToml(configPath: string, configData: RawConfigObject, configSchema: GameConfigSchema): Promise<void> {
    try {
      const tomlContent = TOML.stringify(configData)
      await fs.writeFile(configPath, tomlContent, 'utf-8')
    } catch (error) {
      logger.error('TOML保存失败:', error)
      throw error
    }
  }
}
