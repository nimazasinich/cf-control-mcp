import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Audit is an evidence workflow with a persistent inspector, not only an event table", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-logs"'));
  assert.ok(html.includes("EVENT LINEAGE"));
  assert.ok(html.includes("Administrative activity"));
  assert.ok(html.includes("Evidence Inspector"));
  assert.ok(html.includes('id="audit-inspector-detail"'));
  assert.ok(html.includes('id="logs-body"'));
  assert.ok(html.includes('id="logs-summary"'));
});

test("Audit evidence remains safe and read-only", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("Secret values are never requested, reconstructed or exposed."));
  assert.ok(html.includes("Audit history is read-only in the current Admin contract"));
  assert.ok(html.includes("Not exposed in current table"));
  assert.ok(!html.includes('/admin/api/logs/delete'));
  assert.ok(!html.includes('/admin/api/logs/modify'));
});
