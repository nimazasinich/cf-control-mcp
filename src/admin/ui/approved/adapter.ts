/**
 * Live backend adapter for the approved 1368x753 Admin pages.
 *
 * This script is APPENDED to an approved document, immediately before
 * </body>. It never rewrites the approved markup, CSS, or inline script: it
 * only attaches to the integration hooks the approved pages already expose
 * (window.DreamWorker*UI / DreamWorker*Adapter) and fills in real values from
 * the Admin API.
 *
 * Because it is purely additive, stripping this block from a served page
 * returns the approved reference document byte for byte.
 */

const HELPERS = String.raw`
var DW = {};
DW.esc = function (v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};
DW._requestState = { pending: 0, lastError: null };
DW._setRuntimeFeedback = function (state, text, detail) {
  var el = document.getElementById('dw-runtime-feedback');
  if (!el) return;
  el.className = 'dw-runtime-feedback ' + (state || 'idle');
  var label = el.querySelector('[data-dw-feedback-label]');
  var meta = el.querySelector('[data-dw-feedback-meta]');
  if (label) label.textContent = text || 'Admin API';
  if (meta) meta.textContent = detail || '';
};
DW._requestBegin = function (label) {
  if (DW._requestState.pending === 0) DW._requestState.lastError = null;
  DW._requestState.pending += 1;
  DW._setRuntimeFeedback('busy', label || 'Syncing Admin API…', DW._requestState.pending + ' request' + (DW._requestState.pending === 1 ? '' : 's') + ' in flight');
};
DW._requestFinish = function (ok, label, detail) {
  DW._requestState.pending = Math.max(0, DW._requestState.pending - 1);
  if (!ok) {
    DW._requestState.lastError = detail || 'Request failed';
    DW._setRuntimeFeedback('error', label || 'Admin API request failed', detail || 'Check the current page for details.');
    return;
  }
  if (DW._requestState.lastError) {
    DW._setRuntimeFeedback('error', 'Some Admin API work failed', DW._requestState.lastError);
    return;
  }
  if (DW._requestState.pending > 0) {
    DW._setRuntimeFeedback('busy', 'Syncing Admin API…', DW._requestState.pending + ' request' + (DW._requestState.pending === 1 ? '' : 's') + ' in flight');
    return;
  }
  DW._setRuntimeFeedback('ready', label || 'Admin API synced', detail || 'Authoritative state loaded just now');
};
DW.get = async function (path) {
  DW._requestBegin('Loading authoritative state…');
  try {
    var res = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 401) { window.location.replace('/admin/login'); throw new Error('unauthorized'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    DW._requestFinish(true, 'Admin API synced', 'Loaded ' + path);
    return data;
  } catch (err) {
    DW._requestFinish(false, 'Admin API request failed', String((err && err.message) || err));
    throw err;
  }
};
DW.send = async function (path, method, body) {
  DW._requestBegin('Applying change…');
  try {
    var init = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    var res = await fetch(path, init);
    if (res.status === 401) { window.location.replace('/admin/login'); throw new Error('unauthorized'); }
    var data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    DW._requestFinish(true, 'Change saved', method + ' ' + path);
    return data;
  } catch (err) {
    DW._requestFinish(false, 'Change failed', String((err && err.message) || err));
    throw err;
  }
};
DW.text = function (id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
};
DW.rel = function (value) {
  if (!value) return '—';
  var raw = String(value);
  var d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return raw;
  var ms = Date.now() - d.getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.max(1, Math.floor(ms / 60000)) + 'm ago';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
DW.ms = function (value) {
  return value == null ? '—' : Number(value) + ' ms';
};
DW.disable = function (target, reason) {
  var els = typeof target === 'string' ? document.querySelectorAll(target) : (target ? [target] : []);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if ('disabled' in el) el.disabled = true;
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('title', reason || 'Unavailable in the current Admin backend.');
    el.style.opacity = '0.48';
    el.style.cursor = 'not-allowed';
  }
};
DW.empty = function (container, title, detail) {
  if (!container) return;
  container.innerHTML = '<div data-runtime-empty="true" style="min-height:92px;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;color:#6f83ad">' +
    '<div><strong style="display:block;color:#183b70;font-size:12px;margin-bottom:5px">' + DW.esc(title) + '</strong>' +
    '<span style="font-size:9px">' + DW.esc(detail || '') + '</span></div></div>';
};
DW.backendState = function (el, text, ok) {
  if (!el) return;
  var span = el.querySelector('span');
  if (span) span.textContent = text;
  else el.textContent = text;
  el.classList.toggle('connected', !!ok);
};
DW.toast = function (message, type, title) {
  var stack = document.getElementById('dw-live-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'dw-live-toast-stack';
    stack.className = 'dw-live-toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  var toast = document.createElement('div');
  toast.className = 'dw-live-toast ' + (type || 'info');
  toast.innerHTML = '<i></i><div><strong>' + DW.esc(title || 'Admin') + '</strong><span>' + DW.esc(message || '') + '</span></div>';
  stack.appendChild(toast);
  window.requestAnimationFrame(function () { toast.classList.add('show'); });
  window.setTimeout(function () {
    toast.classList.remove('show');
    window.setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 180);
  }, type === 'error' ? 4200 : 2600);
};
DW.installRuntimeFeedback = function () {
  if (document.getElementById('dw-runtime-feedback')) return;
  var el = document.createElement('div');
  el.id = 'dw-runtime-feedback';
  el.className = 'dw-runtime-feedback idle';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<i></i><div><strong data-dw-feedback-label>Admin API</strong><span data-dw-feedback-meta>Waiting for page data</span></div>';
  document.body.appendChild(el);
  window.addEventListener('offline', function () { DW._setRuntimeFeedback('error', 'Browser offline', 'Network access is unavailable'); });
  window.addEventListener('online', function () {
    if (DW._requestState.pending > 0) DW._setRuntimeFeedback('busy', 'Syncing Admin API…', DW._requestState.pending + ' request(s) in flight');
    else DW._setRuntimeFeedback('idle', 'Network restored', 'Reload or refresh this page to re-check state');
  });
};
DW.NAV_PATHS = {
  overview: '/admin',
  providers: '/admin/providers',
  models: '/admin/models',
  'mcp-tools': '/admin/tools',
  routing: '/admin/routing',
  health: '/admin/health',
  usage: '/admin/usage',
  audit: '/admin/audit',
  settings: '/admin/settings',
};
DW.wireNav = function () {
  DW.injectLiveStyles();
  DW.installRuntimeFeedback();
  // The approved reference contains display-only environment/identity chrome.
  // Replace it before live data arrives so the browser never asserts fake runtime state.
  var prod = document.querySelector('.prod');
  if (prod) {
    for (var pi = 0; pi < prod.childNodes.length; pi++) {
      var pn = prod.childNodes[pi];
      if (pn.nodeType === 3 && String(pn.nodeValue || '').trim()) { pn.nodeValue = ' Admin session '; break; }
    }
    prod.setAttribute('title', 'Authenticated Admin UI; deployment environment is not asserted by the browser.');
  }
  var notificationBadge = document.querySelector('.head-right .hicon .badge');
  if (notificationBadge) notificationBadge.style.display = 'none';
  var identity = document.querySelector('.headuser small');
  if (identity) identity.textContent = 'Owner session';
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest('[data-nav]') : null;
    if (!el) return;
    var path = DW.NAV_PATHS[el.dataset.nav];
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    window.location.assign(path);
  }, true);
};
DW.wireCommandPalette = function () {
  window.DreamWorkerDashboardAdapter = {
    navigate: function (target) {
      var path = DW.NAV_PATHS[target];
      if (path) window.location.assign(path);
    },
  };
  // The approved reference contains local-preview command actions. The live
  // Admin palette is navigation-only until those actions have real API routes.
  var results = document.getElementById('command-results');
  if (!results || results.dataset.livePruned === 'true') return;
  results.dataset.livePruned = 'true';
  var pruning = false;
  function prunePreviewActions() {
    if (pruning) return;
    pruning = true;
    try {
      [].slice.call(results.querySelectorAll('.command-item[data-command-type="action"]')).forEach(function (item) { item.remove(); });
      [].slice.call(results.querySelectorAll('.command-group-label')).forEach(function (label) {
        if (String(label.textContent || '').trim().toLowerCase() === 'actions') label.remove();
      });
      if (!results.querySelector('.command-item') && !results.querySelector('.command-empty')) {
        results.innerHTML = '<div class="command-empty">No matching Admin pages.</div>';
      }
    } finally { pruning = false; }
  }
  var observer = new MutationObserver(prunePreviewActions);
  observer.observe(results, { childList: true, subtree: true });
  prunePreviewActions();
};
DW.wireLogout = function () {
  var forms = document.querySelectorAll('#logout-form');
  for (var i = 0; i < forms.length; i++) {
    forms[i].setAttribute('action', '/admin/logout');
    forms[i].setAttribute('method', 'POST');
  }
};
DW.injectLiveStyles = function () {
  if (document.getElementById('dw-live-backend-style')) return;
  var style = document.createElement('style');
  style.id = 'dw-live-backend-style';
  style.textContent = [
    'html,body{overscroll-behavior:none}',
    '.app,.stage{isolation:isolate}',
    '.main,.panel,.card,.metric,.prov,.hrow,.aevent,.provider-cell,.event-cell,.tool-ident,.catalog-model-ident,.alias-node>span,.target-node>span,.inspector-grid>div{min-width:0}',
    '.search input,#dashboard-search,#provider-search-input,#model-search-input-v2,#mcp-tool-search,#audit-search-input{min-width:0}',
    '.mvalue,.msub,.pname,.modelbadge,.pstat b,.pstat small,.hcomp,.hcomp span,.hstatus,.hlat,.aevent b,.aevent span,.provider-cell strong,.provider-cell small,.catalog-model-ident strong,.catalog-model-ident small,.tool-ident strong,.tool-ident small,.event-primary strong,.event-primary small,.event-cell,.event-time,.alias-node strong,.alias-node small,.target-node strong,.target-node small,.rule-route strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#provider-table-body,#catalog-model-list,#mcp-tool-list,#audit-event-list{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#aac3df transparent}',
    '#provider-table-body::-webkit-scrollbar,#catalog-model-list::-webkit-scrollbar,#mcp-tool-list::-webkit-scrollbar,#audit-event-list::-webkit-scrollbar,.tool-inspector-body::-webkit-scrollbar,.audit-inspector-body::-webkit-scrollbar{width:6px;height:6px}',
    '#provider-table-body::-webkit-scrollbar-thumb,#catalog-model-list::-webkit-scrollbar-thumb,#mcp-tool-list::-webkit-scrollbar-thumb,#audit-event-list::-webkit-scrollbar-thumb,.tool-inspector-body::-webkit-scrollbar-thumb,.audit-inspector-body::-webkit-scrollbar-thumb{background:#b7cce4;border-radius:999px}',
    '#provider-table-body{display:block;max-height:336px;padding-right:4px}',
    '.provider-row{width:100%;grid-template-columns:minmax(0,1.52fr) minmax(72px,.72fr) minmax(70px,.72fr) minmax(58px,.58fr) minmax(62px,.62fr) minmax(70px,.72fr) minmax(70px,.72fr) minmax(64px,.64fr);gap:7px}',
    '.provider-row .provider-ident>div,.provider-row .provider-ident span:last-child{min-width:0}',
    '.provider-row .row-action{white-space:nowrap}',
    '.provider-table-head,.provider-row{grid-template-columns:66px minmax(0,1.5fr) minmax(96px,.8fr) minmax(118px,1fr) minmax(76px,.62fr) minmax(66px,.58fr) 58px minmax(126px,1fr)!important;gap:7px}',
    '.priority-cell{display:flex;align-items:center;gap:4px}.priority-rank{font-size:8px;color:#6980a8;min-width:19px}.priority-btn,.provider-test-btn,.provider-key-btn{height:24px;min-width:24px;border:1px solid #d5e2ef;background:#fff;border-radius:7px;color:#365c91;font-size:9px;display:inline-grid;place-items:center;cursor:pointer}.priority-btn:hover,.provider-test-btn:hover,.provider-key-btn:hover{border-color:#a9c7e8;background:#f7fbff}.priority-btn:disabled,.provider-test-btn:disabled,.provider-key-btn:disabled{opacity:.42;cursor:not-allowed}',
    '.provider-auth small,.provider-network small{display:block;margin-top:2px;color:#8395b3;font-size:7.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.provider-network strong{font-size:9px}.provider-network.verified strong{color:#0c9660}.provider-network.pending strong{color:#9b701f}.provider-network.error strong{color:#a95361}',
    '.provider-actions{display:flex;align-items:center;gap:4px}.provider-actions .row-action{height:24px;padding:0 8px}',
    '.dw-modal-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(10,28,61,.22);backdrop-filter:blur(3px);display:grid;place-items:center}.dw-modal{width:468px;max-height:680px;overflow:auto;background:#fff;border:1px solid #d8e5f2;border-radius:16px;box-shadow:0 28px 70px rgba(17,45,85,.2);padding:18px}.dw-modal-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px}.dw-modal-head h3{margin:0;color:#0d285b;font-size:15px}.dw-modal-head p{margin:4px 0 0;color:#7b8eae;font-size:8.5px}.dw-modal-close{border:0;background:#f3f7fb;color:#587096;width:28px;height:28px;border-radius:8px;cursor:pointer}.dw-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dw-field{display:flex;flex-direction:column;gap:4px}.dw-field.full{grid-column:1/-1}.dw-field label{font-size:8px;color:#56719a;font-weight:650}.dw-field input,.dw-field select{height:34px;border:1px solid #d5e2ef;border-radius:8px;padding:0 10px;color:#173761;background:#fbfdff;font-size:9.5px;outline:none}.dw-field input:focus,.dw-field select:focus{border-color:#7fb6ed;box-shadow:0 0 0 3px rgba(55,137,224,.08)}.dw-field small{font-size:7.5px;color:#8a9ab5;line-height:1.35}.dw-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.dw-modal-actions button{height:32px;border-radius:8px;padding:0 13px;border:1px solid #d5e2ef;background:#fff;color:#45658e;font-size:9px;cursor:pointer}.dw-modal-actions .primary{background:#176fe6;color:#fff;border-color:#176fe6}.dw-form-error{margin-top:10px;color:#b4505e;background:#fff3f4;border:1px solid #f1d4d9;border-radius:8px;padding:8px;font-size:8px;display:none}',
    '.dw-field textarea{min-height:92px;resize:vertical;border:1px solid #d5e2ef;border-radius:8px;padding:9px 10px;color:#173761;background:#fbfdff;font-family:inherit;font-size:9.5px;line-height:1.45;outline:none}.dw-field textarea:focus{border-color:#7fb6ed;box-shadow:0 0 0 3px rgba(55,137,224,.08)}.dw-field .dw-char-count{margin-left:auto;font-variant-numeric:tabular-nums}.dw-field .dw-char-count.warn{color:#a96e1b}',
    '.dw-runtime-feedback{position:fixed;right:18px;bottom:16px;z-index:9800;display:flex;align-items:center;gap:8px;min-width:168px;max-width:290px;padding:8px 10px;border:1px solid #d7e3f0;border-radius:11px;background:rgba(255,255,255,.94);box-shadow:0 12px 32px rgba(25,55,91,.13);backdrop-filter:blur(8px);pointer-events:none;transition:transform .18s ease,opacity .18s ease,border-color .18s ease}.dw-runtime-feedback>i{width:8px;height:8px;border-radius:50%;background:#97a9bf;box-shadow:0 0 0 4px rgba(151,169,191,.11);flex:none}.dw-runtime-feedback>div{min-width:0}.dw-runtime-feedback strong,.dw-runtime-feedback span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dw-runtime-feedback strong{font-size:8.5px;color:#284d7f}.dw-runtime-feedback span{margin-top:1px;font-size:6.8px;color:#8191aa}.dw-runtime-feedback.busy>i{background:#2b79ef;box-shadow:0 0 0 4px rgba(43,121,239,.11);animation:dwPulse 1.05s ease-in-out infinite}.dw-runtime-feedback.ready>i{background:#12ad69;box-shadow:0 0 0 4px rgba(18,173,105,.11)}.dw-runtime-feedback.error{border-color:#efcfd5}.dw-runtime-feedback.error>i{background:#d45b69;box-shadow:0 0 0 4px rgba(212,91,105,.10)}',
    '.dw-live-toast-stack{position:fixed;right:18px;bottom:65px;z-index:9900;width:310px;display:flex;flex-direction:column;gap:7px;pointer-events:none}.dw-live-toast{display:flex;align-items:flex-start;gap:8px;padding:10px 11px;border:1px solid #d9e5f2;border-radius:11px;background:rgba(255,255,255,.97);box-shadow:0 15px 36px rgba(23,54,91,.15);transform:translateY(8px);opacity:0;transition:transform .18s ease,opacity .18s ease}.dw-live-toast.show{transform:translateY(0);opacity:1}.dw-live-toast>i{width:8px;height:8px;margin-top:3px;border-radius:50%;background:#2b79ef;flex:none}.dw-live-toast.success>i{background:#12ad69}.dw-live-toast.error>i{background:#d45b69}.dw-live-toast>div{min-width:0}.dw-live-toast strong,.dw-live-toast span{display:block}.dw-live-toast strong{font-size:8px;color:#244a7d}.dw-live-toast span{margin-top:2px;font-size:7px;line-height:1.35;color:#7185a6;overflow-wrap:anywhere}',
    '.model-metadata-live{margin:9px 0 11px;padding:9px 10px;border:1px solid #e0e9f2;border-radius:9px;background:#f8fbfe}.model-metadata-live b{display:block;font-size:7.5px;color:#315786;margin-bottom:4px}.model-metadata-live p{margin:0;color:#7588a8;font-size:7px;line-height:1.45;max-height:42px;overflow:auto;overflow-wrap:anywhere}.model-metadata-live code{display:block;margin-top:5px;color:#59749e;font:6.8px ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-inspector .inspector-actions #inspector-metadata{grid-column:1/-1}',
    '@keyframes dwPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.72);opacity:.56}}',
    '@media(prefers-reduced-motion:reduce){.dw-runtime-feedback.busy>i{animation:none}.dw-live-toast,.dw-runtime-feedback{transition:none}}',
    '.healthy,.hstatus,.allhealthy{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.healthy.warn,.hstatus.warn{color:#9a6a16}.healthy.warn i,.hstatus.warn i,.allhealthy.warn i{background:#d79c2e}.healthy.disabled,.hstatus.disabled{color:#7889a6}.healthy.disabled i,.hstatus.disabled i,.allhealthy.disabled i{background:#9aa9bd}.allhealthy.warn{background:#fff8e7;color:#946917}.allhealthy.disabled{background:#f1f5fa;color:#667997}',
    '.status-pill,.runtime-state,.readiness-v2,.tool-mode,.tool-guard,.tool-protocol,.target-status,.route-status-pill,.audit-family-pill{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
    '#catalog-model-list{max-height:333px;padding-right:4px}',
    '.catalog-model{width:100%;grid-template-columns:minmax(0,1.72fr) minmax(74px,.72fr) minmax(92px,.9fr) minmax(74px,.72fr);gap:7px}',
    '.catalog-model.generic .catalog-model-icon{background:#f1f5fa;color:#607ca9}',
    '.alias-chip-v2{display:inline-flex;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mcp-tool-list{height:350px;overflow-y:auto;padding-right:4px}',
    '.mcp-tool-row{width:100%;grid-template-columns:minmax(0,2.05fr) minmax(54px,.56fr) minmax(82px,.92fr) minmax(62px,.65fr);gap:7px}',
    '.tool-ident>span:last-child{min-width:0}',
    '.tool-glyph.cloudflare{background:#fff4eb;color:#f38020}.tool-glyph.huggingface{background:#fff8df;color:#b77900}.tool-glyph.internet{background:#edf7ff;color:#176fe6}.tool-glyph.execution{background:#eef0ff;color:#5965d5}.tool-glyph.proxyharvest{background:#eaf9f3;color:#0b9b61}.tool-glyph.mcp{background:#f1f5fa;color:#607ca9}',
    '.tool-mode.mixed,.inspector-mode.mixed{background:#f1f5fa;color:#61789d}.tool-mode.exec,.inspector-mode.exec{background:#eef0ff;color:#5965d5}.tool-mode.danger,.inspector-mode.danger{background:#fff0f1;color:#a84e5a}.tool-guard.open{background:#fff7e4;color:#926a15}.tool-guard.danger{background:#fff0f1;color:#a84e5a}.tool-guard.shield{background:#eaf9f3;color:#0a925a}',
    '.schema-preview,.schema-preview code,.annotation-box,.audit-detail-box,.audit-detail-box code{max-width:100%;overflow-wrap:anywhere;word-break:break-word}',
    '.tool-inspector-body,.audit-inspector-body{overflow:auto;overscroll-behavior:contain}',
    '.topology-column{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;padding-right:3px}',
    '.alias-node,.target-node{width:calc(100% - 3px);margin-bottom:8px}',
    '.alias-node.broken .node-state{background:#d79c2e;box-shadow:0 0 0 3px rgba(215,156,46,.08)}',
    '.alias-node.broken{background:#fffdf8;border-color:#efd9aa}',
    '.target-node .target-status{justify-self:end}.target-status.callable,.route-status-pill.callable{background:#e9faf2;color:#0a925a}.target-status.callable i{background:#11aa69}.target-status.blocked,.route-status-pill.blocked{background:#fff7e4;color:#926a15}.target-status.blocked i{background:#d79c2e}',
    '.rules-strip-body,.routing-rules-strip,.rules-strip{overflow-x:auto;scrollbar-width:thin}',
    '#audit-event-list{padding-right:4px}',
    '.audit-event-row{width:100%;grid-template-columns:minmax(0,1.5fr) minmax(64px,.5fr) minmax(0,.78fr) minmax(54px,.42fr);gap:8px}',
    '.audit-inspector-head>div:nth-child(2),.tool-inspector-head>div:nth-child(2),.route-inspector-head>div:nth-child(2){min-width:0}',
    '.audit-inspector-head h2,.tool-inspector-head h2,.route-inspector-head h2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}',
    '.history-empty.history-live-list{position:absolute;left:8px;right:8px;top:8px;bottom:8px;transform:none;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:5px;overflow:auto;color:#173d79}',
    '.history-empty.history-live-list .state-option{width:100%;flex:none}.history-empty.history-live-list .state-option span{min-width:0}.history-empty.history-live-list .state-option strong,.history-empty.history-live-list .state-option small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.login-card{min-width:0}.input-shell input{min-width:0}.social,.signin{min-width:0;white-space:nowrap}.form-feedback{max-width:100%;overflow-wrap:anywhere}',
    '.toast{max-width:330px;overflow:hidden}',
    /* Visual refinement layer: keeps the approved structure but strengthens hierarchy, depth and interaction feedback. */
    ':root{--dw-elev-1:0 8px 24px rgba(26,62,103,.075);--dw-elev-2:0 18px 48px rgba(20,54,96,.11);--dw-elev-3:0 28px 80px rgba(12,42,82,.16);--dw-focus:0 0 0 3px rgba(30,112,237,.12);--dw-glow:0 0 0 1px rgba(34,141,236,.04),0 12px 28px rgba(28,88,154,.08)}',
    '.viewport{background:radial-gradient(900px 430px at 18% 8%,rgba(44,145,239,.11),transparent 64%),radial-gradient(700px 360px at 88% 90%,rgba(41,213,180,.08),transparent 62%),linear-gradient(180deg,#f5f9fd 0%,#e9f1f8 100%)}',
    '.app{box-shadow:0 34px 90px rgba(17,48,86,.20),0 0 0 1px rgba(122,161,202,.11);background:linear-gradient(180deg,#fbfdff 0%,#f7faff 100%)}',
    '.sidebar{background:radial-gradient(260px 480px at 112% 28%,rgba(42,143,236,.24),transparent 61%),radial-gradient(230px 280px at 18% 92%,rgba(31,211,180,.09),transparent 68%),linear-gradient(180deg,#0b2d60 0%,#082650 52%,#061c3c 100%)!important;box-shadow:18px 0 42px rgba(14,43,80,.14)!important}',
    '.brand-mark-shell,.dw-mark{filter:drop-shadow(0 8px 16px rgba(13,115,210,.24))}',
    '.nav-item{transition:background .18s ease,border-color .18s ease,transform .18s ease,box-shadow .18s ease!important}',
    '.nav-item:hover:not(.active){transform:translateX(2px);background:linear-gradient(90deg,rgba(255,255,255,.075),rgba(255,255,255,.025))!important;border-color:rgba(133,192,239,.12)!important}',
    '.nav-item.active{box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 26px rgba(0,79,174,.22)!important;background:linear-gradient(90deg,rgba(31,106,222,.92),rgba(28,110,205,.54))!important}',
    '.nav-item.active:before{box-shadow:0 0 14px rgba(29,224,178,.68)!important}',
    '.header{background:rgba(255,255,255,.965)!important;backdrop-filter:blur(14px);box-shadow:0 7px 24px rgba(34,71,110,.055)!important;border-bottom-color:#dbe7f2!important}',
    '.search,.global-search{transition:border-color .18s ease,background .18s ease,box-shadow .18s ease!important;background:linear-gradient(180deg,#fbfdff,#f7fbff)!important}',
    '.search:focus-within,.global-search:focus-within{border-color:#9fc5ee!important;background:#fff!important;box-shadow:var(--dw-focus)!important}',
    '.hicon,.headuser,.prod{transition:border-color .16s ease,background .16s ease,box-shadow .16s ease,transform .16s ease}',
    '.hicon:hover{border-color:#bfd4e9!important;background:#f8fbff!important;transform:translateY(-1px);box-shadow:0 7px 16px rgba(31,72,116,.07)}',
    '.avatar{box-shadow:0 7px 15px rgba(26,115,207,.17),inset 0 1px 0 rgba(255,255,255,.22)}',
    '.main{background:radial-gradient(760px 330px at 80% -12%,rgba(40,153,231,.055),transparent 70%),linear-gradient(180deg,#fbfdff,#f7faff)!important}',
    '.hero,.providers-hero,.models-hero-v2,.mcp-hero,.routing-hero,.health-hero,.audit-hero,.settings-hero{border-color:#d8e6f2!important;box-shadow:var(--dw-elev-1)!important;background:radial-gradient(430px 130px at 88% 8%,rgba(38,177,224,.13),transparent 70%),linear-gradient(135deg,#ffffff 0%,#f8fbff 68%,#f4faff 100%)!important}',
    '.hero:before,.providers-hero:before,.models-hero-v2:before,.mcp-hero:before,.routing-hero:before,.health-hero:before,.audit-hero:before,.settings-hero:before{content:\'\';position:absolute;left:0;top:0;width:100%;height:2px;background:linear-gradient(90deg,#176ff2 0%,#20bce8 48%,#29d5b4 100%);opacity:.82}',
    '.hero h1,.providers-hero h1,.models-hero-v2 h1,.mcp-hero h1,.routing-hero h1,.health-hero h1,.audit-hero h1,.settings-hero h1{letter-spacing:-.72px;text-shadow:0 1px 0 rgba(255,255,255,.8)}',
    '.hero-art,.providers-hero-wave,.models-hero-wave-v2,.mcp-hero-wave,.routing-hero-wave,.health-hero-wave,.audit-hero-wave,.settings-hero-wave{filter:saturate(1.08) contrast(1.02)}',
    '.card,.panel,.provider-metric,.model-overview-card,.environment-card,.audit-summary-card{border-color:#dce7f2!important;box-shadow:var(--dw-elev-1)!important;transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease}',
    '.card:hover,.provider-metric:hover,.model-overview-card:hover,.environment-card:hover,.audit-summary-card:hover{border-color:#cfdeed!important;box-shadow:var(--dw-glow)!important}',
    '.metric{border-color:#dce7f2!important;box-shadow:var(--dw-elev-1)!important;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}',
    '.metric:hover{transform:translateY(-2px);border-color:#c8dcec!important;box-shadow:0 14px 30px rgba(26,70,115,.095)!important}',
    '.metric:after,.provider-metric:after,.model-overview-card:after,.audit-summary-card:after{content:\'\';position:absolute;left:13px;right:13px;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(40,130,223,.18),transparent)}',
    '.btn,.action,.row-action,.add-provider-btn,.register-model-btn-v2,.simulate-route-btn,.edit-rule-btn,.run-health-preview-btn,.audit-refresh-btn,.settings-refresh-btn,.preview-invoke-btn,.copy-schema-btn{transition:transform .16s ease,border-color .16s ease,background .16s ease,box-shadow .16s ease!important}',
    '.btn:hover:not(:disabled),.action:hover:not([aria-disabled=true]),.row-action:hover:not(:disabled),.add-provider-btn:hover,.register-model-btn-v2:hover,.simulate-route-btn:hover,.edit-rule-btn:hover,.run-health-preview-btn:hover,.audit-refresh-btn:hover,.settings-refresh-btn:hover,.preview-invoke-btn:hover,.copy-schema-btn:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(25,73,124,.09)!important}',
    'button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:none!important;box-shadow:var(--dw-focus)!important;border-color:#7eb3e8!important}',
    '.status-pill,.runtime-state,.readiness-v2,.route-status-pill,.live-status-badge,.state,.tool-mode,.tool-guard,.audit-family-pill,.settings-source-chip{box-shadow:inset 0 1px 0 rgba(255,255,255,.58)}',
    '.provider-table-shell,.models-catalog,.tool-workbench,.topology-card,.health-monitor-card,.health-history-card,.audit-ledger-card,.settings-index,.settings-detail-pane{box-shadow:0 10px 30px rgba(29,67,108,.065)!important;border-color:#dbe7f2!important}',
    '.provider-table-head,.catalog-list-head,.tool-list-head,.ledger-table-head{background:linear-gradient(180deg,#fbfdff,#f5f9fd)!important;border-bottom-color:#dfe9f3!important;color:#59749f!important}',
    '.provider-row,.catalog-model,.mcp-tool-row,.audit-event-row,.state-option,.settings-index-item,.rule-card,.alias-node,.target-node{transition:background .15s ease,border-color .15s ease,box-shadow .15s ease,transform .15s ease}',
    '.provider-row:hover,.catalog-model:hover,.mcp-tool-row:hover,.audit-event-row:hover,.state-option:hover,.settings-index-item:hover,.rule-card:hover,.alias-node:hover,.target-node:hover{background:#f7fbff!important}',
    '.provider-row:hover,.audit-event-row:hover{box-shadow:inset 3px 0 0 rgba(34,124,224,.24)}',
    '.provider-logo,.catalog-model-icon,.tool-glyph,.inspector-icon,.route-inspector-icon,.audit-inspector-icon,.settings-index-icon,.environment-card-icon{box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 6px 14px rgba(35,79,124,.08)}',
    '.provider-metrics,.model-overview-grid,.audit-summary-grid{gap:11px!important}',
    '.provider-metric,.model-overview-card,.audit-summary-card{position:relative;overflow:hidden}',
    '.provider-row.disabled-row{filter:saturate(.72);opacity:.72}',
    '.provider-row.disabled-row:hover{opacity:.88}',
    '.catalog-model.selected,.mcp-tool-row.selected,.audit-event-row.selected,.settings-index-item.active,.rule-card.selected,.alias-node.selected,.target-node.selected{background:linear-gradient(90deg,#f0f7ff,#f8fcff)!important;border-color:#afd0ef!important;box-shadow:inset 3px 0 0 #2479e6,0 7px 18px rgba(38,99,163,.07)!important}',
    '.model-inspector,.tool-inspector-pane,.route-inspector,.audit-inspector,.settings-detail-pane{background:radial-gradient(340px 180px at 100% 0%,rgba(39,150,228,.055),transparent 72%),#fff!important}',
    '.inspector-head,.tool-inspector-head,.route-inspector-head,.audit-inspector-head,.settings-detail-head{background:linear-gradient(180deg,#fcfeff,#f8fbfe)!important;border-bottom-color:#dfe8f2!important}',
    '.fact-grid>div,.audit-fact-grid>div,.health-fact-grid>div,.session-policy-grid>div{background:linear-gradient(180deg,#fbfdff,#f7faff)!important;border-color:#e0eaf4!important}',
    '.runtime-chain-step,.contract-stage,.resolution-step,.protocol-stage,.audit-lineage-stage,.blueprint-node{box-shadow:inset 0 1px 0 rgba(255,255,255,.7);transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}',
    '.runtime-chain-step.done,.contract-stage.done,.protocol-stage.done,.audit-lineage-stage.done,.blueprint-node.done{box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 5px 12px rgba(15,155,100,.06)}',
    '.tool-scope-rail,.topology-column,.health-state-lab,.settings-index{background:linear-gradient(180deg,#fbfdff,#f8fbfe)!important}',
    '.scope-item.active{background:linear-gradient(90deg,#eff7ff,#f7fbff)!important;border-color:#b9d6f0!important;box-shadow:inset 3px 0 0 #2479e6}',
    '.schema-preview,.schema{background:linear-gradient(180deg,#f8fbfe,#f3f7fb)!important;border-color:#dce7f2!important;box-shadow:inset 0 1px 0 #fff}',
    '.resolver-card{box-shadow:0 14px 32px rgba(31,89,150,.11)!important;border-color:#cfe0ef!important;background:radial-gradient(190px 120px at 50% 0%,rgba(37,137,230,.10),transparent 75%),linear-gradient(180deg,#fff,#f7fbff)!important}',
    '.resolver-halo{filter:drop-shadow(0 0 14px rgba(37,133,230,.16))}',
    '.provider-gate{background:linear-gradient(180deg,#fbfefd,#f2fbf7)!important;border-color:#cae9dc!important}',
    '.health-radar-panel{background:radial-gradient(circle at 48% 48%,rgba(32,188,232,.085),transparent 35%),linear-gradient(180deg,#fbfeff,#f5faff)!important}',
    '.radar-core{filter:drop-shadow(0 0 18px rgba(31,132,221,.20))}',
    '.health-diagnostic-summary{box-shadow:inset 3px 0 0 rgba(32,188,232,.5)}',
    '.audit-event-row.selected{box-shadow:inset 3px 0 0 #7c62e8,0 7px 18px rgba(67,64,150,.07)!important}',
    '.audit-detail-box{background:linear-gradient(180deg,#f8fbfe,#f4f8fc)!important}',
    '.environment-card{background:radial-gradient(180px 80px at 100% 0%,rgba(41,160,226,.07),transparent 70%),#fff!important}',
    '.boundary-item{background:linear-gradient(180deg,#fbfdff,#f7faff)!important;border-color:#e0e9f3!important}',
    '.danger,.danger-zone,.secret-zone{box-shadow:inset 3px 0 0 rgba(217,67,95,.30)}',
    '.dw-runtime-feedback{right:20px;bottom:18px;min-width:190px;padding:9px 11px;border-radius:12px;box-shadow:0 16px 40px rgba(20,52,89,.16)!important}',
    '.dw-live-toast{border-radius:12px!important;box-shadow:0 18px 42px rgba(20,52,89,.18)!important}',
    '.dw-modal-backdrop{background:rgba(7,24,52,.32)!important;backdrop-filter:blur(6px)!important}',
    '.dw-modal{border-radius:18px!important;box-shadow:var(--dw-elev-3)!important;background:radial-gradient(260px 130px at 100% 0%,rgba(40,151,229,.06),transparent 72%),#fff!important}',
    '.dw-field input,.dw-field select,.dw-field textarea{transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}',
    '.dw-field input:hover,.dw-field select:hover,.dw-field textarea:hover{border-color:#bfd4e8;background:#fff}',
    '.stage{box-shadow:0 34px 90px rgba(17,48,86,.20),0 0 0 1px rgba(122,161,202,.11)!important;background:radial-gradient(620px 300px at 84% 18%,rgba(42,158,231,.08),transparent 72%),linear-gradient(180deg,#fbfdff,#f7faff)!important}',
    '.spinner-halo{filter:drop-shadow(0 0 18px rgba(32,151,226,.20))}',
    '.progress{box-shadow:inset 0 1px 2px rgba(30,70,112,.08)}.progress-fill{box-shadow:0 0 14px rgba(39,143,231,.28)}',
    '.security{transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.security:hover{border-color:#bdd5ea!important;box-shadow:0 9px 22px rgba(27,75,122,.07)}',
    '@media(prefers-reduced-motion:no-preference){.metric:hover,.card:hover{will-change:transform}.radar-sweep{filter:drop-shadow(0 0 5px rgba(32,188,232,.18))}}',
    '@media(max-width:1368px),(max-height:753px){.viewport{overflow:hidden}.app,.stage{transform-origin:center center}}' 
  ].join('\n');
  document.head.appendChild(style);
};
`;

