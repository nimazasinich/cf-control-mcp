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
}

export type HealthState =
	| "HEALTHY"
	| "DEGRADED"
	| "AUTH_ERROR"
	| "RATE_LIMITED"
	| "DISABLED"
	| "NOT_CONFIGURED"
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
