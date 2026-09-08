import test from "node:test";
import assert from "node:assert/strict";
import { adapterScript } from "../src/admin/ui/approved/adapter";

const fakeReferenceMarkers = [
  "admin@dreamworker.ai",
  "44 tools",
  "10 sampled tools shown",
  "7 registered",
  "3 active",
  "Preview running",
  "Simulation completed",
];

test("approved runtime adapters bind to the authoritative Admin API schema", () => {
  const providers = adapterScript("providers");
  const models = adapterScript("models");
  const usage = adapterScript("usage");

  assert.ok(providers.includes("p.byok_alias"), "Providers must use the real byok_alias field");
  assert.ok(models.includes("m.provider_enabled"), "Models must preserve provider gating separately from model.enabled");
  assert.ok(usage.includes("activity.totalAuditEvents"));
  assert.ok(usage.includes("registry.enabledModels"));
  assert.ok(usage.includes("registry.toolCatalogCount"));
  assert.ok(usage.includes("health.totalChecks"));
  assert.ok(usage.includes("coverage.gatewayRequests"));
  assert.ok(usage.includes("coverage.tokens"));
  assert.ok(usage.includes("coverage.cost"));
});

test("approved runtime adapters fail closed instead of carrying reference operational samples", () => {
  for (const page of ["overview", "providers", "models", "tools", "routing", "health", "usage"]) {
    const script = adapterScript(page);
    for (const marker of fakeReferenceMarkers) {
      assert.ok(!script.includes(marker), `${page} adapter must not hardcode reference marker: ${marker}`);
    }
  }

  const tools = adapterScript("tools");
  assert.ok(tools.includes("list.innerHTML = ''"));
  assert.ok(tools.includes("Full catalog: loading authenticated /admin/api/tools"));
  assert.ok(tools.includes("Unavailable in Admin"));
  assert.ok(!tools.includes("/admin/api/tools/call"));
});

test("live loading and command surfaces cannot report preview-only completion", () => {
  const loading = adapterScript("loading");
  assert.ok(loading.includes("/admin/api/prelogin"), "loading must read the real signed-session state before Login");
  assert.ok(loading.includes("/admin/login?ready=1"), "loading must verify and hand off to the real Login document");
  assert.ok(loading.includes("minimumPreloginVisibleMs = 900"), "pre-login Loading should remain visibly perceivable after real checks settle");
  assert.ok(loading.includes("owner-token sign-in contract verified"));
  for (const endpoint of [
    "/admin/api/overview",
    "/admin/api/providers",
    "/admin/api/models",
    "/admin/api/tools",
    "/admin/api/routing",
    "/admin/api/health",
    "/admin/api/usage",
    "/admin/api/logs",
    "/admin/api/settings",
  ]) assert.ok(loading.includes(endpoint), `loading must probe ${endpoint}`);
  assert.ok(!loading.includes("setInterval("));

  const overview = adapterScript("overview");
  const usage = adapterScript("usage");
  assert.ok(overview.includes("navigation-only until those actions have real API routes"));
  assert.ok(usage.includes("Execution unavailable"));
});

test("live Login adapter removes the fake account requirement without bypassing owner-token auth", () => {
  const login = adapterScript("login");
  assert.ok(login.includes("data-auth-contract', 'owner-token-only"));
  assert.ok(login.includes("owner@admin.invalid"), "legacy email validator gets a non-routable hidden sentinel");
  assert.ok(login.includes("emailField.style.display = 'none'"), "fake account field must not remain visible");
  assert.ok(login.includes("Paste MCP_AUTH_TOKEN"));
  assert.ok(login.includes("Owner access"));
  assert.ok(login.includes("topActions.style.display = 'none'"), "preview-only theme/language controls must not look live");
  assert.ok(login.includes("MCP_AUTH_TOKEN is verified by the Worker"));
  assert.ok(login.includes("Enter your Owner Token to continue."), "legacy email/password validation copy must be translated at the live boundary");
  assert.ok(login.includes("credentials: 'same-origin'"));
  assert.ok(login.includes("body: JSON.stringify({ token: ownerToken })"));
  assert.ok(!login.includes("email.value = 'Owner-only Admin'"), "the invalid display value that blocked approved validation must not return");
});

test("live Models adapter exposes D1-backed operator metadata management", () => {
  const models = adapterScript("models");
  assert.ok(models.includes("displayName:displayName||null"));
  assert.ok(models.includes("description:description||null"));
  assert.ok(models.includes("/metadata','PATCH'"));
  assert.ok(models.includes("Edit model details"));
  assert.ok(models.includes("Model ID <span style=\"font-weight:400;color:#90a0b7\">immutable</span>"));
  assert.ok(models.includes("Metadata does not affect routing, health or model callability."));
  assert.ok(models.includes("data-display-name"));
  assert.ok(models.includes("data-description"));
});

test("live Admin pages expose request-backed visual feedback without inventing provider health", () => {
  const overview = adapterScript("overview");
  assert.ok(overview.includes("dw-runtime-feedback"));
  assert.ok(overview.includes("Loading authoritative state"));
  assert.ok(overview.includes("Change saved"));
  assert.ok(overview.includes("DW._requestState.pending"));
  assert.ok(overview.includes("Some Admin API work failed"), "a concurrent success must not mask a real API error");
  assert.ok(!overview.includes("All providers healthy"));
});

test("live Admin visual refinement is additive, shared, and accessibility-aware", () => {
  const pages = ["overview", "providers", "models", "tools", "routing", "health", "usage", "audit", "settings", "loading"];
  for (const page of pages) {
    const script = adapterScript(page);
    assert.ok(script.includes("Visual refinement layer"), `${page} must receive the shared visual refinement layer`);
    assert.ok(script.includes("--dw-elev-1"), `${page} must receive shared elevation tokens`);
    assert.ok(script.includes("button:focus-visible"), `${page} must preserve a visible keyboard focus state`);
    assert.ok(script.includes("prefers-reduced-motion"), `${page} must honor reduced-motion preferences`);
  }

  const providers = adapterScript("providers");
  assert.ok(providers.includes(".provider-row:hover"));
  const models = adapterScript("models");
  assert.ok(models.includes(".catalog-model.selected"));
  const routing = adapterScript("routing");
  assert.ok(routing.includes(".resolver-card"));
  const health = adapterScript("health");
  assert.ok(health.includes(".health-radar-panel"));
  const settings = adapterScript("settings");
  assert.ok(settings.includes(".environment-card"));

  const login = adapterScript("login");
  assert.ok(login.includes("--dw-login-focus"));
  assert.ok(login.includes(".login-card:before"));
  assert.ok(login.includes(".signin:hover:not(:disabled)"));
  assert.ok(login.includes("@media(prefers-reduced-motion:reduce)"));
});
