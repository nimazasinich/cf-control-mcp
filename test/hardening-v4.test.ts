import test from "node:test";
import assert from "node:assert/strict";
import mcpWorker, { type Env } from "../src/index";
import oauthWorker from "../src/oauth-worker";
import { verifyOwnerToken } from "../src/admin/auth";
import { checkAdminSameOrigin } from "../src/admin/request-security";
import { validateToolArguments } from "../src/mcp-validation";
import { evaluatePassthroughPolicy } from "../src/passthrough-policy";
import { providerHealthFreshness, HEALTH_STALE_AFTER_MS } from "../src/admin/health";
import { providerCallability } from "../src/provider-gateway/provider-callability";
import { consumeRateLimit } from "../src/rate-limit";
import { deleteProviderCredential } from "../src/admin/credentials";
import type { AdminEnv, ProviderRow, ModelRow } from "../src/admin/types";

function auditOnlyDb(): D1Database {
  return {
    prepare(_query: string) {
      const stmt: any = {
        bind: (..._args: unknown[]) => stmt,
        run: async () => ({ success: true, meta: { changes: 1 } }),
        first: async () => null,
        all: async () => ({ results: [] }),
      };
      return stmt;
    },
    batch: async () => [],
  } as unknown as D1Database;
}

async function rpc(env: Env, method: string, params?: Record<string, unknown>) {
  const response = await mcpWorker.fetch(new Request("https://worker.example/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MCP_AUTH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  }), env);
  return { response, body: await response.json() as any };
}

test("Admin owner verification no longer accepts the Cloudflare API credential", async () => {
  const env = { MCP_AUTH_TOKEN: "owner-only", CLOUDFLARE_API_TOKEN: "cloudflare-only" } as AdminEnv;
  assert.equal(await verifyOwnerToken("owner-only", env), true);
  assert.equal(await verifyOwnerToken("cloudflare-only", env), false);
});

test("Admin same-origin policy rejects cross-origin and missing-origin mutations", () => {
  assert.deepEqual(checkAdminSameOrigin(new Request("https://worker.example/admin/api/models", {
    method: "PATCH",
    headers: { Origin: "https://worker.example" },
  })), { ok: true, source: "origin" });
  assert.equal(checkAdminSameOrigin(new Request("https://worker.example/admin/api/models", {
    method: "PATCH",
    headers: { Origin: "https://attacker.example" },
  })).ok, false);
  assert.equal(checkAdminSameOrigin(new Request("https://worker.example/admin/api/models", { method: "PATCH" })).ok, false);
});

test("MCP tools/list filters catalog by OAuth capability", async () => {
  const env = {
    MCP_AUTH_TOKEN: "inner-token",
    CLOUDFLARE_API_TOKEN: "unused",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    DM_DB: auditOnlyDb(),
    MCP_AUTHZ_MODE: "oauth",
    MCP_AUTHZ_SCOPES: "mcp:read offline_access",
  } as Env;
  const { body } = await rpc(env, "tools/list");
  const names = new Set(body.result.tools.map((tool: any) => tool.name));
  assert.equal(names.has("cf_list_zones"), true);
  assert.equal(names.has("web_search"), true);
  assert.equal(names.has("cf_create_dns_record"), false);
  assert.equal(names.has("run_code"), false);
  assert.equal(names.has("cf_api_request"), false);
});

test("MCP tools/call independently rejects an undisclosed write tool", async () => {
  const env = {
    MCP_AUTH_TOKEN: "inner-token",
    CLOUDFLARE_API_TOKEN: "unused",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    DM_DB: auditOnlyDb(),
    MCP_AUTHZ_MODE: "oauth",
    MCP_AUTHZ_SCOPES: "mcp:read",
  } as Env;
  const { body } = await rpc(env, "tools/call", {
    name: "cf_create_dns_record",
    arguments: { zone_id: "z", type: "A", name: "x.example", content: "1.2.3.4" },
  });
  assert.equal(body.error.code, -32001);
  assert.match(body.error.message, /mcp:write/);
});

test("MCP schema validation rejects malformed arguments before handler execution", async () => {
  const env = {
    MCP_AUTH_TOKEN: "inner-token",
    CLOUDFLARE_API_TOKEN: "unused",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    DM_DB: auditOnlyDb(),
    MCP_AUTHZ_MODE: "oauth",
    MCP_AUTHZ_SCOPES: "mcp:read",
  } as Env;
  const { body } = await rpc(env, "tools/call", { name: "cf_list_dns_records", arguments: {} });
  assert.equal(body.error.code, -32602);
  assert.match(JSON.stringify(body.error.data), /zone_id/);
});

test("schema enum can intentionally accept case-insensitive HTTP methods", () => {
  const result = validateToolArguments({
    type: "object",
    required: ["method"],
    properties: { method: { type: "string", enum: ["GET", "POST"], caseInsensitive: true } },
  }, { method: "get" });
  assert.equal(result.ok, true);
});

test("schema validation enforces declared bounds and additionalProperties", () => {
  const result = validateToolArguments({
    type: "object",
    additionalProperties: false,
    required: ["name", "count"],
    properties: {
      name: { type: "string", minLength: 3, maxLength: 5, pattern: "^[a-z]+$" },
      count: { type: "integer", minimum: 1, maximum: 3 },
      tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
    },
  }, { name: "AB", count: 9, tags: [], extra: true });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" | "), /length >= 3/);
  assert.match(result.errors.join(" | "), /required pattern/);
  assert.match(result.errors.join(" | "), /<= 3/);
  assert.match(result.errors.join(" | "), /at least 1 items/);
  assert.match(result.errors.join(" | "), /extra is not allowed/);
});

