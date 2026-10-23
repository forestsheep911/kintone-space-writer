# Rich editor Bridge

The standard route stages an ordered rich article in the authenticated kintone
Space comment editor. The user remains responsible for reviewing it and clicking
the native publish button. The REST publisher remains available as a fallback.

## Components

Tool examples use the Windows launcher. On macOS/Linux replace the PowerShell
prefix with `sh "<plugin>/scripts/run.sh"`; preserve the `bridge` / `rest` tool
selector and remaining arguments. The launcher prepares the private runtime as
described in the plugin's `INSTALL.md`.

```text
article workspace
  drafts/article-v001.rich.json + assets/*
       | mark-ready (starts/reuses loopback Bridge)
       v
127.0.0.1:8787..8807
       | user opens `发表评论…` in the intended thread
       v
local companion Chrome extension -> kintone rich editor -> user review -> user clicks Publish
```

The Bridge is not a Windows startup service. A plugin operation starts it
idempotently, it serves only the current workspace, and it exits after an idle
period. Runtime state lives in ignored `local-runs/kintone-space-writer/`.

The normal `ensure-bridge` / `mark-ready` entry points reuse a healthy instance
and coordinate startup with `start.lock`. The `serve` process also holds a
workspace-specific OS file lock for its entire lifetime, so calling `serve`
directly cannot create a second participating instance for the same resolved
workspace. A duplicate exits with an error directing the caller to
`ensure-bridge`, before binding a port or modifying `bridge.json`.

