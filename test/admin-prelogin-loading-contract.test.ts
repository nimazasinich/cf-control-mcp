import test from "node:test";
import assert from "node:assert/strict";
import { handleAdmin } from "../src/admin/router";
import type { AdminEnv } from "../src/admin/types";

test("unauthenticated Login is gated by the approved Loading experience", async () => {
  const env = { MCP_AUTH_TOKEN: "owner-secret" } as AdminEnv;

  const gate = await handleAdmin(new Request("https://example.com/admin/login"), env);
  assert.equal(gate.status, 200);
  const gateHtml = await gate.text();
  assert.ok(gateHtml.includes("DreamWorker — Loading Refined 1368×753"));
  assert.ok(gateHtml.includes("/admin/api/prelogin"));
  assert.ok(gateHtml.includes("/admin/login?ready=1"));

  const probe = await handleAdmin(new Request("https://example.com/admin/api/prelogin"), env);
  assert.equal(probe.status, 200);
  assert.deepEqual(await probe.json(), { ok: true, authenticated: false });

  const login = await handleAdmin(new Request("https://example.com/admin/login?ready=1"), env);
  assert.equal(login.status, 200);
  const loginHtml = await login.text();
  assert.ok(loginHtml.includes('id="auth-token"'));
  assert.ok(loginHtml.includes("form.setAttribute('action', '/admin/login')"));
  assert.ok(loginHtml.includes("token.setAttribute('name', 'token')"));
});

test("prelogin probe reports a valid signed Admin session without exposing operational data", async () => {
  const env = { MCP_AUTH_TOKEN: "owner-secret" } as AdminEnv;
  // No cookie means false; the exact shape is intentionally minimal.
  const probe = await handleAdmin(new Request("https://example.com/admin/api/prelogin"), env);
  const body = await probe.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["authenticated", "ok"]);
  assert.equal(body.ok, true);
  assert.equal(body.authenticated, false);
});
