from pathlib import Path
import re


def patch_index() -> None:
    p = Path("src/index.ts")
    s = p.read_text()

    import_anchor = 'import { internetTools } from "./internet/tools";\n'
    import_line = 'import { paizaExecute, paizaRuntimes } from "./code-execution/paiza";\n'
    if import_line not in s:
        if import_anchor not in s:
            raise SystemExit("index import anchor not found")
        s = s.replace(import_anchor, import_anchor + import_line, 1)

    s = s.replace(
        "// Sandbox code execution (Piston, emkc.org) — free, no API key required.",
        "// Sandbox code execution (paiza.IO guest API) — no account or secret required.",
    )
    s = s.replace(
        "(Piston or GitHub) can hold a Worker request open indefinitely",
        "(paiza.IO or GitHub) can hold a Worker request open indefinitely",
    )

    pattern = re.compile(
        r"const PISTON_TIMEOUT_MS = 25_000;\nconst GITHUB_TIMEOUT_MS = 20_000;\n\n"
        r"/\*\* Executes a snippet via the public Piston API.*?"
        r"async function pistonRuntimes\(\): Promise<any> \{.*?\n\}\n",
        re.S,
    )
    s, removed = pattern.subn("const GITHUB_TIMEOUT_MS = 20_000;\n", s, count=1)
    if removed != 1 and ("pistonExecute(" in s or "pistonRuntimes(" in s):
        raise SystemExit(f"expected one Piston helper block, removed={removed}")

    old_desc = '''\t\tdescription:\n\t\t\t"Execute a short code snippet for free in an ephemeral public sandbox (Piston, emkc.org) and return " +\n\t\t\t"stdout, stderr, and exit code. Supports common languages (python, javascript/node, typescript, bash, " +\n\t\t\t"go, rust, java, c, cpp, etc — call list_code_runtimes for the exact catalog). No account or credentials " +\n\t\t\t"involved, no persistent state, and nothing here touches the Cloudflare/HF accounts. Not suitable for " +\n\t\t\t"secrets or private data: the sandbox is a shared free third-party service.",'''
    new_desc = '''\t\tdescription:\n\t\t\t"Execute a short code snippet through the public paiza.IO guest API and return stdout, stderr, and exit code. " +\n\t\t\t"No account or secret API key is required, but paiza.IO documents access limits and no service guarantee. " +\n\t\t\t"Supports common languages including python, javascript, typescript, bash, go, rust, java, c and cpp; " +\n\t\t\t"call list_code_runtimes for supported ids. Do not send secrets or private data to this shared third-party runner.",'''
    if old_desc not in s:
        raise SystemExit("run_code description anchor not found")
    s = s.replace(old_desc, new_desc, 1)

    s = s.replace(
        'language: { type: "string", description: "Piston language id, e.g. \'python\', \'javascript\', \'bash\', \'go\'" },',
        'language: { type: "string", description: "paiza.IO language id or common alias, e.g. \'python\', \'javascript\', \'bash\', \'go\'" },',
        1,
    )
    s = s.replace(
        'version: { type: "string", description: "Language version, or \'*\' for latest. Default \'*\'." },',
        'version: { type: "string", description: "Only \'*\' (default) is supported; paiza.IO manages runtime versions." },',
        1,
    )
    s = s.replace(
        'args: { type: "array", items: { type: "string" }, description: "Optional CLI args passed to the program" },',
        'args: { type: "array", items: { type: "string" }, description: "Retained for compatibility but unsupported by paiza.IO; use stdin or gh_run_code when argv is required." },',
        1,
    )

    old_handler = '''\t\thandler: async (args) => {\n\t\t\tconst language = String(args.language ?? "").trim();\n\t\t\tconst code = String(args.code ?? "");\n\t\t\tif (!language) throw new Error("language is required");\n\t\t\tif (!code.trim()) throw new Error("code is empty");\n\t\t\tif (code.length > 200_000) throw new Error("code exceeds 200 KB sandbox limit");\n\t\t\tconst version = String(args.version ?? "*");\n\t\t\tconst stdin = String(args.stdin ?? "");\n\t\t\tconst cliArgs = Array.isArray(args.args) ? args.args.map((a) => String(a)).slice(0, 32) : [];\n\t\t\treturn await pistonExecute(language, version, code, stdin, cliArgs);\n\t\t},'''
    new_handler = '''\t\thandler: async (args) => {\n\t\t\tconst language = String(args.language ?? "").trim();\n\t\t\tconst code = String(args.code ?? "");\n\t\t\tif (!language) throw new Error("language is required");\n\t\t\tif (!code.trim()) throw new Error("code is empty");\n\t\t\tif (code.length > 200_000) throw new Error("code exceeds 200 KB sandbox limit");\n\t\t\tconst version = String(args.version ?? "*");\n\t\t\tconst stdin = String(args.stdin ?? "");\n\t\t\tconst cliArgs = Array.isArray(args.args) ? args.args.map((a) => String(a)).slice(0, 32) : [];\n\t\t\treturn await paizaExecute(language, version, code, stdin, cliArgs);\n\t\t},'''
    if old_handler not in s:
        raise SystemExit("run_code handler anchor not found")
    s = s.replace(old_handler, new_handler, 1)

    old_runtime = '''\t\tdescription: "List the languages/versions currently available in the free Piston sandbox used by run_code.",\n\t\tinputSchema: { type: "object", properties: {} },\n\t\tannotations: { readOnlyHint: true, openWorldHint: true },\n\t\thandler: async () => await pistonRuntimes(),'''
    new_runtime = '''\t\tdescription: "List documented paiza.IO guest API language ids used by run_code. Runtime versions are managed by paiza.IO.",\n\t\tinputSchema: { type: "object", properties: {} },\n\t\tannotations: { readOnlyHint: true, openWorldHint: true },\n\t\thandler: async () => paizaRuntimes(),'''
    if old_runtime not in s:
        raise SystemExit("list_code_runtimes anchor not found")
    s = s.replace(old_runtime, new_runtime, 1)
    s = s.replace("Unlike run_code (Piston), this can", "Unlike run_code (paiza.IO), this can", 1)

    p.write_text(s)


