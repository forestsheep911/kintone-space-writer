# kintone Space Writer userscript

This is the standard Store userscript for rich kintone Space articles. A local
Bridge supplies one target-bound Ready package; the script uploads its images
through the authenticated kintone Web UI and injects all ordered text/image
blocks into the native comment editor. The user reviews the result and clicks
the native publish button.

On a freshly loaded thread, kintone requires one real user click on its native
`发表评论…` entry before it creates the rich editor. The package remains Ready
until that happens. No additional click or cursor placement is needed after the
editor expands; automatic mode continues on its next poll.

The floating panel intentionally contains only:

- Bridge connection state;
- `Ready 后自动注入` switch;
- a manual Ready injection button while automatic injection is off;
- the current result or error message.

It will not overwrite a non-empty editor, inject into a mismatched
origin/Space/Thread, repeat an already injected package, or click Publish.

The Store userscript explicitly covers normal kintone tenant hosts and SecureAccess-style hosts such as:

```text
https://cybozush.cybozu.cn/k/...
https://cybozush.s.cybozu.cn/k/...
https://example.s.kintone.com/k/...
https://example.cybozu-dev.com/k/...
```

Runtime target checks must still match the full current origin, Space ID, and Thread ID before injection.

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

For selector development, `pnpm dev` still starts at port 8865 and advances to
the next free port automatically.

## Image upload route

The script follows the Web UI behavior confirmed in the project POC: it uploads
to `/k/api/blob/upload.json`, reads `result.fileKey`, and creates the native
`img.cybozu-tmp-file` editor shape. This is an internal Web UI route and may
need adaptation after a kintone update. The REST publisher remains the fallback.
