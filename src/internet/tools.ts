/**
 * Internet Intelligence MCP tool definitions (v1.6.0)
 * ---------------------------------------------------------------------------
 * Wires the search router, hardened fetch, browser rendering, crawl/snapshot,
 * and research pipeline into MCP ToolDefs. Kept out of index.ts so that file
 * does not grow into a monolith. index.ts imports `internetTools` and spreads
 * it into the master catalog.
 *
 * Error handling: handlers throw InternetError (or any Error). index.ts'
 * tools/call wrapper converts thrown errors into an MCP `isError:true`
 * response, so a JSON-RPC request always succeeds while the tool reports a
 * useful, key-free message. We prefix messages with the structured code.
 */

import { hardenedFetch } from "./fetch";
import { extractBySelectors, extractLinks, htmlToMarkdown } from "./html";
import { renderContent, renderLinks, renderMarkdown, renderScrape, type BrowserEnv } from "./browser";
import { crawl, snapshot } from "./crawl";
import { deepResearch } from "./research";
import { SearchRouter, type RouterEnv } from "./search-router";
import { fetchText } from "./fetch";
import { InternetError, type ProviderSelector, type SearchProvider } from "./types";
import { clamp, dedupeUrls, LIMITS } from "./util";

/** Env shape the internet tools rely on (subset of the Worker Env). */
export interface InternetEnv extends RouterEnv, BrowserEnv {}

/** ToolDef shape mirrored from index.ts (kept structurally compatible). */
export interface InternetToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: {
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
	handler: (args: Record<string, unknown>, env: InternetEnv) => Promise<unknown>;
}

/** Normalize an unknown value to a string array. */
function toStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value.map((v) => String(v)).filter(Boolean);
	return out.length ? out : undefined;
}

/** Wrap a handler so thrown InternetError messages carry their structured code. */
function guard<T>(fn: () => Promise<T>): Promise<T> {
	return fn().catch((err) => {
		if (err instanceof InternetError) {
			throw new Error(`[${err.code}] ${err.message}`);
		}
		throw err;
	});
}

const PROVIDER_ENUM = ["auto", "brave", "tavily", "exa", "ddg"];

