---
name: kintone-publisher
description: Prepare or post kintone Space thread comments from workspace-local environment settings. Use when Codex needs to validate kintone comment publishing settings, upload article images as comment attachments, build a comment payload, or post a comment to an existing Space thread.
---

# Kintone Publisher

## Scope

Publish only by adding a comment to an existing kintone Space thread.

Do not update Space body content, thread body content, or create threads unless the user explicitly changes the route.

## Environment

Load kintone settings from the user's article/workspace `.env`.

Required:

- `KINTONE_BASE_URL`
- `KINTONE_USERNAME`
- `KINTONE_PASSWORD`
- `KINTONE_SPACE_ID`
- `KINTONE_THREAD_ID`

Optional:

- `KINTONE_GUEST_SPACE_ID`
- `KINTONE_IMAGE_WIDTH`

Never store real credentials in plugin files, skill references, examples beyond placeholders, or shared plugin knowledge.

## Comment Images

For images, use the file upload API first, then attach returned file keys to `comment.files`.

The comment API orders content as mentions, text, then files. Do not claim that this route can place images between article paragraphs. If users need true inline placement, record it as a future non-v0.1 route.

## Script

Use `../../scripts/kintone_space_comment.py` for dry runs, file upload, and comment posting.

Recommended preflight:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py preflight --env .env
```

Dry-run a comment payload:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py post-comment --env .env --text-file article.txt --image cover.png --dry-run
```

Post after review:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py post-comment --env .env --text-file article.txt --image cover.png
```

For production posts, write a local publish record:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py post-comment --env .env --text-file drafts/article-v001.md --image assets/cover.png --archive-dir metadata/publish-log --draft-id article-v001 --title "Article title"
```

If the user deletes a wrong comment manually in kintone, mark the local record:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py mark-record --record metadata/publish-log/<record>.json --status deleted-manual --note "Deleted in kintone Web UI after wrong target/text."
```

Then create a new draft version and post again. Do not overwrite the old publish record.
