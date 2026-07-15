import { GM_getValue, GM_setValue, GM_xmlhttpRequest } from '$'

type TextBlock = {
  type: 'heading' | 'paragraph' | 'quote' | 'bulletList' | 'numberList' | 'divider'
  text?: string
  items?: string[]
  level?: 1 | 2 | 3
  bold?: boolean
  italic?: boolean
  underline?: boolean
  link?: string
  color?: string
  backgroundColor?: string
  fontSize?: 1 | 2 | 3 | 4 | 5 | 6 | 7
  align?: 'left' | 'center' | 'right'
}

type ImageBlock = {
  type: 'image'
  fileName: string
  alt?: string
  caption?: string
  width?: number
}

type ArticleBlock = TextBlock | ImageBlock

type RichArticle = {
  schema: 'kintone-rich-article.v1'
  id?: string
  version?: string
  title?: string
  blocks: ArticleBlock[]
}

type PackageTarget = {
  alias: string
  label?: string | null
  origins: string[]
  spaceId: string
  threadId: string
}

type BridgePackage = {
  schema: 'kintone-space-writer.bridge-package.v1'
  id: string
  version: string
  hash: string
  status: 'ready'
  target: PackageTarget
  article: RichArticle
  assets: Record<string, string>
}

type BridgeHealth = {
  service: 'kintone-space-writer-bridge'
  version: number
  instanceId: string
  port: number
  token: string
}

type BridgeConnection = {
  port: number
  token: string
  instanceId: string
}

type PageTarget = {
  origin: string
  spaceId: string
  threadId: string
}

type EditorCandidate = {
  element: HTMLElement
  score: number
}

type GmResponse<T = unknown> = {
  status: number
  statusText: string
  response: T
  responseText: string
}

declare const unsafeWindow: Window

const ROOT_ID = 'ksw-standard-panel'
const STYLE_ID = `${ROOT_ID}-style`
const HIGHLIGHT_CLASS = `${ROOT_ID}-editor`
const SERVICE_NAME = 'kintone-space-writer-bridge'
const PORT_START = 8787
const PORT_END = 8807
const AUTO_KEY = 'ksw-standard-auto-inject'
const CLIENT_KEY = 'ksw-standard-client-id'
const PORTS_KEY = 'ksw-standard-bridge-ports'
const INJECTED_KEY = 'ksw-standard-injected-packages'
const DISCOVERY_INTERVAL_MS = 5000
const CONNECTION_GRACE_MS = 60000
const POLL_INTERVAL_MS = 1500
const DEV_MODE = import.meta.env.DEV
const DEV_LABEL = 'DEV 0.2.5'

let editor: HTMLElement | null = null
let busy = false
let connections: BridgeConnection[] = []
let lastDiscovery = 0
let lastConnectedAt = 0
let discoveryInFlight: Promise<BridgeConnection[]> | null = null
let pollTimer: number | null = null

function debugStage(stage: string, message: string, detail?: Record<string, unknown>) {
  if (!DEV_MODE) return
  console.info(`[KSW ${DEV_LABEL}] ${stage} ${message}`, detail ?? '')
  renderMessage(`[${stage}] ${message}`, 'working')
}

function isThreadPage() {
  return /\/space\/\d+\/thread\/\d+/i.test(location.href)
}

function currentTarget(): PageTarget | null {
  const match = location.href.match(/\/space\/(\d+)\/thread\/(\d+)/i)
  if (!match) return null
  return { origin: location.origin.toLowerCase(), spaceId: match[1], threadId: match[2] }
}

function clientId() {
  const existing = GM_getValue<string>(CLIENT_KEY, '')
  if (existing) return existing
  const created = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `client-${Date.now()}-${Math.random()}`
  GM_setValue(CLIENT_KEY, created)
  return created
}

