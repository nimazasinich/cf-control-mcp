import type { ProviderRow, HealthState } from "../admin/types";
import type { ChatCompletionRequest, GatewayEnv } from "./types";
import { gatewayCorHeaders } from "./auth";
import { supportsCloudflareRestChat } from "../admin/provider-catalog";

export interface GatewayEvidence {
	gatewayVerified: boolean;
	gatewayLogId: string | null;
	gatewayStep: string | null;
	cfRay: string | null;
	httpStatus: number | null;
	latencyMs: number | null;
}

export interface ProviderCallResult extends GatewayEvidence {
	response: Response;
	providerId: string;
	modelId: string;
}

export interface ProviderRequestContext {
	correlationId?: string;
}

function corsResponse(response: Response, extra: Record<string, string> = {}): Response {
	const headers = new Headers(response.headers);
	for (const [k, v] of Object.entries(gatewayCorHeaders())) headers.set(k, v);
	for (const [k, v] of Object.entries(extra)) headers.set(k, v);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function gatewayHeaders(env: GatewayEnv, provider: ProviderRow, context: ProviderRequestContext = {}): Record<string, string> {
	const token = env.CF_AIG_TOKEN?.trim();
	if (!token) throw new Error("CF_AIG_TOKEN not configured");
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"cf-aig-authorization": `Bearer ${token}`,
		"cf-aig-collect-log-payload": "false",
	};
	if (context.correlationId) {
		headers["cf-aig-metadata"] = JSON.stringify({ source: "cf-control-mcp", correlation_id: context.correlationId });
	}
	if (provider.byok_alias && provider.byok_alias !== "default") {
		headers["cf-aig-byok-alias"] = provider.byok_alias;
	}
	return headers;
}

function evidenceFromResponse(response: Response, latencyMs: number): GatewayEvidence {
	const gatewayLogId = response.headers.get("cf-aig-log-id");
	return {
		gatewayVerified: Boolean(gatewayLogId),
		gatewayLogId,
		gatewayStep: response.headers.get("cf-aig-step"),
		cfRay: response.headers.get("cf-ray"),
		httpStatus: response.status,
		latencyMs,
	};
}

function unifiedModelName(provider: ProviderRow, modelId: string): string {
	if (modelId.startsWith("@cf/")) return modelId;
	if (modelId.startsWith(`${provider.provider_slug}/`)) return modelId;
	const prefix = provider.provider_slug === "perplexity-ai" ? "perplexity" : provider.provider_slug;
	if (modelId.startsWith(`${prefix}/`)) return modelId;
	return `${prefix}/${modelId}`;
}

function textPrompt(body: ChatCompletionRequest): string {
	return body.messages.map((message) => {
		if (typeof message.content === "string") return `${message.role}: ${message.content}`;
		if (Array.isArray(message.content)) {
			const text = message.content
				.filter((part) => part && part.type === "text")
				.map((part) => part.type === "text" ? part.text : "")
				.join("\n");
			return `${message.role}: ${text}`;
		}
		return `${message.role}:`;
	}).join("\n");
}

function normalizeBindingCompletion(result: unknown, modelId: string): Record<string, unknown> {
	if (result && typeof result === "object") {
		const candidate = result as Record<string, unknown>;
		if (Array.isArray(candidate.choices)) return candidate;
		const text = typeof candidate.response === "string"
			? candidate.response
			: typeof candidate.output_text === "string"
				? candidate.output_text
				: typeof candidate.result === "string"
					? candidate.result
					: JSON.stringify(candidate);
		return {
			id: `cf-binding-${Date.now()}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: modelId,
			choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
		};
	}
	return {
		id: `cf-binding-${Date.now()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: modelId,
		choices: [{ index: 0, message: { role: "assistant", content: String(result ?? "") }, finish_reason: "stop" }],
	};
}

async function callWorkersBinding(
	provider: ProviderRow,
	modelId: string,
	body: ChatCompletionRequest,
	env: GatewayEnv,
	context: ProviderRequestContext = {},
): Promise<ProviderCallResult> {
	if (!env.AI) throw new Error("Workers AI binding is not configured");
	if (body.stream) {
		// Preserve OpenAI streaming semantics through Cloudflare's REST endpoint.
		return callCloudflareRest(provider, modelId, body, env, context);
	}
	const gatewayId = env.CF_AIG_GATEWAY_SLUG?.trim();
	if (!gatewayId) throw new Error("CF_AIG_GATEWAY_SLUG not configured");
	const started = Date.now();
	const ai = env.AI as unknown as {
		run: (model: string, input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
		aiGatewayLogId?: string;
	};
	const input: Record<string, unknown> = { messages: body.messages };
	for (const key of ["temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty"] as const) {
		if (body[key] !== undefined) input[key] = body[key];
	}
	const result = await ai.run(modelId, input, {
		gateway: {
			id: gatewayId,
			skipCache: true,
			collectLog: true,
			metadata: { source: "cf-control-mcp", provider_id: provider.id, ...(context.correlationId ? { correlation_id: context.correlationId } : {}) },
		},
	});
	const latencyMs = Date.now() - started;
	const gatewayLogId = ai.aiGatewayLogId || null;
	const response = new Response(JSON.stringify(normalizeBindingCompletion(result, modelId)), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			...(gatewayLogId ? { "cf-aig-log-id": gatewayLogId } : {}),
		},
	});
	return {
		response: corsResponse(response),
		providerId: provider.id,
		modelId,
		gatewayVerified: Boolean(gatewayLogId),
		gatewayLogId,
		gatewayStep: null,
		cfRay: null,
		httpStatus: 200,
		latencyMs,
	};
}

async function callCloudflareRest(
	provider: ProviderRow,
	modelId: string,
	body: ChatCompletionRequest,
	env: GatewayEnv,
	context: ProviderRequestContext = {},
): Promise<ProviderCallResult> {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
	const token = env.CLOUDFLARE_API_TOKEN?.trim();
	const gatewayId = env.CF_AIG_GATEWAY_SLUG?.trim();
	if (!accountId || !token || !gatewayId) throw new Error("Cloudflare REST AI is not configured");
	const started = Date.now();
	const upstream = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"cf-aig-gateway-id": gatewayId,
			"cf-aig-collect-log-payload": "false",
			...(context.correlationId ? { "cf-aig-metadata": JSON.stringify({ source: "cf-control-mcp", correlation_id: context.correlationId }) } : {}),
		},
		body: JSON.stringify({ ...body, model: unifiedModelName(provider, modelId) }),
	});
	const latencyMs = Date.now() - started;
	const evidence = evidenceFromResponse(upstream, latencyMs);
	return {
		response: corsResponse(upstream),
		providerId: provider.id,
		modelId,
		...evidence,
	};
}

