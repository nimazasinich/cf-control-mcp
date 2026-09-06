import test from "node:test";
import assert from "node:assert/strict";
import { handleAdmin } from "../src/admin/router";
import { createSessionCookie } from "../src/admin/auth";
import { tools } from "../src/index";
import type { AdminEnv } from "../src/admin/types";

function mockEnv(): AdminEnv {
  return {
    MCP_AUTH_TOKEN: "owner-secret",
    DM_DB: {} as D1Database,
  };
}

async function adminCookie(env: AdminEnv): Promise<string> {
  const setCookie = await createSessionCookie(env);
  return setCookie.split(";", 1)[0];
}

test("Admin MCP Tools endpoint mirrors the runtime tool registry without exposing handlers", async () => {
  const env = mockEnv();
  const cookie = await adminCookie(env);
  const request = new Request("https://example.com/admin/api/tools", { headers: { Cookie: cookie } });
  const response = await handleAdmin(request, env, tools);
  assert.equal(response.status, 200);

  const payload: any = await response.json();
  assert.equal(payload.count, tools.length);
  assert.equal(payload.count, 44);
  assert.deepEqual(payload.tools.map((tool: any) => tool.name), tools.map((tool) => tool.name));
  assert.equal(payload.readOnlyCount, tools.filter((tool) => tool.annotations?.readOnlyHint === true).length);
  assert.equal(payload.destructiveCount, tools.filter((tool) => tool.annotations?.destructiveHint === true).length);
  assert.equal(payload.openWorldCount, tools.filter((tool) => tool.annotations?.openWorldHint === true).length);

  for (const tool of payload.tools) {
    assert.equal(typeof tool.name, "string");
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.inputSchema, "object");
    assert.equal("handler" in tool, false);
  }
  assert.equal(JSON.stringify(payload).includes("owner-secret"), false);
});

test("Admin MCP Tools endpoint remains owner-session protected", async () => {
  const env = mockEnv();
  const request = new Request("https://example.com/admin/api/tools");
  const response = await handleAdmin(request, env, tools);
  assert.equal(response.status, 401);
});
