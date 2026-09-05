import test from "node:test";
import assert from "node:assert/strict";
import { BraveProvider } from "../src/internet/providers/brave";
import { TavilyProvider } from "../src/internet/providers/tavily";
import { ExaProvider } from "../src/internet/providers/exa";
import { SearchRouter } from "../src/internet/search-router";
import { InternetError } from "../src/internet/types";

type FetchArgs = { url: string; init: RequestInit };
const calls: FetchArgs[] = [];
const origFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  (globalThis as any).fetch = async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test.afterEach(() => {
  (globalThis as any).fetch = origFetch;
  calls.length = 0;
});

test("Brave: unconfigured provider reports isConfigured=false and throws CONFIGURATION_ERROR", async () => {
  const p = new BraveProvider(undefined);
  assert.equal(p.isConfigured(), false);
  await assert.rejects(() => p.search("hi", {}), (e: unknown) =>
    e instanceof InternetError && e.code === "CONFIGURATION_ERROR");
});

test("Brave: normalizes web results and sends the subscription-token header (key not in URL)", async () => {
  mockFetch((url) => {
    assert.ok(url.startsWith("https://api.search.brave.com/res/v1/web/search"));
    assert.ok(!url.includes("secret-brave-key"));
    return json({ web: { results: [
      { title: "Ex", url: "https://example.com", description: "a <b>snippet</b>", page_age: "2026-01-01" },
      { title: "No URL", url: "", description: "x" },
    ] } });
  });
  const p = new BraveProvider("secret-brave-key");
  assert.equal(p.isConfigured(), true);
  const out = await p.search("hello", { maxResults: 5 });
  assert.equal((calls[0].init.headers as any)["X-Subscription-Token"], "secret-brave-key");
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    title: "Ex", url: "https://example.com", snippet: "a snippet",
    provider: "brave", publishedAt: "2026-01-01",
  });
});

test("Brave: 429 maps to RATE_LIMITED and does not leak the key", async () => {
  mockFetch(() => new Response("slow down key=secret-brave-key", { status: 429 }));
  const p = new BraveProvider("secret-brave-key");
  await assert.rejects(() => p.search("x", {}), (e: unknown) => {
    return e instanceof InternetError && e.code === "RATE_LIMITED" && !e.message.includes("secret-brave-key");
  });
});

test("Tavily: sends api_key in POST body, not the URL, and normalizes results", async () => {
  mockFetch((url, init) => {
    assert.equal(url, "https://api.tavily.com/search");
    assert.ok(!url.includes("tav-key"));
    const body = JSON.parse(String(init.body));
    assert.equal(body.api_key, "tav-key");
    return json({ results: [
      { title: "T", url: "https://t.example", content: "body", published_date: "2026-02-02", score: 0.9 },
    ] });
  });
  const p = new TavilyProvider("tav-key");
  const out = await p.search("q", {});
  assert.equal(out[0].provider, "tavily");
  assert.equal(out[0].score, 0.9);
  assert.equal(out[0].snippet, "body");
});

test("Exa: sends x-api-key header (not URL) and normalizes text into snippet", async () => {
  mockFetch((url, init) => {
    assert.equal(url, "https://api.exa.ai/search");
    assert.equal((init.headers as any)["x-api-key"], "exa-key");
    return json({ results: [
      { title: "E", url: "https://e.example", text: "long text body", score: 0.5, publishedDate: "2026-03-03" },
    ] });
  });
  const p = new ExaProvider("exa-key");
  const out = await p.search("q", {});
  assert.equal(out[0].provider, "exa");
  assert.ok(out[0].snippet.startsWith("long text"));
});

test("Router: with zero paid secrets, only ddg is configured", () => {
  const r = new SearchRouter({});
  assert.deepEqual(r.configuredProviders(), ["ddg"]);
  assert.deepEqual(r.configuredPaidProviders(), []);
});

test("Router: with all secrets, all four providers are configured", () => {
  const r = new SearchRouter({ BRAVE_SEARCH_API_KEY: "b", TAVILY_API_KEY: "t", EXA_API_KEY: "e" });
  assert.deepEqual(r.configuredProviders().sort(), ["brave", "ddg", "exa", "tavily"]);
});

test("Router auto: falls back from a failing provider to the next configured one", async () => {
  let braveCalls = 0;
  mockFetch((url) => {
    if (url.includes("api.search.brave.com")) { braveCalls += 1; return new Response("boom", { status: 500 }); }
    if (url.includes("api.tavily.com")) {
      return json({ results: [{ title: "T", url: "https://t.example", content: "ok" }] });
    }
    return new Response("unexpected", { status: 404 });
  });
  const r = new SearchRouter({ BRAVE_SEARCH_API_KEY: "b", TAVILY_API_KEY: "t" });
  const out = await r.search("q", "auto", {});
  assert.equal(braveCalls, 1);
  assert.equal(out.provider, "tavily");
  assert.deepEqual(out.fallbackFrom, ["brave"]);
});

test("Router multi: isolates a failing provider and still returns the other's results", async () => {
  mockFetch((url) => {
    if (url.includes("api.search.brave.com")) return new Response("boom", { status: 500 });
    if (url.includes("api.tavily.com")) {
      return json({ results: [{ title: "T", url: "https://t.example", content: "ok" }] });
    }
    return new Response("unexpected", { status: 404 });
  });
  const r = new SearchRouter({ BRAVE_SEARCH_API_KEY: "b", TAVILY_API_KEY: "t" });
  const out = await r.searchMulti("q", ["brave", "tavily"], {});
  assert.deepEqual(out.providersSucceeded, ["tavily"]);
  assert.equal(out.providersFailed.length, 1);
  assert.equal(out.providersFailed[0].provider, "brave");
  assert.equal(out.count, 1);
});

test("Router images: without brave secret, throws CONFIGURATION_ERROR", async () => {
  const r = new SearchRouter({});
  await assert.rejects(() => r.searchImages("cats", {}), (e: unknown) =>
    e instanceof InternetError && e.code === "CONFIGURATION_ERROR");
});
