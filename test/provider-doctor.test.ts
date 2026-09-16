import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderRow } from "../src/admin/types";
import { redactText } from "../src/provider-doctor/redaction";
import { auditProviderModels } from "../src/provider-doctor/model-audit";
import { classifyProvider } from "../src/provider-doctor/classifier";
import mcpWorker, { type Env } from "../src/index";
import { handleAdmin } from "../src/admin/router";
import { createSessionCookie } from "../src/admin/auth";
import { checkAdminSameOrigin } from "../src/admin/request-security";
import type { AdminEnv } from "../src/admin/types";

function provider(overrides: Partial<ProviderRow> = {}): ProviderRow {
	return {
		id: "p",
		display_name: "Provider",
		kind: "openai",
		provider_slug: "openai",
		transport: "gateway-native",
		auth_type: "byok",
		base_url: null,
		api_path: null,
		priority: 10,
		credential_required: 1,
		custom_provider_id: null,
		test_model: "m1",
		enabled: 1,
		byok_alias: "default",
		health_state: "HEALTHY",
		last_success_at: new Date().toISOString(),
		last_error_at: null,
		last_error_message: null,
		last_latency_ms: 10,
		last_http_status: 200,
		last_gateway_log_id: "log-1",
		last_gateway_step: "upstream",
		last_cf_ray: "ray-1",
		created_at: "",
		updated_at: "",
		...overrides,
	};
}

test("redacts common token formats", () => {
	const out = redactText("Authorization: Bearer sk-example-super-secret-value");
	assert.equal(out.includes("super-secret-value"), false);
	assert.equal(out.includes("<REDACTED>"), true);
});

test("model audit reports enabled/disabled and route aliases", () => {
	const p = provider();
	const result = auditProviderModels(
		p,
		[
			{ id: "m1", provider_id: "p", public_alias: null, enabled: 1, free_tier: 0, display_name: null, description: null, created_at: "" },
			{ id: "m2", provider_id: "p", public_alias: "public-p", enabled: 0, free_tier: 0, display_name: null, description: null, created_at: "" },
		],
		[{ public_alias: "fast", model_id: "m1", updated_at: "" }],
	);
	assert.equal(result.total, 2);
	assert.equal(result.enabled, 1);
	assert.deepEqual(result.routedAliases, ["fast"]);
	assert.equal(result.testModelRegistered, true);
	assert.equal(result.testModelEnabled, true);
});

test("healthy requires verified gateway evidence", () => {
	const p = provider();
	const result = classifyProvider(
		p,
		{
			enabled: true,
			configured: true,
			credentialReady: true,
			runtimeReady: true,
			healthVerified: true,
			gatewayVerified: true,
			callable: true,
			reasons: [],
			networkState: "gateway-verified",
		},
		{ stale: false, freshness: "recent" },
	);
	assert.equal(result.diagnosis, "HEALTHY");
});

test("auth error wins diagnosis priority", () => {
	const p = provider({ health_state: "AUTH_ERROR", last_error_message: "upstream 401" });
	const result = classifyProvider(
		p,
		{
			enabled: true,
			configured: true,
			credentialReady: true,
			runtimeReady: true,
			healthVerified: false,
			gatewayVerified: false,
			callable: false,
			reasons: ["health_not_verified"],
			networkState: "auth_error",
		},
		{ stale: false, freshness: "not-healthy" },
	);
	assert.equal(result.diagnosis, "AUTH_ERROR");
});

test("classification fails closed when gateway evidence is missing despite an otherwise healthy signal", () => {
	const p = provider();
	const result = classifyProvider(
		p,
		{
			enabled: true,
			configured: true,
			credentialReady: true,
			runtimeReady: true,
			healthVerified: true,
			gatewayVerified: false,
			callable: false,
			reasons: ["gateway_evidence_missing"],
			networkState: "not-verified",
		},
		{ stale: false, freshness: "recent" },
	);
	assert.notEqual(result.diagnosis, "HEALTHY");
});

function auditOnlyDb(): D1Database {
	return {
		prepare(_query: string) {
			const stmt: any = {
				bind: (..._args: unknown[]) => stmt,
				run: async () => ({ success: true, meta: { changes: 1 } }),
				first: async () => null,
				all: async () => ({ results: [] }),
			};
			return stmt;
		},
		batch: async () => [],
	} as unknown as D1Database;
}

