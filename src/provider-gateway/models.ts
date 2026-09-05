/**
 * Provider Gateway — GET /v1/models
 *
 * Returns the list of Google Gemini models available through this gateway.
 * Model IDs use the plain Gemini names (no prefix); the cf-ai-gateway module
 * adds the google-ai-studio/ prefix before forwarding to the backend.
 */

import type { ModelListResponse } from "./types";
import { gatewayCorHeaders } from "./auth";

/** epoch timestamps are approximate release dates (rounded) */
const GEMINI_MODELS: ModelListResponse["data"] = [
	// Public routing aliases
	{ id: "fast", object: "model", created: 1745000000, owned_by: "system" },
	{ id: "coding", object: "model", created: 1739000000, owned_by: "system" },
	{ id: "research", object: "model", created: 1745000000, owned_by: "system" },
	// Gemini 3.8 family (Newest Flash)
	{ id: "gemini-3.8-flash", object: "model", created: 1745000000, owned_by: "google" },
	// Gemini 3.7 family (Previous Gen Flash)
	{ id: "gemini-3.7-flash", object: "model", created: 1745000000, owned_by: "google" },
	// Gemini 3.6 family (Balanced Flash)
	{ id: "gemini-3.6-flash", object: "model", created: 1739000000, owned_by: "google" },
	// Gemini 3.5 family (Legacy Baseline)
	{ id: "gemini-3.5-flash", object: "model", created: 1739000000, owned_by: "google" },
];

/**
 * Handle GET /v1/models.
 * Returns an OpenAI-compatible model list.
 */
export function handleModels(): Response {
	const body: ModelListResponse = {
		object: "list",
		data: GEMINI_MODELS,
	};
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
	});
}
