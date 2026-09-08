import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Providers keeps a provider-specific operational posture and diagnostic inspector", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-providers"'));
  assert.ok(html.includes("PROVIDER FLEET"));
  assert.ok(html.includes("Operational posture"));
  assert.ok(html.includes("Operational Inspector"));
  assert.ok(html.includes("Latest diagnostic evidence"));
  assert.ok(html.includes('id="provider-ops-test"'));
  assert.ok(html.includes('id="providers-body"'));
});

test("Providers preserves real actions and exposes the supported create-provider workflow", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('data-action="add-provider"'));
  assert.ok(html.includes("Create provider"));
  assert.ok(html.includes("Credential material is submitted once and never returned."));
  assert.ok(html.includes('data-action="refresh-providers"'));
  assert.ok(!html.includes('No create-provider backend contract exists'));
  assert.ok(html.includes('data-provider-toggle'));
  assert.ok(html.includes('data-provider-test'));
  assert.ok(html.includes('data-provider-credential'));
  assert.ok(html.includes('data-provider-credential-remove'));
  assert.ok(!html.includes('/admin/api/providers/create'));
});

test("Providers does not add synthetic latency or uptime claims", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("No synthetic latency or uptime is generated."));
  assert.ok(!html.includes("99.9%"));
  assert.ok(!html.includes("Avg Latency"));
});
