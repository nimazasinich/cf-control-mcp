/**
 * Provider Gateway — GET /v1/models and D1-backed model availability.
 *
 * D1 is authoritative in production. Model listing, Admin status, and
 * completion routing share the same providerCallability() predicate so a model
 * cannot be advertised as usable while the runtime would reject it.
 */

import type { ModelRow, ProviderRow } from "../admin/types";
import type { GatewayEnv, ModelListResponse } from "./types";
import { gatewayCorHeaders } from "./auth";
import { providerCallability } from "./provider-callability";

/** epoch timestamps are approximate release dates (rounded) */
const FALLBACK_MODELS: ModelListResponse["data"] = [
	{ id: "fast", object: "model", created: 1745000000, owned_by: "system" },
	{ id: "coding", object: "model", created: 1739000000, owned_by: "system" },
	{ id: "research", object: "model", created: 1745000000, owned_by: "system" },
	{ id: "gemini-3.8-flash", object: "model", created: 1745000000, owned_by: "google" },
	{ id: "gemini-3.7-flash", object: "model", created: 1745000000, owned_by: "google" },
	{ id: "gemini-3.6-flash", object: "model", created: 1739000000, owned_by: "google" },
	{ id: "gemini-3.5-flash", object: "model", created: 1739000000, owned_by: "google" },
];

interface RegistryJoinRow extends ProviderRow {
	model_id: string;
	model_public_alias: string | null;
	model_enabled: number;
	model_free_tier: number;
	model_created_at: string | null;
}

interface RegistryAliasRow {
	public_alias: string;
	model_id: string;
	created_at?: string | null;
}

interface AvailabilityRow {
	id: string;
	model_enabled: number;
	provider_enabled: number;
}

export class ModelRegistryError extends Error {
	constructor(message = "Model registry lookup failed") {
		super(message);
		this.name = "ModelRegistryError";
	}
}

export class ModelUnavailableError extends Error {
	readonly model: string;
	readonly reason: "not_registered" | "model_disabled" | "provider_disabled" | "provider_unavailable";

	constructor(model: string, reason: "not_registered" | "model_disabled" | "provider_disabled" | "provider_unavailable") {
		const detail = reason === "not_registered"
			? "is not registered"
			: reason === "model_disabled"
				? "is disabled"
				: reason === "provider_disabled"
					? "belongs to a disabled provider"
					: "belongs to a provider that is not currently callable";
		super(`Model '${model}' ${detail}.`);
		this.name = "ModelUnavailableError";
		this.model = model;
		this.reason = reason;
	}
}

function dbFor(env: GatewayEnv): D1Database | undefined {
	return env.DM_DB || env.DB;
}