const OVERVIEW_ADAPTER = String.raw`
(async function () {
  DW.wireNav();
  DW.wireCommandPalette();
  var metrics = document.querySelectorAll('.metric');
  var verifyTools=document.querySelector('[data-action="verify-tools"] .atxt');if(verifyTools)verifyTools.textContent='Inspect Tools';
  var runCode=document.querySelector('[data-action="run-code"]');if(runCode){DW.disable(runCode,'Code execution is not exposed by the Admin UI.');var runText=runCode.querySelector('.atxt');if(runText)runText.textContent='Execution unavailable';}
  var heroDate = document.querySelector('.hero .date');
  var heroStatus = document.querySelector('.hero > p');
  if (heroDate) heroDate.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  if (heroStatus) heroStatus.textContent = 'Loading authoritative control-plane state…';
  [].slice.call(document.querySelectorAll('.panel.providers .prov,.panel.health .hrow,.panel.activity .arow')).forEach(function (el) { el.style.display = 'none'; });
  var healthBadge = document.querySelector('.panel.health .allhealthy');
  if (healthBadge) healthBadge.innerHTML = '<i></i>Awaiting backend';
  function metric(i, value, sub) {
    var card = metrics[i];
    if (!card) return;
    var v = card.querySelector('.mvalue');
    var s = card.querySelector('.msub');
    if (v) v.textContent = value;
    if (s) s.textContent = sub;
  }
  for (var mi = 0; mi < metrics.length; mi++) metric(mi, '—', 'Loading…');

  var providers = [];
  try {
    var o = await DW.get('/admin/api/overview');
    metric(0, o.enabledProviderCount + ' / ' + o.providerCount, o.healthyCount + ' healthy');
    metric(1, o.availableModelCount + ' / ' + o.modelCount, 'Available');
    var allHealthy = o.providerCount > 0 && o.healthyCount === o.providerCount;
    metric(3, allHealthy ? 'All Healthy' : (o.healthyCount + ' / ' + o.providerCount), o.activeRoutingAliasCount + ' / ' + o.routingRuleCount + ' aliases active');
    if (heroStatus) {
      heroStatus.textContent = o.providerCount === 0 ? 'No providers are registered yet.'
        : allHealthy ? 'All registered providers currently report HEALTHY.'
        : o.healthyCount + ' of ' + o.providerCount + ' providers report HEALTHY. Inspect Health for details.';
    }
  } catch (_) {
    metric(0, '—', 'Backend unavailable'); metric(1, '—', 'Backend unavailable'); metric(3, '—', 'Backend unavailable');
    if (heroStatus) heroStatus.textContent = 'Control-plane status is unavailable from the Admin backend.';
  }

  try {
    var t = await DW.get('/admin/api/tools');
    metric(2, String(t.count), t.readOnlyCount + ' read-only · ' + t.destructiveCount + ' destructive');
  } catch (_) { metric(2, '—', 'Backend unavailable'); }

  try {
    var p = await DW.get('/admin/api/providers');
    providers = p.providers || [];
    var cards = document.querySelectorAll('.panel.providers .prov');
    for (var i = 0; i < cards.length; i++) {
      var row = providers[i];
      var card = cards[i];
      if (!row) { card.style.display = 'none'; continue; }
      card.style.display = '';
      var providerLogo = card.querySelector('.plogo');
      if (providerLogo) { providerLogo.className = 'plogo'; providerLogo.style.background = '#eef5ff'; providerLogo.style.color = '#176fe6'; providerLogo.innerHTML = '<svg class="icon" style="width:18px;height:18px"><use href="#i-db"/></svg>'; }
      var name = card.querySelector('.pname');
      if (name) name.textContent = row.display_name || row.id;
      var state = card.querySelector('.healthy');
      if (state) {
        var providerState=String(row.health_state||'UNKNOWN');
        state.innerHTML='<i></i>'+DW.esc(providerState.replace(/_/g,' '));
        var stateDot=state.querySelector('i');
        var stateColor=providerState==='HEALTHY'?'#0b9860':(providerState==='RATE_LIMITED'||providerState==='DEGRADED'?'#a36d18':'#71839f');
        state.style.color=stateColor;if(stateDot)stateDot.style.background=stateColor;
      }
      var badge = card.querySelector('.modelbadge');
      if (badge) badge.textContent = row.enabled_model_count + ' / ' + row.model_count + ' models';
      var stats = card.querySelectorAll('.pstat');
      if (stats[0]) {
        var b0 = stats[0].querySelector('b'); var s0 = stats[0].querySelector('small');
        if (b0) b0.textContent = DW.ms(row.last_latency_ms);
        if (s0) s0.textContent = 'last latency';
      }
      if (stats[1]) {
        var b1 = stats[1].querySelector('b'); var s1 = stats[1].querySelector('small');
        if (b1) b1.textContent = row.enabled === 1 ? 'Enabled' : 'Disabled';
        if (s1) s1.textContent = 'policy';
      }
    }
  } catch (_) {
    providers = [];
    var providerCards = document.querySelectorAll('.panel.providers .prov');
    for (var pe = 0; pe < providerCards.length; pe++) providerCards[pe].style.display = 'none';
  }

  try {
    var hrows = document.querySelectorAll('.panel.health .hrow');
    for (var j = 0; j < hrows.length; j++) {
      var row2 = providers[j];
      var hr = hrows[j];
      if (!row2) { hr.style.display = 'none'; continue; }
      hr.style.display = '';
      var comp = hr.querySelector('.hcomp');
      var st = hr.querySelector('.hstatus');
      var lat = hr.querySelector('.hlat');
      var healthy = row2.health_state === 'HEALTHY';
      if (comp) comp.innerHTML = '<i></i>' + DW.esc(row2.display_name || row2.id);
      if (st) {
        var healthState=String(row2.health_state||'UNKNOWN');
        st.innerHTML='<i></i>'+(healthy?'Operational':DW.esc(healthState.replace(/_/g,' ')));
        var healthDot=st.querySelector('i');
        var healthColor=healthy?'#0b9860':(healthState==='RATE_LIMITED'||healthState==='DEGRADED'?'#a36d18':'#71839f');
        st.style.color=healthColor;if(healthDot)healthDot.style.background=healthColor;
      }
      if (lat) lat.textContent = DW.ms(row2.last_latency_ms);
    }
    var allBadge = document.querySelector('.panel.health .allhealthy');
    if (allBadge && providers.length) {
      var healthyCount = providers.filter(function (x) { return x.health_state === 'HEALTHY'; }).length;
      allBadge.innerHTML = '<i></i>' + (healthyCount === providers.length ? 'All Healthy' : healthyCount + ' / ' + providers.length + ' Healthy');
    }
  } catch (_) {}

  try {
    var l = await DW.get('/admin/api/logs');
    var events = l.events || [];
    var arows = document.querySelectorAll('.panel.activity .arow');
    for (var k = 0; k < arows.length; k++) {
      var ev = events[k];
      var ar = arows[k];
      if (!ev) { ar.style.display = 'none'; continue; }
      ar.style.display = '';
      var b = ar.querySelector('.aevent b');
      var sp = ar.querySelector('.aevent span');
      var okEl = ar.querySelector('.success');
      var tm = ar.querySelector('.atime');
      if (b) b.textContent = ev.action || 'unknown.action';
      if (sp) sp.textContent = ev.target || ev.actor || '—';
      if (okEl) okEl.innerHTML = '<i></i>Recorded';
      if (tm) tm.textContent = DW.rel(ev.created_at || ev.at || ev.timestamp);
    }
  } catch (_) {
    var activityRows = document.querySelectorAll('.panel.activity .arow');
    for (var ae = 0; ae < activityRows.length; ae++) activityRows[ae].style.display = 'none';
  }

  document.addEventListener('click', function (event) {
    var btn = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!btn) return;
    var map = {
      providers: '/admin/providers',
      audit: '/admin/audit',
      'test-providers': '/admin/health',
      'verify-tools': '/admin/tools',
      'run-code': '/admin/tools',
      'view-logs': '/admin/audit',
    };
    var path = map[btn.dataset.action];
    if (!path) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (btn.dataset.action === 'run-code') return;
    window.location.assign(path);
  }, true);
})();
`;

