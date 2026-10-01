// 赞助者密钥记录结构
export interface SponsorKeyInfo {
  key: string
  savedAt: string
}

/**
 * 本地是否已记录赞助者密钥。
 *
 * 用于「只需要密钥本身」的功能，例如 Java 环境赞助者下载通道：
 * 这类功能会在实际调用时由服务端判断密钥是否有效，失败则自动回退普通通道。
 */
export function hasSponsorKey(keyInfo?: SponsorKeyInfo | null): boolean {
  return !!keyInfo?.key
}

/**
 * 赞助者身份是否已确认。
 *
 * 说明：赞助者密钥现已改为「仅在本地记录」，不再做在线校验，
 * 因此这里暂时统一返回未确认，依赖校验结果的功能（顶栏标识、在线部署）保持「未配置」状态。
 * 后续需要恢复时，只需在本文件实现判定逻辑，调用方无需改动。
 */
export function isSponsorActive(_keyInfo?: SponsorKeyInfo | null): boolean {
  return false
}