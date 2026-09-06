/**
 * v1.8 Admin Console — shared types.
 */

export interface AdminEnv {
	/** D1 binding — metadata only, never raw credentials. */
	DM_DB: D1Database;
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
	enabled: number;
	byok_alias: string | null;
	health_state: HealthState;
	last_success_at: string | null;
	last_error_at: string | null;
	last_error_message: string | null;
	last_latency_ms: number | null;
	created_at: string;
	updated_at: string;
}

export interface ModelRow {
	id: string;
	provider_id: string;
	public_alias: string | null;
	enabled: number;
	created_at: string;
}

export interface RoutingRuleRow {
	public_alias: string;
	model_id: string;
	updated_at: string;
}

export interface HealthCheckRow {
	id: number;
	provider_id: string;
	checked_at: string;
	state: HealthState;
	latency_ms: number | null;
	error_message: string | null;
}