test("generic passthrough policy normalizes safe paths and blocks traversal/privileged paths", () => {
  const safe = evaluatePassthroughPolicy({ provider: "cloudflare", method: "get", path: "/zones//abc/dns_records" });
  assert.equal(safe.allowed, true);
  if (safe.allowed) {
    assert.equal(safe.method, "GET");
    assert.equal(safe.path, "/zones/abc/dns_records");
  }
  assert.equal(evaluatePassthroughPolicy({ provider: "cloudflare", method: "GET", path: "/accounts/a/billing/profile" }).allowed, false);
  assert.throws(() => evaluatePassthroughPolicy({ provider: "cloudflare", method: "GET", path: "/zones/%2e%2e/accounts" }), /path_traversal/);
  assert.equal(evaluatePassthroughPolicy({ provider: "huggingface", method: "GET", path: "/api/settings/tokens" }).allowed, false);
});

function callableProvider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "p", display_name: "Provider", kind: "openai", provider_slug: "openai", transport: "gateway-native", auth_type: "byok",
    base_url: null, api_path: "chat/completions", priority: 10, credential_required: 1, custom_provider_id: null, test_model: "m",
    enabled: 1, byok_alias: "default", health_state: "HEALTHY", last_success_at: "2026-09-08 00:00:00", last_error_at: null,
    last_error_message: null, last_latency_ms: 20, last_http_status: 200, last_gateway_log_id: "gw-log", last_gateway_step: null,
    last_cf_ray: null, created_at: "2026-09-08 00:00:00", updated_at: "2026-09-08 00:00:00", ...overrides,
  };
}

const callableModel: ModelRow = { id: "m", provider_id: "p", public_alias: null, enabled: 1, free_tier: 0, display_name: null, description: null, created_at: "2026-09-08 00:00:00" };

test("shared provider callability fails closed on missing Gateway evidence", () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "acct", CF_AIG_GATEWAY_SLUG: "gw", CLOUDFLARE_API_TOKEN: "cf" } as any;
  assert.equal(providerCallability(callableProvider(), callableModel, env).callable, true);
  const missingEvidence = providerCallability(callableProvider({ last_gateway_log_id: null }), callableModel, env);
  assert.equal(missingEvidence.callable, false);
  assert.equal(missingEvidence.reasons.includes("gateway_evidence_missing"), true);
});

test("health freshness distinguishes recent, stale, and never-verified evidence", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  assert.equal(providerHealthFreshness(callableProvider({ last_success_at: "2026-09-08 11:30:00" }), now).freshness, "recent");
  const stale = providerHealthFreshness(callableProvider({ last_success_at: "2026-09-08 10:00:00" }), now);
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.ageMs! > HEALTH_STALE_AFTER_MS, true);
  assert.equal(providerHealthFreshness(callableProvider({ last_success_at: null }), now).freshness, "never-verified");
});

