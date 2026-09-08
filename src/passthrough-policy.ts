export type PassthroughProvider = "cloudflare" | "huggingface";

export interface NormalizedPassthroughRequest {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
}

export interface PassthroughPolicyDecision extends NormalizedPassthroughRequest {
	allowed: boolean;
	reason?: string;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const HEX_ESCAPE = /%[0-9a-fA-F]{2}/;

export function normalizePassthroughRequest(methodValue: unknown, pathValue: unknown): NormalizedPassthroughRequest {
	const method = String(methodValue ?? "GET").trim().toUpperCase();
	if (!METHODS.has(method)) throw new Error("passthrough_method_not_allowed");

	let raw = String(pathValue ?? "").trim();
	if (!raw) throw new Error("passthrough_path_required");
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error("passthrough_path_must_be_relative");
	if (/[\\\u0000-\u001f\u007f]/.test(raw)) throw new Error("passthrough_path_contains_invalid_characters");
	if (!raw.startsWith("/")) raw = `/${raw}`;

	const question = raw.indexOf("?");
	const rawPathname = question >= 0 ? raw.slice(0, question) : raw;
	let decoded: string;
	try {
		decoded = decodeURIComponent(rawPathname);
	} catch {
		throw new Error("passthrough_path_invalid_encoding");
	}
	if (HEX_ESCAPE.test(decoded)) throw new Error("passthrough_path_double_encoding_rejected");
	if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
		throw new Error("passthrough_path_traversal_rejected");
	}
	const normalizedPath = decoded.replace(/\/{2,}/g, "/");
	return { method: method as NormalizedPassthroughRequest["method"], path: normalizedPath || "/" };
}

function deniedCloudflare(path: string): string | null {
	const lower = path.toLowerCase();
	if (/^\/user\/tokens(?:\/|$)/.test(lower)) return "cloudflare_token_management_denied";
	if (/^\/accounts\/[^/]+\/(?:members|memberships|subscriptions|billing)(?:\/|$)/.test(lower)) return "cloudflare_account_ownership_or_billing_denied";
	if (/^\/memberships(?:\/|$)/.test(lower)) return "cloudflare_membership_management_denied";
	return null;
}

function deniedHuggingFace(path: string): string | null {
	const lower = path.toLowerCase();
	if (/^\/api\/(?:billing|settings\/tokens|tokens)(?:\/|$)/.test(lower)) return "huggingface_token_or_billing_management_denied";
	return null;
}

export function evaluatePassthroughPolicy(input: {
	provider: PassthroughProvider;
	method: unknown;
	path: unknown;
}): PassthroughPolicyDecision {
	const normalized = normalizePassthroughRequest(input.method, input.path);
	const reason = input.provider === "cloudflare" ? deniedCloudflare(normalized.path) : deniedHuggingFace(normalized.path);
	return reason ? { ...normalized, allowed: false, reason } : { ...normalized, allowed: true };
}
