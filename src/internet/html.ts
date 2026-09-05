/**
 * HTML processing helpers (v1.6.0)
 * ---------------------------------------------------------------------------
 * Lightweight, dependency-free HTML → text / markdown / links / structured
 * extraction built on the Workers-native HTMLRewriter. These are conservative
 * (no external DOM library, no model-generated structure): they read what the
 * markup actually contains rather than inventing data.
 *
 * This is the single shared HTML layer. web_markdown, web_extract, web_links,
 * web_snapshot, web_crawl, and web_deep_research all reuse these functions —
 * there is no second, ad-hoc HTML parser anywhere in the codebase.
 */

import { normalizeUrl } from "./util";

const encoder = new TextEncoder();

/** Byte length of a string as UTF-8 (the unit our maxBytes limits are measured in). */
function byteLength(s: string): number {
	return encoder.encode(s).length;
}

/**
 * Truncate a string so its UTF-8 encoding is at most `maxBytes`, without
 * splitting a multi-byte character. Appends a marker when truncation occurs.
 */
function truncateToBytes(s: string, maxBytes: number, marker = "\n\n… [truncated]"): string {
	if (byteLength(s) <= maxBytes) return s;
	const budget = Math.max(0, maxBytes - byteLength(marker));
	// Binary search the largest prefix (by JS chars) that fits the byte budget.
	let lo = 0;
	let hi = s.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (byteLength(s.slice(0, mid)) <= budget) lo = mid;
		else hi = mid - 1;
	}
	return s.slice(0, lo) + marker;
}

/** Collect plain text content while dropping script/style noise. */
class TextCollector {
	parts: string[] = [];
	private skip = 0;
	text(chunk: Text) {
		if (this.skip > 0) return;
		const t = chunk.text.replace(/\s+/g, " ");
		if (t.trim()) this.parts.push(t);
	}
	enterSkip() {
		this.skip += 1;
	}
	exitSkip() {
		if (this.skip > 0) this.skip -= 1;
	}
	toString(): string {
		return this.parts.join(" ").replace(/\s+/g, " ").trim();
	}
}

/** Extracts <title> text. */
class TitleCollector {
	title = "";
	private done = false;
	text(chunk: Text) {
		// Only the first <title> matters; ignore later ones (e.g. inline SVG <title>).
		if (this.done) return;
		this.title += chunk.text;
		if (chunk.lastInTextNode) this.done = true;
	}
}

/** Extract page title and readable text from HTML. */
export async function htmlToText(
	html: string,
	baseUrl: string,
	maxBytes?: number,
): Promise<{ title: string; text: string; truncated: boolean }> {
	const title = new TitleCollector();
	const body = new TextCollector();
	// enterSkip/exitSkip nest correctly for overlapping script/style/noscript.
	const skipHandler = {
		element(el: Element) {
			body.enterSkip();
			el.onEndTag(() => body.exitSkip());
		},
	};
	const response = new Response(html, { headers: { "Content-Type": "text/html" } });
	const rewritten = new HTMLRewriter()
		.on("title", { text: (c) => title.text(c) })
		.on("script", skipHandler)
		.on("style", skipHandler)
		.on("noscript", skipHandler)
		.on("*", { text: (c) => body.text(c) })
		.transform(response);
	await rewritten.text();
	let text = body.toString();
	let truncated = false;
	if (maxBytes !== undefined && byteLength(text) > maxBytes) {
		text = truncateToBytes(text, maxBytes, " …");
		truncated = true;
	}
	return { title: title.title.replace(/\s+/g, " ").trim(), text, truncated };
}

interface MdBlock {
	tag: string;
	text: string;
}

const MD_BLOCK_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "pre"] as const;

/**
 * Small, structure-preserving markdown converter (headings, paragraphs, list
 * items, blockquotes, preformatted). A stack of open blocks keeps nested block
 * elements (e.g. a <p> inside a <blockquote>, or a <pre> inside an <li>) from
 * clobbering one another — text is attributed to the innermost open block.
 */
