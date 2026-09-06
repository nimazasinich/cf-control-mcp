/*
 * VISUAL_ACCEPTANCE_FIXTURE_ONLY
 *
 * Test-only deterministic visual fixture generator for the production Admin UI.
 * This file is never imported by the Worker. It renders the real production
 * dashboardHtml()/loginPageHtml() and injects only deterministic QA data.
 */
const fs = require("node:fs");
const path = require("node:path");
const { dashboardHtml, loginPageHtml } = require("../build-test/src/admin/ui.js");

const outDir = path.resolve(process.argv[2] || "admin-visual-artifacts");
fs.mkdirSync(outDir, { recursive: true });

const fixtures = {
  "/admin/api/overview": {
    providerCount: 3,
    enabledProviderCount: 2,
    healthyCount: 1,
    modelCount: 7,
    availableModelCount: 4,
    disabledModelCount: 2,
    routingRuleCount: 4,
    activeRoutingAliasCount: 1,
    unavailableRoutingAliasCount: 3,
  },
  "/admin/api/providers": {
    providers: [
      {
        id: "fixture-anthropic-with-a-deliberately-long-provider-id-for-visual-stress",
        display_name: "VISUAL TEST DATA — Anthropic Provider With A Deliberately Long Display Name",
        enabled: 1,
        health_state: "RATE_LIMITED",
        model_count: 3,
        enabled_model_count: 2,
        routing_aliases: ["research-with-a-deliberately-long-routing-alias", "analysis"],
        byok_alias: "configured",
        last_latency_ms: 864,
        last_error_message: "VISUAL TEST DATA — explicit 429 classification with deliberately long diagnostic evidence used only to verify wrapping, truncation, and inspector scrolling at the canonical viewport.",
      },
      {
        id: "fixture-google",
        display_name: "VISUAL TEST DATA — Google AI Studio Primary",
        enabled: 1,
        health_state: "HEALTHY",
        model_count: 3,
        enabled_model_count: 2,
        routing_aliases: ["fast", "coding"],
        byok_alias: "configured",
        last_latency_ms: 412,
        last_error_message: null,
      },
      {
        id: "fixture-openai-disabled",
        display_name: "VISUAL TEST DATA — OpenAI Disabled",
        enabled: 0,
        health_state: "NOT_CONFIGURED",
        model_count: 1,
        enabled_model_count: 0,
        routing_aliases: ["fallback"],
        byok_alias: null,
        last_latency_ms: null,
        last_error_message: "VISUAL TEST DATA — required provider configuration is intentionally absent.",
      },
    ],
  },
  "/admin/api/models": {
    models: [
      {
        id: "visual-fixture-model-coding-with-a-deliberately-long-runtime-identifier-for-overflow-verification",
        provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id-for-visual-stress",
        enabled: 1,
        provider_enabled: 1,
        available: true,
        routing_aliases: ["research-with-a-deliberately-long-routing-alias"],
      },
      { id: "fixture-model-fast", provider_id: "fixture-google", enabled: 1, provider_enabled: 1, available: true, routing_aliases: ["fast"] },
      { id: "fixture-model-coding", provider_id: "fixture-google", enabled: 1, provider_enabled: 1, available: true, routing_aliases: ["coding"] },
      { id: "fixture-model-disabled", provider_id: "fixture-google", enabled: 0, provider_enabled: 1, available: false, routing_aliases: ["disabled-alias"] },
      { id: "fixture-model-provider-blocked", provider_id: "fixture-openai-disabled", enabled: 1, provider_enabled: 0, available: false, routing_aliases: ["fallback"] },
      { id: "fixture-model-unrouted", provider_id: "fixture-google", enabled: 1, provider_enabled: 1, available: true, routing_aliases: [] },
      { id: "fixture-model-disabled-2", provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id-for-visual-stress", enabled: 0, provider_enabled: 1, available: false, routing_aliases: [] },
    ],
  },
  "/admin/api/routing": {
    rules: [
      {
        public_alias: "research-with-a-deliberately-long-routing-alias",
        model_id: "visual-fixture-model-coding-with-a-deliberately-long-runtime-identifier-for-overflow-verification",
        provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id-for-visual-stress",
        state: "PROVIDER_DISABLED",
        model_enabled: 1,
        provider_enabled: 0,
        updated_at: "2026-09-06T21:41:00Z",
      },
      { public_alias: "fast", model_id: "fixture-model-fast", provider_id: "fixture-google", state: "ACTIVE", model_enabled: 1, provider_enabled: 1, updated_at: "2026-09-06T21:52:00Z" },
      { public_alias: "coding", model_id: "fixture-model-coding", provider_id: "fixture-google", state: "MODEL_DISABLED", model_enabled: 0, provider_enabled: 1, updated_at: "2026-09-06T21:49:00Z" },
      { public_alias: "fallback", model_id: "fixture-model-missing-target", provider_id: "fixture-openai-disabled", state: "BROKEN", model_enabled: null, provider_enabled: 0, updated_at: "2026-09-06T21:35:00Z" },
    ],
  },
  "/admin/api/tools": {
    tools: [
      {
        name: "visual_fixture_tool_with_a_deliberately_long_mcp_tool_name_for_inspector_and_list_stress",
        description: "VISUAL TEST DATA — deliberately long tool description used to verify that the production MCP Tools workbench preserves hierarchy, wrapping, scrolling, annotation alignment, and schema readability without shrinking the global typography.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        inputSchema: {
          type: "object",
          properties: {
            repository_full_name_with_deliberately_long_property_name: { type: "string", description: "VISUAL TEST DATA — long schema property description for internal schema scrolling." },
            confirm_destructive: { type: "boolean" },
            nested_configuration: {
              type: "object",
              properties: {
                execution_mode: { type: "string", enum: ["preview", "guarded", "confirmed"] },
                long_optional_context_field_for_visual_wrapping: { type: "string" },
              },
            },
          },
          required: ["repository_full_name_with_deliberately_long_property_name", "confirm_destructive"],
        },
      },
      { name: "web_search", description: "VISUAL TEST DATA — read-only public search catalog row.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "web_fetch", description: "VISUAL TEST DATA — mixed access fetch catalog row.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { url: { type: "string" }, method: { type: "string" } }, required: ["url"] } },
      { name: "cf_list_zones", description: "VISUAL TEST DATA — list zones.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: {} } },
      { name: "cf_delete_worker", description: "VISUAL TEST DATA — guarded destructive tool row.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, inputSchema: { type: "object", properties: { name: { type: "string" }, confirm_destructive: { type: "boolean" } }, required: ["name", "confirm_destructive"] } },
      { name: "hf_search_models", description: "VISUAL TEST DATA — model search catalog row.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { query: { type: "string" } } } },
      { name: "run_code", description: "VISUAL TEST DATA — execution catalog row only; no invocation occurs.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { language: { type: "string" }, code: { type: "string" } }, required: ["language", "code"] } },
      { name: "proxyharvest_gateway_health", description: "VISUAL TEST DATA — boundary-health catalog row, not tunnel verification.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, inputSchema: { type: "object", properties: {} } },
    ],
  },
  "/admin/api/health": {
    checks: [
      {
        checked_at: "2026-09-06T21:53:00Z",
        provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id-for-visual-stress",
        state: "RATE_LIMITED",
        latency_ms: 864,
        error_message: "VISUAL TEST DATA — long diagnostic evidence: upstream returned an explicit 429 classification and this intentionally verbose text verifies evidence wrapping and inspector scrolling without implying production health.",
      },
      { checked_at: "2026-09-06T21:55:00Z", provider_id: "fixture-google", state: "HEALTHY", latency_ms: 412, error_message: null },
      { checked_at: "2026-09-06T21:50:00Z", provider_id: "fixture-openai-disabled", state: "NOT_CONFIGURED", latency_ms: null, error_message: "VISUAL TEST DATA — required provider configuration is missing." },
      { checked_at: "2026-09-06T21:44:00Z", provider_id: "fixture-google", state: "UPSTREAM_ERROR", latency_ms: 1205, error_message: "VISUAL TEST DATA — representative upstream error retained as non-healthy evidence." },
    ],
  },
  "/admin/api/usage": {
    totalAuditEvents: 128,
    recentActions: [
      { action: "provider.health-test", at: "2026-09-06T21:55:00Z", target: "fixture-google" },
      { action: "model.disable", at: "2026-09-06T21:49:00Z", target: "visual-fixture-model-coding-with-a-deliberately-long-runtime-identifier-for-overflow-verification" },
      { action: "provider.credential.rotate", at: "2026-09-06T21:46:00Z", target: "fixture-anthropic-with-a-deliberately-long-provider-id-for-visual-stress" },
      { action: "admin.login", at: "2026-09-06T21:40:00Z", target: "admin" },
    ],
  },
  "/admin/api/logs": {
    events: [
      {
        id: 9001,
        at: "2026-09-06T21:49:00Z",
        actor: "admin",
        action: "model.disable",
        target: "visual-fixture-model-coding-with-a-deliberately-long-runtime-identifier-for-overflow-verification",
        detail: "VISUAL TEST DATA — deliberately long audit evidence to verify that the persistent Evidence Inspector wraps and scrolls safely. The model policy changed while configured aliases remain visible and fail closed. No real production activity is represented by this fixture.",
      },
      { id: 9002, at: "2026-09-06T21:55:00Z", actor: "admin", action: "provider.health-test", target: "fixture-google", detail: "VISUAL TEST DATA — HEALTHY classification for layout only." },
      { id: 9003, at: "2026-09-06T21:46:00Z", actor: "admin", action: "provider.credential.rotate", target: "fixture-anthropic-with-a-deliberately-long-provider-id-for-visual-stress", detail: "VISUAL TEST DATA — secret material is never present in this fixture." },
      { id: 9004, at: "2026-09-06T21:40:00Z", actor: "admin", action: "admin.login", target: "admin", detail: "VISUAL TEST DATA — signed owner session event for layout only." },
    ],
  },
  "/admin/api/settings": {
    gatewaySlug: "visual-test-data-dreamworker-gateway-with-a-deliberately-long-safe-slug",
    accountIdMasked: "visual…9xyz",
    d1Database: "DM_DB_VISUAL_FIXTURE_ONLY_WITH_LONG_SAFE_METADATA_NAME",
    version: "1.8.0-visual-fixture-long-build-metadata",
    hasCfToken: true,
    hasGatewayAuth: false,
    hasMcpAuth: true,
  },
};

const emptyFixtures = {
  "/admin/api/overview": { providerCount: 0, enabledProviderCount: 0, healthyCount: 0, modelCount: 0, availableModelCount: 0, disabledModelCount: 0, routingRuleCount: 0, activeRoutingAliasCount: 0, unavailableRoutingAliasCount: 0 },
  "/admin/api/providers": { providers: [] },
  "/admin/api/models": { models: [] },
  "/admin/api/routing": { rules: [] },
  "/admin/api/tools": { tools: [] },
  "/admin/api/health": { checks: [] },
  "/admin/api/usage": { totalAuditEvents: 0, recentActions: [] },
  "/admin/api/logs": { events: [] },
  "/admin/api/settings": fixtures["/admin/api/settings"],
};

const fixtureStyle = `<style data-visual-fixture="true">
.visual-fixture-badge{position:fixed;right:9px;top:59px;z-index:10001;height:20px;padding:0 8px;border:1px solid #e6c66f;border-radius:10px;background:#fff9e7;color:#80611b;display:flex;align-items:center;font:700 6.5px/1 system-ui;letter-spacing:.05em;box-shadow:0 4px 12px rgba(85,67,20,.08);pointer-events:none}
</style>`;

const fixtureScript = `<script data-visual-fixture="true">\n` +
  `window.__VISUAL_ACCEPTANCE_FIXTURE_ONLY__=true;\n` +
  `document.documentElement.dataset.visualRuntime='pending';document.documentElement.dataset.visualOverflow='pending';\n` +
  `window.__visualErrors=[];window.addEventListener('error',e=>window.__visualErrors.push(String(e.message||e.error||'error')));window.addEventListener('unhandledrejection',e=>window.__visualErrors.push(String(e.reason||'unhandledrejection')));\n` +
  `const __normalFixtures=${JSON.stringify(fixtures)};const __emptyFixtures=${JSON.stringify(emptyFixtures)};\n` +
  `const __params=new URLSearchParams(location.search);const __scenario=__params.get('visualState')||'normal';\n` +
  `window.fetch=async function(input){const key=typeof input==='string'?input:(input&&input.url)||'';const pathname=key.startsWith('http')?new URL(key).pathname:key;if(__scenario==='loading')await new Promise(r=>setTimeout(r,5000));if((__scenario==='degraded'||__scenario==='health-error')&&(pathname==='/admin/api/health'||pathname==='/admin/api/usage'))return new Response(JSON.stringify({error:'VISUAL_TEST_DATA_FORCED_ENDPOINT_FAILURE'}),{status:503,headers:{'Content-Type':'application/json'}});const source=__scenario==='empty'?__emptyFixtures:__normalFixtures;const value=source[pathname];if(value===undefined)return new Response(JSON.stringify({error:'fixture_not_found',path:pathname}),{status:404,headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});};\n` +
  `window.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.className='visual-fixture-badge';b.textContent='VISUAL QA FIXTURE · TEST DATA';document.body.appendChild(b);const view=__params.get('settingsView');if(view)setTimeout(()=>document.querySelector('[data-settings-view="'+view+'"]')?.click(),1400);if(__scenario==='health-error')setTimeout(()=>document.getElementById('boot-continue')?.click(),1600);setTimeout(()=>{const active=document.querySelector('.page.active');const pageOverflow=!!active&&(active.scrollWidth>active.clientWidth+1||active.scrollHeight>active.clientHeight+1);const rootOverflow=document.documentElement.scrollWidth>window.innerWidth+1||document.documentElement.scrollHeight>window.innerHeight+1;document.documentElement.dataset.visualOverflow=(pageOverflow||rootOverflow)?'fail':'ok';document.documentElement.dataset.visualRuntime=window.__visualErrors.length?'error':'ok';document.documentElement.dataset.visualScenario=__scenario;},2300);});\n` +
  `</script>`;

let dashboard = dashboardHtml();
dashboard = dashboard.replace("</head>", fixtureStyle + "</head>");
dashboard = dashboard.replace("<body>", "<body>" + fixtureScript);

let login = loginPageHtml();
login = login.replace("</head>", fixtureStyle + "</head>");
login = login.replace("<body>", `<body><div class="visual-fixture-badge">VISUAL QA FIXTURE · TEST DATA</div>`);

fs.writeFileSync(path.join(outDir, "dashboard-fixture.html"), dashboard, "utf8");
fs.writeFileSync(path.join(outDir, "login-fixture.html"), login, "utf8");
fs.writeFileSync(path.join(outDir, "production-dashboard.html"), dashboardHtml(), "utf8");
fs.writeFileSync(path.join(outDir, "production-login.html"), loginPageHtml(), "utf8");
console.log(`SCREENSHOTS FIXTURE HTML GENERATED at ${outDir}`);
