---
name: kintone-publisher
description: Prepare or post kintone Space thread comments from workspace-local environment settings. Use when Codex needs to validate kintone comment publishing settings, upload article images as comment attachments, build a comment payload, or post a comment to an existing Space thread.
---

# Kintone Publisher

## Scope

Publish only by adding a comment to an existing kintone Space thread.

Do not update Space body content, thread body content, or create threads unless the user explicitly changes the route.

## Environment

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

The comment API orders content as mentions, text, then files. Do not claim that this route can place images between article paragraphs. If users need true inline placement, record it as a future non-v0.1 route.

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
