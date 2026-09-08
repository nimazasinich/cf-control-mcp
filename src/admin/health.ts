/**
 * Admin provider health tests.
 * A provider is HEALTHY only when a real upstream request succeeds AND the
 * Cloudflare AI Gateway hop returns verifiable gateway evidence.
 */
import type { AdminEnv, HealthState, ProviderRow } from "./types";
import { listModelsForProvider } from "./db";
import { requestProviderChat, classifyProviderHealth } from "../provider-gateway/provider-runtime";
import { supportsCloudflareRestChat } from "./provider-catalog";

export const HEALTH_STALE_AFTER_MS = 60 * 60 * 1000;

export type HealthFreshness = "recent" | "stale" | "never-verified" | "not-healthy";

export function providerHealthFreshness(provider: ProviderRow, nowMs = Date.now()): {
	freshness: HealthFreshness;
	ageMs: number | null;
	stale: boolean;
} {
	if (provider.health_state !== "HEALTHY") return { freshness: "not-healthy", ageMs: null, stale: false };
	if (!provider.last_success_at) return { freshness: "never-verified", ageMs: null, stale: true };
	const timestamp = Date.parse(provider.last_success_at.endsWith("Z") ? provider.last_success_at : `${provider.last_success_at.replace(" ", "T")}Z`);
	if (!Number.isFinite(timestamp)) return { freshness: "never-verified", ageMs: null, stale: true };
	const ageMs = Math.max(0, nowMs - timestamp);
	return ageMs > HEALTH_STALE_AFTER_MS
		? { freshness: "stale", ageMs, stale: true }
		: { freshness: "recent", ageMs, stale: false };
}

export interface HealthResult {
	state: HealthState;
	latencyMs: number | null;
	errorMessage: string | null;
	httpStatus?: number | null;
	gatewayLogId?: string | null;
	gatewayStep?: string | null;
	cfRay?: string | null;
	modelId?: string | null;
	gatewayVerified?: boolean;
	correlationId: string;
}

function missingRuntime(provider: ProviderRow, env: AdminEnv): string | null {
	if (!env.CLOUDFLARE_ACCOUNT_ID?.trim() || !env.CF_AIG_GATEWAY_SLUG?.trim()) {
		return "CLOUDFLARE_ACCOUNT_ID or CF_AIG_GATEWAY_SLUG not set";
	}
	if (provider.transport === "workers-ai-binding" && !env.AI) return "Workers AI binding is not configured";
	if (provider.transport === "gateway-native" && provider.provider_slug === "google-ai-studio" && (!provider.byok_alias || provider.byok_alias === "default")) {
		if (!env.CF_AIG_TOKEN?.trim()) return "CF_AIG_TOKEN not configured for authenticated AI Gateway compat";
		return null;
	}
	if (provider.transport === "cloudflare-rest" || (provider.transport === "gateway-native" && supportsCloudflareRestChat(provider.provider_slug) && (!provider.byok_alias || provider.byok_alias === "default"))) {
		if (!env.CLOUDFLARE_API_TOKEN?.trim()) return "CLOUDFLARE_API_TOKEN not configured for Cloudflare AI REST API";
	}
	if (provider.transport === "gateway-custom" && (!provider.base_url || !provider.custom_provider_id)) return "Cloudflare Custom Provider has not been provisioned with an HTTPS base URL";
	if ((provider.transport === "gateway-custom" || (provider.transport === "gateway-native" && provider.byok_alias !== "default")) && !env.CF_AIG_TOKEN?.trim()) {
		return "CF_AIG_TOKEN not configured for authenticated AI Gateway passthrough";
	}
	if (provider.credential_required === 1 && !provider.byok_alias) return "Provider credential is not configured in AI Gateway BYOK";
	return null;
}

export async function testProviderConnection(env: AdminEnv, provider: ProviderRow, correlationId = crypto.randomUUID()): Promise<HealthResult> {
	const missing = missingRuntime(provider, env);
	if (missing) return { state: "NOT_CONFIGURED", latencyMs: null, errorMessage: missing, gatewayVerified: false, correlationId };

	let modelId = provider.test_model || null;
	if (!modelId) {
		const models = await listModelsForProvider(env, provider.id);
		modelId = models.find((model) => model.enabled === 1)?.id || null;
	}
	if (!modelId) return { state: "NOT_CONFIGURED", latencyMs: null, errorMessage: "No test model is registered for this provider", modelId: null, gatewayVerified: false, correlationId };

	try {
		const result = await requestProviderChat(provider, modelId, {
			model: modelId,
			messages: [{ role: "user", content: "Reply only with OK" }],
			max_tokens: 8,
			stream: false,
		}, env, { correlationId });
		const classified = classifyProviderHealth(result);
		let detail = classified.errorMessage;
		if (!result.response.ok) {
			const text = await result.response.clone().text().catch(() => "");
			if (text) detail = `${detail || `upstream ${result.response.status}`}: ${text.slice(0, 260)}`;
		}
		return {
			state: classified.state,
			latencyMs: result.latencyMs,
			errorMessage: detail,
			httpStatus: result.httpStatus,
			gatewayLogId: result.gatewayLogId,
			gatewayStep: result.gatewayStep,
			cfRay: result.cfRay,
			modelId,
			gatewayVerified: result.gatewayVerified,
			correlationId,
		};
	} catch (err) {
		return {
			state: "UPSTREAM_ERROR",
			latencyMs: null,
			errorMessage: err instanceof Error ? err.message : String(err),
			modelId,
			gatewayVerified: false,
			correlationId,
		};
	}
}

export async function testGoogleAiStudio(env: AdminEnv): Promise<HealthResult> {
	if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG || !env.CF_AIG_TOKEN) {
		return { state: "NOT_CONFIGURED", latencyMs: null, errorMessage: "CLOUDFLARE_ACCOUNT_ID, CF_AIG_GATEWAY_SLUG, or CF_AIG_TOKEN not set", correlationId: crypto.randomUUID() };
	}
	const provider: ProviderRow = {
		id: "google-ai-studio", display_name: "Google AI Studio", kind: "google-ai-studio", provider_slug: "google-ai-studio",
		transport: "gateway-native", auth_type: "byok", base_url: null, api_path: null, priority: 10, credential_required: 1,
		custom_provider_id: null, test_model: "gemini-3.6-flash", enabled: 1, byok_alias: "default", health_state: "CONFIGURED",
		last_success_at: null, last_error_at: null, last_error_message: null, last_latency_ms: null, last_http_status: null,
		last_gateway_log_id: null, last_gateway_step: null, last_cf_ray: null, created_at: "", updated_at: "",
	};
	return testProviderConnection(env, provider);
}
