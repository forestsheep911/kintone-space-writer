# Draggable and Minimizable Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kintone article-version panel movable and collapsible without covering page content permanently.

**Architecture:** A pure helper clamps persisted panel coordinates to the viewport. The userscript uses pointer events on its title bar and Tampermonkey storage for position and collapsed state.

**Tech Stack:** TypeScript, Vitest, Tampermonkey, Vite.

## Global Constraints

- Dragging is available only from the title bar.
- Controls retain their click behavior.
- Restored and moved positions remain in the viewport.

### Task 1: Position helper

**Files:** `userscript/kintone-space-writer/src/panel-position.ts`, `userscript/kintone-space-writer/src/panel-position.test.ts`

- [ ] Write a failing clamp test for negative and over-boundary coordinates.
- [ ] Implement `clampPanelPosition(position, viewport, panel)`.
- [ ] Run `pnpm test -- panel-position.test.ts`.

### Task 2: Panel interactions

**Files:** `userscript/kintone-space-writer/src/index.ts`

- [ ] Persist title-bar drag position and collapsed state with Tampermonkey storage.
- [ ] Add title-bar `—`/expand controls and collapsed CSS.
- [ ] Clamp restored and moved coordinates; keep version buttons clickable.
- [ ] Run `pnpm test && pnpm build`.
