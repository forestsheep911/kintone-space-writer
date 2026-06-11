---
name: kintone-space-writer
description: Draft, revise, and prepare articles for kintone Space. Use when Codex is asked to write a kintone Space post, turn source notes into an article, revise an article for the target audience, or prepare a publish-ready article package.
---

# Kintone Space Writer

## Purpose

Help Codex produce articles intended for kintone Space. This skill is intentionally conservative until project references are added.

## Reference Boundary

BiLore may be used as a reference for production workflow, asset tracking, source discipline, manifests, and publishing handoff design.

Do not import BiLore's WeChat/public-account writing style rules, public-account formatting habits,运营知识, or anti-AI-voice prose recipes. kintone Space articles should develop their own concise, practical style for the intended Space audience.

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

## Workflow

1. Identify the article goal, reader, and source material.
2. Extract claims, examples, and required facts from the supplied references.
3. Create a concise outline before drafting when the topic is complex.
4. Draft in a practical, reader-focused style suitable for an internal or community knowledge space.
5. Revise for clarity, source faithfulness, and actionability.
6. Prepare a final article body plus a short handoff note listing assumptions, missing references, and suggested images or attachments.

## Publishing Constraints

The initial publishing route is kintone Space thread comment only.

- Do not update thread body content.
- Do not create a thread unless the user explicitly asks and required Space capability is confirmed.
- Load kintone connection settings from the article workspace `.env`, not from the plugin repository or shared plugin knowledge.
- Start with username/password authentication.
- Prepare image illustrations as comment attachments: upload files first, collect file keys, then include them in `comment.files`.
- Do not promise inline image placement inside the comment body. Space comment payload order is mentions, text, then files.

## Drafting Rules

- Do not invent product behavior, UI labels, API details, dates, metrics, or customer claims.
- Keep claims traceable to user-provided sources or explicitly label them as assumptions.
- Prefer concrete steps, examples, and operational context over broad marketing language.
- Use headings and short paragraphs for scanability.
- Keep formatting portable until exact kintone Space constraints are known.
- Do not optimize the article as a WeChat/公众号 post unless the user explicitly asks for a WeChat derivative.
- For kintone Space comment output, assume plain text only. Use visible characters, spacing, numbering, and bullets for structure.
- Use bare URLs for references. Do not rely on Markdown links, Markdown bold, highlight markers, or heading syntax.

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

## Pending Project References

This plugin still needs the user's reference material for:

- house style
- article templates
- kintone Space formatting rules
- publishing workflow
- automation requirements