function gmRequest<T>(options: {
  method?: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  data?: string
  responseType?: 'json' | 'blob'
  timeout?: number
}): Promise<GmResponse<T>> {
  if (DEV_MODE) {
    const parsed = new URL(options.url)
    debugStage('HTTP→', `${options.method ?? 'GET'} ${parsed.pathname}`, { port: parsed.port })
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let abortRequest: (() => void) | null = null
    const timeout = options.timeout ?? 1500
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(fallbackTimer)
      action()
    }
    const fallbackTimer = window.setTimeout(
      () => finish(() => {
        abortRequest?.()
        debugStage('HTTP×', `兜底超时 ${new URL(options.url).pathname}`)
        reject(new Error('本地 Bridge 请求超时'))
      }),
      timeout + 500,
    )
    const control = GM_xmlhttpRequest({
      method: options.method ?? 'GET',
      url: options.url,
      headers: options.headers,
      data: options.data,
      responseType: options.responseType ?? 'json',
      timeout,
      onload: (response) => finish(() => {
        debugStage('HTTP←', `${response.status} ${new URL(options.url).pathname}`)
        resolve(response as GmResponse<T>)
      }),
      onerror: () => finish(() => {
        debugStage('HTTP×', `请求失败 ${new URL(options.url).pathname}`)
        reject(new Error('本地 Bridge 请求失败'))
      }),
      ontimeout: () => finish(() => {
        debugStage('HTTP×', `请求超时 ${new URL(options.url).pathname}`)
        reject(new Error('本地 Bridge 请求超时'))
      }),
    })
    abortRequest = () => (control as unknown as { abort?: () => void }).abort?.()
  })
}

async function probePort(port: number, timeout = 900): Promise<BridgeConnection | null> {
  try {
    const response = await gmRequest<BridgeHealth>({
      url: `http://127.0.0.1:${port}/health`,
      timeout,
    })
    const health = response.response
    if (response.status !== 200 || health?.service !== SERVICE_NAME || !health.token) return null
    return { port, token: health.token, instanceId: health.instanceId }
  } catch {
    return null
  }
}

async function performDiscovery(force: boolean) {
  debugStage('D1', `开始发现 Bridge${force ? '（强制）' : ''}`)
  const now = Date.now()
  const previousConnections = connections
  const previousCount = connections.length
  const cached = GM_getValue<number[]>(PORTS_KEY, [])
  const knownPorts = [...new Set([...connections.map((connection) => connection.port), ...cached])]
  let known = (await Promise.all(knownPorts.map((port) => probePort(port, 5000)))).filter(
    (value): value is BridgeConnection => Boolean(value),
  )
  if (!known.length && knownPorts.length) {
    await delay(250)
    known = (await Promise.all(knownPorts.map((port) => probePort(port, 5000)))).filter(
      (value): value is BridgeConnection => Boolean(value),
    )
  }
  let found = known
  const graceActive = previousConnections.length > 0 && now - lastConnectedAt < CONNECTION_GRACE_MS
  if (!known.length && !graceActive) {
    const knownSet = new Set(knownPorts)
    const remainingPorts = Array.from(
      { length: PORT_END - PORT_START + 1 },
      (_, index) => PORT_START + index,
    ).filter((port) => !knownSet.has(port))
    for (const port of remainingPorts) {
      const connection = await probePort(port)
      if (connection) {
        found = [connection]
        break
      }
    }
  }
  const completedAt = Date.now()
  if (found.length) {
    connections = found
    lastConnectedAt = completedAt
  } else if (previousConnections.length && completedAt - lastConnectedAt < CONNECTION_GRACE_MS) {
    connections = previousConnections
  } else {
    connections = []
  }
  lastDiscovery = now
  GM_setValue(PORTS_KEY, connections.map((connection) => connection.port))
  renderConnection(connections.length)
  debugStage('D1✓', `发现 ${connections.length} 个 Bridge`, {
    ports: connections.map((connection) => connection.port),
  })
  if (previousCount === 0 && connections.length > 0 && autoEnabled() && !busy) {
    window.setTimeout(() => void checkAndInject(false), 0)
  }
  return connections
}

