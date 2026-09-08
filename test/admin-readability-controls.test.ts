import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("Admin output includes the readability control layer", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="admin-readability-controls"'));
  assert.ok(html.includes(".tool-ident strong{font-size:9.5px!important"));
  assert.ok(html.includes(".inspector-description{font-size:9.2px!important"));
  assert.ok(html.includes(".tool-mode.destructive{background:#eef3ff!important"));
  assert.ok(html.includes(".tool-protocol.danger{background:#fff2df!important"));
});

test("Providers default to enabled-only view with a two-state Active / All toggle", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="admin-provider-view-controls"'));
  assert.ok(html.includes("var mode='active'"));
  assert.ok(html.includes("mode==='active'?'Active providers':'All providers'"));
  assert.ok(html.includes("mode=mode==='active'?'all':'active'"));
  assert.ok(html.includes("row.classList.contains('disabled-row')"));
  assert.ok(html.includes("text(state||cells[1]).toUpperCase()==='ACTIVE'"));
});
