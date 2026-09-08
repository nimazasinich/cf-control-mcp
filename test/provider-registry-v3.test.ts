import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_PROVIDER_TEMPLATES, knownProviderTemplate } from "../src/admin/provider-catalog";
import { validateCustomProviderBaseUrl, createCloudflareCustomProvider } from "../src/admin/custom-providers";
import { createModel } from "../src/admin/db";
import { classifyProviderHealth, requestProviderChat } from "../src/provider-gateway/provider-runtime";
import { handleChatCompletions } from "../src/provider-gateway/cloudflare-ai-gateway";
import { listAvailableModels, resolveModelCandidates } from "../src/provider-gateway/models";
import { handleAdmin } from "../src/admin/router";
import { createSessionCookie } from "../src/admin/auth";
import type { AdminEnv, ProviderRow } from "../src/admin/types";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

function provider(overrides: Partial<ProviderRow> & Pick<ProviderRow, "id" | "provider_slug">): ProviderRow {
  return {
    display_name: overrides.id,
    kind: overrides.id,
    transport: "cloudflare-rest",
    auth_type: "cloudflare-unified",
    base_url: null,
    api_path: null,
    priority: 10,
    credential_required: 0,
    custom_provider_id: null,
    test_model: null,
    enabled: 1,
    byok_alias: null,
    health_state: "HEALTHY",
    last_success_at: "2026-09-08T00:00:00Z",
    last_error_at: null,
    last_error_message: null,
    last_latency_ms: 12,
    last_http_status: 200,
    last_gateway_log_id: "prior-log",
    last_gateway_step: null,
    last_cf_ray: null,
    created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    ...overrides,
  };
}

function candidateRow(p: ProviderRow, modelId: string, freeTier = false) {
  return {
    model_id: modelId,
    model_public_alias: null,
    model_enabled: 1,
    model_free_tier: freeTier ? 1 : 0,
    model_created_at: "2026-09-08T00:00:00Z",
    ...p,
  };
}

function candidateDb(rows: any[]) {
  return {
    prepare(sql: string) {
      const stmt: any = {
        args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this; },
        async first() {
          if (sql.includes("SELECT model_id FROM routing_rules")) return null;
          if (sql.includes("WHERE m.id=?")) {
            const id = this.args[0];
            const row = rows.find((r) => r.model_id === id);
            return row ? { id, model_enabled: row.model_enabled, provider_enabled: row.enabled } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM models m") && sql.includes("JOIN providers p")) return { results: rows };
          return { results: [] };
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
      return stmt;
    },
  } as any;
}

test("Provider catalog includes requested major providers plus custom-provider freedom", () => {
  const ids = new Set(KNOWN_PROVIDER_TEMPLATES.map((p) => p.id));
  for (const id of ["workers-ai", "google-ai-studio", "google-antigravity", "openai", "deepseek", "openrouter", "anthropic", "groq", "mistral", "xai", "cerebras", "cohere", "huggingface", "custom"]) {
    assert.ok(ids.has(id), `missing provider preset: ${id}`);
  }
  const antigravity = KNOWN_PROVIDER_TEMPLATES.find((p) => p.id === "google-antigravity");
  assert.equal(antigravity?.transport, "gateway-custom");
  assert.equal(antigravity?.customizable, true);
  assert.equal(antigravity?.testModel, undefined);
});

test("Custom provider URL is HTTPS-only and cannot hide credentials", () => {
  assert.equal(validateCustomProviderBaseUrl("https://api.example.com"), "https://api.example.com");
  assert.throws(() => validateCustomProviderBaseUrl("http://api.example.com"));
  assert.throws(() => validateCustomProviderBaseUrl("https://user:secret@api.example.com"));
  assert.throws(() => validateCustomProviderBaseUrl("https://api.example.com?token=secret"));
});

test("Custom provider provisioning uses the official Cloudflare account API and never embeds provider token", async () => {
  let seenUrl = ""; let seenBody: any = null;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(url); seenBody = JSON.parse(String(init?.body || "{}"));
    assert.equal((init?.headers as any).Authorization, "Bearer cf-admin-token");
    return new Response(JSON.stringify({ success: true, result: { id: "cp-1", slug: "regional-llm", base_url: "https://api.example.com" } }), { status: 200 });
  }) as any;
  const out = await createCloudflareCustomProvider({ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "cf-admin-token" } as any, {
    name: "Regional LLM", slug: "regional-llm", baseUrl: "https://api.example.com",
  });
  assert.match(seenUrl, /\/accounts\/acct\/ai-gateway\/custom-providers$/);
  assert.equal(seenBody.base_url, "https://api.example.com");
  assert.equal("token" in seenBody, false);
  assert.equal(out.slug, "regional-llm");
});

