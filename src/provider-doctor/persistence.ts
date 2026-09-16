import type { AdminEnv } from "../admin/types";
import type { DoctorProbeResult, PersistedDoctorRun } from "./types";
import { safeError } from "./redaction";

export async function providerDoctorPersistenceAvailable(env: AdminEnv): Promise<boolean> {
	try {
		const row = await env.DM_DB.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='provider_doctor_runs'",
		).first<{ name: string }>();
		return row?.name === "provider_doctor_runs";
	} catch {
		return false;
	}
}

export async function beginDoctorRun(env: AdminEnv, providerCount: number): Promise<string> {
	const runId = crypto.randomUUID();
	await env.DM_DB.prepare(
		`INSERT INTO provider_doctor_runs
		(run_id, status, provider_count, probed_count, error_count)
		VALUES (?, 'RUNNING', ?, 0, 0)`,
	).bind(runId, providerCount).run();
	return runId;
}

export async function recordDoctorProbe(env: AdminEnv, runId: string, probe: DoctorProbeResult): Promise<void> {
	await env.DM_DB.prepare(
		`INSERT INTO provider_doctor_results
		(run_id, provider_id, model_id, state, diagnosis, latency_ms, http_status,
		 gateway_verified, gateway_log_id, gateway_step, cf_ray, correlation_id, error_message, tested_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).bind(
		runId,
		probe.providerId,
		probe.modelId,
		probe.state,
		probe.diagnosis,
		probe.latencyMs,
		probe.httpStatus,
		probe.gatewayVerified ? 1 : 0,
		probe.gatewayLogId,
		probe.gatewayStep,
		probe.cfRay,
		probe.correlationId,
		safeError(probe.errorMessage),
		probe.testedAt,
	).run();
}

export async function finishDoctorRun(
	env: AdminEnv,
	runId: string,
	status: PersistedDoctorRun["status"],
	probedCount: number,
	errorCount: number,
): Promise<void> {
	await env.DM_DB.prepare(
		`UPDATE provider_doctor_runs
		 SET status=?, probed_count=?, error_count=?, completed_at=datetime('now')
		 WHERE run_id=?`,
	).bind(status, probedCount, errorCount, runId).run();
}

export async function listDoctorRuns(env: AdminEnv, limit = 20): Promise<PersistedDoctorRun[]> {
	const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit || 20)));
	const { results } = await env.DM_DB.prepare(
		`SELECT run_id AS runId, started_at AS startedAt, completed_at AS completedAt,
		        status, provider_count AS providerCount, probed_count AS probedCount,
		        error_count AS errorCount
		 FROM provider_doctor_runs ORDER BY started_at DESC LIMIT ?`,
	).bind(safeLimit).all<PersistedDoctorRun>();
	return results ?? [];
}
