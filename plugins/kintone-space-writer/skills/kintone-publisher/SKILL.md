---
name: kintone-publisher
description: Prepare, stage, or post kintone Space thread comments from workspace-local settings. Use when Codex needs to hand a rich article with inline images to the local Ready bridge or use the preserved REST fallback.
---

# Kintone Publisher

## Scope

Publish only by adding a comment to an existing kintone Space thread.

Do not update Space body content, thread body content, or create threads unless the user explicitly changes the route.

Use the rich Ready bridge as the standard route. It fills the browser editor but
does not publish. Preserve the REST route below as the fallback for plain text
and trailing attachments.

## Standard Rich-Article Flow

The locally installed companion userscript consumes `kintone-rich-article.v1`
JSON from the local Bridge. Resolve `../../scripts/kintone_article_bridge.py`
from this skill's directory; do not assume the plugin source is inside the
article workspace.

Before marking a draft Ready:

1. Build an ordered article JSON. Each image block must name a file below the
   selected assets root.
2. Start or reuse the Bridge and mark the package Ready in one operation:

```powershell
python <plugin>/scripts/kintone_article_bridge.py mark-ready --workspace . --article drafts/article-v001.rich.json --assets-root assets
```

`mark-ready` is idempotent. A new version of the same article is retained beside
earlier versions; the same unchanged version is not queued twice. The Bridge
binds only to `127.0.0.1`, chooses an available port in 8787–8807, and exits
after an idle period. The companion discovers this bounded range through
`/health` only after the user clicks `刷新版本`, then uses its returned token.
Do not create a Windows startup task or long-running service.

For an unpublished rich article, keep `article.id` stable and call `mark-ready`
after every local revision. The browser retains every local version;
the user selects which version replaces the editor. Do not manually edit the
mirrored kintone body.

After Ready:

- ask the user to open the intended Space thread and click `刷新版本` to list
  retained local versions; no background polling or injection occurs;
- if the page still shows the collapsed `发表评论…` entry, ask the user to
  click it once. kintone requires a real user gesture to create the rich editor;
- the user clicks the desired version's `写` button, which may replace a
  previously applied version in that live editor;
- the user always reviews the populated editor and clicks kintone Publish;
- never click Publish for the user.

The current thread is the rich-route destination, confirmed by the user's
native `发表评论…` click and explicit version selection. Do not require a target
alias, origin, Space ID, or Thread ID for this route.

Useful recovery commands:

```powershell
python <plugin>/scripts/kintone_article_bridge.py list --workspace .
python <plugin>/scripts/kintone_article_bridge.py retry --workspace . --package-id <id>
```

The article schema supports ordered `heading`, `paragraph`, `quote`,
`bulletList`, `numberList`, `divider`, `image`, and `imageRow` blocks. Text blocks may use
`bold`, `italic`, `underline`, `link`, hex `color`, hex `backgroundColor`,
`fontSize` 1–7, and `align`. Image blocks use `fileName`, optional `alt`,
`caption`, and `width` 100–750. An `imageRow` contains at least two images;
each image controls its own width. Text blocks default to left alignment. For
a few emphasized terms inside an otherwise normal paragraph, use ordered
`runs` (each with `text` and optional inline formatting) rather than coloring
or highlighting the whole block.

For `imageRow`, target kintone's native persisted editor shape: consecutive
`img.cybozu-tmp-file` elements as direct children of one block `div`, followed
by `<br>`. Never wrap those images in `span`, nested `div`, `figure`, a table,
or CSS grid/flex layout containers. If kintone renders a filename/link instead
of an inline `img.cybozu-tmp-file`, it classified the upload as an attachment;
fix the image upload path rather than the row layout. Always verify after a
programmatic write that the expected image nodes remain: matching the manually
observed persisted DOM alone does not guarantee that kintone accepts the
insertion mechanism.