export async function htmlToMarkdown(html: string, baseUrl: string, maxBytes: number): Promise<string> {
	const blocks: MdBlock[] = [];
	const stack: MdBlock[] = [];
	let skip = 0;
	const skipHandler = {
		element(el: Element) {
			skip += 1;
			el.onEndTag(() => {
				if (skip > 0) skip -= 1;
			});
		},
	};
	const blockHandler = (tag: string) => ({
		element(el: Element) {
			const block: MdBlock = { tag, text: "" };
			blocks.push(block);
			stack.push(block);
			el.onEndTag(() => {
				// Pop this block (LIFO — HTMLRewriter fires end tags in nesting order).
				const idx = stack.lastIndexOf(block);
				if (idx !== -1) stack.splice(idx, 1);
			});
		},
		text(chunk: Text) {
			if (skip === 0 && stack.length > 0) stack[stack.length - 1].text += chunk.text;
		},
	});

	const response = new Response(html, { headers: { "Content-Type": "text/html" } });
	let rewriter = new HTMLRewriter()
		.on("script", skipHandler)
		.on("style", skipHandler)
		.on("noscript", skipHandler);
	for (const tag of MD_BLOCK_TAGS) {
		rewriter = rewriter.on(tag, blockHandler(tag));
	}
	await rewriter.transform(response).text();

	const md: string[] = [];
	let lastLine = "";
	for (const b of blocks) {
		const text = b.text.replace(/\s+/g, " ").trim();
		if (!text) continue;
		let line: string;
		switch (b.tag) {
			case "h1": line = `# ${text}`; break;
			case "h2": line = `## ${text}`; break;
			case "h3": line = `### ${text}`; break;
			case "h4": line = `#### ${text}`; break;
			case "h5": line = `##### ${text}`; break;
			case "h6": line = `###### ${text}`; break;
			case "li": line = `- ${text}`; break;
			case "blockquote": line = `> ${text}`; break;
			case "pre": line = "```\n" + text + "\n```"; break;
			default: line = text;
		}
		// Skip a block whose rendered line is identical to the one just emitted
		// (nested blocks can surface the same text twice).
		if (line === lastLine) continue;
		md.push(line);
		lastLine = line;
	}
	return truncateToBytes(md.join("\n\n"), maxBytes);
}

/** Collects href/src links, resolving them against the base URL. */
class LinkCollector {
	links: string[] = [];
	constructor(private readonly baseUrl: string) {}
	element(el: Element) {
		const href = el.getAttribute("href") ?? el.getAttribute("src");
		if (!href) return;
		try {
			const abs = new URL(href, this.baseUrl).toString();
			if (abs.startsWith("http://") || abs.startsWith("https://")) this.links.push(abs);
		} catch {
			/* ignore unparseable */
		}
	}
}

/** Extract outbound links from HTML, resolved absolute + deduped by normalized URL. */
export async function extractLinks(
	html: string,
	baseUrl: string,
	opts: { sameOriginOnly?: boolean; maxLinks: number },
): Promise<string[]> {
	const collector = new LinkCollector(baseUrl);
	const response = new Response(html, { headers: { "Content-Type": "text/html" } });
	await new HTMLRewriter().on("a", collector).on("area", collector).transform(response).text();

	let links = collector.links;
	if (opts.sameOriginOnly) {
		try {
			const origin = new URL(baseUrl).origin;
			links = links.filter((l) => {
				try {
					return new URL(l).origin === origin;
				} catch {
					return false;
				}
			});
		} catch {
			/* ignore */
		}
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const l of links) {
		const key = normalizeUrl(l);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(l);
		if (out.length >= opts.maxLinks) break;
	}
	return out;
}

/**
 * Collects text content for a single CSS selector. A stack of open frames
 * handles nested elements that match the same selector (e.g. a `div` inside a
 * matched `div`): each matched element yields its own value, and an outer
 * match still includes the text of its descendants.
 */
class SelectorCollector {
	values: string[] = [];
	private stack: { text: string }[] = [];
	element(el: Element) {
		const frame = { text: "" };
		this.stack.push(frame);
		el.onEndTag(() => {
			const idx = this.stack.lastIndexOf(frame);
			if (idx !== -1) this.stack.splice(idx, 1);
			this.values.push(frame.text.replace(/\s+/g, " ").trim());
		});
	}
	text(chunk: Text) {
		// Append to every open frame so ancestors include descendant text.
		for (const frame of this.stack) frame.text += chunk.text;
	}
}

/**
 * Selector-driven extraction. For each selector, returns the matched text
 * content (up to a cap). This is a conservative, non-hallucinated extractor:
 * it returns exactly what the DOM contained for those selectors. Each selector
 * gets its own collector, so overlapping selectors do not interfere.
 */
export async function extractBySelectors(
	html: string,
	selectors: string[],
): Promise<Record<string, string[]>> {
	const collectors = selectors.map((sel) => ({ sel, collector: new SelectorCollector() }));
	const response = new Response(html, { headers: { "Content-Type": "text/html" } });
	let rewriter = new HTMLRewriter();
	for (const { sel, collector } of collectors) {
		rewriter = rewriter.on(sel, collector);
	}
	await rewriter.transform(response).text();
	const out: Record<string, string[]> = {};
	for (const { sel, collector } of collectors) {
		out[sel] = collector.values.filter(Boolean).slice(0, 100);
	}
	return out;
}
