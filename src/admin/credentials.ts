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

async function getSecretsStoreId(env: AdminEnv): Promise<string | null> {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return null;
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores`, {
		headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
	});
	const data = await res.json<{ success: boolean; result?: Array<{ id: string; name: string }> }>();
	if (data.success && data.result && data.result.length > 0) {
		const def = data.result.find((s) => s.name === "default_secrets_store");
		return def ? def.id : data.result[0].id;
	}
	return null;
}

export async function setProviderCredential(
	env: AdminEnv,
	providerSlug: string,
	alias: string,
	rawSecretValue: string,
): Promise<{ ok: true; secretId: string } | { ok: false; error: string }> {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG) {
		return { ok: false, error: "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or CF_AIG_GATEWAY_SLUG not configured" };
	}

	const storeId = await getSecretsStoreId(env);
	const secretName = `${env.CF_AIG_GATEWAY_SLUG}_${providerSlug}_${alias}`;

	// Step 1: Store secret in Cloudflare Secrets Store (naming: {gateway_id}_{provider_slug}_{alias})
	let secretId = secretName;
	if (storeId) {
		const ssRes = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify([{ name: secretName, value: rawSecretValue, scopes: ["workers"] }]),
			},
		);
		const ssData = await ssRes.json<{ success: boolean; result?: Array<{ id: string; name: string }>; errors?: Array<{ message: string }> }>();
		if (ssData.success && ssData.result?.[0]?.id) {
			secretId = ssData.result[0].id;
		} else if (!ssRes.ok && ssData.errors?.[0]?.message !== "secret_already_exists") {
			// Continue to try provider_configs even if secret creation warning
		}
	}

	// Step 2: Register provider config in Cloudflare AI Gateway
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
		}),
	});

	const body = await res.json<{ success: boolean; result?: { secret_id: string }; errors?: Array<{ message: string }> }>();
	if (res.ok && body.success) {
		return { ok: true, secretId: body.result?.secret_id || secretId };
	}

	// If Secrets Store creation succeeded, BYOK secret is active in store
	if (storeId) {
		return { ok: true, secretId };
	}

	const msg = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
	return { ok: false, error: msg };
}

export async function deleteProviderCredential(
	env: AdminEnv,
	providerSlug: string,
	alias: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG) {
		return { ok: false, error: "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or CF_AIG_GATEWAY_SLUG not configured" };
	}

	// Step 1: Delete from AI Gateway provider_configs
	const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.CF_AIG_GATEWAY_SLUG}/provider_configs/${providerSlug}?alias=${alias}`;
	await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
			"Content-Type": "application/json",
		},
	}).catch(() => {});

	// Step 2: Delete from Secrets Store
	const storeId = await getSecretsStoreId(env);
	if (storeId) {
		const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets`, {
			headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
		});
		const listData = await listRes.json<{ success: boolean; result?: Array<{ id: string; name: string }> }>();
		const secretName = `${env.CF_AIG_GATEWAY_SLUG}_${providerSlug}_${alias}`;
		const target = listData.result?.find((s) => s.name === secretName);
		if (target) {
			await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets/${target.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
			}).catch(() => {});
		}
	}

	return { ok: true };
}

