import test from "node:test";
import assert from "node:assert/strict";
import { createSessionCookie, isAuthenticated, clearSessionCookie } from "../src/admin/auth";
import { testGoogleAiStudio } from "../src/admin/health";
import { handleAdmin } from "../src/admin/router";
import type { AdminEnv } from "../src/admin/types";

const origFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = origFetch;
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
test("Admin Auth: creates and validates session cookie", async () => {
  const env = { MCP_AUTH_TOKEN: "secret123" } as AdminEnv;
  const cookieHeader = await createSessionCookie(env);
  assert.ok(cookieHeader.startsWith("admin_session="));

  const req = new Request("https://example.com/admin", { headers: { Cookie: cookieHeader.split(";")[0] } });
  assert.equal(await isAuthenticated(req, env), true);

  const badEnv = { MCP_AUTH_TOKEN: "wrong" } as AdminEnv;
  assert.equal(await isAuthenticated(req, badEnv), false);

  const cleared = clearSessionCookie();
  assert.ok(cleared.startsWith("admin_session=;"));
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
test("Admin Health: google-ai-studio not configured", async () => {
  const env = {} as AdminEnv;
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, "NOT_CONFIGURED");
});

test("Admin Health: google-ai-studio healthy", async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "acc", CF_AIG_GATEWAY_SLUG: "gw", CF_AIG_TOKEN: "mock" } as AdminEnv;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({}), { status: 200 });
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, "HEALTHY");
  assert.ok(res.latencyMs !== null);
  assert.equal(res.errorMessage, null);
});

test("Admin Health: google-ai-studio auth error", async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "acc", CF_AIG_GATEWAY_SLUG: "gw", CF_AIG_TOKEN: "mock" } as AdminEnv;
  (globalThis as any).fetch = async () => new Response("unauthorized", { status: 401 });
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, "AUTH_ERROR");
});

// ---------------------------------------------------------------------------
// Unauthenticated guard
// ---------------------------------------------------------------------------
test("Admin API: unauthenticated request returns 401 with ok:false", async () => {
  const env = { MCP_AUTH_TOKEN: "secret123" } as AdminEnv;

  const apiReq = new Request("https://example.com/admin/api/models");
  const apiRes = await handleAdmin(apiReq, env);
  assert.equal(apiRes.status, 401);
  const body = await apiRes.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "unauthorized");

  const uiReq = new Request("https://example.com/admin");
  const uiRes = await handleAdmin(uiReq, env);
  assert.equal(uiRes.status, 200);
  const html = await uiRes.text();
  assert.ok(html.includes("cf-control-mcp — Admin"));
  assert.ok(html.includes("Sign in"));
});

// ---------------------------------------------------------------------------
// D1 mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock D1 database that supports:
 *   .prepare(sql).bind(...).first()
 *   .prepare(sql).bind(...).all()
 *   .prepare(sql).bind(...).run()
 * The store is a Map keyed by entity "type:id".
 */
