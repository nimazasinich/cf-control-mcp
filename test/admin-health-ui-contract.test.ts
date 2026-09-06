import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Health has a real diagnostic/radar architecture instead of a generic table-only layout", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-health"'));
  assert.ok(html.includes("DIAGNOSTIC RADAR"));
  assert.ok(html.includes('id="health-radar-points"'));
  assert.ok(html.includes("Diagnostic focus"));
  assert.ok(html.includes("Health history"));
  assert.ok(html.includes('id="provider-health-list"'));
  assert.ok(html.includes('id="health-body"'));
});

test("Health radar is explicitly non-authoritative decoration while state stays backend-derived", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("Dots are real provider states."));
  assert.ok(html.includes("does not claim a live probe"));
  assert.ok(html.includes("No inferred success."));
  assert.ok(html.includes('data-action="test-providers"'));
  assert.ok(html.includes('data-action="refresh-health"'));
});