test("Health classification refuses to call 2xx healthy without Cloudflare gateway evidence", () => {
  const p = provider({ id: "openai", provider_slug: "openai" });
  const noEvidence = classifyProviderHealth({ response: new Response("{}", { status: 200 }), providerId: p.id, modelId: "gpt", gatewayVerified: false, gatewayLogId: null, gatewayStep: null, cfRay: null, httpStatus: 200, latencyMs: 10 });
  assert.equal(noEvidence.state, "DEGRADED");
});

test("Cloudflare REST provider call forces gateway id and provider-qualified model", async () => {
  const p = provider({ id: "openai", provider_slug: "openai" });
  let body: any; let headers: Headers | null = null;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)); headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "cf-aig-log-id": "log-real" } });
  }) as any;
  const result = await requestProviderChat(p, "gpt-4.1-mini", { model: "gpt-4.1-mini", messages: [{ role: "user", content: "hi" }] }, {
    CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "cf-token", CF_AIG_GATEWAY_SLUG: "gw",
  });
  assert.equal(headers!.get("cf-aig-gateway-id"), "gw");
  assert.equal(headers!.get("cf-aig-collect-log-payload"), "false");
  assert.equal(body.model, "openai/gpt-4.1-mini");
  assert.equal(result.gatewayVerified, true);
  assert.equal(result.gatewayLogId, "log-real");
});

test("D1 model public aliases are listed and resolve directly without source redeploy", async () => {
  const p = provider({ id: "google-ai-studio", provider_slug: "google-ai-studio", transport: "gateway-native", auth_type: "byok", byok_alias: "default" });
  const rows = [
    { ...candidateRow(p, "gemini-3.8-flash"), model_public_alias: "flash-public" },
  ];
  const env = {
    DM_DB: candidateDb(rows),
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CF_AIG_GATEWAY_SLUG: "gateway",
    CF_AIG_TOKEN: "gateway-token",
  } as any;

  const listed = await listAvailableModels(env);
  assert.ok(listed.some((model) => model.id === "flash-public"));
  assert.ok(listed.some((model) => model.id === "gemini-3.8-flash"));

  const candidates = await resolveModelCandidates("flash-public", env);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].modelId, "gemini-3.8-flash");
});

test("Google AI Studio default BYOK uses AI Gateway compat chat", async () => {
  const p = provider({
    id: "google-ai-studio",
    provider_slug: "google-ai-studio",
    transport: "gateway-native",
    auth_type: "byok",
    credential_required: 1,
    byok_alias: "default",
  });
  let seenUrl = "";
  let body: any;
  let headers: Headers | null = null;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(url);
    body = JSON.parse(String(init?.body));
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "cf-aig-log-id": "gemini-log" } });
  }) as any;
  const result = await requestProviderChat(p, "gemini-3.8-flash", { model: "gemini-3.8-flash", messages: [{ role: "user", content: "hi" }] }, {
    CLOUDFLARE_ACCOUNT_ID: "acct", CF_AIG_GATEWAY_SLUG: "gw", CF_AIG_TOKEN: "gateway-token", CLOUDFLARE_API_TOKEN: "cf-token",
  });
  assert.match(seenUrl, /gateway\.ai\.cloudflare\.com\/v1\/acct\/gw\/compat\/chat\/completions$/);
  assert.equal(headers!.get("cf-aig-authorization"), "Bearer gateway-token");
  assert.equal(headers!.get("cf-aig-gateway-id"), null);
  assert.equal(body.model, "google-ai-studio/gemini-3.8-flash");
  assert.equal(result.gatewayVerified, true);
});


