import test from "node:test";
import assert from "node:assert/strict";
import { loginPageHtml } from "../src/admin/ui";

test("Admin login preserves cf-control-mcp identity and token backend contract", () => {
  const html = loginPageHtml();
  assert.ok(html.includes("cf-control-mcp — Admin"));
  assert.ok(html.includes('method="POST" action="/admin/login"'));
  assert.ok(html.includes('name="token"'));
  assert.ok(html.includes('data-default-auth="token"'));
  assert.ok(html.includes('data-auth-mode="token" aria-controls="token-panel" aria-selected="true"'));
  assert.ok(html.includes("Sign in"));
});

test("Admin login exposes username/password as preview-only, not a backend credential contract", () => {
  const html = loginPageHtml();
  assert.ok(html.includes("Username &amp; Password"));
  assert.ok(html.includes('data-auth-mode="password"'));
  assert.ok(html.includes('data-preview-field="username"'));
  assert.ok(html.includes('data-preview-field="password"'));
  assert.ok(html.includes("No backend contract yet"));
  assert.ok(!html.includes('name="username"'));
  assert.ok(!html.includes('name="password"'));
});

test("Admin login server error remains HTML-escaped", () => {
  const html = loginPageHtml('<script>alert("x")</script>');
  assert.ok(!html.includes('<script>alert("x")</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
});
