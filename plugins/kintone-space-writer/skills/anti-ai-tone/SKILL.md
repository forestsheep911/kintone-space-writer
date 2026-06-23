---
name: anti-ai-tone
description: Review and revise kintone Space prose to reduce AI-flavored tone, formulaic structure, empty emphasis, and generic business language while preserving useful content and plain-text publishing constraints.
---

# Anti AI Tone

## Purpose

Help Codex revise kintone Space articles so they sound like a person writing to a specific community, not a generic AI essay.

Use this skill when:

- drafting or revising a kintone Space article
- preparing a publish-ready plain-text comment
- reviewing a finished draft before posting
- the user asks for less AI tone, less slop, more natural voice, or a more human article

This skill adapts ideas from `hardikpandya/stop-slop` under the MIT License. Do not copy its English rules blindly. Chinese kintone articles need practical, readable, source-faithful communication, not artificially terse prose.

## Review Goal

Keep the article useful. Remove only patterns that make the writing feel generic, inflated, mechanical, or self-important.

Do not remove:

- necessary facts
- useful transitions
- technical clarity
- polite context needed by the target readers
- kintone-specific plain-text structure

## High-Risk Patterns

### Empty Openers

Cut opening phrases that announce importance before saying anything.

Examples to avoid:

- "在当今..."
- "众所周知..."
- "值得注意的是..."
- "不可否认的是..."
- "从某种意义上说..."
- "我们需要认识到..."
- "这不仅仅是..."

Replace with the actual point.

### Mirrored Contrast

Use contrast only when it clarifies a real distinction. Treat repeated mirrored frames as high-risk AI tone.

Examples to avoid when they become formula:

- "不是 A，而是 B"
- "问题不在于 A，而在于 B"
- "它看起来像 A，其实是 B"
- "这不只是 A，更是 B"
- "最好不要只 A，而是 B"
- "从 A 到 B 的转变"

Prefer a direct sentence. Name the specific object, action, or constraint:

```text
真正限制使用效果的是数据分散在多个系统里。
```

Better:

```text
客户资料分散在三个系统里。销售要确认一次状态，至少要切换两次页面。
```

### "真正..." Emphasis Frames

Treat these as high-risk when they appear as insight packaging rather than useful emphasis:

- "真正值得关注的是..."
- "真正重要的是..."
- "真正厉害的是..."
- "真正困难的是..."
- "真正能留下来的..."
- "真正让人意外的是..."

These phrases often turn a plain point into a staged revelation. Replace them with the actual reason, evidence, or example.

Weak:

```text
真正值得关注的是，本地数据聚合改变了 SaaS 的使用边界。
```

Better:

```text
本地数据聚合让用户不用先把所有资料搬进同一个 SaaS，仍然可以在一个入口里查到客户、合同和沟通记录。
```

### Slogan Verbs

Avoid one-word slogan chains unless the words are part of the user's established house style.

High-risk examples:

- "稳住"
- "撑住"
- "立住"
- "接住"
- "托住"
- "穿透"
- "长出来"
- "跑起来"

These words can work in speeches, but they often make article prose feel performative. Replace them with concrete behavior.

Weak:

```text
好的流程要稳住现场，也要撑住协作。
```

Better:

```text
好的流程要让一线同事知道下一步找谁，也要让管理者看到问题有没有被处理。
```

### Abstract Nouns Doing The Work

Replace vague nouns with the actor, system, or behavior.

High-risk words:

- 结构性
- 本质上
- 深层次
- 生态
- 赋能
- 闭环
- 抓手
- 底层逻辑
- 价值释放
- 能力沉淀

If a word sounds impressive but does not name who does what, rewrite it.

### Over-Smooth Paragraph Rhythm

AI drafts often produce paragraphs with the same shape:

1. broad claim
2. abstract explanation
3. punchy final sentence

Break the rhythm. Use concrete examples, ordinary sentence endings, and paragraph lengths that match the content.

### Performative Sincerity

Avoid sentences that tell readers how sincere or important the article is.

Examples:

- "这真的很重要"
- "这才是关键"
- "这正是本文想说明的"
- "让我们深入探讨"
- "接下来我们将看到"

Show the reason instead.

### Generic Business Voice

Replace corporate fog with plain words.

| Avoid | Prefer |
| --- | --- |
| 赋能 | 帮助、让...可以 |
| 抓手 | 方法、入口、工作项 |
| 闭环 | 跟进到完成、形成记录 |
| 沉淀 | 留下、整理、保存 |
| 打通 | 连接、同步、让...能一起用 |
| 提效 | 节省时间、减少重复操作 |
| 落地 | 实际使用、开始执行 |

Use the user's own vocabulary when the workspace profile records it.

## Revision Method

1. Identify the target reader and article purpose.
2. Mark sentences that sound generic, inflated, or formulaic.
3. Preserve claims and source-backed facts.
4. Replace abstract claims with examples, actions, or kintone-specific context.
5. Remove repeated contrast frames, "真正..." emphasis frames, slogan verbs, and announcement phrases.
6. Vary paragraph rhythm without making the article dramatic.
7. Keep the final output compatible with kintone Space comment plain text.

## Checks Before Publishing

Ask these questions before calling a draft ready:

- Can a reader tell who should do what next?
- Does each section contain at least one concrete fact, action, example, or constraint?
- Are there repeated "不是...而是..." or "不只是...更是..." patterns?
- Are there repeated "真正值得..." / "真正厉害..." staged-insight phrases?
- Are slogan verbs such as "稳住、撑住、立住" replacing concrete behavior?
- Are there broad claims without examples?
- Did the draft use jargon where ordinary words would work?
- Does the ending summarize naturally instead of sounding like a slogan?

## Output

When reviewing, return:

- concise findings, grouped by issue type
- revised text or targeted replacement paragraphs
- any tradeoff where a removed phrase may still be useful for politeness or clarity

Do not over-polish. kintone Space articles should feel practical, direct, and written for the actual readers.
