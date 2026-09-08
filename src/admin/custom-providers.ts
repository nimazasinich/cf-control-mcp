import type { AdminEnv } from "./types";

export interface CustomProviderCreateInput {
	name: string;
	slug: string;
	baseUrl: string;
	description?: string;
}

export interface CustomProviderResult {
	id: string;
	slug: string;
	baseUrl: string;
}

function requireCloudflareAdmin(env: AdminEnv): { accountId: string; token: string } {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
	const token = env.CLOUDFLARE_API_TOKEN?.trim();
	if (!accountId || !token) throw new Error("cloudflare_admin_not_configured");
	return { accountId, token };
}

export function normalizeCustomProviderSlug(value: string): string {
	const bare = value.trim().toLowerCase().replace(/^custom-/, "");
	if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(bare)) {
		throw new Error("invalid_custom_provider_slug");
	}
	return bare;
}

export function validateCustomProviderBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("invalid_custom_provider_base_url");
	}
	if (url.protocol !== "https:") throw new Error("custom_provider_requires_https");
	if (url.username || url.password || url.search || url.hash) throw new Error("custom_provider_base_url_must_not_contain_credentials_or_query");
	return url.toString().replace(/\/$/, "");
}

export async function createCloudflareCustomProvider(
	env: AdminEnv,
	input: CustomProviderCreateInput,
): Promise<CustomProviderResult> {
	const { accountId, token } = requireCloudflareAdmin(env);
	const slug = normalizeCustomProviderSlug(input.slug);
	const baseUrl = validateCustomProviderBaseUrl(input.baseUrl);
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/custom-providers`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			name: input.name.trim(),
			slug,
			base_url: baseUrl,
			description: input.description?.trim() || "Managed by cf-control-mcp",
			enable: true,
		}),
	});
	type CustomProviderApiResponse = {
		success?: boolean;
		result?: { id?: string; slug?: string; base_url?: string };
		errors?: Array<{ message?: string }>;
	};
	const data: CustomProviderApiResponse = await res.json<CustomProviderApiResponse>().catch(() => ({}));
	if (!res.ok || !data.success || !data.result?.id) {
		const detail = data.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
		throw new Error(`custom_provider_create_failed:${detail}`);
	}
	return {
		id: data.result.id,
		slug: data.result.slug || slug,
		baseUrl: data.result.base_url || baseUrl,
	};
}


export async function deleteCloudflareCustomProvider(env: AdminEnv, providerId: string): Promise<void> {
	const { accountId, token } = requireCloudflareAdmin(env);
	if (!providerId.trim()) throw new Error("custom_provider_id_required");
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/custom-providers/${encodeURIComponent(providerId)}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${token}` },
	});
	const data: { success?: boolean; errors?: Array<{ message?: string }> } = await res
		.json<{ success?: boolean; errors?: Array<{ message?: string }> }>()
		.catch(() => ({}));
	if (!res.ok || data.success === false) {
		const detail = data.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
		throw new Error(`custom_provider_delete_failed:${detail}`);
	}
}
