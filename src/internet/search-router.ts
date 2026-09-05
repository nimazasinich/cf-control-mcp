/**
 * Search Router (v1.6.0)
 * ---------------------------------------------------------------------------
 * Owns provider selection, single-provider fallback, and concurrent
 * multi-provider fan-out with per-provider error isolation and dedup.
 *
 * Selection policy (provider="auto"):
 *   - general web  → Brave, then Tavily, then Exa, then DDG (keyless fallback)
 *   - news         → Tavily, then Brave, then Exa, then DDG
 *   - semantic/exa → Exa preferred when explicitly requested
 * Only configured providers are considered; DDG is always available so the
 * server can still answer a general query with zero paid secrets.
 */

import { BraveProvider } from "./providers/brave";
import { DdgProvider } from "./providers/ddg";
import { ExaProvider } from "./providers/exa";
import { TavilyProvider } from "./providers/tavily";
import {
	InternetError,
	type ImageResult,
	type ProviderError,
	type ProviderSelector,
	type SearchOptions,
	type SearchProvider,
	type SearchProviderAdapter,
	type SearchResult,
} from "./types";
import { applyDomainFilters, clamp, dedupeImages, dedupeResults, LIMITS } from "./util";

export interface RouterEnv {
	BRAVE_SEARCH_API_KEY?: string;
	TAVILY_API_KEY?: string;
	EXA_API_KEY?: string;
}

export interface UnifiedSearchResult {
	query: string;
	provider: SearchProvider;
	count: number;
	results: SearchResult[];
	/** Providers tried before the one that answered, when auto-fallback occurred. */
	fallbackFrom?: SearchProvider[];
}

export interface MultiSearchResult {
	query: string;
	providersAttempted: SearchProvider[];
	providersSucceeded: SearchProvider[];
	providersFailed: ProviderError[];
	count: number;
	results: SearchResult[];
	deduplicated: number;
}

export class SearchRouter {
	private readonly adapters: Record<SearchProvider, SearchProviderAdapter>;

	constructor(env: RouterEnv) {
		this.adapters = {
			brave: new BraveProvider(env.BRAVE_SEARCH_API_KEY),
			tavily: new TavilyProvider(env.TAVILY_API_KEY),
			exa: new ExaProvider(env.EXA_API_KEY),
			ddg: new DdgProvider(),
		};
	}

	/** Names of every configured provider (DDG always included). */
	configuredProviders(): SearchProvider[] {
		return (Object.keys(this.adapters) as SearchProvider[]).filter((id) =>
			this.adapters[id].isConfigured(),
		);
	}

	/** Configured providers that require a paid secret (excludes DDG). */
	configuredPaidProviders(): SearchProvider[] {
		return this.configuredProviders().filter((id) => id !== "ddg");
	}

	getAdapter(id: SearchProvider): SearchProviderAdapter {
		return this.adapters[id];
	}

	/** Ordered auto-selection preference for a given query flavor. */
	private autoOrder(news: boolean): SearchProvider[] {
		return news ? ["tavily", "brave", "exa", "ddg"] : ["brave", "tavily", "exa", "ddg"];
	}

	private applyFilters(results: SearchResult[], options: SearchOptions): SearchResult[] {
		return applyDomainFilters(results, options.includeDomains, options.excludeDomains);
	}

