/**
 * Provider Gateway — router
 *
 * Entry point called by oauth-worker.ts for any request whose pathname
 * starts with /v1/.
 *
 * Auth:      GATEWAY_AUTH_TOKEN  (never MCP_AUTH_TOKEN)
 * Routes:
 *   GET  /v1/models                → list of available Gemini models
 *   POST /v1/chat/completions      → proxy to Google AI Studio via CF AI Gateway
 *
 * Authentication is NOT required for:
 *   OPTIONS /v1/*                  → CORS preflight
 *
 * Any other /v1/* path → 404 in OpenAI error format.
 */

import type { GatewayEnv } from "./types";
import { authenticateGateway, gatewayCorHeaders, gatewayUnauthorized, gatewayUnconfigured } from "./auth";
import { handleModels } from "./models";
import { handleChatCompletions } from "./cloudflare-ai-gateway";

/**
 * Handle any request whose pathname starts with /v1/.
 *
 * @returns A Response (always — never null).
 */
export async function handleProviderGateway(
	request: Request,
	env: GatewayEnv,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	// CORS preflight — no auth required
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: gatewayCorHeaders(),
		});
	}

	// Gateway is effectively disabled unless GATEWAY_AUTH_TOKEN is configured.
	// Return a helpful error rather than a silent 401.
	if (!env.GATEWAY_AUTH_TOKEN?.trim()) {
		return gatewayUnconfigured();
	}

	// Authenticate all non-OPTIONS requests
	if (!(await authenticateGateway(request, env))) {
		return gatewayUnauthorized();
	}

	// -------------------------------------------------------------------------
	// Route dispatch
	// -------------------------------------------------------------------------

	if (path === "/v1/models" && request.method === "GET") {
		return handleModels();
	}

	if (path === "/v1/chat/completions" && request.method === "POST") {
		return handleChatCompletions(request, env);
	}

	// Unknown /v1/* path
	return new Response(
		JSON.stringify({
			error: {
				message: `Unknown provider gateway path: ${path}. Available: GET /v1/models, POST /v1/chat/completions`,
				type: "invalid_request_error",
				code: "not_found",
			},
		}),
		{
			status: 404,
			headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
		},
	);
}
