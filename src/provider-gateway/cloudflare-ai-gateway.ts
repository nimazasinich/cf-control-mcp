/**
 * Provider Gateway — Cloudflare AI Gateway / Google AI Studio backend
 *
 * Routes POST /v1/chat/completions to either:
 *   A) Cloudflare AI Gateway compat endpoint  (default — CF_AIG_GATEWAY_SLUG set)
 *      The Google AI Studio credential is stored ONCE in Cloudflare AI
 *      Gateway (BYOK, under the provider's `default` key alias, backed by
 *      Secrets Store). The Worker sends NO provider Authorization header —
 *      per Cloudflare's credential-precedence rules, omitting a provider key
 *      on the request lets AI Gateway resolve its own stored BYOK key. The
 *      Worker never sees, stores, or forwards the Google key in this mode.
 *   B) Direct Google AI Studio call (legacy, opt-in only via
 *      ALLOW_DIRECT_PROVIDER_KEY === "true"). This path does hold a raw
 *      GOOGLE_AI_STUDIO_KEY Worker secret and is disabled by default because
 *      it contradicts the intended BYOK architecture.
 *
 * The Cloudflare AI Gateway compat endpoint requires models to be prefixed
 * with their provider, e.g. "google-ai-studio/gemini-2.0-flash". The direct
 * Google AI Studio path accepts the plain name "gemini-2.0-flash".
 */

import type { ChatCompletionRequest, GatewayEnv } from "./types";
import { gatewayCorHeaders } from "./auth";
import { assertModelAvailable, ModelRegistryError, ModelUnavailableError } from "./models";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base URL for Google AI Studio OpenAI-compatible API */
const GOOGLE_AI_STUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Provider prefix required by the CF AI Gateway compat endpoint */
const GOOGLE_AI_STUDIO_PREFIX = "google-ai-studio";

// ---------------------------------------------------------------------------
// Model name normalisation & alias resolution
// ---------------------------------------------------------------------------

const DEFAULT_ALIASES: Record<string, string> = {
	fast: "gemini-3.6-flash",
	coding: "gemini-3.8-flash",
	research: "gemini-3.8-flash",
};

/**
 * Resolve client model name against dynamic routing rules in D1 (if available),
 * falling back to default aliases (fast, coding, research).
 */
export async function resolveModel(model: string, env: GatewayEnv): Promise<string> {
	const db = env.DM_DB || env.DB;
	if (db) {
		try {
			const rule = await db.prepare(
				"SELECT model_id FROM routing_rules WHERE public_alias = ?"
			).bind(model).first<{ model_id: string }>();
			if (rule?.model_id) {
				return rule.model_id;
			}
		} catch {
			// Preserve legacy alias fallback, but availability is still checked
			// fail-closed below before any upstream request is made.
		}
	}
	return DEFAULT_ALIASES[model] || model;
}

/**
 * Resolve an alias/model and enforce the live D1 enablement registry.
 *
 * This makes models.enabled (and provider.enabled) operational rather than
 * admin-only metadata. A disabled or unregistered model cannot be invoked by
 * using its raw model ID or by using a routing alias.
 */
export async function resolveAvailableModel(model: string, env: GatewayEnv): Promise<string> {
	const resolved = await resolveModel(model, env);
	await assertModelAvailable(resolved, env);
	return resolved;
}

/**
 * Normalise a client-supplied model name for the Cloudflare AI Gateway
 * compat endpoint. Always returns a name prefixed with "google-ai-studio/".
 *
 * Accepted input forms:
 *   "gemini-2.0-flash"               → "google-ai-studio/gemini-2.0-flash"
 *   "google/gemini-2.0-flash"        → "google-ai-studio/gemini-2.0-flash"
 *   "google-ai-studio/gemini-2.0-…"  → unchanged
 */
