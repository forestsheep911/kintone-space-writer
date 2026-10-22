import { bridgeRequest, getValue, setValue, getRequestToken, initializePreferences } from './platform'

declare const __DEV__: boolean
declare const __VERSION__: string

import { editorSessionChanged } from './editor-image-session'
import { clampPanelPosition, type PanelPosition } from './panel-position'
import { imageCacheKey, newestVersionsFirst, type VersionSummary } from './version-picker'
import { panelStyles } from './panel-styles'

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

type ListItem = {
  text?: string
  runs?: TextRun[]
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
  items?: Array<string | ListItem>
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

const ROOT_ID = 'ksw-standard-panel'
const STYLE_ID = `${ROOT_ID}-style`
const SERVICE_NAME = 'kintone-space-writer-bridge'
const PORT_START = 8787
const PORT_END = 8807
const CLIENT_KEY = 'ksw-standard-client-id'
const PORTS_KEY = 'ksw-standard-bridge-ports'
const PANEL_STATE_KEY = 'ksw-standard-panel-state'
const ARCHIVE_KEY_PREFIX = 'ksw-archived-article:'
const LAST_ARTICLE_KEY = 'ksw-last-opened-article'
const AUTO_REFRESH_INTERVAL_MS = 5_000
const AUTO_DISCOVERY_INTERVAL_MS = 30_000
const DEV_MODE = __DEV__
const DEV_LABEL = `DEV ${__VERSION__}`
let showArchived = false

let editor: HTMLElement | null = null
let busy = false
let connections: BridgeConnection[] = []
let discoveryInFlight: Promise<BridgeConnection[]> | null = null
let versionMatches: VersionMatch[] = []
let autoRefreshTimer: number | null = null
let lastDiscoveryAt = 0
let imageFileKeys = new Map<string, string>()
let imageCacheEditor: HTMLElement | null = null
let reusableImagePackageIds = new Set<string>()
let expandedArticleIds = new Set<string>()
let expandedHistoryIds = new Set<string>()
let initialArticlePicked = false
let lastWrite: { editor: HTMLElement; pageUrl: string; title: string; version: string; imageCount: number; markup: string; modified: boolean } | null = null
let writeAbortController: AbortController | null = null
let mentionSelection: { resolve: (candidate: MentionCandidate) => void; reject: (error: Error) => void } | null = null

type PanelState = PanelPosition & { collapsed: boolean }

function debugStage(_stage: string, _message: string, _detail?: Record<string, unknown>) {}

function isThreadPage() {
  return /\/space\/\d+\/thread\/\d+/i.test(location.href)
}

async function clientId() {
  const existing = getValue<string>(CLIENT_KEY, '')
  if (existing) return existing
  const created = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `client-${Date.now()}-${Math.random()}`
  await setValue(CLIENT_KEY, created)
  return created
}

async function probePort(port: number): Promise<BridgeConnection | null> {
  try {
    const response = await bridgeRequest<BridgeHealth>({ port, operation: 'health' })
    const health = response.response
    if (response.status !== 200 || health?.service !== SERVICE_NAME || !health.token || health.port !== port) return null
    return { port, token: health.token, instanceId: health.instanceId }
  } catch { return null }
}

async function performDiscovery() {
  const cached = getValue<number[]>(PORTS_KEY, [])
  const ports = [...new Set([...cached, ...Array.from({ length: PORT_END - PORT_START + 1 }, (_, index) => PORT_START + index)])]
  connections = (await Promise.all(ports.map((port) => probePort(port)))).filter(
    (value): value is BridgeConnection => Boolean(value),
  )
  await setValue(PORTS_KEY, connections.map((connection) => connection.port))
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

function versionSnapshot(matches: VersionMatch[]) {
  return matches
    .map(({ connection, summary }) => `${connection.instanceId}:${summary.id}:${summary.hash}:${summary.status}:${summary.updatedAt}`)
    .sort()
    .join('|')
}

async function listVersions(connection: BridgeConnection): Promise<BridgePackageSummary[]> {
  const response = await bridgeRequest<{ packages?: BridgePackageSummary[]; error?: string }>({ ...connection, operation: 'list' })
  if (response.status !== 200) throw new Error(response.response?.error || `读取版本列表失败：HTTP ${response.status}`)
  return response.response.packages ?? []
}

async function getPackage(connection: BridgeConnection, packageId: string): Promise<BridgePackage> {
  const response = await bridgeRequest<BridgePackage | { error?: string }>({ ...connection, operation: 'package', packageId })
  if (response.status !== 200) throw new Error(('error' in response.response ? response.response.error : '') || `读取文章版本失败：HTTP ${response.status}`)
  return response.response as BridgePackage
}

async function postBridge(connection: BridgeConnection, packageId: string, operation: 'claim' | 'result', body: Record<string, unknown>) {
  const response = await bridgeRequest<{ status?: string; error?: string }>({ ...connection, operation, packageId, body })
  if (response.status < 200 || response.status >= 300) throw new Error(response.response?.error || `Bridge 写入失败：HTTP ${response.status}`)
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
  const hasRuns = Boolean(block.runs?.length)
  const styled = hasRuns ? block.runs!.map((run) => inlineTextMarkup(run, mentions)).join('') : inlineTextMarkup(block)
  const color = safeColor(block.color)
  const backgroundColor = safeColor(block.backgroundColor)
  const inlineStyle = [color && `color:${color}`, backgroundColor && `background-color:${backgroundColor}`]
    .filter(Boolean)
    .join(';')
  const withBlockStyle = hasRuns && inlineStyle ? `<span style="${inlineStyle}">${styled}</span>` : styled
  const align = block.align && ['left', 'center', 'right'].includes(block.align) ? block.align : 'left'
  const alignment = ` style="text-align:${align}"`
  switch (block.type) {
    case 'heading':
      return `<div${alignment}><font size="${block.level === 1 ? 6 : block.level === 3 ? 4 : 5}"><strong>${withBlockStyle}</strong></font></div><div><br></div>`
    case 'quote':
      return `<div${alignment}>「${withBlockStyle}」</div><div><br></div>`
    case 'bulletList':
      return `<ul${alignment}>${(block.items ?? []).map((item) => `<li>${listItemMarkup(item, mentions)}</li>`).join('')}</ul><div><br></div>`
    case 'numberList':
      return `<ol${alignment}>${(block.items ?? []).map((item) => `<li>${listItemMarkup(item, mentions)}</li>`).join('')}</ol><div><br></div>`
    case 'divider':
      return '<div>────────</div><div><br></div>'
    default:
      return `<div${alignment}>${withBlockStyle || '<br>'}</div><div><br></div>`
  }
}

function listItemMarkup(item: string | ListItem, mentions: Map<TextRun, MentionCandidate>) {
  if (typeof item === 'string') return escapeHtml(item)
  return item.runs?.length ? item.runs.map((run) => inlineTextMarkup(run, mentions)).join('') : inlineTextMarkup(item)
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
  const token = await getRequestToken()
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
  const runs = article.blocks.flatMap((block) => [
    ...('runs' in block && Array.isArray(block.runs) ? block.runs : []),
    ...((block.type === 'bulletList' || block.type === 'numberList')
      ? (block.items ?? []).flatMap((item) => typeof item === 'string' || !Array.isArray(item.runs) ? [] : item.runs)
      : []),
  ])
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
  const response = await bridgeRequest<Blob>({ ...connection, operation: 'asset', packageId: packageValue.id, assetName: block.fileName })
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
  const token = await getRequestToken()
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
  await postBridge(connection, packageValue.id, 'result', {
    hash: packageValue.hash,
    status,
    error,
    pageUrl: location.href,
  })
}

async function applyPackage(connection: BridgeConnection, packageValue: BridgePackage, signal: AbortSignal) {
  const destination = location.href
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
  await postBridge(connection, packageValue.id, 'claim', {
    hash: packageValue.hash,
    clientId: await clientId(),
  })
  try {
    const rendered = await buildMarkup(connection, packageValue, signal)
    throwIfWriteCancelled(signal)
    if (!target.isConnected || location.href !== destination) throw new Error('写入期间话题或编辑器已改变，请重新选择版本。')
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
    lastWrite = { editor: target, pageUrl: destination, title: packageValue.article.title || packageValue.article.id || '未命名文章', version: packageValue.version, imageCount: rendered.imageCount, markup: target.innerHTML, modified: false }
    renderReceipt()
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
  element.textContent = count > 0 ? `已连接${count > 1 ? `（${count}）` : ''}` : '未连接'
  element.title = count > 0 ? '本地文章服务已连接' : '本地文章服务未连接，请先准备文章'
}

function renderReceipt() {
  const element = document.querySelector<HTMLElement>(`#${ROOT_ID}-receipt`)
  if (!element) return
  element.hidden = !lastWrite
  if (!lastWrite) { element.replaceChildren(); return }
  element.dataset.modified = String(lastWrite.modified)
  const heading = document.createElement('strong')
  heading.className = 'receipt-heading'
  heading.textContent = `最近写入：${lastWrite.version}`
  const title = document.createElement('span')
  title.className = 'receipt-title'
  title.textContent = lastWrite.title
  title.title = lastWrite.title
  const detail = document.createElement('span')
  detail.className = 'receipt-detail'
  detail.textContent = lastWrite.modified ? '编辑器已修改，请以页面中的内容为准' : `已写入编辑器${lastWrite.imageCount ? ` · ${lastWrite.imageCount} 张图片` : ' · 文字版'}`
  element.replaceChildren(heading, title, detail)
}

function syncReceipt() {
  if (!lastWrite || writeAbortController) return
  if (!lastWrite.editor.isConnected || lastWrite.pageUrl !== location.href) {
    lastWrite = null
    renderReceipt()
    return
  }
  const modified = lastWrite.editor.innerHTML !== lastWrite.markup
  if (modified !== lastWrite.modified) { lastWrite.modified = modified; renderReceipt() }
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
  element.replaceChildren()
  const allGroups = articleVersionGroups()
  const archived = (id: string) => getValue<boolean>(ARCHIVE_KEY_PREFIX + id, false) === true
  const archivedCount = allGroups.filter(group => archived(group.articleId)).length
  if (!initialArticlePicked && allGroups.length) {
    const available = allGroups.filter(group => !archived(group.articleId))
    const remembered = available.find(group => group.articleId === getValue<string>(LAST_ARTICLE_KEY, ''))
    const initial = remembered || available[0]
    if (initial) expandedArticleIds.add(initial.articleId)
    initialArticlePicked = true
  }
  for (const [view, count] of [['active', allGroups.length - archivedCount], ['archive', archivedCount]] as const) {
    const tab = document.querySelector<HTMLButtonElement>(`#${ROOT_ID}-${view}`)
    if (tab) {
      tab.textContent = `${view === 'active' ? '文章' : '归档'} · ${count}`
      tab.setAttribute('aria-pressed', String((view === 'archive') === showArchived))
    }
  }
  const groups = allGroups.filter(group => archived(group.articleId) === showArchived)
  if (!groups.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = showArchived ? '暂无归档文章' : allGroups.length ? '文章都已归档，可在“归档”中恢复。' : '准备好的文章将在这里显示。'
    element.append(empty)
  }
  const activeEditor = findEditorCandidates()[0]?.element ?? null
  for (const group of groups) {
    const article = document.createElement('section')
    article.className = 'article-group'
    const isCollapsed = showArchived || !expandedArticleIds.has(group.articleId)
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
    toggle.append(chevron, title)
    toggle.addEventListener('click', () => {
      if (showArchived) return
      if (expandedArticleIds.has(group.articleId)) expandedArticleIds.delete(group.articleId)
      else {
        expandedArticleIds.add(group.articleId)
        void setValue(LAST_ARTICLE_KEY, group.articleId).catch(error => renderMessage(`保存文章选择失败：${String(error)}`, 'error'))
      }
      renderVersions()
    })
    const count = document.createElement('span')
    count.className = 'article-group-count'
    count.textContent = `${group.versions.length} 个版本`
    const versions = document.createElement('div')
    versions.className = 'article-version-list'
    const historyExpanded = expandedHistoryIds.has(group.articleId)
    const shownVersions = historyExpanded ? group.versions : group.versions.slice(0, 1)
    for (const selected of shownVersions) {
      const match = selected.summary
      const row = document.createElement('div')
      row.className = 'version-row'
      row.dataset.latest = String(selected === group.versions[0])
      const canReuseImages = imageCacheEditor === activeEditor && reusableImagePackageIds.has(match.id)
      row.dataset.reusable = String(canReuseImages)
      const version = document.createElement('span')
      version.className = 'version-tag'
      version.textContent = match.version
      version.title = `${match.version}${selected === group.versions[0] ? ' · 最新版本' : ''}`
      const note = document.createElement('span')
      note.className = 'version-note'
      note.textContent = versionNote(match)
      const meta = document.createElement('time')
      meta.className = 'version-meta'
      const created = new Date(match.createdAt)
      const time = Number.isNaN(created.getTime()) ? '时间未知' : created.toLocaleString('zh-CN', { ...(created.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      if (!Number.isNaN(created.getTime())) meta.dateTime = match.createdAt
      meta.textContent = `创建于 ${time}`
      meta.title = Number.isNaN(created.getTime()) ? '版本创建时间未知' : `版本创建时间：${created.toLocaleString('zh-CN')}`
      const button = document.createElement('button')
      button.className = 'version-apply'
      button.type = 'button'
      button.textContent = '写入'
      button.title = canReuseImages ? '将此版本写入当前编辑器；图片无需重新上传' : '将此版本写入当前编辑器'
      button.disabled = busy
      button.addEventListener('click', () => void applyVersion(selected))
      const detail = document.createElement('div')
      detail.className = 'version-detail'
      detail.append(note, meta)
      if (canReuseImages) {
        const cache = document.createElement('small')
        cache.className = 'version-cache'
        cache.textContent = '图片无需重传'
        detail.append(cache)
      }
      row.append(version, detail, button)
      versions.append(row)
    }
    if (group.versions.length > 1) {
      const history = document.createElement('button')
      history.type = 'button'
      history.className = 'version-history'
      history.setAttribute('aria-expanded', String(historyExpanded))
      history.textContent = historyExpanded ? '收起历史版本' : `查看其余 ${group.versions.length - 1} 个版本`
      history.addEventListener('click', () => {
        if (historyExpanded) expandedHistoryIds.delete(group.articleId)
        else expandedHistoryIds.add(group.articleId)
        renderVersions()
      })
      versions.append(history)
    }
    const archiveButton = document.createElement('button')
    archiveButton.type = 'button'
    archiveButton.className = 'article-archive'
    archiveButton.textContent = showArchived ? '恢复' : '归档'
    archiveButton.setAttribute('aria-label', `${showArchived ? '恢复' : '归档'}文章：${group.title}`)
    archiveButton.title = showArchived ? '恢复到文章列表' : '收起整篇文章及其所有版本'
    archiveButton.disabled = Boolean(writeAbortController)
    archiveButton.addEventListener('click', () => {
      archiveButton.disabled = true
      void setValue(ARCHIVE_KEY_PREFIX + group.articleId, !showArchived)
        .then(() => renderVersions())
        .catch(error => { archiveButton.disabled = false; renderMessage(`保存归档设置失败：${String(error)}`, 'error') })
    })
    const heading = document.createElement('div')
    heading.className = 'article-heading'
    const summary = document.createElement('div')
    summary.className = 'article-summary'
    summary.append(count, archiveButton)
    heading.append(toggle, summary)
    if (showArchived) { toggle.disabled = true; article.append(heading) }
    else article.append(heading, versions)
    element.append(article)
  }
  element.scrollTop = previousScrollTop
  renderReceipt()
}

async function refreshVersions(options: { automatic?: boolean; forceDiscovery?: boolean } = {}) {
  if (busy) return
  const automatic = options.automatic ?? false
  busy = true
  if (!automatic) renderMessage('正在发现本地 Bridge 并读取版本…', 'working')
  try {
    const shouldDiscover = options.forceDiscovery || !connections.length || Date.now() - lastDiscoveryAt >= AUTO_DISCOVERY_INTERVAL_MS
    const bridges = shouldDiscover ? await discoverBridges() : connections
    if (shouldDiscover) lastDiscoveryAt = Date.now()
    if (!bridges.length) {
      const changed = versionMatches.length > 0
      versionMatches = []
      if (changed || !automatic) renderVersions()
      if (!automatic) renderMessage('没有发现本地 Bridge。请先在本地准备文章。', 'error')
      return
    }
    const nextMatches = (await Promise.all(
      bridges.map(async (connection) => (await listVersions(connection)).map((summary) => ({ ...summary, connection, summary }))),
    )).flat()
    const changed = versionSnapshot(nextMatches) !== versionSnapshot(versionMatches)
    versionMatches = nextMatches
    if (changed || !automatic) renderVersions()
    if (!automatic) renderMessage(versionMatches.length ? `已读取 ${versionMatches.length} 个本地版本。` : '没有可用的本地版本。', versionMatches.length ? 'success' : 'warning')
  } catch (error) {
    if (!automatic) renderMessage(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    busy = false
    // The initial automatic refresh renders new versions before the request has
    // cleared `busy`; render again so the "写" buttons become enabled.
    renderVersions()
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer !== null) return
  void refreshVersions({ automatic: true, forceDiscovery: true })
  autoRefreshTimer = window.setInterval(() => void refreshVersions({ automatic: true }), AUTO_REFRESH_INTERVAL_MS)
}

function stopAutoRefresh() {
  if (autoRefreshTimer === null) return
  window.clearInterval(autoRefreshTimer)
  autoRefreshTimer = null
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
    await setValue(LAST_ARTICLE_KEY, match.summary.articleId || match.summary.id)
    const packageValue = await getPackage(match.connection, match.summary.id)
    throwIfWriteCancelled(writeAbortController.signal)
    await applyPackage(match.connection, packageValue, writeAbortController.signal)
  } catch (error) {
    if (writeAbortController.signal.aborted) renderMessage('已取消本次写入；编辑器没有被本次操作覆盖。', 'normal')
    else renderMessage(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    busy = false
    writeAbortController = null
    syncReceipt()
    renderVersions()
    renderWriteControls()
  }
}

function panelState(): PanelState | null {
  const value = getValue<PanelState | null>(PANEL_STATE_KEY, null)
  return value && Number.isFinite(value.left) && Number.isFinite(value.top) ? value : null
}

function visiblePanelPosition(root: HTMLElement, requested: PanelPosition) {
  const position = clampPanelPosition(
    requested,
    { width: window.innerWidth, height: window.innerHeight },
    { width: root.offsetWidth, height: root.offsetHeight },
  )
  // Keep the compact bar's drag handle reachable, including after a long drag.
  if (root.dataset.collapsed === 'true') {
    position.left = Math.max(12, Math.min(position.left, window.innerWidth - root.offsetWidth - 12))
    position.top = Math.max(12, Math.min(position.top, window.innerHeight - root.offsetHeight - 12))
  }
  return position
}

function clampAndSavePanelPosition(root: HTMLElement, collapsed = root.dataset.collapsed === 'true') {
  const position = visiblePanelPosition(root, { left: root.offsetLeft, top: root.offsetTop })
  root.style.left = `${position.left}px`
  root.style.right = 'auto'
  root.style.top = `${position.top}px`
  void setValue(PANEL_STATE_KEY, { ...position, collapsed }).catch(error => renderMessage(`保存小窗位置失败：${String(error)}`, 'error'))
}

function setPanelCollapsed(root: HTMLElement, collapsed: boolean) {
  root.dataset.collapsed = String(collapsed)
  const button = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-collapse`)
  if (button) {
    button.textContent = collapsed ? '展开' : '—'
    button.title = collapsed ? '展开面板' : '收起面板'
    button.setAttribute('aria-label', button.title)
    button.setAttribute('aria-expanded', String(!collapsed))
  }
  // Expanding the compact bar near the viewport edge should reveal the whole panel.
  if (!collapsed) {
    root.style.left = `${Math.max(12, Math.min(root.offsetLeft, window.innerWidth - root.offsetWidth - 12))}px`
    root.style.top = `${Math.max(12, Math.min(root.offsetTop, window.innerHeight - root.offsetHeight - 12))}px`
  }
  clampAndSavePanelPosition(root, collapsed)
}

function makePanelDraggable(root: HTMLElement) {
  const header = root.querySelector<HTMLElement>(`#${ROOT_ID}-header`)
  if (!header) return
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return
    event.preventDefault()
    root.dataset.dragging = 'true'
    const start = { x: event.clientX - root.offsetLeft, y: event.clientY - root.offsetTop }
    const move = (moveEvent: PointerEvent) => {
      const position = visiblePanelPosition(root, { left: moveEvent.clientX - start.x, top: moveEvent.clientY - start.y })
      root.style.left = `${position.left}px`
      root.style.right = 'auto'
      root.style.top = `${position.top}px`
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      delete root.dataset.dragging
      clampAndSavePanelPosition(root)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  })
}

function injectStyles() {
  if (document.querySelector(`#${STYLE_ID}`)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = panelStyles(ROOT_ID)
  document.head.append(style)
}

function createPanel() {
  if (!document.body || document.querySelector(`#${ROOT_ID}`) || !isThreadPage()) return
  injectStyles()
  const root = document.createElement('aside')
  root.id = ROOT_ID
  root.innerHTML = `
    <div id="${ROOT_ID}-header" title="按住标题栏拖动">
      <div class="panel-drag-handle">
        <span class="panel-grip" aria-hidden="true"></span>
        <span id="${ROOT_ID}-title">Space Writer${DEV_MODE ? ` <small>${DEV_LABEL}</small>` : ''}<span class="panel-drag-hint">按住这里拖动</span></span>
      </div>
      <div id="${ROOT_ID}-connection" data-online="false" title="本地文章服务未连接">未连接</div>
      <button id="${ROOT_ID}-settings" type="button" title="扩展设置与旧设置迁移" aria-label="扩展设置">设置</button>
      <button id="${ROOT_ID}-refresh" type="button" title="刷新版本" aria-label="刷新版本">↻</button>
      <button id="${ROOT_ID}-collapse" type="button" title="最小化面板">—</button>
    </div>
    <div class="panel-body">
      <div class="panel-tabs" aria-label="文章列表">
        <button id="${ROOT_ID}-active" type="button" aria-pressed="true">文章 · 0</button>
        <button id="${ROOT_ID}-archive" type="button" aria-pressed="false">归档 · 0</button>
      </div>
      <div id="${ROOT_ID}-mention-picker" hidden></div>
      <div id="${ROOT_ID}-versions"></div>
      <button id="${ROOT_ID}-cancel" type="button" hidden>取消本次写入</button>
      <div id="${ROOT_ID}-receipt" role="status" aria-live="polite" hidden></div>
      <p id="${ROOT_ID}-message" aria-live="polite"></p>
    </div>
  `
  const refresh = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-refresh`)
  const collapse = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-collapse`)
  const cancel = root.querySelector<HTMLButtonElement>(`#${ROOT_ID}-cancel`)
  root.querySelector(`#${ROOT_ID}-settings`)?.addEventListener('click', () => { void chrome.runtime.sendMessage({ channel: 'ksw-extension.v1', kind: 'options' }) })
  refresh?.addEventListener('click', () => void refreshVersions())
  for (const view of ['active', 'archive']) {
    root.querySelector(`#${ROOT_ID}-${view}`)?.addEventListener('click', () => {
      showArchived = view === 'archive'
      renderVersions()
    })
  }
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
  startAutoRefresh()
}

function maintainPage() {
  syncReceipt()
  if (isThreadPage()) {
    createPanel()
  } else {
    document.querySelector(`#${ROOT_ID}`)?.remove()
    stopAutoRefresh()
  }
}

function startCompanion() {
  const observer = new MutationObserver((records) => {
    maintainPage()
    if (lastWrite && records.some(record => record.target === lastWrite!.editor || lastWrite!.editor.contains(record.target))) syncReceipt()
    if (imageCacheEditor && !imageCacheEditor.isConnected) {
      imageCacheEditor = null
      imageFileKeys.clear()
      reusableImagePackageIds.clear()
      renderVersions()
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('input', syncReceipt, true)
  document.addEventListener('change', syncReceipt, true)
  window.addEventListener('hashchange', maintainPage)
  window.addEventListener('popstate', maintainPage)
  window.addEventListener('resize', () => {
    const root = document.querySelector<HTMLElement>(`#${ROOT_ID}`)
    if (root) {
      root.style.left = `${Math.max(12, Math.min(root.offsetLeft, window.innerWidth - root.offsetWidth - 12))}px`
      root.style.top = `${Math.max(12, Math.min(root.offsetTop, window.innerHeight - root.offsetHeight - 12))}px`
      clampAndSavePanelPosition(root)
    }
  })
  maintainPage()

  window.addEventListener('ksw-preferences-changed', () => renderVersions())
}
void initializePreferences().then(startCompanion).catch(error => { console.error('Space Writer 初始化失败', error) })
