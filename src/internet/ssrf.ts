/**
 * cf-control-mcp — SSRF guard (v1.6.0)
 * ---------------------------------------------------------------------------
 * Hardened target validation shared by web_fetch, web_render, web_markdown,
 * web_extract, web_links, web_snapshot, and web_crawl.
 *
 * Guarantees:
 *  - HTTP/HTTPS scheme only.
 *  - Reject localhost, loopback, RFC1918 private ranges, link-local,
 *    unique-local IPv6 (fc00::/7), link-local IPv6 (fe80::/10), *.internal,
 *    and known cloud metadata endpoints.
 *  - IPv4 is parsed from all notations (decimal/octal/hex/short) via a numeric
 *    normalization so that obfuscated forms like 0x7f.1, 2130706433, or
 *    017700000001 cannot smuggle a loopback/private address past the filter.
 *  - Every redirect hop is re-validated (see safeFetch): a public-looking URL
 *    cannot 30x-redirect into a blocked private target.
 *
 * DNS rebinding note: Cloudflare Workers' fetch() does not expose the resolved
 * IP, so we cannot pin a resolved address at the socket layer here. We reject
 * literal private/blocked IPs and hostnames, and re-validate every redirect.
 * Callers that need stronger guarantees should prefer literal-IP allow-lists.
 */

import { InternetError } from "./types";

const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
	/^localhost$/i,
	/\.localhost$/i,
	/\.internal$/i,
	/\.local$/i,
	/^metadata\.google\.internal$/i,
	/^metadata$/i,
];

/** Known cloud metadata IP literals (AWS/GCP/Azure/OpenStack/Alibaba/DO/Oracle). */
const METADATA_HOSTS = new Set<string>([
	"169.254.169.254",
	"169.254.170.2",
	"100.100.100.200",
	"fd00:ec2::254",
]);

/** Parse an IPv4 string in any notation into its 32-bit unsigned value, or null. */
function parseIpv4ToLong(host: string): number | null {
	const parts = host.split(".");
	if (parts.length === 0 || parts.length > 4) return null;

	const nums: number[] = [];
	for (const part of parts) {
		if (part === "") return null;
		let value: number;
		if (/^0x[0-9a-f]+$/i.test(part)) {
			value = parseInt(part, 16);
		} else if (/^0[0-7]+$/.test(part)) {
			value = parseInt(part, 8);
		} else if (/^[0-9]+$/.test(part)) {
			value = parseInt(part, 10);
		} else {
			return null;
		}
		if (!Number.isFinite(value) || value < 0) return null;
		nums.push(value);
	}

	// Support 1-, 2-, 3-, and 4-part IPv4 notations like inet_aton.
	let long: number;
	switch (nums.length) {
		case 1:
			long = nums[0];
			break;
		case 2:
			if (nums[0] > 0xff || nums[1] > 0xffffff) return null;
			long = (nums[0] << 24) >>> 0;
			long = (long + nums[1]) >>> 0;
			break;
		case 3:
			if (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff) return null;
			long = ((nums[0] << 24) >>> 0) + ((nums[1] << 16) >>> 0) + nums[2];
			long = long >>> 0;
			break;
		case 4:
			if (nums.some((n) => n > 0xff)) return null;
			long = ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
			long = long >>> 0;
			break;
		default:
			return null;
	}
	if (long > 0xffffffff) return null;
	return long;
}

