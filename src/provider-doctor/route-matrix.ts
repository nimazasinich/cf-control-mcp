import type { AdminEnv, ModelRow, ProviderRow, RoutingRuleRow } from "../admin/types";
import { providerRuntimeReadiness } from "../provider-gateway/provider-callability";
import type { GatewayEnv } from "../provider-gateway/types";
import type { DoctorRouteEntry } from "./types";

export function buildRouteMatrix(
	env: AdminEnv,
	providers: readonly ProviderRow[],
	models: readonly ModelRow[],
	routes: readonly RoutingRuleRow[],
): DoctorRouteEntry[] {
	const providersById = new Map(providers.map((provider) => [provider.id, provider]));
	const modelsById = new Map(models.map((model) => [model.id, model]));

	return routes.map((route): DoctorRouteEntry => {
		const model = modelsById.get(route.model_id);
		if (!model) {
			return {
				publicAlias: route.public_alias,
				modelId: route.model_id,
				modelEnabled: null,
				providerId: null,
				providerEnabled: null,
				providerHealth: null,
				providerCallable: false,
				state: "BROKEN",
				reasons: ["model_missing"],
			};
		}
		const provider = providersById.get(model.provider_id);
		if (!provider) {
			return {
				publicAlias: route.public_alias,
				modelId: route.model_id,
				modelEnabled: model.enabled === 1,
				providerId: model.provider_id,
				providerEnabled: null,
				providerHealth: null,
				providerCallable: false,
				state: "BROKEN",
				reasons: ["provider_missing"],
			};
		}
		const readiness = providerRuntimeReadiness(provider, env as unknown as GatewayEnv);
		let state: DoctorRouteEntry["state"] = "ACTIVE";
		const reasons: string[] = [];
		if (model.enabled !== 1) {
			state = "MODEL_DISABLED";
			reasons.push("model_disabled");
		} else if (provider.enabled !== 1) {
			state = "PROVIDER_DISABLED";
			reasons.push("provider_disabled");
		} else if (!readiness.callable) {
			state = "PROVIDER_UNHEALTHY";
			reasons.push(...readiness.reasons);
		}
		return {
			publicAlias: route.public_alias,
			modelId: model.id,
			modelEnabled: model.enabled === 1,
			providerId: provider.id,
			providerEnabled: provider.enabled === 1,
			providerHealth: provider.health_state,
			providerCallable: readiness.callable,
			state,
			reasons,
		};
	}).sort((a, b) => a.publicAlias.localeCompare(b.publicAlias));
}
