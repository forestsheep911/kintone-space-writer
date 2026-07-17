# kintone Space Writer userscript

This is the locally installed companion userscript for rich kintone Space
articles. A local
Bridge retains local article versions; the script uploads their images
through the authenticated kintone Web UI and writes all ordered text/image
blocks into the native comment editor only after the user selects a version.
The user reviews the result and clicks the native publish button.

On a freshly loaded thread, kintone requires one real user click on its native
`发表评论…` entry before it creates the rich editor. After it expands, select the
desired version from the panel.

The floating panel intentionally contains only:

- Bridge connection state;
- a `刷新版本` button, which is the only action that discovers a local Bridge;
- retained article versions, each with a compact `写` button;
- the current result or error message.

It writes only into the thread where the user has personally opened the rich
comment editor, and never clicks Publish. Selecting any version explicitly
replaces the open editor, including a version already applied earlier.

The companion userscript explicitly covers normal kintone tenant hosts and SecureAccess-style hosts such as:

```text
https://cybozush.cybozu.cn/k/...
https://cybozush.s.cybozu.cn/k/...
https://example.s.kintone.com/k/...
https://example.cybozu-dev.com/k/...
```

There is no destination YAML for the rich route: the current thread is the
destination, confirmed by the user's click on `发表评论…` and version selection.

## Build and install

```powershell
cd userscript/kintone-space-writer
pnpm install
pnpm build
```

Install or update:

`plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js`

The base userscript identity intentionally remains compatible with the earlier
POC, so installing this file once upgrades that script instead of leaving two
floating panels. Tampermonkey displays the localized standard-version name.

## Continuous development install

For ongoing local development, start `pnpm dev`. It starts Vite on port 8865
(or the next free port) and exposes an installable development userscript at:

`http://127.0.0.1:8865/__vite-plugin-monkey.install.user.js`

Install that development script in Tampermonkey once. It loads the entry module
from Vite, so source changes are served immediately; reload the kintone page to
pick up a revision. The development script is valid only while the local Vite
server is running. Use the built artifact only when returning to a standalone
normal-use installation.

The Codex plugin starts the Bridge on demand; the companion discovers its active
port in the fixed loopback range only after `刷新版本` and verifies its health
token, so no port configuration is needed.

## Image upload route

The script follows the Web UI behavior confirmed in the project POC: it uploads
to `/k/api/blob/upload.json`, reads `result.fileKey`, and creates the native
`img.cybozu-tmp-file` editor shape. This is an internal Web UI route and may
need adaptation after a kintone update. The REST publisher remains the fallback.
For one live native editor, unchanged local image bytes at the same width reuse
the prior temporary `fileKey`; the corresponding `写` button receives a subtle
green treatment and “图片可复用” label. Changed image bytes, changed width,
cancel/close, or page reload uploads the image again and returns the button to
its ordinary appearance.

`imageRow` article blocks place two or more images inline when the editor has
enough room. Each image keeps its own `width` (100–750). Images wrap naturally
on a narrow editor; do not add CSS spacing styles to temporary image nodes.

Compatibility rule: manually inserted inline images persist as direct sibling
temporary-image elements in one block `div`, followed by `<br>`. Do not
introduce per-image wrappers, tables, figures, or CSS grid/flex containers. A
filename shown in place of an image means kintone classified that upload as an
attachment rather than an inline image. The userscript verifies after writing
that kintone retained every expected image; persisted DOM shape alone is not
proof that a programmatic insertion path is accepted.

Native “original size” has a distinct DOM form: class
`cybozu-img-file-original`, source-pixel `width`, and a download URL with
`r=true` but no `w`. It should be modeled explicitly if added later, and is not
the default for image rows because it may make images wrap.