	/**
	 * Unified single-result search. With provider="auto", walks the preference
	 * order over configured providers, falling back to the next only when a
	 * provider genuinely fails (never silently claiming a fallback succeeded).
	 */
	async search(
		query: string,
		selector: ProviderSelector,
		options: SearchOptions,
	): Promise<UnifiedSearchResult> {
		const q = query.trim();
		if (!q) throw new InternetError("INVALID_ARGUMENT", "query is required");
		const cap = clamp(options.maxResults, 1, LIMITS.SEARCH_MAX_RESULTS, 10);
		const opts: SearchOptions = { ...options, maxResults: cap };

		if (selector !== "auto") {
			const adapter = this.adapters[selector];
			if (!adapter.isConfigured()) {
				throw new InternetError(
					"CONFIGURATION_ERROR",
					`Provider "${selector}" is not configured`,
					selector,
				);
			}
			const raw = options.news && adapter.searchNews
				? await adapter.searchNews(q, opts)
				: await adapter.search(q, opts);
			const results = this.applyFilters(raw, opts).slice(0, cap);
			return { query: q, provider: selector, count: results.length, results };
		}

		const order = this.autoOrder(Boolean(options.news)).filter((id) => this.adapters[id].isConfigured());
		const fallbackFrom: SearchProvider[] = [];
		let lastError: InternetError | null = null;

		for (const id of order) {
			const adapter = this.adapters[id];
			try {
				const raw = options.news && adapter.searchNews
					? await adapter.searchNews(q, opts)
					: await adapter.search(q, opts);
				const results = this.applyFilters(raw, opts).slice(0, cap);
				return {
					query: q,
					provider: id,
					count: results.length,
					results,
					fallbackFrom: fallbackFrom.length ? [...fallbackFrom] : undefined,
				};
			} catch (err) {
				lastError = err instanceof InternetError ? err : new InternetError("PROVIDER_ERROR", String(err), id);
				fallbackFrom.push(id);
			}
		}

		throw lastError ?? new InternetError("PROVIDER_ERROR", "All providers failed", undefined);
	}

	/**
	 * Concurrent multi-provider search. Runs each requested (configured)
	 * provider in parallel, isolates per-provider errors, merges + dedupes.
	 */
	async searchMulti(
		query: string,
		providers: SearchProvider[] | undefined,
		options: SearchOptions & { perProvider?: number },
	): Promise<MultiSearchResult> {
		const q = query.trim();
		if (!q) throw new InternetError("INVALID_ARGUMENT", "query is required");

		const requested = (providers && providers.length ? providers : this.configuredProviders())
			.filter((id, i, arr) => arr.indexOf(id) === i);
		const attempted = requested.filter((id) => this.adapters[id]?.isConfigured());
		if (attempted.length === 0) {
			throw new InternetError("CONFIGURATION_ERROR", "No configured providers available for this request");
		}

		const perProvider = clamp(options.perProvider, 1, LIMITS.SEARCH_MAX_RESULTS, 10);
		const cap = clamp(options.maxResults, 1, LIMITS.SEARCH_MAX_RESULTS, Math.min(50, attempted.length * perProvider));
		const opts: SearchOptions = { ...options, maxResults: perProvider };

		const settled = await Promise.allSettled(
			attempted.map(async (id) => {
				const adapter = this.adapters[id];
				const raw = options.news && adapter.searchNews
					? await adapter.searchNews(q, opts)
					: await adapter.search(q, opts);
				return { id, results: this.applyFilters(raw, opts).slice(0, perProvider) };
			}),
		);

		const succeeded: SearchProvider[] = [];
		const failed: ProviderError[] = [];
		let merged: SearchResult[] = [];

		settled.forEach((outcome, i) => {
			const id = attempted[i];
			if (outcome.status === "fulfilled") {
				succeeded.push(id);
				merged = merged.concat(outcome.value.results);
			} else {
				const err = outcome.reason;
				const ie = err instanceof InternetError ? err : new InternetError("PROVIDER_ERROR", String(err), id);
				failed.push({ provider: id, code: ie.code, message: ie.message });
			}
		});

		const { results: deduped, removed } = dedupeResults(merged);
		const results = deduped.slice(0, cap);
		return {
			query: q,
			providersAttempted: attempted,
			providersSucceeded: succeeded,
			providersFailed: failed,
			count: results.length,
			results,
			deduplicated: removed,
		};
	}

	/** Image search via the best configured image-capable provider (Brave). */
	async searchImages(query: string, options: SearchOptions): Promise<{ provider: SearchProvider; results: ImageResult[] }> {
		const q = query.trim();
		if (!q) throw new InternetError("INVALID_ARGUMENT", "query is required");
		const cap = clamp(options.maxResults, 1, LIMITS.SEARCH_MAX_RESULTS, 10);
		for (const id of ["brave"] as SearchProvider[]) {
			const adapter = this.adapters[id];
			if (adapter.isConfigured() && adapter.searchImages) {
				const raw = await adapter.searchImages(q, { ...options, maxResults: cap });
				return { provider: id, results: dedupeImages(raw).slice(0, cap) };
			}
		}
		throw new InternetError(
			"CONFIGURATION_ERROR",
			"No configured provider supports image search (set BRAVE_SEARCH_API_KEY to enable web_image_search)",
		);
	}
}
