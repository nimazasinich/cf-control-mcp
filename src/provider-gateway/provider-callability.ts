import type { ModelRow, ProviderRow } from "../admin/types";
import { supportsCloudflareRestChat } from "../admin/provider-catalog";
import type { GatewayEnv } from "./types";

export type CallabilityReason =
	| "provider_disabled"
	| "model_disabled"
	| "provider_not_configured"
	| "credential_missing"
	| "runtime_not_configured"
	| "health_not_verified"
	| "gateway_evidence_missing";

export interface ProviderRuntimeReadiness {
	enabled: boolean;
	configured: boolean;
	credentialReady: boolean;
	runtimeReady: boolean;
	healthVerified: boolean;
	gatewayVerified: boolean;
	callable: boolean;
	reasons: CallabilityReason[];
	networkState: string;
}

export interface ProviderCallability extends ProviderRuntimeReadiness {
	modelEnabled: boolean;
}

/**
 * Shared runtime-readiness contract used by both the Provider Gateway and the
 * Admin control plane. This intentionally encodes the same fail-closed rules
 * required for automatic routing; UI state must not be looser than runtime.
 */
export function providerRuntimeReadiness(provider: ProviderRow, env: GatewayEnv): ProviderRuntimeReadiness {
	const enabled = provider.enabled === 1;
	const configured = provider.transport !== "gateway-custom" || Boolean(provider.base_url && provider.custom_provider_id);
	const credentialReady =
		provider.credential_required !== 1 ||
		Boolean(provider.byok_alias) ||
		provider.auth_type === "cloudflare-unified" ||
		provider.auth_type === "cloudflare-binding" ||
		provider.auth_type === "none";

	const hasGatewayIdentity = Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env.CF_AIG_GATEWAY_SLUG?.trim());
	let runtimeReady = hasGatewayIdentity;
	if (provider.transport === "workers-ai-binding") {
		runtimeReady = hasGatewayIdentity && Boolean(env.AI);
	} else if (provider.transport === "gateway-native" && provider.provider_slug === "google-ai-studio" && (!provider.byok_alias || provider.byok_alias === "default")) {
		runtimeReady = hasGatewayIdentity && Boolean(env.CF_AIG_TOKEN?.trim());
	} else if (
		provider.transport === "cloudflare-rest" ||
		(provider.transport === "gateway-native" &&
			supportsCloudflareRestChat(provider.provider_slug) &&
			(!provider.byok_alias || provider.byok_alias === "default"))
	) {
		runtimeReady = hasGatewayIdentity && Boolean(env.CLOUDFLARE_API_TOKEN?.trim());
	} else if (provider.transport === "gateway-custom") {
		runtimeReady = hasGatewayIdentity && Boolean(env.CF_AIG_TOKEN?.trim()) && configured;
	} else if (provider.transport === "gateway-native") {
		runtimeReady = hasGatewayIdentity && Boolean(env.CF_AIG_TOKEN?.trim());
	}

	const healthVerified = provider.health_state === "HEALTHY";
	const gatewayVerified = healthVerified && Boolean(provider.last_gateway_log_id);
	const reasons: CallabilityReason[] = [];
	if (!enabled) reasons.push("provider_disabled");
	if (!configured) reasons.push("provider_not_configured");
	if (!credentialReady) reasons.push("credential_missing");
	if (!runtimeReady) reasons.push("runtime_not_configured");
	if (!healthVerified) reasons.push("health_not_verified");
	if (healthVerified && !gatewayVerified) reasons.push("gateway_evidence_missing");

	const callable = enabled && configured && credentialReady && runtimeReady && healthVerified && gatewayVerified;
	const networkState = !runtimeReady
		? "runtime-not-configured"
		: gatewayVerified
			? "gateway-verified"
			: healthVerified
				? "gateway-evidence-missing"
				: provider.health_state.toLowerCase();

	return { enabled, configured, credentialReady, runtimeReady, healthVerified, gatewayVerified, callable, reasons, networkState };
}

export function providerCallability(provider: ProviderRow, model: ModelRow, env: GatewayEnv): ProviderCallability {
	const runtime = providerRuntimeReadiness(provider, env);
	const modelEnabled = model.enabled === 1;
	const reasons = runtime.reasons.slice();
	if (!modelEnabled) reasons.unshift("model_disabled");
	return {
		...runtime,
		modelEnabled,
		callable: runtime.callable && modelEnabled,
		reasons,
	};
}
