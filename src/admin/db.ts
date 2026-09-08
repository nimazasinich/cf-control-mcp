/**
 * Admin Control Plane — D1 metadata access.
 * Raw credentials are never read from or written to D1.
 */
import type {
	AdminEnv,
	ProviderRow,
	ModelRow,
	RoutingRuleRow,
	HealthCheckRow,
	ProviderAuthType,
	ProviderTransport,
} from "./types";

export interface CreateProviderInput {
	id: string;
	displayName: string;
	kind: string;
	providerSlug: string;
	transport: ProviderTransport;
	authType: ProviderAuthType;
	baseUrl?: string | null;
	apiPath?: string | null;
	priority?: number;
	credentialRequired: boolean;
	customProviderId?: string | null;
	testModel?: string | null;
	enabled?: boolean;
}

export interface ProviderHealthEvidence {
	httpStatus?: number | null;
	gatewayLogId?: string | null;
	gatewayStep?: string | null;
	cfRay?: string | null;
	modelId?: string | null;
	correlationId?: string | null;
}

export async function listProviders(env: AdminEnv): Promise<ProviderRow[]> {
	const { results } = await env.DM_DB.prepare("SELECT * FROM providers ORDER BY id").all<ProviderRow>();
	return (results ?? []).slice().sort((a, b) => {
		const ap = Number.isFinite(a.priority) ? a.priority : 100;
		const bp = Number.isFinite(b.priority) ? b.priority : 100;
		return ap - bp || a.id.localeCompare(b.id);
	});
}

export async function listModels(env: AdminEnv): Promise<ModelRow[]> {
	const { results } = await env.DM_DB.prepare("SELECT * FROM models ORDER BY id").all<ModelRow>();
	return (results ?? []).slice().sort((a, b) => a.provider_id.localeCompare(b.provider_id) || a.id.localeCompare(b.id));
}

export async function listModelsForProvider(env: AdminEnv, providerId: string): Promise<ModelRow[]> {
	const { results } = await env.DM_DB.prepare("SELECT * FROM models WHERE provider_id = ? ORDER BY id").bind(providerId).all<ModelRow>();
	return results ?? [];
}

export async function listRoutingRules(env: AdminEnv): Promise<RoutingRuleRow[]> {
	const { results } = await env.DM_DB.prepare("SELECT * FROM routing_rules ORDER BY public_alias").all<RoutingRuleRow>();
	return results ?? [];
}

export async function listRecentHealthChecks(env: AdminEnv, limit = 20): Promise<HealthCheckRow[]> {
	const { results } = await env.DM_DB.prepare("SELECT * FROM health_checks ORDER BY id DESC LIMIT ?").bind(limit).all<HealthCheckRow>();
	return results ?? [];
}

export async function getProvider(env: AdminEnv, id: string): Promise<ProviderRow | null> {
	return env.DM_DB.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first<ProviderRow>();
}

export async function getModel(env: AdminEnv, id: string): Promise<ModelRow | null> {
	return env.DM_DB.prepare("SELECT * FROM models WHERE id = ?").bind(id).first<ModelRow>();
}

export async function getModelByPublicAlias(env: AdminEnv, alias: string): Promise<ModelRow | null> {
	return env.DM_DB.prepare("SELECT * FROM models WHERE public_alias = ?").bind(alias).first<ModelRow>();
}

export async function getRoutingRule(env: AdminEnv, alias: string): Promise<RoutingRuleRow | null> {
	return env.DM_DB.prepare("SELECT * FROM routing_rules WHERE public_alias = ?").bind(alias).first<RoutingRuleRow>();
}

