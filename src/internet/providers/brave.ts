/**
 * Brave Search adapter (v1.6.0)
 * ---------------------------------------------------------------------------
 * Uses the Brave Search API (web + news endpoints). Requires the optional
 * Worker secret BRAVE_SEARCH_API_KEY. When the secret is absent, isConfigured()
 * returns false and the router skips this provider; a direct provider="brave"
 * request surfaces a CONFIGURATION_ERROR.
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search
 */

import {
	InternetError,
	type ImageResult,
	type SearchOptions,
	type SearchProviderAdapter,
	type SearchResult,
} from "../types";
import { clamp, fetchWithTimeout, providerHttpError } from "../util";

const WEB_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const NEWS_ENDPOINT = "https://api.search.brave.com/res/v1/news/search";
const IMAGE_ENDPOINT = "https://api.search.brave.com/res/v1/images/search";

export class BraveProvider implements SearchProviderAdapter {
	readonly id = "brave" as const;
	constructor(private readonly apiKey: string | undefined) {}

	isConfigured(): boolean {
		return Boolean(this.apiKey && this.apiKey.trim());
	}

	private requireKey(): string {
		if (!this.isConfigured()) {
			throw new InternetError(
				"CONFIGURATION_ERROR",
				"Brave provider is not configured: set the BRAVE_SEARCH_API_KEY Worker secret",
				this.id,
			);
		}
		return this.apiKey as string;
	}

	private headers(): Record<string, string> {
		return {
			Accept: "application/json",
			"Accept-Encoding": "gzip",
			"X-Subscription-Token": this.requireKey(),
		};
	}

	private buildParams(query: string, options: SearchOptions): URLSearchParams {
		const params = new URLSearchParams();
		params.set("q", query);
		params.set("count", String(clamp(options.maxResults, 1, 20, 10)));
		if (options.freshness) params.set("freshness", options.freshness);
		return params;
	}

	async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
		const params = this.buildParams(query, options);
		const res = await fetchWithTimeout(
			`${WEB_ENDPOINT}?${params.toString()}`,
			{ headers: this.headers() },
			15_000,
			this.id,
		);
		if (!res.ok) throw providerHttpError(this.id, res.status, await res.text().catch(() => ""));
		const data = (await res.json()) as any;
		const web = data?.web?.results;
		if (!Array.isArray(web)) return [];
		return web.map((r: any): SearchResult => ({
			title: String(r?.title ?? "").trim(),
			url: String(r?.url ?? "").trim(),
			snippet: String(r?.description ?? "").replace(/<[^>]+>/g, "").trim(),
			provider: this.id,
			publishedAt: typeof r?.page_age === "string" ? r.page_age : undefined,
		})).filter((r: SearchResult) => r.url);
	}

	async searchNews(query: string, options: SearchOptions): Promise<SearchResult[]> {
		const params = this.buildParams(query, options);
		const res = await fetchWithTimeout(
			`${NEWS_ENDPOINT}?${params.toString()}`,
			{ headers: this.headers() },
			15_000,
			this.id,
		);
		if (!res.ok) throw providerHttpError(this.id, res.status, await res.text().catch(() => ""));
		const data = (await res.json()) as any;
		const items = data?.results;
		if (!Array.isArray(items)) return [];
		return items.map((r: any): SearchResult => ({
			title: String(r?.title ?? "").trim(),
			url: String(r?.url ?? "").trim(),
			snippet: String(r?.description ?? "").replace(/<[^>]+>/g, "").trim(),
			provider: this.id,
			publishedAt: typeof r?.age === "string" ? r.age : (typeof r?.page_age === "string" ? r.page_age : undefined),
		})).filter((r: SearchResult) => r.url);
	}

	async searchImages(query: string, options: SearchOptions): Promise<ImageResult[]> {
		const params = new URLSearchParams();
		params.set("q", query);
		params.set("count", String(clamp(options.maxResults, 1, 50, 10)));
		const res = await fetchWithTimeout(
			`${IMAGE_ENDPOINT}?${params.toString()}`,
			{ headers: this.headers() },
			15_000,
			this.id,
		);
		if (!res.ok) throw providerHttpError(this.id, res.status, await res.text().catch(() => ""));
		const data = (await res.json()) as any;
		const items = data?.results;
		if (!Array.isArray(items)) return [];
		return items.map((r: any): ImageResult => ({
			title: String(r?.title ?? "").trim(),
			sourceUrl: String(r?.url ?? "").trim(),
			imageUrl: String(r?.properties?.url ?? r?.thumbnail?.src ?? "").trim(),
			width: typeof r?.properties?.width === "number" ? r.properties.width : undefined,
			height: typeof r?.properties?.height === "number" ? r.properties.height : undefined,
			provider: this.id,
		})).filter((r: ImageResult) => r.imageUrl);
	}
}
