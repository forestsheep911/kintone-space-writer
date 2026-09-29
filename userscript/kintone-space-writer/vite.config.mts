import path from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'
import packageJson from './package.json' with { type: 'json' }

const root = __dirname
const installUrl = 'https://forestsheep911.github.io/kintone-space-writer/kintone-space-writer.user.js'
const builtScript = path.resolve(root, '../../plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js')
const publicScript = path.resolve(root, '../../docs/kintone-space-writer.user.js')

export default defineConfig(({ mode }) => ({
  plugins: [
    {
      name: 'copy-userscript-to-pages',
      closeBundle() {
        if (mode !== 'production') return
        mkdirSync(path.dirname(publicScript), { recursive: true })
        copyFileSync(builtScript, publicScript)
      },
    },
    monkey({
      entry: path.resolve(root, 'src/index.ts'),
      userscript: {
        // Keep the original name+namespace identity so installing the standard
        // build upgrades the already-installed POC instead of creating a second script.
        name: {
          '': 'kintone-rich-editor-poc',
          'zh-CN': 'kintone Space Writer（开发调试版）',
        },
        namespace: 'https://github.com/forestsheep911/codex-plugin-marketplace-2water',
        version: packageJson.version,
        updateURL: installUrl,
        downloadURL: installUrl,
        description: 'Inject Ready rich articles from the local kintone Space Writer bridge',
        author: '2water',
        match: [
          'https://*.cybozu.com/k/*',
          'https://*.s.cybozu.com/k/*',
          'https://*.cybozu.cn/k/*',
          'https://*.s.cybozu.cn/k/*',
          'https://*.kintone.com/k/*',
          'https://*.s.kintone.com/k/*',
          'https://*.cybozu-dev.com/k/*',
          'https://*.s.cybozu-dev.com/k/*',
        ],
        'run-at': 'document-end',
        grant: ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'unsafeWindow'],
        connect: ['127.0.0.1', 'localhost'],
      },
      server: { open: true, prefix: false },
      build: {
        fileName: 'kintone-space-writer.user.js',
        autoGrant: false,
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 8865,
    strictPort: false,
    cors: true,
  },
  build: {
    outDir: path.resolve(root, '../../plugins/kintone-space-writer/assets/userscript'),
    emptyOutDir: true,
    minify: mode === 'production',
    sourcemap: mode !== 'production',
    target: 'es2020',
  },
}))
