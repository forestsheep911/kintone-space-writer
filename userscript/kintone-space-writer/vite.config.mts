import path from 'node:path'
import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

const root = __dirname

export default defineConfig(({ mode }) => ({
  plugins: [
    monkey({
      entry: path.resolve(root, 'src/index.ts'),
      userscript: {
        // Keep the original name+namespace identity so installing the standard
        // build upgrades the already-installed POC instead of creating a second script.
        name: {
          '': 'kintone-rich-editor-poc',
          'zh-CN': 'kintone Space Writer（本地配套版）',
        },
        namespace: 'https://github.com/forestsheep911/codex-plugin-marketplace-2water',
        version: '0.2.5',
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