test("OpenRouter uses provider-native Cloudflare gateway passthrough", async () => {
  const p = provider({ id: "openrouter", provider_slug: "openrouter", api_path: "v1/chat/completions", byok_alias: "default", transport: "gateway-native", auth_type: "byok" });
  let seenUrl = "";
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    seenUrl = String(url);
    return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "cf-aig-log-id": "openrouter-log" } });
  }) as any;
  const result = await requestProviderChat(p, "openai/gpt-5-mini", { model: "openai/gpt-5-mini", messages: [{ role: "user", content: "hi" }] }, {
    CLOUDFLARE_ACCOUNT_ID: "acct", CF_AIG_GATEWAY_SLUG: "gw", CF_AIG_TOKEN: "gateway-token", CLOUDFLARE_API_TOKEN: "cf-token",
  });
  assert.match(seenUrl, /gateway\.ai\.cloudflare\.com\/v1\/acct\/gw\/openrouter\/v1\/chat\/completions$/);
  assert.equal(result.gatewayVerified, true);
});

test("Smart auto routing falls through retryable failure according to provider priority", async () => {
  const rows = [
    candidateRow(provider({ id: "openai", provider_slug: "openai", priority: 10 }), "gpt-4.1-mini"),
    candidateRow(provider({ id: "deepseek", provider_slug: "deepseek", priority: 20 }), "deepseek-chat"),
  ];
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429, headers: { "cf-aig-log-id": "log-openai" } });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200, headers: { "cf-aig-log-id": "log-deepseek" } });
  }) as any;
  const req = new Request("https://example.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hi" }] }) });
  const res = await handleChatCompletions(req, { DM_DB: candidateDb(rows), CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "cf", CF_AIG_GATEWAY_SLUG: "gw" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-dw-provider"), "deepseek");
  assert.equal(res.headers.get("x-dw-fallback-index"), "1");
  assert.equal(res.headers.get("x-dw-gateway-verified"), "1");
  assert.equal(calls, 2);
});

test("A 2xx response without gateway evidence is rejected and falls through", async () => {
  const rows = [
    candidateRow(provider({ id: "openai", provider_slug: "openai", priority: 10 }), "gpt-4.1-mini"),
    candidateRow(provider({ id: "deepseek", provider_slug: "deepseek", priority: 20 }), "deepseek-chat"),
  ];
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "cf-aig-log-id": "verified-second" } });
  }) as any;
  const req = new Request("https://example.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hi" }] }) });
  const res = await handleChatCompletions(req, { DM_DB: candidateDb(rows), CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "cf", CF_AIG_GATEWAY_SLUG: "gw" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-dw-provider"), "deepseek");
  assert.equal(calls, 2);
});

test("Explicit model IDs never silently fall back to a different model", async () => {
  const rows = [
    candidateRow(provider({ id: "openai", provider_slug: "openai", priority: 10 }), "gpt-4.1-mini"),
    candidateRow(provider({ id: "deepseek", provider_slug: "deepseek", priority: 20 }), "deepseek-chat"),
  ];
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("down", { status: 503, headers: { "cf-aig-log-id": "failed-log" } }); }) as any;
  const req = new Request("https://example.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "hi" }] }) });
  const res = await handleChatCompletions(req, { DM_DB: candidateDb(rows), CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "cf", CF_AIG_GATEWAY_SLUG: "gw" });
  assert.equal(res.status, 503);
  assert.equal(calls, 1);
});

test("Only provider-token-free bindings may register free_tier models", async () => {
  async function runFor(authType: string, expectOk: boolean) {
    const models: Record<string, any> = {};
    const p = provider({ id: authType === "cloudflare-binding" ? "workers-ai" : "openai", provider_slug: authType === "cloudflare-binding" ? "workers-ai" : "openai", auth_type: authType as any, transport: authType === "cloudflare-binding" ? "workers-ai-binding" : "gateway-native" });
    const db: any = {
      prepare(sql: string) {
        const st: any = { args: [] as any[], bind(...args: any[]) { this.args = args; return this; }, async first() {
          if (sql.includes("FROM models WHERE id")) return models[this.args[0]] || null;
          if (sql.includes("FROM providers WHERE id")) return this.args[0] === p.id ? p : null;
          return null;
        }, async run() {
          if (sql.includes("INSERT INTO models")) models[this.args[0]] = { id: this.args[0], provider_id: this.args[1], public_alias: this.args[2], enabled: this.args[3], free_tier: this.args[4], created_at: "" };
          return { success: true, meta: { changes: 1 } };
        }, async all() { return { results: [] }; } };
        return st;
      }
    };
    if (expectOk) {
      const m = await createModel({ DM_DB: db } as any, { id: "free-model", providerId: p.id, freeTier: true });
      assert.equal(m.free_tier, 1);
    } else {
      await assert.rejects(() => createModel({ DM_DB: db } as any, { id: "not-free", providerId: p.id, freeTier: true }), /free_tier_requires_provider_token_free_binding/);
    }
  }
  await runFor("cloudflare-binding", true);
  await runFor("byok", false);
});

