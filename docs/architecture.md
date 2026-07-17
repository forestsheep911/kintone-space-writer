# Architecture Notes

## Publishing Model

V0.2 has two routes for comments on an existing kintone Space thread:

1. Standard: an on-demand loopback Bridge hands an ordered rich article to a
   locally installed companion userscript, which fills the native Web editor.
   The user publishes.
2. Fallback: the public REST API posts plain text plus trailing attachments.

Neither route updates a Space/thread body or creates a thread.

## Standard Ready Bridge

The Bridge binds to `127.0.0.1` and selects the first free port from 8787–8807.
Plugin calls start it idempotently; it is not registered as a Windows service
and exits after an idle timeout. Its workspace-local queue is ignored by Git.

Every package is local to its article workspace. The userscript must claim it
before uploading images, writes only after the user has opened a native comment
editor and selected a version, records injected/failed results, and never
activates Publish. Rich images use
kintone's internal Web upload route and native temporary image DOM, so the REST
fallback remains important if kintone changes that behavior.

The companion is built locally with the plugin, rather than released through a
public Store. The plugin starts the Bridge on demand; the companion probes only
the bounded loopback range and verifies `/health` plus its token. Users never
need to select or configure a port. A Vite development server is only used for
selector debugging, not for normal handoff.

## REST Fallback API Shape

Primary endpoint:

```text
POST /k/v1/space/thread/comment.json
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

## Writing Quality Gate

Before a draft is called publish-ready, Codex should apply the `anti-ai-tone` skill. The gate is intentionally editorial, not mechanical:

- remove generic openers and empty emphasis
- reduce repeated mirrored contrast frames, staged-insight phrases, and slogan verbs
- replace business fog with plain wording
- preserve useful facts, reader context, and kintone plain-text structure

The `anti-ai-tone` skill adapts ideas from `hardikpandya/stop-slop` under the MIT License for this plugin's Chinese kintone Space use case.

## Image Handling

Article illustrations use the kintone file upload API first. The returned `fileKey` values are then attached in `comment.files`.

REST fallback limits:

- maximum 5 files per comment
- optional image display width, 100 to 750
- no inline placement between paragraphs

The standard Ready bridge provides text-image interleaving through the native
Web editor.

## REST Fallback Environment

kintone target IDs belong in the article workspace `kintone-targets.yaml`, not inside the plugin repository or shared plugin knowledge. Secrets belong in `.env`. These files apply to the REST fallback; the rich browser route uses the thread the user opens.

Use nested target configuration for multiple domains, Spaces, and threads. The file follows the same mental model as kintone: environment, then Space, then Thread. Each thread defines one unique publish alias:

```yaml
defaultTarget: test-news

environments:
  test:
    label: "Test environment"
    baseUrl: "https://test-example.cybozu.com"
    origins:
      - "https://test-example.cybozu.com"
      - "https://test-example.s.cybozu.com"
    username: "writer@example.com"
    passwordEnv: "KINTONE_TEST_PASSWORD"

    spaces:
      main:
        label: "Main test Space"
        spaceId: "10"

        threads:
          news:
            alias: "test-news"
            nickname: "Test article thread"
            threadId: "12"
            imageWidth: 600

  env1:
    label: "Environment 1"
    baseUrl: "https://env1-example.cybozu.com"
    username: "writer@example.com"
    passwordEnv: "KINTONE_ENV1_PASSWORD"

    spaces:
      company:
        label: "Head office Space"
        spaceId: "20"

        threads:
          news:
            alias: "company-news"
            nickname: "Head office article thread"
            threadId: "34"
            imageWidth: 600
```

The `.env` file keeps passwords and may select a default target:

```dotenv
KINTONE_TARGET=test-news
KINTONE_TEST_PASSWORD=
KINTONE_ENV1_PASSWORD=
KINTONE_ENV2_PASSWORD=
```

The script accepts a target alias:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target test-news preflight
python plugins/kintone-space-writer/scripts/kintone_space_comment.py --target company-news preflight
```

For a new article workspace, create the env and target files from bundled examples instead of writing them by hand:

```powershell
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-env
python plugins/kintone-space-writer/scripts/kintone_space_comment.py init-targets
```

If the env or target file is missing or required values are blank, the script prints a plain-language setup guide showing the file it tried to use, the example file to copy, the required fields, and the preflight command to rerun. This is intentional: a first-time user should not have to inspect Python errors or plugin source to know the next step.

Legacy single-target `.env` mode remains supported when `kintone-targets.yaml` is absent:

```dotenv
KINTONE_BASE_URL=https://example.cybozu.com
KINTONE_USERNAME=
KINTONE_PASSWORD=
KINTONE_SPACE_ID=
KINTONE_THREAD_ID=
KINTONE_IMAGE_WIDTH=600
```

## Test Then Production Flow

When test and official target aliases exist, Codex should use a natural-language confirmation flow instead of making the user remember command flags.

Default publishing sequence:

1. Ask whether to send to the test environment first.
2. Post to the test alias and write a publish record under `metadata/publish-log/test/`.
3. Ask the user to inspect the test comment in kintone Web UI.
4. If the user says the format/content is correct, post the same draft and attachments to the official alias.
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

The workspace profile must not contain credentials. `kintone-targets.yaml` remains the workspace-local file for target IDs. `.env` remains the workspace-local file for secrets.

## Asset Direction

For non-technical users, kintone itself may become the asset store in a later version. A dedicated kintone App can hold article metadata, source files, generated images, prompt records, and publish state. This is less clean than Git plus object storage, but it is easier for users without GitHub or Blob storage.

The current v0.1 implementation keeps this open and only supports direct comment attachments.

## Local Draft And Publish Records

Each article workspace should keep local drafts and publish records separate. The publish log is a local audit trail, not a synchronization layer.

Recommended shape:

```text
kintone-space-writer.md
.env
kintone-targets.yaml
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
