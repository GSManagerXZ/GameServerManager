import axios from 'axios'
import os from 'os'
import logger from './logger.js'

// 远程资源地址集中维护：实例市场清单与 Steam 游戏部署清单使用同一套基础地址，
// 避免各处硬编码造成链接不一致（设置页更新按钮、定时任务、游戏部署页面共用）
const FILES_BASE_URL = 'https://web.files.xiaozhuhouses.asia/files'
const PROJECT_DIRECTORY = '开源项目/GameServerManager'

// Steam 游戏部署清单（installgame.json）远程地址
export const STEAM_GAME_LIST_URL = `${FILES_BASE_URL}/${PROJECT_DIRECTORY}/installgame.json`

// 实例市场清单远程地址，按运行平台区分
export const INSTANCE_MARKET_URLS = {
  Linux: `${FILES_BASE_URL}/${PROJECT_DIRECTORY}/Instance/Instance_Linux.json`,
  Windows: `${FILES_BASE_URL}/${PROJECT_DIRECTORY}/Instance/Instance_Windows.json`
}

// 一键开服（原「在线部署」）云端清单地址，替代旧的第三方在线游戏接口
export const ONE_CLICK_DEPLOY_LIST_URL = `${FILES_BASE_URL}/${PROJECT_DIRECTORY}/oneClickDeploy.json`

export type InstanceMarketSystemType = keyof typeof INSTANCE_MARKET_URLS

export interface RemoteMarketInstance {
  name: string
  command: string
  stopcommand?: string
}

export interface InstanceMarketFetchOptions {
  // 请求超时时间（毫秒），默认 10 秒
  timeoutMs?: number
  // 请求方标识，便于来源区分
  userAgent?: string
}

// 根据当前运行平台推断实例市场清单类型
export function getInstanceMarketSystemType(): InstanceMarketSystemType {
  return os.platform() === 'win32' ? 'Windows' : 'Linux'
}

// 获取实例市场清单地址，未匹配到时回退到 Linux 清单
export function getInstanceMarketUrl(systemType?: string): string {
  return INSTANCE_MARKET_URLS[systemType as InstanceMarketSystemType] || INSTANCE_MARKET_URLS.Linux
}

// 拉取实例市场清单，返回 instances 数组
export async function fetchInstanceMarketList(
  systemType?: string,
  options: InstanceMarketFetchOptions = {}
): Promise<RemoteMarketInstance[]> {
  const marketUrl = getInstanceMarketUrl(systemType || getInstanceMarketSystemType())
  const { timeoutMs = 10000, userAgent = 'GSM3-Server/1.0' } = options

  logger.info(`请求实例市场数据: ${marketUrl}`)

  const response = await axios.get(marketUrl, {
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent
    }
  })

  const instances = response.data?.instances
  if (!Array.isArray(instances)) {
    throw new Error('实例市场数据格式无效：缺少 instances 数组')
  }

  return instances as RemoteMarketInstance[]
}