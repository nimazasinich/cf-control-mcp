import test from "node:test";
import assert from "node:assert/strict";
import { tools } from "../src/index";
import type { Env } from "../src/index";

const origFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = origFetch;
});

function findTool(name: string) {
  const t = tools.find((t) => t.name === name);
  assert.ok(t, `tool ${name} not found in exported tools[]`);
  return t!;
}

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    MCP_AUTH_TOKEN: "test-token",
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    DM_DB: {} as any,
    GITHUB_PAT: "gh-pat",
    ...overrides,
  } as Env;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// run_code (Piston)
// ---------------------------------------------------------------------------

test("run_code: success path returns Piston's run result", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ run: { stdout: "2\n", stderr: "", code: 0 } });
  }) as any;

  const tool = findTool("run_code");
  const result: any = await tool.handler({ language: "python", code: "print(1+1)" }, mockEnv());

  assert.equal(result.run.stdout, "2\n");
  assert.equal(result.run.code, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /emkc\.org\/api\/v2\/piston\/execute/);
  const sentBody = JSON.parse(String(calls[0].init.body));
  assert.equal(sentBody.language, "python");
  assert.equal(sentBody.files[0].content, "print(1+1)");
});

test("run_code: non-zero exit code is passed through, not thrown", async () => {
  globalThis.fetch = (async () => jsonResponse({ run: { stdout: "", stderr: "", code: 3 } })) as any;
  const tool = findTool("run_code");
  const result: any = await tool.handler({ language: "python", code: "import sys; sys.exit(3)" }, mockEnv());
  assert.equal(result.run.code, 3);
});

test("run_code: Piston HTTP error surfaces as a thrown Error with status", async () => {
  globalThis.fetch = (async () => jsonResponse({ message: "bad language" }, 400)) as any;
  const tool = findTool("run_code");
  await assert.rejects(
    () => tool.handler({ language: "not-a-real-lang", code: "x" }, mockEnv()),
    /Piston API error \(400\)/,
  );
});

test("run_code: defaults version to '*' and args to []", async () => {
  let sentBody: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    sentBody = JSON.parse(String(init.body));
    return jsonResponse({ run: { stdout: "", stderr: "", code: 0 } });
  }) as any;
  const tool = findTool("run_code");
  await tool.handler({ language: "python", code: "pass" }, mockEnv());
  assert.equal(sentBody.version, "*");
  assert.deepEqual(sentBody.args, []);
});

test("run_code: validation — missing language throws", async () => {
  const tool = findTool("run_code");
  await assert.rejects(() => tool.handler({ code: "print(1)" }, mockEnv()), /language is required/);
});

test("run_code: validation — empty code throws", async () => {
  const tool = findTool("run_code");
  await assert.rejects(() => tool.handler({ language: "python", code: "   " }, mockEnv()), /code is empty/);
});

test("run_code: validation — code over 200KB throws", async () => {
  const tool = findTool("run_code");
  const big = "x".repeat(200_001);
  await assert.rejects(
    () => tool.handler({ language: "python", code: big }, mockEnv()),
    /exceeds 200 KB sandbox limit/,
  );
});

test("run_code: timeout aborts and raises a labeled error", async () => {
  globalThis.fetch = ((_url: any, init: any) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as any;
  const tool = findTool("run_code");
  await assert.rejects(
    () => tool.handler({ language: "python", code: "while True: pass" }, mockEnv()),
    /Piston execute timed out/,
  );
});

// ---------------------------------------------------------------------------
// list_code_runtimes (Piston)
// ---------------------------------------------------------------------------

test("list_code_runtimes: returns the runtimes list on success", async () => {
  globalThis.fetch = (async () => jsonResponse([{ language: "python", version: "3.12.0" }])) as any;
  const tool = findTool("list_code_runtimes");
  const result: any = await tool.handler({}, mockEnv());
  assert.equal(result[0].language, "python");
});

test("list_code_runtimes: HTTP error throws", async () => {
  globalThis.fetch = (async () => new Response("", { status: 503 })) as any;
  const tool = findTool("list_code_runtimes");
  await assert.rejects(() => tool.handler({}, mockEnv()), /Piston API error \(503\)/);
});

// ---------------------------------------------------------------------------
// gh_run_code
// ---------------------------------------------------------------------------

test("gh_run_code: dispatches the workflow with a fresh run_key and base64 code", async () => {
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  }) as any;

  const tool = findTool("gh_run_code");
  const result: any = await tool.handler({ language: "python", code: "print(1+1)" }, mockEnv());

  assert.equal(result.status, "dispatched");
  assert.ok(typeof result.run_key === "string" && result.run_key.length > 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/repos\/nimazasinich\/cf-control-mcp\/actions\/workflows\/mcp-exec\.yml\/dispatches$/);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.ref, "main");
  assert.equal(body.inputs.run_key, result.run_key);
  assert.equal(Buffer.from(body.inputs.code_b64, "base64").toString("utf8"), "print(1+1)");
});

test("gh_run_code: honors a custom GITHUB_REPO env override", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return new Response(null, { status: 204 });
  }) as any;
  const tool = findTool("gh_run_code");
  await tool.handler({ language: "bash", code: "echo hi" }, mockEnv({ GITHUB_REPO: "someone/other-repo" }));
  assert.match(calls[0], /\/repos\/someone\/other-repo\/actions\/workflows\/mcp-exec\.yml\/dispatches$/);
});

