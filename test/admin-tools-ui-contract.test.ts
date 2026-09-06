import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../src/admin/ui";

test("MCP Tools is a runtime-backed workbench with scope, annotation filters and persistent detail", () => {
  const html = dashboardHtml();
  assert.ok(html.includes('id="page-mcp-tools"'));
  assert.ok(html.includes("MCP PROTOCOL SURFACE"));
  assert.ok(html.includes("CAPABILITY MAP"));
  assert.ok(html.includes('id="tools-body"'));
  assert.ok(html.includes('id="tool-detail"'));
  assert.ok(html.includes('data-tool-filter="readonly"'));
  assert.ok(html.includes('data-tool-filter="destructive"'));
  assert.ok(html.includes('data-tool-filter="openworld"'));
  assert.ok(html.includes('data-tool-scope="cloudflare"'));
});

test("MCP Tools keeps invocation unavailable when the Admin backend has no invoke contract", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("The Admin API exposes catalog metadata, not tool invocation."));
  assert.ok(html.includes("not exposed in Admin"));
  assert.ok(!html.includes('/admin/api/tools/invoke'));
  assert.ok(!html.includes('/admin/api/tools/call'));
});

test("MCP Tools does not hardcode a sampled tool catalog into the fidelity layer", () => {
  const html = dashboardHtml();
  assert.ok(html.includes("Family grouping is derived from names returned by the live Admin catalog"));
  assert.ok(!html.includes("10 sampled tools shown"));
});
