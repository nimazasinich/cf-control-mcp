/**
 * Provider Gateway — authentication
 *
 * /v1/* routes use a separate GATEWAY_AUTH_TOKEN, distinct from MCP_AUTH_TOKEN.
 * This token is NEVER forwarded to Google or any upstream provider.
 */

import type { GatewayEnv } from "./types";

/**
 * Validate the GATEWAY_AUTH_TOKEN from the Authorization header.
 *
 * Accepts: `Authorization: Bearer <token>`
 * Returns true only when env.GATEWAY_AUTH_TOKEN is configured AND the token
 * matches (constant-time comparison via Web Crypto to resist timing attacks).
 */
export async function authenticateGateway(request: Request, env: GatewayEnv): Promise<boolean> {
	const token = env.GATEWAY_AUTH_TOKEN?.trim();
	if (!token) return false; // gateway disabled when secret not configured

	const auth = request.headers.get("Authorization") ?? "";
	const provided = auth.replace(/^Bearer\s+/i, "").trim();
	if (!provided) return false;

	// Constant-time comparison using HMAC trick (no timing side-channel)
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode("gateway-auth-comparison"),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const [sigA, sigB] = await Promise.all([
		crypto.subtle.sign("HMAC", key, enc.encode(provided)),
		crypto.subtle.sign("HMAC", key, enc.encode(token)),
	]);
	const a = new Uint8Array(sigA);
	const b = new Uint8Array(sigB);
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** Response returned when authentication fails. */
export function gatewayUnauthorized(): Response {
	const body: import("./types").GatewayErrorBody = {
		error: {
			message: "Invalid or missing GATEWAY_AUTH_TOKEN. Provide: Authorization: Bearer <token>",
			type: "authentication_error",
			code: "invalid_api_key",
		},
	};
	return new Response(JSON.stringify(body), {
		status: 401,
		headers: {
			"Content-Type": "application/json",
			"WWW-Authenticate": "Bearer",
			...gatewayCorHeaders(),
		},
	});
}

/** Response when the gateway feature is not yet configured. */
export function gatewayUnconfigured(): Response {
	const body: import("./types").GatewayErrorBody = {
		error: {
			message: "Provider gateway is not configured. Set the GATEWAY_AUTH_TOKEN Worker secret to enable client access to /v1/*.",
			type: "server_error",
			code: "gateway_not_configured",
		},
	};
	return new Response(JSON.stringify(body), {
		status: 503,
		headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
	});
}

/** Minimal CORS headers for /v1/* responses. */
export function gatewayCorHeaders(): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	};
}
