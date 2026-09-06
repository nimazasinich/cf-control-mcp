/**
 * v1.8.1 Admin Console — dashboard UI.
 * Single static HTML page, flat/bold design, vanilla JS calling /admin/api/*.
 * Model enable/disable, routing status, enriched overview.
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
:root{--bg:#0f172a;--panel:#1e293b;--border:#334155;--text:#f1f5f9;--muted:#94a3b8;--accent:#2563eb;--good:#16a34a;--bad:#dc2626;--warn:#d97706}
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0;min-width:900px}
header{display:flex;gap:8px;padding:12px 24px;border-bottom:2px solid var(--border);align-items:center;flex-wrap:wrap}
header h1{font-size:15px;margin:0 16px 0 0;white-space:nowrap}
nav button{background:none;border:2px solid transparent;color:var(--muted);padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:700;font-size:13px}
nav button.active{color:var(--text);border-color:var(--accent);background:var(--panel)}
main{padding:20px 24px}
.panel{display:none}
.panel.active{display:block}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:700;font-size:11px;text-transform:uppercase}
.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap}
.HEALTHY,.enabled,.active-route{background:var(--good)}
.NOT_CONFIGURED,.none{background:#475569}
.AUTH_ERROR,.UPSTREAM_ERROR,.bad{background:var(--bad)}
.RATE_LIMITED,.DEGRADED,.warn{background:var(--warn)}
.DISABLED,.disabled,.unavailable{background:#475569;opacity:.7}
.broken{background:var(--bad);opacity:.7}
button.btn{border:none;color:#fff;padding:5px 10px;border-radius:4px;cursor:pointer;font-weight:700;font-size:12px;margin-right:4px;white-space:nowrap}
button.btn:disabled{opacity:.5;cursor:not-allowed}
button.btn-primary{background:var(--accent)}
button.btn-danger{background:var(--bad)}
button.btn-warn{background:var(--warn)}
button.btn-neutral{background:#334155}
.notice{padding:8px 12px;border-radius:4px;font-size:12px;font-weight:700;margin:6px 0;display:none}
.notice.ok{background:rgba(22,163,74,.2);color:#4ade80;display:block}
.notice.err{background:rgba(220,38,38,.2);color:#f87171;display:block}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--panel);border:2px solid var(--border);border-radius:8px;padding:14px}
.stat-label{font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:4px}
.stat-value{font-size:26px;font-weight:700}
.stat-value.good{color:#4ade80}
.stat-value.bad{color:#f87171}
.stat-value.warn{color:#fbbf24}
input[type=password]{padding:6px;border-radius:4px;border:2px solid var(--border);background:var(--bg);color:var(--text);font-size:13px}
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
<div style="margin-left:auto">
<form method="POST" action="/admin/logout" style="display:inline">
<button class="btn btn-neutral" type="submit">Sign out</button>
</form>
</div>
</header>
<main>

<section id="overview" class="panel active">
  <div class="stat-grid">
    <div class="stat"><div class="stat-label">Providers</div><div id="stat-providers" class="stat-value">—</div></div>
    <div class="stat"><div class="stat-label">Enabled Providers</div><div id="stat-providers-enabled" class="stat-value good">—</div></div>
    <div class="stat"><div class="stat-label">Healthy</div><div id="stat-healthy" class="stat-value good">—</div></div>
    <div class="stat"><div class="stat-label">Total Models</div><div id="stat-models" class="stat-value">—</div></div>
    <div class="stat"><div class="stat-label">Available Models</div><div id="stat-models-enabled" class="stat-value good">—</div></div>
    <div class="stat"><div class="stat-label">Disabled Models</div><div id="stat-models-disabled" class="stat-value warn">—</div></div>
    <div class="stat"><div class="stat-label">Routing Rules</div><div id="stat-rules" class="stat-value">—</div></div>
    <div class="stat"><div class="stat-label">Active Aliases</div><div id="stat-routes-active" class="stat-value good">—</div></div>
    <div class="stat"><div class="stat-label">Unavailable Aliases</div><div id="stat-routes-unavail" class="stat-value warn">—</div></div>
  </div>
  <p id="overview-body" style="color:var(--muted);font-size:13px">Loading…</p>
</section>

<section id="providers" class="panel">
  <div id="providers-notice" class="notice"></div>
  <table>
    <thead><tr><th>Provider</th><th>Enabled</th><th>Health</th><th>BYOK Alias</th><th>Last check</th><th>Latency</th><th>Actions</th></tr></thead>
    <tbody id="providers-body"></tbody>
  </table>
</section>

<section id="models" class="panel">
  <div id="models-notice" class="notice"></div>
  <table>
    <thead><tr><th>Model ID</th><th>Provider</th><th>Public Alias</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody id="models-body"></tbody>
  </table>
</section>

<section id="routing" class="panel">
  <table>
    <thead><tr><th>Alias</th><th>Target Model</th><th>State</th><th>Updated At</th></tr></thead>
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
    <h3 style="margin:0 0 8px;font-size:14px">Audit Events</h3>
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
    <h3 style="margin:0 0 16px;font-size:14px">System Configuration</h3>
    <div id="settings-body">Loading…</div>
  </div>
</section>
</main>

<script>
// ---- tab navigation ----
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById(b.dataset.tab).classList.add('active');
  const loaders={providers:loadProviders,models:loadModels,routing:loadRouting,health:loadHealth,usage:loadUsage,logs:loadLogs,settings:loadSettings};
  if(loaders[b.dataset.tab]) loaders[b.dataset.tab]();
}));

// ---- helpers ----
async function api(path,opts={}){
  const r=await fetch(path,opts);
  return {status:r.status,data:await r.json()};
}

function showNotice(elId,msg,isErr){
  const el=document.getElementById(elId);
  if(!el)return;
  el.textContent=msg;
  el.className='notice '+(isErr?'err':'ok');
  setTimeout(()=>{el.className='notice';},4000);
}

// ---- overview ----
async function loadOverview(){
  const {data:d}=await api('/admin/api/overview');
  document.getElementById('stat-providers').textContent=d.providerCount??0;
  document.getElementById('stat-providers-enabled').textContent=d.enabledProviderCount??0;
  document.getElementById('stat-healthy').textContent=d.healthyCount??0;
  document.getElementById('stat-models').textContent=d.modelCount??0;
  document.getElementById('stat-models-enabled').textContent=d.enabledModelCount??0;
  document.getElementById('stat-models-disabled').textContent=d.disabledModelCount??0;
  document.getElementById('stat-rules').textContent=d.routingRuleCount??0;
  document.getElementById('stat-routes-active').textContent=d.activeRoutingCount??0;
  document.getElementById('stat-routes-unavail').textContent=d.unavailableRoutingCount??0;
  const unavail=d.unavailableRoutingCount??0;
  const disabledM=d.disabledModelCount??0;
  let status='System operational.';
  if(unavail>0) status+=' ⚠ '+unavail+' routing alias(es) unavailable.';
  if(disabledM>0) status+=' '+disabledM+' model(s) disabled.';
  document.getElementById('overview-body').textContent=status;
}

// ---- providers ----
async function loadProviders(){
  const {data:d}=await api('/admin/api/providers');
  const rows=(d.providers||[]).map(p=>\`<tr>
    <td><strong>\${p.display_name}</strong><br><small style="color:var(--muted)">\${p.id}</small></td>
    <td><span class="badge \${p.enabled?'enabled':'disabled'}">\${p.enabled?'enabled':'disabled'}</span></td>
    <td><span class="badge \${p.health_state}">\${p.health_state}</span></td>
    <td>\${p.byok_alias?\`<span class="badge HEALTHY">\${p.byok_alias}</span>\`:'<span class="badge none">none</span>'}</td>
    <td style="font-size:11px">\${p.last_success_at||(p.last_error_at||'—')}<br><span style="color:#f87171">\${p.last_error_message||''}</span></td>
    <td>\${p.last_latency_ms!=null?p.last_latency_ms+'ms':'—'}</td>
    <td>
      <button class="btn btn-primary" id="ptoggle-\${p.id}" onclick="toggleProvider('\${p.id}',\${p.enabled?0:1})">\${p.enabled?'Disable':'Enable'}</button>
      <button class="btn btn-neutral" onclick="testProvider('\${p.id}')">Test health</button>
      <button class="btn btn-warn" onclick="rotateCred('\${p.id}')">\${p.byok_alias?'Rotate':'Set'} key</button>
      \${p.byok_alias?\`<button class="btn btn-danger" onclick="deleteCred('\${p.id}')">Delete key</button>\`:''}
    </td>
  </tr>\`).join('');
  document.getElementById('providers-body').innerHTML=rows||'<tr><td colspan="7">No providers found.</td></tr>';
}

async function toggleProvider(id,enabled){
  const btn=document.getElementById('ptoggle-'+id);
  if(btn){btn.disabled=true;btn.textContent='…';}
  const {status,data}=await api('/admin/api/providers/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!!enabled})});
  if(status===200&&data.ok){
    showNotice('providers-notice','Provider '+(enabled?'enabled':'disabled')+': '+id,false);
  } else {
    showNotice('providers-notice','Error: '+(data.error||'unknown'),true);
  }
  await loadProviders();
  loadOverview();
}

async function testProvider(id){
  const {status,data}=await api('/admin/api/providers/'+id+'/health-test',{method:'POST'});
  if(status===200){showNotice('providers-notice','Health test for '+id+': '+data.state,data.state!=='HEALTHY');}
  else{showNotice('providers-notice','Error: '+(data.error||'unknown'),true);}
  loadProviders();
}

async function rotateCred(id){
  const value=prompt('Paste the new API key for '+id+'\\n(sent directly to Cloudflare, never stored here):');
  if(!value)return;
  const {status,data}=await api('/admin/api/providers/'+id+'/credential',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})});
  if(status===200&&data.ok){showNotice('providers-notice','Credential set for '+id+'. Health: '+data.healthState,false);}
  else{showNotice('providers-notice','Failed: '+(data.error||'unknown'),true);}
  loadProviders();
}

async function deleteCred(id){
  if(!confirm('Delete credential for '+id+'? This will disable provider functionality.'))return;
  const {status,data}=await api('/admin/api/providers/'+id+'/credential',{method:'DELETE'});
  if(status===200&&data.ok){showNotice('providers-notice','Credential deleted for '+id,false);}
  else{showNotice('providers-notice','Failed: '+(data.error||'unknown'),true);}
  loadProviders();
}

// ---- models ----
async function loadModels(){
  const {data:d}=await api('/admin/api/models');
  const rows=(d.models||[]).map(m=>{
    const enabled=!!m.enabled;
    return \`<tr>
      <td><code>\${m.id}</code></td>
      <td><small>\${m.provider_id}</small></td>
      <td>\${m.public_alias?\`<span class="badge HEALTHY">\${m.public_alias}</span>\`:'<span style="color:var(--muted)">—</span>'}</td>
      <td><span class="badge \${enabled?'enabled':'disabled'}">\${enabled?'active':'disabled'}</span></td>
      <td>
        <button class="btn \${enabled?'btn-danger':'btn-primary'}" id="mtoggle-\${m.id}"
          onclick="toggleModel('\${m.id}',\${enabled?0:1})">\${enabled?'Disable':'Enable'}</button>
      </td>
    </tr>\`;
  }).join('');
  document.getElementById('models-body').innerHTML=rows||'<tr><td colspan="5">No models registered.</td></tr>';
}

async function toggleModel(id,enabled){
  const btn=document.getElementById('mtoggle-'+id);
  if(btn){btn.disabled=true;btn.textContent='…';}
  const {status,data}=await api('/admin/api/models/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!!enabled})});
  if(status===200&&data.ok){
    const aliases=data.affectedAliases||[];
    let msg='Model '+(enabled?'enabled':'disabled')+': '+id;
    if(aliases.length>0) msg+=' | Affected aliases: '+aliases.join(', ');
    showNotice('models-notice',msg,false);
  } else {
    showNotice('models-notice','Error: '+(data.error||'unknown'),true);
  }
  await loadModels();
  loadRouting();
  loadOverview();
}

// ---- routing ----
function routeStatus(r){
  if(r.model_enabled==null) return {cls:'broken',label:'BROKEN — model missing'};
  if(!r.model_enabled) return {cls:'unavailable',label:'UNAVAILABLE — model disabled'};
  if(!r.provider_enabled) return {cls:'unavailable',label:'UNAVAILABLE — provider disabled'};
  return {cls:'active-route',label:'active'};
}

async function loadRouting(){
  const {data:d}=await api('/admin/api/routing');
  const rows=(d.rules||[]).map(r=>{
    const s=routeStatus(r);
    return \`<tr>
      <td><strong>\${r.public_alias}</strong></td>
      <td><code>\${r.model_id}</code>\${r.provider_id?'<br><small style="color:var(--muted)">via '+r.provider_id+'</small>':''}</td>
      <td><span class="badge \${s.cls}">\${s.label}</span></td>
      <td style="font-size:11px;color:var(--muted)">\${r.updated_at}</td>
    </tr>\`;
  }).join('');
  document.getElementById('routing-body').innerHTML=rows||'<tr><td colspan="4">No routing rules configured.</td></tr>';
}

// ---- health ----
async function loadHealth(){
  const {data:d}=await api('/admin/api/health');
  const rows=(d.checks||[]).map(c=>\`<tr>
    <td style="font-size:11px">\${c.checked_at}</td>
    <td>\${c.provider_id}</td>
    <td><span class="badge \${c.state}">\${c.state}</span></td>
    <td>\${c.latency_ms!=null?c.latency_ms+'ms':'—'}</td>
    <td style="font-size:11px;color:var(--muted)">\${c.error_message||'OK'}</td>
  </tr>\`).join('');
  document.getElementById('health-body').innerHTML=rows||'<tr><td colspan="5">No health check history recorded.</td></tr>';
}

// ---- usage ----
async function loadUsage(){
  const {data:d}=await api('/admin/api/usage');
  document.getElementById('usage-body').innerHTML=\`
    <p>Total recorded admin events: <strong>\${d.totalAuditEvents}</strong></p>
    <p style="color:var(--muted);font-size:12px">Real-time gateway usage is available in Cloudflare AI Gateway analytics.</p>
  \`;
}

// ---- logs ----
async function loadLogs(){
  const {data:d}=await api('/admin/api/logs');
  document.getElementById('logs-body').innerHTML=(d.events||[]).map(e=>\`<tr>
    <td style="font-size:11px;white-space:nowrap">\${e.at}</td>
    <td><code style="font-size:11px">\${e.action}</code></td>
    <td style="font-size:11px">\${e.target||'—'}</td>
    <td style="font-size:11px;color:var(--muted)">\${e.detail||'—'}</td>
  </tr>\`).join('')||'<tr><td colspan="4">No events recorded.</td></tr>';
}

// ---- settings ----
async function loadSettings(){
  const {data:d}=await api('/admin/api/settings');
  document.getElementById('settings-body').innerHTML=\`
    <table style="border:none;font-size:13px">
      <tr><td style="border:none;color:var(--muted);padding:6px 12px 6px 0">Version</td><td style="border:none"><strong>v\${d.version}</strong></td></tr>
      <tr><td style="border:none;color:var(--muted);padding:6px 12px 6px 0">Gateway Slug</td><td style="border:none"><code>\${d.gatewaySlug}</code></td></tr>
      <tr><td style="border:none;color:var(--muted);padding:6px 12px 6px 0">Account ID</td><td style="border:none"><code>\${d.accountIdMasked}</code></td></tr>
      <tr><td style="border:none;color:var(--muted);padding:6px 12px 6px 0">Metadata Store</td><td style="border:none"><code>\${d.d1Database} (D1)</code></td></tr>
      <tr><td style="border:none;color:var(--muted);padding:6px 12px 6px 0">CF Token</td><td style="border:none"><span class="badge \${d.hasCfToken?'HEALTHY':'DISABLED'}">\${d.hasCfToken?'configured':'missing'}</span></td></tr>
      <tr><td style="border:none;color:var(--muted);padding:6px 12px 6px 0">Gateway Auth</td><td style="border:none"><span class="badge \${d.hasGatewayAuth?'HEALTHY':'DISABLED'}">\${d.hasGatewayAuth?'configured':'missing'}</span></td></tr>
      <tr><td style="border:none;color:var(--muted);padding:6px 12px 6px 0">Owner Auth</td><td style="border:none"><span class="badge \${d.hasMcpAuth?'HEALTHY':'DISABLED'}">\${d.hasMcpAuth?'configured':'missing'}</span></td></tr>
    </table>
  \`;
}

loadOverview();
loadProviders();
</script>
</body></html>`;
}
