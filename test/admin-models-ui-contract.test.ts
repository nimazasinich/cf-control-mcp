import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Models keeps the shared shell but has a distinct registry/availability/inspector architecture", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-models"'));
  assert.ok(html.includes("Registry posture"));
  assert.ok(html.includes("Alias → model resolution"));
  assert.ok(html.includes("AVAILABILITY CHAIN"));
  assert.ok(html.includes("Selected Model Inspector"));
  assert.ok(html.includes('id="model-inspector-toggle"'));
  assert.ok(html.includes('id="models-body"'));
  assert.ok(html.includes('id="model-search"'));
  assert.ok(html.includes('id="model-filter"'));
});

test("Models preserves existing Admin backend controls and fail-closed unsupported actions", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('data-action="refresh-models"'));
  assert.ok(html.includes('No register-model backend contract exists'));
  assert.ok(html.includes('Test invocation unavailable'));
  assert.ok(html.includes('No Admin model-invocation test endpoint exists'));
  assert.ok(!html.includes('/admin/api/models/register'));
  assert.ok(!html.includes('/admin/api/models/invoke'));
});

test("Models fidelity layer keeps the canonical 1368x753 shared shell contract", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('width:1368px'));
  assert.ok(html.includes('height:753px'));
  assert.equal((html.match(/class="sidebar"/g) || []).length, 1);
  assert.equal((html.match(/class="header"/g) || []).length, 1);
});
