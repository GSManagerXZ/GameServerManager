import { ConfigManager } from '../modules/config/ConfigManager.js'

/**
 * 读取本地记录的赞助者密钥。
 * 密钥仅保存在本地配置中，未记录时返回 null。
 */
export function getSponsorKey(configManager?: ConfigManager): string | null {
  const key = configManager?.getSponsorConfig()?.key

  if (typeof key !== 'string' || !key.trim()) {
    return null
  }

  return key.trim()
}

/**
 * 是否已在本地记录赞助者密钥。
 *
 * 用于「只需要密钥本身」的功能，例如 Java 环境赞助者下载通道：
 * 这类功能会在实际调用时由服务端自行判断密钥是否有效，失败则自动回退普通通道。
 */
export function hasSponsorKey(configManager?: ConfigManager): boolean {
  return getSponsorKey(configManager) !== null
}

/**
 * 赞助者身份是否已确认。
 *
 * 说明：赞助者密钥现已改为「仅在本地记录」，不再调用第三方接口校验，
 * 因此这里暂时统一返回未确认，依赖校验结果的功能保持「未配置」状态。
 * 一键开服（原在线部署）已改为在下载环节按本地密钥区分下载通道，不再依赖该校验结果。
 * 后续需要恢复时，只需在本文件实现判定逻辑，调用方无需改动。
 */
export function isSponsorUnlocked(_configManager?: ConfigManager): boolean {
  return false
}