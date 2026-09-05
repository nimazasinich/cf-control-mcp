/**
 * Browser Layer — Cloudflare Browser Rendering (v1.6.0)
 * ---------------------------------------------------------------------------
 * Renders JavaScript-heavy PUBLIC pages via the Cloudflare Browser Rendering
 * REST API (/accounts/{id}/browser-rendering/*). Reuses the existing
 * CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID — no new secret. The token must
 * have the "Browser Rendering" permission; if it lacks it, the endpoint
 * returns an authorization error which we surface as RENDER_ERROR (the caller
 * treats missing capability as BLOCKED, never fabricated success).
 *
 * SSRF: every target is validated with assertSafeUrl before dispatch. This is
 * a public-web renderer, never an internal-network browser.
 */

import { assertSafeUrl } from "./ssrf";
import { InternetError } from "./types";
import { clamp, LIMITS } from "./util";

export interface BrowserEnv {
	CLOUDFLARE_API_TOKEN: string;
	CLOUDFLARE_ACCOUNT_ID: string;
}

const API_BASE = "https://api.cloudflare.com/client/v4";

function requireBrowserEnv(env: BrowserEnv): void {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
		throw new InternetError(
			"CONFIGURATION_ERROR",
			"Browser Rendering requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID Worker secrets",
		);
	}
}

/**
 * Call a Browser Rendering REST endpoint (content | markdown | links | scrape |
 * snapshot). Returns the parsed `result` on success. Maps auth/capability and
 * upstream failures to structured RENDER_ERROR.
 */
async function browserCall(
	env: BrowserEnv,
	endpoint: "content" | "markdown" | "links" | "scrape" | "snapshot",
	payload: Record<string, unknown>,
	timeoutMs: number,
): Promise<any> {
	requireBrowserEnv(env);
	const url = `${API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/${endpoint}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") {
			throw new InternetError("TIMEOUT", `Browser rendering timed out after ${timeoutMs}ms`);
		}
		throw new InternetError("RENDER_ERROR", `Browser rendering network error: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		clearTimeout(timer);
	}

	const contentType = res.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json") ? await res.json().catch(() => null) : await res.text();

	if (!res.ok || (body && typeof body === "object" && (body as any).success === false)) {
		const errs = body && typeof body === "object" ? (body as any).errors : undefined;
		const msg = errs ? JSON.stringify(errs) : typeof body === "string" ? body.slice(0, 300) : `HTTP ${res.status}`;
		if (res.status === 401 || res.status === 403) {
			throw new InternetError(
				"RENDER_ERROR",
				`Browser Rendering authorization failed (HTTP ${res.status}). The Cloudflare API token likely lacks the "Browser Rendering" permission.`,
			);
		}
		if (res.status === 429) {
			throw new InternetError("RATE_LIMITED", "Browser Rendering rate limit reached (HTTP 429)");
		}
		throw new InternetError("RENDER_ERROR", `Browser Rendering failed (HTTP ${res.status}): ${msg}`);
	}

	return body && typeof body === "object" && "result" in body ? (body as any).result : body;
}

export interface RenderOptions {
	waitUntil?: string;
	timeoutMs?: number;
}

/** Render a page and return its post-JS HTML content. */
export async function renderContent(env: BrowserEnv, url: string, options: RenderOptions = {}): Promise<{ url: string; html: string }> {
	assertSafeUrl(url);
	const timeout = clamp(options.timeoutMs, 1_000, LIMITS.RENDER_MAX_TIMEOUT_MS, LIMITS.RENDER_DEFAULT_TIMEOUT_MS);
	const gotoOptions: Record<string, unknown> = {};
	if (options.waitUntil) gotoOptions.waitUntil = options.waitUntil;
	const html = await browserCall(env, "content", { url, gotoOptions }, timeout);
	return { url, html: typeof html === "string" ? html : JSON.stringify(html) };
}

/** Render a page and return clean Markdown from Cloudflare's renderer. */
export async function renderMarkdown(env: BrowserEnv, url: string, options: RenderOptions = {}): Promise<{ url: string; markdown: string }> {
	assertSafeUrl(url);
	const timeout = clamp(options.timeoutMs, 1_000, LIMITS.RENDER_MAX_TIMEOUT_MS, LIMITS.RENDER_DEFAULT_TIMEOUT_MS);
	const md = await browserCall(env, "markdown", { url }, timeout);
	return { url, markdown: typeof md === "string" ? md : JSON.stringify(md) };
}

/** Render a page and return its outbound links (rendered DOM). */
export async function renderLinks(env: BrowserEnv, url: string, options: RenderOptions = {}): Promise<string[]> {
	assertSafeUrl(url);
	const timeout = clamp(options.timeoutMs, 1_000, LIMITS.RENDER_MAX_TIMEOUT_MS, LIMITS.RENDER_DEFAULT_TIMEOUT_MS);
	const links = await browserCall(env, "links", { url }, timeout);
	return Array.isArray(links) ? links.map((l) => String(l)) : [];
}

/**
 * Scrape structured elements by CSS selector using Cloudflare's /scrape.
 * Returns per-selector matched results as provided by the renderer.
 */
export async function renderScrape(
	env: BrowserEnv,
	url: string,
	selectors: string[],
	options: RenderOptions = {},
): Promise<any> {
	assertSafeUrl(url);
	const timeout = clamp(options.timeoutMs, 1_000, LIMITS.RENDER_MAX_TIMEOUT_MS, LIMITS.RENDER_DEFAULT_TIMEOUT_MS);
	const elements = selectors.map((selector) => ({ selector }));
	return browserCall(env, "scrape", { url, elements }, timeout);
}
