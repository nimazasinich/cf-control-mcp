import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, htmlToMarkdown, extractLinks, extractBySelectors } from "../src/internet/html";

// HTMLRewriter is a Cloudflare Workers global. Under plain Node it is absent,
// so these behavioral tests only run where a Workers-compatible runtime
// provides it (e.g. `vitest` with the workers pool, or Miniflare). We skip
// rather than fabricate a pass.
const HAS_REWRITER = typeof (globalThis as any).HTMLRewriter !== "undefined";
const maybe = HAS_REWRITER ? test : test.skip;

const BASE = "https://example.com/dir/page.html";

maybe("htmlToText extracts title and drops script/style", async () => {
	const html =
		"<html><head><title>Hello&nbsp;World</title><style>.x{color:red}</style></head>" +
		"<body><p>Visible text.</p><script>var secret=1;</script></body></html>";
	const { title, text } = await htmlToText(html, BASE);
	assert.match(title, /Hello/);
	assert.match(text, /Visible text\./);
	assert.doesNotMatch(text, /secret/);
	assert.doesNotMatch(text, /color:red/);
});

maybe("htmlToText enforces a UTF-8 byte cap (not char count)", async () => {
	const html = "<p>" + "é".repeat(1000) + "</p>"; // 'é' is 2 bytes in UTF-8
	const { text, truncated } = await htmlToText(html, BASE, 100);
	assert.equal(truncated, true);
	assert.ok(new TextEncoder().encode(text).length <= 100, "byte length within cap");
});

maybe("htmlToMarkdown preserves headings, lists and blockquotes", async () => {
	const html =
		"<h1>Title</h1><p>Intro paragraph.</p>" +
		"<ul><li>One</li><li>Two</li></ul><blockquote>Quoted</blockquote>";
	const md = await htmlToMarkdown(html, BASE, 10_000);
	assert.match(md, /^# Title/m);
	assert.match(md, /^- One/m);
	assert.match(md, /^- Two/m);
	assert.match(md, /^> Quoted/m);
});

maybe("htmlToMarkdown handles nested blocks without clobbering text", async () => {
	const html = "<blockquote><p>Inner paragraph</p></blockquote>";
	const md = await htmlToMarkdown(html, BASE, 10_000);
	assert.match(md, /Inner paragraph/);
});

maybe("extractLinks resolves relative URLs and dedupes", async () => {
	const html =
		'<a href="/a">A</a><a href="a">rel</a><a href="https://other.com/x">ext</a>' +
		'<a href="/a">dup</a>';
	const links = await extractLinks(html, BASE, { maxLinks: 50 });
	assert.ok(links.includes("https://example.com/a"));
	assert.ok(links.includes("https://other.com/x"));
	// "/a" and the later duplicate collapse to a single normalized entry.
	assert.equal(links.filter((l) => l === "https://example.com/a").length, 1);
});

maybe("extractLinks sameOriginOnly filters foreign origins", async () => {
	const html = '<a href="/a">A</a><a href="https://other.com/x">ext</a>';
	const links = await extractLinks(html, BASE, { sameOriginOnly: true, maxLinks: 50 });
	assert.ok(links.every((l) => l.startsWith("https://example.com/")));
});

maybe("extractBySelectors returns per-selector matched text", async () => {
	const html = "<h1>Heading</h1><p class='a'>One</p><p class='a'>Two</p>";
	const out = await extractBySelectors(html, ["h1", ".a"]);
	assert.deepEqual(out["h1"], ["Heading"]);
	assert.deepEqual(out[".a"], ["One", "Two"]);
});

maybe("extractBySelectors handles nested matches of the same selector", async () => {
	const html = "<div>outer <div>inner</div></div>";
	const out = await extractBySelectors(html, ["div"]);
	// Inner closes first; outer includes the inner text.
	assert.ok(out["div"].some((v) => v === "inner"));
	assert.ok(out["div"].some((v) => /outer/.test(v) && /inner/.test(v)));
});