export async function createProvider(env: AdminEnv, input: CreateProviderInput): Promise<ProviderRow> {
	const existing = await getProvider(env, input.id);
	if (existing) throw new Error("provider_already_exists");
	await env.DM_DB.prepare(
		`INSERT INTO providers
		(id, display_name, kind, provider_slug, transport, auth_type, base_url, api_path, priority,
		 credential_required, custom_provider_id, test_model, enabled, health_state)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).bind(
		input.id,
		input.displayName,
		input.kind,
		input.providerSlug,
		input.transport,
		input.authType,
		input.baseUrl ?? null,
		input.apiPath ?? null,
		input.priority ?? 100,
		input.credentialRequired ? 1 : 0,
		input.customProviderId ?? null,
		input.testModel ?? null,
		input.enabled ? 1 : 0,
		input.credentialRequired ? "NOT_CONFIGURED" : "CONFIGURED",
	).run();
	const created = await getProvider(env, input.id);
	if (!created) throw new Error("provider_create_not_persisted");
	return created;
}

export async function deleteProviderLocalState(
	env: AdminEnv,
	id: string,
	force = false,
): Promise<{ deleted: boolean; modelCount: number; routingRuleCount: number }> {
	const provider = await getProvider(env, id);
	if (!provider) return { deleted: false, modelCount: 0, routingRuleCount: 0 };
	const models = await listModelsForProvider(env, id);
	const modelIds = models.map((model) => model.id);
	let routingRuleCount = 0;
	if (modelIds.length > 0) {
		const placeholders = modelIds.map(() => "?").join(",");
		const row = await env.DM_DB.prepare(
			`SELECT COUNT(*) AS count FROM routing_rules WHERE model_id IN (${placeholders})`,
		).bind(...modelIds).first<{ count: number }>();
		routingRuleCount = Number(row?.count ?? 0);
	}
	if (!force && (models.length > 0 || routingRuleCount > 0)) {
		throw new Error("provider_has_dependencies");
	}

	const statements: D1PreparedStatement[] = [];
	if (modelIds.length > 0) {
		const placeholders = modelIds.map(() => "?").join(",");
		statements.push(env.DM_DB.prepare(
			`DELETE FROM routing_rules WHERE model_id IN (${placeholders})`,
		).bind(...modelIds));
	}
	statements.push(env.DM_DB.prepare("DELETE FROM models WHERE provider_id = ?").bind(id));
	statements.push(env.DM_DB.prepare("DELETE FROM providers WHERE id = ?").bind(id));
	await env.DM_DB.batch(statements);
	return { deleted: true, modelCount: models.length, routingRuleCount };
}

export async function setProviderCustomId(env: AdminEnv, id: string, customProviderId: string | null): Promise<void> {
	await env.DM_DB.prepare("UPDATE providers SET custom_provider_id = ?, updated_at = datetime('now') WHERE id = ?")
		.bind(customProviderId, id).run();
}

export async function createModel(
	env: AdminEnv,
	input: {
		id: string;
		providerId: string;
		enabled?: boolean;
		freeTier?: boolean;
		publicAlias?: string | null;
		displayName?: string | null;
		description?: string | null;
	},
): Promise<ModelRow> {
	if (await getModel(env, input.id)) throw new Error("model_already_exists");
	const provider = await getProvider(env, input.providerId);
	if (!provider) throw new Error("provider_not_found");
	if (input.freeTier && provider.auth_type !== "cloudflare-binding") {
		throw new Error("free_tier_requires_provider_token_free_binding");
	}
	await env.DM_DB.prepare(
		"INSERT INTO models (id, provider_id, public_alias, enabled, free_tier, display_name, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
	).bind(
		input.id,
		input.providerId,
		input.publicAlias ?? null,
		input.enabled === false ? 0 : 1,
		input.freeTier ? 1 : 0,
		input.displayName ?? null,
		input.description ?? null,
	).run();
	const created = await getModel(env, input.id);
	if (!created) throw new Error("model_create_not_persisted");
	return created;
}

export const MODEL_DISPLAY_NAME_MAX_LENGTH = 120;
export const MODEL_DESCRIPTION_MAX_LENGTH = 1000;

export async function setModelMetadata(
	env: AdminEnv,
	id: string,
	patch: { displayName?: string | null; description?: string | null },
): Promise<ModelRow | null> {
	const existing = await getModel(env, id);
	if (!existing) return null;
	const nextDisplayName = patch.displayName === undefined ? existing.display_name : patch.displayName;
	const nextDescription = patch.description === undefined ? existing.description : patch.description;
	await env.DM_DB.prepare("UPDATE models SET display_name = ?, description = ? WHERE id = ?")
		.bind(nextDisplayName, nextDescription, id)
		.run();
	const updated = await getModel(env, id);
	if (!updated || updated.display_name !== nextDisplayName || updated.description !== nextDescription) {
		throw new Error("model_metadata_update_not_persisted");
	}
	return updated;
}

export async function setProviderEnabled(env: AdminEnv, id: string, enabled: boolean): Promise<ProviderRow | null> {
	const existing = await getProvider(env, id);
	if (!existing) return null;
	await env.DM_DB.prepare("UPDATE providers SET enabled = ?, updated_at = datetime('now') WHERE id = ?")
		.bind(enabled ? 1 : 0, id)
		.run();
	const updated = await getProvider(env, id);
	if (!updated || updated.enabled !== (enabled ? 1 : 0)) throw new Error("provider_update_not_persisted");
	return updated;
}

export async function updateProviderMetadata(
	env: AdminEnv,
	id: string,
	patch: Partial<Pick<ProviderRow, "display_name" | "provider_slug" | "transport" | "auth_type" | "base_url" | "api_path" | "credential_required" | "test_model">>,
): Promise<ProviderRow | null> {
	const existing = await getProvider(env, id);
	if (!existing) return null;
	const next = {
		display_name: patch.display_name ?? existing.display_name,
		provider_slug: patch.provider_slug ?? existing.provider_slug,
		transport: patch.transport ?? existing.transport,
		auth_type: patch.auth_type ?? existing.auth_type,
		base_url: patch.base_url === undefined ? existing.base_url : patch.base_url,
		api_path: patch.api_path === undefined ? existing.api_path : patch.api_path,
		credential_required: patch.credential_required ?? existing.credential_required,
		test_model: patch.test_model === undefined ? existing.test_model : patch.test_model,
	};
	await env.DM_DB.prepare(
		`UPDATE providers SET display_name=?, provider_slug=?, transport=?, auth_type=?, base_url=?, api_path=?,
		 credential_required=?, test_model=?, updated_at=datetime('now') WHERE id=?`
	).bind(next.display_name, next.provider_slug, next.transport, next.auth_type, next.base_url, next.api_path,
		next.credential_required, next.test_model, id).run();
	return getProvider(env, id);
}

export async function moveProviderPriority(env: AdminEnv, id: string, direction: "up" | "down"): Promise<ProviderRow[]> {
	const ordered = await listProviders(env);
	const index = ordered.findIndex((p) => p.id === id);
	if (index < 0) throw new Error("provider_not_found");
	const otherIndex = direction === "up" ? index - 1 : index + 1;
	if (otherIndex < 0 || otherIndex >= ordered.length) return ordered;
	const current = ordered[index];
	const other = ordered[otherIndex];
	if (current.priority !== other.priority) {
		await env.DM_DB.batch([
			env.DM_DB.prepare("UPDATE providers SET priority=?, updated_at=datetime('now') WHERE id=?").bind(other.priority, current.id),
			env.DM_DB.prepare("UPDATE providers SET priority=?, updated_at=datetime('now') WHERE id=?").bind(current.priority, other.id),
		]);
	} else {
		const reordered = ordered.slice();
		reordered.splice(index, 1);
		reordered.splice(otherIndex, 0, current);
		await env.DM_DB.batch(reordered.map((provider, i) =>
			env.DM_DB.prepare("UPDATE providers SET priority=?, updated_at=datetime('now') WHERE id=?").bind((i + 1) * 10, provider.id)
		));
	}
	return listProviders(env);
}

export async function setModelEnabled(env: AdminEnv, id: string, enabled: boolean): Promise<ModelRow | null> {
	const existing = await getModel(env, id);
	if (!existing) return null;
	await env.DM_DB.prepare("UPDATE models SET enabled = ? WHERE id = ?")
		.bind(enabled ? 1 : 0, id)
		.run();
	const updated = await getModel(env, id);
	if (!updated || updated.enabled !== (enabled ? 1 : 0)) throw new Error("model_update_not_persisted");
	return updated;
}

export async function setModelPublicAlias(env: AdminEnv, id: string, publicAlias: string | null): Promise<ModelRow | null> {
	const existing = await getModel(env, id);
	if (!existing) return null;
	await env.DM_DB.prepare("UPDATE models SET public_alias = ? WHERE id = ?")
		.bind(publicAlias, id)
		.run();
	const updated = await getModel(env, id);
	if (!updated || updated.public_alias !== publicAlias) throw new Error("model_alias_update_not_persisted");
	return updated;
}

export async function setRoutingRuleTarget(env: AdminEnv, alias: string, modelId: string): Promise<RoutingRuleRow> {
	const model = await getModel(env, modelId);
	if (!model) throw new Error("model_not_found");
	await env.DM_DB.prepare(
		`INSERT INTO routing_rules (public_alias, model_id, updated_at)
		 VALUES (?, ?, datetime('now'))
		 ON CONFLICT(public_alias) DO UPDATE SET model_id = excluded.model_id, updated_at = datetime('now')`
	).bind(alias, modelId).run();
	const updated = await getRoutingRule(env, alias);
	if (!updated || updated.model_id !== modelId) throw new Error("routing_update_not_persisted");
	return updated;
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
	evidence: ProviderHealthEvidence = {},
): Promise<void> {
	const now = "datetime('now')";
	const httpStatus = evidence.httpStatus ?? null;
	const gatewayLogId = evidence.gatewayLogId ?? null;
	const gatewayStep = evidence.gatewayStep ?? null;
	const cfRay = evidence.cfRay ?? null;
	if (state === "HEALTHY" && !errorMessage) {
		await env.DM_DB.prepare(
			`UPDATE providers SET health_state = ?, last_success_at = ${now}, last_error_message = NULL, last_latency_ms = ?,
			 last_http_status=?, last_gateway_log_id=?, last_gateway_step=?, last_cf_ray=?, updated_at = ${now} WHERE id = ?`,
		).bind(state, latencyMs, httpStatus, gatewayLogId, gatewayStep, cfRay, id).run();
	} else {
		await env.DM_DB.prepare(
			`UPDATE providers SET health_state = ?, last_error_at = ${now}, last_error_message = ?, last_latency_ms = ?,
			 last_http_status=?, last_gateway_log_id=?, last_gateway_step=?, last_cf_ray=?, updated_at = ${now} WHERE id = ?`,
		).bind(state, errorMessage, latencyMs, httpStatus, gatewayLogId, gatewayStep, cfRay, id).run();
	}
	await env.DM_DB.prepare(
		`INSERT INTO health_checks
		(provider_id, state, latency_ms, error_message, http_status, gateway_log_id, gateway_step, cf_ray, model_id, correlation_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).bind(id, state, latencyMs, errorMessage, httpStatus, gatewayLogId, gatewayStep, cfRay, evidence.modelId ?? null, evidence.correlationId ?? null).run();
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
