import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Overview remains a substantial operational summary beyond top metrics", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-overview"'));
  assert.ok(html.includes("Operational Overview"));
  assert.ok(html.includes('id="overview-provider-list"'));
  assert.ok(html.includes('id="overview-health"'));
  assert.ok(html.includes('id="overview-runtime-body"'));
  assert.ok(html.includes('id="overview-activity-list"'));
  assert.ok(html.includes("Quick Actions"));
});

test("Overview keeps real backend actions and authoritative-state language", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("Backend/runtime state is authoritative"));
  assert.ok(html.includes('data-action="refresh-all"'));
  assert.ok(html.includes('data-action="test-providers"'));
  assert.ok(html.includes('data-action="verify-tools"'));
  assert.ok(html.includes('data-nav-jump="logs"'));
});
