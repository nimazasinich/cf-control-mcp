/**
 * v1.8 Admin Console — credential management.
 *
 * Flow: Admin UI → this authenticated Worker admin API → Cloudflare AI
 * Gateway provider_configs API (which stores the value in Secrets Store
 * server-side). The raw credential is read once from the request body,
 * forwarded to Cloudflare, and never written to D1 or returned to the
 * browser afterwards.
 *
 * Reference: POST /accounts/{account_id}/ai-gateway/gateways/{gateway_id}/provider_configs
 */
import type { AdminEnv } from "./types";

export async function setProviderCredential(
	env: AdminEnv,
	providerSlug: string,
	alias: string,
	rawSecretValue: string,
): Promise<{ ok: true; secretId: string } | { ok: false; error: string }> {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG) {
		return { ok: false, error: "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or CF_AIG_GATEWAY_SLUG not configured" };
	}

	const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.CF_AIG_GATEWAY_SLUG}/provider_configs`;

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			provider_slug: providerSlug,
			alias,
			default_config: true,
			secret: rawSecretValue,
		}),
	});

	const body = await res.json<{ success: boolean; result?: { secret_id: string }; errors?: Array<{ message: string }> }>();
	if (!res.ok || !body.success) {
		const msg = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
		return { ok: false, error: msg };
	}
	return { ok: true, secretId: body.result!.secret_id };
}

export async function deleteProviderCredential(
	env: AdminEnv,
	providerSlug: string,
	alias: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG) {
		return { ok: false, error: "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or CF_AIG_GATEWAY_SLUG not configured" };
	}

	const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.CF_AIG_GATEWAY_SLUG}/provider_configs/${providerSlug}?alias=${alias}`;

	const res = await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
			"Content-Type": "application/json",
		},
	});

	if (res.status === 204 || res.status === 200 || res.status === 404) {
		return { ok: true };
	}

	const body = await res.json<{ success: boolean; errors?: Array<{ message: string }> }>().catch(() => ({ success: false } as { success: boolean; errors?: Array<{ message: string }> }));
	const msg = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
	return { ok: false, error: msg };
}