function oauthStateDb() {
  const codes = new Map<string, { clientId: string; redirectUri: string; expiresAt: number; consumedAt: number | null }>();
  const families = new Map<string, { clientId: string; currentHash: string; revokedAt: number | null }>();
  const db = {
    prepare(query: string) {
      const sql = query.replace(/\s+/g, " ").trim();
      let args: any[] = [];
      const stmt: any = {
        bind: (...values: any[]) => { args = values; return stmt; },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.startsWith("INSERT INTO oauth_codes")) {
            const [id, clientId, redirectUri, _issuedAt, expiresAt] = args;
            codes.set(id, { clientId, redirectUri, expiresAt, consumedAt: null });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE oauth_codes SET consumed_at")) {
            const [now, id, clientId, redirectUri, expiresAfter] = args;
            const row = codes.get(id);
            if (row && row.clientId === clientId && row.redirectUri === redirectUri && row.consumedAt === null && row.expiresAt > expiresAfter) {
              row.consumedAt = now;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.startsWith("INSERT INTO refresh_token_families")) {
            const [familyId, currentHash, clientId] = args;
            families.set(familyId, { clientId, currentHash, revokedAt: null });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE refresh_token_families SET current_token_hash")) {
            const [successorHash, _now, familyId, clientId, presentedHash] = args;
            const family = families.get(familyId);
            if (family && family.clientId === clientId && family.currentHash === presentedHash && family.revokedAt === null) {
              family.currentHash = successorHash;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.startsWith("UPDATE refresh_token_families SET revoked_at")) {
            const [now, _updatedAt, familyId, clientId] = args;
            const family = families.get(familyId);
            if (family && family.clientId === clientId && family.revokedAt === null) {
              family.revokedAt = now;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.startsWith("INSERT INTO audit_events")) return { success: true, meta: { changes: 1 } };
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
    batch: async () => [],
  } as unknown as D1Database;
  return { db, codes, families };
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function issueOAuthCode(env: Env, scope = "mcp:read offline_access", grantedScopes?: string[]) {
  const origin = "https://worker.example";
  const redirectUri = "https://client.example/callback";
  const verifier = "v".repeat(64);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const register = await oauthWorker.fetch(new Request(`${origin}/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Hardening Test", token_endpoint_auth_method: "none" }),
  }), env);
  const client = await register.json() as any;
  assert.equal(register.status, 201);

  const authorizeUrl = new URL(`${origin}/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", scope);
  const consent = await oauthWorker.fetch(new Request(authorizeUrl), env);
  const html = await consent.text();
  const formToken = html.match(/name="form_token" value="([^"]+)"/)?.[1];
  assert.ok(formToken);

  const form = new URLSearchParams({ form_token: formToken!, approval_token: env.MCP_AUTH_TOKEN });
  for (const granted of grantedScopes ?? scope.split(/\s+/).filter((item) => item === "mcp:read" || item === "offline_access")) {
    form.append("granted_scope", granted);
  }
  const approved = await oauthWorker.fetch(new Request(`${origin}/authorize`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
  }), env);
  assert.equal(approved.status, 302);
  const location = approved.headers.get("location");
  assert.ok(location);
  const code = new URL(location!).searchParams.get("code");
  assert.ok(code);
  return { origin, redirectUri, verifier, clientId: client.client_id as string, code: code! };
}

async function exchangeCode(env: Env, flow: Awaited<ReturnType<typeof issueOAuthCode>>) {
  const form = new URLSearchParams({
    grant_type: "authorization_code", client_id: flow.clientId, code: flow.code,
    redirect_uri: flow.redirectUri, code_verifier: flow.verifier,
  });
  return oauthWorker.fetch(new Request(`${flow.origin}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
  }), env);
}

test("OAuth authorization codes are one-time-use", async () => {
  const state = oauthStateDb();
  const env = { MCP_AUTH_TOKEN: "owner-secret", DM_DB: state.db } as Env;
  const flow = await issueOAuthCode(env);
  const first = await exchangeCode(env, flow);
  assert.equal(first.status, 200);
  const second = await exchangeCode(env, flow);
  assert.equal(second.status, 400);
  assert.equal((await second.json() as any).error, "invalid_grant");
});


async function oauthRpc(env: Env, accessToken: string, method: string, params?: Record<string, unknown>) {
  const response = await oauthWorker.fetch(new Request("https://worker.example/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method, ...(params ? { params } : {}) }),
  }), env);
  return { response, body: await response.json() as any };
}

test("OAuth owner consent can downscope a privileged client request", async () => {
  const state = oauthStateDb();
  const env = {
    MCP_AUTH_TOKEN: "owner-secret",
    CLOUDFLARE_API_TOKEN: "cf",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    DM_DB: state.db,
  } as Env;
  const flow = await issueOAuthCode(env, "mcp:read mcp:write mcp:admin offline_access", ["mcp:read", "offline_access"]);
  const tokenResponse = await exchangeCode(env, flow);
  assert.equal(tokenResponse.status, 200);
  const tokenBody = await tokenResponse.json() as any;
  assert.match(tokenBody.scope, /mcp:read/);
  assert.doesNotMatch(tokenBody.scope, /mcp:write|mcp:admin/);
  const listed = await oauthRpc(env, tokenBody.access_token, "tools/list");
  const names = new Set(listed.body.result.tools.map((tool: any) => tool.name));
  assert.equal(names.has("cf_list_zones"), true);
  assert.equal(names.has("cf_create_dns_record"), false);
  assert.equal(names.has("cf_api_request"), false);
});

test("OAuth consent cannot grant a scope the client did not request", async () => {
  const state = oauthStateDb();
  const env = {
    MCP_AUTH_TOKEN: "owner-secret",
    CLOUDFLARE_API_TOKEN: "cf",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    DM_DB: state.db,
  } as Env;
  const flow = await issueOAuthCode(env, "mcp:read offline_access", ["mcp:read", "mcp:admin", "offline_access"]);
  const tokenResponse = await exchangeCode(env, flow);
  assert.equal(tokenResponse.status, 200);
  const tokenBody = await tokenResponse.json() as any;
  assert.doesNotMatch(tokenBody.scope, /mcp:admin/);
});

test("OAuth refresh rotation rejects reuse and revokes the token family", async () => {
  const state = oauthStateDb();
  const env = { MCP_AUTH_TOKEN: "owner-secret", DM_DB: state.db } as Env;
  const flow = await issueOAuthCode(env);
  const initial = await exchangeCode(env, flow);
  const initialBody = await initial.json() as any;
  assert.ok(initialBody.refresh_token);

  const refreshForm = new URLSearchParams({ grant_type: "refresh_token", client_id: flow.clientId, refresh_token: initialBody.refresh_token });
  const rotated = await oauthWorker.fetch(new Request(`${flow.origin}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: refreshForm.toString(),
  }), env);
  assert.equal(rotated.status, 200);
  assert.ok((await rotated.json() as any).refresh_token);

  const reused = await oauthWorker.fetch(new Request(`${flow.origin}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: refreshForm.toString(),
  }), env);
  assert.equal(reused.status, 400);
  assert.equal((await reused.json() as any).error, "invalid_grant");
  assert.equal([...state.families.values()].every((family) => family.revokedAt !== null), true);
});


test("D1 rate limiter enforces a fixed window and resets on the next window", async () => {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  const db = {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind: (...values: any[]) => { args = values; return stmt; },
        run: async () => {
          if (sql.includes("INSERT INTO rate_limit_buckets")) {
            const [principal, bucket, windowStart] = args;
            const key = `${principal}:${bucket}`;
            const previous = buckets.get(key);
            if (!previous || previous.windowStart !== windowStart) buckets.set(key, { windowStart, count: 1 });
            else previous.count += 1;
          }
          return { success: true, meta: { changes: 1 } };
        },
        first: async () => {
          if (sql.includes("SELECT window_start, request_count")) {
            const [principal, bucket] = args;
            const row = buckets.get(`${principal}:${bucket}`);
            return row ? { window_start: row.windowStart, request_count: row.count } : null;
          }
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  assert.equal((await consumeRateLimit(db, { principal: "p", bucket: "b", limit: 2, windowSeconds: 60, nowSeconds: 120 })).allowed, true);
  assert.equal((await consumeRateLimit(db, { principal: "p", bucket: "b", limit: 2, windowSeconds: 60, nowSeconds: 121 })).allowed, true);
  assert.equal((await consumeRateLimit(db, { principal: "p", bucket: "b", limit: 2, windowSeconds: 60, nowSeconds: 122 })).allowed, false);
  assert.equal((await consumeRateLimit(db, { principal: "p", bucket: "b", limit: 2, windowSeconds: 60, nowSeconds: 180 })).allowed, true);
});

test("credential deletion fails closed before secret deletion when provider-config cleanup fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();
      calls.push({ url, method });
      if (url.endsWith("/provider_configs") && method === "GET") {
        return new Response(JSON.stringify({ success: true, result: [{ id: "pc1", provider_slug: "openai", alias: "default" }] }), { status: 200 });
      }
      if (url.endsWith("/provider_configs/pc1") && method === "DELETE") {
        return new Response(JSON.stringify({ success: false }), { status: 500 });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    }) as any;
    const result = await deleteProviderCredential({
      MCP_AUTH_TOKEN: "owner", DM_DB: auditOnlyDb(), CLOUDFLARE_API_TOKEN: "cf", CLOUDFLARE_ACCOUNT_ID: "acct", CF_AIG_GATEWAY_SLUG: "gw",
    } as AdminEnv, "openai", "default");
    assert.equal(result.ok, false);
    assert.equal(result.providerConfigDeleted, false);
    assert.equal(result.credentialRevoked, false);
    assert.equal(calls.some((call) => call.url.includes("/secrets_store/")), false, "secret store must not be touched after unconfirmed provider-config cleanup");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
