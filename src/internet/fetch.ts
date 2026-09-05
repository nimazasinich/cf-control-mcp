/**
 * Hardened Fetch Layer (v1.6.0)
 * ---------------------------------------------------------------------------
 * SSRF-protected outbound HTTP with redirect re-validation, size caps, method
 * allow-listing, and structured errors. Powers web_fetch and is reused by the
 * browser/research layers for plain (non-JS) page retrieval.
 */

import { safeFetch } from "./ssrf";
import { InternetError } from "./types";
import { clamp, LIMITS } from "./util";

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Read a Response body as UTF-8 text, stopping once `maxBytes` *encoded bytes*
 * have been consumed. This streams the body and cancels the underlying reader
 * on truncation, so a huge remote payload is never fully buffered in memory.
 *
 * `bytes` is the number of encoded bytes actually decoded (capped at maxBytes);
 * `truncated` indicates the source had more data than the cap allowed. Shared
 * by web_fetch, robots.txt fetching, crawling, and research so byte limits are
 * enforced identically everywhere.
 */
export async function readBoundedText(
	response: Response,
	maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
	const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });

	// Fall back to arrayBuffer() only if the runtime gave us no readable stream.
	if (!response.body) {
		const buf = await response.arrayBuffer();
		const total = buf.byteLength;
		const truncated = total > maxBytes;
		const slice = truncated ? buf.slice(0, maxBytes) : buf;
		return { text: decoder.decode(slice), bytes: truncated ? maxBytes : total, truncated };
	}

	const reader = response.body.getReader();
	let text = "";
	let bytes = 0;
	let truncated = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			if (bytes + value.byteLength > maxBytes) {
				const remaining = maxBytes - bytes;
				if (remaining > 0) text += decoder.decode(value.subarray(0, remaining), { stream: true });
				bytes = maxBytes;
				truncated = true;
				break;
			}
			bytes += value.byteLength;
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode(); // flush any pending multi-byte sequence
	} finally {
		try {
			await reader.cancel();
		} catch {
			/* reader already closed */
		}
	}
	return { text, bytes, truncated };
}

export interface FetchArgs {
	url: string;
	method?: string;
	headers?: Record<string, unknown>;
	body?: string;
	maxBytes?: number;
	timeoutMs?: number;
	maxRedirects?: number;
}

export interface FetchResult {
	url: string;
	finalUrl: string;
	redirects: string[];
	status: number;
	ok: boolean;
	headers: Record<string, string>;
	contentType: string | null;
	truncated: boolean;
	bytes: number;
	body: string;
}

/** Perform a hardened, SSRF-guarded HTTP request and return a bounded body. */
export async function hardenedFetch(args: FetchArgs): Promise<FetchResult> {
	const urlStr = String(args.url ?? "").trim();
	if (!urlStr) throw new InternetError("INVALID_ARGUMENT", "url is required");

	const method = String(args.method ?? "GET").toUpperCase();
	if (!ALLOWED_METHODS.has(method)) {
		throw new InternetError("INVALID_ARGUMENT", `Unsupported HTTP method: ${method}`);
	}

	const maxBytes = clamp(args.maxBytes, 1, LIMITS.FETCH_MAX_BYTES, LIMITS.FETCH_DEFAULT_BYTES);
	const timeoutMs = clamp(args.timeoutMs, 1_000, 60_000, 30_000);
	const maxRedirects = clamp(args.maxRedirects, 0, 10, 5);

	const init: RequestInit = { method };
	if (args.headers && typeof args.headers === "object") {
		init.headers = Object.fromEntries(
			Object.entries(args.headers).map(([k, v]) => [k, String(v)]),
		);
	}
	if (args.body !== undefined && method !== "GET" && method !== "HEAD") {
		init.body = String(args.body);
	}

	const { response, finalUrl, redirects } = await safeFetch(urlStr, init, { maxRedirects, timeoutMs });

	const contentType = response.headers.get("content-type");
	let bodyText = "";
	let truncated = false;
	let bytes = 0;
	if (method !== "HEAD") {
		const read = await readBoundedText(response, maxBytes);
		bodyText = read.text;
		bytes = read.bytes;
		truncated = read.truncated;
	}

	return {
		url: urlStr,
		finalUrl,
		redirects,
		status: response.status,
		ok: response.ok,
		headers: Object.fromEntries(response.headers.entries()),
		contentType,
		truncated,
		bytes,
		body: bodyText,
	};
}

/** Fetch a page's raw text with SSRF protection; used by extract/links/markdown fallback. */
export async function fetchText(
	url: string,
	maxBytes: number,
	timeoutMs = 30_000,
): Promise<{ finalUrl: string; status: number; contentType: string | null; text: string; truncated: boolean }> {
	const { response, finalUrl } = await safeFetch(
		url,
		{ method: "GET", headers: { "User-Agent": "cf-control-mcp/1.6 (+https://github.com/nimazasinich/cf-control-mcp)" } },
		{ maxRedirects: 5, timeoutMs },
	);
	const contentType = response.headers.get("content-type");
	const { text, truncated } = await readBoundedText(response, maxBytes);
	return { finalUrl, status: response.status, contentType, text, truncated };
}
