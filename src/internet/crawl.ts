/**
 * Bounded Crawl + Snapshot layer (v1.6.0)
 * ---------------------------------------------------------------------------
 * Controlled, strictly-bounded multi-page crawling built on the hardened fetch
 * layer + the shared HTML link extraction. Hard caps on pages, depth, and
 * per-page bytes. Every URL is SSRF-validated by the fetch layer, deduped, and
 * pattern-filtered. Crawling is polite by default: it respects robots.txt
 * (retrieved once per origin, cached) and honors bounded Crawl-delay. Stops
 * cleanly on errors, returning per-page status rather than throwing.
 */

import { fetchText } from "./fetch";
import { extractLinks, htmlToMarkdown, htmlToText } from "./html";
import {
	getRobotsPolicy,
	isAllowedByRobots,
	MAX_ROBOTS_CRAWL_DELAY_SECONDS,
	ROBOTS_USER_AGENT,
} from "./robots";
import { assertSafeUrl } from "./ssrf";
import { InternetError } from "./types";
import { clamp, hostOf, LIMITS, normalizeUrl } from "./util";

export interface CrawlArgs {
	url: string;
	maxPages?: number;
	maxDepth?: number;
	sameOriginOnly?: boolean;
	includePatterns?: string[];
	excludePatterns?: string[];
	/** Respect robots.txt for every fetched page. Default: true. */
	respect_robots?: boolean;
}

export interface CrawlPage {
	url: string;
	depth: number;
	status: number | null;
	title?: string;
	bytes?: number;
	links?: number;
	error?: string;
	/** robots.txt decision for this URL (undefined when robots checking is disabled). */
	robotsAllowed?: boolean;
	/** The robots.txt rule path that decided a disallow, when applicable. */
	matchedRule?: string;
	/** Why this page was not fetched (e.g. ROBOTS_DENIED). */
	skippedReason?: string;
	/** Bounded crawl-delay (seconds) declared for this origin, if any. */
	crawlDelaySec?: number;
}

export interface CrawlResult {
	startUrl: string;
	pagesCrawled: number;
	sameOriginOnly: boolean;
	respectRobots: boolean;
	pages: CrawlPage[];
	stats: { fetched: number; failed: number; skipped: number; robotsDenied: number };
}

function compilePatterns(patterns?: string[]): RegExp[] {
	if (!patterns) return [];
	const out: RegExp[] = [];
	for (const p of patterns) {
		try {
			out.push(new RegExp(p, "i"));
		} catch {
			/* ignore invalid pattern */
		}
	}
	return out;
}

function matchesAny(url: string, patterns: RegExp[]): boolean {
	return patterns.some((re) => re.test(url));
}