async function rpc(env: Env, method: string, params?: Record<string, unknown>) {
	const response = await mcpWorker.fetch(new Request("https://worker.example/mcp", {
		method: "POST",
		headers: { Authorization: `Bearer ${env.MCP_AUTH_TOKEN}`, "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
	}), env);
	return { response, body: await response.json() as any };
}

function readOnlyEnv(): Env {
	return {
		MCP_AUTH_TOKEN: "inner-token",
		CLOUDFLARE_API_TOKEN: "unused",
		CLOUDFLARE_ACCOUNT_ID: "acct",
		DM_DB: auditOnlyDb(),
		MCP_AUTHZ_MODE: "oauth",
		MCP_AUTHZ_SCOPES: "mcp:read",
	} as Env;
}

test("Provider Doctor: tools/list exposes read tools but hides execute/admin tools under mcp:read", async () => {
	const { body } = await rpc(readOnlyEnv(), "tools/list");
	const names = new Set(body.result.tools.map((tool: any) => tool.name));
	assert.equal(names.has("provider_doctor_summary"), true);
	assert.equal(names.has("provider_doctor_provider"), true);
	assert.equal(names.has("provider_doctor_history"), true);
	assert.equal(names.has("provider_doctor_probe"), false);
	assert.equal(names.has("provider_doctor_probe_record"), false);
});

test("Provider Doctor: tools/call rejects provider_doctor_probe without mcp:execute", async () => {
	const { body } = await rpc(readOnlyEnv(), "tools/call", {
		name: "provider_doctor_probe",
		arguments: {},
	});
	assert.equal(body.error.code, -32001);
	assert.match(body.error.message, /mcp:execute/);
});

test("Provider Doctor: tools/call rejects provider_doctor_probe_record without mcp:admin", async () => {
	const env = { ...readOnlyEnv(), MCP_AUTHZ_SCOPES: "mcp:read mcp:execute" } as Env;
	const { body } = await rpc(env, "tools/call", {
		name: "provider_doctor_probe_record",
		arguments: {},
	});
	assert.equal(body.error.code, -32001);
	assert.match(body.error.message, /mcp:admin/);
});

test("Provider Doctor: tools/call validates provider_doctor_provider arguments before running", async () => {
	const { body } = await rpc(readOnlyEnv(), "tools/call", {
		name: "provider_doctor_provider",
		arguments: {},
	});
	assert.equal(body.error.code, -32602);
	assert.match(JSON.stringify(body.error.data), /provider_id/);
});

test("Provider Doctor: tools/call allows provider_doctor_summary under mcp:read and never returns raw secrets", async () => {
	const { body } = await rpc(readOnlyEnv(), "tools/call", { name: "provider_doctor_summary", arguments: {} });
	assert.equal(body.error, undefined);
	const text = body.result.content[0].text as string;
	assert.equal(/sk-[a-zA-Z0-9]{10,}/.test(text), false);
	assert.equal(text.includes("CLOUDFLARE_API_TOKEN"), false);
});

function mockAdminEnv(): AdminEnv {
	return { MCP_AUTH_TOKEN: "owner-secret", DM_DB: auditOnlyDb() };
}

test("Admin auth boundary: Provider Doctor summary is unreachable without a session", async () => {
	const env = mockAdminEnv();
	const request = new Request("https://worker.example/admin/api/provider-doctor/summary");
	const response = await handleAdmin(request, env);
	assert.equal(response.status, 401);
});

test("Admin auth boundary: Provider Doctor probe is unreachable without a session", async () => {
	const env = mockAdminEnv();
	const request = new Request("https://worker.example/admin/api/provider-doctor/probe", {
		method: "POST",
		headers: { Origin: "https://worker.example", "Content-Type": "application/json" },
		body: "{}",
	});
	const response = await handleAdmin(request, env);
	assert.equal(response.status, 401);
});

test("same-origin guard rejects cross-origin Provider Doctor POST endpoints", () => {
	const rejected = checkAdminSameOrigin(new Request("https://worker.example/admin/api/provider-doctor/probe", {
		method: "POST",
		headers: { Origin: "https://attacker.example" },
	}));
	assert.equal(rejected.ok, false);
	const missing = checkAdminSameOrigin(new Request("https://worker.example/admin/api/provider-doctor/probe-record", {
		method: "POST",
	}));
	assert.equal(missing.ok, false);
});

test("Admin same-origin guard runs before authentication for Provider Doctor POST endpoints", async () => {
	const env = mockAdminEnv();
	const request = new Request("https://worker.example/admin/api/provider-doctor/probe", {
		method: "POST",
		headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
		body: "{}",
	});
	const response = await handleAdmin(request, env);
	assert.equal(response.status, 403);
	const payload: any = await response.json();
	assert.equal(payload.error, "forbidden_origin");
});

test("Admin session: authenticated GET reaches Provider Doctor summary and returns a real snapshot shape", async () => {
	const env = mockAdminEnv();
	const setCookie = await createSessionCookie(env);
	const cookie = setCookie.split(";", 1)[0];
	const request = new Request("https://worker.example/admin/api/provider-doctor/summary", {
		headers: { Cookie: cookie },
	});
	const response = await handleAdmin(request, env);
	assert.equal(response.status, 200);
	const payload: any = await response.json();
	assert.equal(payload.ok, true);
	assert.equal(typeof payload.doctor.providerCount, "number");
});
