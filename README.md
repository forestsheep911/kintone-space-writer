# kintone-space-writer

Codex plugin project for drafting and posting kintone Space thread-comment articles.

## Layout

```text
kintone-space-writer/
  .agents/plugins/marketplace.json
  docs/
  plugins/kintone-space-writer/
    .codex-plugin/plugin.json
    .env.example
    kintone-targets.example.yaml
    assets/
    scripts/
    skills/
```

The installable plugin source is:

```text
plugins/kintone-space-writer/
```

This matches the `git-subdir` publishing style used by the 2water Codex plugin marketplace.

## V0.1 Scope

- Draft and revise articles for kintone Space.
- Publish only by adding a comment to an existing Space thread.
- Do not update Space or thread body content.
- Use article/workspace-local `kintone-targets.yaml` for target aliases.
- Use article/workspace-local `.env` for secrets and optional default target selection.
- Use article/workspace-local `kintone-space-writer.md` for reusable writing preferences and formatting habits.
- Start with username/password authentication.
- Treat article images as comment attachments.

## Reference Boundaries

Use BiLore as a reference for production structure only:

- topic/workspace discipline
- source and fact gates
- asset manifests
- prompt-to-image audit records
- storage and publishing handoff patterns

Do not copy BiLore's WeChat-specific writing style, public-account formatting habits, article-operation rules, or anti-AI-voice prose techniques. kintone Space articles need their own house style for space/community communication.

Use Deckit as a reference for:

- plugin repository layout
- local development marketplace
- image prompt pack and generated-asset continuity patterns
- eventual marketplace release flow

## Marketplace Target

The intended public marketplace is:

```text
forestsheep911/codex-plugin-marketplace-2water
```

The eventual entry should use a git-subdir source pointing at `plugins/kintone-space-writer` and a version tag.

## Development

Validate the plugin:

```powershell
python C:/Users/bxu/.GZ9EE915VU4opI0l1i0M6123/skills/.system/plugin-creator/scripts/validate_plugin.py ./plugins/kintone-space-writer
```

## New Article Workspace Setup

In a real article workspace, create the local kintone settings file before publishing:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-env
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-targets
```

Then fill in `.env` passwords, edit `kintone-targets.yaml`, and verify one target alias:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news preflight
```

Use a target alias when posting:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news post-comment --text-file drafts/article.txt
```

The old single-target `.env` mode still works when `kintone-targets.yaml` is absent.
The script prints setup guidance if the env or target file is missing or incomplete.
