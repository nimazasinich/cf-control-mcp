/**
 * Provider Gateway — shared types
 *
 * OpenAI-compatible /v1 API surface for Google Gemini via Cloudflare AI Gateway.
 */

// ---------------------------------------------------------------------------
// Env subset
// ---------------------------------------------------------------------------

export interface GatewayEnv {
	/** Cloudflare account ID (same var as MCP worker uses). */
	CLOUDFLARE_ACCOUNT_ID: string;
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
	 * Legacy escape hatch only: explicitly opt in ("true") to let the Worker
	 * call Google AI Studio directly with a locally-held key, bypassing AI
	 * Gateway BYOK entirely. Disabled by default because it contradicts the
	 * intended architecture (Google credential must live only in Cloudflare
	 * AI Gateway / Secrets Store, never in the Worker).
	 */
	ALLOW_DIRECT_PROVIDER_KEY?: string;
	/**
	 * Google AI Studio API key. Only consulted when
	 * ALLOW_DIRECT_PROVIDER_KEY === "true" for the legacy direct-call path.
	 * Under the standard BYOK architecture this should not be set at all.
	 */
	GOOGLE_AI_STUDIO_KEY?: string;
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
