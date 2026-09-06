import test from "node:test";
import assert from "node:assert";
import { setProviderCredential, deleteProviderCredential } from "../src/admin/credentials";
import { testGoogleAiStudio } from "../src/admin/health";
import { resolveModel } from "../src/provider-gateway/cloudflare-ai-gateway";

test("BYOK Idempotency: setProviderCredential reuses existing config", async (t) => {
	const origFetch = global.fetch;
	try {
		// Mock fetch to simulate existing provider config
		global.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const urlStr = url.toString();
			if (urlStr.includes("secrets_store/stores/")) {
				if (urlStr.endsWith("/secrets")) {
					return new Response(JSON.stringify({ success: true, result: [{ id: "sec-1", name: "test_google-ai-studio_default" }] }));
				}
				if (init?.method === "PATCH") {
					return new Response(JSON.stringify({ success: true }));
				}
				// pollSecretActive mock
				return new Response(JSON.stringify({ success: true, result: { status: "active" } }));
			}
			if (urlStr.includes("secrets_store/stores")) {
				return new Response(JSON.stringify({ success: true, result: [{ id: "store-1", name: "default_secrets_store" }] }));
			}
			if (urlStr.includes("provider_configs")) {
				if (init?.method === "GET" || init?.method === undefined) {
					// Simulate already existing
					return new Response(JSON.stringify({
						success: true,
						result: [{ id: "pc-1", provider_slug: "google-ai-studio", alias: "default" }]
					}));
				}
				if (init?.method === "POST") {
					assert.fail("Should not POST if provider config already exists");
				}
			}
			return new Response(JSON.stringify({ success: true }));
		};

		const env = {
			CLOUDFLARE_API_TOKEN: "mock-token",
			CLOUDFLARE_ACCOUNT_ID: "mock-account",
			CF_AIG_GATEWAY_SLUG: "test",
		} as any;

		const result = await setProviderCredential(env, "google-ai-studio", "default", "val");
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.providerConfigLinked, true);
	} finally {
		global.fetch = origFetch;
	}
});

test("BYOK Secret Status Polling: timeouts gracefully", async (t) => {
	const origFetch = global.fetch;
	try {
		global.fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const urlStr = url.toString();
			if (urlStr.includes("secrets_store/stores/")) {
				if (urlStr.endsWith("/secrets")) {
					if (init?.method === "POST") {
						return new Response(JSON.stringify({ success: true, result: [{ id: "sec-new" }] }));
					}
					return new Response(JSON.stringify({ success: true, result: [] })); // no existing secret
				}
				// Polling endpoint always returns pending
				return new Response(JSON.stringify({ success: true, result: { status: "pending" } }));
			}
			if (urlStr.includes("secrets_store/stores")) {
				return new Response(JSON.stringify({ success: true, result: [{ id: "store-1", name: "default_secrets_store" }] }));
			}
			return new Response(JSON.stringify({ success: true }));
		};

		const env = {
			CLOUDFLARE_API_TOKEN: "mock-token",
			CLOUDFLARE_ACCOUNT_ID: "mock-account",
			CF_AIG_GATEWAY_SLUG: "test",
		} as any;

		const result = await setProviderCredential(env, "google-ai-studio", "default", "val");
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.error, "Secret activation timed out");
	} finally {
		global.fetch = origFetch;
	}
});

test("Admin Health Check enforces CF_AIG_TOKEN", async (t) => {
	const env = {
		CLOUDFLARE_ACCOUNT_ID: "acc",
		CF_AIG_GATEWAY_SLUG: "slug",
		// MISSING CF_AIG_TOKEN
	} as any;
	const res = await testGoogleAiStudio(env);
	assert.strictEqual(res.state, "NOT_CONFIGURED");
	assert.ok(res.errorMessage?.includes("CF_AIG_TOKEN"));
});

test("Gateway resolveModel default aliases", async (t) => {
	const env = {} as any;
	const fast = await resolveModel("fast", env);
	const coding = await resolveModel("coding", env);
	assert.strictEqual(fast, "gemini-3.6-flash");
	assert.strictEqual(coding, "gemini-3.8-flash");
});