function createdEpoch(value?: string | null): number {
	if (!value) return 0;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function ownerForProvider(providerId: string): string {
	return providerId === "google-ai-studio" ? "google" : providerId;
}

function providerFromJoin(row: RegistryJoinRow): ProviderRow {
	const {
		model_id: _modelId,
		model_public_alias: _modelPublicAlias,
		model_enabled: _modelEnabled,
		model_free_tier: _modelFreeTier,
		model_created_at: _modelCreatedAt,
		...provider
	} = row;
	return provider;
}

function modelFromJoin(row: RegistryJoinRow): ModelRow {
	return {
		id: row.model_id,
		provider_id: row.id,
		public_alias: row.model_public_alias,
		enabled: row.model_enabled,
		free_tier: row.model_free_tier,
		display_name: null,
		description: null,
		created_at: row.model_created_at ?? "",
	};
}

async function registryJoinRows(db: D1Database): Promise<RegistryJoinRow[]> {
	const result = await db.prepare(
		`SELECT
		 m.id AS model_id, m.public_alias AS model_public_alias, m.enabled AS model_enabled,
		 m.free_tier AS model_free_tier, m.created_at AS model_created_at,
		 p.id, p.display_name, p.kind, p.provider_slug, p.transport, p.auth_type, p.base_url, p.api_path,
		 p.priority, p.credential_required, p.custom_provider_id, p.test_model, p.enabled, p.byok_alias,
		 p.health_state, p.last_success_at, p.last_error_at, p.last_error_message, p.last_latency_ms,
		 p.last_http_status, p.last_gateway_log_id, p.last_gateway_step, p.last_cf_ray, p.created_at, p.updated_at
		 FROM models m
		 JOIN providers p ON p.id = m.provider_id
		 ORDER BY p.priority ASC, m.id ASC`,
	).all<RegistryJoinRow>();
	return result.results ?? [];
}

export async function listAvailableModels(env: GatewayEnv): Promise<ModelListResponse["data"]> {
	const db = dbFor(env);
	if (!db) return FALLBACK_MODELS;
	try {
		const rows = await registryJoinRows(db);
		const callableRows = rows.filter((row) => providerCallability(providerFromJoin(row), modelFromJoin(row), env).callable);
		const callableIds = new Set(callableRows.map((row) => row.model_id));
		const aliasResult = await db.prepare(
			`SELECT r.public_alias, r.model_id, m.created_at
			 FROM routing_rules r
			 JOIN models m ON m.id = r.model_id
			 ORDER BY r.public_alias`,
		).all<RegistryAliasRow>();
		const data: ModelListResponse["data"] = [];
		const seen = new Set<string>();
		for (const row of aliasResult.results ?? []) {
			if (!row.public_alias || !callableIds.has(row.model_id) || seen.has(row.public_alias)) continue;
			seen.add(row.public_alias);
			data.push({
				id: row.public_alias,
				object: "model",
				created: createdEpoch(row.created_at),
				owned_by: "system",
				enabled: true,
				configured: true,
				gateway_verified: true,
				callable: true,
			});
		}
		for (const row of callableRows) {
			if (row.model_public_alias && !seen.has(row.model_public_alias)) {
				seen.add(row.model_public_alias);
				data.push({
					id: row.model_public_alias,
					object: "model",
					created: createdEpoch(row.model_created_at),
					owned_by: ownerForProvider(row.id),
					enabled: true,
					configured: true,
					gateway_verified: true,
					callable: true,
				});
			}
			if (!row.model_id || seen.has(row.model_id)) continue;
			seen.add(row.model_id);
			data.push({
				id: row.model_id,
				object: "model",
				created: createdEpoch(row.model_created_at),
				owned_by: ownerForProvider(row.id),
				enabled: true,
				configured: true,
				gateway_verified: true,
				callable: true,
			});
		}
		return data;
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new ModelRegistryError(`Failed to read callable models from D1: ${detail}`);
	}
}

export async function handleModels(env: GatewayEnv): Promise<Response> {
	try {
		const body: ModelListResponse = { object: "list", data: await listAvailableModels(env) };
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(
			JSON.stringify({ error: { message, type: "configuration_error", code: "model_registry_error" } }),
			{ status: 503, headers: { "Content-Type": "application/json", ...gatewayCorHeaders() } },
		);
	}
}

export interface ModelCandidate {
	modelId: string;
	freeTier: boolean;
	provider: ProviderRow;
}

function candidateFromJoin(row: RegistryJoinRow): ModelCandidate {
	return { modelId: row.model_id, freeTier: row.model_free_tier === 1, provider: providerFromJoin(row) };
}

export async function resolveModelCandidates(model: string, env: GatewayEnv): Promise<ModelCandidate[]> {
	const db = dbFor(env);
	if (!db) {
		const resolved = DEFAULT_MODEL_ALIASES_FOR_CANDIDATES[model] || model;
		return [{ modelId: resolved, freeTier: false, provider: fallbackGoogleProvider() }];
	}
	try {
		const alias = await db.prepare("SELECT model_id FROM routing_rules WHERE public_alias = ?")
			.bind(model).first<{ model_id: string }>();
		const rows = await registryJoinRows(db);
		const candidates = rows
			.filter((row) => providerCallability(providerFromJoin(row), modelFromJoin(row), env).callable)
			.map(candidateFromJoin);
		if (model === "auto") return candidates;
		if (model === "free") return candidates.filter((candidate) => candidate.freeTier);
		if (alias?.model_id) {
			const primary = candidates.find((candidate) => candidate.modelId === alias.model_id);
			const rest = candidates.filter((candidate) => candidate.modelId !== alias.model_id);
			return primary ? [primary, ...rest] : rest;
		}
		const modelAliasRow = rows.find((row) => row.model_public_alias === model);
		if (modelAliasRow) {
			const direct = candidates.find((candidate) => candidate.modelId === modelAliasRow.model_id);
			if (direct) return [direct];
			if (modelAliasRow.model_enabled !== 1) throw new ModelUnavailableError(model, "model_disabled");
			if (modelAliasRow.enabled !== 1) throw new ModelUnavailableError(model, "provider_disabled");
			throw new ModelUnavailableError(model, "provider_unavailable");
		}
		const exact = candidates.find((candidate) => candidate.modelId === model);
		if (exact) return [exact];
		const registeredRow = rows.find((row) => row.model_id === model);
		if (!registeredRow) throw new ModelUnavailableError(model, "not_registered");
		if (registeredRow.model_enabled !== 1) throw new ModelUnavailableError(model, "model_disabled");
		if (registeredRow.enabled !== 1) throw new ModelUnavailableError(model, "provider_disabled");
		throw new ModelUnavailableError(model, "provider_unavailable");
	} catch (err) {
		if (err instanceof ModelUnavailableError) throw err;
		const detail = err instanceof Error ? err.message : String(err);
		throw new ModelRegistryError(`Failed to resolve model candidates from D1: ${detail}`);
	}
}

const DEFAULT_MODEL_ALIASES_FOR_CANDIDATES: Record<string, string> = {
	fast: "gemini-3.6-flash",
	coding: "gemini-3.8-flash",
	research: "gemini-3.8-flash",
};

function fallbackGoogleProvider(): ProviderRow {
	return {
		id: "google-ai-studio",
		display_name: "Google AI Studio",
		kind: "google-ai-studio",
		provider_slug: "google-ai-studio",
		transport: "gateway-native",
		auth_type: "byok",
		base_url: null,
		api_path: null,
		priority: 10,
		credential_required: 1,
		custom_provider_id: null,
		test_model: null,
		enabled: 1,
		byok_alias: "default",
		health_state: "CONFIGURED",
		last_success_at: null,
		last_error_at: null,
		last_error_message: null,
		last_latency_ms: null,
		last_http_status: null,
		last_gateway_log_id: null,
		last_gateway_step: null,
		last_cf_ray: null,
		created_at: "",
		updated_at: "",
	};
}
