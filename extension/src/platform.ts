import { CHANNEL, type BridgeRequest, type WireResponse } from './protocol'

let preferences: Record<string, unknown> = {}
export async function initializePreferences() {
  preferences = await chrome.storage.local.get(null)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    for (const [key, change] of Object.entries(changes)) {
      if (change.newValue === undefined) delete preferences[key]
      else preferences[key] = change.newValue
    }
    window.dispatchEvent(new Event('ksw-preferences-changed'))
  })
}
export function getValue<T>(key: string, fallback: T): T { return (preferences[key] ?? fallback) as T }
export async function setValue(key: string, value: unknown) {
  // Persist individual keys; concurrent tabs never overwrite a whole snapshot.
  await chrome.storage.local.set({ [key]: value })
  preferences[key] = value
}
export async function request<T>(message: object): Promise<T> {
  const response = await chrome.runtime.sendMessage({ ...message, channel: CHANNEL }) as WireResponse | undefined
  if (!response) throw new Error('扩展连接已失效，请刷新 kintone 页面。')
  if (!response.ok) throw new Error(response.error)
  return response.value as T
}
export function getRequestToken() { return request<string>({ kind: 'token' }) }
export type BridgeOptions = Omit<BridgeRequest, 'channel' | 'kind'>
export async function bridgeRequest<T>(options: BridgeOptions) {
  const result = await request<{ status: number; statusText: string; response: unknown }>({ ...options, kind: 'bridge' })
  if (options.operation === 'asset' && result.status === 200) {
    const asset = result.response as { base64: string; mime: string }
    const bytes = Uint8Array.from(atob(asset.base64), character => character.charCodeAt(0))
    return { ...result, response: new Blob([bytes], { type: asset.mime }) as T, responseText: '' }
  }
  return { ...result, response: result.response as T, responseText: '' }
}