def patch_tests() -> None:
    p = Path("test/exec-tools.test.ts")
    s = p.read_text()
    start = s.index("// ---------------------------------------------------------------------------\n// run_code (Piston)")
    end = s.index("// ---------------------------------------------------------------------------\n// gh_run_code", start)
    replacement = r'''// ---------------------------------------------------------------------------
// run_code (paiza.IO)
// ---------------------------------------------------------------------------

function paizaDetails(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    language: "python3",
    status: "completed",
    build_stdout: null,
    build_stderr: null,
    build_exit_code: 0,
    build_result: null,
    stdout: "2\n",
    stderr: "",
    exit_code: 0,
    result: "success",
    time: "0.01",
    memory: 1024,
    ...overrides,
  };
}

test("run_code: paiza guest success returns the compatible run contract", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/create.json")) return jsonResponse({ id: "session-1", status: "completed" });
    if (String(url).includes("/get_details.json")) return jsonResponse(paizaDetails());
    throw new Error(`unexpected fetch ${url}`);
  }) as any;

  const tool = findTool("run_code");
  const result: any = await tool.handler({ language: "python", code: "print(1+1)" }, mockEnv());

  assert.equal(result.backend, "paiza.io");
  assert.equal(result.language, "python3");
  assert.equal(result.run.stdout, "2\n");
  assert.equal(result.run.stderr, "");
  assert.equal(result.run.code, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /api\.paiza\.io\/runners\/create\.json$/);
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get("language"), "python3");
  assert.equal(body.get("source_code"), "print(1+1)");
  assert.equal(body.get("api_key"), "guest");
});

test("run_code: polls running sessions until completed", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    if (String(url).endsWith("/create.json")) return jsonResponse({ id: 7, status: "running" });
    if (String(url).includes("/get_status.json")) return jsonResponse({ id: 7, status: "completed" });
    if (String(url).includes("/get_details.json")) return jsonResponse(paizaDetails({ id: 7 }));
    throw new Error(`unexpected fetch ${url}`);
  }) as any;
  const tool = findTool("run_code");
  const result: any = await tool.handler({ language: "python3", code: "print(2)" }, mockEnv());
  assert.equal(result.run.code, 0);
  assert.equal(urls.filter((u) => u.includes("get_status")).length, 1);
});

test("run_code: runtime non-zero exit is preserved", async () => {
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith("/create.json")) return jsonResponse({ id: "x", status: "completed" });
    return jsonResponse(paizaDetails({ stdout: "", stderr: "boom", exit_code: 3, result: "failure" }));
  }) as any;
  const tool = findTool("run_code");
  const result: any = await tool.handler({ language: "python", code: "raise SystemExit(3)" }, mockEnv());
  assert.equal(result.run.code, 3);
  assert.equal(result.run.stderr, "boom");
});

test("run_code: build failure is surfaced through stderr and compatible non-zero code", async () => {
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith("/create.json")) return jsonResponse({ id: "x", status: "completed" });
    return jsonResponse(paizaDetails({
      language: "c",
      build_stderr: "syntax error",
      build_exit_code: 1,
      build_result: "failure",
      stdout: null,
      stderr: null,
      exit_code: null,
      result: "failure",
    }));
  }) as any;
  const tool = findTool("run_code");
  const result: any = await tool.handler({ language: "c", code: "not c" }, mockEnv());
  assert.equal(result.run.code, 1);
  assert.equal(result.run.stderr, "syntax error");
  assert.equal(result.compile.stderr, "syntax error");
  assert.equal(result.compile.code, 1);
});

test("run_code: stdin is forwarded to paiza input", async () => {
  let createBody = "";
  globalThis.fetch = (async (url: any, init: any = {}) => {
    if (String(url).endsWith("/create.json")) {
      createBody = String(init.body);
      return jsonResponse({ id: "x", status: "completed" });
    }
    return jsonResponse(paizaDetails({ stdout: "hello\n" }));
  }) as any;
  const tool = findTool("run_code");
  await tool.handler({ language: "python", code: "print(input())", stdin: "hello" }, mockEnv());
  assert.equal(new URLSearchParams(createBody).get("input"), "hello");
});

test("run_code: explicit version selection fails closed", async () => {
  const tool = findTool("run_code");
  await assert.rejects(
    () => tool.handler({ language: "python", version: "3.12", code: "pass" }, mockEnv()),
    /manages runtime versions and cannot select version/,
  );
});

test("run_code: CLI args fail closed instead of being silently dropped", async () => {
  const tool = findTool("run_code");
  await assert.rejects(
    () => tool.handler({ language: "python", code: "pass", args: ["one"] }, mockEnv()),
    /does not support CLI arguments/,
  );
});

test("run_code: unknown language fails before upstream execution", async () => {
  const tool = findTool("run_code");
  await assert.rejects(
    () => tool.handler({ language: "not-a-real-lang", code: "x" }, mockEnv()),
    /does not support language/,
  );
});

test("run_code: upstream HTTP error surfaces with stage and status", async () => {
  globalThis.fetch = (async () => jsonResponse({ message: "unavailable" }, 503)) as any;
  const tool = findTool("run_code");
  await assert.rejects(() => tool.handler({ language: "python", code: "x" }, mockEnv()), /paiza\.IO API error \(503\) during create/);
});

test("run_code: paiza error field is treated as a failure", async () => {
  globalThis.fetch = (async () => jsonResponse({ status: "running", error: "rate limited" })) as any;
  const tool = findTool("run_code");
  await assert.rejects(() => tool.handler({ language: "python", code: "x" }, mockEnv()), /paiza\.IO create error: rate limited/);
});

test("run_code: AbortError is surfaced as a labeled upstream timeout", async () => {
  globalThis.fetch = (async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }) as any;
  const tool = findTool("run_code");
  await assert.rejects(() => tool.handler({ language: "python", code: "x" }, mockEnv()), /paiza\.IO create timed out/);
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

// ---------------------------------------------------------------------------
// list_code_runtimes (paiza.IO)
// ---------------------------------------------------------------------------

test("list_code_runtimes: returns documented paiza language ids without an upstream call", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("should not fetch");
  }) as any;
  const tool = findTool("list_code_runtimes");
  const result: any = await tool.handler({}, mockEnv());
  assert.ok(Array.isArray(result));
  assert.ok(result.some((row: any) => row.language === "python3"));
  assert.ok(result.some((row: any) => row.language === "javascript"));
  assert.ok(result.some((row: any) => row.language === "rust"));
  assert.equal(result[0].backend, "paiza.io");
  assert.equal(result[0].version_policy, "service-managed");
  assert.equal(calls, 0);
});

'''
    p.write_text(s[:start] + replacement + s[end:])


def patch_live_smoke() -> None:
    p = Path("scripts/exec_tools_live_smoke.py")
    s = p.read_text()
    s = s.replace("Piston for run_code/list_code_runtimes", "paiza.IO for run_code/list_code_runtimes")
    s = s.replace("PASS: list_code_runtimes live Piston lookup", "PASS: list_code_runtimes paiza.IO capability catalog")
    s = s.replace("expected Piston result.run object", "expected paiza.IO-compatible result.run object")
    s = s.replace("PISTON_MCP_EXEC_OK", "PAIZA_MCP_EXEC_OK")
    s = s.replace("Piston run_code stdout", "paiza.IO run_code stdout")
    p.write_text(s)


patch_index()
patch_tests()
patch_live_smoke()
print("paiza.IO patch applied")