test("gh_run_code: passes through optional setup and args inputs", async () => {
  let body: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    body = JSON.parse(String(init.body));
    return new Response(null, { status: 204 });
  }) as any;
  const tool = findTool("gh_run_code");
  await tool.handler({ language: "python", code: "x", setup: "pip install requests", args: "--flag 1" }, mockEnv());
  assert.equal(body.inputs.setup, "pip install requests");
  assert.equal(body.inputs.args, "--flag 1");
});

test("gh_run_code: validation — missing language throws", async () => {
  const tool = findTool("gh_run_code");
  await assert.rejects(() => tool.handler({ code: "x" }, mockEnv()), /language is required/);
});

test("gh_run_code: validation — code over 500KB throws", async () => {
  const tool = findTool("gh_run_code");
  const big = "x".repeat(500_001);
  await assert.rejects(() => tool.handler({ language: "python", code: big }, mockEnv()), /exceeds 500 KB limit/);
});

test("gh_run_code: missing GITHUB_PAT throws a clear configuration error", async () => {
  const tool = findTool("gh_run_code");
  await assert.rejects(
    () => tool.handler({ language: "python", code: "x" }, mockEnv({ GITHUB_PAT: undefined })),
    /GITHUB_PAT is not configured/,
  );
});

test("gh_run_code: GitHub HTTP error on dispatch surfaces the status and body", async () => {
  globalThis.fetch = (async () => jsonResponse({ message: "Bad credentials" }, 401)) as any;
  const tool = findTool("gh_run_code");
  await assert.rejects(() => tool.handler({ language: "python", code: "x" }, mockEnv()), /GitHub API error \(401\)/);
});

test("gh_run_code: never leaks GITHUB_PAT into the returned result", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as any;
  const tool = findTool("gh_run_code");
  const result: any = await tool.handler({ language: "python", code: "print(1)" }, mockEnv({ GITHUB_PAT: "super-secret-pat-value" }));
  assert.doesNotMatch(JSON.stringify(result), /super-secret-pat-value/);
});

// ---------------------------------------------------------------------------
// gh_get_run_result
// ---------------------------------------------------------------------------

test("gh_get_run_result: returns not_found_yet when the run isn't visible on page 1", async () => {
  globalThis.fetch = (async () => jsonResponse({ workflow_runs: [] })) as any;
  const tool = findTool("gh_get_run_result");
  const result: any = await tool.handler({ run_key: "abc-123" }, mockEnv());
  assert.equal(result.status, "not_found_yet");
});

test("gh_get_run_result: returns in_progress status without fetching logs", async () => {
  let logFetchCount = 0;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/actions/runs/") || String(url).includes("/logs")) logFetchCount++;
    return jsonResponse({
      workflow_runs: [{ id: 42, status: "in_progress", conclusion: null, display_title: "mcp-exec abc-123", html_url: "https://x" }],
    });
  }) as any;
  const tool = findTool("gh_get_run_result");
  const result: any = await tool.handler({ run_key: "abc-123" }, mockEnv());
  assert.equal(result.status, "in_progress");
  assert.equal(result.run_id, 42);
  assert.equal(logFetchCount, 0);
});

test("gh_get_run_result: completed run fetches and returns the job log", async () => {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/actions/workflows/mcp-exec.yml/runs")) {
      return jsonResponse({
        workflow_runs: [{ id: 99, status: "completed", conclusion: "success", display_title: "mcp-exec run-key-xyz", html_url: "https://x/99" }],
      });
    }
    if (u.includes("/actions/runs/99/jobs")) {
      return jsonResponse({ jobs: [{ id: 555 }] });
    }
    if (u.includes("/actions/jobs/555/logs")) {
      return new Response("2\n", { status: 200, headers: { "content-type": "text/plain" } });
    }
    throw new Error(`unexpected URL in test: ${u}`);
  }) as any;
  const tool = findTool("gh_get_run_result");
  const result: any = await tool.handler({ run_key: "run-key-xyz" }, mockEnv());
  assert.equal(result.status, "completed");
  assert.equal(result.conclusion, "success");
  assert.equal(result.log, "2\n");
});

test("gh_get_run_result: truncates logs over 60KB", async () => {
  const hugeLog = "a".repeat(70_000);
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/runs?event=workflow_dispatch")) {
      return jsonResponse({ workflow_runs: [{ id: 1, status: "completed", conclusion: "success", display_title: "mcp-exec k1", html_url: "https://x" }] });
    }
    if (u.includes("/jobs") && !u.includes("/logs")) return jsonResponse({ jobs: [{ id: 1 }] });
    if (u.includes("/logs")) return new Response(hugeLog, { status: 200, headers: { "content-type": "text/plain" } });
    throw new Error(`unexpected URL: ${u}`);
  }) as any;
  const tool = findTool("gh_get_run_result");
  const result: any = await tool.handler({ run_key: "k1" }, mockEnv());
  assert.ok(result.log.length < 70_000);
  assert.match(result.log, /\[truncated]$/);
});

test("gh_get_run_result: validation — missing run_key throws", async () => {
  const tool = findTool("gh_get_run_result");
  await assert.rejects(() => tool.handler({}, mockEnv()), /run_key is required/);
});

test("gh_get_run_result: 'no jobs found yet' path for a completed run with an empty jobs array", async () => {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/runs?event=workflow_dispatch")) {
      return jsonResponse({ workflow_runs: [{ id: 7, status: "completed", conclusion: "success", display_title: "mcp-exec k7", html_url: "https://x" }] });
    }
    if (u.includes("/jobs")) return jsonResponse({ jobs: [] });
    throw new Error(`unexpected URL: ${u}`);
  }) as any;
  const tool = findTool("gh_get_run_result");
  const result: any = await tool.handler({ run_key: "k7" }, mockEnv());
  assert.equal(result.log, "(no jobs found for this run yet)");
});
