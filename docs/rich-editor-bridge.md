# Rich editor Bridge

The standard route stages an ordered rich article in the authenticated kintone
Space comment editor. The user remains responsible for reviewing it and clicking
the native publish button. The REST publisher remains available as a fallback.

## Components

```text
article workspace
  drafts/article-v001.rich.json + assets/*
       | mark-ready (starts/reuses loopback Bridge)
       v
127.0.0.1:8787..8807
       | exact origin + Space + Thread match
       v
local companion userscript -> kintone rich editor -> user review -> user clicks Publish
```

The Bridge is not a Windows startup service. A plugin operation starts it
idempotently, it serves only the current workspace, and it exits after an idle
period. Runtime state lives in ignored `local-runs/kintone-space-writer/`.

## Prepare a target

`kintone-targets.yaml` must contain the exact browser origins and destination
IDs before an article can become Ready:

```yaml
defaultTarget: customer-news
environments:
  customer:
    baseUrl: https://cybozush.cybozu.cn
    origins:
      - https://cybozush.cybozu.cn
      - https://cybozush.s.cybozu.cn
    spaces:
      main:
        spaceId: "10"
        threads:
          news:
            alias: customer-news
            threadId: "12"
```

The same model covers `.cybozu.com`, `.cybozu.cn`, `.kintone.com`, and
`.cybozu-dev.com`, including their `.s.` forms. Only list origins the user has
confirmed. The Bridge and userscript both require an exact origin, Space ID,
and Thread ID match.

## Article JSON

```json
{
  "schema": "kintone-rich-article.v1",
  "id": "weekly-news",
  "version": "v001",
  "title": "本周更新",
  "blocks": [
    {"type": "heading", "level": 1, "text": "本周更新", "align": "center"},
    {"type": "paragraph", "text": "先说结论。", "bold": true},
    {"type": "image", "fileName": "chart.png", "caption": "图 1：本周趋势", "width": 500},
    {"type": "bulletList", "items": ["第一项", "第二项"]},
    {"type": "paragraph", "text": "查看详情", "link": "https://example.com"}
  ]
}
```

Text blocks: `heading`, `paragraph`, `quote`, `bulletList`, `numberList`, and
`divider`. Text formatting includes bold, italic, underline, link, foreground
and background hex colors, font size, and alignment. An `image` block references
a file below the selected assets directory and can set caption and width.

## Ready operation

```powershell
python <plugin>/scripts/kintone_article_bridge.py mark-ready `
  --workspace . `
  --article drafts/article-v001.rich.json `
  --assets-root assets `
  --targets kintone-targets.yaml `
  --target customer-news
```

With `Ready 后自动注入` enabled, the userscript polls and injects the matching
package. With it disabled, click `手动注入 Ready 文章`. A missing Ready package,
target mismatch, non-empty editor, upload failure, or selector failure is shown
in the panel without publishing anything.

kintone requires one real user gesture before it creates the rich comment
editor. If the page still shows the collapsed `发表评论…` entry, click it once.
The package remains Ready while the entry is collapsed; after the rich editor
appears, automatic mode continues with upload and injection on the next poll.

## Local companion userscript

Build:

```powershell
cd userscript/kintone-space-writer
pnpm install
pnpm build
```

Install the generated file:

```text
plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js
```

The companion metadata covers normal and SecureAccess-style hosts for
`cybozu.com`, `cybozu.cn`, `kintone.com`, and `cybozu-dev.com`.

This is a local Tampermonkey installation, not a Store release. `pnpm dev` is
for selector debugging; install the `pnpm build` artifact for normal testing.
The plugin starts the Bridge on demand, while the companion discovers the
active Bridge in the fixed loopback range and verifies its health token. No
port entry is required.

## Safety and compatibility

- The script never clicks the native publish button.
- It refuses to overwrite a non-empty editor.
- Package claims and local deduplication prevent repeated injection.
- kintone editor DOM and `/k/api/blob/upload.json` are internal Web behavior and
  may need adaptation after kintone changes.
- The REST publisher is retained for plain text plus up to five trailing files.
