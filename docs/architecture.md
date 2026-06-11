# Architecture Notes

## Publishing Model

V0.1 publishes to an existing kintone Space thread by adding a comment.

The plugin must not update thread body content in the initial route. Thread-body update APIs are intentionally out of scope for v0.1 because the user wants comment-only publishing.

## kintone API Shape

Primary endpoint:

```text
POST /k/v1/space/thread/comment.json
```

Guest-space endpoint shape:

```text
POST /k/guest/{guestSpaceId}/v1/space/thread/comment.json
```

The request body includes:

- `space`: Space ID
- `thread`: Thread ID
- `comment.text`: article text
- `comment.files`: optional uploaded file keys

kintone composes comment content in this order:

1. mentions
2. text
3. files

Therefore images posted through this REST API route are attachments after the text. The Web UI can support richer manual placement behavior, but this API route should not promise inline image insertion.

## Comment Text Formatting

`comment.text` should be treated as plain text. In Web UI smoke tests, kintone preserved line breaks and automatically linkified bare URLs, but did not apply rich-text or Markdown formatting.

Do not rely on:

- Markdown headings such as `# Heading`
- Markdown bold such as `**text**`
- Markdown links such as `[text](https://example.com)`
- highlight markers such as `==text==`
- horizontal rules such as `---`

Use plain-character formatting instead:

```text
【Title】

Summary:
Short summary text.

1. Section title

Body text.

Points:
・First point
・Second point

Reference:
https://example.com
```

Use bare URLs when links are needed, because kintone may turn them into clickable links in the Web UI.

Emoji smoke test result: common emoji, workflow symbols, skin-tone variants, heart, and flag emoji rendered correctly in the kintone Web UI when sent through `comment.text`. Bare URLs were rendered as blue clickable links. Emoji can be used sparingly as plain-text visual markers, but do not make them carry essential meaning because client/font differences may still affect multi-codepoint emoji.

## Image Handling

Article illustrations use the kintone file upload API first. The returned `fileKey` values are then attached in `comment.files`.

V0.1 limits:

- maximum 5 files per comment
- optional image display width, 100 to 750
- no inline placement between paragraphs

If a future version requires true text-image interleaving, it should be treated as a separate route, likely browser automation or a non-comment body-editing flow, with its own risk gate.

## Environment

kintone credentials and target IDs belong in the article workspace `.env`, not inside the plugin repository or shared plugin knowledge.

For workflows with separate test and official destinations, use two workspace-local environment files:

```text
.env.test
.env.prod
```

The script already accepts any env file through `--env`, so no special code path is needed:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --env .env.test preflight
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --env .env.prod preflight
```

Initial keys:

```dotenv
KINTONE_BASE_URL=https://example.cybozu.com
KINTONE_USERNAME=
KINTONE_PASSWORD=
KINTONE_SPACE_ID=
KINTONE_THREAD_ID=
KINTONE_GUEST_SPACE_ID=
KINTONE_IMAGE_WIDTH=600
KINTONE_BASIC_AUTH_USERNAME=
KINTONE_BASIC_AUTH_PASSWORD=
```

`KINTONE_GUEST_SPACE_ID` is optional and should be empty for normal spaces.
`KINTONE_BASIC_AUTH_USERNAME` and `KINTONE_BASIC_AUTH_PASSWORD` are optional and should be set only when the kintone environment also requires cybozu Basic Auth.

## Test Then Production Flow

When both `.env.test` and `.env.prod` exist, Codex should use a natural-language confirmation flow instead of making the user remember command flags.

Default publishing sequence:

1. Ask whether to send to the test environment first.
2. Post to `.env.test` and write a publish record under `metadata/publish-log/test/`.
3. Ask the user to inspect the test comment in kintone Web UI.
4. If the user says the format/content is correct, post the same draft and attachments to `.env.prod`.
5. Write the production publish record under `metadata/publish-log/prod/`.

The test and production posts are separate kintone comments with separate comment IDs. The local publish records connect both comments back to the same draft ID and text hash.

If the test post is wrong, the user can manually delete it in the Web UI, revise the local draft, and resend to test. Do not post to production until the user confirms the tested rendering is acceptable.

## Workspace Profile

User-specific writing preferences should live in the article workspace, not in the shared plugin source. This lets each kintone Space or user team keep its own house style without changing the plugin.

Recommended file name:

```text
kintone-space-writer.md
```

Optional fallback folder:

```text
metadata/kintone-space-writer.md
```

The profile may record:

- pure-text formatting rules, such as `【...】` for main titles and `[...]` for smaller labels
- language and tone preferences
- reader relationship and expected formality
- preferred/disallowed phrases
- article templates
- review checklist
- publishing habits for the current Space/thread

When drafting, Codex should apply rules in this priority order:

1. the user's current instruction
2. the workspace profile
3. plugin skill defaults

The workspace profile must not contain credentials. `.env` remains the only workspace-local file for kintone secrets and target IDs.

## Asset Direction

For non-technical users, kintone itself may become the asset store in a later version. A dedicated kintone App can hold article metadata, source files, generated images, prompt records, and publish state. This is less clean than Git plus object storage, but it is easier for users without GitHub or Blob storage.

The current v0.1 implementation keeps this open and only supports direct comment attachments.

## Local Draft And Publish Records

Each article workspace should keep local drafts and publish records separate. The publish log is a local audit trail, not a synchronization layer.

Recommended shape:

```text
kintone-space-writer.md
.env.test
.env.prod
drafts/
  article-v001.md
  article-v002.md
metadata/
  publish-log/
    test/
      <timestamp>-<draft-id>-comment-<comment-id>.json
    prod/
      <timestamp>-<draft-id>-comment-<comment-id>.json
assets/
  generated/
```

Every successful post should write one publish record. The record links:

- local draft ID
- local draft file path
- text SHA-256
- kintone base URL
- Space ID
- Thread ID
- Thread URL
- returned comment ID
- attached local files and file keys
- exact comment payload
- current status
- event history

Do not overwrite a publish record when a comment was wrong. Keep the old record as history and mark it if useful.

Wrong-post recovery:

1. User deletes the wrong Space comment in the kintone Web UI.
2. Optionally mark the local publish record as `deleted-manual` with a note.
3. Save the rewritten article as a new draft version.
4. Send again. kintone returns a new comment ID, so the resend creates a new publish record.
5. If the new post replaces a previous visible post, optionally mark the old record `superseded`.

As of v0.1 planning, the public kintone REST API route used here supports adding Space thread comments but does not provide a matching Space thread comment deletion endpoint. Deletion should therefore be treated as a manual Web UI action unless a future verified API route is added.