async function discoverBridges(force = false) {
  const now = Date.now()
  if (!force && connections.length && now - lastDiscovery < DISCOVERY_INTERVAL_MS) return connections
  if (discoveryInFlight) return discoveryInFlight
  discoveryInFlight = performDiscovery(force)
  try {
    return await discoveryInFlight
  } finally {
    discoveryInFlight = null
  }
}

function authorizedBridgeUrl(connection: BridgeConnection, value: string) {
  const url = new URL(value, `http://127.0.0.1:${connection.port}`)
  url.searchParams.set('bridgeToken', connection.token)
  return url.href
}

async function getReady(connection: BridgeConnection, target: PageTarget): Promise<BridgePackage | null> {
  debugStage('D3', `读取 ${connection.port} 的 Ready 草稿`, {
    origin: target.origin,
    spaceId: target.spaceId,
    threadId: target.threadId,
  })
  const query = new URLSearchParams({ ...target, bridgeToken: connection.token })
  const response = await gmRequest<BridgePackage | { error?: string; count?: number }>({
    url: `http://127.0.0.1:${connection.port}/v1/ready?${query}`,
    timeout: 10000,
  })
  if (response.status === 204) return null
  if (response.status === 409) throw new Error('当前目标存在多个 Ready 草稿，请先在本地处理冲突。')
  if (response.status !== 200) throw new Error(`读取 Ready 草稿失败：HTTP ${response.status}`)
  return response.response as BridgePackage
}

async function findReady(target: PageTarget, bridges: BridgeConnection[]) {
  debugStage('D2', `使用已验证的 ${bridges.length} 个连接检查 Ready`)
  const matches: Array<{ connection: BridgeConnection; package: BridgePackage }> = []
  for (const connection of bridges) {
    const packageValue = await getReady(connection, target)
    if (packageValue) matches.push({ connection, package: packageValue })
  }
  if (matches.length > 1) throw new Error('多个本地工作区同时存在匹配的 Ready 草稿，请只保留一个。')
  return matches[0] ?? null
}

async function postBridge(
  connection: BridgeConnection,
  path: string,
  value: Record<string, unknown>,
) {
  const response = await gmRequest<{ status?: string; error?: string }>({
    method: 'POST',
    url: authorizedBridgeUrl(connection, path),
    data: JSON.stringify(value),
    timeout: 10000,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.response?.error || `Bridge 写入失败：HTTP ${response.status}`)
  }
  return response.response
}

function targetMatches(packageTarget: PackageTarget, page: PageTarget) {
  const origins = packageTarget.origins.map((value) => value.replace(/\/$/, '').toLowerCase())
  return (
    origins.includes(page.origin) &&
    String(packageTarget.spaceId) === page.spaceId &&
    String(packageTarget.threadId) === page.threadId
  )
}

function isVisible(element: HTMLElement) {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 20
}

function scoreEditor(element: HTMLElement): EditorCandidate {
  let score = 0
  const identity = `${element.id} ${element.className} ${element.getAttribute('aria-label') ?? ''}`.toLowerCase()
  const ancestry = Array.from({ length: 5 }, (_, index) => {
    let node: HTMLElement | null = element
    for (let step = 0; step <= index; step += 1) node = node?.parentElement ?? null
    return node ? `${node.id} ${node.className}` : ''
  }).join(' ').toLowerCase()
  if (element.isContentEditable) score += 40
  if (element instanceof HTMLTextAreaElement) score += 25
  if (element.getAttribute('role') === 'textbox') score += 20
  if (/(comment|reply|thread|post|message|コメント|回复|回覆|發帖|发帖)/.test(`${identity} ${ancestry}`)) score += 25
  if (element.closest(`#${ROOT_ID}`)) score -= 200
  if (!isVisible(element)) score -= 100
  if (element.getAttribute('aria-hidden') === 'true') score -= 100
  return { element, score }
}

function findEditorCandidates() {
  const selector = '[contenteditable="true"], textarea, [role="textbox"]'
  const unique = new Set(Array.from(document.querySelectorAll<HTMLElement>(selector)))
  return Array.from(unique).map(scoreEditor).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score)
}

