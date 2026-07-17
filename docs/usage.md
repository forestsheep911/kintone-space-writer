# Usage Guide

This guide describes the standard rich-article workflow and the preserved REST fallback.

## 1. Create A Workspace

Use one folder per article, topic, or small article series.

Recommended shape:

```text
my-article-workspace/
  kintone-space-writer.md
  drafts/
    article-v001.rich.json
  assets/
  metadata/
    publish-log/
```

The plugin source can live elsewhere. The workspace keeps article-specific drafts, settings, and publish records.

## 2. Optional REST Fallback Settings

Only the REST fallback needs `.env` and `kintone-targets.yaml`. Run these
commands from the article workspace when you plan to use that route:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-env
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-targets
```

If the plugin path is different in your workspace, adjust the path to `kintone_space_comment.py`.

## 3. Fill `.env`

`.env` keeps secrets only and is required only by the REST fallback.

Example:

```dotenv
KINTONE_TARGET=test-news

KINTONE_TEST_PASSWORD=
KINTONE_ENV1_PASSWORD=
KINTONE_ENV2_PASSWORD=
```

`KINTONE_TARGET` is optional. It chooses the default target alias. When there is any chance of posting to the wrong place, pass `--target <alias>` explicitly.

## 4. Fill `kintone-targets.yaml`

The target file is nested by environment, Space, and thread.

Each thread needs one unique `alias`. That alias is the value used by commands and by natural-language publishing instructions.

Example:

```yaml
defaultTarget: test-news

environments:
  test:
    label: "Test environment"
    baseUrl: "https://test-example.cybozu.com"
    origins:
      - "https://test-example.cybozu.com"
      - "https://test-example.s.cybozu.com"
    username: "writer@example.com"
    passwordEnv: "KINTONE_TEST_PASSWORD"

    spaces:
      main:
        label: "Main test Space"
        spaceId: "10"

        threads:
          news:
            alias: "test-news"
            nickname: "Test article thread"
            threadId: "12"
            imageWidth: 600
```

These target fields are used only by the REST fallback. The rich browser route
does not need an origin, Space ID, Thread ID, or target alias: the user selects
the intended thread directly in kintone.

## 5. Install The Local Companion Userscript

Install this file in Tampermonkey:

```text
plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js
```

The panel appears only on matching Space thread pages.

The artifact is installed locally in Tampermonkey; it is not fetched from a
Store. The plugin starts the Bridge when an article is marked Ready, and the
companion finds the active loopback port automatically.

## 6. Draft The Rich Article

Use the `kintone-space-writer` skill to draft or revise the article, then apply
`anti-ai-tone`. Save ordered text and image blocks as
`drafts/article-v001.rich.json`; keep referenced image files below `assets/`.

See [rich-editor-bridge.md](rich-editor-bridge.md) for the schema and example.

## 7. Mark It Ready

From the article workspace:

```powershell
python <plugin>/scripts/kintone_article_bridge.py mark-ready --workspace . --article drafts/article-v001.rich.json --assets-root assets
```

This starts or reuses the Bridge. It does not create a Windows startup service.

## 8. Select A Version And Review

Open or refresh the intended Space thread.

- Click `刷新版本` in the companion panel to read retained local article versions.
  This is the only time the companion discovers the local Bridge.
- If the page still shows `发表评论…`, click that native entry once so kintone
  creates the rich editor.
- Click the compact `写` button for the desired version. Clicking a version
  again, or clicking a different version, replaces the editor content.
- Unchanged images at the same width reuse their temporary upload only while the
  same editor stays open; canceling/closing it or reloading uploads them again.
- Check all text, formats, links, images, and captions.
- Click kintone's native publish button yourself only when correct.

### Revise Before Publishing

For one article, keep the same `id` in its rich JSON and change its `version`
or content when revising. Run `mark-ready` again after every local revision.
All retained revisions appear after `刷新版本`. Select the version to apply;
there is no background sync. Treat the local JSON as authoritative and avoid
manually editing the mirrored kintone text.

After a successful native Publish, kintone removes the editor. If Publish fails
and the editor remains, choose any retained version again when you want to
replace its contents.

## REST Fallback

The remaining sections apply only when the rich Web route is unavailable.

### Run Preflight

Run preflight before any real post:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news preflight
```

Expected output is a non-secret summary:

```json
{
  "target": "test-news",
  "targetLabel": "Test environment / Main test Space / Test article thread",
  "baseUrl": "https://test-example.cybozu.com",
  "spaceId": "10",
  "threadId": "12",
  "imageWidth": 600,
  "auth": "username-password"
}
```

If a required file or value is missing, the script prints setup instructions instead of a raw traceback.

### Dry Run

Dry-run the comment payload:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --dry-run
```

The dry run prints the comment payload without calling the kintone API.

### Post To Test

Post to a test target first when available:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/test --draft-id article-v001 --title "Article title"
```

Ask the user to inspect the kintone Web UI after the test comment is created.

### Post To The Official Target

After the user confirms the test rendering and content:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/prod --draft-id article-v001 --title "Article title"
```

Test and production comments receive separate kintone comment IDs.

### Mark Local Records

If the user deletes a wrong test comment manually in kintone, mark the local record:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py mark-record --record metadata/publish-log/test/<record>.json --status deleted-manual --note "Deleted in kintone Web UI after wrong target or text."
```

Create a new draft version before reposting.