The lifetime lock uses [`msvcrt.locking`](https://docs.python.org/3/library/msvcrt.html)
on Windows and [`fcntl.flock`](https://docs.python.org/3/library/fcntl.html) on Unix.
Its `serve.lock` file intentionally remains after shutdown; the OS lock, rather
than the file's presence or age, determines ownership. Normal exit, startup
failure, and process termination release ownership without deleting that file.
Stale discovery state can be replaced on the next successful start. A healthy
older Bridge that predates the lock is also checked and preserved. Different
workspaces may each run their own Bridge. Previously installed copies of the
script must be updated/restarted to gain the new protection.

The Windows process tests and isolated extension regression for this change are
recorded in `validation-20261023-bridge-single-instance.json`. The Unix lock
branch has not been run on a Unix host in this validation.

## Destination confirmation

The rich route has no `kintone-targets.yaml` requirement. The user navigates to
the intended Space thread, personally clicks `发表评论…` to create its native
editor, then selects a version from the panel. Those two explicit browser
actions are the destination confirmation. The package is retained locally and
can be selected in any thread the user opens; it is never posted automatically.

`kintone-targets.yaml` remains required only for the REST fallback, which can
post without an open browser editor.

## Article JSON

```json
{
  "schema": "kintone-rich-article.v1",
  "id": "weekly-news",
  "version": "v001",
  "title": "本周更新",
  "revisionNote": "初稿",
  "blocks": [
    {"type": "heading", "level": 1, "text": "本周更新"},
    {"type": "paragraph", "text": "先说结论。", "bold": true},
    {"type": "paragraph", "text": "重点词示例", "runs": [{"text": "重点词", "bold": true, "color": "#0F766E"}, {"text": "示例", "backgroundColor": "#FEF3C7"}]},
    {"type": "image", "fileName": "chart.png", "caption": "图 1：本周趋势", "width": 500},
    {"type": "bulletList", "items": ["第一项", {"runs": [{"text": "第二项／"}, {"text": "第二项的译文", "backgroundColor": "#FEF3C7"}]}]},
    {"type": "paragraph", "text": "查看详情", "link": "https://example.com"}
  ]
}
```

Text blocks: `heading`, `paragraph`, `quote`, `bulletList`, `numberList`, and
`divider`, and `imageRow`. Text formatting includes bold, italic, underline,
link, foreground and background hex colors, font size, and alignment. Paragraphs,
headings, quotes, and individual list items can also use `runs`: ordered inline text fragments whose
own bold, italic, underline, link, color, background color, and font size apply
only to that fragment. Text blocks default to left alignment; use `align` only
when a different alignment is intentional. An
`image` block references a file below the selected assets directory and can set
caption and width. An `imageRow` contains at least two image blocks, gives each
its own `width` (100–750), and may set alignment:

```json
{
  "type": "imageRow",
  "align": "center",
  "images": [
    {"type": "image", "fileName": "left.png", "width": 320, "caption": "左图"},
    {"type": "image", "fileName": "right.png", "width": 240, "caption": "右图"}
  ]
}
```

The editor displays row images inline where space allows and wraps them when it
does not.

### Native image-row compatibility rule

kintone's rich editor preserves manually inserted inline images as consecutive
editor-native `img.cybozu-tmp-file` elements in the same block `div`, followed
by `<br>`. Use that as the required persisted DOM shape: do not wrap individual
images in `span`, nested `div`, `figure`, table, or CSS layout containers.
Apply per-image sizing through the native `width` attribute. Do not set CSS
styles on the temporary image node: a non-empty image `style` can cause kintone
to remove it during its editor cleanup.

This rule comes from inspecting content written through kintone's own editor:
three manually inserted images in one row were direct sibling `img` elements.
An item represented as an attachment link instead of `img.cybozu-tmp-file`
showed its filename rather than an inline preview; treat that as an upload/type
classification issue, not an image-row layout form. This persisted DOM shape
alone does not prove an automated insertion path is accepted; the extension
must verify the expected number of image nodes after writing and report failure
when kintone sanitizes them away.

When a user chooses kintone's native **original size** action, the editor does
not merely omit `width`: it adds `cybozu-img-file-original`, sets `width` to the
source image's pixel width, and uses the download URL with `r=true` but no `w`
parameter. A normally resized image uses `width=<chosen size>` and `r=true&w=`.
Keep original-size support as an explicit future schema option rather than
guessing from a large numeric width. It is deliberately not the default for an
`imageRow`, because an original-width image can force the row to wrap.

## Ready operation and manual versions

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" bridge mark-ready `
  --workspace . `
  --article drafts/article-v001.rich.json `
  --assets-root assets
```

Every distinct article version remains available in the local Bridge. When the
version panel is open on the intended Space thread, it discovers the local
Bridge automatically and checks its version list every five seconds. Newly
marked Ready packages therefore appear without clicking `刷新版本`; the button
remains available for an immediate manual retry. The panel re-scans the bounded
port range every 30 seconds so a newly started Bridge is picked up as well.

This automatic refresh never writes into the editor or publishes. The user
still clicks the version's `写` button to write it into the open native editor.
An upload or selector failure is shown in the panel without publishing anything.

Keep `id` and `title` stable while revising one article. The panel groups
versions by `id`, presents the title once as a collapsible article heading, and
shows `v001`, `v002`, and later revisions only inside that group.
Set the optional `revisionNote` (at most 40 characters) for the short change
summary displayed immediately before the version label, such as `初稿` or
`补充案例`.

### Native mentions

Use a `mention` run inside a text block when an article needs to notify a
person, group, or organization. `query` is resolved against the current Space
directory at write time; it is not treated as an identity by itself.

```json
{
  "type": "paragraph",
  "text": "@boccaroiceman",
  "runs": [
    {"mention": {"query": "boccaroiceman", "entityType": "USER"}}
  ]
}
```

`entityType` is optional and may be `USER`, `GROUP`, or `ORGANIZATION`. A
single exact code/name match is selected automatically. Otherwise the panel
shows the current Space's candidates and requires the user to choose one. The
extension then calls kintone's native selection route before inserting the
editor-native mention node; plain `@name` text is never presented as a real
mention.

kintone requires one real user gesture before it creates the rich comment
editor. If the page still shows the collapsed `发表评论…` entry, click it once,
then explicitly click the desired version in the panel.

The extension reuses an uploaded image only while that same native editor is
open, and only when both the local asset digest and rendered width are unchanged.
Changing the image or width, closing/canceling the editor, or reloading the page
uploads it again.

## Local companion Chrome extension

Build and package:

```powershell
cd extension
pnpm install
pnpm check
pnpm package
```

Drag the ZIP from `dist/` onto `chrome://extensions` with developer mode
enabled. Chrome extracts and loads it; manual directory loading is optional. Disable the old Tampermonkey
Space Writer script and refresh kintone. See [installation and settings
migration](../extension/README.md). Updates can be delivered by dragging a new ZIP with the same public key onto
the extensions page; they do not use Tampermonkey update URLs.

The extension covers normal and SecureAccess hosts for `cybozu.com`,
`cybozu.cn`, `kintone.com`, and `cybozu-dev.com`. Its background performs only
fixed authenticated Bridge operations at `127.0.0.1:8787–8807`. Page scripts
retain same-origin image uploads and native editor insertion; a fixed MAIN
world function obtains the kintone request token for the requesting document.

The plugin starts the Bridge on demand. While the version panel is open,
the extension discovers its port and verifies the health token automatically.
The article schema and Python Bridge remain compatible with legacy clients.

## Safety and compatibility

- The script never clicks the native publish button.
- It writes only after an explicit version button click, which may replace the
  current editor content.
- Package claims and local deduplication keep each version traceable.
- kintone editor DOM and `/k/api/blob/upload.json` are internal Web behavior and
  may need adaptation after kintone changes.
- The REST publisher is retained for plain text plus up to five trailing files.
