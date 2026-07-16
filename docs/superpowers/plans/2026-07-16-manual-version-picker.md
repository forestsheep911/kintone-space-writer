# Manual Version Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users manually refresh and apply retained local article versions in kintone, reusing unchanged images during one live editor session.

**Architecture:** Bridge package records remain immutable and expose target-bound summaries, package detail, and asset digests. The userscript makes network requests only from explicit panel clicks and caches same-editor `(asset digest, width)` file keys.

**Tech Stack:** Python unittest, TypeScript, Vitest, Vite, Tampermonkey.

## Global Constraints

- No background Bridge discovery, port scans, polling, or automatic injection.
- A user click is required to refresh versions and apply a version.
- Versions remain selectable after application.
- Reuse images only in the same live native editor; changed assets, widths, reloads, and editor closure upload again.

### Task 1: Bridge retained version API

**Files:** `plugins/kintone-space-writer/scripts/kintone_article_bridge.py`, `plugins/kintone-space-writer/scripts/test_kintone_article_bridge.py`

- [ ] Test that v001 and v002 for the same target remain listed with digest summaries.
- [ ] Change package creation not to supersede retained versions.
- [ ] Add authenticated target-bound list and individual-package GET routes.
- [ ] Run the Python unittest suite.

### Task 2: Version and image-cache decisions

**Files:** `userscript/kintone-space-writer/src/version-picker.ts`, `userscript/kintone-space-writer/src/version-picker.test.ts`

- [ ] Test a `(digest, width)` cache key and cache reuse only for equal values.
- [ ] Implement pure cache-key and version-summary helpers.
- [ ] Run `pnpm test`.

### Task 3: Manual panel and apply path

**Files:** `userscript/kintone-space-writer/src/index.ts`, `userscript/kintone-space-writer/src/version-picker.ts`

- [ ] Remove automatic polling, auto toggle, and active-editor-session behavior.
- [ ] Render `刷新版本` and version buttons from explicit list requests.
- [ ] Fetch and apply only the clicked package, allowing repeated versions.
- [ ] Reuse cached image file keys when digest and width match; otherwise upload.
- [ ] Clear the image cache after the editor closes and on page reload.
- [ ] Run `pnpm test && pnpm build`.

### Task 4: Documentation and verification

**Files:** `docs/rich-editor-bridge.md`, `docs/usage.md`, `plugins/kintone-space-writer/skills/kintone-publisher/SKILL.md`

- [ ] Describe manual refresh, explicit version selection, retained history, and image-cache boundaries.
- [ ] Run user-script tests/build, Bridge tests, plugin validator, and commit.
