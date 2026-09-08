import type { AdminEnv } from "./types";

export type ProviderOperationState =
	| "PENDING"
	| "IN_PROGRESS"
	| "COMPENSATING"
	| "RECONCILIATION_REQUIRED"
	| "SUCCEEDED"
	| "FAILED";

export type ProviderOperationType = "create" | "credential_set" | "credential_delete" | "delete";

export interface ProviderOperationRow {
	operation_id: string;
	operation_type: ProviderOperationType;
	provider_id: string | null;
	external_custom_provider_id: string | null;
	step: string;
	state: ProviderOperationState;
	attempt_count: number;
	error_summary: string | null;
	created_at: string;
	updated_at: string;
}

function safeSummary(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = value instanceof Error ? value.message : String(value);
	// Lifecycle records must never echo likely credential-bearing text. Keep a
	// bounded categorical message and redact obvious bearer/key assignments.
	return text
		.replace(/(bearer\s+)[^\s;]+/gi, "$1[redacted]")
		.replace(/((?:token|secret|key)\s*[=:]\s*)[^\s;]+/gi, "$1[redacted]")
		.slice(0, 500);
}

export async function beginProviderOperation(
	env: AdminEnv,
	operationType: ProviderOperationType,
	providerId: string | null,
	step = "start",
	externalCustomProviderId: string | null = null,
): Promise<string> {
	const id = crypto.randomUUID();
	await env.DM_DB.prepare(
		`INSERT INTO provider_operations
		 (operation_id, operation_type, provider_id, external_custom_provider_id, step, state, attempt_count)
		 VALUES (?, ?, ?, ?, ?, 'PENDING', 1)`,
	).bind(id, operationType, providerId, externalCustomProviderId, step).run();
	return id;
}

export async function updateProviderOperation(
	env: AdminEnv,
	operationId: string,
	patch: {
		step: string;
		state: ProviderOperationState;
		externalCustomProviderId?: string | null;
		error?: unknown;
		incrementAttempt?: boolean;
	},
): Promise<void> {
	await env.DM_DB.prepare(
		`UPDATE provider_operations
		 SET step = ?, state = ?,
		     external_custom_provider_id = COALESCE(?, external_custom_provider_id),
		     error_summary = ?,
		     attempt_count = attempt_count + ?,
		     updated_at = datetime('now')
		 WHERE operation_id = ?`,
	).bind(
		patch.step,
		patch.state,
		patch.externalCustomProviderId ?? null,
		safeSummary(patch.error),
		patch.incrementAttempt ? 1 : 0,
		operationId,
	).run();
}

export async function latestProviderOperations(env: AdminEnv, providerIds: string[]): Promise<Map<string, ProviderOperationRow>> {
	const out = new Map<string, ProviderOperationRow>();
	for (const providerId of providerIds) {
		const row = await env.DM_DB.prepare(
			`SELECT * FROM provider_operations WHERE provider_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
		).bind(providerId).first<ProviderOperationRow>();
		if (row) out.set(providerId, row);
	}
	return out;
}
