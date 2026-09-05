/**
 * Research Layer — web_deep_research pipeline (v1.6.0)
 * ---------------------------------------------------------------------------
 * High-level evidence-collection pipeline:
 *   query → optional query expansion → multi-provider search →
 *   URL normalize/dedupe → ranking → fetch (bounded) → content extraction →
 *   source/evidence aggregation.
 *
 * This layer collects and structures EVIDENCE. It never invents conclusions or
 * a synthesized narrative — that is left to the calling model. All execution is
 * bounded by source count, total fetched bytes, and wall-clock duration.
 */

import { fetchText } from "./fetch";
import { htmlToText } from "./html";
import { isAllowedByRobots, ROBOTS_USER_AGENT } from "./robots";
import { SearchRouter } from "./search-router";
import {
	InternetError,
	type ProviderError,
	type SearchOptions,
	type SearchResult,
} from "./types";
import { clamp, dedupeResults, LIMITS } from "./util";

export type ResearchDepth = "quick" | "standard" | "deep";

export interface ResearchArgs {
	query: string;
	depth?: ResearchDepth;
	maxSources?: number;
	freshness?: string;
	includeDomains?: string[];
	excludeDomains?: string[];
	/** Respect robots.txt when fetching source pages. Default: true. */
	respect_robots?: boolean;
}

export interface ResearchSource {
	title: string;
	url: string;
	provider: string;
	publishedAt?: string;
	score?: number;
	extractedText?: string;
	evidence?: string[];
	fetchError?: string;
	/** Set when the source page was not fetched because robots.txt disallowed it. */
	skippedReason?: string;
}

export interface ResearchResult {
	query: string;
	depth: ResearchDepth;
	expandedQueries: string[];
	sources: ResearchSource[];
	providerErrors: ProviderError[];
	stats: {
		searched: number;
		fetched: number;
		rendered: number;
		failed: number;
		deduplicated: number;
		robotsDenied: number;
	};
}

interface DepthProfile {
	queries: number;
	perProvider: number;
	maxSources: number;
	fetchSources: number;
}

function profileFor(depth: ResearchDepth): DepthProfile {
	switch (depth) {
		case "quick":
			return { queries: 1, perProvider: 5, maxSources: 5, fetchSources: 3 };
		case "deep":
			return { queries: 4, perProvider: 10, maxSources: LIMITS.RESEARCH_MAX_SOURCES, fetchSources: 12 };
		case "standard":
		default:
			return { queries: 2, perProvider: 8, maxSources: 12, fetchSources: 6 };
	}
}

/** Deterministic, non-LLM query expansion: adds focused variants of the query. */
function expandQuery(query: string, count: number): string[] {
	const base = query.trim();
	if (count <= 1) return [base];
	const variants = new Set<string>([base]);
	const modifiers = [
		`${base} latest`,
		`${base} overview`,
		`${base} explained`,
		`${base} recent developments`,
		`${base} comparison`,
	];
	for (const m of modifiers) {
		if (variants.size >= count) break;
		variants.add(m);
	}
	return [...variants].slice(0, count);
}

/** Score a result for ranking: provider score + recency + snippet richness. */
function rankScore(r: SearchResult): number {
	let score = typeof r.score === "number" ? r.score : 0.3;
	if (r.publishedAt) {
		const t = Date.parse(r.publishedAt);
		if (Number.isFinite(t)) {
			const ageDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
			if (ageDays >= 0) score += Math.max(0, 0.3 - ageDays / 3650);
		}
	}
	score += Math.min(0.2, r.snippet.length / 2000);
	return score;
}

/** Pull short evidence sentences that mention query terms. */
function evidenceFrom(text: string, query: string, max = 4): string[] {
	const terms = query
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 3);
	if (terms.length === 0) return [];
	const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 400);
	const scored: { s: string; hits: number }[] = [];
	for (const s of sentences) {
		const low = s.toLowerCase();
		const hits = terms.reduce((acc, t) => acc + (low.includes(t) ? 1 : 0), 0);
		if (hits > 0 && s.length > 40 && s.length < 400) scored.push({ s: s.trim(), hits });
	}
	scored.sort((a, b) => b.hits - a.hits);
	return scored.slice(0, max).map((x) => x.s);
}