async function callGatewayCompat(
	provider: ProviderRow,
	modelId: string,
	body: ChatCompletionRequest,
	env: GatewayEnv,
	context: ProviderRequestContext = {},
): Promise<ProviderCallResult> {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
	const gatewayId = env.CF_AIG_GATEWAY_SLUG?.trim();
	if (!accountId || !gatewayId) throw new Error("Cloudflare AI Gateway is not configured");
	const started = Date.now();
	const upstream = await fetch(`https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat/chat/completions`, {
		method: "POST",
		headers: gatewayHeaders(env, provider, context),
		body: JSON.stringify({ ...body, model: unifiedModelName(provider, modelId) }),
	});
	const latencyMs = Date.now() - started;
	return {
		response: corsResponse(upstream),
		providerId: provider.id,
		modelId,
		...evidenceFromResponse(upstream, latencyMs),
	};
}

async function callProviderNative(
	provider: ProviderRow,
	modelId: string,
	body: ChatCompletionRequest,
	env: GatewayEnv,
	context: ProviderRequestContext = {},
): Promise<ProviderCallResult> {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
	const gatewayId = env.CF_AIG_GATEWAY_SLUG?.trim();
	if (!accountId || !gatewayId) throw new Error("Cloudflare AI Gateway is not configured");
	const path = (provider.api_path || "chat/completions").replace(/^\/+/, "");
	const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${provider.provider_slug}/${path}`;
	const started = Date.now();
	const upstream = await fetch(url, {
		method: "POST",
		headers: gatewayHeaders(env, provider, context),
		body: JSON.stringify({ ...body, model: modelId }),
	});
	const latencyMs = Date.now() - started;
	return {
		response: corsResponse(upstream),
		providerId: provider.id,
		modelId,
		...evidenceFromResponse(upstream, latencyMs),
	};
}

function errorCall(provider: ProviderRow, modelId: string, status: number, message: string): ProviderCallResult {
	return {
		response: new Response(JSON.stringify({ error: { message, type: "provider_error" } }), {
			status,
			headers: { "Content-Type": "application/json", ...gatewayCorHeaders() },
		}),
		providerId: provider.id,
		modelId,
		gatewayVerified: false,
		gatewayLogId: null,
		gatewayStep: null,
		cfRay: null,
		httpStatus: status,
		latencyMs: null,
	};
}

export async function requestProviderChat(
	provider: ProviderRow,
	modelId: string,
	body: ChatCompletionRequest,
	env: GatewayEnv,
	context: ProviderRequestContext = {},
): Promise<ProviderCallResult> {
	if (provider.transport === "workers-ai-binding") return callWorkersBinding(provider, modelId, body, env, context);
	if (provider.transport === "cloudflare-rest") return callCloudflareRest(provider, modelId, body, env, context);
	if (provider.transport === "gateway-custom") return callProviderNative(provider, modelId, body, env, context);
	if (provider.transport === "gateway-native") {
		if (provider.provider_slug === "google-ai-studio" && (!provider.byok_alias || provider.byok_alias === "default")) {
			return callGatewayCompat(provider, modelId, body, env, context);
		}
		// Use Cloudflare's REST chat API only for providers documented on that
		// surface. OpenRouter/HuggingFace stay on their provider-native gateway
		// paths so an unsupported author/model prefix is never guessed.
		if (supportsCloudflareRestChat(provider.provider_slug) && (!provider.byok_alias || provider.byok_alias === "default")) {
			return callCloudflareRest(provider, modelId, body, env, context);
		}
		return callProviderNative(provider, modelId, body, env, context);
	}
	return errorCall(provider, modelId, 503, `Unsupported provider transport: ${provider.transport}`);
}

export function classifyProviderHealth(result: ProviderCallResult): { state: HealthState; errorMessage: string | null } {
	const status = result.httpStatus ?? result.response.status;
	if (result.response.ok && result.gatewayVerified) return { state: "HEALTHY", errorMessage: null };
	if (result.response.ok && !result.gatewayVerified) {
		return { state: "DEGRADED", errorMessage: "Upstream succeeded but Cloudflare AI Gateway evidence was not returned." };
	}
	if (status === 401 || status === 403) return { state: "AUTH_ERROR", errorMessage: `upstream ${status}` };
	if (status === 429) return { state: "RATE_LIMITED", errorMessage: "upstream 429" };
	return { state: "UPSTREAM_ERROR", errorMessage: `upstream ${status}` };
}

export function isRetryableProviderStatus(status: number): boolean {
	return status === 401 || status === 403 || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
}
