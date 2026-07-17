# Scripts

`kintone_article_bridge.py` is the standard rich-article handoff. It starts a
loopback-only Bridge when needed, validates an ordered article JSON plus local
images, and exposes local Ready packages to the locally installed companion
userscript.
It never clicks kintone's publish button.

```powershell
python plugins/kintone-space-writer/scripts/kintone_article_bridge.py ensure-bridge
python plugins/kintone-space-writer/scripts/kintone_article_bridge.py mark-ready --article drafts/article-v001.rich.json --assets-root assets
python plugins/kintone-space-writer/scripts/kintone_article_bridge.py list
python plugins/kintone-space-writer/scripts/kintone_article_bridge.py retry --package-id <id>
```

Bridge state and packages live under `local-runs/kintone-space-writer/` in the
article workspace and are intentionally ignored by Git. Startup is idempotent;
the process exits after its idle timeout and is restarted by the next plugin
operation.

`kintone_space_comment.py` is the preserved REST fallback for plain text plus
up to five trailing attachments.