// ---------------------------------------------------------------------------
// New API-compatible gateways — TaBiToken, GoRouter, self-hosted New API.
// Per AI-Gateway-Master-Report.md, all three share the QuantumNous/new-api
// codebase, so they are modeled as gateway-custom presets with the same
// OpenAI-compatible api_path and an operator-editable base_url (the report's
// Section 3 flags root-domain vs. `api.` subdomain as genuinely disputed).
// ---------------------------------------------------------------------------

test("Provider catalog includes the New API-compatible gateway presets", () => {
  const tabitoken = knownProviderTemplate("tabitoken");
  const gorouter = knownProviderTemplate("gorouter");
  const newApi = knownProviderTemplate("new-api");

  assert.ok(tabitoken, "missing tabitoken preset");
  assert.ok(gorouter, "missing gorouter preset");
  assert.ok(newApi, "missing new-api preset");

  for (const preset of [tabitoken, gorouter, newApi]) {
    assert.equal(preset?.transport, "gateway-custom");
    assert.equal(preset?.authType, "byok");
    assert.deepEqual(preset?.allowedAuthTypes, ["byok"]);
    assert.equal(preset?.credentialRequired, true);
    assert.equal(preset?.customizable, true);
    assert.equal(preset?.apiPath, "v1/chat/completions");
    assert.equal(preset?.testModel, "gpt-4o-mini");
  }

  // Hosted instances ship a known default base URL; the generic self-hosted
  // preset intentionally has none — the operator must supply their own.
  assert.equal(tabitoken?.baseUrl, "https://tabitoken.com");
  assert.equal(gorouter?.baseUrl, "https://gorouter.app");
  assert.equal(newApi?.baseUrl, undefined);
});

test("Provider catalog ids remain unique after adding the New API gateways", () => {
  const ids = KNOWN_PROVIDER_TEMPLATES.map((p) => p.id);
  assert.equal(ids.length, new Set(ids).size, "duplicate provider template id");
});

/**
 * Minimal in-memory D1 stand-in for the router.ts POST /admin/api/providers
 * flow: providers/models keyed by id, matched by SQL substring the way
 * src/admin/db.ts issues its queries.
 */
function makeProviderRegistryDb() {
  const providers = new Map<string, any>();
  const models = new Map<string, any>();
  const db = {
    prepare(sql: string) {
      const st: any = {
        args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this; },
        async first() {
          if (sql.includes("FROM providers WHERE id")) return providers.get(this.args[0]) ?? null;
          if (sql.includes("FROM models WHERE id")) return models.get(this.args[0]) ?? null;
          return null;
        },
        async all() {
          if (sql.includes("FROM providers")) return { results: Array.from(providers.values()) };
          if (sql.includes("FROM models")) return { results: Array.from(models.values()) };
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO providers")) {
            const [id, display_name, kind, provider_slug, transport, auth_type, base_url, api_path,
              priority, credential_required, custom_provider_id, test_model, enabled, health_state] = this.args;
            providers.set(id, {
              id, display_name, kind, provider_slug, transport, auth_type, base_url, api_path, priority,
              credential_required, custom_provider_id, test_model, enabled, health_state,
              byok_alias: null, last_success_at: null, last_error_at: null, last_error_message: null,
              last_latency_ms: null, last_http_status: null, last_gateway_log_id: null, last_gateway_step: null,
              last_cf_ray: null, created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z",
            });
          } else if (sql.includes("UPDATE providers SET byok_alias")) {
            const [alias, id] = this.args;
            const row = providers.get(id);
            if (row) row.byok_alias = alias;
          } else if (sql.includes("INSERT INTO models")) {
            const [id, provider_id, public_alias, enabled, free_tier] = this.args;
            models.set(id, { id, provider_id, public_alias, enabled, free_tier, created_at: "2026-09-08T00:00:00Z" });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return st;
    },
  };
  return { db, providers, models };
}

test("Adding a TaBiToken provider without a body baseUrl/testModel falls back to the preset defaults", async () => {
  const { db, providers } = makeProviderRegistryDb();
  const env = {
    MCP_AUTH_TOKEN: "tok",
    DM_DB: db as any,
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_API_TOKEN: "cf-admin-token",
    CF_AIG_GATEWAY_SLUG: "gw",
  } as unknown as AdminEnv;

  let seenCreateBody: any = null;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/ai-gateway/custom-providers")) {
      seenCreateBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ success: true, result: { id: "cp-tabitoken", slug: "tabitoken", base_url: seenCreateBody.base_url } }), { status: 200 });
    }
    // No credential token supplied in this test, so no BYOK secret calls happen.
    return new Response(JSON.stringify({ success: false }), { status: 404 });
  }) as any;

  const cookie = (await createSessionCookie(env)).split(";")[0];
  const req = new Request("https://example.com/admin/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://example.com" },
    // Deliberately omit baseUrl, testModel, and modelId — these must come
    // from the tabitoken preset (see router.ts template.baseUrl/testModel fallback).
    body: JSON.stringify({ templateId: "tabitoken" }),
  });

  const res = await handleAdmin(req, env);
  const body = await res.json() as any;
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.ok, true);

  // The Cloudflare Custom Provider was provisioned with the preset's known base URL.
  assert.equal(seenCreateBody.base_url, "https://tabitoken.com");

  const stored = providers.get("tabitoken");
  assert.ok(stored, "tabitoken provider row should be persisted");
  assert.equal(stored.transport, "gateway-custom");
  assert.equal(stored.base_url, "https://tabitoken.com");
  assert.equal(stored.provider_slug, "custom-tabitoken");
});

