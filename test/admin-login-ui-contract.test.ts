import test from "node:test";
import assert from "node:assert/strict";
import { loginPageHtml } from "../src/admin/ui";

test("Admin login preserves cf-control-mcp identity and token backend contract", () => {
  const html = loginPageHtml();
  assert.ok(html.includes("cf-control-mcp — Admin"));
  assert.ok(html.includes('method="POST" action="/admin/login"'));
  assert.ok(html.includes('name="token"'));
  assert.ok(html.includes('autocomplete="current-password"'));
  assert.ok(html.includes('id="auth-token" name="token"'));
  assert.ok(html.includes("Sign in"));
});

test("Admin login preserves canonical email/token visuals without fake alternate auth", () => {
  const html = loginPageHtml();
  assert.ok(html.includes('id="auth-email"'));
  assert.ok(html.includes('readonly aria-readonly="true"'));
  assert.ok(html.includes("or continue with"));
  assert.ok(html.includes("OAuth sign-in is not enabled"));
  assert.ok(!html.includes('name="email"'));
  assert.ok(!html.includes('name="password"'));
});

test("Admin login server error remains HTML-escaped", () => {
  const html = loginPageHtml('<script>alert("x")</script>');
  assert.ok(!html.includes('<script>alert("x")</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
});