function makeMockD1(initial: {
  providers?: Record<string, any>;
  models?: Record<string, any>;
  routing?: Record<string, any>;
}) {
  const providers: Record<string, any> = { ...(initial.providers ?? {}) };
  const models: Record<string, any> = { ...(initial.models ?? {}) };
  const routing: Record<string, any> = { ...(initial.routing ?? {}) };
  const audit: any[] = [];

  return {
    _providers: providers,
    _models: models,
    _routing: routing,
    _audit: audit,
    prepare(sql: string) {
      const makeOps = (...args: any[]) => ({
        async first(): Promise<any> {
          if (sql.includes("FROM providers") && sql.includes("WHERE id")) {
            return providers[args[0]] ?? null;
          }
          if (sql.includes("FROM models") && sql.includes("WHERE id")) {
            return models[args[0]] ?? null;
          }
          return null;
        },
        async all(): Promise<{ results: any[] }> {
          if (sql.includes("FROM providers")) {
            return { results: Object.values(providers) };
          }
          if (sql.includes("FROM models")) {
            return { results: Object.values(models) };
          }
          if (sql.includes("FROM routing_rules")) {
            if (sql.includes("WHERE model_id")) {
              return { results: Object.values(routing).filter((r: any) => r.model_id === args[0]) };
            }
            return {
              results: Object.values(routing).map((r: any) => {
                const m = models[r.model_id];
                const p = m ? providers[m.provider_id] : null;
                return {
                  ...r,
                  model_enabled: m != null ? m.enabled : null,
                  provider_id: m ? m.provider_id : null,
                  provider_enabled: p != null ? p.enabled : null,
                };
              }),
            };
          }
          if (sql.includes("FROM audit_events")) {
            return { results: audit };
          }
          if (sql.includes("FROM health_checks")) {
            return { results: [] };
          }
          return { results: [] };
        },
        async run(): Promise<{ meta: { changes: number } }> {
          if (sql.includes("UPDATE models SET enabled")) {
            const id = args[1];
            if (!models[id]) return { meta: { changes: 0 } };
            models[id] = { ...models[id], enabled: args[0] };
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE providers SET enabled")) {
            const id = args[1];
            if (!providers[id]) return { meta: { changes: 0 } };
            providers[id] = { ...providers[id], enabled: args[0] };
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO audit_events")) {
            audit.push({ action: args[0], target: args[1], detail: args[2], at: new Date().toISOString() });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        bind(...newArgs: any[]) { return makeOps(...newArgs); },
      });
      const root = makeOps();
      return { ...root, bind: (...args: any[]) => makeOps(...args) };
    },
  } as unknown as D1Database & { _providers: any; _models: any; _routing: any; _audit: any[] };
}

/** Build an authenticated request by creating a real session cookie */
async function authedReq(url: string, env: AdminEnv, opts: RequestInit = {}): Promise<Request> {
  const cookie = await createSessionCookie(env);
  const cookieValue = cookie.split(";")[0];
  return new Request(url, {
    ...opts,
    headers: { ...((opts.headers as Record<string, string>) ?? {}), Cookie: cookieValue },
  });
}

// ---------------------------------------------------------------------------
// A. PATCH /admin/api/models/:id — enable/disable
// ---------------------------------------------------------------------------
test("Model toggle: enable a disabled model returns 200 with updated model", async () => {
  const db = makeMockD1({
    models: { "gemini-3.5-flash": { id: "gemini-3.5-flash", provider_id: "google-ai-studio", enabled: 0, public_alias: null, created_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/gemini-3.5-flash", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.model.enabled, 1);
});

test("Model toggle: disable an enabled model returns 200", async () => {
  const db = makeMockD1({
    models: { "gemini-3.6-flash": { id: "gemini-3.6-flash", provider_id: "google-ai-studio", enabled: 1, public_alias: null, created_at: "2025-01-01" } },
    routing: { fast: { public_alias: "fast", model_id: "gemini-3.6-flash", updated_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/gemini-3.6-flash", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.model.enabled, 0);
  // The "fast" alias is affected and must be reported
  assert.ok(Array.isArray(body.affectedAliases));
  assert.ok(body.affectedAliases.includes("fast"), "affectedAliases should include fast");
});

// ---------------------------------------------------------------------------
// B. Unknown model → 404
// ---------------------------------------------------------------------------
test("Model toggle: unknown model returns 404 with model_not_found", async () => {
  const db = makeMockD1({ models: {} });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/does-not-exist", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 404);
  const body = await res.json() as any;
  assert.equal(body.ok, false);
  assert.equal(body.error, "model_not_found");
});

// ---------------------------------------------------------------------------
// C. Invalid enabled value → 400
// ---------------------------------------------------------------------------
test("Model toggle: string 'true' as enabled returns 400", async () => {
  const db = makeMockD1({ models: { m: { id: "m", provider_id: "p", enabled: 0 } } });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/m", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: "true" }),
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.ok, false);
  assert.equal(body.error, "enabled_must_be_boolean");
});

test("Model toggle: string 'false' as enabled returns 400 (not coerced to true)", async () => {
  const db = makeMockD1({ models: { m: { id: "m", provider_id: "p", enabled: 1 } } });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/m", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: "false" }),
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.ok, false);
});

test("Model toggle: numeric 0 as enabled returns 400", async () => {
  const db = makeMockD1({ models: { m: { id: "m", provider_id: "p", enabled: 1 } } });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/m", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: 0 }),
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 400);
});

test("Model toggle: malformed JSON returns 400", async () => {
  const db = makeMockD1({ models: { m: { id: "m", provider_id: "p", enabled: 1 } } });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/m", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "{not valid json",
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_json");
});

// ---------------------------------------------------------------------------
// D. D1 row actually changes
// ---------------------------------------------------------------------------
test("Model toggle: D1 row reflects the new enabled state after toggle", async () => {
  const db = makeMockD1({
    models: { "gemini-3.5-flash": { id: "gemini-3.5-flash", provider_id: "google-ai-studio", enabled: 1, public_alias: null, created_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/gemini-3.5-flash", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  await handleAdmin(req, env);
  assert.equal((db as any)._models["gemini-3.5-flash"].enabled, 0, "D1 row should be 0 after disabling");
});

// ---------------------------------------------------------------------------
// E. Audit event recorded
// ---------------------------------------------------------------------------
test("Model toggle: audit event is written on enable", async () => {
  const db = makeMockD1({
    models: { "gemini-3.5-flash": { id: "gemini-3.5-flash", provider_id: "google-ai-studio", enabled: 0, public_alias: null, created_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/gemini-3.5-flash", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  await handleAdmin(req, env);
  const audit = (db as any)._audit as any[];
  assert.ok(audit.some((e) => e.action === "model.enable" && e.target === "gemini-3.5-flash"));
});

test("Model toggle: audit event is written on disable", async () => {
  const db = makeMockD1({
    models: { "gemini-3.6-flash": { id: "gemini-3.6-flash", provider_id: "google-ai-studio", enabled: 1, public_alias: null, created_at: "2025-01-01" } },
    routing: { fast: { public_alias: "fast", model_id: "gemini-3.6-flash", updated_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/gemini-3.6-flash", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  await handleAdmin(req, env);
  const audit = (db as any)._audit as any[];
  assert.ok(audit.some((e) => e.action === "model.disable" && e.target === "gemini-3.6-flash"));
});

// ---------------------------------------------------------------------------
// H. Disabling target of "fast" makes affectedAliases include "fast"
// ---------------------------------------------------------------------------
test("Model disable: reports affected routing aliases", async () => {
  const db = makeMockD1({
    models: { "gemini-3.6-flash": { id: "gemini-3.6-flash", provider_id: "google-ai-studio", enabled: 1, public_alias: null, created_at: "2025-01-01" } },
    routing: {
      fast: { public_alias: "fast", model_id: "gemini-3.6-flash", updated_at: "2025-01-01" },
      quick: { public_alias: "quick", model_id: "gemini-3.6-flash", updated_at: "2025-01-01" },
    },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/models/gemini-3.6-flash", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  const res = await handleAdmin(req, env);
  const body = await res.json() as any;
  assert.ok(body.affectedAliases.includes("fast"));
  assert.ok(body.affectedAliases.includes("quick"));
});

// ---------------------------------------------------------------------------
// I. Re-enabling restores availability (routes report model_enabled=1 again)
// ---------------------------------------------------------------------------
test("Model re-enable: /admin/api/routing reflects model back as enabled", async () => {
  const db = makeMockD1({
    providers: { "google-ai-studio": { id: "google-ai-studio", display_name: "Google", enabled: 1, health_state: "HEALTHY" } },
    models: { "gemini-3.5-flash": { id: "gemini-3.5-flash", provider_id: "google-ai-studio", enabled: 0, public_alias: null, created_at: "2025-01-01" } },
    routing: { fast: { public_alias: "fast", model_id: "gemini-3.5-flash", updated_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;

  // Re-enable
  const enableReq = await authedReq("https://example.com/admin/api/models/gemini-3.5-flash", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  await handleAdmin(enableReq, env);

  // Check routing
  const routingReq = await authedReq("https://example.com/admin/api/routing", env);
  const res = await handleAdmin(routingReq, env);
  const body = await res.json() as any;
  const fastRule = (body.rules as any[]).find((r: any) => r.public_alias === "fast");
  assert.ok(fastRule, "fast routing rule should exist");
  assert.equal(fastRule.model_enabled, 1, "model_enabled should be 1 after re-enabling");
  assert.equal(fastRule.provider_enabled, 1, "provider_enabled should be 1");
});

// ---------------------------------------------------------------------------
// J. Provider disable removes all its models from routing view
// ---------------------------------------------------------------------------
test("Provider disable: routing rules show provider_enabled=0 for all provider's models", async () => {
  const db = makeMockD1({
    providers: { "google-ai-studio": { id: "google-ai-studio", display_name: "Google", enabled: 1, health_state: "HEALTHY", byok_alias: "default" } },
    models: { "gemini-3.6-flash": { id: "gemini-3.6-flash", provider_id: "google-ai-studio", enabled: 1, public_alias: null, created_at: "2025-01-01" } },
    routing: { fast: { public_alias: "fast", model_id: "gemini-3.6-flash", updated_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;

  // Disable provider
  const disableReq = await authedReq("https://example.com/admin/api/providers/google-ai-studio", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  const disableRes = await handleAdmin(disableReq, env);
  assert.equal(disableRes.status, 200);

  // Check routing
  const routingReq = await authedReq("https://example.com/admin/api/routing", env);
  const routingRes = await handleAdmin(routingReq, env);
  const body = await routingRes.json() as any;
  const fastRule = (body.rules as any[]).find((r: any) => r.public_alias === "fast");
  assert.ok(fastRule, "fast routing rule should still exist");
  assert.equal(fastRule.provider_enabled, 0, "provider_enabled should be 0 after provider disable");
});

// ---------------------------------------------------------------------------
// K. Provider re-enable restores eligible models in routing view
// ---------------------------------------------------------------------------
test("Provider re-enable: routing rules show provider_enabled=1 again", async () => {
  const db = makeMockD1({
    providers: { "google-ai-studio": { id: "google-ai-studio", display_name: "Google", enabled: 0, health_state: "HEALTHY", byok_alias: "default" } },
    models: { "gemini-3.6-flash": { id: "gemini-3.6-flash", provider_id: "google-ai-studio", enabled: 1, public_alias: null, created_at: "2025-01-01" } },
    routing: { fast: { public_alias: "fast", model_id: "gemini-3.6-flash", updated_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;

  const enableReq = await authedReq("https://example.com/admin/api/providers/google-ai-studio", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  await handleAdmin(enableReq, env);

  const routingReq = await authedReq("https://example.com/admin/api/routing", env);
  const routingRes = await handleAdmin(routingReq, env);
  const body = await routingRes.json() as any;
  const fastRule = (body.rules as any[]).find((r: any) => r.public_alias === "fast");
  assert.equal(fastRule.provider_enabled, 1, "provider_enabled should be 1 after re-enable");
});

// ---------------------------------------------------------------------------
// Provider: unknown ID → 404
// ---------------------------------------------------------------------------
test("Provider PATCH: unknown provider returns 404", async () => {
  const db = makeMockD1({ providers: {} });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/providers/no-such-provider", env, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 404);
  const body = await res.json() as any;
  assert.equal(body.error, "provider_not_found");
});

// ---------------------------------------------------------------------------
// Overview: enriched stats
// ---------------------------------------------------------------------------
test("Overview: returns enriched counts including enabled/disabled models", async () => {
  const db = makeMockD1({
    providers: { "google-ai-studio": { id: "google-ai-studio", display_name: "Google", enabled: 1, health_state: "HEALTHY" } },
    models: {
      "m1": { id: "m1", provider_id: "google-ai-studio", enabled: 1, public_alias: null, created_at: "2025-01-01" },
      "m2": { id: "m2", provider_id: "google-ai-studio", enabled: 0, public_alias: null, created_at: "2025-01-01" },
    },
    routing: { fast: { public_alias: "fast", model_id: "m1", updated_at: "2025-01-01" } },
  });
  const env = { MCP_AUTH_TOKEN: "tok", DM_DB: db } as unknown as AdminEnv;
  const req = await authedReq("https://example.com/admin/api/overview", env);
  const res = await handleAdmin(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.modelCount, 2);
  assert.equal(body.enabledModelCount, 1);
  assert.equal(body.disabledModelCount, 1);
  assert.equal(body.enabledProviderCount, 1);
  assert.equal(body.activeRoutingCount, 1);
  assert.equal(body.unavailableRoutingCount, 0);
});
