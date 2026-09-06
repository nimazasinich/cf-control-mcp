import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Admin loading experience is tied to the real bootstrap contract", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="bootstrap"'));
  assert.ok(html.includes('id="boot-grid"'));
  assert.ok(html.includes('id="boot-retry"'));
  assert.ok(html.includes('id="boot-continue"'));
  assert.ok(html.includes('id="boot-progress-count"'));
  assert.ok(html.includes("No synthetic readiness."));
  assert.ok(html.includes("Progress reflects actual Admin bootstrap sources"));
});

test("Admin loading experience does not use timer-based fake completion", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("0 / 9 settled"));
  assert.ok(html.includes("MutationObserver"));
  assert.ok(!html.includes("setInterval(function(){document.getElementById('boot-percent')"));
  assert.ok(!html.includes("Signing you in..."));
});
