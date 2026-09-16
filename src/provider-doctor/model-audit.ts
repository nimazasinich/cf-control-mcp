import type { ModelRow, ProviderRow, RoutingRuleRow } from "../admin/types";
import type { ProviderModelAudit } from "./types";

export function auditProviderModels(
	provider: ProviderRow,
	models: readonly ModelRow[],
	routes: readonly RoutingRuleRow[],
): ProviderModelAudit {
	const own = models.filter((model) => model.provider_id === provider.id);
	const ownIds = new Set(own.map((model) => model.id));
	const enabled = own.filter((model) => model.enabled === 1);
	const publicAliases = own
		.map((model) => model.public_alias)
		.filter((alias): alias is string => Boolean(alias))
		.sort();
	const routedAliases = routes
		.filter((route) => ownIds.has(route.model_id))
		.map((route) => route.public_alias)
		.sort();
	const orphanRoutingAliases = routes
		.filter((route) => route.model_id && !models.some((model) => model.id === route.model_id))
		.map((route) => route.public_alias)
		.sort();

	const test = provider.test_model ? own.find((model) => model.id === provider.test_model) : undefined;
	return {
		total: own.length,
		enabled: enabled.length,
		disabled: own.length - enabled.length,
		publicAliases,
		routedAliases,
		orphanRoutingAliases,
		testModelRegistered: provider.test_model ? Boolean(test) : false,
		testModelEnabled: provider.test_model ? test?.enabled === 1 : false,
	};
}