function editorCandidateDiagnostics() {
  return findEditorCandidates().slice(0, 5).map((candidate) => ({
    tag: candidate.element.tagName,
    id: candidate.element.id,
    className: String(candidate.element.className),
    role: candidate.element.getAttribute('role'),
    contentEditable: candidate.element.isContentEditable,
    score: candidate.score,
  }))
}

function selectBestEditor() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((element) => element.classList.remove(HIGHLIGHT_CLASS))
  editor = findEditorCandidates()[0]?.element ?? null
  editor?.classList.add(HIGHLIGHT_CLASS)
  if (DEV_MODE) {
    const candidates = editorCandidateDiagnostics()
    debugStage('E1', `找到 ${candidates.length} 个编辑器候选`, { candidates })
  }
  return editor
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isCollapsedCommentTrigger(target: HTMLElement) {
  return target instanceof HTMLTextAreaElement && /(?:^|\s)ocean-ui-comments-commentform-textarea(?:\s|$)/.test(target.className)
}

async function resolveEditor() {
  const target = selectBestEditor()
  if (!target) return null
  if (target.isContentEditable) return target
  debugStage('E2', '等待用户展开评论框', {
    tag: target.tagName,
    id: target.id,
    className: String(target.className),
    collapsedTrigger: isCollapsedCommentTrigger(target),
    candidates: editorCandidateDiagnostics(),
  })
  return null
}

function escapeHtml(value: string) {
  const span = document.createElement('span')
  span.textContent = value
  return span.innerHTML
}

