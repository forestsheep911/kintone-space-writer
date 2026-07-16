# Local Companion Userscript Design

## Decision

The rich-editor companion is a locally installed Tampermonkey userscript that
ships alongside the Codex plugin. It is not a Store-distributed product and
does not require a public update or release channel.

## Architecture

The Codex plugin starts the loopback Bridge on demand. The Bridge binds only to
`127.0.0.1`, selects a free port in `8787..8807`, and writes its short-lived
runtime state in the article workspace. The companion userscript discovers an
active Bridge by probing that fixed, narrow range, validates `/health`, then
uses the returned token for package requests. The user never configures a
port.

`pnpm dev` is only a selector-development workflow. `pnpm build` produces the
locally installable `.user.js` artifact copied into the plugin's assets. The
artifact remains the normal testing and use path, so its behavior does not
depend on a Vite process remaining alive.

## Constraints

- Keep the current Bridge origin/Space/thread matching, token checks, and
  manual final Publish step unchanged.
- Keep the current userscript identity compatible with the prior local POC so
  an installed script upgrades in place.
- Do not add public Store, marketplace, auto-update, or release requirements.
- Preserve the REST comment route as the fallback.

## Verification

- Type-check and build the userscript.
- Confirm generated metadata calls it a local companion rather than a Store
  script.
- Run the Bridge unit tests and plugin manifest validation.