Do not infer native “original size” from a large `width`. Its confirmed shape
adds `cybozu-img-file-original`, uses the source-pixel width, and downloads with
`r=true` without `w`; model it as an explicit future option. Avoid original size
in image rows by default because it can force wrapping.

## REST Fallback Environment

Load kintone publishing targets from the user's article/workspace `kintone-targets.yaml`.
Load secrets and optional default target selection from the workspace `.env`.

Prefer target aliases over separate env files. The YAML is nested by kintone mental model: environment, then Space, then Thread. Each thread defines a unique `alias`, and publishing commands use only that alias. Use names the user can say naturally, such as `test-news`, `company-news`, or `branch-news`.

If the workspace target or env file is missing or incomplete, do not ask the user to infer the format. Tell them exactly which file to create and point them to the bundled examples. Prefer the script's setup commands because they copy the right templates into the current article workspace:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-env
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-targets
```

After the user fills `.env` passwords and edits `kintone-targets.yaml`, run `preflight` for the requested alias before any real post.

YAML environment fields:

- `label`
- `baseUrl`
- `origins` (browser origins recorded for REST target configuration)
- `username`
- `passwordEnv`

YAML Space fields:

- `label`
- `spaceId`

YAML Thread fields:

- `alias`
- `nickname`
- `threadId`
- `imageWidth`

Env fields:

- `KINTONE_TARGET` optional default target alias
- password variables referenced by `passwordEnv`, for example `KINTONE_TEST_PASSWORD`

Never store real credentials in plugin files, skill references, examples beyond placeholders, or shared plugin knowledge.

Workspace writing preferences may live in `kintone-space-writer.md`, but publishing target IDs belong in `kintone-targets.yaml` and secrets belong in `.env`.

## Natural-Language Publish Flow

When the user asks to publish and both test and official target aliases are available, guide them conversationally:

1. Send to the test environment first unless the user explicitly says to skip test.
2. After the test comment is created, report the comment ID and ask the user to inspect formatting/content in kintone Web UI.
3. If the user says it looks correct, send the same draft and attachments to production.
4. If the user says it is wrong, help revise the draft, then resend to test. The user deletes wrong test comments manually in kintone if needed.

Use publish records to keep the mapping:

- test records: `metadata/publish-log/test/`
- production records: `metadata/publish-log/prod/`

Test and production posts have separate kintone comment IDs.

## Comment Images

For images, use the file upload API first, then attach returned file keys to `comment.files`.

The REST comment API orders content as mentions, text, then files. It cannot
place images between article paragraphs; use the standard Ready bridge for that.

## Comment Text Formatting

Treat `comment.text` as plain text. Existing smoke tests showed that bare URLs may become clickable in kintone Web UI, but Markdown-style formatting should be assumed to display literally.

Use character-based layout: full-width brackets for titles, blank lines, numbered sections, `・` bullets, and bare URLs.

Emoji sent through `comment.text` rendered correctly in smoke tests and may be used as lightweight visual markers. Keep important meaning in text, not emoji alone.

## Script

Use `../../scripts/kintone_space_comment.py` for dry runs, file upload, and comment posting.

Recommended preflight:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-env
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-targets
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news preflight
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news preflight
```

Dry-run a comment payload:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file article.txt --image cover.png --dry-run
```

Post after review:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file article.txt --image cover.png
```

For production posts, write a local publish record:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file drafts/article-v001.md --image assets/cover.png --archive-dir metadata/publish-log/test --draft-id article-v001 --title "Article title"

python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news post-comment --text-file drafts/article-v001.md --image assets/cover.png --archive-dir metadata/publish-log/prod --draft-id article-v001 --title "Article title"
```

If the user deletes a wrong comment manually in kintone, mark the local record:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py mark-record --record metadata/publish-log/<record>.json --status deleted-manual --note "Deleted in kintone Web UI after wrong target/text."
```

Then create a new draft version and post again. Do not overwrite the old publish record.
