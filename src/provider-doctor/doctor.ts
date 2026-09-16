import type { AdminEnv, ProviderRow } from "../admin/types";
import { listModels, listProviders, listRoutingRules } from "../admin/db";
import { providerHealthFreshness } from "../admin/health";
import { providerRuntimeReadiness } from "../provider-gateway/provider-callability";
import type { GatewayEnv } from "../provider-gateway/types";
import { auditProviderModels } from "./model-audit";
import { classifyProvider } from "./classifier";
import { buildRouteMatrix } from "./route-matrix";
import { probeProvider, probeProvidersBounded } from "./probe";
import type { DoctorProbeResult, DoctorRunSummary, ProviderDoctorSnapshot } from "./types";

export async function buildProviderDoctorSnapshot(env: AdminEnv): Promise<DoctorRunSummary> {
	const [providers, models, routes] = await Promise.all([
		listProviders(env),
		listModels(env),
		listRoutingRules(env),
	]);

	const providerSnapshots: ProviderDoctorSnapshot[] = providers.map((provider) => {
		const readiness = providerRuntimeReadiness(provider, env as unknown as GatewayEnv);
		const freshness = providerHealthFreshness(provider);
		const modelsAudit = auditProviderModels(provider, models, routes);
		const aliases = routes
			.filter((route) => models.some((model) => model.id === route.model_id && model.provider_id === provider.id))
			.map((route) => route.public_alias)
			.sort();
		const classified = classifyProvider(provider, readiness, freshness);

		if (modelsAudit.total === 0 && provider.test_model) {
			classified.findings.push({
				code: "NO_TEST_MODEL",
				severity: "warning",
				summary: "Provider has a configured test_model but no registered models.",
				detail: provider.test_model,
			});
		}

		return {
			provider,
			readiness,
			findings: classified.findings,
			models: modelsAudit,
			healthFreshness: freshness,
			aliases,
			diagnosis: classified.diagnosis,
			callable: readiness.callable && !freshness.stale,
		};
	});

	const routesMatrix = buildRouteMatrix(env, providers, models, routes);
	return {
		generatedAt: new Date().toISOString(),
		providerCount: providers.length,
		callableCount: providerSnapshots.filter((item) => item.callable).length,
		healthyCount: providerSnapshots.filter((item) => item.provider.health_state === "HEALTHY").length,
		providers: providerSnapshots,
		routes: routesMatrix,
	};
}

export async function getProviderDoctorSnapshot(env: AdminEnv, providerId: string): Promise<ProviderDoctorSnapshot | null> {
	const summary = await buildProviderDoctorSnapshot(env);
	return summary.providers.find((entry) => entry.provider.id === providerId) ?? null;
}

export async function runProviderDoctorProbe(
	env: AdminEnv,
	providerId?: string,
	concurrency = 2,
): Promise<DoctorProbeResult[]> {
	const providers = await listProviders(env);
	if (providerId) {
		const provider = providers.find((item) => item.id === providerId);
		if (!provider) throw new Error("provider_not_found");
		return [await probeProvider(env, provider)];
	}
	return probeProvidersBounded(env, providers, concurrency);
}
