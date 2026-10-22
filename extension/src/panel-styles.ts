export function panelStyles(id: string) {
  return `
    #${id} { --line:#e7ecf2; --muted:#66758a; --text:#1e304c; position:fixed; right:16px; top:16px; z-index:2147483646; width:380px; max-width:calc(100vw - 24px); box-sizing:border-box; padding:14px; border:1px solid #dce4ee; border-radius:16px; background:#fff; box-shadow:0 10px 36px #25385820,0 2px 6px #2538580c; color:var(--text); font:13px/1.55 system-ui,sans-serif; }
    #${id} *, #${id} *::before { box-sizing:border-box; }
    #${id} button { font:inherit; cursor:pointer; }
    #${id} button:focus-visible { outline:2px solid #3159bf; outline-offset:2px; }
    #${id} button:disabled { cursor:default; }
    #${id}-header { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:12px; user-select:none; touch-action:none; cursor:grab; }
    #${id}[data-dragging="true"] #${id}-header { cursor:grabbing; }
    #${id} .panel-drag-handle { display:flex; align-items:center; flex:1; gap:7px; min-width:118px; min-height:28px; }
    #${id} .panel-grip { flex:0 0 10px; height:17px; background:radial-gradient(circle,#9ba9bd 1.2px,transparent 1.5px) 0 0/5px 5px; }
    #${id}-title { min-width:0; font-size:16px; font-weight:750; letter-spacing:-.35px; white-space:nowrap; }
    #${id}-title small { margin-left:4px; font-size:10px; color:#607797; }
    #${id} .panel-drag-hint { display:none; }
    #${id}-connection { display:inline-flex; align-items:center; gap:5px; color:var(--muted); font-size:11px; white-space:nowrap; }
    #${id}-connection::before { content:''; width:6px; height:6px; border-radius:50%; background:#c77e32; }
    #${id}-connection[data-online="true"]::before { background:#21a57a; }
    #${id}-settings, #${id}-refresh, #${id}-collapse { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; height:28px; min-width:28px; padding:0 5px; border:1px solid #e5eaf1; border-radius:7px; background:#fff; color:#62738c; line-height:1; }
    #${id}-refresh, #${id}-collapse { font-size:17px; }
    #${id}-settings { font-size:11px; border-color:transparent; }
    #${id}-settings:hover, #${id}-refresh:hover, #${id}-collapse:hover { background:#f1f5fc; color:#3159bf; }
    #${id} .panel-tabs { display:flex; gap:4px; padding:3px; background:#f0f3f8; border-radius:9px; }
    #${id} .panel-tabs button { flex:1; min-height:31px; padding:4px 8px; border:0; border-radius:6px; background:transparent; color:var(--muted); font-size:12px; }
    #${id} .panel-tabs button[aria-pressed="true"] { background:#fff; color:#2c50a8; font-weight:650; box-shadow:0 1px 3px #25385810; }
    #${id}-versions { margin-top:6px; max-height:min(430px,calc(100vh - 260px)); overflow:auto; padding-right:3px; scrollbar-width:thin; scrollbar-color:#cbd5e1 transparent; }
    #${id} .article-group { border-bottom:1px solid var(--line); padding:6px 0; }
    #${id} .article-group:last-child { border-bottom:0; }
    #${id} .article-group-toggle { display:grid; grid-template-columns:14px minmax(0,1fr); align-items:start; gap:5px; width:100%; padding:6px 2px 0; border:0; border-radius:5px; background:transparent; text-align:left; color:var(--text); }
    #${id} .article-group-toggle:hover:not(:disabled) { color:#3159bf; }
    #${id} .article-group-title { min-width:0; font-size:13px; font-weight:650; line-height:1.65; overflow-wrap:anywhere; }
    #${id} .article-group-chevron { color:#8797ad; font-size:18px; line-height:1.2; padding-top:1px; }
    #${id} .article-summary { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-left:21px; padding:0 0 3px; }
    #${id} .article-group-count { color:var(--muted); font-size:11px; }
    #${id} .article-archive { min-height:28px; padding:2px 7px; border:0; border-radius:5px; background:transparent; color:#62738c; font-size:11px; }
    #${id} .article-archive:hover { color:#3159bf; background:#f1f5fc; }
    #${id} .article-archive:disabled { opacity:.5; }
    #${id} .article-group[data-collapsed="true"] .article-version-list { display:none; }
    #${id} .article-version-list { margin-left:21px; }
    #${id} .version-row { display:grid; grid-template-columns:42px minmax(0,1fr) 46px; align-items:start; gap:8px; padding:11px 0; border-top:1px solid #eef1f6; }
    #${id} .version-tag { display:block; max-width:42px; overflow:hidden; text-overflow:ellipsis; padding:1px 4px; border-radius:4px; background:#f0f3f7; color:#536c8e; font:600 11px/1.6 ui-monospace,monospace; }
    #${id} .version-row[data-latest="true"] .version-tag { background:#eaf0fc; color:#3159bf; }
    #${id} .version-detail { min-width:0; }
    #${id} .version-note { display:block; color:#34455f; font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
    #${id} .version-meta, #${id} .version-cache { display:block; margin-top:4px; color:var(--muted); font-size:11px; line-height:1.55; }
    #${id} .version-cache { margin-top:2px; color:#6c7a90; }
    #${id} .version-apply { min-height:29px; padding:3px 8px; border:1px solid #dbe5fa; border-radius:6px; background:#edf3ff; color:#3159bf; font-size:12px; font-weight:600; white-space:nowrap; }
    #${id} .version-apply:hover { background:#3159bf; color:#fff; border-color:#3159bf; }
    #${id} .version-apply:disabled { background:#f3f5f8; border-color:#e3e8ef; color:#8a97aa; }
    #${id} .version-history { width:100%; min-height:30px; padding:4px 0 8px; border:0; border-radius:5px; background:transparent; text-align:left; color:#597397; font-size:11px; }
    #${id} .version-history:hover { color:#3159bf; }
    #${id} .empty { padding:24px 12px; color:var(--muted); text-align:center; font-size:12px; }
    #${id}-receipt { margin-top:9px; padding:10px 11px; border:1px solid #dce7f8; border-radius:9px; background:#f4f7fd; }
    #${id}-receipt[hidden] { display:none; }
    #${id} .receipt-heading { display:block; color:#3159bf; font-size:12px; font-weight:650; }
    #${id} .receipt-title { display:block; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#435570; font-size:12px; }
    #${id} .receipt-detail { display:block; margin-top:3px; color:var(--muted); font-size:11px; }
    #${id}-receipt[data-modified="true"] .receipt-detail { color:#9a6415; }
    #${id}-message { margin:8px 0 0; padding:8px 10px; border-radius:7px; background:#f1f4f8; color:#586b85; font-size:12px; overflow-wrap:anywhere; }
    #${id}-message:empty { display:none; }
    #${id}-message[data-kind="warning"] { background:#fff7e9; color:#946416; }
    #${id}-message[data-kind="error"] { background:#fff0f2; color:#b42338; }
    #${id}-message[data-kind="working"] { background:#edf3ff; color:#3159bf; }
    #${id}-message[data-kind="success"] { background:#eaf7f0; color:#19734f; }
    #${id}-cancel { width:100%; margin-top:8px; padding:6px 8px; border:1px solid #f0d4da; border-radius:7px; background:#fff; color:#ac3b50; font-size:12px; }
    #${id}-cancel:hover { background:#fff4f6; }
    #${id}-cancel:disabled { opacity:.6; }
    #${id}-mention-picker { margin-top:9px; padding:9px; border:1px solid #dbe5fa; border-radius:8px; background:#f4f7fd; color:#34455f; }
    #${id}-mention-picker strong { display:block; font-size:12px; margin-bottom:6px; }
    #${id} .mention-candidate { width:100%; margin-top:5px; padding:6px 8px; border:1px solid #dbe5fa; border-radius:6px; background:#fff; color:#34455f; text-align:left; font-size:12px; overflow-wrap:anywhere; }
    #${id} .mention-candidate:hover { background:#edf3ff; }
    #${id}[data-collapsed="true"] { width:224px; padding:7px 8px; border-radius:11px; }
    #${id}[data-collapsed="true"] #${id}-header { flex-wrap:nowrap; margin:0; }
    #${id}[data-collapsed="true"] .panel-drag-handle { flex-basis:auto; min-width:0; min-height:32px; }
    #${id}[data-collapsed="true"] #${id}-title { font-size:13px; line-height:1.35; letter-spacing:0; }
    #${id}[data-collapsed="true"] .panel-drag-hint { display:block; margin-top:2px; color:#77869b; font-size:10px; font-weight:400; }
    #${id}[data-collapsed="true"] #${id}-collapse { height:30px; min-width:44px; font-size:12px; background:#f1f5fc; border-color:#e2e9f5; color:#3159bf; }
    #${id}[data-collapsed="true"] #${id}-connection, #${id}[data-collapsed="true"] #${id}-settings, #${id}[data-collapsed="true"] #${id}-refresh, #${id}[data-collapsed="true"] .panel-body { display:none; }
    @media (max-width:360px) { #${id} { padding:11px; } #${id} .panel-drag-handle { flex-basis:100%; } #${id}-connection { margin-right:auto; } #${id} .version-row { grid-template-columns:39px minmax(0,1fr) 44px; gap:6px; } }
  `
}
