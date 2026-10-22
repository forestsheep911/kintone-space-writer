export const CHANNEL = 'ksw-extension.v1'
export const PORT_START = 8787
export const PORT_END = 8807
export const MAX_ASSET_BYTES = 16 * 1024 * 1024
export const MAX_JSON_BYTES = 4 * 1024 * 1024
export const MATCHES = ['cybozu.com', 'cybozu.cn', 'kintone.com', 'cybozu-dev.com'].map(domain => `https://*.${domain}/k/*`)

export function supportedPage(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      /^(?:[a-z0-9-]+\.)+(?:cybozu\.com|cybozu\.cn|kintone\.com|cybozu-dev\.com)$/.test(url.hostname) &&
      url.pathname.startsWith('/k/')
  } catch { return false }
}

export function validSender(sender: chrome.runtime.MessageSender, extensionId: string) {
  return sender.id === extensionId && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && supportedPage(sender.url)
}

export type BridgeRequest = {
  channel: typeof CHANNEL
  kind: 'bridge'
  port: number
  operation: 'health' | 'list' | 'package' | 'asset' | 'claim' | 'result'
  token?: string
  packageId?: string
  assetName?: string
  body?: Record<string, unknown>
}

export function bridgeTarget(input: unknown, pageUrl: string) {
  if (!input || typeof input !== 'object') throw new Error('无效的 Bridge 请求。')
  const value = input as BridgeRequest
  if (value.channel !== CHANNEL || value.kind !== 'bridge' || !Number.isInteger(value.port) || value.port < PORT_START || value.port > PORT_END) throw new Error('Bridge 端口不在允许范围。')
  const operations = ['health', 'list', 'package', 'asset', 'claim', 'result']
  if (!operations.includes(value.operation)) throw new Error('不支持的 Bridge 操作。')
  let path = value.operation === 'health' ? '/health' : '/v1/packages'
  if (value.operation !== 'health' && (typeof value.token !== 'string' || !/^[a-zA-Z0-9_-]{16,256}$/.test(value.token))) throw new Error('缺少有效的 Bridge 凭据。')
  if (!['health', 'list'].includes(value.operation)) {
    if (typeof value.packageId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value.packageId)) throw new Error('无效的文章包标识。')
    path += `/${encodeURIComponent(value.packageId)}`
  }
  if (value.operation === 'asset') {
    if (typeof value.assetName !== 'string' || value.assetName.length > 1024 || !value.assetName || /[\\\u0000-\u001f]/.test(value.assetName) || value.assetName.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('无效的素材路径。')
    path += `/assets/${encodeURIComponent(value.assetName)}`
  }
  let body: Record<string, unknown> | undefined
  if (value.operation === 'claim' || value.operation === 'result') {
    const data = value.body
    if (!data || typeof data.hash !== 'string' || !/^[a-f0-9]{64}$/.test(data.hash)) throw new Error('无效的文章摘要。')
    if (value.operation === 'claim') {
      if (typeof data.clientId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(data.clientId)) throw new Error('无效的客户端标识。')
      body = { hash: data.hash, clientId: data.clientId }
    } else {
      if (!['injected', 'failed'].includes(String(data.status)) || (data.error !== undefined && (typeof data.error !== 'string' || data.error.length > 2000))) throw new Error('无效的写入结果。')
      body = { hash: data.hash, status: data.status, error: data.error ?? '', pageUrl }
    }
    path += `/${value.operation}`
  }
  return { url: `http://127.0.0.1:${value.port}${path}`, body, token: value.operation === 'health' ? undefined : value.token, asset: value.operation === 'asset', health: value.operation === 'health' }
}

export type WireResponse = { ok: true; value: unknown } | { ok: false; error: string }

export async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maximum) throw new Error('Bridge 响应超过大小限制。')
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) throw new Error('Bridge 响应超过大小限制。')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
