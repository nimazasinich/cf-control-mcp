/**
 * v1.8 Admin Console — dashboard UI. Single static HTML page, flat/bold
 * design (no gradients/glow), vanilla JS calling the /admin/api/* routes.
 */

export function loginPageHtml(error?: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>cf-control-mcp admin</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#1e293b;border:2px solid #334155;border-radius:8px;padding:32px;width:320px}
h1{font-size:18px;margin:0 0 16px}
input{width:100%;padding:10px;margin-bottom:12px;border-radius:4px;border:2px solid #334155;background:#0f172a;color:#f1f5f9;box-sizing:border-box}
button{width:100%;padding:10px;border:none;border-radius:4px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}
.err{color:#f87171;font-size:13px;margin-bottom:12px}
</style></head><body>
<form class="card" method="POST" action="/admin/login">
<h1>cf-control-mcp — Admin</h1>
${error ? `<div class="err">${error}</div>` : ""}
<input type="password" name="token" placeholder="Owner token (MCP_AUTH_TOKEN)" autofocus>
<button type="submit">Sign in</button>
</form></body></html>`;
}

export function dashboardHtml(): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>cf-control-mcp admin</title>
<style>
:root{--bg:#0f172a;--panel:#1e293b;--panel2:#111827;--border:#334155;--text:#f1f5f9;--muted:#94a3b8;--accent:#2563eb;--good:#16a34a;--bad:#dc2626;--warn:#d97706}
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0}
header{display:flex;gap:14px;padding:14px 24px;border-bottom:2px solid var(--border);align-items:center;position:sticky;top:0;background:var(--bg);z-index:10}
header h1{font-size:16px;margin:0;white-space:nowrap}
nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}
nav button{background:none;border:2px solid transparent;color:var(--muted);padding:7px 11px;border-radius:4px;cursor:pointer;font-weight:700}
nav button.active{color:var(--text);border-color:var(--accent);background:var(--panel)}
.header-action{background:var(--panel);border:1px solid var(--border);color:var(--text);padding:7px 11px;border-radius:4px;cursor:pointer;font-weight:700}
main{padding:24px;max-width:1500px;margin:0 auto}
.panel{display:none}
.panel.active{display:block}
.panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:14px}
.panel-head h2{margin:0;font-size:20px}.panel-head p{margin:3px 0 0;color:var(--muted);font-size:13px}
.notice{display:none;margin-bottom:16px;padding:10px 12px;border:1px solid var(--border);border-left-width:4px;background:var(--panel2);border-radius:5px;font-size:13px}
.notice.show{display:block}.notice.ok{border-left-color:var(--good)}.notice.error{border-left-color:var(--bad)}.notice.warn{border-left-color:var(--warn)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:14px}.card-label{font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase}.card-value{font-size:25px;font-weight:800;margin-top:4px}.card-sub{font-size:11px;color:var(--muted);margin-top:3px}
.table-wrap{overflow:auto;border:1px solid var(--border);border-radius:7px;background:var(--panel)}
table{width:100%;border-collapse:collapse;min-width:760px}
th,td{text-align:left;padding:10px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;background:rgba(15,23,42,.55);position:sticky;top:0}
tr:last-child td{border-bottom:none}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#bfdbfe}
.badge{display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:800;white-space:nowrap}
.HEALTHY,.ACTIVE,.AVAILABLE{background:var(--good)}
.NOT_CONFIGURED,.DISABLED{background:#475569}
.AUTH_ERROR,.UPSTREAM_ERROR,.BROKEN{background:var(--bad)}
.RATE_LIMITED,.DEGRADED,.MODEL_DISABLED,.PROVIDER_DISABLED{background:var(--warn)}
.actions{display:flex;gap:6px;flex-wrap:wrap}
button.action{background:var(--accent);border:none;color:#fff;padding:6px 10px;border-radius:4px;cursor:pointer;font-weight:750;white-space:nowrap}
button.action.secondary{background:#475569}button.action.danger{background:var(--bad)}button.action.warn{background:var(--warn)}
button.action:disabled,.header-action:disabled{opacity:.5;cursor:not-allowed}
.muted{color:var(--muted)}.small{font-size:12px}.alias-list{display:flex;gap:4px;flex-wrap:wrap}.alias{background:#334155;border-radius:3px;padding:2px 6px;font-size:11px}
input[type=password],input[type=search]{padding:7px 9px;border-radius:4px;border:2px solid var(--border);background:var(--bg);color:var(--text)}
input[type=search]{min-width:280px}
.tool-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px;flex-wrap:wrap}
.tool-schema{max-width:520px}.tool-schema summary{cursor:pointer;color:#bfdbfe;font-weight:700}.tool-schema pre{white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;background:var(--bg);border:1px solid var(--border);padding:9px;border-radius:4px;font-size:11px}
.READ_ONLY{background:#1d4ed8}.DESTRUCTIVE{background:var(--bad)}.OPEN_WORLD{background:var(--warn)}.IDEMPOTENT{background:var(--good)}
@media(max-width:900px){header{align-items:flex-start;flex-wrap:wrap}main{padding:14px}.panel-head{align-items:flex-start;flex-direction:column}table{min-width:700px}}
</style></head><body>
<header>
<h1>cf-control-mcp — Admin</h1>
<nav>
<button data-tab="overview" class="active">Overview</button>
<button data-tab="providers">Providers</button>
<button data-tab="models">Models</button>
<button data-tab="mcp-tools">MCP Tools</button>
<button data-tab="routing">Routing</button>
<button data-tab="health">Health</button>
<button data-tab="usage">Usage</button>
<button data-tab="logs">Logs</button>
<button data-tab="settings">Settings</button>
</nav>
<button id="refresh-all" class="header-action">Refresh</button>
</header>
<main>
<div id="notice" class="notice"></div>

<section id="overview" class="panel active">
  <div class="panel-head"><div><h2>Operational Overview</h2><p>Effective runtime availability from D1 control state.</p></div></div>
  <div class="cards">
    <div class="card"><div class="card-label">Providers enabled</div><div id="stat-providers" class="card-value">—</div><div id="stat-providers-sub" class="card-sub">—</div></div>
    <div class="card"><div class="card-label">Healthy providers</div><div id="stat-healthy" class="card-value">—</div></div>
    <div class="card"><div class="card-label">Models available</div><div id="stat-models" class="card-value">—</div><div id="stat-models-sub" class="card-sub">—</div></div>
    <div class="card"><div class="card-label">Disabled models</div><div id="stat-disabled-models" class="card-value">—</div></div>
    <div class="card"><div class="card-label">Active aliases</div><div id="stat-active-routes" class="card-value">—</div><div id="stat-routes-sub" class="card-sub">—</div></div>
    <div class="card"><div class="card-label">Unavailable aliases</div><div id="stat-unavailable-routes" class="card-value">—</div></div>
  </div>
  <p id="overview-body" class="muted">Loading…</p>
</section>

<section id="providers" class="panel">
  <div class="panel-head"><div><h2>Providers</h2><p>Provider enablement is runtime-authoritative for every model owned by that provider.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Provider</th><th>Runtime</th><th>Health</th><th>Models</th><th>Routing impact</th><th>BYOK</th><th>Last result</th><th>Actions</th></tr></thead>
    <tbody id="providers-body"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody>
  </table></div>
</section>

<section id="models" class="panel">
  <div class="panel-head"><div><h2>Models</h2><p>Enable/Disable writes to D1 and immediately controls /v1/models and chat completions.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Model ID</th><th>Provider</th><th>Configured</th><th>Effective runtime</th><th>Used by aliases</th><th>Actions</th></tr></thead>
    <tbody id="models-body"><tr><td colspan="6" class="muted">Loading…</td></tr></tbody>
  </table></div>
</section>

<section id="mcp-tools" class="panel">
  <div class="panel-head"><div><h2>MCP Tools</h2><p>Runtime catalog exposed by the same registry used by MCP tools/list. Handler code and secrets are never returned.</p></div></div>
  <div class="cards">
    <div class="card"><div class="card-label">Registered tools</div><div id="stat-tools-total" class="card-value">—</div></div>
    <div class="card"><div class="card-label">Read-only hint</div><div id="stat-tools-readonly" class="card-value">—</div></div>
    <div class="card"><div class="card-label">Destructive hint</div><div id="stat-tools-destructive" class="card-value">—</div></div>
    <div class="card"><div class="card-label">Open-world hint</div><div id="stat-tools-openworld" class="card-value">—</div></div>
  </div>
  <div class="tool-toolbar">
    <div class="muted small" id="tools-filter-summary">Loading tool catalog…</div>
    <input id="tools-search" type="search" placeholder="Search tools by name or description" autocomplete="off">
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Tool</th><th>Description</th><th>Safety / behavior hints</th><th>Input schema</th></tr></thead>
    <tbody id="tools-body"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>
  </table></div>
</section>

<section id="routing" class="panel">
  <div class="panel-head"><div><h2>Routing</h2><p>Routes remain configured when a target is disabled; operational state is shown explicitly.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Alias</th><th>Target model</th><th>Provider</th><th>Operational state</th><th>Updated</th></tr></thead>
    <tbody id="routing-body"><tr><td colspan="5" class="muted">Loading…</td></tr></tbody>
  </table></div>
</section>

<section id="health" class="panel">
  <div class="panel-head"><div><h2>Health History</h2><p>Recorded provider health checks.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Checked At</th><th>Provider</th><th>State</th><th>Latency</th><th>Detail</th></tr></thead>
    <tbody id="health-body"></tbody>
  </table></div>
</section>

<section id="usage" class="panel">
  <div class="panel-head"><div><h2>Usage</h2><p>Admin/audit activity and gateway observability pointers.</p></div></div>
  <div class="card"><div id="usage-body">Loading…</div></div>
</section>

<section id="logs" class="panel">
  <div class="panel-head"><div><h2>Audit Log</h2><p>Recent control-plane actions.</p></div></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Time</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
    <tbody id="logs-body"></tbody>
  </table></div>
</section>

<section id="settings" class="panel">
  <div class="panel-head"><div><h2>Settings</h2><p>Bound runtime metadata; secret values are never displayed.</p></div></div>
  <div class="card" style="max-width:640px"><div id="settings-body">Loading…</div></div>
</section>
</main>
<script>
const noticeEl = document.getElementById('notice');
let noticeTimer = null;
let mcpToolsCache = [];

function esc(value){
  return String(value == null ? '' : value)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function showNotice(message, kind){
  clearTimeout(noticeTimer);
  noticeEl.textContent = message;
  noticeEl.className = 'notice show ' + (kind || 'ok');
  noticeTimer = setTimeout(function(){ noticeEl.className='notice'; }, 6500);
}
async function api(path, opts){
  const response = await fetch(path, opts);
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if(!response.ok){
    const err = new Error(data.error || ('HTTP_'+response.status));
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}
function aliasHtml(list){
  if(!list || !list.length) return '<span class="muted">none</span>';
  return '<div class="alias-list">' + list.map(function(a){return '<span class="alias">'+esc(a)+'</span>';}).join('') + '</div>';
}
function setBusy(button, busy, busyText){
  if(!button) return;
  if(busy){ button.dataset.oldText = button.textContent; button.textContent = busyText || 'Working…'; button.disabled = true; }
  else { button.textContent = button.dataset.oldText || button.textContent; button.disabled = false; }
}

async function refreshOperational(){
  await Promise.all([loadOverview(), loadProviders(), loadModels(), loadRouting()]);
}

document.querySelectorAll('nav button').forEach(function(button){
  button.addEventListener('click',function(){
    document.querySelectorAll('nav button').forEach(function(x){x.classList.remove('active');});
    document.querySelectorAll('.panel').forEach(function(x){x.classList.remove('active');});
    button.classList.add('active');
    document.getElementById(button.dataset.tab).classList.add('active');
    if(button.dataset.tab==='overview') loadOverview();
    if(button.dataset.tab==='providers') loadProviders();
    if(button.dataset.tab==='models') loadModels();
    if(button.dataset.tab==='mcp-tools') loadMcpTools();
    if(button.dataset.tab==='routing') loadRouting();
    if(button.dataset.tab==='health') loadHealth();
    if(button.dataset.tab==='usage') loadUsage();
    if(button.dataset.tab==='logs') loadLogs();
    if(button.dataset.tab==='settings') loadSettings();
  });
});
document.getElementById('refresh-all').addEventListener('click', async function(){
  const button=this; setBusy(button,true,'Refreshing…');
  try { await Promise.all([refreshOperational(), loadMcpTools(), loadHealth(), loadLogs()]); showNotice('Admin state refreshed.','ok'); }
  catch(err){ showNotice('Refresh failed: '+err.message,'error'); }
  finally { setBusy(button,false); }
});

async function loadOverview(){
  const d = await api('/admin/api/overview');
  document.getElementById('stat-providers').textContent = (d.enabledProviderCount ?? 0) + '/' + (d.providerCount ?? 0);
  document.getElementById('stat-providers-sub').textContent = 'enabled / registered';
  document.getElementById('stat-healthy').textContent = d.healthyCount ?? 0;
  document.getElementById('stat-models').textContent = (d.availableModelCount ?? 0) + '/' + (d.modelCount ?? 0);
  document.getElementById('stat-models-sub').textContent = 'available / registered';
  document.getElementById('stat-disabled-models').textContent = d.disabledModelCount ?? 0;
  document.getElementById('stat-active-routes').textContent = d.activeRoutingAliasCount ?? 0;
  document.getElementById('stat-routes-sub').textContent = 'of ' + (d.routingRuleCount ?? 0) + ' configured';
  document.getElementById('stat-unavailable-routes').textContent = d.unavailableRoutingAliasCount ?? 0;
  document.getElementById('overview-body').textContent = (d.availableModelCount ?? 0) + ' model(s) are currently callable through ' + (d.activeRoutingAliasCount ?? 0) + ' active alias(es).';
}

async function loadProviders(){
  const d = await api('/admin/api/providers');
  const rows = (d.providers || []).map(function(p){
    const status = p.enabled ? 'HEALTHY' : 'DISABLED';
    return '<tr>'+
      '<td><strong>'+esc(p.display_name)+'</strong><br><code>'+esc(p.id)+'</code></td>'+
      '<td><span class="badge '+status+'">'+(p.enabled?'enabled':'disabled')+'</span></td>'+
      '<td><span class="badge '+esc(p.health_state)+'">'+esc(p.health_state)+'</span></td>'+
      '<td>'+esc(p.enabled_model_count)+' / '+esc(p.model_count)+' enabled</td>'+
      '<td>'+aliasHtml(p.routing_aliases)+'</td>'+
      '<td>'+(p.byok_alias?'<span class="badge HEALTHY">'+esc(p.byok_alias)+'</span>':'<span class="badge NOT_CONFIGURED">none</span>')+'</td>'+
      '<td><span class="small">'+esc(p.last_success_at || '—')+'</span><br><span class="muted small">'+esc(p.last_error_message || '')+'</span></td>'+
      '<td><div class="actions">'+
        '<button class="action '+(p.enabled?'warn':'')+'" data-provider-action="toggle" data-id="'+esc(p.id)+'" data-enable="'+(!p.enabled)+'">'+(p.enabled?'Disable':'Enable')+'</button>'+
        '<button class="action secondary" data-provider-action="health" data-id="'+esc(p.id)+'">Health test</button>'+
        '<button class="action secondary" data-provider-action="credential" data-id="'+esc(p.id)+'">'+(p.byok_alias?'Rotate':'Set')+' credential</button>'+
        (p.byok_alias?'<button class="action danger" data-provider-action="delete-credential" data-id="'+esc(p.id)+'">Delete credential</button>':'')+
      '</div></td></tr>';
  }).join('');
  document.getElementById('providers-body').innerHTML = rows || '<tr><td colspan="8" class="muted">No providers found.</td></tr>';
}

async function loadModels(){
  const d = await api('/admin/api/models');
  const rows = (d.models || []).map(function(m){
    let runtimeState = 'AVAILABLE';
    let runtimeText = 'available';
    if(!m.enabled){ runtimeState='DISABLED'; runtimeText='model disabled'; }
    else if(!m.provider_enabled){ runtimeState='PROVIDER_DISABLED'; runtimeText='provider disabled'; }
    return '<tr>'+
      '<td><code>'+esc(m.id)+'</code></td>'+
      '<td>'+esc(m.provider_id)+'</td>'+
      '<td><span class="badge '+(m.enabled?'HEALTHY':'DISABLED')+'">'+(m.enabled?'enabled':'disabled')+'</span></td>'+
      '<td><span class="badge '+runtimeState+'">'+runtimeText+'</span></td>'+
      '<td>'+aliasHtml(m.routing_aliases)+'</td>'+
      '<td><div class="actions"><button class="action '+(m.enabled?'warn':'')+'" data-model-action="toggle" data-id="'+esc(m.id)+'" data-enable="'+(!m.enabled)+'">'+(m.enabled?'Disable':'Enable')+'</button></div></td>'+
    '</tr>';
  }).join('');
  document.getElementById('models-body').innerHTML = rows || '<tr><td colspan="6" class="muted">No models registered.</td></tr>';
}

function toolHintsHtml(tool){
  const a = tool.annotations || {};
  const hints = [];
  if(a.readOnlyHint) hints.push('<span class="badge READ_ONLY">READ ONLY</span>');
  if(a.destructiveHint) hints.push('<span class="badge DESTRUCTIVE">DESTRUCTIVE</span>');
  if(a.idempotentHint) hints.push('<span class="badge IDEMPOTENT">IDEMPOTENT</span>');
  if(a.openWorldHint) hints.push('<span class="badge OPEN_WORLD">OPEN WORLD</span>');
  return hints.length ? '<div class="actions">'+hints.join('')+'</div>' : '<span class="muted">no hints</span>';
}

function renderMcpTools(){
  const input = document.getElementById('tools-search');
  const query = (input && input.value ? input.value : '').trim().toLowerCase();
  const visible = mcpToolsCache.filter(function(tool){
    return !query || String(tool.name||'').toLowerCase().includes(query) || String(tool.description||'').toLowerCase().includes(query);
  });
  document.getElementById('tools-filter-summary').textContent = visible.length + ' of ' + mcpToolsCache.length + ' tool(s) shown';
  document.getElementById('tools-body').innerHTML = visible.map(function(tool){
    const schema = JSON.stringify(tool.inputSchema || {}, null, 2);
    return '<tr>'+
      '<td><code><strong>'+esc(tool.name)+'</strong></code></td>'+
      '<td><span class="small">'+esc(tool.description||'—')+'</span></td>'+
      '<td>'+toolHintsHtml(tool)+'</td>'+
      '<td><details class="tool-schema"><summary>View schema</summary><pre>'+esc(schema)+'</pre></details></td>'+
    '</tr>';
  }).join('') || '<tr><td colspan="4" class="muted">No tools match this filter.</td></tr>';
}

async function loadMcpTools(){
  const d = await api('/admin/api/tools');
  mcpToolsCache = Array.isArray(d.tools) ? d.tools : [];
  document.getElementById('stat-tools-total').textContent = d.count ?? mcpToolsCache.length;
  document.getElementById('stat-tools-readonly').textContent = d.readOnlyCount ?? 0;
  document.getElementById('stat-tools-destructive').textContent = d.destructiveCount ?? 0;
  document.getElementById('stat-tools-openworld').textContent = d.openWorldCount ?? 0;
  renderMcpTools();
}

document.getElementById('tools-search').addEventListener('input', renderMcpTools);

async function loadRouting(){
  const d = await api('/admin/api/routing');
  const rows = (d.rules || []).map(function(r){
    return '<tr>'+
      '<td><strong>'+esc(r.public_alias)+'</strong></td>'+
      '<td><code>'+esc(r.model_id)+'</code></td>'+
      '<td>'+esc(r.provider_id || '—')+'</td>'+
      '<td><span class="badge '+esc(r.state)+'">'+esc(r.state)+'</span></td>'+
      '<td>'+esc(r.updated_at)+'</td>'+
    '</tr>';
  }).join('');
  document.getElementById('routing-body').innerHTML = rows || '<tr><td colspan="5" class="muted">No routing rules configured.</td></tr>';
}

async function loadHealth(){
  const d = await api('/admin/api/health');
  const rows = (d.checks || []).map(function(c){
    return '<tr><td>'+esc(c.checked_at)+'</td><td>'+esc(c.provider_id)+'</td><td><span class="badge '+esc(c.state)+'">'+esc(c.state)+'</span></td><td>'+esc(c.latency_ms ? c.latency_ms+'ms' : '—')+'</td><td><span class="muted small">'+esc(c.error_message || 'OK')+'</span></td></tr>';
  }).join('');
  document.getElementById('health-body').innerHTML = rows || '<tr><td colspan="5" class="muted">No health check history recorded.</td></tr>';
}

async function loadUsage(){
  const d = await api('/admin/api/usage');
  document.getElementById('usage-body').innerHTML = '<p>Total recorded audit/admin events: <strong>'+esc(d.totalAuditEvents)+'</strong></p><p class="muted">Real-time gateway usage is streamed through Cloudflare AI Gateway analytics.</p>';
}

async function loadLogs(){
  const d = await api('/admin/api/logs');
  document.getElementById('logs-body').innerHTML = (d.events || []).map(function(e){
    return '<tr><td>'+esc(e.at)+'</td><td><code>'+esc(e.action)+'</code></td><td>'+esc(e.target||'—')+'</td><td><span class="small">'+esc(e.detail||'—')+'</span></td></tr>';
  }).join('') || '<tr><td colspan="4" class="muted">No audit events recorded.</td></tr>';
}

async function loadSettings(){
  const d = await api('/admin/api/settings');
  document.getElementById('settings-body').innerHTML = '<table style="min-width:0">'+
    '<tr><td class="muted">Version</td><td><strong>v'+esc(d.version)+'</strong></td></tr>'+
    '<tr><td class="muted">Gateway Slug</td><td><code>'+esc(d.gatewaySlug)+'</code></td></tr>'+
    '<tr><td class="muted">Account ID</td><td><code>'+esc(d.accountIdMasked)+'</code></td></tr>'+
    '<tr><td class="muted">Metadata Store</td><td><code>'+esc(d.d1Database)+' (D1)</code></td></tr>'+
    '<tr><td class="muted">CF Token Bound</td><td><span class="badge '+(d.hasCfToken?'HEALTHY':'DISABLED')+'">'+(d.hasCfToken?'configured':'missing')+'</span></td></tr>'+
    '<tr><td class="muted">Gateway Auth Bound</td><td><span class="badge '+(d.hasGatewayAuth?'HEALTHY':'DISABLED')+'">'+(d.hasGatewayAuth?'configured':'missing')+'</span></td></tr>'+
    '<tr><td class="muted">Owner Auth Bound</td><td><span class="badge '+(d.hasMcpAuth?'HEALTHY':'DISABLED')+'">'+(d.hasMcpAuth?'configured':'missing')+'</span></td></tr></table>';
}

document.getElementById('models-body').addEventListener('click', async function(event){
  const button = event.target.closest('button[data-model-action]');
  if(!button) return;
  const id = button.dataset.id;
  const enabled = button.dataset.enable === 'true';
  if(!enabled){
    const row = button.closest('tr');
    const aliasText = row && row.children[4] ? row.children[4].textContent.trim() : '';
    if(aliasText && aliasText !== 'none' && !confirm('Disable '+id+'? Routing aliases using this model will become unavailable until it is re-enabled.')) return;
  }
  setBusy(button,true,enabled?'Enabling…':'Disabling…');
  try{
    const result = await api('/admin/api/models/'+encodeURIComponent(id), {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:enabled})});
    const affected = result.affectedAliases || [];
    showNotice((enabled?'Enabled ':'Disabled ')+id+(affected.length?' — affected aliases: '+affected.join(', '):''), affected.length && !enabled ? 'warn' : 'ok');
    await Promise.all([loadModels(),loadRouting(),loadOverview(),loadLogs()]);
  }catch(err){ showNotice('Model update failed: '+err.message,'error'); }
  finally{ setBusy(button,false); }
});

document.getElementById('providers-body').addEventListener('click', async function(event){
  const button = event.target.closest('button[data-provider-action]');
  if(!button) return;
  const id = button.dataset.id;
  const action = button.dataset.providerAction;

  if(action==='toggle'){
    const enabled = button.dataset.enable === 'true';
    if(!enabled && !confirm('Disable provider '+id+'? All enabled models and routing aliases backed by this provider will become unavailable.')) return;
    setBusy(button,true,enabled?'Enabling…':'Disabling…');
    try{
      const result = await api('/admin/api/providers/'+encodeURIComponent(id), {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:enabled})});
      showNotice((enabled?'Enabled ':'Disabled ')+id+'. Runtime availability refreshed.', enabled?'ok':'warn');
      await Promise.all([loadProviders(),loadModels(),loadRouting(),loadOverview(),loadLogs()]);
    }catch(err){ showNotice('Provider update failed: '+err.message,'error'); }
    finally{ setBusy(button,false); }
    return;
  }

  if(action==='health'){
    setBusy(button,true,'Testing…');
    try{ const result=await api('/admin/api/providers/'+encodeURIComponent(id)+'/health-test',{method:'POST'}); showNotice(id+' health: '+result.state,(result.state==='HEALTHY'?'ok':'warn')); await Promise.all([loadProviders(),loadHealth(),loadOverview(),loadLogs()]); }
    catch(err){ showNotice('Health test failed: '+err.message,'error'); }
    finally{ setBusy(button,false); }
    return;
  }

  if(action==='credential'){
    const value = prompt('Paste the new API key for '+id+' (sent directly to Cloudflare; never rendered back by this console):');
    if(!value) return;
    setBusy(button,true,'Saving…');
    try{ const result=await api('/admin/api/providers/'+encodeURIComponent(id)+'/credential',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:value})}); showNotice('Credential updated for '+id+'. Health: '+(result.healthState||'unknown'),'ok'); await Promise.all([loadProviders(),loadHealth(),loadLogs()]); }
    catch(err){ showNotice('Credential update failed: '+err.message,'error'); }
    finally{ setBusy(button,false); }
    return;
  }

  if(action==='delete-credential'){
    if(!confirm('Delete credential for '+id+'?')) return;
    setBusy(button,true,'Deleting…');
    try{ await api('/admin/api/providers/'+encodeURIComponent(id)+'/credential',{method:'DELETE'}); showNotice('Credential deleted for '+id+'.','warn'); await Promise.all([loadProviders(),loadHealth(),loadLogs()]); }
    catch(err){ showNotice('Credential delete failed: '+err.message,'error'); }
    finally{ setBusy(button,false); }
  }
});

refreshOperational().catch(function(err){showNotice('Initial load failed: '+err.message,'error');});
</script>
</body></html>`;
}
