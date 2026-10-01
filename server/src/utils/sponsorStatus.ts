import { ConfigManager } from '../modules/config/ConfigManager.js'

/**
 * 赞助者身份判定统一入口。
 *
 * 说明：赞助者密钥现已改为「仅在本地记录」，不再调用第三方接口校验。
 * 因此这里暂时统一返回未解锁，相关功能区降级为「未配置」状态。
 * 后续功能区需要接入赞助者能力时，只需在本文件实现判定逻辑
 * （例如读取 configManager 中本地记录的密钥），调用方无需改动。
 */
export function isSponsorUnlocked(_configManager?: ConfigManager): boolean {
  return false
}