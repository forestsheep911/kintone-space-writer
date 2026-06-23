# Usage Guide

This guide describes the normal article workflow for `kintone-space-writer`.

## 1. Create A Workspace

Use one folder per article, topic, or small article series.

Recommended shape:

```text
my-article-workspace/
  kintone-space-writer.md
  .env
  kintone-targets.yaml
  drafts/
  assets/
  metadata/
    publish-log/
```

The plugin source can live elsewhere. The workspace keeps article-specific drafts, settings, and publish records.

## 2. Initialize Local Settings

Run these commands from the article workspace:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-env
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-targets
```

If the plugin path is different in your workspace, adjust the path to `kintone_space_comment.py`.

## 3. Fill `.env`

`.env` keeps secrets only.

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

## 5. Run Preflight

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

## 6. Draft The Article

Use the `kintone-space-writer` skill to draft or revise the article.

Before final handoff, apply the `anti-ai-tone` skill. It should reduce formulaic phrasing while keeping the article useful and source-faithful.

## 7. Dry Run

Dry-run the comment payload:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --dry-run
```

The dry run prints the comment payload without calling the kintone API.

## 8. Post To Test

Post to a test target first when available:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/test --draft-id article-v001 --title "Article title"
```

Ask the user to inspect the kintone Web UI after the test comment is created.

## 9. Post To The Official Target

After the user confirms the test rendering and content:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/prod --draft-id article-v001 --title "Article title"
```

Test and production comments receive separate kintone comment IDs.

## 10. Mark Local Records

If the user deletes a wrong test comment manually in kintone, mark the local record:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py mark-record --record metadata/publish-log/test/<record>.json --status deleted-manual --note "Deleted in kintone Web UI after wrong target or text."
```

Create a new draft version before reposting.
