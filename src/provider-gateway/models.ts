/**
 * Provider Gateway — GET /v1/models and D1-backed model availability.
 *
 * Production uses the D1 model registry as the source of truth. A model is
 * available only when BOTH models.enabled=1 and its provider is enabled.
 * Routing aliases are exposed only when their target model/provider is active.
 *
 * When no D1 binding exists (local/unit-test fallback), the historical static
 * list is preserved so development does not require D1.
 */

import type { GatewayEnv, ModelListResponse } from "./types";
import { gatewayCorHeaders } from "./auth";

/** epoch timestamps are approximate release dates (rounded) */
const FALLBACK_MODELS: ModelListResponse["data"] = [
	// Public routing aliases
	{ id: "fast", object: "model", created: 1745000000, owned_by: "system" },
	{ id: "coding", object: "model", created: 1739000000, owned_by: "system" },
	{ id: "research", object: "model", created: 1745000000, owned_by: "system" },
	// Gemini model registry fallback
	{ id: "gemini-3.8-flash", object: "model", created: 1745000000, owned_by: "google" },
	{ id: "gemini-3.7-flash", object: "model", created: 1745000000, owned_by: "google" },
	{ id: "gemini-3.6-flash", object: "model", created: 1739000000, owned_by: "google" },
	{ id: "gemini-3.5-flash", object: "model", created: 1739000000, owned_by: "google" },
];

interface RegistryModelRow {
	id: string;
	provider_id: string;
	created_at?: string | null;
}

interface RegistryAliasRow {
	public_alias: string;
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
	readonly reason: "not_registered" | "model_disabled" | "provider_disabled";

	constructor(model: string, reason: "not_registered" | "model_disabled" | "provider_disabled") {
		const detail = reason === "not_registered"
			? "is not registered"
			: reason === "model_disabled"
				? "is disabled"
				: "belongs to a disabled provider";
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

/**
 * Return the model list clients are actually allowed to use.
 *
 * D1 is authoritative when bound. A D1 error is fail-closed (503) rather than
 * silently falling back to the static list, otherwise a disabled model could
 * reappear during a registry outage.
 */
export async function listAvailableModels(env: GatewayEnv): Promise<ModelListResponse["data"]> {
	const db = dbFor(env);
	if (!db) return FALLBACK_MODELS;

	try {
		const modelResult = await db.prepare(
			`SELECT m.id, m.provider_id, m.created_at
			 FROM models m
			 JOIN providers p ON p.id = m.provider_id
			 WHERE m.enabled = 1 AND p.enabled = 1
			 ORDER BY m.id`,
		).all<RegistryModelRow>();

		const aliasResult = await db.prepare(
			`SELECT r.public_alias, m.created_at
			 FROM routing_rules r
			 JOIN models m ON m.id = r.model_id
			 JOIN providers p ON p.id = m.provider_id
			 WHERE m.enabled = 1 AND p.enabled = 1
			 ORDER BY r.public_alias`,
		).all<RegistryAliasRow>();

		const data: ModelListResponse["data"] = [];
		const seen = new Set<string>();

		for (const row of aliasResult.results ?? []) {
			if (!row.public_alias || seen.has(row.public_alias)) continue;
			seen.add(row.public_alias);
			data.push({
				id: row.public_alias,
				object: "model",
				created: createdEpoch(row.created_at),
				owned_by: "system",
			});
		}

		for (const row of modelResult.results ?? []) {
			if (!row.id || seen.has(row.id)) continue;
			seen.add(row.id);
			data.push({
				id: row.id,
				object: "model",
				created: createdEpoch(row.created_at),
				owned_by: ownerForProvider(row.provider_id),
			});
		}

		return data;
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new ModelRegistryError(`Failed to read enabled models from D1: ${detail}`);
	}
}

/**
 * Enforce D1 model/provider enablement for chat-completion requests.
 *
 * This closes the direct-ID bypass where a disabled model could be omitted
 * from /v1/models yet still be invoked by POST /v1/chat/completions.
 */
export async function assertModelAvailable(model: string, env: GatewayEnv): Promise<void> {
	const db = dbFor(env);
	if (!db) return;

	let row: AvailabilityRow | null;
	try {
		row = await db.prepare(
			`SELECT m.id,
			        m.enabled AS model_enabled,
			        p.enabled AS provider_enabled
			 FROM models m
			 JOIN providers p ON p.id = m.provider_id
			 WHERE m.id = ?`,
		).bind(model).first<AvailabilityRow>();
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new ModelRegistryError(`Failed to verify model availability in D1: ${detail}`);
	}

	if (!row) throw new ModelUnavailableError(model, "not_registered");
	if (row.model_enabled !== 1) throw new ModelUnavailableError(model, "model_disabled");
	if (row.provider_enabled !== 1) throw new ModelUnavailableError(model, "provider_disabled");
}

/**
 * Handle GET /v1/models.
 * Returns an OpenAI-compatible model list reflecting the live D1 registry.
 */
export async function handleModels(env: GatewayEnv): Promise<Response> {
	try {
		const body: ModelListResponse = {
			object: "list",
			data: await listAvailableModels(env),
		};
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(
			JSON.stringify({
				error: {
					message,
					type: "configuration_error",
					code: "model_registry_error",
				},
			}),
			{
				status: 503,
				headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
			},
		);
	}
}
