/**
 * robots.txt Policy Layer (v1.6.0)
 * ---------------------------------------------------------------------------
 * Fetches and parses a site's /robots.txt and answers "may I fetch this path?"
 * for a given user-agent. The robots.txt itself is retrieved through the same
 * hardened, SSRF-guarded fetch path (fetchText → safeFetch) as every other
 * outbound request — no bypass of redirect validation, timeouts, byte limits,
 * or blocked IP ranges.
 *
 * This is a conservative subset parser (User-agent, Allow, Disallow,
 * Crawl-delay) with a per-origin in-memory cache and simple "*" wildcard
 * prefix matching. It is good enough for polite "should I fetch this?"
 * decisions during crawling — it is NOT a full RFC 9309 implementation.
 */

import { fetchText } from "./fetch";

/** Identity used for crawler operations and robots.txt matching. */
export const ROBOTS_USER_AGENT = "cf-control-mcp/1.6";

/**
 * Upper bound on a site-declared Crawl-delay we are willing to honor. If a
 * site asks for a longer delay, the caller should treat the origin as
 * effectively off-limits for bounded crawling rather than sleep indefinitely.
 */
export const MAX_ROBOTS_CRAWL_DELAY_SECONDS = 10;

/** Max bytes to read from a robots.txt (they are small; cap protects us anyway). */
const ROBOTS_MAX_BYTES = 100_000;
/** Timeout for the robots.txt fetch itself. */
const ROBOTS_TIMEOUT_MS = 10_000;

interface RobotsRule {
	path: string;
	allow: boolean;
}

interface RobotsGroup {
	agents: string[];
	rules: RobotsRule[];
	crawlDelaySec?: number;
}

export interface RobotsPolicy {
	origin: string;
	/** True only when a robots.txt was actually fetched with a 2xx status and parsed. */
	fetched: boolean;
	groups: RobotsGroup[];
}

const policyCache = new Map<string, { policy: RobotsPolicy; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function parseRobotsTxt(text: string): RobotsGroup[] {
	const groups: RobotsGroup[] = [];
	let current: RobotsGroup | null = null;
	let sawRuleSinceAgent = true;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.split("#")[0].trim();
		if (!line) continue;
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const field = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();

		if (field === "user-agent") {
			// Consecutive User-agent lines share one group until a rule appears.
			if (!current || sawRuleSinceAgent) {
				current = { agents: [], rules: [] };
				groups.push(current);
			}
			current.agents.push(value.toLowerCase());
			sawRuleSinceAgent = false;
			continue;
		}
		if (!current) continue;
		if (field === "allow" || field === "disallow") {
			current.rules.push({ path: value, allow: field === "allow" });
			sawRuleSinceAgent = true;
			continue;
		}
		if (field === "crawl-delay") {
			const n = Number(value);
			if (Number.isFinite(n) && n >= 0) current.crawlDelaySec = n;
			sawRuleSinceAgent = true;
		}
	}
	return groups;
}

/** Fetch (with a short cache) and parse the robots.txt for the given URL's origin. */
export async function getRobotsPolicy(url: string): Promise<RobotsPolicy> {
	const origin = new URL(url).origin;
	const cached = policyCache.get(origin);
	if (cached && cached.expiresAt > Date.now()) return cached.policy;

	let policy: RobotsPolicy;
	try {
		const res = await fetchText(`${origin}/robots.txt`, ROBOTS_MAX_BYTES, ROBOTS_TIMEOUT_MS);
		if (res.status >= 200 && res.status < 300) {
			policy = { origin, fetched: true, groups: parseRobotsTxt(res.text) };
		} else {
			// No robots.txt (404) or non-2xx → treat as "allow all" (standard behavior),
			// but record that we did not actually evaluate a policy.
			policy = { origin, fetched: false, groups: [] };
		}
	} catch {
		// Timeout / DNS / SSRF rejection → do not crash the crawl; allow, but be honest.
		policy = { origin, fetched: false, groups: [] };
	}
	policyCache.set(origin, { policy, expiresAt: Date.now() + CACHE_TTL_MS });
	return policy;
}

/** Length of the matched prefix for `path` against a rule path, or -1 if no match. */
function bestMatchLength(path: string, rulePath: string): number {
	if (!rulePath) return 0;
	// "*" wildcard support (simple glob → prefix-match up to first "*").
	const star = rulePath.indexOf("*");
	const prefix = star === -1 ? rulePath : rulePath.slice(0, star);
	if (prefix === "") return 0;
	return path.startsWith(prefix) ? prefix.length : -1;
}

function selectGroup(groups: RobotsGroup[], userAgent: string): RobotsGroup | null {
	const ua = userAgent.toLowerCase();
	// Most specific: a named agent token that our UA string contains.
	const specific = groups.find((g) => g.agents.some((a) => a !== "*" && a !== "" && ua.includes(a)));
	if (specific) return specific;
	return groups.find((g) => g.agents.includes("*")) ?? null;
}

export interface RobotsCheckResult {
	url: string;
	allowed: boolean;
	matchedRule?: string;
	/** Site-declared crawl delay, already clamped to MAX_ROBOTS_CRAWL_DELAY_SECONDS. */
	crawlDelaySec?: number;
	/** True only when a robots.txt was actually fetched and evaluated. */
	robotsFetched: boolean;
	/** True when the site asked for a longer delay than we are willing to honor. */
	crawlDelayExceeded?: boolean;
}

/** Clamp a site-declared crawl delay to our bounded maximum. */
function clampDelay(delay: number | undefined): { value?: number; exceeded: boolean } {
	if (delay === undefined) return { exceeded: false };
	if (delay > MAX_ROBOTS_CRAWL_DELAY_SECONDS) return { value: MAX_ROBOTS_CRAWL_DELAY_SECONDS, exceeded: true };
	return { value: delay, exceeded: false };
}

/** True/false + which rule decided it, for a given URL and user-agent. */
export async function isAllowedByRobots(
	url: string,
	userAgent: string = ROBOTS_USER_AGENT,
): Promise<RobotsCheckResult> {
	const policy = await getRobotsPolicy(url);
	const parsed = new URL(url);
	const path = parsed.pathname + parsed.search;
	const group = selectGroup(policy.groups, userAgent);
	if (!group) {
		return { url, allowed: true, robotsFetched: policy.fetched };
	}

	const delay = clampDelay(group.crawlDelaySec);

	let best: { len: number; allow: boolean; path: string } | null = null;
	for (const rule of group.rules) {
		const len = bestMatchLength(path, rule.path);
		if (len < 0) continue;
		// Longest match wins; on a tie, Allow wins over Disallow (RFC 9309 spirit).
		if (!best || len > best.len || (len === best.len && rule.allow && !best.allow)) {
			best = { len, allow: rule.allow, path: rule.path };
		}
	}
	if (!best) {
		return {
			url,
			allowed: true,
			robotsFetched: policy.fetched,
			crawlDelaySec: delay.value,
			crawlDelayExceeded: delay.exceeded,
		};
	}
	return {
		url,
		allowed: best.allow,
		matchedRule: best.path,
		crawlDelaySec: delay.value,
		crawlDelayExceeded: delay.exceeded,
		robotsFetched: policy.fetched,
	};
}

/** Test-only: clear the per-origin policy cache. */
export function _clearRobotsCache(): void {
	policyCache.clear();
}
