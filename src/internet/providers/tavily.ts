/**
 * Tavily adapter (v1.6.0)
 * ---------------------------------------------------------------------------
 * Tavily Search API — strong for recent/news/research-oriented queries.
 * Requires the optional Worker secret TAVILY_API_KEY. POST JSON API with the
 * key in the request body (never in a URL or error message).
 *
 * Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
 */

import {
	InternetError,
	type SearchOptions,
	type SearchProviderAdapter,
	type SearchResult,
} from "../types";
import { clamp, fetchWithTimeout, providerHttpError } from "../util";

const SEARCH_ENDPOINT = "https://api.tavily.com/search";

export class TavilyProvider implements SearchProviderAdapter {
	readonly id = "tavily" as const;
	constructor(private readonly apiKey: string | undefined) {}

	isConfigured(): boolean {
		return Boolean(this.apiKey && this.apiKey.trim());
	}

	private requireKey(): string {
		if (!this.isConfigured()) {
			throw new InternetError(
				"CONFIGURATION_ERROR",
				"Tavily provider is not configured: set the TAVILY_API_KEY Worker secret",
				this.id,
			);
		}
		return this.apiKey as string;
	}

	private async run(query: string, options: SearchOptions, topic: "general" | "news"): Promise<SearchResult[]> {
		const body: Record<string, unknown> = {
			api_key: this.requireKey(),
			query,
			topic,
			max_results: clamp(options.maxResults, 1, 20, 10),
			search_depth: "basic",
		};
		if (options.includeDomains?.length) body.include_domains = options.includeDomains;
		if (options.excludeDomains?.length) body.exclude_domains = options.excludeDomains;
		if (topic === "news" && options.freshness) {
			const days = Number(options.freshness);
			if (Number.isFinite(days) && days > 0) body.days = Math.min(365, Math.floor(days));
		}

		const res = await fetchWithTimeout(
			SEARCH_ENDPOINT,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(body),
			},
			20_000,
			this.id,
		);
		if (!res.ok) throw providerHttpError(this.id, res.status, await res.text().catch(() => ""));
		const data = (await res.json()) as any;
		const items = data?.results;
		if (!Array.isArray(items)) return [];
		return items.map((r: any): SearchResult => ({
			title: String(r?.title ?? "").trim(),
			url: String(r?.url ?? "").trim(),
			snippet: String(r?.content ?? "").trim(),
			provider: this.id,
			publishedAt: typeof r?.published_date === "string" ? r.published_date : undefined,
			score: typeof r?.score === "number" ? r.score : undefined,
		})).filter((r: SearchResult) => r.url);
	}

	async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
		return this.run(query, options, options.news ? "news" : "general");
	}

	async searchNews(query: string, options: SearchOptions): Promise<SearchResult[]> {
		return this.run(query, options, "news");
	}
}
