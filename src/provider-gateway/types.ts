/**
 * Provider Gateway — shared types
 *
 * OpenAI-compatible /v1 API surface for Google Gemini via Cloudflare AI Gateway.
 */

// ---------------------------------------------------------------------------
// Env subset
// ---------------------------------------------------------------------------

export interface GatewayEnv {
	/** Optional Workers AI binding for provider-token-free inference through AI Gateway. */
	AI?: Ai;
	/** Server-side Cloudflare API token used by the 2026 AI REST API / Unified Billing. */
	CLOUDFLARE_API_TOKEN?: string;
	/** Cloudflare account ID (same var as MCP worker uses). */
	CLOUDFLARE_ACCOUNT_ID?: string;
	/**
	 * Bearer token that clients must supply to access /v1/*.
	 * Completely separate from MCP_AUTH_TOKEN — never forwarded to Google.
	 */
	GATEWAY_AUTH_TOKEN?: string;
	/**
	 * Cloudflare AI Gateway gateway slug (e.g. "cf-control-mcp").
	 * This is the primary/intended mode: the Google AI Studio credential is
	 * stored ONCE in Cloudflare AI Gateway (BYOK, backed by Secrets Store)
	 * under the provider's `default` key alias. The Worker never receives or
	 * forwards the Google key — it just calls the gateway compat endpoint and
	 * Cloudflare resolves the stored credential server-side.
	 */
	CF_AIG_GATEWAY_SLUG?: string;
	/**
	 * Optional AI Gateway auth token (cf-aig-authorization). Only needed if
	 * the gateway itself is configured as an "authenticated gateway" in
	 * Cloudflare. This authenticates the Worker → AI Gateway hop and is a
	 * Cloudflare-side credential — it is NOT the Google provider key and is
	 * never forwarded to Google.
	 */
	CF_AIG_TOKEN?: string;

	/**
	 * Optional D1 database binding for dynamic routing rules.
	 */
	DM_DB?: D1Database;
	DB?: D1Database;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible request shapes (subset we care about)
// ---------------------------------------------------------------------------

export interface ContentPartText {
	type: "text";
	text: string;
}

export interface ContentPartImage {
	type: "image_url";
	image_url: { url: string; detail?: string };
}

export type ContentPart = ContentPartText | ContentPartImage;

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | ContentPart[] | null;
	name?: string;
	tool_call_id?: string;
}

export interface ChatCompletionRequest {
	model: string;
	messages: ChatMessage[];
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	n?: number;
	stop?: string | string[];
	presence_penalty?: number;
	frequency_penalty?: number;
	user?: string;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible response shapes
// ---------------------------------------------------------------------------

export interface ModelObject {
	id: string;
	object: "model";
	created: number;
	owned_by: string;
	/** DreamWorker extension metadata; omitted by the local static fallback. */
	enabled?: boolean;
	configured?: boolean;
	gateway_verified?: boolean;
	callable?: boolean;
}

export interface ModelListResponse {
	object: "list";
	data: ModelObject[];
}

export interface GatewayErrorBody {
	error: {
		message: string;
		type: string;
		param?: string | null;
		code?: string | null;
	};
}
