const normalizeVersion = (value?: string): string => {
  return value?.trim().replace(/^v(?=\d)/i, '') || ''
}

const injectedVersion = normalizeVersion(__GSM3_BUILD_VERSION__)

export const buildInfo = Object.freeze({
  version: injectedVersion || (import.meta.env.DEV ? '开发版本' : '未标记版本')
})
