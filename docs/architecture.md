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

## Image Handling

Article illustrations use the kintone file upload API first. The returned `fileKey` values are then attached in `comment.files`.

V0.1 limits:

- maximum 5 files per comment
- optional image display width, 100 to 750
- no inline placement between paragraphs

If a future version requires true text-image interleaving, it should be treated as a separate route, likely browser automation or a non-comment body-editing flow, with its own risk gate.

## Environment

kintone credentials and target IDs belong in the article workspace `.env`, not inside the plugin repository or shared plugin knowledge.

Initial keys:

```dotenv
KINTONE_BASE_URL=https://example.cybozu.com
KINTONE_USERNAME=
KINTONE_PASSWORD=
KINTONE_SPACE_ID=
KINTONE_THREAD_ID=
KINTONE_GUEST_SPACE_ID=
KINTONE_IMAGE_WIDTH=600
```

`KINTONE_GUEST_SPACE_ID` is optional and should be empty for normal spaces.

## Asset Direction

For non-technical users, kintone itself may become the asset store in a later version. A dedicated kintone App can hold article metadata, source files, generated images, prompt records, and publish state. This is less clean than Git plus object storage, but it is easier for users without GitHub or Blob storage.

The current v0.1 implementation keeps this open and only supports direct comment attachments.
