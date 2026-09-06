/**
 * v1.8 Admin Console — router.
 * Owner-only auth (session cookie signed with MCP_AUTH_TOKEN). Never
 * protected only by GATEWAY_AUTH_TOKEN. Called for any /admin* path.
 */
import type { AdminEnv } from "./types";
import { createSessionCookie, clearSessionCookie, isAuthenticated } from "./auth";
import { loginPageHtml, dashboardHtml } from "./ui";
import {
	listProviders,
	setProviderEnabled,
	recordHealthResult,
	logAudit,
	recentAudit,
	getProvider,
	setProviderAlias,
	listModels,
	listRoutingRules,
	listRecentHealthChecks,
	getModel,
	setModelEnabled,
	getRoutingRulesForModel,
} from "./db";
import { testGoogleAiStudio } from "./health";
import { setProviderCredential, deleteProviderCredential } from "./credentials";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Safe boolean validation: only actual booleans are accepted. */
function parseBoolean(value: unknown): { ok: true; value: boolean } | { ok: false } {
	if (value === true || value === false) return { ok: true, value };
	return { ok: false };
}

/** Parse request body as JSON; return null if malformed. */
async function safeJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
	try {
		return await request.json<T>();
	} catch {
		return null;
	}
}

export async function handleAdmin(request: Request, env: AdminEnv): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	if (path === "/admin/login" && request.method === "POST") {
		const form = await request.formData();
		const token = form.get("token");
		if (typeof token !== "string" || !env.MCP_AUTH_TOKEN || token !== env.MCP_AUTH_TOKEN) {
			return new Response(loginPageHtml("Invalid token"), { status: 401, headers: { "Content-Type": "text/html" } });
		}
		const cookie = await createSessionCookie(env);
		await logAudit(env, "admin.login", null, null);
		return new Response(null, { status: 302, headers: { Location: "/admin", "Set-Cookie": cookie } });
	}

	if (path === "/admin/logout" && request.method === "POST") {
		return new Response(null, { status: 302, headers: { Location: "/admin", "Set-Cookie": clearSessionCookie() } });
	}

	const authed = await isAuthenticated(request, env);

	if (path === "/admin" && request.method === "GET") {
		if (!authed) return new Response(loginPageHtml(), { headers: { "Content-Type": "text/html" } });
		return new Response(dashboardHtml(), { headers: { "Content-Type": "text/html" } });
	}

	if (!authed) return json({ ok: false, error: "unauthorized" }, 401);

	// -------------------------------------------------------------------------
	// GET /admin/api/overview — enriched operational stats
	// -------------------------------------------------------------------------
	if (path === "/admin/api/overview" && request.method === "GET") {
		const [providers, models, rules] = await Promise.all([
			listProviders(env),
			listModels(env),
			listRoutingRules(env),
		]);
		const enabledProviders = providers.filter((p) => p.enabled);
		const healthyProviders = providers.filter((p) => p.health_state === "HEALTHY");
		const enabledModels = models.filter((m) => {
			if (!m.enabled) return false;
			const provider = providers.find((p) => p.id === m.provider_id);
			return provider?.enabled ?? false;
		});
		const disabledModels = models.filter((m) => !m.enabled);
		const activeRoutes = rules.filter((r) => r.model_enabled && r.provider_enabled);
		const unavailableRoutes = rules.filter((r) => !r.model_enabled || !r.provider_enabled);

		return json({
			providerCount: providers.length,
			enabledProviderCount: enabledProviders.length,
			healthyCount: healthyProviders.length,
			modelCount: models.length,
			enabledModelCount: enabledModels.length,
			disabledModelCount: disabledModels.length,
			routingRuleCount: rules.length,
			activeRoutingCount: activeRoutes.length,
			unavailableRoutingCount: unavailableRoutes.length,
		});
	}

	// -------------------------------------------------------------------------
	// GET /admin/api/providers
	// -------------------------------------------------------------------------
	if (path === "/admin/api/providers" && request.method === "GET") {
		return json({ providers: await listProviders(env) });
	}

	// -------------------------------------------------------------------------
	// GET /admin/api/models
	// -------------------------------------------------------------------------
	if (path === "/admin/api/models" && request.method === "GET") {
		return json({ models: await listModels(env) });
	}

	// -------------------------------------------------------------------------
	// GET /admin/api/routing
	// -------------------------------------------------------------------------
	if (path === "/admin/api/routing" && request.method === "GET") {
		return json({ rules: await listRoutingRules(env) });
	}

	// -------------------------------------------------------------------------
	// GET /admin/api/health
	// -------------------------------------------------------------------------
	if (path === "/admin/api/health" && request.method === "GET") {
		return json({ checks: await listRecentHealthChecks(env) });
	}

	// -------------------------------------------------------------------------
	// GET /admin/api/usage
	// -------------------------------------------------------------------------
	if (path === "/admin/api/usage" && request.method === "GET") {
		const logs = await recentAudit(env, 100);
		return json({
			totalAuditEvents: logs.length,
			recentActions: logs.slice(0, 10).map((l: any) => ({ action: l.action, at: l.at })),
		});
	}

	// -------------------------------------------------------------------------
	// GET /admin/api/settings
	// -------------------------------------------------------------------------
	if (path === "/admin/api/settings" && request.method === "GET") {
		return json({
			gatewaySlug: env.CF_AIG_GATEWAY_SLUG || "cf-control-mcp",
			accountIdMasked: env.CLOUDFLARE_ACCOUNT_ID
				? `${env.CLOUDFLARE_ACCOUNT_ID.slice(0, 6)}...${env.CLOUDFLARE_ACCOUNT_ID.slice(-4)}`
				: "not configured",
			d1Database: "DM_DB",
			hasCfToken: Boolean(env.CLOUDFLARE_API_TOKEN),
			hasGatewayAuth: Boolean(env.GATEWAY_AUTH_TOKEN),
			hasMcpAuth: Boolean(env.MCP_AUTH_TOKEN),
			version: "1.8.1",
		});
	}

	// -------------------------------------------------------------------------
	// GET /admin/api/logs
	// -------------------------------------------------------------------------
	if (path === "/admin/api/logs" && request.method === "GET") {
		return json({ events: await recentAudit(env) });
	}

	// -------------------------------------------------------------------------
	// PATCH /admin/api/models/:id  — enable/disable a model
	// -------------------------------------------------------------------------
	const modelMatch = path.match(/^\/admin\/api\/models\/([^/]+)$/);
	if (modelMatch && request.method === "PATCH") {
		const id = modelMatch[1];
		const body = await safeJson<{ enabled: unknown }>(request);
		if (!body) return json({ ok: false, error: "invalid_json" }, 400);

		const parsed = parseBoolean(body.enabled);
		if (!parsed.ok) return json({ ok: false, error: "enabled_must_be_boolean" }, 400);

		const existing = await getModel(env, id);
		if (!existing) return json({ ok: false, error: "model_not_found" }, 404);

		// Warn about affected routing aliases before disabling
		const affectedRoutes = !parsed.value ? await getRoutingRulesForModel(env, id) : [];

		const { rowsAffected } = await setModelEnabled(env, id, parsed.value);
		if (rowsAffected === 0) return json({ ok: false, error: "model_not_found" }, 404);

		await logAudit(
			env,
			parsed.value ? "model.enable" : "model.disable",
			id,
			affectedRoutes.length > 0 ? `affected_aliases: ${affectedRoutes.map((r) => r.public_alias).join(",")}` : null,
		);

		const updated = await getModel(env, id);
		return json({
			ok: true,
			model: updated,
			affectedAliases: affectedRoutes.map((r) => r.public_alias),
		});
	}

	// -------------------------------------------------------------------------
	// /admin/api/providers/:id  — provider management
	// -------------------------------------------------------------------------
	const providerMatch = path.match(/^\/admin\/api\/providers\/([^/]+)(\/([^/]+))?$/);
	if (providerMatch) {
		const id = providerMatch[1];
		const action = providerMatch[3];

		// PATCH /admin/api/providers/:id — enable/disable
		if (!action && request.method === "PATCH") {
			const body = await safeJson<{ enabled: unknown }>(request);
			if (!body) return json({ ok: false, error: "invalid_json" }, 400);

			const parsed = parseBoolean(body.enabled);
			if (!parsed.ok) return json({ ok: false, error: "enabled_must_be_boolean" }, 400);

			const existing = await getProvider(env, id);
			if (!existing) return json({ ok: false, error: "provider_not_found" }, 404);

			const { rowsAffected } = await setProviderEnabled(env, id, parsed.value);
			if (rowsAffected === 0) return json({ ok: false, error: "provider_not_found" }, 404);

			await logAudit(env, parsed.value ? "provider.enable" : "provider.disable", id, null);
			const updated = await getProvider(env, id);
			return json({ ok: true, provider: updated });
		}

		// POST /admin/api/providers/:id/health-test
		if (action === "health-test" && request.method === "POST") {
			const provider = await getProvider(env, id);
			if (!provider) return json({ ok: false, error: "provider_not_found" }, 404);
			const result =
				id === "google-ai-studio"
					? await testGoogleAiStudio(env)
					: { state: "NOT_CONFIGURED" as const, latencyMs: null, errorMessage: "no health check implemented for this provider" };
			await recordHealthResult(env, id, result.state, result.latencyMs, result.errorMessage);
			await logAudit(env, "provider.health-test", id, result.state);
			return json(result);
		}

		// POST /admin/api/providers/:id/credential
		if (action === "credential" && request.method === "POST") {
			const body = await safeJson<{ value: unknown }>(request);
			if (!body) return json({ ok: false, error: "invalid_json" }, 400);
			if (typeof body.value !== "string" || !body.value.trim())
				return json({ ok: false, error: "value_required" }, 400);

			const provider = await getProvider(env, id);
			if (!provider) return json({ ok: false, error: "provider_not_found" }, 404);

			const result = await setProviderCredential(env, id, "default", body.value.trim());
			if (result.ok) {
				await setProviderAlias(env, id, "default");
				await logAudit(env, "provider.credential.set", id, `secret_id=${result.secretId}`);

				const health =
					id === "google-ai-studio"
						? await testGoogleAiStudio(env)
						: { state: "NOT_CONFIGURED" as const, latencyMs: null, errorMessage: "no health check implemented" };
				await recordHealthResult(env, id, health.state, health.latencyMs, health.errorMessage);
				await logAudit(env, "provider.health-test", id, health.state);

				return json({ ...result, healthState: health.state }, 200);
			}
			await recordHealthResult(env, id, "NOT_CONFIGURED", null, result.error || "Credential set failed");
			return json(result, 502);
		}

		// DELETE /admin/api/providers/:id/credential
		if (action === "credential" && request.method === "DELETE") {
			const provider = await getProvider(env, id);
			if (!provider) return json({ ok: false, error: "provider_not_found" }, 404);

			const result = await deleteProviderCredential(env, id, "default");
			if (result.ok) {
				await setProviderAlias(env, id, null);
				await logAudit(env, "provider.credential.delete", id, null);
				await recordHealthResult(env, id, "REVOKED", null, null);
			}
			return json(result, result.ok ? 200 : 502);
		}
	}

	return json({ ok: false, error: "not_found" }, 404);
}
