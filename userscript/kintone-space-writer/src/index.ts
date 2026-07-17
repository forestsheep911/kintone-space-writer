import { GM_getValue, GM_setValue, GM_xmlhttpRequest } from '$'

import { editorSessionChanged } from './editor-image-session'
import { clampPanelPosition, type PanelPosition } from './panel-position'
import { imageCacheKey, newestVersionsFirst, type VersionSummary } from './version-picker'

type MentionEntityType = 'USER' | 'GROUP' | 'ORGANIZATION'

type MentionRequest = {
  query: string
  entityType?: MentionEntityType
}

type MentionCandidate = {
  entityType: MentionEntityType
  id: string
  code: string
  name: string
  icon?: string
}

type TextRun = {
  text?: string
  mention?: MentionRequest
  bold?: boolean
  italic?: boolean
  underline?: boolean
  link?: string
  color?: string
  backgroundColor?: string
  fontSize?: 1 | 2 | 3 | 4 | 5 | 6 | 7
}

type TextBlock = {
  type: 'heading' | 'paragraph' | 'quote' | 'bulletList' | 'numberList' | 'divider'
  text?: string
  runs?: TextRun[]
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

type ImageRowBlock = {
  type: 'imageRow'
  images: ImageBlock[]
  align?: 'left' | 'center' | 'right'
}

type ArticleBlock = TextBlock | ImageBlock | ImageRowBlock

type RichArticle = {
  schema: 'kintone-rich-article.v1'
  id?: string
  version?: string
  title?: string
  revisionNote?: string
  blocks: ArticleBlock[]
}

type BridgePackage = {
  schema: 'kintone-space-writer.bridge-package.v1'
  id: string
  version: string
  hash: string
  status: 'ready' | 'claimed' | 'injected' | 'failed'
  article: RichArticle
  assets: Record<string, string>
  assetDigests: Record<string, string>
}

type BridgePackageSummary = VersionSummary & {
  id: string
  articleId: string | null
  title: string | null
  revisionNote: string | null
  version: string
  hash: string
  status: BridgePackage['status']
  updatedAt: string
}

type VersionMatch = VersionSummary & {
  connection: BridgeConnection
  summary: BridgePackageSummary
}

type ArticleVersionGroup = {
  articleId: string
  title: string
  versions: VersionMatch[]
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
const SERVICE_NAME = 'kintone-space-writer-bridge'
const PORT_START = 8787
const PORT_END = 8807
const CLIENT_KEY = 'ksw-standard-client-id'
const PORTS_KEY = 'ksw-standard-bridge-ports'
const PANEL_STATE_KEY = 'ksw-standard-panel-state'
const DEV_MODE = import.meta.env.DEV
const DEV_LABEL = 'DEV 0.2.5'

let editor: HTMLElement | null = null
let busy = false
let connections: BridgeConnection[] = []
let discoveryInFlight: Promise<BridgeConnection[]> | null = null
let versionMatches: VersionMatch[] = []
let imageFileKeys = new Map<string, string>()
let imageCacheEditor: HTMLElement | null = null
let reusableImagePackageIds = new Set<string>()
let collapsedArticleIds = new Set<string>()
let writeAbortController: AbortController | null = null
let mentionSelection: { resolve: (candidate: MentionCandidate) => void; reject: (error: Error) => void } | null = null

type PanelState = PanelPosition & { collapsed: boolean }

function debugStage(_stage: string, _message: string, _detail?: Record<string, unknown>) {}

function isThreadPage() {
  return /\/space\/\d+\/thread\/\d+/i.test(location.href)
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

async function performDiscovery() {
  const cached = GM_getValue<number[]>(PORTS_KEY, [])
  const ports = [...new Set([...cached, ...Array.from({ length: PORT_END - PORT_START + 1 }, (_, index) => PORT_START + index)])]
  connections = (await Promise.all(ports.map((port) => probePort(port)))).filter(
    (value): value is BridgeConnection => Boolean(value),
  )
  GM_setValue(PORTS_KEY, connections.map((connection) => connection.port))
  renderConnection(connections.length)
  return connections
}

async function discoverBridges() {
  if (discoveryInFlight) return discoveryInFlight
  discoveryInFlight = performDiscovery()
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

async function listVersions(connection: BridgeConnection): Promise<BridgePackageSummary[]> {
  const query = new URLSearchParams({ bridgeToken: connection.token })
  const response = await gmRequest<{ packages?: BridgePackageSummary[]; error?: string }>({
    url: `http://127.0.0.1:${connection.port}/v1/packages?${query}`,
    timeout: 10000,
  })
  if (response.status !== 200) throw new Error(response.response?.error || `读取版本列表失败：HTTP ${response.status}`)
  return response.response.packages ?? []
}

async function getPackage(connection: BridgeConnection, packageId: string): Promise<BridgePackage> {
  const query = new URLSearchParams({ bridgeToken: connection.token })
  const response = await gmRequest<BridgePackage | { error?: string }>({
    url: `http://127.0.0.1:${connection.port}/v1/packages/${encodeURIComponent(packageId)}?${query}`,
    timeout: 10000,
  })
  if (response.status !== 200) {
    const error = 'error' in response.response ? response.response.error : undefined
    throw new Error(error || `读取文章版本失败：HTTP ${response.status}`)
  }
  return response.response as BridgePackage
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
  editor = findEditorCandidates()[0]?.element ?? null
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

function mentionMarkup(candidate: MentionCandidate) {
  const mention = document.createElement('a')
  mention.className = 'ocean-ui-plugin-mention-user ocean-ui-plugin-linkbubble-no'
  mention.dataset.mentionCode = candidate.code
  mention.dataset.mentionIcon = candidate.icon ?? ''
  mention.dataset.mentionName = candidate.name
  mention.tabIndex = -1
  mention.style.setProperty('-webkit-user-modify', 'read-only')
  if (candidate.entityType === 'USER') {
    mention.dataset.mentionId = candidate.id
    mention.href = `/k/#/people/user/${encodeURIComponent(candidate.code)}`
  } else if (candidate.entityType === 'GROUP') {
    mention.dataset.groupMentionId = candidate.id
    mention.href = '#'
  } else {
    mention.dataset.orgMentionId = candidate.id
    mention.href = '#'
  }
  mention.textContent = `@${candidate.name}`
  return `${mention.outerHTML}&nbsp;`
}

function inlineTextMarkup(value: TextRun | TextBlock, mentions = new Map<TextRun, MentionCandidate>()) {
  if ('mention' in value && value.mention) {
    const candidate = mentions.get(value)
    if (!candidate) throw new Error(`尚未解析提及对象：${value.mention.query}`)
    return mentionMarkup(candidate)
  }
  const text = escapeText(value.text ?? '')
  const link = value.link ? safeLink(value.link) : ''
  const linked = link
    ? `<a href="${link.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text
  const color = safeColor(value.color)
  const backgroundColor = safeColor(value.backgroundColor)
  const inlineStyle = [color && `color:${color}`, backgroundColor && `background-color:${backgroundColor}`]
    .filter(Boolean)
    .join(';')
  const colored = inlineStyle ? `<span style="${inlineStyle}">${linked}</span>` : linked
  const sized = value.fontSize ? `<font size="${value.fontSize}">${colored}</font>` : colored
  return `${value.bold ? '<strong>' : ''}${value.italic ? '<em>' : ''}${value.underline ? '<u>' : ''}${sized}${value.underline ? '</u>' : ''}${value.italic ? '</em>' : ''}${value.bold ? '</strong>' : ''}`
}

function textMarkup(block: TextBlock, mentions: Map<TextRun, MentionCandidate>) {
  const styled = block.runs?.length ? block.runs.map((run) => inlineTextMarkup(run, mentions)).join('') : inlineTextMarkup(block)
  const align = block.align && ['left', 'center', 'right'].includes(block.align) ? block.align : 'left'
  const alignment = ` style="text-align:${align}"`
  switch (block.type) {
    case 'heading':
      return `<div${alignment}><font size="${block.level === 1 ? 6 : block.level === 3 ? 4 : 5}"><strong>${styled}</strong></font></div><div><br></div>`
    case 'quote':
      return `<div${alignment}>「${styled}」</div><div><br></div>`
    case 'bulletList':
      return `<ul${alignment}>${(block.items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><div><br></div>`
    case 'numberList':
      return `<ol${alignment}>${(block.items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol><div><br></div>`
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

function currentSpaceId() {
  const match = location.hash.match(/\/space\/(\d+)/i)
  if (!match) throw new Error('无法从当前页面识别 Space。')
  return match[1]
}

function candidateMatchesRequest(candidate: MentionCandidate, request: MentionRequest) {
  if (request.entityType && candidate.entityType !== request.entityType) return false
  const query = request.query.trim().toLocaleLowerCase()
  return candidate.name.toLocaleLowerCase() === query || candidate.code.toLocaleLowerCase() === query
}

async function searchMentionCandidates(request: MentionRequest, signal: AbortSignal) {
  throwIfWriteCancelled(signal)
  const response = await fetch(`/k/api/directory/search.json?_ref=${encodeURIComponent(location.href)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId: currentSpaceId(), appId: null, recordId: null, term: request.query }),
    signal,
  })
  if (!response.ok) throw new Error(`提及对象搜索失败：HTTP ${response.status}`)
  const payload = await response.json() as {
    success?: boolean
    result?: { users?: Array<Record<string, unknown>>; groups?: Array<Record<string, unknown>>; orgs?: Array<Record<string, unknown>> }
  }
  if (!payload.success || !payload.result) throw new Error('提及对象搜索没有返回结果。')
  const asCandidates = (entities: Array<Record<string, unknown>> | undefined, entityType: MentionEntityType) => (entities ?? [])
    .filter((entity) => typeof entity.id === 'string' && typeof entity.code === 'string' && typeof entity.name === 'string')
    .map((entity) => ({
      entityType,
      id: String(entity.id),
      code: String(entity.code),
      name: String(entity.name),
      icon: entityType === 'USER' && typeof (entity.photo as { original?: unknown } | undefined)?.original === 'string'
        ? String((entity.photo as { original: string }).original)
        : '',
    }))
  return [
    ...asCandidates(payload.result.users, 'USER'),
    ...asCandidates(payload.result.groups, 'GROUP'),
    ...asCandidates(payload.result.orgs, 'ORGANIZATION'),
  ].filter((candidate) => !request.entityType || candidate.entityType === request.entityType)
}

async function pickMentionCandidate(candidate: MentionCandidate, signal: AbortSignal) {
  const token = getRequestToken()
  if (!token) throw new Error('无法取得 kintone 请求令牌，不能确认提及对象。')
  const response = await fetch(`/k/api/user/pick.json?_ref=${encodeURIComponent(location.href)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entities: [{ entityType: candidate.entityType, entityId: candidate.id }], __REQUEST_TOKEN__: token }),
    signal,
  })
  if (!response.ok) throw new Error(`提及对象确认失败：HTTP ${response.status}`)
  const payload = await response.json() as { success?: boolean }
  if (!payload.success) throw new Error('kintone 没有确认提及对象。')
}

function renderMentionPicker(candidates: MentionCandidate[]) {
  const element = document.querySelector<HTMLElement>(`#${ROOT_ID}-mention-picker`)
  if (!element) return
  element.replaceChildren()
  if (!mentionSelection) {
    element.hidden = true
    return
  }
  element.hidden = false
  const title = document.createElement('strong')
  title.textContent = '请选择提及对象'
  element.append(title)
  for (const candidate of candidates) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mention-candidate'
    const kind = candidate.entityType === 'USER' ? '人' : candidate.entityType === 'GROUP' ? '组' : '组织'
    button.textContent = `${candidate.name} · ${kind}`
    button.title = candidate.code
    button.addEventListener('click', () => mentionSelection?.resolve(candidate))
    element.append(button)
  }
}

function chooseMentionCandidate(candidates: MentionCandidate[], signal: AbortSignal) {
  return new Promise<MentionCandidate>((resolve, reject) => {
    const abort = () => {
      if (mentionSelection) mentionSelection = null
      renderMentionPicker([])
      reject(new Error('已取消本次写入。'))
    }
    signal.addEventListener('abort', abort, { once: true })
    mentionSelection = {
      resolve: (candidate) => {
        signal.removeEventListener('abort', abort)
        mentionSelection = null
        renderMentionPicker([])
        resolve(candidate)
      },
      reject,
    }
    renderMentionPicker(candidates)
  })
}

async function resolveArticleMentions(article: RichArticle, signal: AbortSignal) {
  const mentions = new Map<TextRun, MentionCandidate>()
  const runs = article.blocks.flatMap((block) => 'runs' in block && Array.isArray(block.runs) ? block.runs : [])
  for (const run of runs) {
    if (!run.mention) continue
    renderMessage(`正在搜索提及对象：${run.mention.query}`, 'working')
    const candidates = await searchMentionCandidates(run.mention, signal)
    if (!candidates.length) throw new Error(`没有找到可提及的对象：${run.mention.query}`)
    const exact = candidates.filter((candidate) => candidateMatchesRequest(candidate, run.mention!))
    const candidate = exact.length === 1 ? exact[0] : await chooseMentionCandidate(candidates, signal)
    await pickMentionCandidate(candidate, signal)
    mentions.set(run, candidate)
  }
  return mentions
}

function imageWidth(block: ImageBlock) {
  const width = block.width ?? 500
  return Number.isInteger(width) && width >= 100 && width <= 750 ? width : 500
}

async function loadAsset(
  connection: BridgeConnection,
  packageValue: BridgePackage,
  block: ImageBlock,
  signal: AbortSignal,
) {
  throwIfWriteCancelled(signal)
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
  throwIfWriteCancelled(signal)
  return new File([response.response], block.fileName, { type: response.response.type || 'application/octet-stream' })
}

function throwIfWriteCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('已取消本次写入。')
}

async function uploadImage(file: File, block: ImageBlock, signal: AbortSignal) {
  throwIfWriteCancelled(signal)
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
    signal,
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

function imageRowMarkup(block: ImageRowBlock, images: Array<{ block: ImageBlock; fileKey: string; width: number }>) {
  const alignment = block.align && ['left', 'center', 'right'].includes(block.align) ? block.align : 'left'
  const contents = images.map(({ block: imageBlock, fileKey, width }) => {
    const original = new URLSearchParams({ fileKey, _ref: location.href })
    const preview = new URLSearchParams({ fileKey, w: String(width), _ref: location.href })
    const image = document.createElement('img')
    image.className = 'cybozu-tmp-file'
    image.dataset.original = `/k/api/blob/download.do?${original}`
    image.dataset.file = fileKey
    image.width = width
    image.src = `/k/api/blob/download.do?${preview}`
    image.title = imageBlock.alt ?? ''
    return image.outerHTML
  }).join('')
  const captions = images.map(({ block: imageBlock }) => imageBlock.caption).filter(Boolean).join('　·　')
  const captionMarkup = captions ? `<div style="text-align:${alignment}">${escapeHtml(captions)}</div>` : ''
  return `<div style="text-align:${alignment}">${contents}<br></div>${captionMarkup}<div><br></div>`
}

function validateArticle(article: RichArticle) {
  if (article.schema !== 'kintone-rich-article.v1' || !Array.isArray(article.blocks) || !article.blocks.length) {
    throw new Error('Ready 草稿的文章格式无效。')
  }
  article.blocks.forEach((block, index) => {
    if (block.type === 'image' && !block.fileName) throw new Error(`第 ${index + 1} 个图片块缺少 fileName。`)
    if (block.type === 'imageRow' && (!Array.isArray(block.images) || block.images.length < 2 || block.images.some((image) => !image.fileName))) {
      throw new Error(`第 ${index + 1} 个图片行至少需要两张图片。`)
    }
    if ('runs' in block && block.runs?.some((run) => run.mention && (!run.mention.query.trim() || (run.mention.entityType && !['USER', 'GROUP', 'ORGANIZATION'].includes(run.mention.entityType))))) {
      throw new Error(`第 ${index + 1} 个文本块包含无效的提及对象。`)
    }
  })
}

async function buildMarkup(connection: BridgeConnection, packageValue: BridgePackage, signal: AbortSignal) {
  validateArticle(packageValue.article)
  const mentions = await resolveArticleMentions(packageValue.article, signal)
  const chunks: string[] = []
  const imageBlocks = packageValue.article.blocks.flatMap((block) => block.type === 'image' ? [block] : block.type === 'imageRow' ? block.images : [])
  let imageIndex = 0
  let reusedImages = 0
  for (const block of packageValue.article.blocks) {
    if (block.type !== 'image' && block.type !== 'imageRow') {
      chunks.push(textMarkup(block, mentions))
      continue
    }
    const rowImages = block.type === 'imageRow' ? block.images : [block]
    const renderedImages: Array<{ block: ImageBlock; fileKey: string; width: number }> = []
    for (const imageBlock of rowImages) {
      throwIfWriteCancelled(signal)
      imageIndex += 1
      renderMessage(`正在处理图片 ${imageIndex}/${imageBlocks.length}：${imageBlock.fileName}`, 'working')
      const width = imageWidth(imageBlock)
      const digest = packageValue.assetDigests[imageBlock.fileName]
      const cacheKey = digest ? imageCacheKey(digest, width) : ''
      let fileKey = cacheKey ? imageFileKeys.get(cacheKey) : undefined
      if (fileKey) reusedImages += 1
      if (!fileKey) {
        const file = await loadAsset(connection, packageValue, imageBlock, signal)
        const upload = await uploadImage(file, imageBlock, signal)
        throwIfWriteCancelled(signal)
        fileKey = upload.fileKey
        if (cacheKey) imageFileKeys.set(cacheKey, fileKey)
      }
      renderedImages.push({ block: imageBlock, fileKey, width })
    }
    chunks.push(block.type === 'imageRow' ? imageRowMarkup(block, renderedImages) : imageMarkup(block, renderedImages[0].fileKey, renderedImages[0].width))
  }
  return { markup: chunks.join(''), reusedImages, imageCount: imageBlocks.length }
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

async function applyPackage(connection: BridgeConnection, packageValue: BridgePackage, signal: AbortSignal) {
  const target = await resolveEditor()
  if (!target || !target.isContentEditable) {
    renderMessage('请先点击页面里的“发表评论…”展开评论框，再点击该版本。', 'warning')
    return
  }
  if (editorSessionChanged(imageCacheEditor, target)) {
    imageFileKeys.clear()
    reusableImagePackageIds.clear()
    imageCacheEditor = target
  }
  await postBridge(connection, `/v1/packages/${encodeURIComponent(packageValue.id)}/claim`, {
    hash: packageValue.hash,
    clientId: clientId(),
  })
  try {
    const rendered = await buildMarkup(connection, packageValue, signal)
    throwIfWriteCancelled(signal)
    if (!target.isConnected) throw new Error('图片上传期间编辑器已被页面替换。')
    target.focus()
    document.execCommand('selectAll', false)
    if (!document.execCommand('insertHTML', false, rendered.markup)) throw new Error('浏览器拒绝写入富文本编辑器。')
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    const expectedImages = packageValue.article.blocks.flatMap((block) => block.type === 'image' ? [block] : block.type === 'imageRow' ? block.images : [])
    if (expectedImages.length) {
      await delay(50)
      const actualImages = target.querySelectorAll('img.cybozu-tmp-file').length
      if (actualImages < expectedImages.length) {
        throw new Error(`kintone 编辑器没有保留全部图片（预期 ${expectedImages.length} 张，实际 ${actualImages} 张）。`)
      }
    }
    await sendResult(connection, packageValue, 'injected')
    if (rendered.imageCount) reusableImagePackageIds.add(packageValue.id)
    renderVersions()
    renderMessage('')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await sendResult(connection, packageValue, 'failed', message)
    } catch {
      // Keep the original injection error visible.
    }
    throw error
  }
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

function renderWriteControls() {
  const cancel = document.querySelector<HTMLButtonElement>(`#${ROOT_ID}-cancel`)
  if (!cancel) return
  const writing = Boolean(writeAbortController)
  cancel.hidden = !writing
  cancel.disabled = writeAbortController?.signal.aborted ?? false
}

function articleVersionGroups() {
  const groups = new Map<string, ArticleVersionGroup>()
  for (const version of newestVersionsFirst(versionMatches)) {
    const articleId = version.summary.articleId || version.summary.id
    const group = groups.get(articleId)
    if (group) {
      group.versions.push(version)
    } else {
      groups.set(articleId, {
        articleId,
        title: version.summary.title || articleId,
        versions: [version],
      })
    }
  }
  return Array.from(groups.values())
}

function versionNote(match: BridgePackageSummary) {
  if (match.revisionNote?.trim()) return match.revisionNote.trim()
  return match.version === 'v001' ? '初稿' : '修订'
}

function renderVersions() {
  const element = document.querySelector<HTMLElement>(`#${ROOT_ID}-versions`)
  if (!element) return
  const previousScrollTop = element.scrollTop
  if (!versionMatches.length) {
    element.innerHTML = '<p class="empty">没有可用的本地版本。</p>'
    return
  }
  element.replaceChildren()
  const activeEditor = findEditorCandidates()[0]?.element ?? null
  for (const group of articleVersionGroups()) {
    const article = document.createElement('section')
    article.className = 'article-group'
    const isCollapsed = collapsedArticleIds.has(group.articleId)
    article.dataset.collapsed = String(isCollapsed)
    const toggle = document.createElement('button')
    toggle.className = 'article-group-toggle'
    toggle.type = 'button'
    toggle.setAttribute('aria-expanded', String(!isCollapsed))
    const chevron = document.createElement('span')
    chevron.className = 'article-group-chevron'
    chevron.textContent = isCollapsed ? '›' : '⌄'
    const title = document.createElement('strong')
    title.className = 'article-group-title'
    title.textContent = group.title
    const count = document.createElement('span')
    count.className = 'article-group-count'
    count.textContent = `${group.versions.length} 个版本`
    toggle.append(chevron, title, count)
    toggle.addEventListener('click', () => {
      if (collapsedArticleIds.has(group.articleId)) collapsedArticleIds.delete(group.articleId)
      else collapsedArticleIds.add(group.articleId)
      renderVersions()
    })
    const versions = document.createElement('div')
    versions.className = 'article-version-list'
    for (const selected of group.versions) {
      const match = selected.summary
      const row = document.createElement('div')
      row.className = 'version-row'
      const canReuseImages = imageCacheEditor === activeEditor && reusableImagePackageIds.has(match.id)
      row.dataset.reusable = String(canReuseImages)
      const version = document.createElement('span')
      version.className = 'version-tag'
      version.textContent = match.version
      const note = document.createElement('span')
      note.className = 'version-note'
      note.textContent = versionNote(match)
      const meta = document.createElement('small')
      meta.className = 'version-meta'
      meta.textContent = `${match.updatedAt.replace('T', ' ').replace('+00:00', ' UTC')}${canReuseImages ? ' · 图片可复用' : ''}`
      const button = document.createElement('button')
      button.className = 'version-apply'
      button.type = 'button'
      button.textContent = '写'
      button.title = canReuseImages ? '写入当前编辑器；图片可直接复用' : '写入当前编辑器'
      button.disabled = busy
      button.addEventListener('click', () => void applyVersion(selected))
      const detail = document.createElement('div')
      detail.className = 'version-detail'
      detail.append(note, version, meta)
      row.append(detail, button)
      versions.append(row)
    }
    article.append(toggle, versions)
    element.append(article)
  }
  element.scrollTop = previousScrollTop
}

async function refreshVersions() {
  if (busy) return
  busy = true
  renderMessage('正在发现本地 Bridge 并读取版本…', 'working')
  try {
    const bridges = await discoverBridges()
    if (!bridges.length) {
      versionMatches = []
      renderVersions()
      renderMessage('没有发现本地 Bridge。请先在本地准备文章。', 'error')
      return
    }
    versionMatches = (await Promise.all(
      bridges.map(async (connection) => (await listVersions(connection)).map((summary) => ({ ...summary, connection, summary }))),
    )).flat()
    renderVersions()
    renderMessage(versionMatches.length ? `已读取 ${versionMatches.length} 个本地版本。` : '没有可用的本地版本。', versionMatches.length ? 'success' : 'warning')
  } catch (error) {
    renderMessage(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    busy = false
    renderVersions()
  }
}

async function applyVersion(match: VersionMatch) {
  if (busy) {
    renderMessage('正在写入另一篇文章；请先取消当前写入。', 'warning')
    return
  }
  busy = true
  writeAbortController = new AbortController()
  renderVersions()
  renderWriteControls()
  renderMessage(`正在写入 ${match.summary.version}…`, 'working')
  try {
    const packageValue = await getPackage(match.connection, match.summary.id)
    throwIfWriteCancelled(writeAbortController.signal)
    await applyPackage(match.connection, packageValue, writeAbortController.signal)
  } catch (error) {
    if (writeAbortController.signal.aborted) renderMessage('已取消本次写入；编辑器没有被本次操作覆盖。', 'normal')
    else renderMessage(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    busy = false
    writeAbortController = null
    renderVersions()
    renderWriteControls()
  }
}

function panelState(): PanelState | null {
  const value = GM_getValue<PanelState | null>(PANEL_STATE_KEY, null)
  return value && Number.isFinite(value.left) && Number.isFinite(value.top) ? value : null
}

function clampAndSavePanelPosition(root: HTMLElement, collapsed = root.dataset.collapsed === 'true') {
  const position = clampPanelPosition(
    { left: root.offsetLeft, top: root.offsetTop },
    { width: window.innerWidth, height: window.innerHeight },
    { width: root.offsetWidth, height: root.offsetHeight },
  )
  root.style.left = `${position.left}px`
  root.style.right = 'auto'
  root.style.top = `${position.top}px`
  GM_setValue(PANEL_STATE_KEY, { ...position, collapsed })
}

function setPanelCollapsed(root: HTMLElement, collapsed: boolean) {
  root.dataset.collapsed = String(collapsed)
  const button = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-collapse`)
  if (button) {
    button.textContent = collapsed ? '+' : '—'
    button.title = collapsed ? '展开面板' : '最小化面板'
  }
  clampAndSavePanelPosition(root, collapsed)
}

function makePanelDraggable(root: HTMLElement) {
  const header = root.querySelector<HTMLElement>(`#${ROOT_ID}-header`)
  if (!header) return
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return
    const start = { x: event.clientX - root.offsetLeft, y: event.clientY - root.offsetTop }
    const move = (moveEvent: PointerEvent) => {
      const position = clampPanelPosition(
        { left: moveEvent.clientX - start.x, top: moveEvent.clientY - start.y },
        { width: window.innerWidth, height: window.innerHeight },
        { width: root.offsetWidth, height: root.offsetHeight },
      )
      root.style.left = `${position.left}px`
      root.style.right = 'auto'
      root.style.top = `${position.top}px`
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      clampAndSavePanelPosition(root)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  })
}

function injectStyles() {
  if (document.querySelector(`#${STYLE_ID}`)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${ROOT_ID} { --panel:#101827; --surface:#182235; --surface-strong:#202d43; --line:#2b3a53; --muted:#91a0b8; --text:#f4f7fb; --accent:#4f8cff; --accent-strong:#2f6feb; --success:#36d399; background:var(--panel); border:1px solid #2c3b55; border-radius:14px; box-shadow:0 20px 48px rgba(2,6,23,.38); color:var(--text); font:13px/1.45 Inter,ui-sans-serif,system-ui,sans-serif; padding:12px; position:fixed; right:16px; top:16px; width:336px; z-index:2147483646; }
    #${ROOT_ID}-header { align-items:center; cursor:grab; display:flex; gap:10px; justify-content:space-between; margin:0 0 14px; padding:3px 2px 13px; border-bottom:1px solid var(--line); user-select:none; }
    #${ROOT_ID}-header:active { cursor:grabbing; }
    #${ROOT_ID}-title { display:flex; flex-direction:column; font-size:17px; font-weight:750; letter-spacing:0; line-height:1.15; }
    #${ROOT_ID}-title small { color:#7ea9ff !important; font-size:10px !important; font-weight:700; letter-spacing:.08em; margin-top:4px; text-transform:uppercase; }
    #${ROOT_ID}-collapse { align-items:center; background:var(--surface-strong); border:1px solid #344561; border-radius:50%; color:#d7e3f7; display:flex; font-size:18px; height:30px; justify-content:center; line-height:1; padding:0; transition:background .15s ease, transform .15s ease; width:30px; }
    #${ROOT_ID}-collapse:hover { background:#30466b; transform:translateY(-1px); }
    #${ROOT_ID}[data-collapsed="true"] { padding:10px 12px; width:auto; }
    #${ROOT_ID}[data-collapsed="true"] #${ROOT_ID}-header { margin:0; }
    #${ROOT_ID}[data-collapsed="true"] .panel-body { display:none; }
    #${ROOT_ID}-connection { align-items:center; background:#132a29; border:1px solid #1d4a43; border-radius:999px; color:#81e6bd; display:inline-flex; font-size:12px; gap:7px; margin:0 0 12px; padding:5px 9px; }
    #${ROOT_ID}-connection::before { background:#f87171; border-radius:50%; box-shadow:0 0 0 3px rgba(248,113,113,.14); content:''; height:7px; width:7px; }
    #${ROOT_ID}-connection[data-online="true"]::before { background:var(--success); box-shadow:0 0 0 3px rgba(54,211,153,.14); }
    #${ROOT_ID} button { cursor:pointer; font:inherit; }
    #${ROOT_ID}-refresh { background:transparent; border:1px solid #405475; border-radius:8px; color:#d8e5fb; font-weight:650; padding:8px 10px; width:100%; }
    #${ROOT_ID}-refresh:hover { background:#223149; border-color:#5d7eaf; }
    #${ROOT_ID}-mention-picker { background:#1b2639; border:1px solid #315a93; border-radius:8px; color:#d8e5fb; margin-top:10px; padding:9px; }
    #${ROOT_ID}-mention-picker strong { display:block; font-size:12px; margin-bottom:7px; }
    #${ROOT_ID} .mention-candidate { background:#223149; border:1px solid #405475; border-radius:6px; color:#d8e5fb; display:block; margin-top:6px; overflow:hidden; padding:7px 8px; text-align:left; text-overflow:ellipsis; white-space:nowrap; width:100%; }
    #${ROOT_ID} .mention-candidate:hover { background:#30466b; border-color:#7ba9ff; }
    #${ROOT_ID}-versions { border-top:1px solid var(--line); margin-top:12px; max-height:360px; overflow:auto; }
    #${ROOT_ID} .article-group { border-bottom:1px solid var(--line); }
    #${ROOT_ID} .article-group-toggle { align-items:center; background:transparent; border:0; color:var(--text); display:flex; gap:8px; min-height:50px; padding:10px 4px; text-align:left; width:100%; }
    #${ROOT_ID} .article-group-toggle:hover { background:rgba(79,140,255,.08); }
    #${ROOT_ID} .article-group-chevron { color:#8fb9ff; font-size:19px; line-height:1; text-align:center; width:14px; }
    #${ROOT_ID} .article-group-title { flex:1; font-size:13px; font-weight:700; line-height:1.35; }
    #${ROOT_ID} .article-group-count { color:var(--muted); font-size:11px; white-space:nowrap; }
    #${ROOT_ID} .article-group[data-collapsed="true"] .article-version-list { display:none; }
    #${ROOT_ID} .article-version-list { border-top:1px solid rgba(43,58,83,.72); margin:0 0 0 10px; }
    #${ROOT_ID} .version-row { align-items:center; border-bottom:1px solid rgba(43,58,83,.72); display:flex; gap:10px; min-height:45px; padding:8px 4px 8px 10px; }
    #${ROOT_ID} .version-row:last-child { border-bottom:0; }
    #${ROOT_ID} .version-row[data-reusable="true"] { background:linear-gradient(90deg,rgba(54,211,153,.11),transparent 72%); box-shadow:inset 2px 0 0 #36d399; padding-left:10px; }
    #${ROOT_ID} .version-detail { min-width:0; flex:1; }
    #${ROOT_ID} .version-note, #${ROOT_ID} .version-tag, #${ROOT_ID} .version-meta { display:block; }
    #${ROOT_ID} .version-note { color:#edf3fd; display:inline-block; font-size:12px; font-weight:700; margin-right:8px; }
    #${ROOT_ID} .version-tag { color:#8fb9ff; display:inline-block; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; font-weight:750; letter-spacing:.04em; }
    #${ROOT_ID} .version-meta { color:var(--muted); font-size:11px; margin-top:3px; }
    #${ROOT_ID} .version-apply { background:#2f6feb; border:1px solid #4f8cff; border-radius:7px; color:#fff; font-size:12px; font-weight:750; line-height:1; min-width:38px; padding:8px 10px; transition:background .15s ease, border-color .15s ease, transform .15s ease; }
    #${ROOT_ID} .version-apply:hover { background:#4f8cff; border-color:#7ba9ff; transform:translateY(-1px); }
    #${ROOT_ID} .version-apply:disabled { background:#28364d; border-color:#3b4c67; color:#91a0b8; cursor:not-allowed; transform:none; }
    #${ROOT_ID} .version-row[data-reusable="true"] .version-apply { background:#21685a; border-color:#3f917f; }
    #${ROOT_ID} .version-row[data-reusable="true"] .version-apply:hover { background:#2d7d6d; border-color:#66b8a5; }
    #${ROOT_ID} .empty { color:var(--muted); margin:5px 0; text-align:center; }
    #${ROOT_ID}-message { background:#1b2639; border:1px solid #2e405c; border-radius:8px; color:#bac8dd; margin:12px 0 0; padding:9px 10px; }
    #${ROOT_ID}-message:empty { display:none; }
    #${ROOT_ID}-message[data-kind="success"] { background:#16362e; border-color:#245e4f; color:#9be7c4; }
    #${ROOT_ID}-message[data-kind="warning"] { background:#3a2d18; border-color:#6a5024; color:#f3d38b; }
    #${ROOT_ID}-message[data-kind="error"] { background:#41222a; border-color:#713543; color:#ffb4bd; }
    #${ROOT_ID}-message[data-kind="working"] { background:#1c3154; border-color:#315a93; color:#b7d1ff; }
    #${ROOT_ID}-cancel { background:transparent; border:1px solid #86505a; border-radius:8px; color:#ffb4bd; font-weight:700; margin-top:10px; padding:8px 10px; width:100%; }
    #${ROOT_ID}-cancel:hover { background:#41222a; }
    #${ROOT_ID}-cancel:disabled { color:#95717a; cursor:wait; }
  `
  document.head.append(style)
}

function createPanel() {
  if (!document.body || document.querySelector(`#${ROOT_ID}`) || !isThreadPage()) return
  injectStyles()
  const root = document.createElement('aside')
  root.id = ROOT_ID
  root.innerHTML = `
    <div id="${ROOT_ID}-header">
      <span id="${ROOT_ID}-title">文章版本${DEV_MODE ? ` <small style="color:#2563eb;font-size:11px">${DEV_LABEL}</small>` : ''}</span>
      <button id="${ROOT_ID}-collapse" type="button" title="最小化面板">—</button>
    </div>
    <div class="panel-body">
      <div id="${ROOT_ID}-connection" data-online="false">Bridge 离线</div>
      <button id="${ROOT_ID}-refresh" type="button">刷新版本</button>
      <div id="${ROOT_ID}-mention-picker" hidden></div>
      <div id="${ROOT_ID}-versions"></div>
      <button id="${ROOT_ID}-cancel" type="button" hidden>取消本次写入</button>
      <p id="${ROOT_ID}-message">点击“刷新版本”读取当前目标的本地文章。</p>
    </div>
  `
  const refresh = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-refresh`)
  const collapse = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-collapse`)
  const cancel = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-cancel`)
  refresh?.addEventListener('click', () => void refreshVersions())
  collapse?.addEventListener('click', () => setPanelCollapsed(root, root.dataset.collapsed !== 'true'))
  cancel?.addEventListener('click', () => {
    if (!writeAbortController || writeAbortController.signal.aborted) return
    writeAbortController.abort()
    renderWriteControls()
    renderMessage('正在取消；当前网络请求结束后将停止写入。', 'warning')
  })
  document.body.append(root)
  const restored = panelState()
  if (restored) {
    root.style.left = `${restored.left}px`
    root.style.right = 'auto'
    root.style.top = `${restored.top}px`
  }
  setPanelCollapsed(root, restored?.collapsed ?? false)
  makePanelDraggable(root)
}

function maintainPage() {
  if (isThreadPage()) {
    createPanel()
  } else {
    document.querySelector(`#${ROOT_ID}`)?.remove()
  }
}

const observer = new MutationObserver(() => {
  maintainPage()
  if (imageCacheEditor && !imageCacheEditor.isConnected) {
    imageCacheEditor = null
    imageFileKeys.clear()
    reusableImagePackageIds.clear()
    renderVersions()
  }
})
observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('hashchange', maintainPage)
window.addEventListener('popstate', maintainPage)
window.addEventListener('resize', () => {
  const root = document.querySelector<HTMLElement>(`#${ROOT_ID}`)
  if (root) clampAndSavePanelPosition(root)
})
maintainPage()
