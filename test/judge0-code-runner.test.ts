import test from "node:test";
import assert from "node:assert/strict";
import { judge0Config, judge0Execute, judge0Runtimes } from "../src/code-execution/judge0";

const origFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = origFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Judge0 RapidAPI config requires an API key", () => {
  assert.throws(() => judge0Config({}), /JUDGE0_API_KEY is not configured/);
});

test("Judge0 custom HTTPS endpoint can run without auth", () => {
  const config = judge0Config({ JUDGE0_BASE_URL: "https://judge0.example.test/" });
  assert.equal(config.baseUrl, "https://judge0.example.test");
  assert.equal(config.headers.Authorization, undefined);
});

test("Judge0 rejects non-HTTPS endpoints", () => {
  assert.throws(() => judge0Config({ JUDGE0_BASE_URL: "http://judge0.example.test" }), /must use https/);
});

test("Judge0 RapidAPI config keeps the key in request headers only", () => {
  const config = judge0Config({ JUDGE0_API_KEY: "secret-key" });
  assert.equal(config.baseUrl, "https://judge0-ce.p.rapidapi.com");
  assert.equal(config.headers["X-RapidAPI-Key"], "secret-key");
  assert.equal(config.headers["X-RapidAPI-Host"], "judge0-ce.p.rapidapi.com");
  assert.doesNotMatch(config.baseUrl, /secret-key/);
});

test("judge0Runtimes normalizes the language catalog", async () => {
  let seenHeaders: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    seenHeaders = init.headers;
    return jsonResponse([
      { id: 71, name: "Python (3.8.1)" },
      { id: 93, name: "JavaScript (Node.js 18.15.0)" },
    ]);
  }) as any;

  const runtimes = await judge0Runtimes({ JUDGE0_API_KEY: "secret-key" });
  assert.equal(runtimes[0].language, "python");
  assert.equal(runtimes[0].version, "3.8.1");
  assert.equal(runtimes[0].provider, "judge0");
  assert.equal(runtimes[1].language, "javascript");
  assert.equal(seenHeaders["X-RapidAPI-Key"], "secret-key");
});

test("judge0Execute resolves a language, polls, and preserves the run_code result contract", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/languages/")) {
      return jsonResponse([
        { id: 70, name: "Python (2.7.17)" },
        { id: 71, name: "Python (3.8.1)" },
      ]);
    }
    if (u.includes("/submissions?base64_encoded=false&wait=false")) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.language_id, 71);
      assert.equal(body.source_code, "print(1+1)");
      assert.equal(body.stdin, "");
      return jsonResponse({ token: "submission-token" }, 201);
    }
    if (u.includes("/submissions/submission-token?")) {
      return jsonResponse({
        stdout: "2\n",
        stderr: null,
        compile_output: null,
        message: null,
        exit_code: 0,
        exit_signal: null,
        time: "0.01",
        memory: 4096,
        status: { id: 3, description: "Accepted" },
      });
    }
    throw new Error(`unexpected URL: ${u}`);
  }) as any;

  const result: any = await judge0Execute({ JUDGE0_API_KEY: "secret-key" }, "python", "*", "print(1+1)", "", []);
  assert.equal(result.provider, "judge0");
  assert.equal(result.language, "python");
  assert.equal(result.version, "3.8.1");
  assert.equal(result.run.stdout, "2\n");
  assert.equal(result.run.stderr, "");
  assert.equal(result.run.code, 0);
  assert.equal(result.judge0.language_id, 71);
  assert.ok(calls.every((call) => !call.url.includes("secret-key")));
});

test("judge0Execute passes non-zero execution outcomes through instead of throwing", async () => {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.endsWith("/languages/")) return jsonResponse([{ id: 71, name: "Python (3.8.1)" }]);
    if (u.includes("/submissions?")) return jsonResponse({ token: "t" }, 201);
    return jsonResponse({
      stdout: "",
      stderr: "boom\n",
      compile_output: null,
      message: null,
      exit_code: 3,
      exit_signal: null,
      status: { id: 11, description: "Runtime Error (NZEC)" },
    });
  }) as any;

  const result: any = await judge0Execute({ JUDGE0_API_KEY: "secret-key" }, "python", "*", "raise SystemExit(3)", "", []);
  assert.equal(result.run.code, 3);
  assert.match(result.run.stderr, /boom/);
});

test("Judge0 API errors include status but never include the API key", async () => {
  globalThis.fetch = (async () => jsonResponse({ message: "unauthorized" }, 401)) as any;
  await assert.rejects(
    () => judge0Runtimes({ JUDGE0_API_KEY: "super-secret-key" }),
    (err: any) => {
      assert.match(String(err?.message), /Judge0 API error \(401\)/);
      assert.doesNotMatch(String(err?.message), /super-secret-key/);
      return true;
    },
  );
});
