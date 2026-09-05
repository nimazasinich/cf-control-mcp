/**
 * Provider Gateway — Cloudflare AI Gateway / Google AI Studio backend
 *
 * Routes POST /v1/chat/completions to either:
 *   A) Cloudflare AI Gateway compat endpoint  (if CF_AIG_GATEWAY_SLUG is set)
 *   B) Google AI Studio OpenAI-compatible API  (direct fallback)
 *
 * In both cases the GOOGLE_AI_STUDIO_KEY is in the Authorization header that
 * we send upstream — it is NEVER returned to the client.
 *
 * The Cloudflare AI Gateway compat endpoint requires models to be prefixed
 * with their provider, e.g. "google-ai-studio/gemini-2.0-flash". The direct
 * Google AI Studio path accepts the plain name "gemini-2.0-flash".
 */

import type { ChatCompletionRequest, GatewayEnv } from "./types";
import { gatewayCorHeaders } from "./auth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base URL for Google AI Studio OpenAI-compatible API */
const GOOGLE_AI_STUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Provider prefix required by the CF AI Gateway compat endpoint */
const GOOGLE_AI_STUDIO_PREFIX = "google-ai-studio";

// ---------------------------------------------------------------------------
// Model name normalisation
// ---------------------------------------------------------------------------

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
	const apiKey = env.GOOGLE_AI_STUDIO_KEY!;

	const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${slug}/compat/chat/completions`;

	const upstream = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ ...body, model: normalizeModelForGateway(body.model) }),
	});

	return withCors(upstream);
}

// ---------------------------------------------------------------------------
// Backend B: Direct Google AI Studio OpenAI-compatible API
// ---------------------------------------------------------------------------

async function forwardDirect(
	body: ChatCompletionRequest,
	env: GatewayEnv,
): Promise<Response> {
	const apiKey = env.GOOGLE_AI_STUDIO_KEY!;
	const url = `${GOOGLE_AI_STUDIO_BASE}/chat/completions`;

	const upstream = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ ...body, model: normalizeModelForDirect(body.model) }),
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
	// Guard: Google key must be present
	if (!env.GOOGLE_AI_STUDIO_KEY?.trim()) {
		return gatewayError(
			"GOOGLE_AI_STUDIO_KEY Worker secret is not configured.",
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
		if (env.CF_AIG_GATEWAY_SLUG?.trim()) {
			return await forwardViaGateway(body, env);
		}
		return await forwardDirect(body, env);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return gatewayError(`Upstream request failed: ${message}`, "server_error", 502);
	}
}
