# Manual Version Picker Design

## Goal

Replace automatic Ready injection with a purely manual version picker in the
kintone page. A user refreshes the list, chooses one local article version, and
explicitly applies it to the open native editor.

## Interaction

The panel has no background polling, Bridge discovery loop, automatic injection,
or periodic console diagnostics. It initially offers `刷新版本`.

After that click, it discovers the loopback Bridge once and requests all versions
matching the exact current origin, Space ID, and Thread ID. Each list item shows
article title, stable article ID, version, updated time, and whether it is the
version most recently applied in this page session. Selecting an item is the
only action that writes kintone editor content.

Every local `mark-ready` creates an immutable version record. Versions of the
same article are retained together rather than superseded, allowing v001, v002,
and v003 to be reviewed and re-applied in any order.

## Bridge API

The Bridge adds a target-bound version-list route and an individual
version-package route. Both require the existing loopback token and exact target
match. The list returns only safe summary fields; a chosen package returns the
same validated rich article and asset URLs used by the existing handoff.

The browser may apply a historical version repeatedly. Package claim/result
events record each application without making a chosen immutable version
unavailable to the manual picker.

## Image Reuse

The Bridge exposes a SHA-256 digest per asset. While the same browser page and
native editor remain alive, the companion caches the kintone `fileKey` produced
for each `(asset digest, width)` pair. On a later selected version, unchanged
images with the same width reuse that key; changed assets or widths upload again.

The cache is cleared when the page reloads, the native editor is cancelled or
closed, or a different editor is selected. It is intentionally not reused across
those boundaries because kintone temporary upload references are not a durable
asset store.

## Safety

- Never create the editor, select a version, or publish without a user click.
- Keep current Bridge token, package hash, and exact target validation.
- Reject a chosen version if no contenteditable kintone editor is open.
- A version selection replaces the entire editor; browser-side edits are not
  merged.

## Verification

- Python tests verify retained multi-version lists, target isolation, and asset
  digest exposure.
- Vitest covers manual-only scheduling, version selection, and cache reuse key
  decisions.
- Browser test applies v001, v002, and v001 again; verifies unchanged images are
  not uploaded again before a reload, while changed images upload once.
