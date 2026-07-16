# Local-Authoritative Editor Session Design

## Goal

Turn the rich-editor handoff from a one-time injection into a local-authoritative
editing session. While a kintone comment remains unpublished, the local article
is the only source of truth and each newly marked Ready version replaces the
entire browser editor.

## Session Identity

A session is keyed by the exact browser target (origin, Space ID, and Thread
ID) plus the article's stable `article.id`. An article revision changes its
`version` and/or content hash, but retains the same `article.id`.

The browser stores the last synchronized hash for the active session. It
compares this hash to every Ready package before writing, so the same revision
is not injected twice.

## Synchronization

1. The user clicks kintone's native `发表评论…` entry once, allowing kintone to
   create its real rich editor.
2. The first matching Ready package creates the local-authoritative session and
   populates the empty editor.
3. After local editing, Codex runs `mark-ready` again for the same `article.id`.
4. The companion sees the new Ready hash and replaces the editor's entire
   content. It re-uploads referenced images and recreates the ordered rich
   markup.
5. Any direct browser edit is deliberately discarded on the next local sync.

The browser does not merge text or images from kintone with the local article.
It must reject only an editor that cannot be identified or has disappeared;
non-empty content is normal during an active local-authoritative session.

## Session End

The session remains active after the user clicks Publish until kintone confirms
publication through its normal DOM transition: the native editor disappears or
the page leaves the editing state. A failed validation or network request leaves
the editor present and the session active. Once publication is confirmed, the
browser clears the stored session and no longer overwrites that comment.

## Safety

- The script never opens the editor itself and never clicks Publish.
- Exact origin, Space ID, Thread ID, Bridge token, and package hash validation
  remain mandatory.
- Only the active session's same `article.id` may replace a non-empty editor.
- A different article still requires an empty editor, preventing accidental
  replacement of a separate draft.

## Verification

- Bridge tests cover package revisions for the same article ID.
- Userscript unit tests cover session matching, same-hash deduplication, and
  replacement eligibility.
- Manual browser test verifies first injection, second-version replacement,
  failed Publish retention, and session end after successful publication.
