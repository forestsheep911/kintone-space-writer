export const ARCHIVE_PREFIX = 'ksw-archived-article:'
export const PANEL_KEY = 'ksw-standard-panel-state'
export const PREFERENCE_SCHEMA = 'kintone-space-writer.preferences.v1'

export function migratablePreferences(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式无效。')
  const result: Record<string, unknown> = {}
  if (Object.keys(input).length > 5000) throw new Error('设置条目过多。')
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith(ARCHIVE_PREFIX) && key.length > ARCHIVE_PREFIX.length && key.length <= 512 && typeof value === 'boolean') result[key] = value
    else if (key === PANEL_KEY && value && typeof value === 'object') {
      const panel = value as { left?: unknown; top?: unknown; collapsed?: unknown }
      if (typeof panel.left !== 'number' || !Number.isFinite(panel.left) || Math.abs(panel.left) > 100000 || typeof panel.top !== 'number' || !Number.isFinite(panel.top) || Math.abs(panel.top) > 100000 || typeof panel.collapsed !== 'boolean') throw new Error('小窗位置设置无效。')
      result[key] = { left: panel.left, top: panel.top, collapsed: panel.collapsed }
    } else throw new Error(`不支持的设置条目：${key.slice(0,80)}`)
  }
  return result
}

export function parsePreferenceFile(text: string) {
  if (text.length > 1024 * 1024) throw new Error('设置文件不能超过 1 MB。')
  const data = JSON.parse(text) as { schema?: string; preferences?: unknown }
  if (data?.schema !== PREFERENCE_SCHEMA) throw new Error('请选择 Space Writer 导出的设置文件。')
  return migratablePreferences(data.preferences)
}

export function exportPreferenceFile(values: Record<string, unknown>) {
  const selected = Object.fromEntries(Object.entries(values).filter(([key]) => key === PANEL_KEY || key.startsWith(ARCHIVE_PREFIX)))
  return JSON.stringify({ schema: PREFERENCE_SCHEMA, exportedAt: new Date().toISOString(), preferences: migratablePreferences(selected) }, null, 2)
}
