/**
 * cf-control-mcp — Internet Intelligence shared types (v1.6.0)
 * ---------------------------------------------------------------------------
 * Normalized search/content result shapes and a structured error model shared
 * by every Internet Intelligence provider adapter, the search router, the
 * hardened fetch layer, the Cloudflare Browser Rendering layer, and the
 * multi-provider research pipeline.
 *
 * These types are deliberately provider-agnostic: raw provider payloads are
 * normalized into `SearchResult` before they ever reach MCP output, so an MCP
 * client sees one consistent shape regardless of which upstream API answered.
 */

/** Provider identifiers understood by the search router. */
export type SearchProvider = "brave" | "tavily" | "exa" | "ddg";

/** How a caller may steer provider selection for a unified search. */
export type ProviderSelector = "auto" | SearchProvider;

/** A single normalized web-search result. */
export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	provider: SearchProvider;
	/** ISO-8601 publication timestamp when the provider exposes one. */
	publishedAt?: string;
	/** Provider-native relevance score when exposed, otherwise omitted. */
	score?: number;
}

/** A normalized image-search result (metadata only, no binary download). */
export interface ImageResult {
	title: string;
	sourceUrl: string;
	imageUrl: string;
	width?: number;
	height?: number;
	provider: SearchProvider;
}

/** Common options accepted by search providers (a provider ignores what it cannot honor). */
export interface SearchOptions {
	maxResults?: number;
	/** Provider-specific freshness / recency token, e.g. "day", "week", "pw". */
	freshness?: string;
	includeDomains?: string[];
	excludeDomains?: string[];
	/** Hint that the query is news/recency-oriented. */
	news?: boolean;
}

/** The result of one provider's search, keeping provenance intact. */
export interface ProviderSearchResponse {
	provider: SearchProvider;
	results: SearchResult[];
}

/** Per-provider error captured during a multi-provider run, kept separate from success. */
export interface ProviderError {
	provider: SearchProvider;
	code: InternetErrorCode;
	message: string;
}

/**
 * Structured Internet Intelligence error codes. Every tool-level failure maps
 * to one of these so an MCP client can differentiate configuration problems
 * from provider/network/target problems. These never carry provider API keys.
 */
export type InternetErrorCode =
	| "CONFIGURATION_ERROR"
	| "PROVIDER_ERROR"
	| "RATE_LIMITED"
	| "TIMEOUT"
	| "BLOCKED_TARGET"
	| "INVALID_ARGUMENT"
	| "NETWORK_ERROR"
	| "RENDER_ERROR";

/** Typed error carrying a structured code; message is safe to surface to clients. */
export class InternetError extends Error {
	readonly code: InternetErrorCode;
	readonly provider?: SearchProvider;
	constructor(code: InternetErrorCode, message: string, provider?: SearchProvider) {
		super(message);
		this.name = "InternetError";
		this.code = code;
		this.provider = provider;
	}
}

/** Provider adapter contract implemented by brave/tavily/exa. */
export interface SearchProviderAdapter {
	readonly id: SearchProvider;
	/** True when the required Worker secret for this provider is present. */
	isConfigured(): boolean;
	/** Run a normalized web search. Throws InternetError on failure. */
	search(query: string, options: SearchOptions): Promise<SearchResult[]>;
	/** Optional news-optimized search; defaults to search() when unset. */
	searchNews?(query: string, options: SearchOptions): Promise<SearchResult[]>;
	/** Optional image search; absence means the provider cannot do images. */
	searchImages?(query: string, options: SearchOptions): Promise<ImageResult[]>;
}