test("Adding a TaBiToken provider with an overridden baseUrl uses the operator's value instead", async () => {
  const { db, providers } = makeProviderRegistryDb();
  const env = {
    MCP_AUTH_TOKEN: "tok",
    DM_DB: db as any,
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_API_TOKEN: "cf-admin-token",
    CF_AIG_GATEWAY_SLUG: "gw",
  } as unknown as AdminEnv;

  let seenCreateBody: any = null;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/ai-gateway/custom-providers")) {
      seenCreateBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ success: true, result: { id: "cp-tabitoken", slug: "tabitoken", base_url: seenCreateBody.base_url } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: false }), { status: 404 });
  }) as any;

  const cookie = (await createSessionCookie(env)).split(";")[0];
  const req = new Request("https://example.com/admin/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://example.com" },
    // Section 3 of the master report: root domain vs. `api.` subdomain is
    // disputed — the operator must be able to override the seeded default.
    body: JSON.stringify({ templateId: "tabitoken", baseUrl: "https://api.tabitoken.com" }),
  });

  const res = await handleAdmin(req, env);
  const body = await res.json() as any;
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(seenCreateBody.base_url, "https://api.tabitoken.com");
  assert.equal(providers.get("tabitoken").base_url, "https://api.tabitoken.com");
});

test("Adding a self-hosted New API provider requires an operator-supplied base URL", async () => {
  const { db } = makeProviderRegistryDb();
  const env = {
    MCP_AUTH_TOKEN: "tok",
    DM_DB: db as any,
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_API_TOKEN: "cf-admin-token",
    CF_AIG_GATEWAY_SLUG: "gw",
  } as unknown as AdminEnv;
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: false }), { status: 404 })) as any;

  const cookie = (await createSessionCookie(env)).split(";")[0];
  const req = new Request("https://example.com/admin/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://example.com" },
    body: JSON.stringify({ templateId: "new-api" }),
  });
  const res = await handleAdmin(req, env);
  const body = await res.json() as any;
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
});

test("gateway-custom transport for a New API gateway routes through the Cloudflare AI Gateway custom-provider path", async () => {
  const p: ProviderRow = provider({
    id: "tabitoken",
    provider_slug: "custom-tabitoken",
    transport: "gateway-custom",
    auth_type: "byok",
    base_url: "https://tabitoken.com",
    api_path: "v1/chat/completions",
    custom_provider_id: "cp-tabitoken",
    credential_required: 1,
  });
  let seenUrl = "";
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    seenUrl = String(url);
    return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "cf-aig-log-id": "log-1" } });
  }) as any;
  const result = await requestProviderChat(p, "gpt-4o-mini", { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }, {
    CLOUDFLARE_ACCOUNT_ID: "acct", CF_AIG_GATEWAY_SLUG: "gw", CF_AIG_TOKEN: "aig-token",
  } as any);
  assert.match(seenUrl, /\/v1\/acct\/gw\/custom-tabitoken\/v1\/chat\/completions$/);
  assert.equal(result.gatewayVerified, true);
});