const PROVIDERS_ADAPTER = String.raw`
(async function () {
  DW.wireNav();
  var tableBody = document.getElementById('provider-table-body');
  if (!tableBody) return;
  tableBody.innerHTML = '';
  var providers = [];
  var catalog = [];
  var addBtn = document.getElementById('add-provider-btn');
  if (addBtn) { addBtn.disabled = false; addBtn.removeAttribute('aria-disabled'); addBtn.style.opacity = ''; addBtn.style.cursor = ''; }
  [].slice.call(document.querySelectorAll('.provider-metric .pm-trend')).forEach(function (el) { el.style.display = 'none'; });

  var head = document.querySelector('.provider-table-head');
  if (head) {
    var labels = ['Priority','Provider','Auth','Network','Models','Latency','Test','Actions'];
    for (var hi = 0; hi < head.children.length && hi < labels.length; hi++) head.children[hi].textContent = labels[hi];
  }

  var metricCards = document.querySelectorAll('.provider-metric');
  function metricMeta(i, title, sub) {
    var card = metricCards[i]; if (!card) return;
    var span = card.querySelector('.pm-copy span'); var small = card.querySelector('.pm-copy small');
    if (span) span.textContent = title; if (small) small.textContent = sub;
  }
  metricMeta(0, 'Total Providers', 'Registered in D1');
  metricMeta(1, 'Enabled Models', 'Across enabled provider rows');
  metricMeta(2, 'Avg Last Latency', 'Only recorded real tests');
  metricMeta(3, 'Gateway Verified', 'Real Cloudflare gateway evidence');

  function metric(i, value) {
    var el = document.querySelectorAll('.provider-metric .pm-copy strong')[i];
    if (el) el.textContent = value;
  }
  function operationState(p) {
    return p && p.latest_operation && p.latest_operation.state ? String(p.latest_operation.state) : '';
  }
  function stateClass(p) {
    var op = operationState(p);
    if (op === 'RECONCILIATION_REQUIRED' || op === 'FAILED') return 'error';
    if (op === 'PENDING' || op === 'IN_PROGRESS' || op === 'COMPENSATING') return 'pending';
    if (p.runtimeConfigured === false) return 'pending';
    if (p.health_freshness && p.health_freshness.stale === true) return 'pending';
    if (p.gatewayVerified) return 'verified';
    if (p.health_state === 'AUTH_ERROR' || p.health_state === 'UPSTREAM_ERROR' || p.health_state === 'REVOKED') return 'error';
    return 'pending';
  }
  function authLabel(p) {
    if (p.auth_type === 'cloudflare-binding') return 'CF Binding';
    if (p.auth_type === 'cloudflare-unified') return 'Unified Billing';
    if (p.auth_type === 'none') return 'No upstream auth';
    return 'BYOK';
  }
  function networkLabel(p) {
    var op = operationState(p);
    if (op === 'RECONCILIATION_REQUIRED') return 'Reconciliation required';
    if (op === 'FAILED') return 'Last operation failed';
    if (op === 'COMPENSATING') return 'Compensating change';
    if (op === 'IN_PROGRESS' || op === 'PENDING') return 'Operation in progress';
    if (p.runtimeConfigured === false) return 'Runtime not configured';
    if (p.health_freshness && p.health_freshness.stale === true && p.gatewayVerified) return 'Gateway evidence stale';
    if (p.gatewayVerified) return 'Gateway verified';
    if (p.health_state === 'NOT_CONFIGURED') return 'Not configured';
    if (p.health_state === 'CONFIGURED') return 'Test required';
    return String(p.health_state || 'Unknown').replace(/_/g, ' ');
  }
  function shortEvidence(p) {
    var op = operationState(p);
    if (op === 'RECONCILIATION_REQUIRED' && p.latest_operation.step) return 'step: ' + String(p.latest_operation.step).replace(/_/g, ' ');
    var prefix = p.health_freshness && p.health_freshness.stale === true ? 'stale · ' : '';
    if (p.last_gateway_log_id) return prefix + 'log ' + String(p.last_gateway_log_id).slice(0, 10) + '…';
    if (p.last_cf_ray) return prefix + 'ray ' + String(p.last_cf_ray).slice(0, 10) + '…';
    return prefix + 'no gateway evidence';
  }
  function rowHtml(p, index) {
    var credentialSub = p.auth_type === 'byok' ? (p.byok_alias ? 'alias: ' + p.byok_alias : 'key required')
      : p.auth_type === 'cloudflare-unified' ? 'no provider key'
      : p.auth_type === 'cloudflare-binding' ? 'no provider key'
      : 'provider has no auth';
    return '<div class="provider-row' + (p.enabled === 1 ? '' : ' disabled-row') + '" data-provider-id="' + DW.esc(p.id) + '">' +
      '<div class="provider-cell priority-cell"><span class="priority-rank">#' + (index + 1) + '</span>' +
        '<button class="priority-btn" data-priority="up" data-provider="' + DW.esc(p.id) + '" title="Move up"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="priority-btn" data-priority="down" data-provider="' + DW.esc(p.id) + '" title="Move down"' + (index === providers.length - 1 ? ' disabled' : '') + '>↓</button></div>' +
      '<div class="provider-cell provider-ident"><div class="provider-logo" style="background:#eef5ff;color:#176fe6"><svg class="icon" style="width:18px;height:18px"><use href="#i-db"/></svg></div>' +
        '<div><strong>' + DW.esc(p.display_name || p.id) + '</strong><small>' + DW.esc(p.id) + '</small></div></div>' +
      '<div class="provider-cell provider-auth"><div><strong>' + DW.esc(authLabel(p)) + '</strong><small>' + DW.esc(credentialSub) + '</small></div></div>' +
      '<div class="provider-cell provider-network ' + stateClass(p) + '"><div><strong>' + DW.esc(networkLabel(p)) + '</strong><small title="' + DW.esc(p.last_gateway_log_id || p.last_cf_ray || '') + '">' + DW.esc(shortEvidence(p)) + '</small></div></div>' +
      '<div class="provider-cell muted-cell">' + Number(p.enabled_model_count || 0) + ' / ' + Number(p.model_count || 0) + '</div>' +
      '<div class="provider-cell strong-cell">' + DW.esc(DW.ms(p.last_latency_ms)) + '</div>' +
      '<div class="provider-cell"><button class="provider-test-btn" data-test-provider="' + DW.esc(p.id) + '" title="Run a real gateway connection test">Test</button></div>' +
      '<div class="provider-cell provider-actions">' +
        (p.auth_type === 'byok' ? '<button class="provider-key-btn" data-key-provider="' + DW.esc(p.id) + '" title="Set or rotate BYOK token">Key</button>' : '') +
        '<button class="row-action" data-toggle-provider="' + DW.esc(p.id) + '">' + (p.enabled === 1 ? 'Disable' : 'Enable') + '</button></div></div>';
  }
  function render() {
    if (!providers.length) DW.empty(tableBody, 'No providers registered', 'Add a provider to create a runtime-backed provider profile.');
    else tableBody.innerHTML = providers.map(rowHtml).join('');
    var count = document.getElementById('provider-count');
    if (count) count.textContent = providers.length ? ('Showing 1 to ' + providers.length + ' of ' + providers.length + ' providers') : '0 providers';
    var latencies = providers.map(function (p) { return p.last_latency_ms; }).filter(function (v) { return v != null; });
    var avg = latencies.length ? Math.round(latencies.reduce(function (a, b) { return a + Number(b); }, 0) / latencies.length) : null;
    metric(0, String(providers.length));
    metric(1, String(providers.reduce(function (a, p) { return a + Number(p.enabled_model_count || 0); }, 0)));
    metric(2, DW.ms(avg));
    metric(3, providers.filter(function (p) { return p.gatewayVerified === true; }).length + ' / ' + providers.length);
    var search = document.getElementById('provider-search-input');
    if (search && search.value) search.dispatchEvent(new Event('input'));
  }
  async function load() {
    try {
      var data = await DW.get('/admin/api/providers');
      providers = Array.isArray(data.providers) ? data.providers : [];
      render();
    } catch (_) {
      providers = [];
      DW.empty(tableBody, 'Provider data unavailable', 'The authenticated Admin backend did not return the provider registry.');
      metric(0, '—'); metric(1, '—'); metric(2, '—'); metric(3, '—');
    }
  }

  function removeModal() { var old = document.getElementById('dw-provider-modal'); if (old) old.remove(); }
  function modalShell(title, subtitle, bodyHtml) {
    removeModal();
    var wrap = document.createElement('div');
    wrap.id = 'dw-provider-modal'; wrap.className = 'dw-modal-backdrop';
    wrap.innerHTML = '<div class="dw-modal" role="dialog" aria-modal="true"><div class="dw-modal-head"><div><h3>' + DW.esc(title) + '</h3><p>' + DW.esc(subtitle) + '</p></div><button class="dw-modal-close" data-close-modal>×</button></div>' + bodyHtml + '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap || (e.target.closest && e.target.closest('[data-close-modal]'))) removeModal(); });
    return wrap;
  }
  function authOptions(templateId) {
    var c = catalog.filter(function(x){ return x.id === templateId; })[0];
    var labels = {
      byok:'BYOK — token stored in Cloudflare',
      'cloudflare-unified':'Cloudflare Unified Billing — no provider key',
      'cloudflare-binding':'Cloudflare Binding — no provider key',
      none:'No upstream authentication'
    };
    var allowed = c && Array.isArray(c.allowedAuthTypes) && c.allowedAuthTypes.length ? c.allowedAuthTypes : [c && c.authType || 'byok'];
    return allowed.map(function(v){ return {v:v,t:labels[v]||v}; });
  }
  async function ensureCatalog() {
    if (catalog.length) return;
    var data = await DW.get('/admin/api/provider-catalog');
    catalog = Array.isArray(data.providers) ? data.providers : [];
  }
  async function openAddModal() {
    try { await ensureCatalog(); } catch (err) {
      if (window.DreamWorkerProvidersUI) window.DreamWorkerProvidersUI.showToast(String(err.message || err), 'error', 'Provider catalog');
      return;
    }
    var presetOptions = catalog.map(function (c) { return '<option value="' + DW.esc(c.id) + '">' + DW.esc(c.displayName) + '</option>'; }).join('');
    var modal = modalShell('Add or configure provider', 'Creates only real runtime profiles. Credentials are never stored in D1.',
      '<form id="dw-provider-form"><div class="dw-form-grid">' +
      '<div class="dw-field full"><label>Provider</label><select id="dw-preset">' + presetOptions + '</select><small id="dw-provider-description"></small></div>' +
      '<div class="dw-field"><label>Display name</label><input id="dw-provider-name" autocomplete="off"></div>' +
      '<div class="dw-field"><label>Provider slug / ID</label><input id="dw-provider-slug" autocomplete="off"></div>' +
      '<div class="dw-field full" id="dw-base-wrap" style="display:none"><label>HTTPS base URL</label><input id="dw-provider-base" placeholder="https://api.example.com"><small>Cloudflare Custom Provider root URL. No credentials in this field.</small></div>' +
      '<div class="dw-field"><label>Model ID</label><input id="dw-provider-model" placeholder="model-id"><small>Required for custom/Antigravity profiles; recommended for immediate testing on presets.</small></div>' +
      '<div class="dw-field"><label>Authentication</label><select id="dw-provider-auth"></select><small id="dw-auth-note"></small></div>' +
      '<div class="dw-field" id="dw-token-wrap"><label>Provider token</label><input id="dw-provider-token" type="password" autocomplete="new-password"><small>Sent once to Cloudflare Secrets Store / AI Gateway BYOK.</small></div>' +
      '<div class="dw-field" id="dw-alias-wrap"><label>Key alias</label><input id="dw-provider-alias" value="default" autocomplete="off"></div>' +
      '<div class="dw-field full"><label>Test model override</label><input id="dw-test-model" placeholder="Optional; uses Model ID if blank"></div>' +
      '</div><div id="dw-provider-error" class="dw-form-error"></div><div class="dw-modal-actions"><button type="button" data-close-modal>Cancel</button><button type="submit" class="primary">Save provider</button></div></form>');
    var preset = modal.querySelector('#dw-preset');
    var auth = modal.querySelector('#dw-provider-auth');
    function sync() {
      var c = catalog.filter(function (x) { return x.id === preset.value; })[0] || catalog[0];
      if (!c) return;
      modal.querySelector('#dw-provider-name').value = c.displayName || '';
      modal.querySelector('#dw-provider-slug').value = c.id === 'custom' ? '' : (c.id === 'google-antigravity' ? 'google-antigravity' : (c.providerSlug || c.id));
      modal.querySelector('#dw-provider-slug').disabled = !c.customizable || c.id === 'google-antigravity';
      modal.querySelector('#dw-base-wrap').style.display = c.customizable ? '' : 'none';
      modal.querySelector('#dw-provider-description').textContent = c.description || '';
      var opts = authOptions(c.id);
      auth.innerHTML = opts.map(function (o) { return '<option value="' + o.v + '">' + DW.esc(o.t) + '</option>'; }).join('');
      auth.value = c.authType || opts[0].v;
      if (c.testModel) modal.querySelector('#dw-test-model').value = c.testModel;
      syncAuth();
    }
    function syncAuth() {
      var isByok = auth.value === 'byok';
      modal.querySelector('#dw-token-wrap').style.display = isByok ? '' : 'none';
      modal.querySelector('#dw-alias-wrap').style.display = isByok ? '' : 'none';
      modal.querySelector('#dw-auth-note').textContent = auth.value === 'cloudflare-unified' ? 'No provider token; usage is billed through Cloudflare credits.'
        : auth.value === 'cloudflare-binding' ? 'Workers AI binding; eligible models can use the Workers free allocation.'
        : auth.value === 'none' ? 'Only for an upstream that genuinely accepts unauthenticated requests.'
        : 'Token is stored server-side in Cloudflare; the browser cannot read it back.';
    }
    preset.addEventListener('change', sync); auth.addEventListener('change', syncAuth); sync();
    modal.querySelector('#dw-provider-form').addEventListener('submit', async function (e) {
      e.preventDefault(); e.stopPropagation();
      var error = modal.querySelector('#dw-provider-error'); error.style.display = 'none';
      var templateId = preset.value;
      var payload = {
        templateId: templateId,
        displayName: modal.querySelector('#dw-provider-name').value.trim(),
        providerSlug: modal.querySelector('#dw-provider-slug').value.trim(),
        baseUrl: modal.querySelector('#dw-provider-base').value.trim(),
        modelId: modal.querySelector('#dw-provider-model').value.trim(),
        testModel: modal.querySelector('#dw-test-model').value.trim() || modal.querySelector('#dw-provider-model').value.trim(),
        authType: auth.value,
        token: modal.querySelector('#dw-provider-token').value,
        tokenAlias: modal.querySelector('#dw-provider-alias').value.trim() || 'default'
      };
      var submit = e.target.querySelector('.primary'); submit.disabled = true; submit.textContent = 'Saving…';
      try {
        await DW.send('/admin/api/providers', 'POST', payload);
        removeModal(); await load();
        if (window.DreamWorkerProvidersUI) window.DreamWorkerProvidersUI.showToast('Provider saved. Run Test to verify the Cloudflare gateway path.', 'success', 'Providers');
      } catch (err) {
        error.textContent = String(err.message || err); error.style.display = 'block'; submit.disabled = false; submit.textContent = 'Save provider';
      }
    });
  }
  function openKeyModal(p) {
    var modal = modalShell('Set BYOK token', (p.display_name || p.id) + ' · token is sent directly to the authenticated Admin API.',
      '<form id="dw-key-form"><div class="dw-form-grid"><div class="dw-field full"><label>Provider token</label><input id="dw-key-value" type="password" autocomplete="new-password"></div><div class="dw-field full"><label>Alias</label><input id="dw-key-alias" value="' + DW.esc(p.byok_alias || 'default') + '"><small>Use default for the Cloudflare AI REST API. Non-default aliases use provider passthrough.</small></div></div><div id="dw-key-error" class="dw-form-error"></div><div class="dw-modal-actions"><button type="button" data-close-modal>Cancel</button><button class="primary" type="submit">Store & verify</button></div></form>');
    modal.querySelector('#dw-key-form').addEventListener('submit', async function (e) {
      e.preventDefault(); var submit = e.target.querySelector('.primary'); submit.disabled = true; submit.textContent = 'Verifying…';
      var error = modal.querySelector('#dw-key-error'); error.style.display = 'none';
      try {
        await DW.send('/admin/api/providers/' + encodeURIComponent(p.id) + '/credential', 'POST', { value: modal.querySelector('#dw-key-value').value, alias: modal.querySelector('#dw-key-alias').value.trim() || 'default' });
        removeModal(); await load();
        if (window.DreamWorkerProvidersUI) window.DreamWorkerProvidersUI.showToast('Credential stored and real connection test completed.', 'success', 'Providers');
      } catch (err) { error.textContent = String(err.message || err); error.style.display = 'block'; submit.disabled = false; submit.textContent = 'Store & verify'; }
    });
  }

  if (addBtn) addBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); openAddModal(); }, true);
  var search = document.getElementById('provider-search-input');
  if (search) search.addEventListener('input', function (e) {
    e.stopImmediatePropagation(); var q = search.value.trim().toLowerCase();
    [].slice.call(tableBody.querySelectorAll('.provider-row')).forEach(function (row) { row.style.display = String(row.textContent || '').toLowerCase().indexOf(q) !== -1 ? '' : 'none'; });
  }, true);

  document.addEventListener('click', async function (event) {
    var el = event.target && event.target.closest ? event.target.closest('[data-toggle-provider],[data-test-provider],[data-priority],[data-key-provider]') : null;
    if (!el) return;
    event.preventDefault(); event.stopImmediatePropagation();
    var id = el.dataset.provider || el.dataset.toggleProvider || el.dataset.testProvider || el.dataset.keyProvider;
    var current = providers.filter(function (p) { return p.id === id; })[0];
    if (!current) return;
    if (el.dataset.keyProvider) { openKeyModal(current); return; }
    el.disabled = true;
    try {
      if (el.dataset.priority) await DW.send('/admin/api/providers/' + encodeURIComponent(id) + '/priority', 'POST', { direction: el.dataset.priority });
      else if (el.dataset.testProvider) {
        var result = await DW.send('/admin/api/providers/' + encodeURIComponent(id) + '/health-test', 'POST');
        if (window.DreamWorkerProvidersUI) window.DreamWorkerProvidersUI.showToast(result.gatewayVerified ? 'Gateway verified.' : ('Test: ' + result.state), result.gatewayVerified ? 'success' : 'error', current.display_name || id);
      } else await DW.send('/admin/api/providers/' + encodeURIComponent(id), 'PATCH', { enabled: current.enabled !== 1 });
      await load();
    } catch (err) {
      el.disabled = false;
      if (window.DreamWorkerProvidersUI) window.DreamWorkerProvidersUI.showToast(String(err.message || err), 'error', current.display_name || id);
    }
  }, true);

  await load();
})();
`;

