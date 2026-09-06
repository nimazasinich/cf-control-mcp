import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Routing exposes configured-to-effective topology and persistent inspector", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-routing"'));
  assert.ok(html.includes("ROUTING CONTRACT"));
  assert.ok(html.includes("Alias resolution map"));
  assert.ok(html.includes('id="routing-topology"'));
  assert.ok(html.includes('id="route-inspector"'));
  assert.ok(html.includes('id="route-strip"'));
  assert.ok(html.includes('id="routing-body"'));
});

test("Routing keeps configured state separate from callability and remains fail closed", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("configured ≠ callable"));
  assert.ok(html.includes("Fail-closed resolution"));
  assert.ok(html.includes("MODEL_DISABLED"));
  assert.ok(html.includes("PROVIDER_DISABLED"));
  assert.ok(html.includes("BROKEN"));
  assert.ok(!html.includes('/admin/api/routing/create'));
  assert.ok(!html.includes('/admin/api/routing/update'));
});