function escapeText(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

function safeLink(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch {
    return ''
  }
}

function safeColor(value?: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : ''
}

function textMarkup(block: TextBlock) {
  const text = escapeText(block.text ?? '')
  const link = block.link ? safeLink(block.link) : ''
  const linked = link
    ? `<a href="${link.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text
  const color = safeColor(block.color)
  const backgroundColor = safeColor(block.backgroundColor)
  const inlineStyle = [color && `color:${color}`, backgroundColor && `background-color:${backgroundColor}`]
    .filter(Boolean)
    .join(';')
  const colored = inlineStyle ? `<span style="${inlineStyle}">${linked}</span>` : linked
  const sized = block.fontSize ? `<font size="${block.fontSize}">${colored}</font>` : colored
  const styled = `${block.bold ? '<strong>' : ''}${block.italic ? '<em>' : ''}${block.underline ? '<u>' : ''}${sized}${block.underline ? '</u>' : ''}${block.italic ? '</em>' : ''}${block.bold ? '</strong>' : ''}`
  const alignment = block.align && ['left', 'center', 'right'].includes(block.align) ? ` style="text-align:${block.align}"` : ''
  switch (block.type) {
    case 'heading':
      return `<div${alignment}><font size="${block.level === 1 ? 6 : block.level === 3 ? 4 : 5}"><strong>${styled}</strong></font></div><div><br></div>`
    case 'quote':
      return `<div${alignment}>「${styled}」</div><div><br></div>`
    case 'bulletList':
      return `<ul>${(block.items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><div><br></div>`
    case 'numberList':
      return `<ol>${(block.items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol><div><br></div>`
    case 'divider':
      return '<div>────────</div><div><br></div>'
    default:
      return `<div${alignment}>${styled || '<br>'}</div><div><br></div>`
  }
}

function getRequestToken() {
  type KintonePageWindow = Window & { kintone?: { getRequestToken?: () => string } }
  const pageWindow = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window) as KintonePageWindow
  return pageWindow.kintone?.getRequestToken?.() || document.querySelector<HTMLInputElement>('input[name="__REQUEST_TOKEN__"]')?.value || ''
}

function imageWidth(block: ImageBlock) {
  const width = block.width ?? 500
  return Number.isInteger(width) && width >= 100 && width <= 750 ? width : 500
}

async function loadAsset(
  connection: BridgeConnection,
  packageValue: BridgePackage,
  block: ImageBlock,
) {
  const url = packageValue.assets[block.fileName]
  if (!url) throw new Error(`Bridge 没有提供图片：${block.fileName}`)
  const response = await gmRequest<Blob>({
    url: authorizedBridgeUrl(connection, url),
    responseType: 'blob',
    timeout: 30000,
  })
  if (response.status !== 200 || !(response.response instanceof Blob)) {
    throw new Error(`读取本地图片失败：${block.fileName}`)
  }
  return new File([response.response], block.fileName, { type: response.response.type || 'application/octet-stream' })
}

async function uploadImage(file: File, block: ImageBlock) {
  const token = getRequestToken()
  if (!token) throw new Error('无法取得 kintone 请求令牌。')
  const width = imageWidth(block)
  const query = new URLSearchParams({ checkThumbnail: 'true', w: String(width), _ref: location.href, name: file.name })
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await fetch(`/k/api/blob/upload.json?${query}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Cybozu-RequestToken': token },
    body: form,
  })
  if (!response.ok) throw new Error(`图片上传失败：HTTP ${response.status}`)
  const payload = (await response.json()) as { success?: boolean; result?: { fileKey?: string; image?: boolean } }
  if (!payload.success || !payload.result?.fileKey) throw new Error(`图片上传没有返回 fileKey：${file.name}`)
  if (payload.result.image === false) throw new Error(`文件不是可预览图片：${file.name}`)
  return { fileKey: payload.result.fileKey, width }
}

function imageMarkup(block: ImageBlock, fileKey: string, width: number) {
  const original = new URLSearchParams({ fileKey, _ref: location.href })
  const preview = new URLSearchParams({ fileKey, w: String(width), _ref: location.href })
  const image = document.createElement('img')
  image.className = 'cybozu-tmp-file'
  image.dataset.original = `/k/api/blob/download.do?${original}`
  image.dataset.file = fileKey
  image.width = width
  image.src = `/k/api/blob/download.do?${preview}`
  image.title = block.alt ?? ''
  const caption = block.caption ? `<div>${escapeHtml(block.caption)}</div>` : ''
  return `<div>${image.outerHTML}<br></div>${caption}<div><br></div>`
}

function validateArticle(article: RichArticle) {
  if (article.schema !== 'kintone-rich-article.v1' || !Array.isArray(article.blocks) || !article.blocks.length) {
    throw new Error('Ready 草稿的文章格式无效。')
  }
  article.blocks.forEach((block, index) => {
    if (block.type === 'image' && !block.fileName) throw new Error(`第 ${index + 1} 个图片块缺少 fileName。`)
  })
}

async function buildMarkup(connection: BridgeConnection, packageValue: BridgePackage) {
  validateArticle(packageValue.article)
  const chunks: string[] = []
  const imageBlocks = packageValue.article.blocks.filter((block): block is ImageBlock => block.type === 'image')
  let imageIndex = 0
  for (const block of packageValue.article.blocks) {
    if (block.type !== 'image') {
      chunks.push(textMarkup(block))
      continue
    }
    imageIndex += 1
    renderMessage(`正在处理图片 ${imageIndex}/${imageBlocks.length}：${block.fileName}`, 'working')
    const file = await loadAsset(connection, packageValue, block)
    const upload = await uploadImage(file, block)
    chunks.push(imageMarkup(block, upload.fileKey, upload.width))
  }
  return chunks.join('')
}

function injectedPackages() {
  return GM_getValue<Record<string, string>>(INJECTED_KEY, {})
}

function rememberInjected(packageValue: BridgePackage) {
  const values = injectedPackages()
  values[packageValue.id] = packageValue.hash
  const recent = Object.entries(values).slice(-100)
  GM_setValue(INJECTED_KEY, Object.fromEntries(recent))
}

async function sendResult(
  connection: BridgeConnection,
  packageValue: BridgePackage,
  status: 'injected' | 'failed',
  error = '',
) {
  await postBridge(connection, `/v1/packages/${encodeURIComponent(packageValue.id)}/result`, {
    hash: packageValue.hash,
    status,
    error,
    pageUrl: location.href,
  })
}

async function injectReady(match: { connection: BridgeConnection; package: BridgePackage }) {
  const page = currentTarget()
  if (!page || !targetMatches(match.package.target, page)) throw new Error('Ready 草稿目标与当前页面不一致。')
  const remembered = injectedPackages()[match.package.id]
  if (remembered === match.package.hash) {
    await sendResult(match.connection, match.package, 'injected')
    renderMessage('该版本已经注入过，已跳过重复操作。', 'warning')
    return
  }
  const target = await resolveEditor()
  if (!target || !target.isContentEditable) {
    renderMessage('请先点击页面里的“发表评论…”展开评论框，展开后会自动继续。', 'warning')
    return
  }
  if ((target.textContent ?? '').trim()) {
    renderMessage('当前编辑器已有内容，为避免覆盖已停止注入。', 'warning')
    return
  }
  await postBridge(match.connection, `/v1/packages/${encodeURIComponent(match.package.id)}/claim`, {
    hash: match.package.hash,
    clientId: clientId(),
    ...page,
  })
  try {
    const markup = await buildMarkup(match.connection, match.package)
    if (!target.isConnected) throw new Error('图片上传期间编辑器已被页面替换。')
    target.focus()
    if (!document.execCommand('insertHTML', false, markup)) throw new Error('浏览器拒绝写入富文本编辑器。')
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    rememberInjected(match.package)
    await sendResult(match.connection, match.package, 'injected')
    renderMessage(`“${match.package.article.title ?? match.package.id}”已注入，请检查后手动发表。`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await sendResult(match.connection, match.package, 'failed', message)
    } catch {
      // Keep the original injection error visible.
    }
    throw error
  }
}

function autoEnabled() {
  return GM_getValue<boolean>(AUTO_KEY, false)
}

function setAutoEnabled(value: boolean) {
  GM_setValue(AUTO_KEY, value)
  const button = document.querySelector<HTMLElement>(`#${ROOT_ID}-manual`)
  if (button) button.hidden = value
  renderMessage(value ? '等待当前目标的 Ready 草稿。' : '自动注入已关闭。', 'normal')
}

function renderConnection(count: number) {
  const element = document.querySelector<HTMLElement>(`#${ROOT_ID}-connection`)
  if (!element) return
  element.dataset.online = count > 0 ? 'true' : 'false'
  element.textContent = count > 0 ? `Bridge 已连接${count > 1 ? `（${count}）` : ''}` : 'Bridge 离线'
}

function renderMessage(message: string, kind: 'normal' | 'working' | 'success' | 'warning' | 'error' = 'normal') {
  const element = document.querySelector<HTMLElement>(`#${ROOT_ID}-message`)
  if (!element) return
  element.textContent = message
  element.dataset.kind = kind
}

async function checkAndInject(manual: boolean) {
  if (busy) return
  const page = currentTarget()
  if (!page) return
  busy = true
  renderMessage(manual ? '正在读取 Ready 草稿…' : 'Bridge 已连接，正在检查 Ready 草稿…', 'working')
  debugStage('C1', `开始${manual ? '手动' : '自动'}检查`)
  try {
    const bridges = await discoverBridges(manual)
    debugStage('C2', `发现流程返回 ${bridges.length} 个连接`)
    if (!bridges.length) {
      renderMessage('Bridge 离线。请先调用插件准备文章。', manual ? 'error' : 'normal')
      return
    }
    const match = await findReady(page, bridges)
    if (!match) {
      renderMessage(manual ? '当前目标没有 Ready 草稿。' : '等待当前目标的 Ready 草稿。', manual ? 'warning' : 'normal')
      return
    }
    await injectReady(match)
  } catch (error) {
    renderMessage(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    busy = false
  }
}

function injectStyles() {
  if (document.querySelector(`#${STYLE_ID}`)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${ROOT_ID} { background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 10px 28px rgba(15,23,42,.18); color:#0f172a; font:13px/1.45 system-ui,sans-serif; padding:13px; position:fixed; right:16px; top:16px; width:260px; z-index:2147483646; }
    #${ROOT_ID} h2 { font-size:15px; margin:0 0 10px; }
    #${ROOT_ID}-connection { align-items:center; color:#b91c1c; display:flex; gap:7px; margin-bottom:10px; }
    #${ROOT_ID}-connection::before { background:#dc2626; border-radius:50%; content:''; height:8px; width:8px; }
    #${ROOT_ID}-connection[data-online="true"] { color:#166534; }
    #${ROOT_ID}-connection[data-online="true"]::before { background:#16a34a; }
    #${ROOT_ID} .switch-row { align-items:center; display:flex; justify-content:space-between; margin:9px 0; }
    #${ROOT_ID} input { height:18px; width:18px; }
    #${ROOT_ID} button { background:#2563eb; border:1px solid #2563eb; border-radius:5px; color:#fff; cursor:pointer; font:inherit; padding:7px 10px; width:100%; }
    #${ROOT_ID}-message { background:#f1f5f9; border-radius:5px; margin:10px 0 0; padding:8px; }
    #${ROOT_ID}-message[data-kind="success"] { background:#f0fdf4; color:#166534; }
    #${ROOT_ID}-message[data-kind="warning"] { background:#fff7ed; color:#9a3412; }
    #${ROOT_ID}-message[data-kind="error"] { background:#fef2f2; color:#b91c1c; }
    #${ROOT_ID}-message[data-kind="working"] { background:#eff6ff; color:#1d4ed8; }
    .${HIGHLIGHT_CLASS} { outline:3px solid #2563eb !important; outline-offset:2px !important; }
  `
  document.head.append(style)
}

function createPanel() {
  if (!document.body || document.querySelector(`#${ROOT_ID}`) || !isThreadPage()) return
  injectStyles()
  const root = document.createElement('aside')
  root.id = ROOT_ID
  root.innerHTML = `
    <h2>文章注入${DEV_MODE ? ` <small style="color:#2563eb;font-size:11px">${DEV_LABEL}</small>` : ''}</h2>
    <div id="${ROOT_ID}-connection" data-online="false">Bridge 离线</div>
    <label class="switch-row"><span>Ready 后自动注入</span><input id="${ROOT_ID}-auto" type="checkbox"></label>
    <button id="${ROOT_ID}-manual" type="button">手动注入 Ready 文章</button>
    <p id="${ROOT_ID}-message">正在查找本地 Bridge…</p>
  `
  const checkbox = root.querySelector<HTMLInputElement>(`#${ROOT_ID}-auto`)
  const manual = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-manual`)
  if (checkbox) {
    checkbox.checked = autoEnabled()
    checkbox.addEventListener('change', () => {
      setAutoEnabled(checkbox.checked)
      if (checkbox.checked) void checkAndInject(false)
    })
  }
  if (manual) {
    manual.hidden = autoEnabled()
    manual.addEventListener('click', () => void checkAndInject(true))
  }
  document.body.append(root)
  void discoverBridges(true)
    .then(() => {
      if (autoEnabled()) void checkAndInject(false)
      else renderMessage('自动注入已关闭。', 'normal')
    })
    .catch((error) => renderMessage(error instanceof Error ? error.message : String(error), 'error'))
}

function maintainPage() {
  if (isThreadPage()) {
    createPanel()
  } else {
    document.querySelector(`#${ROOT_ID}`)?.remove()
  }
}

async function poll() {
  maintainPage()
  if (isThreadPage()) {
    await discoverBridges()
    if (autoEnabled()) await checkAndInject(false)
  }
}

const observer = new MutationObserver(maintainPage)
observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('hashchange', maintainPage)
window.addEventListener('popstate', maintainPage)
maintainPage()
if (pollTimer === null) {
  pollTimer = window.setInterval(
    () => void poll().catch((error) => renderMessage(error instanceof Error ? error.message : String(error), 'error')),
    POLL_INTERVAL_MS,
  )
}
