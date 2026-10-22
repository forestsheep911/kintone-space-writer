import { CHANNEL, bridgeTarget, MAX_ASSET_BYTES, MAX_JSON_BYTES, readBounded, validSender } from './protocol'

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || (message as { channel?: string }).channel !== CHANNEL) return false
  if (!validSender(sender, chrome.runtime.id)) {
    sendResponse({ ok: false, error: '请求来源不被允许。' })
    return false
  }
  void (async () => {
    if ((message as { kind?: string }).kind === 'options') {
      await chrome.runtime.openOptionsPage()
      return null
    }
    if ((message as { kind?: string }).kind === 'token') {
      // Fixed function only; no page-provided script or arguments are executed.
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab!.id!, ...(sender.documentId ? { documentIds: [sender.documentId] } : { frameIds: [0] }) },
        world: 'MAIN',
        func: () => {
          const page = window as Window & { kintone?: { getRequestToken?: () => string } }
          return page.kintone?.getRequestToken?.() || document.querySelector<HTMLInputElement>('input[name="__REQUEST_TOKEN__"]')?.value || ''
        },
      })
      const token = results[0]?.result
      if (typeof token !== 'string' || token.length > 4096) throw new Error('无法取得 kintone 请求令牌。')
      return token
    }
    const target = bridgeTarget(message, sender.url!)
    const response = await fetch(target.url, {
      method: target.body ? 'POST' : 'GET',
      headers: { ...(target.token ? { 'X-KSW-Bridge-Token': target.token } : {}), ...(target.body ? { 'Content-Type': 'application/json' } : {}) },
      body: target.body ? JSON.stringify(target.body) : undefined,
      credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(target.asset ? 25000 : target.health ? 1200 : 10000),
    })
    const bytes = await readBounded(response, target.asset ? MAX_ASSET_BYTES : MAX_JSON_BYTES)
    let payload: unknown
    if (target.asset && response.ok) {
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
      payload = { base64: btoa(binary), mime: response.headers.get('content-type') ?? 'application/octet-stream' }
    } else {
      try { payload = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('Bridge 返回了无效的 JSON。') }
    }
    return { status: response.status, statusText: response.statusText, response: payload }
  })().then(value => sendResponse({ ok: true, value }), error => sendResponse({ ok: false, error: error instanceof Error ? error.message : '扩展后台请求失败。' }))
  return true
})

chrome.action.onClicked.addListener(() => { void chrome.runtime.openOptionsPage() })
