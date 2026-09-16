import type { AdminEnv, ProviderRow } from "../admin/types";
import { testProviderConnection } from "../admin/health";
import { classifyProbeState } from "./classifier";
import { safeError } from "./redaction";
import type { DoctorProbeResult } from "./types";

export async function probeProvider(env: AdminEnv, provider: ProviderRow): Promise<DoctorProbeResult> {
	const result = await testProviderConnection(env, provider);
	return {
		providerId: provider.id,
		modelId: result.modelId ?? null,
		state: result.state,
		diagnosis: classifyProbeState(result.state, Boolean(result.gatewayVerified)),
		latencyMs: result.latencyMs,
		httpStatus: result.httpStatus ?? null,
		gatewayVerified: Boolean(result.gatewayVerified),
		gatewayLogId: result.gatewayLogId ?? null,
		gatewayStep: result.gatewayStep ?? null,
		cfRay: result.cfRay ?? null,
		correlationId: result.correlationId,
		errorMessage: safeError(result.errorMessage),
		testedAt: new Date().toISOString(),
	};
}

export async function probeProvidersBounded(
	env: AdminEnv,
	providers: readonly ProviderRow[],
	concurrency = 2,
): Promise<DoctorProbeResult[]> {
	const results: DoctorProbeResult[] = [];
	const queue = [...providers];
	async function worker() {
		while (queue.length > 0) {
			const provider = queue.shift();
			if (!provider) break;
			try {
				results.push(await probeProvider(env, provider));
			} catch (err) {
				results.push({
					providerId: provider.id,
					modelId: null,
					state: "UPSTREAM_ERROR",
					diagnosis: "UPSTREAM_ERROR",
					latencyMs: null,
					httpStatus: null,
					gatewayVerified: false,
					gatewayLogId: null,
					gatewayStep: null,
					cfRay: null,
					correlationId: crypto.randomUUID(),
					errorMessage: safeError(err),
					testedAt: new Date().toISOString(),
				});
			}
		}
	}
	const workers = Array.from({ length: Math.max(1, Math.min(concurrency, providers.length || 1)) }, () => worker());
	await Promise.all(workers);
	return results;
}
