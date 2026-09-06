import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Usage is an operational observability surface with explicit instrumentation coverage", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-usage"'));
  assert.ok(html.includes("OBSERVABILITY LINEAGE"));
  assert.ok(html.includes("INSTRUMENTATION MATRIX"));
  assert.ok(html.includes("CONTROL-PLANE POSTURE"));
  assert.ok(html.includes("Audit event lens"));
  assert.ok(html.includes("Diagnostic samples"));
  assert.ok(html.includes('id="usage-actions"'));
  assert.ok(html.includes('id="usage-total"'));
  assert.ok(html.includes('id="usage-recent"'));
});

test("Usage keeps unavailable analytics explicitly unavailable instead of fabricating charts", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("No request/token accounting contract"));
  assert.ok(html.includes("no synthetic request graph"));
  assert.ok(html.includes("no inferred cost"));
  assert.ok(html.includes("no invented token counts"));
  assert.ok(html.includes("No synthetic chart will be drawn."));
  assert.ok(!html.includes("Requests today"));
  assert.ok(!html.includes("Estimated spend"));
});
