import type { ProviderAuthType, ProviderTransport } from "./types";

export interface KnownProviderTemplate {
	id: string;
	displayName: string;
	providerSlug: string;
	transport: ProviderTransport;
	authType: ProviderAuthType;
	allowedAuthTypes: readonly ProviderAuthType[];
	credentialRequired: boolean;
	baseUrl?: string;
	apiPath?: string;
	testModel?: string;
	description: string;
	customizable?: boolean;
}

/**
 * Native Cloudflare AI Gateway providers plus the special Antigravity profile.
 * No provider in this catalog is treated as configured merely because it is
 * listed here; D1 enablement + credential/readiness + a real test decide that.
 */
export const KNOWN_PROVIDER_TEMPLATES: readonly KnownProviderTemplate[] = [
	{ id: "workers-ai", displayName: "Workers AI", providerSlug: "workers-ai", transport: "workers-ai-binding", authType: "cloudflare-binding", allowedAuthTypes: ["cloudflare-binding"], credentialRequired: false, testModel: "@cf/zai-org/glm-4.7-flash", description: "Cloudflare Workers AI through the Worker AI binding and AI Gateway." },
	{ id: "google-ai-studio", displayName: "Google AI Studio", providerSlug: "google-ai-studio", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "Gemini models through Cloudflare AI Gateway BYOK." },
	{ id: "google-antigravity", displayName: "Google Antigravity / custom endpoint", providerSlug: "google-antigravity", transport: "gateway-custom", authType: "byok", allowedAuthTypes: ["byok", "none"], credentialRequired: true, description: "Custom HTTPS profile for an Antigravity-compatible endpoint. No official Cloudflare/Google native Antigravity API is assumed; base URL and model ID are required.", customizable: true },
	{ id: "openai", displayName: "OpenAI", providerSlug: "openai", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "OpenAI through Cloudflare AI Gateway." },
	{ id: "anthropic", displayName: "Anthropic", providerSlug: "anthropic", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "Anthropic through Cloudflare AI Gateway." },
	{ id: "deepseek", displayName: "DeepSeek", providerSlug: "deepseek", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "DeepSeek through Cloudflare AI Gateway." },
	{ id: "openrouter", displayName: "OpenRouter", providerSlug: "openrouter", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok"], credentialRequired: true, apiPath: "v1/chat/completions", description: "OpenRouter through Cloudflare AI Gateway." },
	{ id: "groq", displayName: "Groq", providerSlug: "groq", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "Groq through Cloudflare AI Gateway." },
	{ id: "mistral", displayName: "Mistral AI", providerSlug: "mistral", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "Mistral through Cloudflare AI Gateway." },
	{ id: "xai", displayName: "xAI", providerSlug: "xai", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "xAI through Cloudflare AI Gateway." },
	{ id: "perplexity", displayName: "Perplexity", providerSlug: "perplexity-ai", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "Perplexity through Cloudflare AI Gateway." },
	{ id: "cerebras", displayName: "Cerebras", providerSlug: "cerebras", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "Cerebras through Cloudflare AI Gateway." },
	{ id: "cohere", displayName: "Cohere", providerSlug: "cohere", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok", "cloudflare-unified"], credentialRequired: true, description: "Cohere through Cloudflare AI Gateway." },
	{ id: "huggingface", displayName: "Hugging Face", providerSlug: "huggingface", transport: "gateway-native", authType: "byok", allowedAuthTypes: ["byok"], credentialRequired: true, description: "Hugging Face through Cloudflare AI Gateway." },
	{
		id: "tabitoken",
		displayName: "TaBiToken (New API gateway)",
		providerSlug: "tabitoken",
		transport: "gateway-custom",
		authType: "byok",
		allowedAuthTypes: ["byok"],
		credentialRequired: true,
		baseUrl: "https://tabitoken.com",
		apiPath: "v1/chat/completions",
		testModel: "gpt-4o-mini",
		description: "Hosted New API-compatible gateway at tabitoken.com. OpenAI-compatible /v1 surface (also exposes native Claude /v1/messages and Gemini /v1beta routes upstream). The base URL defaults to the root domain — if GET /v1/models does not resolve, override it to https://api.tabitoken.com or the reported backup domain https://tabitoken.cc.",
		customizable: true,
	},
	{
		id: "gorouter",
		displayName: "GoRouter (New API gateway)",
		providerSlug: "gorouter",
		transport: "gateway-custom",
		authType: "byok",
		allowedAuthTypes: ["byok"],
		credentialRequired: true,
		baseUrl: "https://gorouter.app",
		apiPath: "v1/chat/completions",
		testModel: "gpt-4o-mini",
		description: "Hosted New API-compatible gateway at gorouter.app. Same OpenAI-compatible request/response schema as TaBiToken. The base URL defaults to the root domain — if GET /v1/models does not resolve, override it to https://api.gorouter.app.",
		customizable: true,
	},
	{
		id: "new-api",
		displayName: "New API (self-hosted / other instance)",
		providerSlug: "new-api",
		transport: "gateway-custom",
		authType: "byok",
		allowedAuthTypes: ["byok"],
		credentialRequired: true,
		apiPath: "v1/chat/completions",
		testModel: "gpt-4o-mini",
		description: "Any self-hosted or third-party deployment of New API (QuantumNous/new-api) — the same open-source project that powers TaBiToken and GoRouter. Supply the deployment's own HTTPS base URL (e.g. https://your-host:3000).",
		customizable: true,
	},
	{ id: "custom", displayName: "Custom OpenAI-compatible", providerSlug: "custom", transport: "gateway-custom", authType: "byok", allowedAuthTypes: ["byok", "none"], credentialRequired: true, description: "Any HTTPS OpenAI-compatible provider provisioned as a Cloudflare Custom Provider.", customizable: true },
] as const;

export function knownProviderTemplate(id: string): KnownProviderTemplate | undefined {
	return KNOWN_PROVIDER_TEMPLATES.find((entry) => entry.id === id);
}

export function isProviderTransport(value: unknown): value is ProviderTransport {
	return value === "gateway-native" || value === "gateway-custom" || value === "cloudflare-rest" || value === "workers-ai-binding";
}

export function isProviderAuthType(value: unknown): value is ProviderAuthType {
	return value === "byok" || value === "cloudflare-unified" || value === "cloudflare-binding" || value === "none";
}


const CLOUDFLARE_REST_CHAT_PROVIDERS = new Set([
	"openai", "anthropic", "groq", "mistral", "cohere", "perplexity-ai",
	"google-ai-studio", "google-vertex-ai", "xai", "deepseek", "cerebras", "baseten", "parallel",
]);

/** True when Cloudflare's /ai/v1/chat/completions REST API documents this provider. */
export function supportsCloudflareRestChat(providerSlug: string): boolean {
	return CLOUDFLARE_REST_CHAT_PROVIDERS.has(providerSlug);
}