const MODELS_ADAPTER = String.raw`
(async function () {
  DW.wireNav();
  var list = document.getElementById('catalog-model-list');
  if (!list) return;
  list.innerHTML = '';
  var count = document.getElementById('catalog-count');
  if (count) count.textContent = 'Loading model registry…';

  var registerBtn = document.getElementById('register-model-btn-v2');
  if (registerBtn) {
    registerBtn.disabled = false; registerBtn.removeAttribute('aria-disabled');
    registerBtn.style.opacity = ''; registerBtn.style.cursor = ''; registerBtn.textContent = 'Register model';
    registerBtn.addEventListener('click', async function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      var providerData;
      try { providerData = await DW.get('/admin/api/providers'); }
      catch (err) { if (window.DreamWorkerModelsUI) window.DreamWorkerModelsUI.showToast(String(err.message || err), 'error', 'Models'); return; }
      var ps = Array.isArray(providerData.providers) ? providerData.providers : [];
      if (!ps.length) { if (window.DreamWorkerModelsUI) window.DreamWorkerModelsUI.showToast('Register a provider first.', 'error', 'Models'); return; }
      var old = document.getElementById('dw-model-modal'); if (old) old.remove();
      var wrap = document.createElement('div'); wrap.id = 'dw-model-modal'; wrap.className = 'dw-modal-backdrop';
      wrap.innerHTML = '<div class="dw-modal" role="dialog" aria-modal="true"><div class="dw-modal-head"><div><h3>Register model</h3><p>Adds a real D1 model row; it does not assert provider availability.</p></div><button class="dw-modal-close" data-close-model>×</button></div>' +
        '<form id="dw-model-form"><div class="dw-form-grid"><div class="dw-field full"><label>Provider</label><select id="dw-model-provider">' + ps.map(function(p){return '<option value="'+DW.esc(p.id)+'">'+DW.esc(p.display_name || p.id)+'</option>';}).join('') + '</select></div>' +
        '<div class="dw-field full"><label>Model ID <span style="font-weight:400;color:#90a0b7">immutable</span></label><input id="dw-model-id" autocomplete="off" placeholder="provider model identifier"></div>' +
        '<div class="dw-field full"><label>Display name <span class="dw-char-count" id="dw-model-display-count">0 / 120</span></label><input id="dw-model-display" maxlength="120" autocomplete="off" placeholder="optional operator-friendly name"></div>' +
        '<div class="dw-field full"><label>Description <span class="dw-char-count" id="dw-model-description-count">0 / 1000</span></label><textarea id="dw-model-description" maxlength="1000" placeholder="optional operator notes, capability or intended role"></textarea><small>Metadata is operator-facing only and does not change provider routing or model identity.</small></div>' +
        '<div class="dw-field full"><label style="display:flex;align-items:center;gap:7px"><input id="dw-model-free" type="checkbox" style="width:auto;height:auto"> Eligible for the no-provider-token free path</label><small>Use this only for a model you intentionally want included in the free route.</small></div></div>' +
        '<div id="dw-model-error" class="dw-form-error"></div><div class="dw-modal-actions"><button type="button" data-close-model>Cancel</button><button type="submit" class="primary">Register</button></div></form></div>';
      document.body.appendChild(wrap);
      function close(){wrap.remove();}
      wrap.addEventListener('click', function(e){if(e.target===wrap || (e.target.closest&&e.target.closest('[data-close-model]'))) close();});
      function bindCount(inputId,countId,max){var input=wrap.querySelector('#'+inputId),out=wrap.querySelector('#'+countId);if(!input||!out)return;function update(){var n=input.value.length;out.textContent=n+' / '+max;out.classList.toggle('warn',n>Math.floor(max*.9));}input.addEventListener('input',update);update();}
      bindCount('dw-model-display','dw-model-display-count',120);bindCount('dw-model-description','dw-model-description-count',1000);
      wrap.querySelector('#dw-model-form').addEventListener('submit', async function(e){
        e.preventDefault(); var id=wrap.querySelector('#dw-model-id').value.trim(); var providerId=wrap.querySelector('#dw-model-provider').value;
        var displayName=wrap.querySelector('#dw-model-display').value.trim(); var description=wrap.querySelector('#dw-model-description').value.trim();
        var errEl=wrap.querySelector('#dw-model-error'); errEl.style.display='none'; var submit=e.target.querySelector('.primary'); submit.disabled=true;submit.textContent='Registering…';
        try { await DW.send('/admin/api/models','POST',{id:id,providerId:providerId,freeTier:wrap.querySelector('#dw-model-free').checked,displayName:displayName||null,description:description||null}); if(window.DreamWorkerModelsUI)window.DreamWorkerModelsUI.showToast('Model registered in D1.','success','Models');else DW.toast('Model registered in D1.','success','Models'); close(); window.location.reload(); }
        catch(err){errEl.textContent=String(err.message||err);errEl.style.display='block';submit.disabled=false;submit.textContent='Register';}
      });
    }, true);
  }

  DW.disable('#inspector-test', 'Admin model invocation is not implemented by this control-plane API.');
  var testBtn = document.getElementById('inspector-test');
  if (testBtn) {
    testBtn.style.display = 'none';
    testBtn.addEventListener('click', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
  }
  var inspectorActions = document.querySelector('.model-inspector .inspector-actions');
  if (inspectorActions) inspectorActions.style.gridTemplateColumns = '1fr';
  var inspectorPolicySection = document.querySelector('.model-inspector .inspector-policy');
  if (inspectorPolicySection) inspectorPolicySection.style.display = 'none';

  var modelInspectorFoot = document.querySelector('.model-inspector .inspector-foot');
  if (modelInspectorFoot) modelInspectorFoot.textContent = 'Model enable/disable is persisted through the Admin API · invocation is unavailable here';

  var cubeIcon = '<svg class="icon"><use href="#i-cube"/></svg>';
  var checkIcon = '<svg class="icon"><use href="#i-check"/></svg>';
  function clearInspector(message) {
    DW.text('inspector-model-name', message || 'No model selected');
    DW.text('inspector-provider', '—');
    DW.text('fact-enabled', '—'); DW.text('fact-alias', '—');
    DW.text('fact-provider', '—'); DW.text('fact-confidence', '—');
    var status = document.getElementById('inspector-status');
    if (status) { status.className = 'inspector-status unavailable'; status.innerHTML = '<i></i>Unavailable'; }
    var policy = document.getElementById('policy-message');
    if (policy) {
      policy.className = 'policy-message blocked';
      policy.innerHTML = '<svg class="icon"><use href="#i-shield"/></svg><div><strong>No runtime model</strong><span>' +
        DW.esc(message || 'The registry did not return a model.') + '</span></div>';
    }
  }
  function rowHtml(m, first) {
    var callable = m.available === true;
    var enabled = m.enabled === 1;
    var providerEnabled = m.provider_enabled === 1;
    var known = /^[a-z0-9][a-z0-9._-]*$/i.test(String(m.id || ''));
    var routeAlias = (m.routing_aliases && m.routing_aliases.length) ? m.routing_aliases.join(', ') : '—';
    var modelAlias = m.public_alias || '';
    var alias = modelAlias ? (modelAlias + (routeAlias !== '—' ? ' · routes: ' + routeAlias : '')) : routeAlias;
    var displayName = String(m.display_name || '').trim();
    var description = String(m.description || '').trim();
    return '<button class="catalog-model' + (first ? ' selected' : '') + (known ? '' : ' generic') + '"' +
      ' data-name="' + DW.esc(m.id) + '"' +
      ' data-provider="' + DW.esc(m.provider_id || '') + '"' +
      ' data-enabled="' + enabled + '"' +
      ' data-provider-enabled="' + providerEnabled + '"' +
      ' data-free-tier="' + (m.free_tier === 1) + '"' +
      ' data-runtime="' + (callable ? 'Callable' : 'Unavailable') + '"' +
      ' data-alias="' + DW.esc(alias) + '"' +
      ' data-model-alias="' + DW.esc(modelAlias) + '"' +
      ' data-display-name="' + DW.esc(displayName) + '"' +
      ' data-description="' + DW.esc(description) + '"' +
      ' data-known="' + known + '"' +
      ' data-state="' + (callable ? 'callable' : 'blocked') + '">' +
      '<div class="catalog-model-ident"><div class="catalog-model-icon' + (callable ? ' active' : '') + '">' + cubeIcon + '</div>' +
      '<div><strong class="model-primary-name">' + DW.esc(displayName || m.id) + '</strong><small class="model-technical-id">' + DW.esc((displayName ? m.id + ' · ' : '') + (m.provider_id || '—') + (m.free_tier === 1 ? ' · free route' : '')) + '</small></div></div>' +
      '<div><span class="runtime-state ' + (callable ? 'callable' : 'blocked') + '"><i></i>' +
      (callable ? 'Callable' : 'Unavailable') + '</span></div>' +
      '<div><span class="alias-chip-v2">' + DW.esc(alias) + '</span></div>' +
      '<div><span class="readiness-v2 ' + (callable ? 'ready' : 'blocked') + '">' + checkIcon +
      (callable ? 'Ready' : 'Blocked') + '</span></div></button>';
  }
  function updateOverview(items) {
    var callable = items.filter(function (m) { return m.available === true; }).length;
    var pill = document.querySelector('.model-overview-grid .model-overview-card:first-child .overview-pill');
    if (pill) pill.textContent = items.length + ' registered';
    var core = document.querySelector('.registry-ring-core strong'); if (core) core.textContent = String(callable);
    var legend = document.querySelectorAll('.registry-legend > div');
    if (legend[0]) { var l0 = legend[0].querySelector('strong'); if (l0) l0.textContent = String(callable); }
    if (legend[1]) {
      var n1 = legend[1].querySelector('span'); var l1 = legend[1].querySelector('strong');
      if (n1) n1.textContent = 'Unavailable'; if (l1) l1.textContent = String(items.length - callable);
    }
    if (legend[2]) { var l2 = legend[2].querySelector('strong'); if (l2) l2.textContent = String(items.length); }
    var aliases = [];
    items.forEach(function (m) {
      (m.routing_aliases || []).forEach(function (a) {
        if (!aliases.some(function (x) { return x.alias === a; })) aliases.push({ alias: a, target: m.id, active: m.available === true });
      });
    });
    var activeAliases = aliases.filter(function (a) { return a.active; }).length;
    var apill = document.querySelector('.model-overview-grid .model-overview-card:nth-child(2) .overview-pill');
    if (apill) apill.textContent = activeAliases + ' active';
    var stack = document.querySelector('.alias-stack');
    if (stack) stack.innerHTML = aliases.length ? aliases.map(function (a) {
      return '<button class="alias-route ' + (a.active ? 'active' : 'muted-target') + '" disabled>' +
        '<span class="alias-name">' + DW.esc(a.alias) + '</span><span class="alias-arrow">→</span>' +
        '<span class="alias-target">' + DW.esc(a.target) + '</span><i style="background:' + (a.active ? '#13ad69' : '#a7b5c7') + '"></i></button>';
    }).join('') : '<div style="padding:12px;color:#7d91b2;font-size:6px">No routing aliases registered.</div>';
  }

  var models = [];
  try {
    var data = await DW.get('/admin/api/models');
    models = Array.isArray(data.models) ? data.models : [];
    updateOverview(models);
  } catch (_) {
    if (count) count.textContent = 'Model registry unavailable';
    DW.empty(list, 'Model registry unavailable', 'The Admin API did not return authoritative model state.');
    clearInspector('Backend unavailable');
    var toggleFail = document.getElementById('inspector-toggle');
    if (toggleFail) DW.disable(toggleFail, 'Model state could not be loaded.');
    return;
  }
  if (!models.length) {
    if (count) count.textContent = '0 visible models';
    DW.empty(list, 'No models registered', 'D1 returned an empty model registry.');
    clearInspector('No model selected');
    var toggleEmpty = document.getElementById('inspector-toggle');
    if (toggleEmpty) DW.disable(toggleEmpty, 'No model is available to toggle.');
    return;
  }

  list.innerHTML = models.map(function (m, i) { return rowHtml(m, i === 0); }).join('');
  if (count) count.textContent = models.length + ' visible models';
  var rows = [].slice.call(list.querySelectorAll('.catalog-model'));
  var inspectorActionsLive = document.querySelector('.model-inspector .inspector-actions');
  if (inspectorActionsLive) {
    inspectorActionsLive.style.gridTemplateColumns = '1fr 1fr';
    if (!document.getElementById('inspector-alias')) inspectorActionsLive.insertAdjacentHTML('beforeend', '<button id="inspector-alias" class="secondary">Edit alias</button>');
    if (!document.getElementById('inspector-metadata')) inspectorActionsLive.insertAdjacentHTML('beforeend', '<button id="inspector-metadata" class="secondary">Edit model details</button>');
  }
  var inspectorMetadata = document.getElementById('dw-model-metadata-live');
  if (!inspectorMetadata && inspectorActionsLive) {
    inspectorMetadata = document.createElement('section');
    inspectorMetadata.id = 'dw-model-metadata-live';
    inspectorMetadata.className = 'model-metadata-live';
    inspectorMetadata.innerHTML = '<b>Operator metadata</b><p id="dw-model-description-live">No description set.</p><code id="dw-model-id-live"></code>';
    inspectorActionsLive.parentNode.insertBefore(inspectorMetadata, inspectorActionsLive);
  }
  function openAliasModal(row) {
    var old = document.getElementById('dw-model-alias-modal'); if (old) old.remove();
    var currentAlias = row.dataset.modelAlias || '';
    var wrap = document.createElement('div'); wrap.id = 'dw-model-alias-modal'; wrap.className = 'dw-modal-backdrop';
    wrap.innerHTML = '<div class="dw-modal" role="dialog" aria-modal="true"><div class="dw-modal-head"><div><h3>Edit model alias</h3><p>Stores the public alias in D1 for this model. Model IDs remain immutable.</p></div><button class="dw-modal-close" data-close-alias>×</button></div>' +
      '<form id="dw-model-alias-form"><div class="dw-form-grid"><div class="dw-field full"><label>Model</label><input value="' + DW.esc(row.dataset.name || '') + '" disabled></div>' +
      '<div class="dw-field full"><label>Public alias</label><input id="dw-model-public-alias" autocomplete="off" value="' + DW.esc(currentAlias) + '" placeholder="optional alias"><small>Leave empty to clear. Routing aliases such as fast are managed on Routing.</small></div></div>' +
      '<div id="dw-model-alias-error" class="dw-form-error"></div><div class="dw-modal-actions"><button type="button" data-close-alias>Cancel</button><button type="submit" class="primary">Save alias</button></div></form></div>';
    document.body.appendChild(wrap);
    function close(){wrap.remove();}
    wrap.addEventListener('click', function(e){if(e.target===wrap || (e.target.closest&&e.target.closest('[data-close-alias]'))) close();});
    wrap.querySelector('#dw-model-alias-form').addEventListener('submit', async function(e){
      e.preventDefault();
      var alias=wrap.querySelector('#dw-model-public-alias').value.trim();
      var errEl=wrap.querySelector('#dw-model-alias-error'); errEl.style.display='none';
      var submit=e.target.querySelector('.primary'); submit.disabled=true;
      try {
        await DW.send('/admin/api/models/' + encodeURIComponent(row.dataset.name) + '/alias','PATCH',{publicAlias:alias || null});
        if (window.DreamWorkerModelsUI) window.DreamWorkerModelsUI.showToast('Model alias saved in D1.', 'success', 'Models');
        close(); window.location.reload();
      } catch(err) {
        errEl.textContent=String(err.message||err); errEl.style.display='block'; submit.disabled=false;
      }
    });
  }

  function openMetadataModal(row) {
    var old = document.getElementById('dw-model-metadata-modal'); if (old) old.remove();
    var wrap = document.createElement('div'); wrap.id = 'dw-model-metadata-modal'; wrap.className = 'dw-modal-backdrop';
    var currentDisplay = row.dataset.displayName || '';
    var currentDescription = row.dataset.description || '';
    wrap.innerHTML = '<div class="dw-modal" role="dialog" aria-modal="true" aria-labelledby="dw-model-metadata-title"><div class="dw-modal-head"><div><h3 id="dw-model-metadata-title">Edit model details</h3><p>Updates operator metadata in D1. The model ID and provider mapping remain unchanged.</p></div><button class="dw-modal-close" data-close-metadata>×</button></div>' +
      '<form id="dw-model-metadata-form"><div class="dw-form-grid"><div class="dw-field full"><label>Model ID <span style="font-weight:400;color:#90a0b7">immutable</span></label><input value="' + DW.esc(row.dataset.name || '') + '" disabled></div>' +
      '<div class="dw-field full"><label>Display name <span class="dw-char-count" id="dw-meta-display-count">0 / 120</span></label><input id="dw-meta-display" maxlength="120" autocomplete="off" value="' + DW.esc(currentDisplay) + '" placeholder="optional operator-friendly name"></div>' +
      '<div class="dw-field full"><label>Description <span class="dw-char-count" id="dw-meta-description-count">0 / 1000</span></label><textarea id="dw-meta-description" maxlength="1000" placeholder="optional operator notes">' + DW.esc(currentDescription) + '</textarea><small>Clearing either field stores NULL. Metadata does not affect routing, health or model callability.</small></div></div>' +
      '<div id="dw-model-metadata-error" class="dw-form-error"></div><div class="dw-modal-actions"><button type="button" data-close-metadata>Cancel</button><button type="submit" class="primary">Save details</button></div></form></div>';
    document.body.appendChild(wrap);
    function close(){wrap.remove();}
    wrap.addEventListener('click', function(e){if(e.target===wrap || (e.target.closest&&e.target.closest('[data-close-metadata]'))) close();});
    function bindCount(inputId,countId,max){var input=wrap.querySelector('#'+inputId),out=wrap.querySelector('#'+countId);if(!input||!out)return;function update(){var n=input.value.length;out.textContent=n+' / '+max;out.classList.toggle('warn',n>Math.floor(max*.9));}input.addEventListener('input',update);update();}
    bindCount('dw-meta-display','dw-meta-display-count',120);bindCount('dw-meta-description','dw-meta-description-count',1000);
    wrap.querySelector('#dw-meta-display').focus();
    wrap.querySelector('#dw-model-metadata-form').addEventListener('submit', async function(e){
      e.preventDefault();
      var displayName=wrap.querySelector('#dw-meta-display').value.trim();
      var description=wrap.querySelector('#dw-meta-description').value.trim();
      var errEl=wrap.querySelector('#dw-model-metadata-error'); errEl.style.display='none';
      var submit=e.target.querySelector('.primary'); submit.disabled=true; submit.textContent='Saving…';
      try {
        var result=await DW.send('/admin/api/models/' + encodeURIComponent(row.dataset.name) + '/metadata','PATCH',{displayName:displayName||null,description:description||null});
        var updated=result&&result.model?result.model:null;
        row.dataset.displayName=updated&&updated.display_name?String(updated.display_name):displayName;
        row.dataset.description=updated&&updated.description?String(updated.description):description;
        var primary=row.querySelector('.model-primary-name'); if(primary)primary.textContent=row.dataset.displayName||row.dataset.name;
        var technical=row.querySelector('.model-technical-id'); if(technical)technical.textContent=(row.dataset.displayName?row.dataset.name+' · ':'')+row.dataset.provider+(row.dataset.freeTier==='true'?' · free route':'');
        selectRow(row);
        if (window.DreamWorkerModelsUI) window.DreamWorkerModelsUI.showToast('Model details saved in D1.', 'success', 'Models'); else DW.toast('Model details saved in D1.','success','Models');
        close();
      } catch(err) {
        errEl.textContent=String(err.message||err); errEl.style.display='block'; submit.disabled=false; submit.textContent='Save details';
      }
    });
  }

  function selectRow(row) {
    rows.forEach(function (r) { r.classList.toggle('selected', r === row); });
    var callable = row.dataset.runtime === 'Callable';
    var enabled = row.dataset.enabled === 'true';
    var providerEnabled = row.dataset.providerEnabled === 'true';
    var known = row.dataset.known === 'true';
    DW.text('inspector-model-name', row.dataset.displayName || row.dataset.name);
    DW.text('inspector-provider', row.dataset.provider);
    DW.text('dw-model-description-live', row.dataset.description || 'No description set.');
    DW.text('dw-model-id-live', row.dataset.name);
    var status = document.getElementById('inspector-status');
    if (status) {
      status.className = 'inspector-status ' + (callable ? 'callable' : 'unavailable');
      status.innerHTML = '<i></i>' + (callable ? 'Callable' : 'Unavailable');
    }
    DW.text('fact-enabled', enabled ? 'Yes' : 'No');
    DW.text('fact-alias', row.dataset.alias);
    DW.text('fact-provider', row.dataset.provider);
    DW.text('fact-confidence', known ? 'Known' : 'Registry only');
    [['chain-enabled', enabled], ['chain-provider', providerEnabled], ['chain-callable', callable],
     ['chain-line-provider', providerEnabled], ['chain-line-callable', callable]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      el.classList.toggle('off', !pair[1]);
      if (pair[0].indexOf('line') !== -1) el.classList.toggle('active', pair[1]);
    });
    var policy = document.getElementById('policy-message');
    if (policy) {
      policy.className = 'policy-message ' + (callable ? 'good' : 'blocked');
      policy.innerHTML = callable
        ? '<svg class="icon"><use href="#i-check"/></svg><div><strong>Runtime-ready</strong><span>Model and provider state allow invocation through the runtime.</span></div>'
        : '<svg class="icon"><use href="#i-shield"/></svg><div><strong>Not callable</strong><span>' +
          (!enabled ? 'Model is disabled in the registry.' :
            (!providerEnabled ? 'Provider is disabled.' : 'Runtime contract reports this model as unavailable.')) +
          '</span></div>';
    }
    var toggle = document.getElementById('inspector-toggle');
    if (toggle) toggle.textContent = enabled ? 'Disable model' : 'Enable model';
    var aliasBtn = document.getElementById('inspector-alias');
    if (aliasBtn) aliasBtn.disabled = false;
    var metadataBtn = document.getElementById('inspector-metadata');
    if (metadataBtn) metadataBtn.disabled = false;
  }
  rows.forEach(function (row) { row.addEventListener('click', function () { selectRow(row); }); });
  selectRow(rows[0]);

  var search = document.getElementById('model-search-input-v2');
  if (search) {
    search.addEventListener('input', function (event) {
      event.stopImmediatePropagation();
      var q = search.value.trim().toLowerCase();
      var visible = 0;
      rows.forEach(function (row) {
        var match = row.dataset.name.toLowerCase().indexOf(q) !== -1 ||
          row.dataset.provider.toLowerCase().indexOf(q) !== -1 ||
          (row.dataset.displayName || '').toLowerCase().indexOf(q) !== -1 ||
          (row.dataset.description || '').toLowerCase().indexOf(q) !== -1;
        row.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      if (count) count.textContent = visible + ' visible models';
    }, true);
  }

  var toggle = document.getElementById('inspector-toggle');
  if (toggle) {
    toggle.disabled = false;
    toggle.removeAttribute('aria-disabled');
    toggle.addEventListener('click', async function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      var row = list.querySelector('.catalog-model.selected');
      if (!row) return;
      var next = row.dataset.enabled !== 'true';
      toggle.disabled = true;
      try {
        await DW.send('/admin/api/models/' + encodeURIComponent(row.dataset.name), 'PATCH', { enabled: next });
        window.location.reload();
      } catch (err) {
        toggle.disabled = false;
        if (window.DreamWorkerModelsUI) window.DreamWorkerModelsUI.showToast(String(err.message || err), 'error', 'Models');
      }
    }, true);
  }
  var aliasBtn = document.getElementById('inspector-alias');
  if (aliasBtn) {
    aliasBtn.disabled = false;
    aliasBtn.addEventListener('click', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      var row = list.querySelector('.catalog-model.selected');
      if (row) openAliasModal(row);
    }, true);
  }
  var metadataBtn = document.getElementById('inspector-metadata');
  if (metadataBtn) {
    metadataBtn.disabled = false;
    metadataBtn.addEventListener('click', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      var row = list.querySelector('.catalog-model.selected');
      if (row) openMetadataModal(row);
    }, true);
  }
})();
`;

