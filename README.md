# kintone-space-writer

Codex plugin project for drafting, reviewing, and staging rich article-style
comments in kintone Space threads.

The plugin is designed for article workspaces: each article or topic can keep its own drafts, local publishing configuration, assets, and publish records while reusing the same Codex plugin.

## Development Direction

As of 2026-10-22, `main` is the development line for a standalone Chrome
Manifest V3 companion extension. The complete committed Tampermonkey baseline
is preserved on `codex/archive/tampermonkey-20261022` at commit `0a370f1`.

The Chrome companion is now implemented as version `0.4.2` in [`extension/`](extension/README.md).
It retains the local Bridge and the existing editor workflow. See the
[extension migration record](docs/chrome-extension-migration.md) for the branch
policy, compatibility details, and validation boundaries.

## What This Plugin Provides

- Draft and revise kintone Space articles.
- Review drafts for AI-flavored tone before publication.
- Prepare ordered rich-text and inline-image article packages.
- Start an on-demand local Bridge and hand Ready packages to a locally installed Chrome companion extension.
- Preserve plain-text REST posting with trailing attachments as a fallback.
- Keep local publish records for comment IDs, target aliases, draft IDs, hashes, and attachments.
- Support YAML target aliases for the REST fallback.

## Current Scope

The current workflow targets only comments on existing kintone Space threads. The standard
route fills the native rich editor and leaves final publication to the user.

It does not:

- update Space body content
- update thread body content
- create new threads
- manage kintone comment deletion

The local companion source lives in [`extension/`](extension/README.md). Build
with `pnpm package` there, then enable developer mode and drag the ZIP onto
Chrome's extensions page. Chrome extracts and loads it; loading a manually
extracted directory remains an alternative. Disable the old Tampermonkey script. The ZIP includes
a one-time settings exporter and the archived rollback script.

See [`docs/rich-editor-bridge.md`](docs/rich-editor-bridge.md) for the Ready
protocol and [`extension/README.md`](extension/README.md) for installation,
settings migration, and manual updates. The old public userscript remains a
legacy rollback artifact; extension builds do not overwrite it.

## Repository Layout

```text
kintone-space-writer/
  .agents/plugins/marketplace.json
  docs/
    architecture.md
    rich-editor-bridge.md
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
  extension/
    src/
    migration/
    scripts/
    identity.json
```

The installable plugin source is:

```text
plugins/kintone-space-writer/
```

The plugin and companion are developed together from this repository; no public
Store or marketplace release is required for normal use.

Commands below use the Windows launcher. Replace `<plugin>` with the installed
plugin's absolute path. On macOS/Linux use `sh "<plugin>/scripts/run.sh"` in
place of the PowerShell prefix, followed by the same tool and arguments.

The intended user-facing installation consists of the Codex plugin and the
browser extension. The plugin includes the Bridge script and starts it on
demand; users do not need to install or manually launch a separate service.
Plugin `0.3.0` provides `run.ps1` / `run.sh` launchers that obtain checksum-pinned
uv, discover compatible Python or download a managed version, and synchronize
the plugin's `uv.lock` into a private user environment. No Python/uv installation
or global pip command is required from the user. The Windows x64 delivery ZIP
includes uv. First use still needs network access to the pinned uv/Python release
files and PyPI; it is not an offline installer. See the plugin
[installation and runtime guide](plugins/kintone-space-writer/INSTALL.md).

Windows x64 is the validated delivery platform. Windows ARM64, macOS and glibc
Linux launchers/manifests are supplied for subsequent platform acceptance.

## Skills

`kintone-space-writer`

Drafts and revises articles for kintone Space. It handles article structure,
reader focus, rich block layout, source faithfulness, and workspace profiles.

`anti-ai-tone`

Reviews prose for formulaic AI tone. It reduces generic openers, repeated mirrored contrasts, staged-insight phrases, slogan verbs, and business fog while preserving useful content.

`kintone-publisher`

Stages rich articles through the Ready bridge, or uses the REST fallback and
writes local publish records.

## New Article Workspace Setup

For a step-by-step operational guide, see [docs/usage.md](docs/usage.md).

If you need the REST fallback, create its local configuration files:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest init-env
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest init-targets
```

This creates:

```text
.env
kintone-targets.yaml
```

Use `.env` and `kintone-targets.yaml` only for the REST fallback. The rich
browser route uses the thread the user opens and needs neither file.

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

Run preflight before posting:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest --target test-news preflight
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest --target company-news preflight
```

## Drafting Workflow

Recommended rich-article workflow:

1. Create or open an article workspace.
2. Add source notes, links, drafts, and assets.
3. Draft with the `kintone-space-writer` skill.
4. Review the draft with `anti-ai-tone`.
5. Save an ordered `kintone-rich-article.v1` JSON plus local images.
6. Mark the article Ready; this starts or reuses the local Bridge.
7. Open the intended thread, click `发表评论…`, then choose a version in the companion panel.
8. Inspect the native editor and click Publish manually if correct.

## REST Fallback

The preserved REST route treats comment text as plain text and places up to five
attachments after it.

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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --dry-run
```

Post and write a local publish record:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest --target test-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/test --draft-id article-v001 --title "Article title"
```

Production example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest --target company-news post-comment --text-file drafts/article-v001.txt --image assets/cover.png --archive-dir metadata/publish-log/prod --draft-id article-v001 --title "Article title"
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

Deckit may be used as a reference for plugin repository layout and generated-asset continuity.

## Development

Create a locked development environment with uv (the production launchers do
not require uv on PATH):

```powershell
uv sync --project plugins/kintone-space-writer --locked
```

Build and verify the locally installable companion extension:

```powershell
cd extension
pnpm install
pnpm check
pnpm package
cd ..
```

Check Python syntax:

```powershell
uv run --project plugins/kintone-space-writer --locked python -m py_compile plugins/kintone-space-writer/scripts/kintone_space_comment.py plugins/kintone-space-writer/scripts/kintone_article_bridge.py
```

Run the Bridge tests, including real-process duplicate startup and restart checks:

```powershell
uv run --project plugins/kintone-space-writer --locked python -m unittest discover -s plugins/kintone-space-writer/scripts -p test_kintone_article_bridge.py -v
```

Build a reviewable plugin delivery ZIP, excluding real settings and credentials:

```powershell
python scripts/package_plugin.py --target windows-x86_64
python scripts/check_runtime_delivery.py
```

The ZIP in `dist/` includes portable and legacy plugin manifests, locked runtime
metadata, launchers, and a verified platform uv binary. `--target portable`
omits the binary and downloads it on first use. This creates a local delivery
artifact; it does not publish to a plugin marketplace or replace installed caches.

For daily development, load `dist/kintone-space-writer-extension/` once using
"Load unpacked". This build directory has a fixed name with no version suffix.
After changing extension code, run `pnpm build` from `extension/`, click Reload
on the existing extension card, then refresh kintone. Keep using the same
directory; there is no need to create or import a ZIP for each development edit.

Use `pnpm package` when preparing a ZIP for delivery. There is no Vite server.
The plugin continues to start the Bridge on demand in the selected article
workspace.
