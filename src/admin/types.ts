/**
 * Admin Console — shared types.
 *
 * Provider metadata is intentionally safe to return to the Admin UI. Raw
 * provider credentials never live in D1 and are never returned by these
 * shapes; BYOK values live in Cloudflare Secrets Store / AI Gateway.
 */

export type ProviderTransport =
	| "gateway-native"
	| "gateway-custom"
	| "cloudflare-rest"
	| "workers-ai-binding";

export type ProviderAuthType =
	| "byok"
	| "cloudflare-unified"
	| "cloudflare-binding"
	| "none";

export interface AdminEnv {
	/** D1 binding — metadata only, never raw credentials. */
	DM_DB: D1Database;
	/** Optional Workers AI binding. This is an account-scoped binding, not a provider API key. */
	AI?: Ai;
	/** Owner secret. Reused as the admin login password and HMAC session key. */
	MCP_AUTH_TOKEN: string;
	/** Cloudflare account-scoped API token, used server-side only (never sent to browser). */
	CLOUDFLARE_API_TOKEN?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CF_AIG_GATEWAY_SLUG?: string;
	GATEWAY_AUTH_TOKEN?: string;
	CF_AIG_TOKEN?: string;
}

export type HealthState =
	| "HEALTHY"
	| "DEGRADED"
	| "AUTH_ERROR"
	| "RATE_LIMITED"
	| "DISABLED"
	| "NOT_CONFIGURED"
	| "CONFIGURED"
	| "REVOKED"
	| "UPSTREAM_ERROR";

export interface ProviderRow {
	id: string;
	display_name: string;
	kind: string;
	/** Cloudflare provider slug, e.g. openai, deepseek, google-ai-studio. */
	provider_slug: string;
	transport: ProviderTransport;
	auth_type: ProviderAuthType;
	/** Custom-provider root URL. Never contains a credential. */
	base_url: string | null;
	/** Path appended after the provider route for OpenAI-compatible custom providers. */
	api_path: string | null;
	/** Smallest numeric value is highest priority. */
	priority: number;
	/** 1 when a user-supplied provider credential is required for this profile. */
	credential_required: number;
	/** Cloudflare custom provider UUID when provisioned through the Admin API. */
	custom_provider_id: string | null;
	/** Model used by the explicit row-level connection test. */
	test_model: string | null;
	enabled: number;
	byok_alias: string | null;
	health_state: HealthState;
	last_success_at: string | null;
	last_error_at: string | null;
	last_error_message: string | null;
	last_latency_ms: number | null;
	last_http_status: number | null;
	last_gateway_log_id: string | null;
	last_gateway_step: string | null;
	last_cf_ray: string | null;
	created_at: string;
	updated_at: string;
}

export interface ModelRow {
	id: string;
	provider_id: string;
	public_alias: string | null;
	enabled: number;
	/** Informational: model is eligible for Cloudflare's current free allocation. */
	free_tier: number;
	/** Operator-facing label. Never used to resolve routing/callability — the immutable `id` is. */
	display_name: string | null;
	/** Operator-facing free-text note. Never used to resolve routing/callability. */
	description: string | null;
	created_at: string;
}

export interface RoutingRuleRow {
	public_alias: string;
	model_id: string;
	updated_at: string;
	/** Runtime-enriched: 1 if model is enabled, 0 if not, null if model missing */
	model_enabled?: number | null;
	/** Runtime-enriched: provider id for the target model */
	provider_id?: string | null;
	/** Runtime-enriched: 1 if provider is enabled */
	provider_enabled?: number | null;
}

export interface HealthCheckRow {
	id: number;
	provider_id: string;
	checked_at: string;
	state: HealthState;
	latency_ms: number | null;
	error_message: string | null;
	http_status?: number | null;
	gateway_log_id?: string | null;
	gateway_step?: string | null;
	cf_ray?: string | null;
	model_id?: string | null;
	correlation_id?: string | null;
}
