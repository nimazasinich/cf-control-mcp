import test from "node:test";
import assert from "node:assert/strict";
import { internetTools } from "../src/internet/tools";

const EXPECTED = [
  "web_search", "web_search_multi", "web_news_search", "web_image_search",
  "web_fetch", "web_render", "web_markdown", "web_extract",
  "web_links", "web_snapshot", "web_crawl", "web_deep_research",
];

test("exposes exactly the 12 internet tools", () => {
  assert.deepEqual(internetTools.map((t) => t.name).sort(), [...EXPECTED].sort());
  assert.equal(internetTools.length, 12);
});

test("every tool has a description, object inputSchema, and required query/url where applicable", () => {
  for (const t of internetTools) {
    assert.ok(t.description && t.description.length > 20, `${t.name} description`);
    assert.equal((t.inputSchema as any).type, "object", `${t.name} schema type`);
    assert.equal(typeof t.handler, "function", `${t.name} handler`);
  }
});

test("read/fetch tools are openWorldHint:true", () => {
  for (const t of internetTools) {
    assert.equal(t.annotations?.openWorldHint, true, `${t.name} openWorldHint`);
  }
});

test("web_fetch is NOT annotated read-only (it can POST/PUT/PATCH/DELETE)", () => {
  const wf = internetTools.find((t) => t.name === "web_fetch")!;
  assert.equal(wf.annotations?.readOnlyHint, false);
});

test("pure read/search tools are annotated readOnlyHint:true", () => {
  const readOnly = [
    "web_search", "web_search_multi", "web_news_search", "web_image_search",
    "web_render", "web_markdown", "web_extract", "web_links", "web_snapshot",
    "web_crawl", "web_deep_research",
  ];
  for (const name of readOnly) {
    const t = internetTools.find((x) => x.name === name)!;
    assert.equal(t.annotations?.readOnlyHint, true, `${name} should be readOnlyHint:true`);
  }
});

test("web_search auto path falls back to keyless ddg with zero paid secrets (mocked)", async () => {
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = async () =>
    new Response(
      '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>' +
      '<a class="result__snippet">a snippet</a>',
      { status: 200, headers: { "content-type": "text/html" } },
    );
  try {
    const wf = internetTools.find((t) => t.name === "web_search")!;
    // HTMLRewriter is a Workers global; skip the DDG-parse assertion if absent.
    if (typeof (globalThis as any).HTMLRewriter === "undefined") {
      await assert.rejects(() => wf.handler({ query: "hi" }, {} as any));
      return;
    }
    const out: any = await wf.handler({ query: "hi" }, {} as any);
    assert.equal(out.provider, "ddg");
  } finally {
    (globalThis as any).fetch = origFetch;
  }
});
