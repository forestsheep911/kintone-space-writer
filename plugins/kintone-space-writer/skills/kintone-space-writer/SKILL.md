---
name: kintone-space-writer
description: Draft, revise, and prepare articles for kintone Space. Use when Codex is asked to write a kintone Space post, turn source notes into an article, revise an article for the target audience, or prepare a publish-ready article package.
---

# Kintone Space Writer

## Purpose

Help Codex produce articles intended for kintone Space, including ordered rich
article packages for the browser-side Ready workflow.

## Reference Boundary

BiLore may be used as a reference for production workflow, asset tracking, source discipline, manifests, and publishing handoff design.

Do not import BiLore's WeChat/public-account writing style rules, public-account formatting habits, operational publishing knowledge, or anti-AI-voice prose recipes. kintone Space articles should develop their own concise, practical style for the intended Space audience.

## Inputs To Prefer

Ask for or use any available:

- topic or working title
- target readers
- source notes or reference links
- desired article goal
- required call to action
- formatting constraints for kintone Space
- examples of existing articles

If the user has not provided enough detail, make a reasonable first draft from the available context and mark assumptions clearly.

## Workspace Profile

Before drafting or revising in a user article workspace, look for a workspace-level profile:

1. `kintone-space-writer.md`
2. `metadata/kintone-space-writer.md`

Use it as reusable local memory for that workspace. It may define formatting conventions, article patterns, tone, language, words to prefer or avoid, review habits, and publishing preferences.

Apply instruction priority in this order:

1. the user's current request
2. the workspace profile
3. this skill's defaults

Never put credentials in the workspace profile. kintone secrets and target IDs belong in `.env`.

## Workflow

1. Identify the article goal, reader, and source material.
2. Extract claims, examples, and required facts from the supplied references.
3. Create a concise outline before drafting when the topic is complex.
4. Draft in a practical, reader-focused style suitable for an internal or community knowledge space.
5. Revise for clarity, source faithfulness, actionability, and anti-AI-tone quality.
6. Prepare a final article body plus a short handoff note listing assumptions,
   missing references, and image placement.
7. When the user wants browser handoff, create `kintone-rich-article.v1` JSON
   with text and image blocks in publication order, then use the
   `kintone-publisher` skill to validate the target and mark it Ready.

## Publishing Constraints

The publishing route is an existing kintone Space thread comment only.

- Do not update thread body content.
- Do not create a thread unless the user explicitly asks and required Space capability is confirmed.
- The standard browser route uses target IDs from workspace
  `kintone-targets.yaml`; it does not require API credentials.
- The standard route supports inline images because the Store userscript fills
  the authenticated Web editor. It never clicks Publish.
- Keep `.env` username/password settings only for the REST fallback.
- In the REST fallback, images remain trailing attachments and text is plain.

## Drafting Rules

- Do not invent product behavior, UI labels, API details, dates, metrics, or customer claims.
- Keep claims traceable to user-provided sources or explicitly label them as assumptions.
- Prefer concrete steps, examples, and operational context over broad marketing language.
- Before calling a draft publish-ready, apply the `anti-ai-tone` review: reduce generic openers, repeated mirrored contrasts, staged-insight phrases, slogan verbs, empty emphasis, and business fog while preserving useful content.
- Use headings and short paragraphs for scanability.
- Keep formatting portable until exact kintone Space constraints are known.
- Do not optimize the article as a WeChat Official Account post unless the user explicitly asks for a WeChat derivative.
- For rich browser output, express structure in article JSON rather than
  Markdown and use the schema's formatting fields.
- For the REST fallback, assume plain text only and use visible characters,
  spacing, numbering, bullets, and bare URLs.
- Emoji can be used sparingly as plain-text markers. Smoke tests showed common emoji render in kintone Web UI, but do not make emoji carry essential meaning.

## Plain Text Layout Pattern

Prefer this shape for comment-ready drafts:

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

## Output Shape

When preparing an article, provide:

- title
- optional subtitle or summary
- article body
- optional image or attachment suggestions
- publishing notes and unresolved questions

For rich handoff, also save a versioned JSON file such as
`drafts/article-v001.rich.json`. Do not mark it Ready until its target and every
referenced local image have been validated.
