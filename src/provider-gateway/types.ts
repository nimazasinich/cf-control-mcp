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
	 * Google AI Studio API key — stored as a Worker secret.
	 * Never echoed to clients or logged.
	 */
	GOOGLE_AI_STUDIO_KEY?: string;
	/**
	 * Cloudflare AI Gateway gateway slug (e.g. "cf-control-mcp").
	 * When set, requests flow through the gateway for observability/caching.
	 * When absent, requests go directly to Google AI Studio.
	 */
	CF_AIG_GATEWAY_SLUG?: string;
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
