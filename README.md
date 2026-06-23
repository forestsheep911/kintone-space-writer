# kintone-space-writer

Codex plugin project for drafting, reviewing, and posting article-style comments to kintone Space threads.

The plugin is designed for article workspaces: each article or topic can keep its own drafts, local publishing configuration, assets, and publish records while reusing the same Codex plugin.

## What This Plugin Provides

- Draft and revise kintone Space articles.
- Review drafts for AI-flavored tone before publication.
- Prepare plain-text article bodies that work inside kintone Space comments.
- Upload optional image attachments and post comments to existing Space threads.
- Keep local publish records for comment IDs, target aliases, draft IDs, hashes, and attachments.
- Support multiple kintone environments, Spaces, and threads through readable YAML target aliases.

## Current Scope

V0.1 publishes only by adding a comment to an existing kintone Space thread.

It does not:

- update Space body content
- update thread body content
- create new threads
- place images inline between paragraphs
- manage kintone comment deletion

Images are uploaded as kintone file attachments and then attached after the comment text.

## Repository Layout

```text
kintone-space-writer/
  .agents/plugins/marketplace.json
  docs/
    architecture.md
    usage.md
  plugins/kintone-space-writer/
    .codex-plugin/plugin.json
    .env.example
    kintone-targets.example.yaml
    assets/
    scripts/
    skills/
      anti-ai-tone/
      kintone-publisher/
      kintone-space-writer/
```

The installable plugin source is:

```text
plugins/kintone-space-writer/
```

This matches the `git-subdir` publishing style used by the 2water Codex plugin marketplace.

## Skills

`kintone-space-writer`

Drafts and revises articles for kintone Space. It handles article structure, reader focus, plain-text layout, source faithfulness, and workspace profile usage.

`anti-ai-tone`

Reviews prose for formulaic AI tone. It reduces generic openers, repeated mirrored contrasts, staged-insight phrases, slogan verbs, and business fog while preserving useful content.

`kintone-publisher`

Validates local publishing settings, uploads files, posts Space thread comments, and writes local publish records.

## New Article Workspace Setup

For a step-by-step operational guide, see [docs/usage.md](docs/usage.md).

In a real article workspace, create local configuration files before publishing:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-env
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-targets
```

This creates:

```text
.env
kintone-targets.yaml
```

Use `.env` only for secrets and optional default target selection.
Use `kintone-targets.yaml` for kintone domains, Spaces, threads, and thread aliases.

## Environment File

`.env` should contain password variables referenced by `kintone-targets.yaml`.

Example:

```dotenv
KINTONE_TARGET=test-news

KINTONE_TEST_PASSWORD=
KINTONE_ENV1_PASSWORD=
KINTONE_ENV2_PASSWORD=
```

`KINTONE_TARGET` is optional. If set, it selects the default thread alias when a command does not pass `--target`.

For publication safety, prefer passing `--target <alias>` explicitly when the user names a destination in natural language.

## Target YAML

`kintone-targets.yaml` is nested to match the kintone mental model:

```text
environment
  Space
    Thread
```

Each thread defines one unique `alias`. Publishing commands use only that alias.

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

Run preflight before posting:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news preflight
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news preflight
```

## Drafting Workflow

Recommended article workflow:

1. Create or open an article workspace.
2. Add source notes, links, drafts, and assets.
3. Draft with the `kintone-space-writer` skill.
4. Review the draft with `anti-ai-tone`.
5. Prepare a plain-text comment body.
6. Run publisher preflight for the target alias.
7. Post to a test target first when available.
8. Ask the user to inspect the kintone Web UI rendering.
9. Post to the official target only after confirmation.

## Plain-Text Comment Format

kintone Space comment text should be treated as plain text.

Prefer character-based structure:

```text
【Title】

Summary:
One or two lines.

1. Section title

Body text.

Points:
・First point
・Second point

Reference:
https://example.com
```

Do not rely on Markdown headings, Markdown bold, Markdown links, highlight markers, or horizontal rules.

## Posting

Dry-run a payload:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --dry-run
```

Post and write a local publish record:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/test --draft-id article-v001 --title "Article title"
```

Production example:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/prod --draft-id article-v001 --title "Article title"
```

## Publish Records

Every successful post can write a JSON publish record containing:

- target alias and label
- base URL, Space ID, Thread ID, and thread URL
- kintone comment ID
- draft ID, draft file, text hash, and text length
- attachment source paths and file keys
- exact API payload and result
- status history

Recommended workspace shape:

```text
kintone-space-writer.md
.env
kintone-targets.yaml
drafts/
  article-v001.txt
  article-v002.txt
assets/
  cover.png
metadata/
  publish-log/
    test/
    prod/
```

## Workspace Profile

An article workspace may include reusable writing preferences:

```text
kintone-space-writer.md
```

Fallback path:

```text
metadata/kintone-space-writer.md
```

The profile may record house style, audience assumptions, preferred terms, disallowed phrases, article templates, and publishing habits.

Do not put credentials in the workspace profile.

## Reference Boundaries

BiLore may be used as a reference for production structure only: topic workspace discipline, source gates, asset manifests, storage handoff, and publish checkpoints.

Do not copy BiLore's WeChat-specific writing style, formatting habits, article-operation rules, or anti-AI-voice prose recipes.

`hardikpandya/stop-slop` is used only as a reference for anti-AI-tone review. The local `anti-ai-tone` skill adapts its MIT-licensed ideas for this plugin's Chinese kintone Space writing needs instead of importing the English rules verbatim.

Deckit may be used as a reference for plugin repository layout, local development marketplace patterns, generated-asset continuity, and eventual marketplace release flow.

## Development

Validate the plugin:

```powershell
python C:/Users/bxu/.GZ9EE915VU4opI0l1i0M6123/skills/.system/plugin-creator/scripts/validate_plugin.py ./plugins/kintone-space-writer
```

Check Python syntax:

```powershell
python -m py_compile plugins/kintone-space-writer/scripts/kintone_space_comment.py
```

## Marketplace Target

The intended public marketplace is:

```text
forestsheep911/codex-plugin-marketplace-2water
```

The eventual entry should use a git-subdir source pointing at `plugins/kintone-space-writer` and a version tag.
