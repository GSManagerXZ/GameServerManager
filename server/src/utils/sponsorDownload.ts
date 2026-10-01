import axios from 'axios'
import logger from './logger.js'

/**
 * 赞助者下载通道。
 *
 * 流程与官方赞助者下载脚本一致：
 * 1. 用本地记录的赞助者密钥（激活码）调用下载服务的会话接口，换取会话 Cookie；
 * 2. 带上会话 Cookie 请求同一个文件地址，下载服务会把请求调度到赞助者专用节点。
 *
 * 未记录密钥、密钥无效或服务不可用时，调用方应回退到普通下载通道。
 */

// 赞助者下载服务地址，Java 环境下载链接与它同源
export const SPONSOR_DOWNLOAD_BASE_URL = 'https://download.xiaozhuhouses.asia'

// 建立赞助者下载会话的接口路径
const SPONSOR_SESSION_PATH = '/api/v1/download-auth/session'

// 会话请求超时时间（毫秒）
const SPONSOR_SESSION_TIMEOUT = 15000

export interface SponsorDownloadSession {
  /** 可直接用于下载请求的 Cookie 请求头 */
  cookie: string
  /** 会话过期时间（上游返回时才有） */
  expiresAt?: string
}

/**
 * 判断地址是否属于赞助者下载服务域名。
 * 只有该域名的地址才会携带会话 Cookie，避免把密钥换来的会话泄露到第三方地址。
 */
export function isSponsorDownloadUrl(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(SPONSOR_DOWNLOAD_BASE_URL).hostname
  } catch {
    return false
  }
}

/**
 * 使用赞助者密钥建立下载会话。
 * 成功返回会话 Cookie；失败抛出中文错误，由调用方决定是否回退普通通道。
 */
export async function createSponsorDownloadSession(activationCode: string): Promise<SponsorDownloadSession> {
  const response = await axios.post(
    `${SPONSOR_DOWNLOAD_BASE_URL}${SPONSOR_SESSION_PATH}`,
    { activation_code: activationCode },
    {
      timeout: SPONSOR_SESSION_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GSManager3/1.0.0'
      },
      // 状态码交给下面自行判断，便于把上游的中文提示透传给日志
      validateStatus: () => true
    }
  )

  const rawCookies = response.headers['set-cookie']
  const cookie = (Array.isArray(rawCookies) ? rawCookies : [])
    .map(item => String(item).split(';')[0].trim())
    .filter(Boolean)
    .join('; ')

  const data = response.data as { status?: string; message?: string } | undefined

  if (response.status !== 200 || data?.status !== 'ok') {
    throw new Error(data?.message || `赞助者下载会话建立失败（HTTP ${response.status}）`)
  }

  if (!cookie) {
    throw new Error('赞助者下载会话未返回 Cookie')
  }

  logger.info('赞助者下载会话建立成功，本次下载将使用赞助者专用通道')

  return {
    cookie,
    expiresAt: typeof (data as { expires_at?: string }).expires_at === 'string'
      ? (data as { expires_at?: string }).expires_at
      : undefined
  }
}