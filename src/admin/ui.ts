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
	return `<!doctype html><html><head><meta charset="utf-8"><title>cf-control-mcp admin</title>
<style>
:root{--bg:#0f172a;--panel:#1e293b;--border:#334155;--text:#f1f5f9;--accent:#2563eb;--good:#16a34a;--bad:#dc2626;--warn:#d97706}
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0}
header{display:flex;gap:8px;padding:16px 24px;border-bottom:2px solid var(--border);align-items:center}
header h1{font-size:16px;margin:0;margin-right:24px}
nav button{background:none;border:2px solid transparent;color:#94a3b8;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:700}
nav button.active{color:var(--text);border-color:var(--accent);background:var(--panel)}
main{padding:24px}
.panel{display:none}
.panel.active{display:block}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px;border-bottom:1px solid var(--border)}
.badge{padding:3px 8px;border-radius:4px;font-size:12px;font-weight:700}
.HEALTHY{background:var(--good)}
.NOT_CONFIGURED{background:#475569}
.AUTH_ERROR,.UPSTREAM_ERROR{background:var(--bad)}
.RATE_LIMITED,.DEGRADED{background:var(--warn)}
.DISABLED{background:#475569}
button.action{background:var(--accent);border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:700;margin-right:6px}
button.danger{background:var(--bad)}
input[type=password]{padding:6px;border-radius:4px;border:2px solid var(--border);background:var(--bg);color:var(--text)}
</style></head><body>
<header>
<h1>cf-control-mcp — Admin</h1>
<nav>
<button data-tab="overview" class="active">Overview</button>
<button data-tab="providers">Providers</button>
<button data-tab="models">Models</button>
<button data-tab="routing">Routing</button>
<button data-tab="health">Health</button>
<button data-tab="usage">Usage</button>
<button data-tab="logs">Logs</button>
<button data-tab="settings">Settings</button>
</nav>
</header>
<main>
<section id="overview" class="panel active">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
    <div style="background:var(--panel);border:2px solid var(--border);border-radius:8px;padding:16px">
      <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase">Providers</div>
      <div id="stat-providers" style="font-size:28px;font-weight:700;margin-top:4px">—</div>
    </div>
    <div style="background:var(--panel);border:2px solid var(--border);border-radius:8px;padding:16px">
      <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase">Healthy</div>
      <div id="stat-healthy" style="font-size:28px;font-weight:700;color:var(--good);margin-top:4px">—</div>
    </div>
    <div style="background:var(--panel);border:2px solid var(--border);border-radius:8px;padding:16px">
      <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase">Models</div>
      <div id="stat-models" style="font-size:28px;font-weight:700;margin-top:4px">—</div>
    </div>
    <div style="background:var(--panel);border:2px solid var(--border);border-radius:8px;padding:16px">
      <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase">Routing Rules</div>
      <div id="stat-rules" style="font-size:28px;font-weight:700;margin-top:4px">—</div>
    </div>
  </div>
  <p id="overview-body" style="color:#94a3b8">Loading…</p>
</section>

<section id="providers" class="panel">
  <table>
    <thead><tr><th>Provider</th><th>Status</th><th>Health</th><th>BYOK Alias</th><th>Last success (error)</th><th>Latency</th><th>Actions</th></tr></thead>
    <tbody id="providers-body"></tbody>
  </table>
</section>

<section id="models" class="panel">
  <table>
    <thead><tr><th>Model ID</th><th>Provider</th><th>Public Alias</th><th>Status</th></tr></thead>
    <tbody id="models-body"></tbody>
  </table>
</section>

<section id="routing" class="panel">
  <table>
    <thead><tr><th>User-Facing Alias</th><th>Target Model ID</th><th>Updated At</th></tr></thead>
    <tbody id="routing-body"></tbody>
  </table>
</section>

<section id="health" class="panel">
  <table>
    <thead><tr><th>Checked At</th><th>Provider</th><th>State</th><th>Latency</th><th>Detail</th></tr></thead>
    <tbody id="health-body"></tbody>
  </table>
</section>

<section id="usage" class="panel">
  <div style="background:var(--panel);border:2px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
    <h3 style="margin:0 0 8px">AI Gateway Observability & Audit Stats</h3>
    <div id="usage-body">Loading…</div>
  </div>
</section>

<section id="logs" class="panel">
  <table>
    <thead><tr><th>Time</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
    <tbody id="logs-body"></tbody>
  </table>
</section>

<section id="settings" class="panel">
  <div style="background:var(--panel);border:2px solid var(--border);border-radius:8px;padding:20px;max-width:540px">
    <h3 style="margin:0 0 16px">System Configuration & Metadata</h3>
    <div id="settings-body">Loading…</div>
  </div>
</section>
</main>
<script>
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById(b.dataset.tab).classList.add('active');
  if(b.dataset.tab==='models') loadModels();
  if(b.dataset.tab==='routing') loadRouting();
  if(b.dataset.tab==='health') loadHealth();
  if(b.dataset.tab==='usage') loadUsage();
  if(b.dataset.tab==='logs') loadLogs();
  if(b.dataset.tab==='settings') loadSettings();
}));

async function api(path, opts){ const r = await fetch(path, opts); return r.json(); }

async function loadOverview(){
  const d = await api('/admin/api/overview');
  document.getElementById('stat-providers').textContent = d.providerCount ?? 0;
  document.getElementById('stat-healthy').textContent = d.healthyCount ?? 0;
  document.getElementById('stat-models').textContent = d.modelCount ?? 0;
  document.getElementById('stat-rules').textContent = d.routingRuleCount ?? 0;
  document.getElementById('overview-body').textContent =
    'System operational. ' + d.providerCount + ' provider(s) configured (' + d.healthyCount + ' healthy), ' + (d.modelCount ?? 0) + ' model(s) registered with ' + (d.routingRuleCount ?? 0) + ' routing alias(es).';
}

async function loadProviders(){
  const d = await api('/admin/api/providers');
  const rows = d.providers.map(p => \`<tr>
    <td><strong>\${p.display_name}</strong></td>
    <td><span class="badge \${p.enabled ? 'HEALTHY' : 'DISABLED'}">\${p.enabled ? 'enabled' : 'disabled'}</span></td>
    <td><span class="badge \${p.health_state}">\${p.health_state}</span></td>
    <td>\${p.byok_alias ? \`<span class="badge HEALTHY">\${p.byok_alias}</span>\` : '<span class="badge NOT_CONFIGURED">none</span>'}</td>
    <td>\${p.last_success_at || '—'}<br><small style="color:#94a3b8">\${p.last_error_message || ''}</small></td>
    <td>\${p.last_latency_ms ? p.last_latency_ms + 'ms' : '—'}</td>
    <td>
      <button class="action" onclick="toggleProvider('\${p.id}', \${p.enabled ? 0 : 1})">\${p.enabled ? 'Disable' : 'Enable'}</button>
      <button class="action" onclick="testProvider('\${p.id}')">Health test</button>
      <button class="action" onclick="rotateCred('\${p.id}')">\${p.byok_alias ? 'Rotate' : 'Set'} credential</button>
      \${p.byok_alias ? \`<button class="action danger" onclick="deleteCred('\${p.id}')">Delete credential</button>\` : ''}
    </td>
  </tr>\`).join('');
  document.getElementById('providers-body').innerHTML = rows || '<tr><td colspan="7">No providers found.</td></tr>';
}

async function loadModels(){
  const d = await api('/admin/api/models');
  const rows = (d.models || []).map(m => \`<tr>
    <td><code>\${m.id}</code></td>
    <td>\${m.provider_id}</td>
    <td><span class="badge HEALTHY">\${m.public_alias || '—'}</span></td>
    <td><span class="badge \${m.enabled ? 'HEALTHY' : 'DISABLED'}">\${m.enabled ? 'active' : 'disabled'}</span></td>
  </tr>\`).join('');
  document.getElementById('models-body').innerHTML = rows || '<tr><td colspan="4">No models registered.</td></tr>';
}

async function loadRouting(){
  const d = await api('/admin/api/routing');
  const rows = (d.rules || []).map(r => \`<tr>
    <td><strong>\${r.public_alias}</strong></td>
    <td><code>\${r.model_id}</code></td>
    <td>\${r.updated_at}</td>
  </tr>\`).join('');
  document.getElementById('routing-body').innerHTML = rows || '<tr><td colspan="3">No routing rules configured.</td></tr>';
}

async function loadHealth(){
  const d = await api('/admin/api/health');
  const rows = (d.checks || []).map(c => \`<tr>
    <td>\${c.checked_at}</td>
    <td>\${c.provider_id}</td>
    <td><span class="badge \${c.state}">\${c.state}</span></td>
    <td>\${c.latency_ms ? c.latency_ms + 'ms' : '—'}</td>
    <td><small style="color:#94a3b8">\${c.error_message || 'OK'}</small></td>
  </tr>\`).join('');
  document.getElementById('health-body').innerHTML = rows || '<tr><td colspan="5">No health check history recorded.</td></tr>';
}

async function loadUsage(){
  const d = await api('/admin/api/usage');
  document.getElementById('usage-body').innerHTML = \`
    <p>Total recorded audit/admin events: <strong>\${d.totalAuditEvents}</strong></p>
    <p style="color:#94a3b8">Real-time gateway usage is streamed directly through Cloudflare AI Gateway analytics.</p>
  \`;
}

async function loadLogs(){
  const d = await api('/admin/api/logs');
  document.getElementById('logs-body').innerHTML = (d.events || []).map(e=>\`<tr><td>\${e.at}</td><td><code>\${e.action}</code></td><td>\${e.target||'—'}</td><td><small>\${e.detail||'—'}</small></td></tr>\`).join('');
}

async function loadSettings(){
  const d = await api('/admin/api/settings');
  document.getElementById('settings-body').innerHTML = \`
    <table style="border:none">
      <tr><td style="border:none;color:#94a3b8">Version</td><td style="border:none"><strong>v\${d.version}</strong></td></tr>
      <tr><td style="border:none;color:#94a3b8">Gateway Slug</td><td style="border:none"><code>\${d.gatewaySlug}</code></td></tr>
      <tr><td style="border:none;color:#94a3b8">Account ID</td><td style="border:none"><code>\${d.accountIdMasked}</code></td></tr>
      <tr><td style="border:none;color:#94a3b8">Metadata Store</td><td style="border:none"><code>\${d.d1Database} (D1)</code></td></tr>
      <tr><td style="border:none;color:#94a3b8">CF Token Bound</td><td style="border:none"><span class="badge \${d.hasCfToken ? 'HEALTHY' : 'DISABLED'}">\${d.hasCfToken ? 'configured' : 'missing'}</span></td></tr>
      <tr><td style="border:none;color:#94a3b8">Gateway Auth Bound</td><td style="border:none"><span class="badge \${d.hasGatewayAuth ? 'HEALTHY' : 'DISABLED'}">\${d.hasGatewayAuth ? 'configured' : 'missing'}</span></td></tr>
      <tr><td style="border:none;color:#94a3b8">Owner Auth Bound</td><td style="border:none"><span class="badge \${d.hasMcpAuth ? 'HEALTHY' : 'DISABLED'}">\${d.hasMcpAuth ? 'configured' : 'missing'}</span></td></tr>
    </table>
  \`;
}

async function toggleProvider(id, enabled){
  await api('/admin/api/providers/'+id, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({enabled: !!enabled})});
  loadProviders();
  loadOverview();
}
async function testProvider(id){
  await api('/admin/api/providers/'+id+'/health-test', {method:'POST'});
  loadProviders();
  loadOverview();
}
async function rotateCred(id){
  const value = prompt('Paste the new API key for '+id+' (sent directly to Cloudflare, never stored in this app):');
  if(!value) return;
  const r = await api('/admin/api/providers/'+id+'/credential', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({value})});
  if(!r.ok) alert('Failed: '+r.error);
  loadProviders();
}
async function deleteCred(id){
  if(!confirm('Delete credential for '+id+'?')) return;
  const r = await api('/admin/api/providers/'+id+'/credential', {method:'DELETE'});
  if(!r.ok) alert('Failed: '+r.error);
  loadProviders();
}

loadOverview();
loadProviders();
</script>
</body></html>`;
}
