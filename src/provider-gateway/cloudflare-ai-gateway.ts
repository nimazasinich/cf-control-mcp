/**
 * Provider Gateway — OpenAI-compatible chat entry point.
 *
 * D1 is authoritative for model/provider enablement and provider priority.
 * Every production provider attempt is routed through Cloudflare AI Gateway:
 *   - AI REST API / Unified Billing / default BYOK for standard chat models
 *   - provider passthrough for custom providers and non-default BYOK aliases
 *   - Workers AI binding with a gateway id for provider-token-free models
 *   - Custom Provider passthrough for operator-supplied HTTPS endpoints
 */
import type { ChatCompletionRequest, GatewayEnv } from "./types";
import { gatewayCorHeaders } from "./auth";
import {
	resolveModelCandidates,
	ModelRegistryError,
	ModelUnavailableError,
} from "./models";
import { requestProviderChat, isRetryableProviderStatus } from "./provider-runtime";

const DEFAULT_ALIASES: Record<string, string> = {
	fast: "gemini-3.6-flash",
	coding: "gemini-3.8-flash",
	research: "gemini-3.8-flash",
};

/** Historical helper kept for API/test compatibility. Runtime routing uses resolveModelCandidates. */
export async function resolveModel(model: string, env: GatewayEnv): Promise<string> {
	const db = env.DM_DB || env.DB;
	if (db) {
		try {
			const rule = await db.prepare("SELECT model_id FROM routing_rules WHERE public_alias = ?")
				.bind(model).first<{ model_id: string }>();
			if (rule?.model_id) return rule.model_id;
		} catch {
			// The runtime candidate resolver is fail-closed; this compatibility
			// helper preserves the old local fallback only.
		}
	}
	return DEFAULT_ALIASES[model] || model;
}

function gatewayError(message: string, type: string, status: number, extra: Record<string, unknown> = {}): Response {
	return new Response(JSON.stringify({ error: { message, type, code: type, ...extra } }), {
		status,
		headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
	});
}

function annotateSuccess(response: Response, providerId: string, modelId: string, attempt: number, gatewayVerified: boolean, correlationId: string): Response {
	const headers = new Headers(response.headers);
	for (const [k, v] of Object.entries(gatewayCorHeaders())) headers.set(k, v);
	headers.set("x-dw-provider", providerId);
	headers.set("x-dw-model", modelId);
	headers.set("x-dw-fallback-index", String(attempt));
	headers.set("x-dw-gateway-verified", gatewayVerified ? "1" : "0");
	headers.set("x-dw-correlation-id", correlationId);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleChatCompletions(request: Request, env: GatewayEnv): Promise<Response> {
	const correlationId = crypto.randomUUID();
	if (!env.CF_AIG_GATEWAY_SLUG?.trim() || !env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
		return gatewayError(
			"Cloudflare AI Gateway is not configured. Set CLOUDFLARE_ACCOUNT_ID and CF_AIG_GATEWAY_SLUG.",
			"configuration_error",
			503,
		);
	}

	let body: ChatCompletionRequest;
	try {
		body = await request.json() as ChatCompletionRequest;
	} catch {
		return gatewayError("Request body is not valid JSON.", "invalid_request_error", 400);
	}
	if (!body.model || typeof body.model !== "string") {
		return gatewayError("Required field 'model' is missing or not a string.", "invalid_request_error", 400);
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		return gatewayError("Required field 'messages' must be a non-empty array.", "invalid_request_error", 400);
	}

	try {
		const candidates = await resolveModelCandidates(body.model, env);
		if (candidates.length === 0) {
			return gatewayError(`No enabled, configured provider can currently serve '${body.model}'.`, "provider_unavailable", 503);
		}

		let last: Response | null = null;
		const failures: Array<{ provider: string; model: string; status: number; gatewayVerified: boolean }> = [];
		for (let attempt = 0; attempt < candidates.length; attempt++) {
			const candidate = candidates[attempt];
			let result;
			try {
				result = await requestProviderChat(candidate.provider, candidate.modelId, { ...body, model: candidate.modelId }, env, { correlationId });
			} catch (err) {
				failures.push({ provider: candidate.provider.id, model: candidate.modelId, status: 502, gatewayVerified: false });
				if (attempt + 1 < candidates.length) continue;
				throw err;
			}

			last = result.response;
			if (result.response.ok && result.gatewayVerified) {
				return annotateSuccess(result.response, candidate.provider.id, candidate.modelId, attempt, true, correlationId);
			}
			if (result.response.ok && !result.gatewayVerified) {
				failures.push({ provider: candidate.provider.id, model: candidate.modelId, status: 502, gatewayVerified: false });
				if (attempt + 1 < candidates.length) continue;
				return gatewayError("Provider returned 2xx without verifiable Cloudflare AI Gateway evidence.", "gateway_evidence_missing", 502, { attempts: failures });
			}
			failures.push({
				provider: candidate.provider.id,
				model: candidate.modelId,
				status: result.response.status,
				gatewayVerified: result.gatewayVerified,
			});
			if (!isRetryableProviderStatus(result.response.status)) {
				return annotateSuccess(result.response, candidate.provider.id, candidate.modelId, attempt, result.gatewayVerified, correlationId);
			}
		}

		if (last) {
			const status = last.status || 502;
			return gatewayError("All eligible provider attempts failed.", "provider_unavailable", status >= 400 ? status : 502, { attempts: failures });
		}
		return gatewayError("No provider attempt was possible.", "provider_unavailable", 503);
	} catch (err) {
		if (err instanceof ModelUnavailableError) return gatewayError(err.message, "model_not_found", 404);
		if (err instanceof ModelRegistryError) return gatewayError(err.message, "configuration_error", 503);
		const message = err instanceof Error ? err.message : String(err);
		return gatewayError(`Provider routing failed: ${message}`, "server_error", 502);
	}
}