function normalizeModelForGateway(model: string): string {
	if (model.startsWith(`${GOOGLE_AI_STUDIO_PREFIX}/`)) return model;
	// Strip any other provider prefix the client may have added
	const bare = model.replace(/^google\//, "");
	return `${GOOGLE_AI_STUDIO_PREFIX}/${bare}`;
}

/**
 * Strip provider prefix for direct Google AI Studio calls.
 * "google-ai-studio/gemini-2.0-flash" → "gemini-2.0-flash"
 */
function normalizeModelForDirect(model: string): string {
	return model.replace(/^(google-ai-studio|google)\//, "");
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function gatewayError(message: string, type: string, status: number): Response {
	return new Response(
		JSON.stringify({ error: { message, type, code: type } }),
		{ status, headers: { "Content-Type": "application/json", ...gatewayCorHeaders() } },
	);
}

// ---------------------------------------------------------------------------
// CORS passthrough helper
// ---------------------------------------------------------------------------

/**
 * Clone the upstream response, stripping any upstream CORS headers and
 * injecting our own so the client always gets consistent CORS behaviour.
 */
function withCors(upstream: Response): Response {
	const headers = new Headers(upstream.headers);
	const cors = gatewayCorHeaders();
	for (const [k, v] of Object.entries(cors)) headers.set(k, v);
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers,
	});
}

// ---------------------------------------------------------------------------
// Backend A: Cloudflare AI Gateway compat endpoint
// ---------------------------------------------------------------------------

async function forwardViaGateway(
	body: ChatCompletionRequest,
	env: GatewayEnv,
): Promise<Response> {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const slug = env.CF_AIG_GATEWAY_SLUG!;

	const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${slug}/compat/chat/completions`;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	// Deliberately NOT setting a provider Authorization header here. Per
	// Cloudflare's AI Gateway credential precedence, a provider key present
	// on the request always wins over a stored BYOK key — omitting it is
	// what allows the gateway's own stored Google AI Studio credential
	// (Secrets Store, `default` alias) to be used server-side.

	// Authenticate Worker → AI Gateway. This is a Cloudflare-side token,
	// not the Google provider credential.
	headers["cf-aig-authorization"] = `Bearer ${env.CF_AIG_TOKEN!.trim()}`;

	const resolvedModel = await resolveAvailableModel(body.model, env);

	const upstream = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...body, model: normalizeModelForGateway(resolvedModel) }),
	});

	return withCors(upstream);
}

// ---------------------------------------------------------------------------
// Backend B: Direct Google AI Studio OpenAI-compatible API (LEGACY, opt-in)
//
// Only reachable when ALLOW_DIRECT_PROVIDER_KEY === "true". Holds a raw
// Google key inside the Worker, which is exactly what the BYOK architecture
// (Backend A) exists to avoid. Kept only for local dev / break-glass use.
// ---------------------------------------------------------------------------

async function forwardDirect(
	body: ChatCompletionRequest,
	env: GatewayEnv,
): Promise<Response> {
	const apiKey = env.GOOGLE_AI_STUDIO_KEY!;
	const url = `${GOOGLE_AI_STUDIO_BASE}/chat/completions`;

	const resolvedModel = await resolveAvailableModel(body.model, env);

	const upstream = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ ...body, model: normalizeModelForDirect(resolvedModel) }),
	});

	return withCors(upstream);
}

// ---------------------------------------------------------------------------
// Public: POST /v1/chat/completions
// ---------------------------------------------------------------------------

/**
 * Handle a chat completions request.
 *
 * Routing:
 *  - CF_AIG_GATEWAY_SLUG set → Cloudflare AI Gateway compat
 *  - CF_AIG_GATEWAY_SLUG absent → Google AI Studio direct
 *
 * Both paths support streaming (stream: true) transparently because the
 * upstream response body is passed through without buffering.
 */
export async function handleChatCompletions(request: Request, env: GatewayEnv): Promise<Response> {
	const gatewayConfigured = Boolean(env.CF_AIG_GATEWAY_SLUG?.trim() && env.CLOUDFLARE_ACCOUNT_ID?.trim());
	const legacyDirectEnabled = env.ALLOW_DIRECT_PROVIDER_KEY?.trim() === "true";

	// Guard: need EITHER a configured AI Gateway (BYOK, preferred) OR an
	// explicit legacy opt-in with a Google key present. We do NOT require
	// GOOGLE_AI_STUDIO_KEY when a gateway is configured — the credential
	// lives in Cloudflare AI Gateway / Secrets Store, not the Worker.
	if (!gatewayConfigured && !(legacyDirectEnabled && env.GOOGLE_AI_STUDIO_KEY?.trim())) {
		return gatewayError(
			"Provider gateway is not configured. Set CF_AIG_GATEWAY_SLUG (and CLOUDFLARE_ACCOUNT_ID) so the Worker can reach Cloudflare AI Gateway, and store the Google AI Studio credential there via BYOK. " +
			"(Legacy direct mode requires ALLOW_DIRECT_PROVIDER_KEY=true and a GOOGLE_AI_STUDIO_KEY secret, and is discouraged.)",
			"configuration_error",
			503,
		);
	}
	if (gatewayConfigured && !env.CF_AIG_TOKEN?.trim()) {
		return gatewayError(
			"CONFIG_ERROR: CF_AIG_TOKEN runtime token not configured for authenticated AI Gateway",
			"configuration_error",
			503,
		);
	}

	// Parse request body
	let body: ChatCompletionRequest;
	try {
		body = await request.json() as ChatCompletionRequest;
	} catch {
		return gatewayError("Request body is not valid JSON.", "invalid_request_error", 400);
	}

	if (!body.model || typeof body.model !== "string") {
		return gatewayError("Required field 'model' is missing or not a string.", "invalid_request_error", 400);
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		return gatewayError("Required field 'messages' must be a non-empty array.", "invalid_request_error", 400);
	}

	try {
		if (gatewayConfigured) {
			return await forwardViaGateway(body, env);
		}
		return await forwardDirect(body, env);
	} catch (err) {
		if (err instanceof ModelUnavailableError) {
			return gatewayError(err.message, "model_not_found", 404);
		}
		if (err instanceof ModelRegistryError) {
			return gatewayError(err.message, "configuration_error", 503);
		}
		const message = err instanceof Error ? err.message : String(err);
		return gatewayError(`Upstream request failed: ${message}`, "server_error", 502);
	}
}