const TOOLS_ADAPTER = String.raw`
(async function () {
  DW.wireNav();
  var list = document.getElementById('mcp-tool-list');
  if (!list) return;
  list.innerHTML = '';
  var count = document.getElementById('tool-list-count');
  if (count) count.textContent = 'Loading live tool catalog…';
  var protocolStages = [].slice.call(document.querySelectorAll('.protocol-stage'));
  function setProtocolStage(index, label, value) {
    var stage = protocolStages[index];
    if (!stage) return;
    var span = stage.querySelector('span');
    var strong = stage.querySelector('strong');
    if (span) span.textContent = label;
    if (strong) strong.textContent = value;
  }
  setProtocolStage(0, 'Admin catalog', 'Checking…');
  setProtocolStage(1, 'tools/list', 'Loading…');
  setProtocolStage(2, 'Metadata', 'Loading…');
  setProtocolStage(3, 'Guard', 'Annotations only');
  setProtocolStage(4, 'tools/call', 'Unavailable in Admin');
  if (protocolStages[4]) protocolStages[4].classList.remove('done');
  var catalogFooter = document.querySelector('.tool-list-footer span:last-child');
  if (catalogFooter) catalogFooter.textContent = 'Full catalog: loading authenticated /admin/api/tools';

  var invokeBtn = document.getElementById('preview-invoke-btn');
  if (invokeBtn) {
    DW.disable(invokeBtn, 'Admin MCP-tool invocation is not exposed by this control-plane UI.');
    invokeBtn.textContent = 'Invocation unavailable';
    invokeBtn.addEventListener('click', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
  }
  var evidence = document.getElementById('tool-evidence');
  if (evidence) evidence.innerHTML = '<span class="evidence-dot"></span><div><strong>Not invoked</strong><small>This Admin surface exposes the live catalog and schema only. No tools/call endpoint is available here.</small></div>';
  var inspectorFoot = document.querySelector('.tool-inspector-foot');
  if (inspectorFoot) inspectorFoot.textContent = 'Runtime-backed catalog · display-only in Admin · no fabricated invocation evidence';

  var data;
  try { data = await DW.get('/admin/api/tools'); }
  catch (_) {
    DW.empty(list, 'Tool catalog unavailable', 'The Admin API did not return the authenticated runtime tool catalog.');
    if (count) count.textContent = 'Tool catalog unavailable';
    setProtocolStage(0, 'Admin catalog', 'Unavailable');
    setProtocolStage(1, 'tools/list', 'Unavailable');
    setProtocolStage(2, 'Metadata', 'Unavailable');
    if (catalogFooter) catalogFooter.textContent = 'Full catalog unavailable — /admin/api/tools did not return authoritative data';
    DW.text('inspector-tool-name', 'Backend unavailable');
    DW.text('inspector-tool-scope', '—');
    DW.text('inspector-description', 'No authoritative tool metadata is available.');
    return;
  }
  var catalog = Array.isArray(data.tools) ? data.tools : [];
  var liveCount = Number(data.count == null ? catalog.length : data.count);
  setProtocolStage(0, 'Admin catalog', 'Available');
  setProtocolStage(1, 'tools/list', liveCount + ' tools');
  setProtocolStage(2, 'Metadata', 'Schemas + annotations');
  if (catalogFooter) catalogFooter.textContent = 'Full catalog: ' + liveCount + ' tools from authenticated /admin/api/tools';

  if (!catalog.length) {
    DW.empty(list, 'No tools exposed', 'The authenticated runtime catalog is empty.');
    if (count) count.textContent = '0 tools from the live catalog';
    DW.text('inspector-tool-name', 'No tool selected');
    DW.text('inspector-tool-scope', '—');
    DW.text('inspector-description', 'The runtime catalog returned no tools.');
    return;
  }

  function scopeOf(t) {
    var n = String(t.name || '');
    if (n.indexOf('cf_') === 0) return 'cloudflare';
    if (n.indexOf('hf_') === 0) return 'huggingface';
    if (n.indexOf('web_') === 0 || n.indexOf('search') !== -1 || n.indexOf('crawl') !== -1 || n.indexOf('fetch') !== -1) return 'internet';
    if (n.indexOf('exec') !== -1 || n.indexOf('run_') === 0 || n.indexOf('code') !== -1 || n.indexOf('gh_') === 0) return 'execution';
    if (n.indexOf('proxy') !== -1) return 'proxyharvest';
    return 'mcp';
  }
  function scopeLabel(s) {
    return s === 'internet' ? 'Internet Intelligence' : s === 'cloudflare' ? 'Cloudflare'
      : s === 'huggingface' ? 'Hugging Face Hub' : s === 'execution' ? 'Execution'
      : s === 'proxyharvest' ? 'ProxyHarvest' : 'MCP Tool';
  }
  function iconFor(s) {
    return s === 'internet' ? 'i-search' : s === 'cloudflare' ? 'i-db' : s === 'huggingface' ? 'i-cube'
      : s === 'execution' ? 'i-terminal' : s === 'proxyharvest' ? 'i-heart' : 'i-nodes';
  }
  function modeOf(t) {
    var a = t.annotations || {};
    if (a.destructiveHint === true) return 'destructive';
    if (a.readOnlyHint === true) return 'read';
    if (String(t.name || '').indexOf('exec') !== -1 || String(t.name || '').indexOf('run_') === 0) return 'execute';
    return 'mixed';
  }
  function guardOf(t) {
    var a = t.annotations || {};
    if (a.destructiveHint === true) return { cls: 'danger', label: 'Destructive' };
    if (a.openWorldHint === true) return { cls: 'open', label: 'Open world' };
    return { cls: 'shield', label: 'Boundary aware' };
  }
  function schemaOf(t) {
    var schema = t.inputSchema || {};
    var props = schema.properties || {};
    var required = Array.isArray(schema.required) ? schema.required : [];
    var parts = Object.keys(props).map(function (key) {
      var p = props[key] || {};
      var type = p.type || (p.enum ? p.enum.join('|') : 'any');
      return key + ':' + type + (required.indexOf(key) !== -1 ? '*' : '');
    });
    return parts.length ? parts.join(' | ') : 'no input parameters';
  }
  function annotationsOf(t) {
    var a = t.annotations || {};
    var keys = Object.keys(a);
    return keys.length ? keys.map(function (k) { return k + '=' + a[k]; }).join(' | ') : 'no protocol annotations';
  }
  function modeLabel(m) { return m === 'read' ? 'Read' : m === 'destructive' ? 'Write' : m === 'execute' ? 'Execute' : 'Mixed'; }
  function modeClass(m) { return m === 'read' ? 'read' : m === 'destructive' ? 'danger' : m === 'execute' ? 'exec' : 'mixed'; }

  var tools = catalog.map(function (t) {
    var scope = scopeOf(t), mode = modeOf(t), guard = guardOf(t);
    return {
      name: t.name, scope: scope, mode: mode, guard: guard,
      description: t.description || 'No description supplied by the catalog.',
      schema: schemaOf(t), annotations: annotationsOf(t),
      protocol: (t.annotations && t.annotations.readOnlyHint === true) ? 'Read-only' : 'Schema'
    };
  });
  list.innerHTML = tools.map(function (t, i) {
    return '<button class="mcp-tool-row' + (i === 0 ? ' selected' : '') + '"' +
      ' data-name="' + DW.esc(t.name) + '" data-scope="' + DW.esc(t.scope) + '" data-mode="' + DW.esc(t.mode) + '"' +
      ' data-guard="' + DW.esc(t.guard.label) + '" data-protocol="' + DW.esc(t.protocol) + '"' +
      ' data-description="' + DW.esc(t.description) + '" data-schema="' + DW.esc(t.schema) + '"' +
      ' data-annotations="' + DW.esc(t.annotations) + '">' +
      '<div class="tool-ident"><span class="tool-glyph ' + DW.esc(t.scope) + '"><svg class="icon"><use href="#' + iconFor(t.scope) + '"/></svg></span>' +
      '<span><strong>' + DW.esc(t.name) + '</strong><small>' + DW.esc(scopeLabel(t.scope)) + '</small></span></div>' +
      '<div><span class="tool-mode ' + modeClass(t.mode) + '">' + modeLabel(t.mode) + '</span></div>' +
      '<div><span class="tool-guard ' + t.guard.cls + '"><i></i>' + DW.esc(t.guard.label) + '</span></div>' +
      '<div><span class="tool-protocol">' + DW.esc(t.protocol) + '</span></div></button>';
  }).join('');

  var rows = [].slice.call(list.querySelectorAll('.mcp-tool-row'));
  function selectTool(row) {
    if (!row) return;
    rows.forEach(function (r) { r.classList.toggle('selected', r === row); });
    var scope = row.dataset.scope, mode = row.dataset.mode;
    DW.text('inspector-tool-name', row.dataset.name);
    DW.text('inspector-tool-scope', scopeLabel(scope));
    DW.text('inspector-description', row.dataset.description);
    var schema = document.getElementById('inspector-schema');
    if (schema) schema.innerHTML = row.dataset.schema.split('|').map(function (p) { return '<code>' + DW.esc(p.trim()) + '</code>'; }).join('');
    DW.text('inspector-annotations', row.dataset.annotations.split('|').join(' · '));
    var icon = document.getElementById('inspector-tool-icon');
    if (icon) icon.innerHTML = '<svg class="icon"><use href="#' + iconFor(scope) + '"/></svg>';
    var modeEl = document.getElementById('inspector-mode');
    if (modeEl) { modeEl.className = 'inspector-mode ' + modeClass(mode); modeEl.textContent = modeLabel(mode); }
    if (evidence) evidence.innerHTML = '<span class="evidence-dot"></span><div><strong>Not invoked</strong><small>Live schema and annotations are shown above; Admin tools/call is intentionally unavailable.</small></div>';
  }
  rows.forEach(function (row) { row.addEventListener('click', function () { selectTool(row); }); });
  selectTool(rows[0]);

  var search = document.getElementById('mcp-tool-search');
  var filterBtn = document.getElementById('tool-filter-btn');
  var scopeItems = [].slice.call(document.querySelectorAll('.scope-item[data-scope]'));
  var scope = 'all', mode = 'all';
  function applyFilters() {
    var q = search ? search.value.trim().toLowerCase() : '';
    var visible = 0, first = null;
    rows.forEach(function (row) {
      var qMatch = !q || row.dataset.name.toLowerCase().indexOf(q) !== -1 ||
        row.dataset.description.toLowerCase().indexOf(q) !== -1 || row.textContent.toLowerCase().indexOf(q) !== -1;
      var scopeMatch = scope === 'all' || row.dataset.scope === scope;
      var modeMatch = mode === 'all' || row.dataset.mode === mode;
      var show = qMatch && scopeMatch && modeMatch;
      row.style.display = show ? '' : 'none';
      if (show) { visible++; if (!first) first = row; }
    });
    if (count) count.textContent = visible + ' tools from the live catalog';
    if (first && !rows.some(function (r) { return r.classList.contains('selected') && r.style.display !== 'none'; })) selectTool(first);
  }
  if (search) search.addEventListener('input', function (event) {
    event.stopImmediatePropagation(); applyFilters();
  }, true);
  scopeItems.forEach(function (btn) {
    btn.addEventListener('click', function (event) {
      event.preventDefault(); event.stopImmediatePropagation();
      scope = btn.dataset.scope || 'all';
      scopeItems.forEach(function (b) { b.classList.toggle('active', b === btn); });
      applyFilters();
    }, true);
  });
  if (filterBtn) filterBtn.addEventListener('click', function (event) {
    event.preventDefault(); event.stopImmediatePropagation();
    var modes = ['all', 'read', 'mixed', 'execute', 'destructive'];
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    var label = mode === 'all' ? 'All annotations' : mode === 'read' ? 'Read-only tools'
      : mode === 'mixed' ? 'Mixed access' : mode === 'execute' ? 'Execution tools' : 'Guarded writes';
    filterBtn.dataset.mode = mode;
    filterBtn.innerHTML = '<svg class="icon"><use href="#i-bars"/></svg>' + label;
    applyFilters();
  }, true);
  if (count) count.textContent = tools.length + ' tools from the live catalog';
})();
`;

