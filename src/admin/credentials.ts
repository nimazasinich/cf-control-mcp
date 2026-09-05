/**
 * v1.8 Admin Console — credential management.
 */
import type { AdminEnv } from "./types";

export interface SetCredentialResult {
	ok: boolean;
	configured: boolean;
	providerConfigLinked: boolean;
	secretId?: string;
	error?: string;
}

export interface DeleteCredentialResult {
	ok: boolean;
	providerConfigDeleted: boolean;
	credentialRevoked: boolean;
	error?: string;
}

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

async function pollSecretActive(env: AdminEnv, storeId: string, secretId: string): Promise<boolean> {
	for (let i = 0; i < 6; i++) {
		const res = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets/${secretId}`,
			{ headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
		);
		if (res.ok) {
			const data = await res.json<{ success: boolean; result?: { status?: string } }>();
			if (data.success) {
				const status = data.result?.status;
				if (status === "active" || status === undefined) return true;
			}
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

export async function setProviderCredential(
	env: AdminEnv,
	providerSlug: string,
	alias: string,
	rawSecretValue: string,
): Promise<SetCredentialResult> {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG) {
		return { ok: false, configured: false, providerConfigLinked: false, error: "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or CF_AIG_GATEWAY_SLUG not configured" };
	}

	const storeId = await getSecretsStoreId(env);
	if (!storeId) return { ok: false, configured: false, providerConfigLinked: false, error: "No Secrets Store found" };

	const secretName = `${env.CF_AIG_GATEWAY_SLUG}_${providerSlug}_${alias}`;
	let secretId = "";

	// Step 1: Discover existing secret to decide POST vs PATCH
	const listRes = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets`,
		{ headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
	);
	const listData = await listRes.json<{ success: boolean; result?: Array<{ id: string; name: string }> }>();
	const existingSecret = listData.result?.find((s) => s.name === secretName);

	if (existingSecret) {
		// PATCH existing
		secretId = existingSecret.id;
		const patchRes = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets/${secretId}`,
			{
				method: "PATCH",
				headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
				body: JSON.stringify({ value: rawSecretValue, scopes: ["ai_gateway"], comment: "Rotated via cf-control-mcp" }),
			}
		);
		if (!patchRes.ok) return { ok: false, configured: false, providerConfigLinked: false, error: `Secret PATCH failed: ${patchRes.status}` };
	} else {
		// POST new
		const postRes = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
				body: JSON.stringify([{ name: secretName, value: rawSecretValue, scopes: ["ai_gateway"] }]),
			}
		);
		const postData = await postRes.json<{ success: boolean; result?: Array<{ id: string }> }>();
		if (!postData.success || !postData.result?.[0]?.id) return { ok: false, configured: false, providerConfigLinked: false, error: "Secret POST failed" };
		secretId = postData.result[0].id;
	}

	// Verify activation
	const isActive = await pollSecretActive(env, storeId, secretId);
	if (!isActive) {
		return { ok: false, configured: false, providerConfigLinked: false, error: "Secret activation timed out" };
	}

	// Step 2: Idempotent Provider Config linkage
	const pcUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.CF_AIG_GATEWAY_SLUG}/provider_configs`;
	const getPcRes = await fetch(pcUrl, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
	const getPcData = await getPcRes.json<{ success: boolean; result?: Array<{ id: string; provider_slug: string; alias: string }> }>();
	const existingConfig = getPcData.result?.find((c) => c.provider_slug === providerSlug && c.alias === alias);

	if (existingConfig) {
		return { ok: true, configured: true, providerConfigLinked: true, secretId };
	}

	const postPcRes = await fetch(pcUrl, {
		method: "POST",
		headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
		body: JSON.stringify({ provider_slug: providerSlug, alias, default_config: true }),
	});
	const postPcData = await postPcRes.json<{ success: boolean; errors?: Array<{ message: string }> }>();

	if (postPcRes.ok && postPcData.success) {
		return { ok: true, configured: true, providerConfigLinked: true, secretId };
	}

	const msg = postPcData.errors?.map((e) => e.message).join("; ") || `HTTP ${postPcRes.status}`;
	return { ok: false, configured: true, providerConfigLinked: false, error: msg };
}

export async function deleteProviderCredential(
	env: AdminEnv,
	providerSlug: string,
	alias: string,
): Promise<DeleteCredentialResult> {
	if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG) {
		return { ok: false, providerConfigDeleted: false, credentialRevoked: false, error: "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or CF_AIG_GATEWAY_SLUG not configured" };
	}

	let providerConfigDeleted = false;
	
	// Step 1: Try undocumented DELETE (by finding ID first)
	const pcUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.CF_AIG_GATEWAY_SLUG}/provider_configs`;
	const getPcRes = await fetch(pcUrl, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
	const getPcData = await getPcRes.json<{ success: boolean; result?: Array<{ id: string; provider_slug: string; alias: string }> }>();
	const existingConfig = getPcData.result?.find((c) => c.provider_slug === providerSlug && c.alias === alias);

	if (existingConfig) {
		const delPcRes = await fetch(`${pcUrl}/${existingConfig.id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
		}).catch(() => null);
		if (delPcRes?.ok) {
			providerConfigDeleted = true;
		}
	} else {
		// If it didn't exist, we consider it deleted.
		providerConfigDeleted = true;
	}

	let credentialRevoked = false;

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
			const delSecRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${storeId}/secrets/${target.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
			}).catch(() => null);
			if (delSecRes?.ok) credentialRevoked = true;
		} else {
			credentialRevoked = true;
		}
	}

	const ok = providerConfigDeleted && credentialRevoked;
	return { ok, providerConfigDeleted, credentialRevoked };
}