/** Bounded breadth-first crawl. */
export async function crawl(args: CrawlArgs): Promise<CrawlResult> {
	const start = String(args.url ?? "").trim();
	if (!start) throw new InternetError("INVALID_ARGUMENT", "url is required");
	assertSafeUrl(start); // fail fast on blocked/invalid start

	const maxPages = clamp(args.maxPages, 1, LIMITS.CRAWL_MAX_PAGES, LIMITS.CRAWL_DEFAULT_PAGES);
	const maxDepth = clamp(args.maxDepth, 0, LIMITS.CRAWL_MAX_DEPTH, 2);
	const sameOriginOnly = args.sameOriginOnly !== false; // default true for safety
	const respectRobots = args.respect_robots !== false; // default true (polite)
	const includePatterns = compilePatterns(args.includePatterns);
	const excludePatterns = compilePatterns(args.excludePatterns);
	const startOrigin = (() => {
		try {
			return new URL(start).origin;
		} catch {
			return "";
		}
	})();

	// Origins we have decided to stop crawling because their declared Crawl-delay
	// exceeds MAX_ROBOTS_CRAWL_DELAY_SECONDS (keeps execution bounded).
	const blockedOrigins = new Set<string>();

	const visited = new Set<string>();
	const pages: CrawlPage[] = [];
	let fetched = 0;
	let failed = 0;
	let skipped = 0;
	let robotsDenied = 0;

	const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
	visited.add(normalizeUrl(start));

	// Warm the robots policy for the start origin once (cached thereafter).
	if (respectRobots && startOrigin) {
		try {
			await getRobotsPolicy(start);
		} catch {
			/* getRobotsPolicy never throws in practice; ignore defensively */
		}
	}

	while (queue.length > 0 && pages.length < maxPages) {
		const { url, depth } = queue.shift()!;

		// robots.txt gate (per-origin policy is cached inside the robots layer).
		if (respectRobots) {
			const origin = (() => {
				try {
					return new URL(url).origin;
				} catch {
					return "";
				}
			})();
			if (origin && blockedOrigins.has(origin)) {
				pages.push({ url, depth, status: null, robotsAllowed: false, skippedReason: "ROBOTS_CRAWL_DELAY_EXCEEDED" });
				skipped += 1;
				continue;
			}
			try {
				const decision = await isAllowedByRobots(url, ROBOTS_USER_AGENT);
				if (decision.crawlDelayExceeded && origin) {
					blockedOrigins.add(origin);
					pages.push({
						url,
						depth,
						status: null,
						robotsAllowed: false,
						skippedReason: "ROBOTS_CRAWL_DELAY_EXCEEDED",
						crawlDelaySec: decision.crawlDelaySec,
					});
					skipped += 1;
					continue;
				}
				if (!decision.allowed) {
					pages.push({
						url,
						depth,
						status: null,
						robotsAllowed: false,
						matchedRule: decision.matchedRule,
						skippedReason: "ROBOTS_DENIED",
						crawlDelaySec: decision.crawlDelaySec,
					});
					robotsDenied += 1;
					skipped += 1;
					continue;
				}
				// Honor a bounded crawl-delay between requests.
				if (decision.crawlDelaySec && decision.crawlDelaySec > 0) {
					await sleep(Math.min(decision.crawlDelaySec, MAX_ROBOTS_CRAWL_DELAY_SECONDS) * 1000);
				}
			} catch {
				// Robots evaluation failed unexpectedly → do not block the crawl.
			}
		}

		try {
			assertSafeUrl(url);
			const { finalUrl, status, contentType, text, truncated } = await fetchText(url, LIMITS.FETCH_DEFAULT_BYTES);
			const isHtml = (contentType ?? "").includes("html");
			const page: CrawlPage = {
				url,
				depth,
				status,
				bytes: text.length,
			};
			if (respectRobots) page.robotsAllowed = true;

			if (isHtml) {
				const { title } = await htmlToText(text, finalUrl);
				page.title = title;
				if (depth < maxDepth) {
					const links = await extractLinks(text, finalUrl, { sameOriginOnly, maxLinks: 100 });
					page.links = links.length;
					for (const link of links) {
						if (pages.length + queue.length >= maxPages * 3) break;
						const key = normalizeUrl(link);
						if (visited.has(key)) continue;
						if (sameOriginOnly && startOrigin && hostOf(link) !== hostOf(start)) continue;
						if (includePatterns.length && !matchesAny(link, includePatterns)) {
							skipped += 1;
							continue;
						}
						if (excludePatterns.length && matchesAny(link, excludePatterns)) {
							skipped += 1;
							continue;
						}
						visited.add(key);
						queue.push({ url: link, depth: depth + 1 });
					}
				}
			}
			pages.push(page);
			fetched += 1;
		} catch (err) {
			const message = err instanceof InternetError ? err.message : err instanceof Error ? err.message : String(err);
			pages.push({ url, depth, status: null, error: message });
			failed += 1;
			// Continue past isolated failures; the bounded queue still terminates.
		}
	}

	return {
		startUrl: start,
		pagesCrawled: pages.length,
		sameOriginOnly,
		respectRobots,
		pages,
		stats: { fetched, failed, skipped, robotsDenied },
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SnapshotArgs {
	url: string;
	maxBytes?: number;
	includeLinks?: boolean;
}

export interface SnapshotResult {
	url: string;
	finalUrl: string;
	status: number;
	title?: string;
	markdown?: string;
	text?: string;
	links?: string[];
	truncated: boolean;
	/** How this snapshot was produced. web_snapshot here is always a static (no-JS) fetch. */
	source: "static-fetch";
}

/** Inspection snapshot of a single public page (plain fetch; no JS rendering). */
export async function snapshot(args: SnapshotArgs): Promise<SnapshotResult> {
	const url = String(args.url ?? "").trim();
	if (!url) throw new InternetError("INVALID_ARGUMENT", "url is required");
	const maxBytes = clamp(args.maxBytes, 1_000, LIMITS.FETCH_MAX_BYTES, LIMITS.FETCH_DEFAULT_BYTES);

	const { finalUrl, status, contentType, text, truncated } = await fetchText(url, maxBytes);
	const isHtml = (contentType ?? "").includes("html");
	if (!isHtml) {
		return { url, finalUrl, status, text: text.slice(0, 20_000), truncated, source: "static-fetch" };
	}
	const { title, text: plain } = await htmlToText(text, finalUrl);
	const markdown = await htmlToMarkdown(text, finalUrl, 20_000);
	const result: SnapshotResult = {
		url,
		finalUrl,
		status,
		title,
		markdown,
		text: plain.slice(0, 20_000),
		truncated,
		source: "static-fetch",
	};
	if (args.includeLinks) {
		result.links = await extractLinks(text, finalUrl, { sameOriginOnly: false, maxLinks: 100 });
	}
	return result;
}
