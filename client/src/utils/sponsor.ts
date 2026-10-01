// 赞助者密钥记录结构
export interface SponsorKeyInfo {
  key: string
  savedAt: string
}

/**
 * 赞助者身份判定统一入口。
 *
 * 说明：赞助者密钥现已改为「仅在本地记录」，不再做在线校验，
 * 因此这里暂时统一返回未启用，各功能区降级为「未配置」状态。
 * 后续功能区需要接入赞助者能力时，只需在本文件实现判定逻辑
 * （例如 return !!keyInfo?.key），调用方无需改动。
 */
export function isSponsorActive(_keyInfo?: SponsorKeyInfo | null): boolean {
  return false
}