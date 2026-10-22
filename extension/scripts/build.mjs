import { build } from 'esbuild'
import { createHash, createPublicKey } from 'node:crypto'
import { readFile, mkdir, cp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const identity = JSON.parse(await readFile(path.join(root, 'identity.json'), 'utf8'))
const bytes = Buffer.from(identity.key, 'base64')
createPublicKey({ key: bytes, format: 'der', type: 'spki' })
const id = [...createHash('sha256').update(bytes).digest('hex').slice(0,32)].map(c => String.fromCharCode(97 + parseInt(c,16))).join('')
if (id !== identity.id) throw new Error('Extension public key does not match the pinned ID')
const out = path.join(root, '../dist/kintone-space-writer-extension')
if (path.dirname(out) !== path.resolve(root, '../dist') || path.basename(out) !== 'kintone-space-writer-extension') throw new Error('Unexpected build output path')
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await build({
  entryPoints: { content: path.join(root,'src/index.ts'), background: path.join(root,'src/background.ts'), options: path.join(root,'src/options.ts') },
  outdir: out, bundle: true, format: 'iife', target: 'chrome120', minify: true,
  define: { __DEV__: 'false', __VERSION__: JSON.stringify(pkg.version) },
})
const matches = ['cybozu.com','cybozu.cn','kintone.com','cybozu-dev.com'].map(domain => `https://*.${domain}/k/*`)
const manifest = {
  manifest_version: 3, name: 'kintone Space Writer', version: pkg.version,
  description: '把本地文章与配图写入 kintone Space 评论编辑器，检查后由你发布。',
  minimum_chrome_version: '120', key: identity.key,
  permissions: ['storage','scripting'], host_permissions: [...matches, 'http://127.0.0.1/*'],
  background: { service_worker: 'background.js' },
  content_scripts: [{ matches, js: ['content.js'], run_at: 'document_idle', all_frames: false }],
  action: { default_title: 'Space Writer 设置与迁移' },
  options_ui: { page: 'options.html', open_in_tab: true },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
}
await writeFile(path.join(out,'manifest.json'), JSON.stringify(manifest,null,2)+'\n')
await cp(path.join(root,'static'), out, { recursive: true })
await cp(path.join(root,'migration'), path.join(out,'migration'), { recursive: true })
await cp(path.join(root,'../plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js'),path.join(out,'migration/rollback-tampermonkey.user.js'))
await cp(path.join(root,'README.md'),path.join(out,'安装说明.md'))
console.log(`Built ${pkg.version} · ${id} · ${out}`)
