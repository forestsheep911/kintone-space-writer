// ==UserScript==
// @name         kintone-rich-editor-poc
// @name:zh-CN   kintone Space Writer（旧设置导出）
// @namespace    https://github.com/forestsheep911/codex-plugin-marketplace-2water
// @version      0.3.1
// @description  One-time export of existing Space Writer archive flags and panel settings
// @match        https://*.cybozu.com/k/*
// @match        https://*.cybozu.cn/k/*
// @match        https://*.kintone.com/k/*
// @match        https://*.cybozu-dev.com/k/*
// @grant        GM_listValues
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(() => {
  'use strict'
  const button = document.createElement('button')
  button.textContent = '导出旧版设置'
  button.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;padding:12px 18px;border:1px solid #c7d2fe;border-radius:10px;background:#edf3ff;color:#2449a6;font:14px system-ui;cursor:pointer'
  button.addEventListener('click', () => {
    const preferences = Object.fromEntries(GM_listValues()
      .filter(key => key === 'ksw-standard-panel-state' || key.startsWith('ksw-archived-article:'))
      .map(key => [key, GM_getValue(key)]))
    const data = JSON.stringify({ schema: 'kintone-space-writer.preferences.v1', exportedAt: new Date().toISOString(), preferences }, null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'space-writer-tampermonkey-settings.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  document.body.append(button)
})()