/** Run the bounded deep-research pipeline. */
export async function deepResearch(router: SearchRouter, args: ResearchArgs): Promise<ResearchResult> {
	const query = String(args.query ?? "").trim();
	if (!query) throw new InternetError("INVALID_ARGUMENT", "query is required");

	const depth: ResearchDepth = args.depth === "quick" || args.depth === "deep" ? args.depth : "standard";
	const profile = profileFor(depth);
	const maxSources = clamp(args.maxSources, 1, profile.maxSources, profile.maxSources);
	const deadline = Date.now() + LIMITS.RESEARCH_MAX_DURATION_MS;

	const expandedQueries = expandQuery(query, profile.queries);
	const searchOptions: SearchOptions = {
		maxResults: profile.perProvider,
		freshness: args.freshness,
		includeDomains: args.includeDomains,
		excludeDomains: args.excludeDomains,
		perProvider: profile.perProvider,
	} as SearchOptions & { perProvider: number };

	const allResults: SearchResult[] = [];
	const providerErrors: ProviderError[] = [];
	let searched = 0;

	for (const q of expandedQueries) {
		if (Date.now() > deadline) break;
		try {
			const multi = await router.searchMulti(q, undefined, searchOptions);
			searched += multi.providersAttempted.length;
			allResults.push(...multi.results);
			for (const e of multi.providersFailed) {
				if (!providerErrors.some((pe) => pe.provider === e.provider && pe.message === e.message)) {
					providerErrors.push(e);
				}
			}
		} catch (err) {
			const ie = err instanceof InternetError ? err : new InternetError("PROVIDER_ERROR", String(err));
			providerErrors.push({ provider: ie.provider ?? "ddg", code: ie.code, message: ie.message });
		}
	}

	const { results: deduped, removed } = dedupeResults(allResults);
	deduped.sort((a, b) => rankScore(b) - rankScore(a));
	const top = deduped.slice(0, maxSources);

	const respectRobots = args.respect_robots !== false; // default true (polite)
	const sources: ResearchSource[] = [];
	let fetchedCount = 0;
	let failed = 0;
	let robotsDenied = 0;
	let totalBytes = 0;

	for (const r of top) {
		const source: ResearchSource = {
			title: r.title,
			url: r.url,
			provider: r.provider,
			publishedAt: r.publishedAt,
			score: r.score,
		};
		let shouldFetch =
			fetchedCount < profile.fetchSources &&
			Date.now() < deadline &&
			totalBytes < LIMITS.RESEARCH_MAX_TOTAL_BYTES;
		if (shouldFetch && respectRobots) {
			try {
				const decision = await isAllowedByRobots(r.url, ROBOTS_USER_AGENT);
				if (!decision.allowed) {
					source.skippedReason = "ROBOTS_DENIED";
					robotsDenied += 1;
					shouldFetch = false;
				}
			} catch {
				// Robots check failed unexpectedly → do not block evidence collection.
			}
		}
		if (shouldFetch) {
			try {
				const { contentType, text } = await fetchText(r.url, 150_000, 20_000);
				totalBytes += text.length;
				if ((contentType ?? "").includes("html")) {
					const { text: plain } = await htmlToText(text, r.url);
					source.extractedText = plain.slice(0, 4000);
					source.evidence = evidenceFrom(plain, query);
				} else {
					source.extractedText = text.slice(0, 4000);
					source.evidence = evidenceFrom(text, query);
				}
				fetchedCount += 1;
			} catch (err) {
				source.fetchError = err instanceof Error ? err.message : String(err);
				failed += 1;
			}
		}
		sources.push(source);
	}

	return {
		query,
		depth,
		expandedQueries,
		sources,
		providerErrors,
		stats: {
			searched,
			fetched: fetchedCount,
			rendered: 0,
			failed,
			deduplicated: removed,
			robotsDenied,
		},
	};
}
