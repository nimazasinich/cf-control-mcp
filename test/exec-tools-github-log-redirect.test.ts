import test from "node:test";
import assert from "node:assert/strict";
import { tools } from "../src/index";
import type { Env } from "../src/index";

const origFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = origFetch;
});

function findTool(name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `tool ${name} not found in exported tools[]`);
  return tool!;
}

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    MCP_AUTH_TOKEN: "test-token",
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    DM_DB: {} as any,
    GITHUB_PAT: "super-secret-github-pat",
    ...overrides,
  } as Env;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("gh_get_run_result: follows GitHub job-log redirect without forwarding GITHUB_PAT", async () => {
  const calls: { url: string; init: RequestInit }[] = [];

  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });

    if (u.includes("/actions/workflows/mcp-exec.yml/runs")) {
      return jsonResponse({
        workflow_runs: [
          {
            id: 99,
            status: "completed",
            conclusion: "success",
            display_title: "mcp-exec redirect-test-key",
            html_url: "https://github.com/example/repo/actions/runs/99",
          },
        ],
      });
    }

    if (u.includes("/actions/runs/99/jobs")) {
      return jsonResponse({ jobs: [{ id: 555 }] });
    }

    if (u.includes("/actions/jobs/555/logs")) {
      assert.equal(init.redirect, "manual");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer super-secret-github-pat");
      return new Response(null, {
        status: 302,
        headers: { Location: "https://signed-log.example.test/job-555.txt?sig=opaque" },
      });
    }

    if (u.startsWith("https://signed-log.example.test/")) {
      const headers = new Headers(init.headers);
      assert.equal(headers.has("authorization"), false, "GITHUB_PAT must never reach the signed log host");
      assert.doesNotMatch(JSON.stringify(init), /super-secret-github-pat/);
      return new Response("GH_MCP_EXEC_OK\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    throw new Error(`unexpected URL in redirect regression test: ${u}`);
  }) as any;

  const tool = findTool("gh_get_run_result");
  const result: any = await tool.handler({ run_key: "redirect-test-key" }, mockEnv());

  assert.equal(result.status, "completed");
  assert.equal(result.conclusion, "success");
  assert.equal(result.log, "GH_MCP_EXEC_OK\n");
  assert.equal(calls.length, 4);
});
