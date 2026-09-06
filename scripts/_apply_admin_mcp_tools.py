from pathlib import Path

BRANCH = "feat/admin-mcp-tools"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"anchor not found: {label}")
    return text.replace(old, new, 1)


def patch_oauth_worker() -> None:
    p = Path("src/oauth-worker.ts")
    s = p.read_text(encoding="utf-8")
    s = replace_once(
        s,
        'import legacyWorker, { type Env } from "./index";',
        'import legacyWorker, { tools, type Env } from "./index";',
        "oauth import tools",
    )
    s = replace_once(
        s,
        'if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return handleAdmin(request, env);',
        'if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return handleAdmin(request, env, tools);',
        "oauth pass tool catalog",
    )
    p.write_text(s, encoding="utf-8")


def patch_admin_router() -> None:
    p = Path("src/admin/router.ts")
    s = p.read_text(encoding="utf-8")

    type_anchor = '''type RoutingState = "ACTIVE" | "MODEL_DISABLED" | "PROVIDER_DISABLED" | "BROKEN";\n'''
    type_block = '''export interface AdminToolCatalogEntry {\n\tname: string;\n\tdescription: string;\n\tinputSchema: Record<string, unknown>;\n\tannotations?: {\n\t\treadOnlyHint?: boolean;\n\t\tdestructiveHint?: boolean;\n\t\tidempotentHint?: boolean;\n\t\topenWorldHint?: boolean;\n\t};\n}\n\ntype RoutingState = "ACTIVE" | "MODEL_DISABLED" | "PROVIDER_DISABLED" | "BROKEN";\n'''
    s = replace_once(s, type_anchor, type_block, "admin tool catalog type")

    s = replace_once(
        s,
        'export async function handleAdmin(request: Request, env: AdminEnv): Promise<Response> {',
        'export async function handleAdmin(\n\trequest: Request,\n\tenv: AdminEnv,\n\ttoolCatalog: readonly AdminToolCatalogEntry[] = [],\n): Promise<Response> {',
        "handleAdmin signature",
    )

    settings_anchor = '''\tif (path === "/admin/api/settings" && request.method === "GET") {\n'''
    tools_route = '''\tif (path === "/admin/api/tools" && request.method === "GET") {\n\t\tconst catalog = toolCatalog.map((tool) => ({\n\t\t\tname: tool.name,\n\t\t\tdescription: tool.description,\n\t\t\tinputSchema: tool.inputSchema,\n\t\t\tannotations: {\n\t\t\t\treadOnlyHint: tool.annotations?.readOnlyHint === true,\n\t\t\t\tdestructiveHint: tool.annotations?.destructiveHint === true,\n\t\t\t\tidempotentHint: tool.annotations?.idempotentHint === true,\n\t\t\t\topenWorldHint: tool.annotations?.openWorldHint === true,\n\t\t\t},\n\t\t}));\n\t\treturn json({\n\t\t\tcount: catalog.length,\n\t\t\treadOnlyCount: catalog.filter((tool) => tool.annotations.readOnlyHint).length,\n\t\t\tdestructiveCount: catalog.filter((tool) => tool.annotations.destructiveHint).length,\n\t\t\topenWorldCount: catalog.filter((tool) => tool.annotations.openWorldHint).length,\n\t\t\ttools: catalog,\n\t\t});\n\t}\n\n\tif (path === "/admin/api/settings" && request.method === "GET") {\n'''
    s = replace_once(s, settings_anchor, tools_route, "admin tools route")
    p.write_text(s, encoding="utf-8")


