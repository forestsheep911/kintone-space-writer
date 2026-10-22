import { exportPreferenceFile, parsePreferenceFile } from './preferences'

const status = document.querySelector<HTMLElement>('#status')!
const input = document.querySelector<HTMLInputElement>('#import')!
document.querySelector('#identity')!.textContent = `版本 ${chrome.runtime.getManifest().version} · ID ${chrome.runtime.id}`
async function displayCounts() {
  const values = await chrome.storage.local.get(null)
  document.querySelector('#count')!.textContent = `已归档 ${Object.entries(values).filter(([key, value]) => key.startsWith('ksw-archived-article:') && value === true).length} 篇文章`
}
input.addEventListener('change', () => {
  void (async () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 1024 * 1024) throw new Error('设置文件不能超过 1 MB。')
    const values = parsePreferenceFile(await file.text())
    await chrome.storage.local.set(values)
    await displayCounts()
    status.textContent = `已导入 ${Object.keys(values).length} 项设置。文章列表已同步；小窗位置会在刷新 kintone 页面后应用。`
  })().catch(error => { status.textContent = `导入失败：${error instanceof Error ? error.message : String(error)}` })
    .finally(() => { input.value = '' })
})
document.querySelector('#export')!.addEventListener('click', () => {
  void (async () => {
    const data = exportPreferenceFile(await chrome.storage.local.get(null))
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'space-writer-settings.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    status.textContent = '设置已导出。'
  })().catch(error => { status.textContent = `导出失败：${String(error)}` })
})
void displayCounts().catch(error => { status.textContent = `读取设置失败：${String(error)}` })