const ROUTING_ADAPTER = String.raw`
(async function () {
  DW.wireNav();
  DW.disable('#simulate-route-btn', 'Route simulation is not implemented by the Admin API.');
  var simulateBtn=document.getElementById('simulate-route-btn');if(simulateBtn){simulateBtn.textContent='Simulation unavailable';simulateBtn.addEventListener('click',function(event){event.preventDefault();event.stopImmediatePropagation();},true);}
  var editRuleBtn=document.getElementById('edit-rule-btn');if(editRuleBtn){editRuleBtn.disabled=false;editRuleBtn.removeAttribute('aria-disabled');editRuleBtn.style.opacity='';editRuleBtn.style.cursor='';editRuleBtn.textContent='Edit target';}
  var aliasColumn=document.querySelector('.alias-column'),targetColumn=document.querySelector('.target-column'),rulesStrip=document.querySelector('.rules-strip-head');
  var aliasLabel=aliasColumn&&aliasColumn.querySelector('.column-label'),targetLabel=targetColumn&&targetColumn.querySelector('.column-label');
  if(aliasColumn)aliasColumn.innerHTML=aliasLabel?aliasLabel.outerHTML:''; if(targetColumn)targetColumn.innerHTML=targetLabel?targetLabel.outerHTML:'';
  var section=rulesStrip?rulesStrip.parentNode:null; if(section)[].slice.call(section.querySelectorAll('.rule-card')).forEach(function(c){c.remove();});
  var countEl=section&&section.querySelector('.rules-count'); if(countEl)countEl.textContent='Loading rules…';
  var rules=[],models=[];
  try { var data=await DW.get('/admin/api/routing'); rules=Array.isArray(data.rules)?data.rules:(Array.isArray(data.routing)?data.routing:[]); }
  catch(_){ if(countEl)countEl.textContent='Routing unavailable'; if(aliasColumn)DW.empty(aliasColumn,'Routing unavailable','The Admin API did not return routing state.'); if(targetColumn)DW.empty(targetColumn,'Targets unavailable','No authoritative routing targets are available.'); DW.text('route-inspector-alias','Backend unavailable'); DW.text('route-inspector-target','—'); return; }
  try { var md=await DW.get('/admin/api/models'); models=Array.isArray(md.models)?md.models:[]; } catch(_) { models=[]; }
  if(!rules.length){ if(countEl)countEl.textContent='0 rules'; if(aliasColumn)DW.empty(aliasColumn,'No aliases','D1 returned no routing rules.'); if(targetColumn)DW.empty(targetColumn,'No targets','No model targets are configured.'); DW.text('route-inspector-alias','No route selected'); DW.text('route-inspector-target','—'); var av0=document.getElementById('availability-card');if(av0){var s0=av0.querySelector('strong');if(s0)s0.textContent='0 / 0 aliases resolvable';} return; }
  function stateOf(r){return String(r.state||'BROKEN');} function isActive(r){return stateOf(r)==='ACTIVE';} function iconFor(alias){return alias==='fast'?'i-bolt':alias==='coding'?'i-terminal':alias==='research'?'i-search':'i-route';}
  if(aliasColumn)aliasColumn.innerHTML=(aliasLabel?aliasLabel.outerHTML:'')+rules.map(function(r,i){return '<button class="alias-node'+(i===0?' selected':'')+(isActive(r)?'':' broken')+'" data-alias="'+DW.esc(r.public_alias)+'" data-target="'+DW.esc(r.model_id)+'" data-provider="'+DW.esc(r.provider_id||'')+'"><span class="node-icon '+DW.esc(r.public_alias)+'"><svg class="icon"><use href="#'+iconFor(r.public_alias)+'"/></svg></span><span><strong>'+DW.esc(r.public_alias)+'</strong><small>'+DW.esc(isActive(r)?'Resolves to an enabled model':stateOf(r).replace(/_/g,' ').toLowerCase())+'</small></span><i class="node-state" style="background:'+(isActive(r)?'#12ad69':'#d59a38')+'"></i></button>';}).join('');
  var targets=[];rules.forEach(function(r){if(targets.indexOf(r.model_id)===-1)targets.push(r.model_id);});
  var activeCount=rules.filter(isActive).length;
  var contract=document.querySelectorAll('.contract-meta > div');
  if(contract[1]){var ca=contract[1].querySelector('strong');if(ca)ca.textContent=String(activeCount);}
  if(contract[2]){var ct=contract[2].querySelector('strong');if(ct)ct.textContent=targets.length+(targets.length===1?' model':' models');}
  var topoCopy=document.querySelector('.topology-head p');if(topoCopy)topoCopy.textContent=rules.length+' aliases resolve through D1 policy gates; '+activeCount+' currently callable across '+targets.length+' model target'+(targets.length===1?'':'s')+'.';
  if(targetColumn)targetColumn.innerHTML=(targetLabel?targetLabel.outerHTML:'')+targets.map(function(t,i){var owner=rules.filter(function(r){return r.model_id===t;})[0],callable=isActive(owner);return '<button class="target-node'+(i===0?' selected':'')+'" data-target="'+DW.esc(t)+'"><span class="target-icon"><svg class="icon"><use href="#i-cube"/></svg></span><span><strong>'+DW.esc(t)+'</strong><small>'+DW.esc(owner.provider_id||'—')+'</small></span><span class="target-status" style="'+(callable?'':'background:#fff4e8;color:#99651b;')+'"><i style="'+(callable?'':'background:#d59a38;')+'"></i>'+(callable?'Callable':'Blocked')+'</span></button>';}).join('');
  if(section){if(countEl)countEl.textContent=rules.length+(rules.length===1?' rule':' rules');section.insertAdjacentHTML('beforeend',rules.map(function(r,i){return '<button class="rule-card'+(i===0?' selected':'')+'" data-alias="'+DW.esc(r.public_alias)+'" data-target="'+DW.esc(r.model_id)+'"><span class="rule-route"><strong>'+DW.esc(r.public_alias)+'</strong><i></i><strong>'+DW.esc(r.model_id)+'</strong></span><span class="rule-meta">D1 · '+DW.esc(stateOf(r).replace(/_/g,' ').toLowerCase())+'</span></button>';}).join(''));}
  var aliasNodes=[].slice.call(document.querySelectorAll('.alias-node')),targetNodes=[].slice.call(document.querySelectorAll('.target-node')),ruleCards=[].slice.call(document.querySelectorAll('.rule-card'));
  var activeAlias='';
  function select(alias){var route=rules.filter(function(r){return r.public_alias===alias;})[0];if(!route)return;activeAlias=alias;aliasNodes.forEach(function(n){n.classList.toggle('selected',n.dataset.alias===alias);});targetNodes.forEach(function(n){n.classList.toggle('selected',n.dataset.target===route.model_id);});ruleCards.forEach(function(c){c.classList.toggle('selected',c.dataset.alias===alias);});DW.text('route-inspector-alias',alias);DW.text('route-inspector-target','→ '+route.model_id);DW.text('chain-alias',alias);DW.text('fact-target',route.model_id);DW.text('fact-provider',route.provider_id||'—');DW.text('sim-alias',alias);DW.text('sim-target',route.model_id);var pill=document.getElementById('route-status-pill');if(pill){var active=isActive(route);pill.className='route-status-pill '+(active?'callable':'blocked');pill.textContent=stateOf(route).replace(/_/g,' ');}var modelEnabled=route.model_enabled===1,providerEnabled=route.provider_enabled===1;[['chain-model',modelEnabled],['chain-provider',providerEnabled],['chain-callable',isActive(route)],['chain-line-provider',modelEnabled&&providerEnabled],['chain-line-callable',isActive(route)]].forEach(function(pair){var el=document.getElementById(pair[0]);if(!el)return;el.classList.toggle('off',!pair[1]);if(pair[0].indexOf('line')!==-1)el.classList.toggle('active',pair[1]);});}
  function openRuleModal(alias){var route=rules.filter(function(r){return r.public_alias===alias;})[0];if(!route)return;if(!models.length){if(window.DreamWorkerRoutingUI)window.DreamWorkerRoutingUI.showToast('Model registry unavailable; cannot edit route target.','error','Routing');return;}var old=document.getElementById('dw-routing-modal');if(old)old.remove();var wrap=document.createElement('div');wrap.id='dw-routing-modal';wrap.className='dw-modal-backdrop';wrap.innerHTML='<div class="dw-modal" role="dialog" aria-modal="true"><div class="dw-modal-head"><div><h3>Edit route target</h3><p>Updates the D1 routing rule. Provider readiness is still enforced by runtime callability.</p></div><button class="dw-modal-close" data-close-route>×</button></div>'+
    '<form id="dw-routing-form"><div class="dw-form-grid"><div class="dw-field full"><label>Alias</label><input value="'+DW.esc(alias)+'" disabled></div><div class="dw-field full"><label>Target model</label><select id="dw-routing-target">'+models.map(function(m){return '<option value="'+DW.esc(m.id)+'"'+(m.id===route.model_id?' selected':'')+'>'+DW.esc(m.id+' · '+(m.provider_id||'provider unknown')+(m.available===true?' · callable':' · unavailable'))+'</option>';}).join('')+'</select><small>Changing the target does not loosen auth, health, or provider enablement gates.</small></div></div><div id="dw-routing-error" class="dw-form-error"></div><div class="dw-modal-actions"><button type="button" data-close-route>Cancel</button><button type="submit" class="primary">Save target</button></div></form></div>';document.body.appendChild(wrap);function close(){wrap.remove();}wrap.addEventListener('click',function(e){if(e.target===wrap||(e.target.closest&&e.target.closest('[data-close-route]')))close();});wrap.querySelector('#dw-routing-form').addEventListener('submit',async function(e){e.preventDefault();var modelId=wrap.querySelector('#dw-routing-target').value;var errEl=wrap.querySelector('#dw-routing-error');errEl.style.display='none';var submit=e.target.querySelector('.primary');submit.disabled=true;try{await DW.send('/admin/api/routing/'+encodeURIComponent(alias),'PATCH',{modelId:modelId});if(window.DreamWorkerRoutingUI)window.DreamWorkerRoutingUI.showToast(alias+' target saved in D1.','success','Routing');close();window.location.reload();}catch(err){errEl.textContent=String(err.message||err);errEl.style.display='block';submit.disabled=false;}});}
  aliasNodes.forEach(function(n){n.addEventListener('click',function(){select(n.dataset.alias);});});ruleCards.forEach(function(c){c.addEventListener('click',function(){select(c.dataset.alias);});});select(rules[0].public_alias);
  if(editRuleBtn)editRuleBtn.addEventListener('click',function(event){event.preventDefault();event.stopImmediatePropagation();openRuleModal(activeAlias);},true);
  var active=rules.filter(isActive).length,av=document.getElementById('availability-card');if(av){var strong=av.querySelector('strong');if(strong)strong.textContent=active+' / '+rules.length+' aliases resolvable';}
})();
`;