def patch_admin_ui() -> None:
    p = Path("src/admin/ui.ts")
    s = p.read_text(encoding="utf-8")

    css_anchor = '''input[type=password]{padding:6px;border-radius:4px;border:2px solid var(--border);background:var(--bg);color:var(--text)}\n'''
    css_new = '''input[type=password],input[type=search]{padding:7px 9px;border-radius:4px;border:2px solid var(--border);background:var(--bg);color:var(--text)}\ninput[type=search]{min-width:280px}\n.tool-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px;flex-wrap:wrap}\n.tool-schema{max-width:520px}.tool-schema summary{cursor:pointer;color:#bfdbfe;font-weight:700}.tool-schema pre{white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;background:var(--bg);border:1px solid var(--border);padding:9px;border-radius:4px;font-size:11px}\n.READ_ONLY{background:#1d4ed8}.DESTRUCTIVE{background:var(--bad)}.OPEN_WORLD{background:var(--warn)}.IDEMPOTENT{background:var(--good)}\n'''
    s = replace_once(s, css_anchor, css_new, "admin tools css")

    nav_anchor = '''<button data-tab="models">Models</button>\n<button data-tab="routing">Routing</button>'''
    nav_new = '''<button data-tab="models">Models</button>\n<button data-tab="mcp-tools">MCP Tools</button>\n<button data-tab="routing">Routing</button>'''
    s = replace_once(s, nav_anchor, nav_new, "MCP Tools nav")

    routing_section = '''<section id="routing" class="panel">\n'''
    tools_section = '''<section id="mcp-tools" class="panel">\n  <div class="panel-head"><div><h2>MCP Tools</h2><p>Runtime catalog exposed by the same registry used by MCP tools/list. Handler code and secrets are never returned.</p></div></div>\n  <div class="cards">\n    <div class="card"><div class="card-label">Registered tools</div><div id="stat-tools-total" class="card-value">—</div></div>\n    <div class="card"><div class="card-label">Read-only hint</div><div id="stat-tools-readonly" class="card-value">—</div></div>\n    <div class="card"><div class="card-label">Destructive hint</div><div id="stat-tools-destructive" class="card-value">—</div></div>\n    <div class="card"><div class="card-label">Open-world hint</div><div id="stat-tools-openworld" class="card-value">—</div></div>\n  </div>\n  <div class="tool-toolbar">\n    <div class="muted small" id="tools-filter-summary">Loading tool catalog…</div>\n    <input id="tools-search" type="search" placeholder="Search tools by name or description" autocomplete="off">\n  </div>\n  <div class="table-wrap"><table>\n    <thead><tr><th>Tool</th><th>Description</th><th>Safety / behavior hints</th><th>Input schema</th></tr></thead>\n    <tbody id="tools-body"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>\n  </table></div>\n</section>\n\n<section id="routing" class="panel">\n'''
    s = replace_once(s, routing_section, tools_section, "MCP Tools section")

    notice_anchor = '''let noticeTimer = null;\n'''
    notice_new = '''let noticeTimer = null;\nlet mcpToolsCache = [];\n'''
    s = replace_once(s, notice_anchor, notice_new, "MCP tools cache")

    tab_anchor = '''    if(button.dataset.tab==='models') loadModels();\n    if(button.dataset.tab==='routing') loadRouting();'''
    tab_new = '''    if(button.dataset.tab==='models') loadModels();\n    if(button.dataset.tab==='mcp-tools') loadMcpTools();\n    if(button.dataset.tab==='routing') loadRouting();'''
    s = replace_once(s, tab_anchor, tab_new, "MCP Tools tab loader")

    refresh_anchor = '''  try { await Promise.all([refreshOperational(), loadHealth(), loadLogs()]); showNotice('Admin state refreshed.','ok'); }'''
    refresh_new = '''  try { await Promise.all([refreshOperational(), loadMcpTools(), loadHealth(), loadLogs()]); showNotice('Admin state refreshed.','ok'); }'''
    s = replace_once(s, refresh_anchor, refresh_new, "refresh MCP tools")

    routing_loader_anchor = '''async function loadRouting(){\n'''
    tools_loader = r'''function toolHintsHtml(tool){
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
'''
    s = replace_once(s, routing_loader_anchor, tools_loader, "MCP Tools loader")
    p.write_text(s, encoding="utf-8")


def create_test() -> None:
    p = Path("test/admin-mcp-tools.test.ts")
    p.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { handleAdmin } from "../src/admin/router";
import { createSessionCookie } from "../src/admin/auth";
import { tools } from "../src/index";
import type { AdminEnv } from "../src/admin/types";

function mockEnv(): AdminEnv {
  return {
    MCP_AUTH_TOKEN: "owner-secret",
    DM_DB: {} as D1Database,
  };
}

async function adminCookie(env: AdminEnv): Promise<string> {
  const setCookie = await createSessionCookie(env);
  return setCookie.split(";", 1)[0];
}

test("Admin MCP Tools endpoint mirrors the runtime tool registry without exposing handlers", async () => {
  const env = mockEnv();
  const cookie = await adminCookie(env);
  const request = new Request("https://example.com/admin/api/tools", { headers: { Cookie: cookie } });
  const response = await handleAdmin(request, env, tools);
  assert.equal(response.status, 200);

  const payload: any = await response.json();
  assert.equal(payload.count, tools.length);
  assert.equal(payload.count, 44);
  assert.deepEqual(payload.tools.map((tool: any) => tool.name), tools.map((tool) => tool.name));
  assert.equal(payload.readOnlyCount, tools.filter((tool) => tool.annotations?.readOnlyHint === true).length);
  assert.equal(payload.destructiveCount, tools.filter((tool) => tool.annotations?.destructiveHint === true).length);
  assert.equal(payload.openWorldCount, tools.filter((tool) => tool.annotations?.openWorldHint === true).length);

  for (const tool of payload.tools) {
    assert.equal(typeof tool.name, "string");
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.inputSchema, "object");
    assert.equal("handler" in tool, false);
  }
  assert.equal(JSON.stringify(payload).includes("owner-secret"), false);
});

test("Admin MCP Tools endpoint remains owner-session protected", async () => {
  const env = mockEnv();
  const request = new Request("https://example.com/admin/api/tools");
  const response = await handleAdmin(request, env, tools);
  assert.equal(response.status, 401);
});
''', encoding="utf-8")


patch_oauth_worker()
patch_admin_router()
patch_admin_ui()
create_test()
print("admin MCP Tools patch applied")
