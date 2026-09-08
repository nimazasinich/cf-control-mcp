/**
 * Serves the approved 1368x753 Admin documents.
 *
 * INVARIANT: the markup, CSS, and inline script of every served page are the
 * approved reference document, byte for byte. The only thing this module adds
 * is a single <script> block inserted immediately before </body>, which wires
 * the page's own integration hooks to the Admin API. Remove that block and the
 * response is the approved file again, verbatim — see
 * test/approved-pages-byte-identity.test.ts.
 */
import { APPROVED_PAGES } from "./index";
import { adapterScript } from "./adapter";

/** Route path -> approved page name. */
export const ROUTE_PAGES: Record<string, string> = {
	"/admin": "overview",
	"/admin/": "overview",
	"/admin/overview": "overview",
	"/admin/providers": "providers",
	"/admin/models": "models",
	"/admin/tools": "tools",
	"/admin/mcp-tools": "tools",
	"/admin/routing": "routing",
	"/admin/health": "health",
	"/admin/usage": "usage",
	"/admin/audit": "audit",
	"/admin/settings": "settings",
};

/** The approved page name for a request path, or null when unmapped. */
export function pageForPath(path: string): string | null {
	return ROUTE_PAGES[path] ?? null;
}

/**
 * The approved document for a page, with the additive backend adapter
 * appended before </body>. `usage` reuses the approved overview shell,
 * so it inherits the same nav, chrome, and design tokens.
 */
export function adminPageHtml(page: string): string {
	const source = page === "usage" ? "overview" : page;
	const approved = APPROVED_PAGES[source];
	if (!approved) throw new Error(`unknown approved page: ${page}`);
	return injectBeforeBodyClose(approved.html, adapterScript(page));
}

/** The approved login document, wired to POST /admin/login. */
export function adminLoginHtml(): string {
	return injectBeforeBodyClose(APPROVED_PAGES.login.html, adapterScript("login"));
}

/** The approved loading document, wired to the real session probe. */
export function adminLoadingHtml(): string {
	return injectBeforeBodyClose(APPROVED_PAGES.loading.html, adapterScript("loading"));
}

/** The unmodified approved document for a page, with no adapter appended. */
export function approvedPageHtml(page: string): string {
	const approved = APPROVED_PAGES[page];
	if (!approved) throw new Error(`unknown approved page: ${page}`);
	return approved.html;
}

function injectBeforeBodyClose(html: string, block: string): string {
	if (!block) return html;
	const index = html.lastIndexOf("</body>");
	if (index === -1) return html + block;
	return html.slice(0, index) + block + html.slice(index);
}

/** Standard HTML response headers for an owner-only Admin page. */
export function htmlHeaders(): HeadersInit {
	return {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "same-origin",
	};
}

export function htmlResponse(html: string, status = 200): Response {
	return new Response(html, { status, headers: htmlHeaders() });
}