const HEALTH_ADAPTER = String.raw`
(async function () {
  DW.wireNav();
  var badge=document.getElementById('live-status-badge');
  var empty=document.getElementById('history-empty');
  var runBtn=document.getElementById('run-health-preview-btn');
  if(runBtn)runBtn.textContent='Run health test';
  if(badge){badge.className='live-status-badge neutral';badge.innerHTML='<i></i>Loading authoritative health state';}
  DW.text('radar-state','LOADING'); DW.text('radar-latency','Latency —'); DW.text('fact-health-state','—'); DW.text('fact-health-latency','—'); DW.text('fact-last-success','—'); DW.text('fact-last-error','—');
  var providers=[],history=[];
  try { var pd=await DW.get('/admin/api/providers'); providers=Array.isArray(pd.providers)?pd.providers:[]; }
  catch(_){ if(badge){badge.className='live-status-badge error';badge.innerHTML='<i></i>Provider registry unavailable';} DW.text('radar-state','UNAVAILABLE');DW.text('diagnostic-title','Health backend unavailable');DW.text('diagnostic-message','The Admin API did not return authoritative provider state.');if(empty)DW.empty(empty,'Health history unavailable','Provider state could not be loaded.');if(runBtn)DW.disable(runBtn,'Health tests require a loaded provider.');return; }
  try { var hd=await DW.get('/admin/api/health'); history=Array.isArray(hd.checks)?hd.checks:[]; } catch(_){ history=[]; }
  var META={HEALTHY:{cls:'healthy',title:'Upstream request succeeded',message:'The last upstream call succeeded.'},DEGRADED:{cls:'limited',title:'Upstream responded with degraded behavior',message:'The provider answered, but not cleanly.'},RATE_LIMITED:{cls:'limited',title:'Upstream returned HTTP 429',message:'The provider is rate limiting this account.'},AUTH_ERROR:{cls:'auth',title:'Upstream returned 401 or 403',message:'Credential rejected. Verify the provider binding.'},NOT_CONFIGURED:{cls:'neutral',title:'Required gateway settings missing',message:'This provider is not fully configured.'},CONFIGURED:{cls:'neutral',title:'Credential stored, not yet tested',message:'A credential is bound but no successful upstream call has been recorded yet.'},DISABLED:{cls:'neutral',title:'Provider is disabled',message:'This provider is disabled in the registry.'},REVOKED:{cls:'error',title:'Credential revoked',message:'The stored credential was deleted.'},UPSTREAM_ERROR:{cls:'error',title:'Upstream request failed',message:'The last upstream health test failed.'},UNKNOWN:{cls:'neutral',title:'No health test recorded yet',message:'Run a health test to persist an authoritative state.'}};
  function metaFor(state){return META[state]||META.UNKNOWN;}
  var current=providers.filter(function(p){return p.enabled===1;})[0]||providers[0]||null;
  function apply(provider){if(!provider)return;current=provider;var state=String(provider.health_state||'UNKNOWN'),meta=metaFor(state);if(badge){badge.className='live-status-badge '+meta.cls;badge.innerHTML='<i></i>'+DW.esc(provider.id)+' · '+DW.esc(state);}DW.text('radar-state',state);DW.text('radar-latency','Latency '+DW.ms(provider.last_latency_ms));DW.text('fact-health-state',state);DW.text('fact-health-latency',DW.ms(provider.last_latency_ms));DW.text('fact-last-success',DW.rel(provider.last_success_at));DW.text('fact-last-error',provider.last_error_at?DW.rel(provider.last_error_at):'—');DW.text('diagnostic-title',meta.title);DW.text('diagnostic-message',provider.last_error_message?String(provider.last_error_message):meta.message);[].slice.call(document.querySelectorAll('#health-state-selector .state-option')).forEach(function(btn){btn.classList.toggle('selected',btn.dataset.state===state);});}
  if(!current){if(badge){badge.className='live-status-badge neutral';badge.innerHTML='<i></i>No providers registered';}DW.text('radar-state','NO PROVIDERS');DW.text('diagnostic-title','No provider health to inspect');DW.text('diagnostic-message','The provider registry is empty.');if(empty)DW.empty(empty,'No health checks','There are no registered providers or persisted health checks.');if(runBtn)DW.disable(runBtn,'No provider is available to test.');return;}
  apply(current);
  if(empty){if(history.length){empty.innerHTML=history.map(function(c){var meta=metaFor(String(c.state||'UNKNOWN'));return '<button class="state-option" data-provider="'+DW.esc(c.provider_id)+'"><i class="state-dot '+meta.cls+'"></i><span><strong>'+DW.esc(c.provider_id)+'</strong><small>'+DW.esc(c.state||'UNKNOWN')+' · '+DW.esc(DW.ms(c.latency_ms))+' · '+DW.esc(DW.rel(c.checked_at))+'</small></span></button>';}).join('');empty.addEventListener('click',function(event){var btn=event.target&&event.target.closest?event.target.closest('[data-provider]'):null;if(!btn)return;var match=providers.filter(function(p){return p.id===btn.dataset.provider;})[0];if(match)apply(match);},true);}else{DW.empty(empty,'No health checks recorded','Provider state is loaded, but D1 has no persisted health-check history.');}}
  [].slice.call(document.querySelectorAll('#health-state-selector .state-option')).forEach(function(btn){btn.addEventListener('click',function(){var match=providers.filter(function(p){return String(p.health_state)===btn.dataset.state;})[0];if(match)apply(match);});});
  if(runBtn)runBtn.addEventListener('click',async function(event){if(!current)return;event.preventDefault();event.stopImmediatePropagation();runBtn.disabled=true;var old=runBtn.innerHTML;runBtn.textContent='Testing…';try{await DW.send('/admin/api/providers/'+encodeURIComponent(current.id)+'/health-test','POST');var fresh=await DW.get('/admin/api/providers');providers=Array.isArray(fresh.providers)?fresh.providers:providers;var again=providers.filter(function(p){return p.id===current.id;})[0];apply(again||current);if(window.DreamWorkerHealthUI)window.DreamWorkerHealthUI.showToast('Health test complete for '+current.id+'.','success','Health');}catch(err){if(window.DreamWorkerHealthUI)window.DreamWorkerHealthUI.showToast(String(err.message||err),'error','Health');}finally{runBtn.disabled=false;runBtn.innerHTML=old;}},true);
})();
`;

const AUDIT_ADAPTER = String.raw`
(function () {
  DW.wireNav();
  var list = document.getElementById('audit-event-list');
  if (list && !list.children.length) DW.empty(list, 'Loading audit journal', 'Waiting for persisted D1 audit events.');
})();
`;

const SETTINGS_ADAPTER = String.raw`
(function () {
  DW.wireNav();
  DW.wireLogout();
})();
`;

const LOGIN_ADAPTER = String.raw`
(function () {
  document.title = 'cf-control-mcp — Admin · DreamWorker MCP Control Plane';
  if (!document.getElementById('dw-login-live-style')) {
    var style = document.createElement('style');
    style.id = 'dw-login-live-style';
    style.textContent = [
      'html,body{overscroll-behavior:none}',
      '.login-card,.field,.input-shell,.form-feedback,.hero-copy,.quote,.footer{min-width:0}',
      '.input-shell input{min-width:0;text-overflow:ellipsis}',
      '.signin,.social,.lang-btn,.icon-btn{white-space:nowrap;flex-shrink:0}',
      '.field-head span,.subtitle,.account,.form-feedback span:last-child,.hero-copy p,.footer span,.footer a{overflow:hidden;text-overflow:ellipsis}',
      '.form-feedback span:last-child{white-space:normal;overflow-wrap:anywhere}',
      '.socials{min-width:0;overflow:hidden}',
      '.top-actions{min-width:0}',
      '.dw-auth-note{display:flex;align-items:flex-start;gap:9px;margin:12px 0 15px;padding:10px 11px;border:1px solid #dce7f2;border-radius:9px;background:linear-gradient(135deg,rgba(246,251,255,.96),rgba(247,253,251,.94));color:#6278a2;font-size:9px;line-height:1.45}',
      '.dw-auth-note i{width:9px;height:9px;flex:none;margin-top:2px;border-radius:50%;background:#12ad69;box-shadow:0 0 0 4px rgba(18,173,105,.09)}',
      '.dw-auth-note strong{display:block;margin-bottom:2px;color:#234b7d;font-size:9.5px}.dw-auth-note span{display:block}',
      '.login-card[data-auth-contract="owner-token-only"] .signin{margin-top:7px}.login-card[data-auth-contract="owner-token-only"] .subtitle{margin-bottom:23px}',
      '.login-card[data-auth-contract="owner-token-only"] .account{color:#7890b4}',
      ':root{--dw-login-focus:0 0 0 3px rgba(31,116,231,.12)}',
      '.viewport{background:radial-gradient(760px 420px at 14% 14%,rgba(38,143,231,.13),transparent 64%),radial-gradient(680px 380px at 88% 86%,rgba(41,213,180,.10),transparent 66%),linear-gradient(180deg,#f4f9fd,#e9f1f8)!important}',
      '.stage{box-shadow:0 36px 96px rgba(14,46,84,.22),0 0 0 1px rgba(112,155,199,.13)!important;background:radial-gradient(620px 300px at 80% 24%,rgba(36,151,226,.08),transparent 70%),linear-gradient(180deg,#fbfdff,#f7faff)!important}',
      '.brand-login{filter:drop-shadow(0 8px 18px rgba(20,96,179,.12))}',
      '.login-card{position:relative;border-color:#d8e5f1!important;border-radius:18px!important;background:radial-gradient(290px 150px at 100% 0%,rgba(40,155,228,.07),transparent 72%),rgba(255,255,255,.985)!important;box-shadow:0 26px 68px rgba(17,52,91,.14),inset 0 1px 0 rgba(255,255,255,.9)!important;overflow:hidden}',
      '.login-card:before{content:\'\';position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,#176ff2,#20bce8 52%,#29d5b4);opacity:.88}',
      '.login-card h1{letter-spacing:-.65px!important;color:#0d2a5d!important;text-shadow:0 1px 0 #fff}',
      '.login-card .subtitle{color:#6f84aa!important;line-height:1.45}',
      '.input-shell{transition:border-color .17s ease,box-shadow .17s ease,background .17s ease!important;background:linear-gradient(180deg,#fbfdff,#f7fbff)!important}',
      '.input-shell:hover{border-color:#bfd4e8!important;background:#fff!important}',
      '.input-shell:focus-within{border-color:#83b6e9!important;background:#fff!important;box-shadow:var(--dw-login-focus)!important}',
      '.field-head span{color:#385e8e!important;font-weight:720!important}',
      '.eye{transition:background .15s ease,color .15s ease,transform .15s ease}.eye:hover{background:#eef6fd!important;color:#1d6fd7!important;transform:translateY(-1px)}',
      '.signin{border:0!important;background:linear-gradient(135deg,#176ff2 0%,#238be8 55%,#20a9dc 100%)!important;box-shadow:0 12px 26px rgba(26,112,221,.22),inset 0 1px 0 rgba(255,255,255,.22)!important;transition:transform .16s ease,box-shadow .16s ease,filter .16s ease!important}',
      '.signin:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 16px 30px rgba(26,112,221,.27),inset 0 1px 0 rgba(255,255,255,.22)!important;filter:saturate(1.06)}',
      '.signin:active:not(:disabled){transform:translateY(0);box-shadow:0 8px 18px rgba(26,112,221,.22)!important}',
      '.signin:focus-visible,.eye:focus-visible{outline:none!important;box-shadow:var(--dw-login-focus)!important}',
      '.dw-auth-note{border-radius:11px!important;border-color:#d6e5f1!important;background:linear-gradient(135deg,#f6fbff 0%,#f5fcf9 100%)!important;box-shadow:inset 3px 0 0 rgba(18,173,105,.30),0 7px 18px rgba(28,70,114,.04)}',
      '.form-feedback{border-radius:10px!important}',
      '.hero-copy .kicker{color:#2a77d9!important;letter-spacing:.13em!important}.hero-copy h2,.hero-copy h1{letter-spacing:-.72px!important;text-shadow:0 1px 0 rgba(255,255,255,.8)}',
      '.quote{background:rgba(255,255,255,.44)!important;border-color:rgba(194,216,236,.72)!important;box-shadow:0 11px 30px rgba(27,68,109,.055)!important;backdrop-filter:blur(6px)}',
      '.wave-field{filter:saturate(1.08) contrast(1.02);opacity:.92}',
      '.footer{color:#7b8eaa!important}',
      '@media(prefers-reduced-motion:reduce){.signin,.input-shell,.eye{transition:none!important}}',
      '@media(max-width:1368px),(max-height:753px){.auth-shell{transform-origin:center center}.login-card{height:auto;max-height:calc(100vh - 120px)}}' 
    ].join('\n');
    document.head.appendChild(style);
  }
  var form = document.getElementById('dreamworker-login-form');
  var email = document.getElementById('auth-email');
  var token = document.getElementById('auth-token');
  var tokenField = token && token.closest ? token.closest('.field') : null;
  var socialButtons = document.querySelectorAll('.social');
  var uiLinks = document.querySelectorAll('[data-ui-link]');

  if (form) {
    form.setAttribute('method', 'post');
    form.setAttribute('action', '/admin/login');
    form.setAttribute('data-auth-contract', 'owner-token-only');
  }
  if (email) {
    // The approved reference validates an email before delegating to the live
    // adapter. Production auth is owner-token-only, so keep a non-routable
    // sentinel solely to satisfy that legacy visual validation and remove the
    // fake account field from the visible UI entirely.
    email.type = 'email';
    email.value = 'owner@admin.invalid';
    var emailField = email.closest ? email.closest('.field') : null;
    if (emailField) {
      emailField.style.display = 'none';
      emailField.setAttribute('aria-hidden', 'true');
    }
    email.readOnly = true;
    email.setAttribute('aria-readonly', 'true');
    email.setAttribute('tabindex', '-1');
    email.setAttribute('autocomplete', 'off');
    email.setAttribute('data-auth-sentinel', 'non-routable');
  }
  if (token) {
    token.setAttribute('name', 'token');
    token.setAttribute('autocomplete', 'current-password');
    token.setAttribute('aria-label', 'Owner token');
    token.setAttribute('placeholder', 'Paste MCP_AUTH_TOKEN');
    token.setAttribute('spellcheck', 'false');
  }
  var heading = document.querySelector('.login-card h1');
  if (heading) heading.textContent = 'Owner access';
  var subtitle = document.querySelector('.login-card .subtitle');
  if (subtitle) subtitle.textContent = 'Authenticate with the deployment owner token';
  if (tokenField) {
    var head = tokenField.querySelector('.field-head span');
    var link = tokenField.querySelector('[data-ui-link]');
    if (head) head.textContent = 'Owner token';
    if (link) {
      link.style.display = 'none';
      link.setAttribute('aria-hidden', 'true');
    }
    if (!document.getElementById('dw-owner-auth-note')) {
      var note = document.createElement('div');
      note.id = 'dw-owner-auth-note';
      note.className = 'dw-auth-note';
      note.innerHTML = '<i></i><div><strong>Owner session</strong><span>MCP_AUTH_TOKEN is verified by the Worker and exchanged for an HttpOnly Admin session cookie. The token is not stored in frontend state.</span></div>';
      tokenField.insertAdjacentElement('afterend', note);
    }
  }
  var divider = document.querySelector('.or');
  if (divider) divider.style.display = 'none';
  var socials = document.querySelector('.socials');
  if (socials) { socials.style.display = 'none'; socials.setAttribute('aria-hidden', 'true'); }
  for (var i = 0; i < socialButtons.length; i++) {
    var button = socialButtons[i];
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('title', 'OAuth sign-in is not enabled for this Admin console.');
    button.style.opacity = '0.42';
    button.style.cursor = 'not-allowed';
    button.style.filter = 'grayscale(.65)';
  }
  for (var j = 0; j < uiLinks.length; j++) {
    var link2 = uiLinks[j];
    link2.setAttribute('aria-disabled', 'true');
    link2.style.pointerEvents = 'none';
    link2.style.opacity = '0.55';
  }
  var account = document.querySelector('.account');
  if (account) account.textContent = 'Owner Token access · OAuth remains intentionally deferred';
  var topActions = document.querySelector('.top-actions');
  if (topActions) { topActions.style.display = 'none'; topActions.setAttribute('aria-hidden', 'true'); }
  var footerLinks = document.querySelectorAll('.footer a');
  for (var fk = 0; fk < footerLinks.length; fk++) {
    footerLinks[fk].setAttribute('aria-disabled', 'true');
    footerLinks[fk].style.pointerEvents = 'none';
    footerLinks[fk].style.textDecoration = 'none';
  }

  // The approved reference owns the validation flow and still emits an email-oriented
  // error string. Keep its byte-locked script untouched, but translate that feedback
  // at the live adapter boundary so the visible UI accurately reflects token-only auth.
  window.addEventListener('dreamworker:auth-validation', function (event) {
    if (!event.detail || event.detail.valid !== false) return;
    var feedbackText = document.getElementById('form-feedback-text');
    if (feedbackText) feedbackText.textContent = 'Enter your Owner Token to continue.';
  });

  window.DreamWorkerAuthAdapter = {
    submit: async function (creds, ctx) {
      var ownerToken = String((creds && (creds.token || creds.password || creds.secret)) || '').trim();
      if ((ownerToken.charAt(0) === '"' && ownerToken.charAt(ownerToken.length - 1) === '"') ||
          (ownerToken.charAt(0) === "'" && ownerToken.charAt(ownerToken.length - 1) === "'")) {
        ownerToken = ownerToken.slice(1, -1).trim();
      }
      if (ownerToken.toLowerCase().indexOf('bearer ') === 0) ownerToken = ownerToken.slice(7).trim();
      if (!ownerToken) { ctx.error('Owner token is required.'); return; }
      ctx.setBusy(true);
      try {
        var res = await fetch('/admin/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ token: ownerToken }),
        });
        if (res.ok) {
          ctx.success('Signed in. Verifying control-plane readiness…');
          window.location.replace('/admin/loading');
          return;
        }
        var data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        var message = (data && data.error) || (res.status === 401 ? 'Invalid owner token.' : 'Unable to sign in.');
        if (message === 'cross_origin_request_rejected') message = 'Security check rejected the sign-in request. Reload this page and try again from the same Admin origin.';
        ctx.error(message);
      } catch (err) {
        ctx.error(String((err && err.message) || err));
      }
    },
  };
})();
`;

