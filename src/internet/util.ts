/**
 * cf-control-mcp — Internet Intelligence shared utilities (v1.6.0)
 * ---------------------------------------------------------------------------
 * URL normalization, deduplication, domain filtering, and bounded-fetch
 * helpers reused across the search router, fetch layer, and research pipeline.
 */

import { InternetError, type ImageResult, type SearchProvider, type SearchResult } from "./types";

/** Conservative Internet Intelligence limits (see README "Limits" section). */
export const LIMITS = {
	SEARCH_MAX_RESULTS: 50,
	FETCH_DEFAULT_BYTES: 200_000,
	FETCH_MAX_BYTES: 1_000_000,
	RENDER_DEFAULT_TIMEOUT_MS: 30_000,
	RENDER_MAX_TIMEOUT_MS: 60_000,
	CRAWL_DEFAULT_PAGES: 10,
	CRAWL_MAX_PAGES: 50,
	CRAWL_MAX_DEPTH: 5,
	RESEARCH_MAX_SOURCES: 25,
	RESEARCH_MAX_TOTAL_BYTES: 4_000_000,
	RESEARCH_MAX_DURATION_MS: 90_000,
	LINKS_MAX: 500,
} as const;

/** Clamp a number into [min, max], falling back to `fallback` for non-finite input. */
export function clamp(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * Normalize a URL for comparison/deduplication:
 * - lowercase scheme + host
 * - drop default ports
 * - strip a trailing slash on non-root paths
 * - remove common tracking params (utm_*, fbclid, gclid, ref, ...)
 * - drop the fragment
 * Returns the original string if it cannot be parsed.
 */
export function normalizeUrl(raw: string): string {
	try {
		const u = new URL(raw);
		u.protocol = u.protocol.toLowerCase();
		u.hostname = u.hostname.toLowerCase();
		if (
			(u.protocol === "http:" && u.port === "80") ||
			(u.protocol === "https:" && u.port === "443")
		) {
			u.port = "";
		}
		const drop = /^(utm_|fbclid$|gclid$|mc_eid$|mc_cid$|ref$|ref_src$|igshid$|_hsenc$|_hsmi$)/i;
		const keep: [string, string][] = [];
		u.searchParams.forEach((v, k) => {
			if (!drop.test(k)) keep.push([k, v]);
		});
		keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		u.search = "";
		for (const [k, v] of keep) u.searchParams.append(k, v);
		u.hash = "";
		let out = u.toString();
		if (u.pathname !== "/" && out.endsWith("/")) out = out.slice(0, -1);
		return out;
	} catch {
		return raw;
	}
}

/** Deduplicate search results by normalized URL, keeping the highest-scored / first-seen. */
export function dedupeResults(results: SearchResult[]): { results: SearchResult[]; removed: number } {
	const byKey = new Map<string, SearchResult>();
	let removed = 0;
	for (const r of results) {
		const key = normalizeUrl(r.url);
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, r);
			continue;
		}
		removed += 1;
		// Prefer the entry with a defined score, or the richer snippet.
		const better =
			(r.score ?? -Infinity) > (existing.score ?? -Infinity) ||
			(r.snippet.length > existing.snippet.length && existing.score === undefined);
		if (better) byKey.set(key, r);
	}
	return { results: [...byKey.values()], removed };
}

/** Deduplicate a plain list of URLs by normalized form, preserving order. */
export function dedupeUrls(urls: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of urls) {
		const key = normalizeUrl(raw);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(raw);
	}
	return out;
}

/** Extract the registrable-ish hostname (lowercased) from a URL, or "" on failure. */
export function hostOf(raw: string): string {
	try {
		return new URL(raw).hostname.toLowerCase();
	} catch {
		return "";
	}
}

/** True when host matches `domain` exactly or as a subdomain. */
export function hostMatchesDomain(host: string, domain: string): boolean {
	const h = host.toLowerCase();
	const d = domain.toLowerCase().replace(/^\.+/, "");
	return h === d || h.endsWith("." + d);
}

/** Apply include/exclude domain filters to normalized results. */
export function applyDomainFilters<T extends { url: string }>(
	items: T[],
	includeDomains?: string[],
	excludeDomains?: string[],
): T[] {
	let out = items;
	if (includeDomains && includeDomains.length > 0) {
		out = out.filter((it) => {
			const host = hostOf(it.url);
			return includeDomains.some((d) => hostMatchesDomain(host, d));
		});
	}
	if (excludeDomains && excludeDomains.length > 0) {
		out = out.filter((it) => {
			const host = hostOf(it.url);
			return !excludeDomains.some((d) => hostMatchesDomain(host, d));
		});
	}
	return out;
}

/** Deduplicate image results by normalized image URL. */
export function dedupeImages(items: ImageResult[]): ImageResult[] {
	const seen = new Set<string>();
	const out: ImageResult[] = [];
	for (const it of items) {
		const key = normalizeUrl(it.imageUrl);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(it);
	}
	return out;
}

/**
 * fetch() with a bounded timeout implemented via AbortController. Translates
 * abort/network failures into structured InternetError codes.
 */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
	provider?: SearchProvider,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") {
			throw new InternetError("TIMEOUT", `Request to provider timed out after ${timeoutMs}ms`, provider);
		}
		const message = err instanceof Error ? err.message : String(err);
		throw new InternetError("NETWORK_ERROR", `Network error: ${message}`, provider);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Map an upstream HTTP status into a structured provider error. 429 becomes
 * RATE_LIMITED; 401/403 becomes PROVIDER_ERROR (never leak the key). The
 * `snippet` is a short, key-free excerpt of the provider body for diagnostics.
 */
export function providerHttpError(
	provider: SearchProvider,
	status: number,
	snippet: string,
): InternetError {
	const safe = snippet.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").slice(0, 300);
	if (status === 429) {
		return new InternetError("RATE_LIMITED", `${provider} rate-limited this request (HTTP 429)`, provider);
	}
	return new InternetError(
		"PROVIDER_ERROR",
		`${provider} API error (HTTP ${status})${safe ? `: ${safe}` : ""}`,
		provider,
	);
}
