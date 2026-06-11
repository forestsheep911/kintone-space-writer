# blog-writer-kintone-space

Codex plugin project for drafting and posting kintone Space thread-comment articles.

## Layout

```text
blog-writer-kintone-space/
  .agents/plugins/marketplace.json
  docs/
  plugins/blog-writer-kintone-space/
    .codex-plugin/plugin.json
    .env.example
    assets/
    scripts/
    skills/
```

The installable plugin source is:

```text
plugins/blog-writer-kintone-space/
```

This matches the `git-subdir` publishing style used by the 2water Codex plugin marketplace.

## V0.1 Scope

- Draft and revise articles for kintone Space.
- Publish only by adding a comment to an existing Space thread.
- Do not update Space or thread body content.
- Use article/workspace-local `.env` for kintone credentials and target IDs.
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

The eventual entry should use a git-subdir source pointing at `plugins/blog-writer-kintone-space` and a version tag.

## Development

Validate the plugin:

```powershell
python C:/Users/bxu/.GZ9EE915VU4opI0l1i0M6123/skills/.system/plugin-creator/scripts/validate_plugin.py C:/Users/bxu/dev/rdpj/blog-writer-kintone-space/plugins/blog-writer-kintone-space
```
