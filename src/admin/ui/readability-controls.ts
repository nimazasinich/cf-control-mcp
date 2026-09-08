const READABILITY_CONTROLS_CSS = String.raw`
/* Readability + semantic-color pass. This is additive and does not rewrite approved reference files. */
#page-mcp-tools .tool-search input{font-size:9.5px!important}
#page-mcp-tools .tool-filter-btn{font-size:8.5px!important}
#page-mcp-tools .tool-list-head{font-size:8px!important}
#page-mcp-tools .mcp-tool-row{min-height:36px!important}
#page-mcp-tools .tool-ident strong{font-size:9.5px!important;line-height:1.2!important}
#page-mcp-tools .tool-ident small{font-size:8px!important;line-height:1.25!important;margin-top:2px!important}
#page-mcp-tools .tool-mode,#page-mcp-tools .tool-guard,#page-mcp-tools .tool-protocol{height:22px!important;padding:0 7px!important;font-size:8px!important;line-height:1!important}
#page-mcp-tools .tool-list-footer{font-size:8px!important}
#page-mcp-tools .scope-head span{font-size:8px!important}
#page-mcp-tools .scope-head strong{font-size:10px!important}
#page-mcp-tools [data-scope] strong{font-size:9px!important}
#page-mcp-tools [data-scope] small{font-size:7.8px!important;line-height:1.25!important}
#page-mcp-tools .tool-inspector-head>div:nth-child(2)>span{font-size:8px!important;letter-spacing:.55px!important}
#page-mcp-tools .tool-inspector-head h2{font-size:11.5px!important;line-height:1.2!important}
#page-mcp-tools .tool-inspector-head p{font-size:8.5px!important;line-height:1.3!important}
#page-mcp-tools .inspector-mode{font-size:8px!important;height:22px!important}
#page-mcp-tools .tool-inspector-body{overflow:auto!important;scrollbar-width:thin}
#page-mcp-tools .inspector-section-label{font-size:8px!important;letter-spacing:.55px!important;margin-bottom:6px!important}
#page-mcp-tools .inspector-description{font-size:9.2px!important;line-height:1.45!important}
#page-mcp-tools .schema-preview code{font-size:8.3px!important;line-height:1.3!important;padding:5px 6px!important}
#page-mcp-tools .annotation-box{font-size:8.5px!important;line-height:1.45!important}
#page-mcp-tools .invoke-node small{font-size:7.5px!important;line-height:1.2!important}
#page-mcp-tools .invoke-node span{font-size:7.8px!important}
#page-mcp-tools .evidence-box strong{font-size:9px!important}
#page-mcp-tools .evidence-box small{font-size:8px!important;line-height:1.4!important}
#page-mcp-tools .preview-invoke-btn,#page-mcp-tools .copy-schema-btn{font-size:8.5px!important}
#page-mcp-tools .tool-inspector-foot{font-size:7.5px!important}

/* Capability is not an error. Reserve red for actual failed/blocked runtime states. */
#page-mcp-tools .tool-mode.destructive{background:#eef3ff!important;color:#425fc0!important}
#page-mcp-tools .tool-protocol.danger{background:#fff2df!important;color:#9a5b12!important}
#page-mcp-tools .tool-glyph.destructive{background:#fff3e5!important;color:#c66a19!important}
#page-mcp-tools .ann.danger{background:#fff2df!important;color:#9a5b12!important;border-color:#f2d2a5!important}

/* Provider readability on the dense canonical table. */
#page-providers .provider-table-head{font-size:8.5px!important}
#page-providers .provider-cell{font-size:9px!important}
#page-providers .provider-ident strong{font-size:9.5px!important}
#page-providers .provider-ident small{font-size:8px!important;line-height:1.25!important}
#page-providers .provider-toolbar-right .toolbar-select,
#page-providers #provider-filter{font-size:9px!important;min-height:30px}
#page-providers [data-provider-view-toggle="true"]{border-color:#b9d4ef!important;background:#f4f9ff!important;color:#205e9f!important;font-weight:750!important}
`;

const PROVIDER_VIEW_SCRIPT = String.raw`(function(){
'use strict';
var mode='active';
function text(el){return el?String(el.textContent||'').trim():'';}
function canonicalRows(){return Array.prototype.slice.call(document.querySelectorAll('#provider-table-body .provider-row'));}
function fallbackRows(){return Array.prototype.slice.call(document.querySelectorAll('#providers-body tr')).filter(function(r){return r.querySelectorAll('td').length>=7;});}
function fallbackActive(row){var cells=row.querySelectorAll('td');var state=cells[1]&&cells[1].querySelector('.state');return text(state||cells[1]).toUpperCase()==='ACTIVE';}
function visibleCount(){var a=canonicalRows();if(a.length)return a.filter(function(r){return r.style.display!=='none';}).length;return fallbackRows().filter(function(r){return r.style.display!=='none';}).length;}
function totalCount(){var a=canonicalRows();return a.length||fallbackRows().length;}
function updateLabels(){
  document.querySelectorAll('[data-provider-view-toggle="true"]').forEach(function(btn){
    btn.textContent=mode==='active'?'Active providers':'All providers';
    btn.dataset.mode=mode;
    btn.setAttribute('aria-pressed',mode==='active'?'true':'false');
    btn.title=mode==='active'?'Showing enabled providers only. Click to show all providers.':'Showing all providers. Click to show enabled providers only.';
  });
  var summary=document.getElementById('provider-summary');
  if(summary&&totalCount())summary.textContent=visibleCount()+' visible of '+totalCount();
}
function apply(){
  canonicalRows().forEach(function(row){row.style.display=(mode==='active'&&row.classList.contains('disabled-row'))?'none':'';});
  fallbackRows().forEach(function(row){row.style.display=(mode==='active'&&!fallbackActive(row))?'none':'';});
  updateLabels();
}
function bindOne(btn){
  if(!btn||btn.dataset.providerViewToggle==='true')return btn;
  var fresh=btn.cloneNode(true);
  fresh.dataset.providerViewToggle='true';
  fresh.removeAttribute('data-provider-filter');
  fresh.id=btn.id||'';
  btn.replaceWith(fresh);
  fresh.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();mode=mode==='active'?'all':'active';apply();});
  return fresh;
}
function bind(){
  var seen=[];
  var simple=document.getElementById('provider-filter');
  if(simple)seen.push(simple);
  var canonical=document.querySelector('[data-provider-filter="status"]');
  if(canonical&&seen.indexOf(canonical)<0)seen.push(canonical);
  seen.forEach(bindOne);
  apply();
}
var observer=new MutationObserver(function(){bind();});
observer.observe(document.body,{childList:true,subtree:true});
bind();
})();`;

export function applyReadabilityControls(html: string): string {
  let out = html.replace('</head>', '<style id="admin-readability-controls">' + READABILITY_CONTROLS_CSS + '</style></head>');
  out = out.replace('</body>', '<script id="admin-provider-view-controls">' + PROVIDER_VIEW_SCRIPT + '</script></body>');
  return out;
}
