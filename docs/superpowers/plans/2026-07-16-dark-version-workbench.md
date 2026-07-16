# Dark Version Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain article-version floating panel with a dark professional workbench.

**Architecture:** Keep existing Bridge and panel interaction code. Change only version-row semantic DOM and scoped CSS so the new visual hierarchy does not alter refresh, apply, drag, or collapse behavior.

**Tech Stack:** TypeScript, DOM APIs, scoped CSS, Vitest, Vite.

## Global Constraints

- Preserve explicit version application, drag, collapse, and persisted location.
- Use icon-only collapse control with title and accessible label.
- Use a 360 px expanded dark workbench.

### Task 1: Version row hierarchy

**Files:** `userscript/kintone-space-writer/src/index.ts`

- [ ] Render version, timestamp, status badge, and apply action as separate semantic elements.
- [ ] Mark an injected version as current.
- [ ] Keep each apply action bound to its original `VersionMatch`.

### Task 2: Dark workbench skin

**Files:** `userscript/kintone-space-writer/src/index.ts`

- [ ] Replace panel, header, connection, refresh, version-row, action, and notice styles with dark workbench tokens.
- [ ] Add compact header metadata and circular accessible collapse button.
- [ ] Run `pnpm test && pnpm build`.
