/**
 * DuckDuckGo HTML adapter (v1.6.0)
 * ---------------------------------------------------------------------------
 * Keyless fallback provider that scrapes DuckDuckGo's server-rendered HTML
 * results page. Always "configured" (no secret required), so the MCP server
 * can still perform a general web_search when zero paid provider secrets are
 * present. Inherently best-effort: DDG may rate-limit the Worker IP or change
 * its markup. Preserves the v1.5 behavior, normalized into SearchResult.
 */

import {
	InternetError,
	type SearchOptions,
	type SearchProviderAdapter,
	type SearchResult,
} from "../types";
import { clamp, fetchWithTimeout } from "../util";

const HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

class TitleCollector {
	results: { title: string; href: string }[] = [];
	private current: { title: string; href: string } | null = null;
	element(el: Element) {
		this.current = { title: "", href: el.getAttribute("href") ?? "" };
		this.results.push(this.current);
	}
	text(chunk: Text) {
		if (this.current) this.current.title += chunk.text;
	}
}

class SnippetCollector {
	snippets: string[] = [];
	private current = "";
	element(_el: Element) {
		this.current = "";
	}
	text(chunk: Text) {
		this.current += chunk.text;
		if (chunk.lastInTextNode) this.snippets.push(this.current.trim());
	}
}

/** DDG links are wrapped in `/l/?uddg=<encoded-real-url>`; unwrap them. */
function decodeRedirect(href: string): string {
	try {
		const parsed = new URL(href, "https://duckduckgo.com");
		return parsed.searchParams.get("uddg") || href;
	} catch {
		return href;
	}
}

export class DdgProvider implements SearchProviderAdapter {
	readonly id = "ddg" as const;

	isConfigured(): boolean {
		return true;
	}

	async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
		const maxResults = clamp(options.maxResults, 1, 25, 10);
		const res = await fetchWithTimeout(
			`${HTML_ENDPOINT}?q=${encodeURIComponent(query)}`,
			{ headers: { "User-Agent": UA } },
			15_000,
			this.id,
		);
		if (!res.ok) {
			throw new InternetError(
				"PROVIDER_ERROR",
				`DuckDuckGo HTML search failed (HTTP ${res.status}); it may be rate-limiting this Worker`,
				this.id,
			);
		}
		const titles = new TitleCollector();
		const snippets = new SnippetCollector();
		const rewritten = new HTMLRewriter()
			.on("a.result__a", titles)
			.on("a.result__snippet", snippets)
			.transform(res);
		await rewritten.text();

		return titles.results.slice(0, maxResults).map((t, i): SearchResult => ({
			title: t.title.trim(),
			url: decodeRedirect(t.href),
			snippet: (snippets.snippets[i] ?? "").trim(),
			provider: this.id,
		})).filter((r) => r.url);
	}

	async searchNews(query: string, options: SearchOptions): Promise<SearchResult[]> {
		return this.search(query, options);
	}
}
