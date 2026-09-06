import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

const pageIds = ["overview", "providers", "models", "mcp-tools", "routing", "health", "usage", "logs", "settings"];

test("DreamWorker Admin remains one 1368x753 shared shell with nine distinct pages", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("width:1368px"));
  assert.ok(html.includes("height:753px"));
  assert.equal((html.match(/class=\"sidebar\"/g) || []).length, 1);
  assert.equal((html.match(/class=\"header\"/g) || []).length, 1);
  for (const id of pageIds) {
    assert.equal((html.match(new RegExp(`id=\\\"page-${id}\\\"`, "g")) || []).length, 1, `${id} must exist exactly once`);
  }
});

test("Shared shell keeps existing relative Admin API contracts", () => {
  const html = dashboardHtml();
  for (const path of [
    "/admin/api/overview",
    "/admin/api/providers",
    "/admin/api/models",
    "/admin/api/routing",
    "/admin/api/tools",
    "/admin/api/health",
    "/admin/api/usage",
    "/admin/api/logs",
    "/admin/api/settings",
  ]) assert.ok(html.includes(path), `missing ${path}`);
});

test("Fidelity work does not inject visual mock performance claims", () => {
  const html = dashboardHtml();
  for (const fake of ["99.9%", "99.8%", "Avg Latency", "Estimated spend", "Requests today"]) {
    assert.ok(!html.includes(fake), `unexpected fabricated visual claim: ${fake}`);
  }
  assert.ok(html.includes("backend/runtime state is authoritative".replace("backend", "Backend")));
});

test("Models catalog header aligns with the real six-cell renderer contract", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("Routing aliases</th><th style=\"width:14%\">Actions</th>"));
  assert.ok(html.includes('id="models-body"><tr><td colspan="6"'));
});
