import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Settings exposes an indexed security/session/data-boundary/readiness architecture", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-settings"'));
  assert.ok(html.includes("SETTINGS INDEX"));
  assert.ok(html.includes('data-settings-view="security"'));
  assert.ok(html.includes('data-settings-view="session"'));
  assert.ok(html.includes('data-settings-view="boundary"'));
  assert.ok(html.includes("Configuration posture"));
  assert.ok(html.includes('id="settings-runtime"'));
  assert.ok(html.includes('id="settings-security"'));
});

test("Settings keeps the real owner-session contract and safe secret boundary", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("12 hours"));
  assert.ok(html.includes("HttpOnly · Secure · SameSite=Strict"));
  assert.ok(html.includes('method="POST" action="/admin/logout"'));
  assert.ok(html.includes("Raw secret values never cross into the frontend."));
  assert.ok(html.includes("presence only"));
  assert.ok(!html.includes('name="CLOUDFLARE_API_TOKEN"'));
  assert.ok(!html.includes('name="GATEWAY_AUTH_TOKEN"'));
  assert.ok(!html.includes('name="MCP_AUTH_TOKEN"'));
});

test("Settings readiness is labeled as configuration readiness, not health verification", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("This score is configuration readiness only."));
  assert.ok(html.includes("It is not provider health, callability, or end-to-end verification."));
});
