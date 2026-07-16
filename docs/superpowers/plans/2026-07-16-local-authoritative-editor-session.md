# Local-Authoritative Editor Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize successive local Ready revisions into one unpublished kintone rich editor until publication succeeds.

**Architecture:** The Bridge retains immutable packages. The userscript records an active session keyed by exact target plus stable `article.id`, permits only a newer hash from that session to replace non-empty editor contents, and clears the session only when kintone removes the editor.

**Tech Stack:** Python 3 unittest, TypeScript, Vitest 2, Vite, vite-plugin-monkey, Tampermonkey APIs.

## Global Constraints

- Local article content is authoritative; browser-side edits are overwritten by the next local revision.
- Preserve exact target, Bridge token, and package-hash checks.
- Never create an editor or click Publish programmatically.
- A different article cannot overwrite a non-empty editor.
- A failed Publish keeps the session active; disappearance of the native editor ends it.

---

### Task 1: Verify Bridge revision lifecycle

**Files:**
- Modify: `plugins/kintone-space-writer/scripts/test_kintone_article_bridge.py`
- Modify: `plugins/kintone-space-writer/scripts/kintone_article_bridge.py` only if required by the test

**Interfaces:**
- Consumes: `create_ready_package()` and `ready_packages()`.
- Produces: an injected revision remaining historical while a newer revision of the same article remains Ready.

- [ ] **Step 1: Add the failing lifecycle test**

```python
def test_new_revision_remains_ready_after_previous_revision_is_injected(self) -> None:
    first = self.create_package("v1")
    first["status"] = "injected"
    bridge.atomic_write_json(bridge.package_path(self.workspace, first["id"]), first)
    second = self.create_package("v2", "新版正文")
    ready = bridge.ready_packages(self.workspace, "https://customer.cybozu.cn", "10", "12")
    self.assertEqual([package["id"] for package in ready], [second["id"]])
```

- [ ] **Step 2: Run red**

Run: `python -m unittest discover -s plugins/kintone-space-writer/scripts -p test_kintone_article_bridge.py -v`

Expected: FAIL only if injected package handling blocks the new revision.

- [ ] **Step 3: Keep injected packages historical and newer revisions Ready**

Only supersede older `ready` packages for the same article and target. Do not change claim, target, or token validation.

- [ ] **Step 4: Run green**

Run: `python -m unittest discover -s plugins/kintone-space-writer/scripts -p test_kintone_article_bridge.py -v`

Expected: PASS.

### Task 2: Add testable session decisions

**Files:**
- Create: `userscript/kintone-space-writer/src/editor-session.ts`
- Create: `userscript/kintone-space-writer/src/editor-session.test.ts`

**Interfaces:**
- Produces: `sessionKey(target, articleId)`, `canWriteEditor(session, key, hash, editorHasText)`, and `sessionEnds(editorExists)`.

- [ ] **Step 1: Write failing Vitest cases**

```typescript
expect(canWriteEditor(null, 'a', 'h1', false)).toBe(true)
expect(canWriteEditor(null, 'a', 'h1', true)).toBe(false)
expect(canWriteEditor({ key: 'a', hash: 'h1' }, 'a', 'h2', true)).toBe(true)
expect(canWriteEditor({ key: 'a', hash: 'h1' }, 'b', 'h2', true)).toBe(false)
expect(sessionEnds(false)).toBe(true)
```

- [ ] **Step 2: Run red**

Run: `pnpm exec vitest run src/editor-session.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement pure functions**

Use a serialized exact target plus `article.id` key. Equal hashes do nothing; an empty editor admits a new session; a non-empty editor accepts only a newer hash for the matching session.

- [ ] **Step 4: Run green**

Run: `pnpm test`

Expected: PASS.

### Task 3: Synchronize the editor and end the session

**Files:**
- Modify: `userscript/kintone-space-writer/src/index.ts`
- Modify: `docs/rich-editor-bridge.md`
- Modify: `docs/usage.md`
- Modify: `plugins/kintone-space-writer/skills/kintone-publisher/SKILL.md`

**Interfaces:**
- Consumes: `article.id`, package hash, active session storage, and `buildMarkup()`.
- Produces: whole-editor replacement for same-session revisions and cleanup after the editor disappears.

- [ ] **Step 1: Replace package-ID deduplication with `ActiveEditorSession` storage**

```typescript
type ActiveEditorSession = { key: string; articleId: string; hash: string }
```

Store it with `GM_getValue`/`GM_setValue` under `ksw-standard-active-editor-session`.

- [ ] **Step 2: Write each permitted revision by replacing all editor HTML**

Build images and markup before mutation. Focus the editor, call `document.execCommand('selectAll')`, then `document.execCommand('insertHTML', false, markup)`, and dispatch `input` plus `change`.

- [ ] **Step 3: Enforce session matching**

Reject a non-empty editor without a matching active session. After a successful write, persist the new hash and send the existing `injected` result.

- [ ] **Step 4: Clear only after confirmed editor disappearance**

In the poll loop, remove an active session only when no rich contenteditable editor remains. A click on Publish alone does not clear it.

- [ ] **Step 5: Document local-authoritative revisions**

Document stable `article.id`, `mark-ready` after each local revision, full overwrite of browser edits, and publication-state session end.

- [ ] **Step 6: Verify and commit**

Run: `pnpm test && pnpm build` in `userscript/kintone-space-writer`; then run the Bridge unittest suite and plugin validator at repository root. Commit with `feat: sync local article revisions to editor sessions`.
