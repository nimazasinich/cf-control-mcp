/*
 * Test-only visual acceptance fixture generator.
 *
 * This file never runs in the Worker and never changes production state.
 * It supplies representative UI data only so headless-browser screenshots can
 * exercise density, long values, blocked states, inspectors and empty/error
 * boundaries at the canonical 1368x753 acceptance viewport.
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
      { id: "fixture-google", display_name: "Google AI Studio — Primary", enabled: 1, health_state: "HEALTHY", model_count: 4, enabled_model_count: 3, routing_aliases: ["fast", "coding"], byok_alias: "configured", last_latency_ms: 412, last_error_message: null },
      { id: "fixture-anthropic-with-a-deliberately-long-provider-id", display_name: "Anthropic — Long Identity Stress", enabled: 1, health_state: "RATE_LIMITED", model_count: 2, enabled_model_count: 1, routing_aliases: ["research"], byok_alias: "configured", last_latency_ms: 864, last_error_message: "Explicit upstream rate limit; retained as non-healthy evidence." },
      { id: "fixture-openai", display_name: "OpenAI — Disabled", enabled: 0, health_state: "NOT_CONFIGURED", model_count: 1, enabled_model_count: 0, routing_aliases: ["fallback"], byok_alias: null, last_latency_ms: null, last_error_message: "Required provider configuration is not available." },
    ],
  },
  "/admin/api/models": {
    models: [
      { id: "fixture-model-fast", provider_id: "fixture-google", enabled: 1, provider_enabled: 1, available: true, routing_aliases: ["fast"] },
      { id: "fixture-model-coding-with-a-very-long-runtime-identifier", provider_id: "fixture-google", enabled: 1, provider_enabled: 1, available: true, routing_aliases: ["coding"] },
      { id: "fixture-model-research", provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id", enabled: 1, provider_enabled: 1, available: true, routing_aliases: ["research"] },
      { id: "fixture-model-disabled", provider_id: "fixture-google", enabled: 0, provider_enabled: 1, available: false, routing_aliases: ["disabled-alias"] },
      { id: "fixture-model-provider-blocked", provider_id: "fixture-openai", enabled: 1, provider_enabled: 0, available: false, routing_aliases: ["fallback"] },
      { id: "fixture-model-unrouted", provider_id: "fixture-google", enabled: 1, provider_enabled: 1, available: true, routing_aliases: [] },
      { id: "fixture-model-disabled-2", provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id", enabled: 0, provider_enabled: 1, available: false, routing_aliases: [] },
    ],
  },
  "/admin/api/routing": {
    rules: [
      { public_alias: "fast", model_id: "fixture-model-fast", provider_id: "fixture-google", state: "ACTIVE", model_enabled: 1, provider_enabled: 1, updated_at: "2026-09-06T21:52:00Z" },
      { public_alias: "coding", model_id: "fixture-model-coding-with-a-very-long-runtime-identifier", provider_id: "fixture-google", state: "MODEL_DISABLED", model_enabled: 0, provider_enabled: 1, updated_at: "2026-09-06T21:49:00Z" },
      { public_alias: "research", model_id: "fixture-model-research", provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id", state: "PROVIDER_DISABLED", model_enabled: 1, provider_enabled: 0, updated_at: "2026-09-06T21:41:00Z" },
      { public_alias: "fallback", model_id: "fixture-model-missing-target", provider_id: "fixture-openai", state: "BROKEN", model_enabled: null, provider_enabled: 0, updated_at: "2026-09-06T21:35:00Z" },
    ],
  },
  "/admin/api/tools": {
    tools: [
      { name: "web_search", description: "Search the public internet using the configured provider path with bounded result output.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "web_fetch", description: "Fetch a public HTTP/HTTPS resource while applying the existing URL and redirect safety boundaries.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { url: { type: "string" }, method: { type: "string" } }, required: ["url"] } },
      { name: "cf_list_zones", description: "List Cloudflare zones visible to the configured account token.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: {} } },
      { name: "cf_delete_worker", description: "Delete a Worker only after the destructive confirmation contract is satisfied.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, inputSchema: { type: "object", properties: { name: { type: "string" }, confirm_destructive: { type: "boolean" } }, required: ["name", "confirm_destructive"] } },
      { name: "hf_search_models", description: "Search public Hugging Face model metadata.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { query: { type: "string" } } } },
      { name: "run_code", description: "Run code through the configured third-party execution path; test fixture only exercises catalog presentation.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { language: { type: "string" }, code: { type: "string" } }, required: ["language", "code"] } },
      { name: "gh_run_code", description: "Schedule asynchronous code execution through the configured GitHub Actions execution contract.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
      { name: "proxyharvest_gateway_health", description: "Check gateway boundary health; this is not proxy tunnel or WireGuard verification.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, inputSchema: { type: "object", properties: {} } },
    ],
  },
  "/admin/api/health": {
    checks: [
      { checked_at: "2026-09-06T21:55:00Z", provider_id: "fixture-google", state: "HEALTHY", latency_ms: 412, error_message: null },
      { checked_at: "2026-09-06T21:53:00Z", provider_id: "fixture-anthropic-with-a-deliberately-long-provider-id", state: "RATE_LIMITED", latency_ms: 864, error_message: "Explicit 429 classification retained as attention state." },
      { checked_at: "2026-09-06T21:50:00Z", provider_id: "fixture-openai", state: "NOT_CONFIGURED", latency_ms: null, error_message: "Required provider configuration is missing." },
      { checked_at: "2026-09-06T21:44:00Z", provider_id: "fixture-google", state: "UPSTREAM_ERROR", latency_ms: 1205, error_message: "Representative long diagnostic detail for visual overflow acceptance without exposing any secret value." },
    ],
  },
  "/admin/api/usage": {
    totalAuditEvents: 128,
    recentActions: [
      { action: "provider.health-test", at: "2026-09-06T21:55:00Z" },
      { action: "model.disable", at: "2026-09-06T21:49:00Z" },
      { action: "provider.credential.rotate", at: "2026-09-06T21:46:00Z" },
      { action: "admin.login", at: "2026-09-06T21:40:00Z" },
    ],
  },
  "/admin/api/logs": {
    events: [
      { at: "2026-09-06T21:55:00Z", action: "provider.health-test", target: "fixture-google", detail: "HEALTHY · 412 ms" },
      { at: "2026-09-06T21:49:00Z", action: "model.disable", target: "fixture-model-coding-with-a-very-long-runtime-identifier", detail: "Model policy changed; affected aliases remain configured and fail closed." },
      { at: "2026-09-06T21:46:00Z", action: "provider.credential.rotate", target: "fixture-anthropic-with-a-deliberately-long-provider-id", detail: "Credential updated server-side; secret material is not present in this audit fixture." },
      { at: "2026-09-06T21:40:00Z", action: "admin.login", target: "admin", detail: "Signed owner session established." },
    ],
  },
  "/admin/api/settings": {
    gatewaySlug: "dreamworker-production-gateway-with-long-safe-slug",
    accountIdMasked: "abc1…9xyz",
    d1Database: "DM_DB",
    version: "1.8.0",
    hasCfToken: true,
    hasGatewayAuth: true,
    hasMcpAuth: true,
  },
};

const fixtureScript = `<script data-visual-fixture="true">\n` +
  `window.__VISUAL_ACCEPTANCE_FIXTURE_ONLY__=true;\n` +
  `const __dwFixtures=${JSON.stringify(fixtures)};\n` +
  `window.fetch=async function(input){const key=typeof input==='string'?input:(input&&input.url)||'';const pathname=key.startsWith('http')?new URL(key).pathname:key;const value=__dwFixtures[pathname];if(value===undefined)return new Response(JSON.stringify({error:'fixture_not_found',path:pathname}),{status:404,headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});};\n` +
  `</script>`;

let dashboard = dashboardHtml();
dashboard = dashboard.replace("<body>", "<body>" + fixtureScript);

fs.writeFileSync(path.join(outDir, "dashboard-fixture.html"), dashboard, "utf8");
fs.writeFileSync(path.join(outDir, "login.html"), loginPageHtml(), "utf8");
console.log(`Wrote visual fixture HTML to ${outDir}`);
