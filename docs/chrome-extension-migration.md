# Chrome extension development direction

Decision date: 2026-10-22.

## Branches and baseline

- `codex/archive/tampermonkey-20261022` preserves the complete committed
  Tampermonkey implementation at `0a370f18c5061a2df295beec17b9fbce179d105c`.
  The branch has been pushed to the existing `origin` repository.
- `main` is the ongoing development line for the standalone Chrome Manifest V3
  companion extension. Keep the archive branch as a rollback reference.
- The working tree was clean and `main` matched `origin/main` before archival;
  no additional baseline commit was necessary.

The archive contains tracked source, generated userscript assets, plugin files,
and documentation. Existing ignored files such as secrets, `node_modules`,
`local-runs`, and `outputs` remain local and are not part of the Git archive.
The separate `cysh-articles` content repository remains the article workspace.

## Migration scope

Replace the Tampermonkey companion with a Chrome extension while retaining the
Codex writing workflow, rich article schema, local Python Bridge, and REST
fallback. The Bridge still hands local article files and image bytes to the
browser; the first extension version should retain that responsibility split.

The current userscript is retained on `main` as migration input. This branch
setup does not implement or release an extension.

## Compatibility requirements

- Preserve version selection, article archive/restore, panel position and
  collapse behavior, image rows, mentions, and editor-session image reuse.
- Require the user to open the native comment editor and choose a version.
  Preserve cancellation, package claim/result reporting, and failure feedback.
  Leave final publication to the user.
- Move durable browser preferences to extension storage. Provide an explicit
  migration path for existing Tampermonkey archive flags and panel settings.
- Use a narrow page-context adapter for kintone JavaScript APIs and request
  tokens, with a validated relay to the extension. Keep Bridge access bounded
  to its loopback port range and authenticated protocol; do not expose an
  arbitrary URL request capability to the page.
- Account for Manifest V3 service worker suspension and asynchronous storage.
- Preserve supported tenant and SecureAccess host patterns.
- Use a persistent public key for a stable unpacked extension ID. Document ZIP
  extraction, installation, and updates separately from Tampermonkey updates.
  Disable the old userscript during extension use to avoid duplicate panels.

## Acceptance before switching normal use

Complete feature parity before unrelated interface redesign. Validate the
extension build, protocol behavior, storage migration, worker recovery, message
boundaries, and browser behavior with fixtures. Then separately verify native
editor insertion, image retention, mentions, cancellation, and review/publish
behavior in the actual kintone environment. Record fixture checks and live
acceptance separately.
