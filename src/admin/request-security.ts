/**
 * Browser request security helpers for the Admin control plane.
 *
 * Admin sessions use cookies, so every state-changing browser request must be
 * same-origin independently of SameSite cookie behavior. We intentionally do
 * not trust X-Forwarded-* headers for this decision; the canonical origin is
 * the Request URL seen by the Worker.
 */

export interface SameOriginCheck {
	ok: boolean;
	source: "origin" | "referer" | "missing" | "invalid";
}

function originOf(value: string): string | null {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

export function checkAdminSameOrigin(request: Request): SameOriginCheck {
	const expected = new URL(request.url).origin;
	const origin = request.headers.get("Origin");
	if (origin) {
		const parsed = originOf(origin);
		return { ok: parsed === expected, source: parsed ? "origin" : "invalid" };
	}

	const referer = request.headers.get("Referer");
	if (referer) {
		const parsed = originOf(referer);
		return { ok: parsed === expected, source: parsed ? "referer" : "invalid" };
	}

	return { ok: false, source: "missing" };
}

export function isAdminMutationMethod(method: string): boolean {
	return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}
