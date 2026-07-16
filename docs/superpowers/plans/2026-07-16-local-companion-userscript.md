# Local Companion Userscript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rich-editor userscript a documented local companion of the Codex plugin, with a build-and-install debugging workflow and no Store-release assumption.

**Architecture:** The existing loopback Bridge remains the only runtime endpoint. The Vite development server is strictly a development aid; production builds create the static Tampermonkey artifact in plugin assets. Documentation and userscript metadata describe that boundary consistently.

**Tech Stack:** Python 3 standard library Bridge tests, TypeScript, Vite, vite-plugin-monkey, Tampermonkey metadata.

## Global Constraints

- Do not change the loopback port range `8787..8807`, exact target matching, token verification, or manual Publish requirement.
- Preserve the existing userscript identity so the earlier local POC upgrades in place.
- Do not add public Store, marketplace, auto-update, or release configuration.

---

### Task 1: Rebrand the local companion artifact

**Files:**
- Modify: `userscript/kintone-space-writer/package.json`
- Modify: `userscript/kintone-space-writer/vite.config.mts`

**Interfaces:**
- Consumes: the existing `vite-plugin-monkey` userscript configuration.
- Produces: `plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js` with local-companion metadata.

- [ ] **Step 1: Update the package and metadata wording**

Replace Store wording with `local companion userscript`; change the Chinese
metadata display name to `Kintone Space Writer（本地配套版）` while leaving the
base name and namespace unchanged for upgrade compatibility.

- [ ] **Step 2: Build the userscript**

Run: `pnpm build`

Expected: TypeScript completes without diagnostics and Vite emits
`kintone-space-writer.user.js` into the plugin asset directory.

- [ ] **Step 3: Check generated metadata**

Run: `Select-String -Path ../../plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js -Pattern '本地配套版|Store'`

Expected: the local-companion name is present and no `Store` metadata wording
is present.

### Task 2: Align operational documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/rich-editor-bridge.md`
- Modify: `docs/usage.md`
- Modify: `userscript/kintone-space-writer/README.md`
- Modify: `plugins/kintone-space-writer/scripts/README.md`
- Modify: `plugins/kintone-space-writer/scripts/kintone_article_bridge.py`
- Modify: `plugins/kintone-space-writer/skills/kintone-space-writer/SKILL.md`
- Modify: `plugins/kintone-space-writer/skills/kintone-publisher/SKILL.md`

**Interfaces:**
- Consumes: the existing local Bridge protocol and install artifact path.
- Produces: a consistent build/install/debugging guide without Store or marketplace-release promises.

- [ ] **Step 1: Replace Store terminology and marketplace-release claims**

Name the companion as a locally installed userscript. State that `pnpm dev` is
for selector development only and that `pnpm build` creates the artifact to
install in Tampermonkey.

- [ ] **Step 2: Document port discovery precisely**

State that the plugin starts the Bridge on demand; the userscript discovers it
within the fixed loopback range and validates the health token, so users do not
configure a port.

- [ ] **Step 3: Scan for obsolete promises**

Run: `rg -n -i "Store userscript|Marketplace Target|eventual marketplace|eventual marketplace release" README.md docs plugins/kintone-space-writer userscript/kintone-space-writer -g '!node_modules' -g '!dist'`

Expected: no matches.

### Task 3: Verify the local workflow

**Files:**
- Test: `plugins/kintone-space-writer/scripts/test_kintone_article_bridge.py`
- Test: generated `plugins/kintone-space-writer/assets/userscript/kintone-space-writer.user.js`

**Interfaces:**
- Consumes: the unchanged Bridge and built userscript.
- Produces: evidence that local artifact creation and Bridge behavior still work.

- [ ] **Step 1: Run Bridge tests**

Run: `python -m unittest discover -s plugins/kintone-space-writer/scripts -p test_kintone_article_bridge.py -v`

Expected: all tests pass.

- [ ] **Step 2: Validate the plugin manifest**

Run: `python C:/Users/bxu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py ./plugins/kintone-space-writer`

Expected: validator exits successfully.

- [ ] **Step 3: Commit the completed change**

Run: `git add README.md docs plugins/kintone-space-writer userscript/kintone-space-writer && git commit -m "docs: adopt local companion userscript workflow"`

Expected: one commit on `main` containing the documentation, metadata, and
rebuilt artifact.
