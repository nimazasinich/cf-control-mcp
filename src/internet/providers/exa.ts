/**
 * Exa adapter (v1.6.0)
 * ---------------------------------------------------------------------------
 * Exa (formerly Metaphor) neural/semantic search API. Strong for semantic,
 * content-oriented retrieval. Requires the optional Worker secret EXA_API_KEY,
 * sent as the `x-api-key` header (never in a URL or error message).
 *
 * Docs: https://docs.exa.ai/reference/search
 */

import {
	InternetError,
	type SearchOptions,
	type SearchProviderAdapter,
	type SearchResult,
} from "../types";
import { clamp, fetchWithTimeout, providerHttpError } from "../util";

const SEARCH_ENDPOINT = "https://api.exa.ai/search";

export class ExaProvider implements SearchProviderAdapter {
	readonly id = "exa" as const;
	constructor(private readonly apiKey: string | undefined) {}

	isConfigured(): boolean {
		return Boolean(this.apiKey && this.apiKey.trim());
	}

	private requireKey(): string {
		if (!this.isConfigured()) {
			throw new InternetError(
				"CONFIGURATION_ERROR",
				"Exa provider is not configured: set the EXA_API_KEY Worker secret",
				this.id,
			);
		}
		return this.apiKey as string;
	}

	private async run(query: string, options: SearchOptions, category?: string): Promise<SearchResult[]> {
		const body: Record<string, unknown> = {
			query,
			numResults: clamp(options.maxResults, 1, 25, 10),
			type: "auto",
			contents: { text: { maxCharacters: 1000 } },
		};
		if (options.includeDomains?.length) body.includeDomains = options.includeDomains;
		if (options.excludeDomains?.length) body.excludeDomains = options.excludeDomains;
		if (category) body.category = category;
		if (options.freshness) {
			const days = Number(options.freshness);
			if (Number.isFinite(days) && days > 0) {
				const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
				body.startPublishedDate = since.toISOString();
			}
		}

		const res = await fetchWithTimeout(
			SEARCH_ENDPOINT,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					"x-api-key": this.requireKey(),
				},
				body: JSON.stringify(body),
			},
			20_000,
			this.id,
		);
		if (!res.ok) throw providerHttpError(this.id, res.status, await res.text().catch(() => ""));
		const data = (await res.json()) as any;
		const items = data?.results;
		if (!Array.isArray(items)) return [];
		return items.map((r: any): SearchResult => {
			const text = String(r?.text ?? "").trim();
			return {
				title: String(r?.title ?? "").trim(),
				url: String(r?.url ?? "").trim(),
				snippet: text ? text.slice(0, 400) : String(r?.summary ?? "").trim(),
				provider: this.id,
				publishedAt: typeof r?.publishedDate === "string" ? r.publishedDate : undefined,
				score: typeof r?.score === "number" ? r.score : undefined,
			};
		}).filter((r: SearchResult) => r.url);
	}

	async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
		return this.run(query, options);
	}

	async searchNews(query: string, options: SearchOptions): Promise<SearchResult[]> {
		return this.run(query, options, "news");
	}
}