const LOADING_ADAPTER = String.raw`
(function () {
  DW.injectLiveStyles();
  var ui = window.DreamWorkerLoadingUI;
  var stage = document.querySelector('.stage');
  var security = document.querySelector('.security');
  var toast = document.getElementById('loading-toast');
  var detail = document.getElementById('loading-detail');
  var title = document.getElementById('loading-title');
  var subtitle = document.getElementById('loading-subtitle');
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var running = false;
  var liveHeading = '';
  var liveSubheading = '';
  var visibleSince = (window.performance && performance.now) ? performance.now() : Date.now();
  var minimumPreloginVisibleMs = 900;

  var endpoints = [
    { label: 'Overview', path: '/admin/api/overview' },
    { label: 'Providers', path: '/admin/api/providers' },
    { label: 'Models', path: '/admin/api/models' },
    { label: 'MCP tools', path: '/admin/api/tools' },
    { label: 'Routing', path: '/admin/api/routing' },
    { label: 'Health', path: '/admin/api/health' },
    { label: 'Usage', path: '/admin/api/usage' },
    { label: 'Audit', path: '/admin/api/logs' },
    { label: 'Settings', path: '/admin/api/settings' },
  ];

  // The approved reference contains a display-only preview timer. The live
  // adapter stops it immediately. Every progress transition below corresponds
  // to an actual browser/server event or a settled Admin API request.
  if (ui && ui.pause) ui.pause();
  if (stage) stage.classList.remove('state-paused');
  if (toast) toast.className = 'loading-toast';

  function setText(node, value) { if (node) node.textContent = value; }

  function applyLiveCopy(heading, subheading) {
    liveHeading = heading;
    liveSubheading = subheading;
    setText(title, heading);
    setText(subtitle, subheading);
  }

  // The approved preview schedules one delayed subtitle transition during its
  // own start(). Keep that display-only callback from overwriting live state.
  if (window.MutationObserver) {
    var copyObserver = new MutationObserver(function () {
      if (title && liveHeading && title.textContent !== liveHeading) title.textContent = liveHeading;
      if (subtitle && liveSubheading && subtitle.textContent !== liveSubheading) subtitle.textContent = liveSubheading;
    });
    if (title) copyObserver.observe(title, { childList: true, characterData: true, subtree: true });
    if (subtitle) copyObserver.observe(subtitle, { childList: true, characterData: true, subtree: true });
  }

  function setStepVisual(step) {
    steps.forEach(function (node, index) {
      node.classList.toggle('done', index < step);
      node.classList.toggle('active', index === step);
    });
  }

  function phase(step, progress, heading, subheading, lead, message) {
    // Do not call the reference preview's setStep(): it schedules a delayed
    // subtitle rewrite. The live adapter owns copy and only reuses the visual
    // nodes/progress primitive.
    setStepVisual(step);
    if (ui && ui.setProgress) ui.setProgress(progress);
    if (stage) stage.classList.remove('state-paused', 'state-error', 'state-success');
    applyLiveCopy(heading, subheading);
    if (detail) detail.innerHTML = '<strong>' + DW.esc(lead) + '</strong> · ' + DW.esc(message || subheading);
  }

  function fail(heading, message, retryTitle) {
    if (ui && ui.setError) ui.setError(message);
    applyLiveCopy(heading, message);
    if (detail) detail.innerHTML = '<strong>Action required</strong> · ' + DW.esc(message);
    if (security) {
      security.style.cursor = 'pointer';
      security.setAttribute('title', retryTitle || 'Retry the real readiness checks');
    }
  }

  async function preloginProbe() {
    var res = await fetch('/admin/api/prelogin', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Pre-login probe failed (HTTP ' + res.status + ')');
    var data = await res.json();
    if (!data || data.ok !== true || typeof data.authenticated !== 'boolean') {
      throw new Error('Pre-login probe returned an invalid response');
    }
    return data;
  }

  async function prepareLogin() {
    phase(1, 42, 'Preparing secure sign-in', 'Session checked', 'Session state', 'No active Admin session · owner sign-in is required');

    // Fetch the exact Login document before navigating to it. A successful
    // response is the real readiness signal for the next visual step.
    phase(2, 68, 'Preparing secure sign-in', 'Loading owner sign-in interface', 'Login shell', 'Fetching the real owner-token sign-in document');
    var res = await fetch('/admin/login?ready=1', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Login interface unavailable (HTTP ' + res.status + ')');
    var html = await res.text();
    if (!html || html.indexOf('/admin/login') === -1 || html.indexOf('id="auth-token"') === -1) {
      throw new Error('Login interface failed its owner-token contract check');
    }

    phase(3, 92, 'Sign-in ready', 'Owner authentication interface is ready', 'Login shell', 'Owner-token sign-in contract verified');
    if (ui && ui.complete) ui.complete('Owner sign-in is ready');
    applyLiveCopy('Sign-in ready', 'Opening the owner authentication interface');
    if (detail) detail.innerHTML = '<strong>Complete</strong> · owner-token sign-in contract verified';

    // Keep the completed Loading composition visible long enough to be
    // perceivable. This dwell never advances readiness: it starts only after
    // the real session probe and Login contract fetch have already succeeded.
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var remaining = Math.max(0, minimumPreloginVisibleMs - (now - visibleSince));
    if (remaining > 0) {
      await new Promise(function (resolve) { window.setTimeout(resolve, remaining); });
    }
    window.location.replace('/admin/login?ready=1');
  }

  function stageFor(completed) {
    if (completed <= 1) return 0;
    if (completed <= 4) return 1;
    if (completed <= 7) return 2;
    return 3;
  }

  function updateBootstrapProgress(completed, label) {
    var progress = Math.round((completed / endpoints.length) * 100);
    var step = stageFor(completed);
    var message = completed === 0
      ? 'Validating the authenticated Admin session'
      : label + ' settled · ' + completed + ' of ' + endpoints.length + ' backend surfaces checked';
    setStepVisual(step);
    if (ui && ui.setProgress) ui.setProgress(progress);
    if (stage) stage.classList.remove('state-paused');
    applyLiveCopy('Loading control plane', completed === 0 ? 'Validating the authenticated Admin session' : message);
  }

  async function probe(endpoint) {
    var res = await fetch(endpoint.path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 401) return { endpoint: endpoint, unauthorized: true, ok: false, status: 401 };
    return { endpoint: endpoint, unauthorized: false, ok: res.ok, status: res.status };
  }

  async function bootstrapAuthenticatedAdmin() {
    updateBootstrapProgress(0, 'Session');

    var completed = 0;
    var results = await Promise.all(endpoints.map(async function (endpoint) {
      try {
        var result = await probe(endpoint);
        completed += 1;
        updateBootstrapProgress(completed, endpoint.label);
        return result;
      } catch (err) {
        completed += 1;
        updateBootstrapProgress(completed, endpoint.label);
        return { endpoint: endpoint, unauthorized: false, ok: false, status: 0, error: String((err && err.message) || err) };
      }
    }));

    if (results.some(function (result) { return result.unauthorized; })) {
      // The signed session changed while the bootstrap was running. Return to
      // the normal pre-login Loading path rather than exposing a stale shell.
      fail('Session expired', 'The Admin session is no longer valid. Returning to secure sign-in.', 'Retry session detection');
      window.location.replace('/admin/login');
      return;
    }

    var failed = results.filter(function (result) { return !result.ok; });
    if (failed.length) {
      var names = failed.map(function (result) {
        return result.endpoint.label + (result.status ? ' (HTTP ' + result.status + ')' : ' (network)');
      });
      var message = failed.length + ' of ' + endpoints.length + ' backend checks failed.';
      fail('Control plane degraded', message, 'Retry failed bootstrap checks');
      if (detail) detail.innerHTML = '<strong>Degraded bootstrap</strong> · ' + DW.esc(names.join(', '));
      return;
    }

    if (ui && ui.complete) ui.complete('All ' + endpoints.length + ' Admin backend surfaces are ready');
    applyLiveCopy('Control plane ready', 'All authenticated Admin surfaces are ready');
    window.location.replace('/admin');
  }

  async function run() {
    if (running) return;
    running = true;
    if (security) {
      security.style.cursor = 'default';
      security.setAttribute('title', 'Checking the real Admin session and backend');
    }

    phase(0, 12, 'Preparing secure access', 'Checking your Admin session', 'Secure session', 'Reading the signed Admin session state');
    try {
      var session = await preloginProbe();
      if (session.authenticated) {
        await bootstrapAuthenticatedAdmin();
      } else {
        await prepareLogin();
      }
    } catch (err) {
      fail('Unable to continue', String((err && err.message) || err), 'Retry secure access checks');
    } finally {
      running = false;
    }
  }

  // In the approved preview this card pauses a timer. In the live page it is
  // a truthful retry surface only when a real check has failed.
  if (security) {
    security.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!running) run();
    }, true);
  }

  run();
})();
`;

const USAGE_ADAPTER = String.raw`
(async function () {
  DW.wireNav(); DW.wireCommandPalette();
  document.querySelectorAll('[data-nav]').forEach(function(n){n.classList.toggle('active',n.dataset.nav==='usage');});
  var heroDate=document.querySelector('.hero .date');if(heroDate)heroDate.textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'});
  var hero=document.querySelector('.hero h1');if(hero)hero.textContent='Usage and activity';var heroSub=document.querySelector('.hero p');if(heroSub)heroSub.textContent='Recorded control-plane activity, registry totals, and instrumentation coverage.';
  var metrics=document.querySelectorAll('.metric');
  function metric(i,title,value,sub){var card=metrics[i];if(!card)return;var t=card.querySelector('.mtitle'),v=card.querySelector('.mvalue'),s=card.querySelector('.msub');if(t)t.textContent=title;if(v)v.textContent=value;if(s)s.textContent=sub;}
  metric(0,'Audit Events','—','Loading D1 activity…');metric(1,'Models','—','Loading registry…');metric(2,'MCP Tools','—','Loading runtime catalog…');metric(3,'Health Checks','—','Loading D1 health history…');
  var pcards=[].slice.call(document.querySelectorAll('.panel.providers .prov'));pcards.forEach(function(c){c.style.display='none';});
  var hrows=[].slice.call(document.querySelectorAll('.panel.health .hrow'));hrows.forEach(function(r){r.style.display='none';});
  var arows=[].slice.call(document.querySelectorAll('.panel.activity .arow'));arows.forEach(function(r){r.style.display='none';});
  var ptitle=document.querySelector('.panel.providers .phtitle');if(ptitle)ptitle.textContent='Activity by action';var psub=document.querySelector('.panel.providers .phsub');if(psub)psub.textContent='Persisted D1 audit action counts';
  var htitle=document.querySelector('.panel.health .phtitle');if(htitle)htitle.textContent='Instrumentation coverage';var hsub=document.querySelector('.panel.health .phsub');if(hsub)hsub.textContent='Available vs not instrumented';
  var atitle=document.querySelector('.panel.activity .phtitle');if(atitle)atitle.textContent='Recent activity';var asub=document.querySelector('.panel.activity .phsub');if(asub)asub.textContent='Latest persisted audit actions';
  var actionView=document.querySelector('.panel.providers .view');if(actionView){actionView.dataset.action='audit';actionView.childNodes[0].nodeValue='View audit ';}
  var recentView=document.querySelector('.panel.activity .view');if(recentView){recentView.dataset.action='audit';recentView.childNodes[0].nodeValue='View audit ';}
  var verifyTools=document.querySelector('[data-action="verify-tools"] .atxt');if(verifyTools)verifyTools.textContent='Inspect Tools';
  var runCode=document.querySelector('[data-action="run-code"]');if(runCode){DW.disable(runCode,'Code execution is not exposed by the Admin UI.');var runText=runCode.querySelector('.atxt');if(runText)runText.textContent='Execution unavailable';}
  document.addEventListener('click',function(event){var btn=event.target&&event.target.closest?event.target.closest('[data-action]'):null;if(!btn)return;var map={'test-providers':'/admin/health','verify-tools':'/admin/tools','view-logs':'/admin/audit',audit:'/admin/audit'};event.preventDefault();event.stopImmediatePropagation();if(btn.dataset.action==='run-code')return;var path=map[btn.dataset.action];if(path)window.location.assign(path);},true);
  var u;
  try{u=await DW.get('/admin/api/usage');}catch(_){metric(0,'Audit Events','—','Usage backend unavailable');metric(1,'Models','—','Usage backend unavailable');metric(2,'MCP Tools','—','Usage backend unavailable');metric(3,'Health Checks','—','Usage backend unavailable');var panels=document.querySelectorAll('.panel .body');if(panels[0])DW.empty(panels[0],'Usage unavailable','The Admin API did not return usage state.');return;}
  var activity=u.activity||{},registry=u.registry||{},health=u.health||{},coverage=u.coverage||{};
  metric(0,'Audit Events',String(activity.totalAuditEvents==null?0:activity.totalAuditEvents),String(activity.last24h==null?0:activity.last24h)+' in last 24h');
  metric(1,'Models',String(registry.models==null?0:registry.models),String(registry.enabledModels==null?0:registry.enabledModels)+' enabled');
  metric(2,'MCP Tools',String(registry.toolCatalogCount==null?0:registry.toolCatalogCount),'Authenticated runtime catalog');
  metric(3,'Health Checks',String(health.totalChecks==null?0:health.totalChecks),health.latest?String(health.latest.state||'UNKNOWN')+' latest state':'No checks recorded');
  var latestState=health.latest?String(health.latest.state||'UNKNOWN').toUpperCase():'UNKNOWN';var healthCheck=metrics[3]&&metrics[3].querySelector('.metric-check');if(healthCheck&&latestState!=='HEALTHY'){healthCheck.style.background=latestState==='RATE_LIMITED'||latestState==='DEGRADED'?'#d79c2e':'#9aa9bd';}
  var actions=Array.isArray(activity.byAction)?activity.byAction:[];actions.slice(0,pcards.length).forEach(function(entry,i){var card=pcards[i];card.style.display='';var icon=card.querySelector('.plogo');if(icon){icon.className='plogo';icon.style.background='#eef5ff';icon.style.color='#176fe6';icon.innerHTML='<svg class="icon" style="width:18px;height:18px"><use href="#i-doc"/></svg>';}var name=card.querySelector('.pname');if(name)name.textContent=entry.action||'unknown.action';var state=card.querySelector('.healthy');if(state)state.innerHTML='<i></i>'+String(entry.count||0)+' events';var badge=card.querySelector('.modelbadge');if(badge)badge.textContent='audit action';var stats=card.querySelectorAll('.pstat');if(stats[0]){var b0=stats[0].querySelector('b'),s0=stats[0].querySelector('small');if(b0)b0.textContent=String(entry.count||0);if(s0)s0.textContent='occurrences';}if(stats[1]){var b1=stats[1].querySelector('b'),s1=stats[1].querySelector('small');if(b1)b1.textContent=activity.totalAuditEvents?Math.round((Number(entry.count||0)/activity.totalAuditEvents)*100)+'%':'0%';if(s1)s1.textContent='of all events';}});
  if(!actions.length){var pb=document.querySelector('.panel.providers .body');if(pb)DW.empty(pb,'No audit activity','D1 has no persisted audit events yet.');}
  var facts=[['Audit journal',coverage.auditActivity],['Health history',coverage.healthChecks],['Registry',coverage.registry],['Tool catalog',coverage.toolCatalog],['Gateway requests',coverage.gatewayRequests],['Token telemetry',coverage.tokens],['Cost telemetry',coverage.cost]];
  facts.slice(0,hrows.length).forEach(function(f,i){var r=hrows[i],meta=f[1]||{};r.style.display='';var comp=r.querySelector('.hcomp'),st=r.querySelector('.hstatus'),lat=r.querySelector('.hlat');if(comp)comp.innerHTML='<i'+(meta.available?'':' style="background:#9aa9bd"')+'></i>'+DW.esc(f[0]);if(st){st.className='hstatus'+(meta.available?'':' disabled');st.innerHTML='<i></i>'+(meta.available?'Available':'Unavailable');}if(lat)lat.textContent=meta.available?(meta.source||'instrumented'):(meta.reason||'not instrumented');});
  var allBadge=document.querySelector('.panel.health .allhealthy');if(allBadge){var available=facts.filter(function(f){return f[1]&&f[1].available;}).length;allBadge.className='allhealthy'+(available===facts.length?'':' warn');allBadge.innerHTML='<i></i>'+available+' / '+facts.length+' surfaces instrumented';}
  var recent=Array.isArray(activity.recentActions)?activity.recentActions:(Array.isArray(u.recentActions)?u.recentActions:[]);recent.slice(0,arows.length).forEach(function(ev,i){var ar=arows[i];ar.style.display='';var b=ar.querySelector('.aevent b'),sp=ar.querySelector('.aevent span'),okEl=ar.querySelector('.success'),tm=ar.querySelector('.atime');if(b)b.textContent=ev.action||'unknown.action';if(sp)sp.textContent=ev.target||'—';if(okEl)okEl.innerHTML='<i></i>Recorded';if(tm)tm.textContent=DW.rel(ev.at);});
  if(!recent.length){var ab=document.querySelector('.panel.activity .body');if(ab)DW.empty(ab,'No recent activity','No audit actions have been persisted yet.');}
})();
`;

/** Per-route adapter scripts, keyed by approved page name. */
const ADAPTERS: Record<string, string> = {
	overview: OVERVIEW_ADAPTER,
	providers: PROVIDERS_ADAPTER,
	models: MODELS_ADAPTER,
	tools: TOOLS_ADAPTER,
	routing: ROUTING_ADAPTER,
	health: HEALTH_ADAPTER,
	usage: USAGE_ADAPTER,
	audit: AUDIT_ADAPTER,
	settings: SETTINGS_ADAPTER,
	login: LOGIN_ADAPTER,
	loading: LOADING_ADAPTER,
};

/**
 * The additive backend script for an approved page.
 * Returns "" when the page has no adapter, so the served document stays
 * byte-identical to the approved reference.
 */
export function adapterScript(page: string): string {
	const body = ADAPTERS[page];
	if (!body) return "";
	const needsHelpers = page !== "login";
	return `\n<script>\n(function(){\n${needsHelpers ? HELPERS : ""}\n${body}\n})();\n</script>\n`;
}

export const ADAPTER_PAGES = Object.keys(ADAPTERS);