export const internetTools: InternetToolDef[] = [
	{
		name: "web_search",
		description:
			"Unified general-purpose internet search across configured providers (Brave, Tavily, Exa) with a " +
			"keyless DuckDuckGo fallback. provider='auto' picks the best available provider (Brave for general web, " +
			"Tavily for recent/news/research, Exa for semantic retrieval) and falls back to the next configured " +
			"provider only on genuine failure. Returns normalized {title,url,snippet,provider,published_at?,score?}. " +
			"Use web_fetch afterward to read the full content of any returned url.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
				provider: { type: "string", enum: PROVIDER_ENUM, description: "auto | brave | tavily | exa | ddg. Default auto." },
				max_results: { type: "number", description: "Max results (default 10, max 50)" },
				freshness: { type: "string", description: "Provider freshness token (e.g. Brave 'pw'/'pd', or a day count)" },
				include_domains: { type: "array", items: { type: "string" }, description: "Only return results from these domains" },
				exclude_domains: { type: "array", items: { type: "string" }, description: "Never return results from these domains" },
			},
			required: ["query"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const router = new SearchRouter(env);
				const selector = (String(args.provider ?? "auto") as ProviderSelector);
				const res = await router.search(String(args.query ?? ""), selector, {
					maxResults: clamp(args.max_results, 1, LIMITS.SEARCH_MAX_RESULTS, 10),
					freshness: args.freshness ? String(args.freshness) : undefined,
					includeDomains: toStringArray(args.include_domains),
					excludeDomains: toStringArray(args.exclude_domains),
				});
				return {
					query: res.query,
					provider: res.provider,
					fallback_from: res.fallbackFrom,
					count: res.count,
					results: res.results.map((r) => ({
						title: r.title,
						url: r.url,
						snippet: r.snippet,
						provider: r.provider,
						published_at: r.publishedAt,
						score: r.score,
					})),
				};
			}),
	},
	{
		name: "web_search_multi",
		description:
			"Search several configured providers concurrently and merge the results. Deduplicates by normalized URL, " +
			"keeps provenance, and returns per-provider errors separately instead of failing the whole request. " +
			"Response: {query, providers_attempted, providers_succeeded, providers_failed, count, deduplicated, results}.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
				providers: { type: "array", items: { type: "string", enum: ["brave", "tavily", "exa", "ddg"] }, description: "Subset of providers to query. Default: all configured." },
				max_results: { type: "number", description: "Max merged results (default 20, max 50)" },
				per_provider: { type: "number", description: "Max results requested from each provider (default 10)" },
			},
			required: ["query"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const router = new SearchRouter(env);
				const providers = toStringArray(args.providers) as SearchProvider[] | undefined;
				const res = await router.searchMulti(String(args.query ?? ""), providers, {
					maxResults: clamp(args.max_results, 1, LIMITS.SEARCH_MAX_RESULTS, 20),
					perProvider: clamp(args.per_provider, 1, LIMITS.SEARCH_MAX_RESULTS, 10),
				});
				return {
					query: res.query,
					providers_attempted: res.providersAttempted,
					providers_succeeded: res.providersSucceeded,
					providers_failed: res.providersFailed,
					count: res.count,
					deduplicated: res.deduplicated,
					results: res.results.map((r) => ({
						title: r.title,
						url: r.url,
						snippet: r.snippet,
						provider: r.provider,
						published_at: r.publishedAt,
						score: r.score,
					})),
				};
			}),
	},
	{
		name: "web_news_search",
		description:
			"Current/recent news retrieval using the best configured news provider (Tavily preferred, then Brave, " +
			"then Exa, then DDG). Every result keeps provider provenance and publication timestamp when available.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "News query" },
				max_results: { type: "number", description: "Max results (default 10, max 50)" },
				freshness: { type: "string", description: "Time range hint (provider token or day count)" },
				include_domains: { type: "array", items: { type: "string" } },
				exclude_domains: { type: "array", items: { type: "string" } },
			},
			required: ["query"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const router = new SearchRouter(env);
				const res = await router.search(String(args.query ?? ""), "auto", {
					news: true,
					maxResults: clamp(args.max_results, 1, LIMITS.SEARCH_MAX_RESULTS, 10),
					freshness: args.freshness ? String(args.freshness) : undefined,
					includeDomains: toStringArray(args.include_domains),
					excludeDomains: toStringArray(args.exclude_domains),
				});
				return {
					query: res.query,
					provider: res.provider,
					fallback_from: res.fallbackFrom,
					count: res.count,
					results: res.results.map((r) => ({
						title: r.title,
						url: r.url,
						snippet: r.snippet,
						provider: r.provider,
						published_at: r.publishedAt,
						score: r.score,
					})),
				};
			}),
	},
	{
		name: "web_image_search",
		description:
			"Search images when a configured provider supports it (Brave). Returns metadata only " +
			"({title,source_url,image_url,width?,height?,provider}); it does not download image bytes. " +
			"Returns a clear CONFIGURATION_ERROR if no image-capable provider is configured.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Image search query" },
				max_results: { type: "number", description: "Max results (default 10, max 50)" },
			},
			required: ["query"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const router = new SearchRouter(env);
				const res = await router.searchImages(String(args.query ?? ""), {
					maxResults: clamp(args.max_results, 1, LIMITS.SEARCH_MAX_RESULTS, 10),
				});
				return {
					provider: res.provider,
					count: res.results.length,
					results: res.results.map((r) => ({
						title: r.title,
						source_url: r.sourceUrl,
						image_url: r.imageUrl,
						width: r.width,
						height: r.height,
						provider: r.provider,
					})),
				};
			}),
	},
	{
		name: "web_fetch",
		description:
			"Fetch a public URL through this Worker's outbound network and return status, headers, and a bounded body. " +
			"HTTP/HTTPS only; supports GET/HEAD/POST/PUT/PATCH/DELETE, optional headers/body, size cap (default 200KB, " +
			"max 1MB), timeout, and redirect limit. Hardened against SSRF: rejects localhost, loopback, RFC1918 private " +
			"ranges, link-local, IPv6 loopback/ULA/link-local, *.internal, and cloud metadata endpoints — and re-validates " +
			"EVERY redirect hop so a public URL cannot redirect into a blocked private target.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute http(s) URL" },
				method: { type: "string", description: "GET|HEAD|POST|PUT|PATCH|DELETE. Default GET." },
				headers: { type: "object", description: "Optional request headers as key/value pairs" },
				body: { type: "string", description: "Optional raw request body (ignored for GET/HEAD)" },
				max_bytes: { type: "number", description: "Max response bytes (default 200000, max 1000000)" },
				timeout_ms: { type: "number", description: "Request timeout in ms (default 30000, max 60000)" },
				max_redirects: { type: "number", description: "Max redirects to follow (default 5, max 10)" },
			},
			required: ["url"],
		},
		// Can issue POST/PUT/PATCH/DELETE, so it is not truthfully read-only.
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				return hardenedFetch({
					url: String(args.url ?? ""),
					method: args.method ? String(args.method) : undefined,
					headers: (args.headers && typeof args.headers === "object") ? (args.headers as Record<string, unknown>) : undefined,
					body: args.body !== undefined ? String(args.body) : undefined,
					maxBytes: args.max_bytes !== undefined ? Number(args.max_bytes) : undefined,
					timeoutMs: args.timeout_ms !== undefined ? Number(args.timeout_ms) : undefined,
					maxRedirects: args.max_redirects !== undefined ? Number(args.max_redirects) : undefined,
				});
			}),
	},
	{
		name: "web_render",
		description:
			"Render a JavaScript-heavy PUBLIC website using Cloudflare Browser Rendering and return the post-JS HTML " +
			"content plus metadata. Use this only when a plain web_fetch would miss client-rendered content. Not an " +
			"internal-network browser: every target is SSRF-validated. Requires the CLOUDFLARE_API_TOKEN to carry the " +
			"Browser Rendering permission.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute public http(s) URL" },
				wait_until: { type: "string", description: "Navigation wait condition: load|domcontentloaded|networkidle0|networkidle2" },
				timeout_ms: { type: "number", description: "Render timeout in ms (default 30000, max 60000)" },
			},
			required: ["url"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const { url, html } = await renderContent(env, String(args.url ?? ""), {
					waitUntil: args.wait_until ? String(args.wait_until) : undefined,
					timeoutMs: args.timeout_ms !== undefined ? Number(args.timeout_ms) : undefined,
				});
				const truncated = html.length > LIMITS.FETCH_MAX_BYTES;
				return { url, rendered: true, truncated, bytes: html.length, html: truncated ? html.slice(0, LIMITS.FETCH_MAX_BYTES) : html };
			}),
	},
	{
		name: "web_markdown",
		description:
			"Fetch/render a public page and return clean Markdown suitable for an LLM. Uses Cloudflare Browser " +
			"Rendering's markdown endpoint when available and falls back to a conservative HTML→Markdown conversion of " +
			"a plain fetch. Good for reading articles/docs without HTML noise.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute public http(s) URL" },
				max_bytes: { type: "number", description: "Max markdown bytes to return (default 200000, max 1000000)" },
			},
			required: ["url"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const url = String(args.url ?? "");
				const maxBytes = clamp(args.max_bytes, 1_000, LIMITS.FETCH_MAX_BYTES, LIMITS.FETCH_DEFAULT_BYTES);
				try {
					const { markdown } = await renderMarkdown(env, url, {});
					const md = markdown.length > maxBytes ? markdown.slice(0, maxBytes) + "\n\n… [truncated]" : markdown;
					return { url, source: "browser-rendering", markdown: md };
				} catch (err) {
					// Fall back to plain fetch + local conversion if rendering is unavailable.
					const { finalUrl, text, contentType } = await fetchText(url, LIMITS.FETCH_MAX_BYTES);
					if (!(contentType ?? "").includes("html")) {
						return { url, final_url: finalUrl, source: "fetch", markdown: text.slice(0, maxBytes) };
					}
					const md = await htmlToMarkdown(text, finalUrl, maxBytes);
					const reason = err instanceof InternetError ? err.code : "RENDER_ERROR";
					return { url, final_url: finalUrl, source: "fetch-fallback", fallback_reason: reason, markdown: md };
				}
			}),
	},
	{
		name: "web_extract",
		description:
			"Extract structured content from a public web page. Provide CSS `selectors` to pull specific elements' text; " +
			"the response maps each selector to the matched text values. Uses Cloudflare Browser Rendering's scrape " +
			"endpoint when available for JS pages, otherwise a conservative selector-based extraction over a plain fetch. " +
			"Returns exactly what the DOM contained — it does not fabricate model-generated fields.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute public http(s) URL" },
				selectors: { type: "array", items: { type: "string" }, description: "CSS selectors to extract (e.g. 'h1', '.price', 'article p')" },
				render: { type: "boolean", description: "Force browser rendering for JS-heavy pages. Default: auto-fallback." },
			},
			required: ["url"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const url = String(args.url ?? "");
				const selectors = toStringArray(args.selectors) ?? ["h1", "h2", "p"];
				if (args.render === true) {
					const scraped = await renderScrape(env, url, selectors, {});
					return { url, source: "browser-rendering", selectors, results: scraped };
				}
				try {
					const { finalUrl, text, contentType } = await fetchText(url, LIMITS.FETCH_MAX_BYTES);
					if (!(contentType ?? "").includes("html")) {
						throw new InternetError("INVALID_ARGUMENT", "Target is not an HTML document; cannot run selector extraction");
					}
					const extracted = await extractBySelectors(text, selectors);
					return { url, final_url: finalUrl, source: "fetch", selectors, results: extracted };
				} catch (err) {
					if (err instanceof InternetError && err.code === "INVALID_ARGUMENT") throw err;
					// If plain fetch failed and rendering may help, try the renderer.
					const scraped = await renderScrape(env, url, selectors, {});
					return { url, source: "browser-rendering-fallback", selectors, results: scraped };
				}
			}),
	},
	{
		name: "web_links",
		description:
			"Return outbound/internal links from a public page. Links are resolved to absolute URLs, normalized, and " +
			"deduplicated. Set same_origin_only=true to keep only links on the same origin as the page.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute public http(s) URL" },
				same_origin_only: { type: "boolean", description: "Keep only same-origin links. Default false." },
				max_links: { type: "number", description: "Max links to return (default 200, max 500)" },
			},
			required: ["url"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const url = String(args.url ?? "");
				const maxLinks = clamp(args.max_links, 1, LIMITS.LINKS_MAX, 200);
				const { finalUrl, text, contentType } = await fetchText(url, LIMITS.FETCH_MAX_BYTES);
				let links: string[];
				if ((contentType ?? "").includes("html")) {
					links = await extractLinks(text, finalUrl, { sameOriginOnly: args.same_origin_only === true, maxLinks });
				} else {
					// Non-HTML: try browser rendering for link discovery.
					links = dedupeUrls(await renderLinks(env, url, {})).slice(0, maxLinks);
				}
				return { url, final_url: finalUrl, same_origin_only: args.same_origin_only === true, count: links.length, links };
			}),
	},
	{
		name: "web_snapshot",
		description:
			"Return an inspection snapshot of a public page: final_url, status, title, clean markdown, plain text, and " +
			"(optionally) links. Payload sizes are bounded. Good for quickly understanding one page before deciding to " +
			"fetch, render, or crawl further.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute public http(s) URL" },
				max_bytes: { type: "number", description: "Max source bytes to process (default 200000, max 1000000)" },
				include_links: { type: "boolean", description: "Include outbound links in the snapshot. Default false." },
			},
			required: ["url"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args) =>
			guard(async () => {
				const snap = await snapshot({
					url: String(args.url ?? ""),
					maxBytes: args.max_bytes !== undefined ? Number(args.max_bytes) : undefined,
					includeLinks: args.include_links === true,
				});
				return {
					url: snap.url,
					final_url: snap.finalUrl,
					status: snap.status,
					title: snap.title,
					markdown: snap.markdown,
					text: snap.text,
					links: snap.links,
					truncated: snap.truncated,
					// Static (no-JS) fetch — never mislabeled as a browser-rendered snapshot.
					source: snap.source,
				};
			}),
	},
	{
		name: "web_crawl",
		description:
			"Controlled, strictly-bounded multi-page crawl starting from a URL. Enforces hard page/depth limits " +
			"(default 10 pages, max 50; default depth 2, max 5), deduplicates URLs, respects per-page size limits, " +
			"stays same-origin by default, supports include/exclude regex patterns, and returns per-page status. " +
			"Polite by default: respects robots.txt (identity cf-control-mcp/1.6) and honors a bounded Crawl-delay; " +
			"pages disallowed by robots are reported with skippedReason='ROBOTS_DENIED' (not a network failure). " +
			"This is deliberately NOT an unbounded crawler.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute public http(s) start URL" },
				max_pages: { type: "number", description: "Max pages to crawl (default 10, hard max 50)" },
				max_depth: { type: "number", description: "Max link depth from the start (default 2, max 5)" },
				same_origin_only: { type: "boolean", description: "Restrict to the start origin. Default true." },
				include_patterns: { type: "array", items: { type: "string" }, description: "Only crawl URLs matching any of these regexes" },
				exclude_patterns: { type: "array", items: { type: "string" }, description: "Skip URLs matching any of these regexes" },
				respect_robots: { type: "boolean", description: "Respect robots.txt for each page. Default true." },
			},
			required: ["url"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args) =>
			guard(async () => {
				return crawl({
					url: String(args.url ?? ""),
					maxPages: args.max_pages !== undefined ? Number(args.max_pages) : undefined,
					maxDepth: args.max_depth !== undefined ? Number(args.max_depth) : undefined,
					sameOriginOnly: args.same_origin_only === undefined ? undefined : args.same_origin_only === true,
					includePatterns: toStringArray(args.include_patterns),
					excludePatterns: toStringArray(args.exclude_patterns),
					respect_robots: args.respect_robots === undefined ? undefined : args.respect_robots === true,
				});
			}),
	},
	{
		name: "web_deep_research",
		description:
			"High-level research pipeline: query expansion → multi-provider search → URL normalize/dedupe → ranking → " +
			"bounded fetch → content extraction → structured evidence aggregation. Returns {query, sources[], " +
			"provider_errors[], stats}. It collects and structures EVIDENCE — it does NOT invent conclusions or a " +
			"synthesized narrative; that is left to the calling model. Bounded by source count, total bytes, and duration.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Research question or topic" },
				depth: { type: "string", enum: ["quick", "standard", "deep"], description: "quick|standard|deep. Default standard." },
				max_sources: { type: "number", description: "Max sources to aggregate (bounded per depth, hard max 25)" },
				freshness: { type: "string", description: "Recency hint (provider token or day count)" },
				include_domains: { type: "array", items: { type: "string" } },
				exclude_domains: { type: "array", items: { type: "string" } },
				respect_robots: { type: "boolean", description: "Respect robots.txt when fetching source pages. Default true." },
			},
			required: ["query"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: (args, env) =>
			guard(async () => {
				const router = new SearchRouter(env);
				const res = await deepResearch(router, {
					query: String(args.query ?? ""),
					depth: args.depth as any,
					maxSources: args.max_sources !== undefined ? Number(args.max_sources) : undefined,
					freshness: args.freshness ? String(args.freshness) : undefined,
					includeDomains: toStringArray(args.include_domains),
					excludeDomains: toStringArray(args.exclude_domains),
					respect_robots: args.respect_robots === undefined ? undefined : args.respect_robots === true,
				});
				return {
					query: res.query,
					depth: res.depth,
					expanded_queries: res.expandedQueries,
					sources: res.sources.map((s) => ({
						title: s.title,
						url: s.url,
						provider: s.provider,
						published_at: s.publishedAt,
						score: s.score,
						extracted_text: s.extractedText,
						evidence: s.evidence,
						fetch_error: s.fetchError,
						skipped_reason: s.skippedReason,
					})),
					provider_errors: res.providerErrors,
					stats: res.stats,
				};
			}),
	},
];
