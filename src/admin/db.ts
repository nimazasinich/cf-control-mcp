/**
 * v1.8 Admin Console — D1 metadata access. Never reads/writes raw credentials.
 */
import type { AdminEnv, ProviderRow } from "./types";

export async function listProviders(env: AdminEnv): Promise<ProviderRow[]> {
	const { results } = await env.DM_DB.prepare("SELECT * FROM providers ORDER BY id").all<ProviderRow>();
	return results ?? [];
}

export async function getProvider(env: AdminEnv, id: string): Promise<ProviderRow | null> {
	return env.DM_DB.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first<ProviderRow>();
}

export async function setProviderEnabled(env: AdminEnv, id: string, enabled: boolean): Promise<void> {
	await env.DM_DB.prepare("UPDATE providers SET enabled = ?, updated_at = datetime('now') WHERE id = ?")
		.bind(enabled ? 1 : 0, id)
		.run();
}

export async function setProviderAlias(env: AdminEnv, id: string, alias: string | null): Promise<void> {
	await env.DM_DB.prepare("UPDATE providers SET byok_alias = ?, updated_at = datetime('now') WHERE id = ?")
		.bind(alias, id)
		.run();
}

export async function recordHealthResult(
	env: AdminEnv,
	id: string,
	state: string,
	latencyMs: number | null,
	errorMessage: string | null,
): Promise<void> {
	const now = "datetime('now')";
	if (errorMessage) {
		await env.DM_DB.prepare(
			`UPDATE providers SET health_state = ?, last_error_at = ${now}, last_error_message = ?, last_latency_ms = ?, updated_at = ${now} WHERE id = ?`,
		).bind(state, errorMessage, latencyMs, id).run();
	} else {
		await env.DM_DB.prepare(
			`UPDATE providers SET health_state = ?, last_success_at = ${now}, last_error_message = NULL, last_latency_ms = ?, updated_at = ${now} WHERE id = ?`,
		).bind(state, latencyMs, id).run();
	}
	await env.DM_DB.prepare(
		"INSERT INTO health_checks (provider_id, state, latency_ms, error_message) VALUES (?, ?, ?, ?)",
	).bind(id, state, latencyMs, errorMessage).run();
}

export async function logAudit(env: AdminEnv, action: string, target: string | null, detail: string | null): Promise<void> {
	await env.DM_DB.prepare("INSERT INTO audit_events (action, target, detail) VALUES (?, ?, ?)")
		.bind(action, target, detail)
		.run();
}

export async function recentAudit(env: AdminEnv, limit = 50) {
	const { results } = await env.DM_DB.prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?").bind(limit).all();
	return results ?? [];
}