/** True when a 32-bit IPv4 value falls in a blocked (non-public) range. */
function isBlockedIpv4Long(long: number): boolean {
	const a = (long >>> 24) & 0xff;
	const b = (long >>> 16) & 0xff;
	// 0.0.0.0/8 (includes 0.0.0.0)
	if (a === 0) return true;
	// 10.0.0.0/8
	if (a === 10) return true;
	// 127.0.0.0/8 loopback
	if (a === 127) return true;
	// 169.254.0.0/16 link-local (incl. cloud metadata)
	if (a === 169 && b === 254) return true;
	// 172.16.0.0/12
	if (a === 172 && b >= 16 && b <= 31) return true;
	// 192.168.0.0/16
	if (a === 192 && b === 168) return true;
	// 100.64.0.0/10 carrier-grade NAT
	if (a === 100 && b >= 64 && b <= 127) return true;
	// 192.0.0.0/24, 192.0.2.0/24 test nets, 198.18.0.0/15 benchmarking
	if (a === 192 && b === 0) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	// 255.255.255.255 broadcast
	if (long === 0xffffffff) return true;
	return false;
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups. Supports "::" zero
 * compression and a trailing dotted-quad (IPv4-mapped) tail. Returns null when
 * the string is not a parseable IPv6 literal.
 */
function expandIpv6(input: string): number[] | null {
	let s = input.toLowerCase();
	if (!s.includes(":")) return null;

	// Convert a trailing dotted-quad tail into two hextets.
	const v4Match = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (v4Match) {
		const long = parseIpv4ToLong(v4Match[1]);
		if (long === null) return null;
		const hi = ((long >>> 16) & 0xffff).toString(16);
		const lo = (long & 0xffff).toString(16);
		s = s.slice(0, v4Match.index) + hi + ":" + lo;
	}

	const halves = s.split("::");
	if (halves.length > 2) return null;

	const parseGroups = (part: string): number[] | null => {
		if (part === "") return [];
		const out: number[] = [];
		for (const g of part.split(":")) {
			if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
			out.push(parseInt(g, 16));
		}
		return out;
	};

	if (halves.length === 2) {
		const head = parseGroups(halves[0]);
		const tail = parseGroups(halves[1]);
		if (head === null || tail === null) return null;
		const missing = 8 - (head.length + tail.length);
		if (missing < 0) return null;
		return [...head, ...new Array(missing).fill(0), ...tail];
	}

	const groups = parseGroups(s);
	if (groups === null || groups.length !== 8) return null;
	return groups;
}

/** Normalize an IPv6 literal (strip brackets/zone) and test for blocked ranges. */
function isBlockedIpv6(hostRaw: string): boolean {
	let host = hostRaw.trim();
	if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
	const zoneIdx = host.indexOf("%");
	if (zoneIdx !== -1) host = host.slice(0, zoneIdx);
	const lower = host.toLowerCase();
	if (!lower.includes(":")) return false;

	const groups = expandIpv6(lower);
	if (groups === null) {
		// Unparseable — fail closed only for obvious loopback/unspecified forms.
		return lower === "::1" || lower === "::";
	}

	const first = groups[0];

	// :: unspecified (all zero) and ::1 loopback
	if (groups.every((g) => g === 0)) return true;
	if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;

	// fc00::/7 unique-local (fc00–fdff)
	if (first >= 0xfc00 && first <= 0xfdff) return true;
	// fe80::/10 link-local (fe80–febf)
	if (first >= 0xfe80 && first <= 0xfebf) return true;

	// IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::0:0/96 — inspect embedded IPv4.
	const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
	const isCompat = groups.slice(0, 6).every((g) => g === 0) && (groups[6] !== 0 || groups[7] !== 0);
	if (isMapped || isCompat) {
		const long = (((groups[6] << 16) >>> 0) + groups[7]) >>> 0;
		if (isBlockedIpv4Long(long)) return true;
	}

	return false;
}

/**
 * Validate a URL string for outbound fetch. Returns the parsed URL when safe,
 * throws InternetError("BLOCKED_TARGET" | "INVALID_ARGUMENT") otherwise.
 */
export function assertSafeUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new InternetError("INVALID_ARGUMENT", "Invalid URL");
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new InternetError("BLOCKED_TARGET", "Only http/https URLs are allowed");
	}

	let host = url.hostname.toLowerCase();
	if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

	if (!host) throw new InternetError("BLOCKED_TARGET", "URL has no host");

	// Explicit metadata literals.
	if (METADATA_HOSTS.has(host)) {
		throw new InternetError("BLOCKED_TARGET", "Cloud metadata endpoints are blocked");
	}

	// Hostname pattern blocks (localhost, *.internal, *.local, metadata).
	if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(host))) {
		throw new InternetError("BLOCKED_TARGET", "This host is blocked (internal/loopback/metadata)");
	}

	// IPv6 literal checks.
	if (host.includes(":")) {
		if (isBlockedIpv6(host)) {
			throw new InternetError("BLOCKED_TARGET", "Blocked IPv6 (loopback/private/link-local)");
		}
		return url;
	}

	// IPv4 literal checks (any notation).
	const long = parseIpv4ToLong(host);
	if (long !== null) {
		if (isBlockedIpv4Long(long)) {
			throw new InternetError("BLOCKED_TARGET", "Blocked IPv4 (private/loopback/link-local/metadata)");
		}
		return url;
	}

	// Regular hostname: allowed (DNS resolution happens at fetch time).
	return url;
}

/**
 * fetch() that manually follows redirects, re-validating every hop against the
 * SSRF guard. A public URL cannot redirect into a blocked private target.
 */
export async function safeFetch(
	initialUrl: string,
	init: RequestInit,
	opts: { maxRedirects?: number; timeoutMs?: number },
): Promise<{ response: Response; finalUrl: string; redirects: string[] }> {
	const maxRedirects = opts.maxRedirects ?? 5;
	const timeoutMs = opts.timeoutMs ?? 30_000;
	const redirects: string[] = [];
	let currentUrl = assertSafeUrl(initialUrl).toString();
	let method = (init.method ?? "GET").toUpperCase();
	let body = init.body;

	for (let hop = 0; hop <= maxRedirects; hop += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let res: Response;
		try {
			res = await fetch(currentUrl, {
				...init,
				method,
				body,
				redirect: "manual",
				signal: controller.signal,
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new InternetError("TIMEOUT", `Request timed out after ${timeoutMs}ms`);
			}
			const message = err instanceof Error ? err.message : String(err);
			throw new InternetError("NETWORK_ERROR", `Network error: ${message}`);
		} finally {
			clearTimeout(timer);
		}

		const status = res.status;
		const location = res.headers.get("location");
		if (status >= 300 && status < 400 && location) {
			if (hop >= maxRedirects) {
				throw new InternetError("NETWORK_ERROR", `Too many redirects (>${maxRedirects})`);
			}
			const nextUrl = new URL(location, currentUrl).toString();
			// Re-validate the redirect target — this is the critical SSRF hop check.
			assertSafeUrl(nextUrl);
			redirects.push(nextUrl);
			currentUrl = nextUrl;
			// Per fetch semantics, 303 (and 301/302 for POST in practice) switch to GET.
			if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
				method = "GET";
				body = undefined;
			}
			// Drain the redirect body to free the connection.
			await res.body?.cancel().catch(() => {});
			continue;
		}

		return { response: res, finalUrl: currentUrl, redirects };
	}

	throw new InternetError("NETWORK_ERROR", "Redirect loop exceeded limit");
}
