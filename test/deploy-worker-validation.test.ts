import test from "node:test";
import assert from "node:assert/strict";
import { tools } from "../src/index";

/**
 * Regression test for cf_deploy_worker_module input validation.
 *
 * Guards the fix that added strict YYYY-MM-DD validation for
 * `compatibility_date`. A malformed date must be rejected BEFORE any
 * network call to the Cloudflare API; a well-formed date (and the omitted
 * default) must pass validation and reach the upload path.
 */

const deployTool = tools.find((t) => t.name === "cf_deploy_worker_module")!;

function mockEnv() {
  return {
    MCP_AUTH_TOKEN: "owner-secret",
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_ACCOUNT_ID: "acct-123",
  } as any;
}

const VALID_SOURCE = "export default { fetch() { return new Response('ok'); } };";

test("cf_deploy_worker_module is registered with a handler", () => {
  assert.ok(deployTool, "cf_deploy_worker_module tool should exist");
  assert.equal(typeof deployTool.handler, "function");
});

test("rejects a malformed compatibility_date before any network call", async () => {
  const origFetch = globalThis.fetch;
  let fetchCalled = false;
  (globalThis as any).fetch = async () => {
    fetchCalled = true;
    throw new Error("network should not be reached");
  };
  try {
    await assert.rejects(
      () =>
        deployTool.handler(
          {
            script_name: "my-worker",
            source: VALID_SOURCE,
            compatibility_date: "2026-9-7", // single-digit month → invalid
            confirm_destructive: true,
          },
          mockEnv(),
        ),
      /invalid compatibility_date/,
    );
    assert.equal(fetchCalled, false, "validation must fail before the Cloudflare API call");
  } finally {
    (globalThis as any).fetch = origFetch;
  }
});

test("rejects a non-date compatibility_date string", async () => {
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    throw new Error("network should not be reached");
  };
  try {
    await assert.rejects(
      () =>
        deployTool.handler(
          { script_name: "my-worker", source: VALID_SOURCE, compatibility_date: "not-a-date", confirm_destructive: true },
          mockEnv(),
        ),
      /invalid compatibility_date/,
    );
  } finally {
    (globalThis as any).fetch = origFetch;
  }
});

test("accepts a well-formed compatibility_date and reaches the upload", async () => {
  const origFetch = globalThis.fetch;
  let capturedUrl = "";
  (globalThis as any).fetch = async (url: string) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ success: true, result: { id: "my-worker" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const out: any = await deployTool.handler(
      {
        script_name: "my-worker",
        source: VALID_SOURCE,
        compatibility_date: "2026-09-07",
        confirm_destructive: true,
      },
      mockEnv(),
    );
    assert.equal(out.deployed, true);
    assert.equal(out.compatibility_date, "2026-09-07");
    assert.equal(out.script_name, "my-worker");
    assert.match(capturedUrl, /\/accounts\/acct-123\/workers\/scripts\/my-worker$/);
  } finally {
    (globalThis as any).fetch = origFetch;
  }
});

test("defaults an omitted compatibility_date to today's UTC date (YYYY-MM-DD)", async () => {
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ success: true, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const out: any = await deployTool.handler(
      { script_name: "my-worker", source: VALID_SOURCE, confirm_destructive: true },
      mockEnv(),
    );
    assert.match(out.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(out.compatibility_date, new Date().toISOString().slice(0, 10));
  } finally {
    (globalThis as any).fetch = origFetch;
  }
});

test("requires confirm_destructive=true", async () => {
  await assert.rejects(
    () => deployTool.handler({ script_name: "my-worker", source: VALID_SOURCE }, mockEnv()),
    /confirm_destructive=true is required/,
  );
});
