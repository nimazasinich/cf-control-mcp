/**
 * v1.8 Admin Console — router.
 * Owner-only auth (session cookie signed with MCP_AUTH_TOKEN). Never
 * protected only by GATEWAY_AUTH_TOKEN. Called for any /admin* path.
 */
import type { AdminEnv, ModelRow, ProviderRow, RoutingRuleRow } from "./types";
import { createSessionCookie, clearSessionCookie, isAuthenticated } from "./auth";
import { loginPageHtml, dashboardHtml } from "./ui";
import {
	listProviders,
	setProviderEnabled,
	setModelEnabled,
	recordHealthResult,
	logAudit,
	recentAudit,
	getProvider,
	getModel,
	setProviderAlias,
	listModels,
	listRoutingRules,
	listRecentHealthChecks,
} from "./db";
import { testGoogleAiStudio } from "./health";
import { setProviderCredential, deleteProviderCredential } from "./credentials";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const value = await request.json<unknown>();
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		return value as Record<string, unknown>;
	} catch {
		return null;
	}
}

export interface AdminToolCatalogEntry {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: {
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
}

type RoutingState = "ACTIVE" | "MODEL_DISABLED" | "PROVIDER_DISABLED" | "BROKEN";

function routingState(
	rule: RoutingRuleRow,
	modelsById: Map<string, ModelRow>,
	providersById: Map<string, ProviderRow>,
): RoutingState {
	const model = modelsById.get(rule.model_id);
	if (!model) return "BROKEN";
	if (model.enabled !== 1) return "MODEL_DISABLED";
	const provider = providersById.get(model.provider_id);
	if (!provider) return "BROKEN";
	if (provider.enabled !== 1) return "PROVIDER_DISABLED";
	return "ACTIVE";
}

function aliasesForModel(rules: RoutingRuleRow[], modelId: string): string[] {
	return rules.filter((r) => r.model_id === modelId).map((r) => r.public_alias).sort();
}

export async function handleAdmin(
	request: Request,
	env: AdminEnv,
	toolCatalog: readonly AdminToolCatalogEntry[] = [],
): Promise<Response> {
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

	if (path === "/admin/api/overview" && request.method === "GET") {
		const [providers, models, rules] = await Promise.all([
			listProviders(env),
			listModels(env),
			listRoutingRules(env),
		]);
		const providersById = new Map(providers.map((p) => [p.id, p]));
		const modelsById = new Map(models.map((m) => [m.id, m]));
		const activeRoutes = rules.filter((r) => routingState(r, modelsById, providersById)).filter((r) => routingState(r, modelsById, providersById) === "ACTIVE").length;
		const availableModels = models.filter((m) => m.enabled === 1 && providersById.get(m.provider_id)?.enabled === 1).length;
		return json({
			providerCount: providers.length,
			enabledProviderCount: providers.filter((p) => p.enabled === 1).length,
			healthyCount: providers.filter((p) => p.health_state === "HEALTHY").length,
			modelCount: models.length,
			enabledModelCount: models.filter((m) => m.enabled === 1).length,
			availableModelCount: availableModels,
			disabledModelCount: models.filter((m) => m.enabled !== 1).length,
			routingRuleCount: rules.length,
			activeRoutingAliasCount: activeRoutes,
			unavailableRoutingAliasCount: rules.length - activeRoutes,
			activeRoutingCount: activeRoutes,
			unavailableRoutingCount: rules.length - activeRoutes,
		});
	}

	if (path === "/admin/api/providers" && request.method === "GET") {
		const [providers, models, rules] = await Promise.all([
			listProviders(env),
			listModels(env),
			listRoutingRules(env),
		]);
		return json({
			providers: providers.map((provider) => {
				const providerModels = models.filter((m) => m.provider_id === provider.id);
				const modelIds = new Set(providerModels.map((m) => m.id));
				return {
					...provider,
					model_count: providerModels.length,
					enabled_model_count: providerModels.filter((m) => m.enabled === 1).length,
					routing_aliases: rules.filter((r) => modelIds.has(r.model_id)).map((r) => r.public_alias).sort(),
				};
			}),
		});
	}

	if (path === "/admin/api/models" && request.method === "GET") {
		const [providers, models, rules] = await Promise.all([
			listProviders(env),
			listModels(env),
			listRoutingRules(env),
		]);
		const providersById = new Map(providers.map((p) => [p.id, p]));
		return json({
			models: models.map((model) => {
				const provider = providersById.get(model.provider_id);
				return {
					...model,
					provider_enabled: provider?.enabled ?? 0,
					available: model.enabled === 1 && provider?.enabled === 1,
					routing_aliases: aliasesForModel(rules, model.id),
				};
			}),
		});
	}

	if (path === "/admin/api/routing" && request.method === "GET") {
		const [providers, models, rules] = await Promise.all([
			listProviders(env),
			listModels(env),
			listRoutingRules(env),
		]);
		const providersById = new Map(providers.map((p) => [p.id, p]));
		const modelsById = new Map(models.map((m) => [m.id, m]));
		return json({
			rules: rules.map((rule) => {
				const model = modelsById.get(rule.model_id);
				const provider = model ? providersById.get(model.provider_id) : undefined;
				return {
					...rule,
					provider_id: model?.provider_id ?? null,
					model_enabled: model?.enabled ?? null,
					provider_enabled: provider?.enabled ?? null,
					state: routingState(rule, modelsById, providersById),
				};
			}),
		});
	}

	if (path === "/admin/api/health" && request.method === "GET") {
		return json({ checks: await listRecentHealthChecks(env) });
	}

	if (path === "/admin/api/usage" && request.method === "GET") {
		const logs = await recentAudit(env, 100);
		return json({
			totalAuditEvents: logs.length,
			recentActions: logs.slice(0, 10).map((l: any) => ({ action: l.action, at: l.at })),
		});
	}

	if (path === "/admin/api/tools" && request.method === "GET") {
		const catalog = toolCatalog.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			annotations: {
				readOnlyHint: tool.annotations?.readOnlyHint === true,
				destructiveHint: tool.annotations?.destructiveHint === true,
				idempotentHint: tool.annotations?.idempotentHint === true,
				openWorldHint: tool.annotations?.openWorldHint === true,
			},
		}));
		return json({
			count: catalog.length,
			readOnlyCount: catalog.filter((tool) => tool.annotations.readOnlyHint).length,
			destructiveCount: catalog.filter((tool) => tool.annotations.destructiveHint).length,
			openWorldCount: catalog.filter((tool) => tool.annotations.openWorldHint).length,
			tools: catalog,
		});
	}

	if (path === "/admin/api/settings" && request.method === "GET") {
		return json({
			gatewaySlug: env.CF_AIG_GATEWAY_SLUG || "cf-control-mcp",
			accountIdMasked: env.CLOUDFLARE_ACCOUNT_ID ? `${env.CLOUDFLARE_ACCOUNT_ID.slice(0, 6)}...${env.CLOUDFLARE_ACCOUNT_ID.slice(-4)}` : "not configured",
			d1Database: "DM_DB",
			hasCfToken: Boolean(env.CLOUDFLARE_API_TOKEN),
			hasGatewayAuth: Boolean(env.GATEWAY_AUTH_TOKEN),
			hasMcpAuth: Boolean(env.MCP_AUTH_TOKEN),
			version: "1.8.0",
		});
	}

	const modelMatch = path.match(/^\/admin\/api\/models\/([^/]+)$/);
	if (modelMatch && request.method === "PATCH") {
		const id = decodeURIComponent(modelMatch[1]);
		const body = await readJsonObject(request);
		if (!body) return json({ ok: false, error: "invalid_json" }, 400);
		if (typeof body.enabled !== "boolean") return json({ ok: false, error: "enabled_must_be_boolean" }, 400);

		const existing = await getModel(env, id);
		if (!existing) return json({ ok: false, error: "model_not_found" }, 404);
		const rules = await listRoutingRules(env);
		const affectedAliases = aliasesForModel(rules, id);

		try {
			const updated = await setModelEnabled(env, id, body.enabled);
			if (!updated) return json({ ok: false, error: "model_not_found" }, 404);
			const provider = await getProvider(env, updated.provider_id);
			await logAudit(
				env,
				body.enabled ? "model.enable" : "model.disable",
				id,
				`aliases=${affectedAliases.join(",") || "none"}`,
			);
			return json({
				ok: true,
				model: {
					...updated,
					provider_enabled: provider?.enabled ?? 0,
					available: updated.enabled === 1 && provider?.enabled === 1,
					routing_aliases: affectedAliases,
				},
				affectedAliases,
			});
		} catch {
			return json({ ok: false, error: "model_update_failed" }, 500);
		}
	}

	const providerMatch = path.match(/^\/admin\/api\/providers\/([^/]+)(\/(health-test|credential))?$/);
	if (providerMatch) {
		const id = decodeURIComponent(providerMatch[1]);
		const action = providerMatch[3];

		if (!action && request.method === "PATCH") {
			const body = await readJsonObject(request);
			if (!body) return json({ ok: false, error: "invalid_json" }, 400);
			if (typeof body.enabled !== "boolean") return json({ ok: false, error: "enabled_must_be_boolean" }, 400);

			const existing = await getProvider(env, id);
			if (!existing) return json({ ok: false, error: "provider_not_found" }, 404);
			const [models, rules] = await Promise.all([listModels(env), listRoutingRules(env)]);
			const providerModels = models.filter((m) => m.provider_id === id);
			const modelIds = new Set(providerModels.map((m) => m.id));
			const affectedAliases = rules.filter((r) => modelIds.has(r.model_id)).map((r) => r.public_alias).sort();

			try {
				const updated = await setProviderEnabled(env, id, body.enabled);
				if (!updated) return json({ ok: false, error: "provider_not_found" }, 404);
				await logAudit(
					env,
					body.enabled ? "provider.enable" : "provider.disable",
					id,
					`models=${providerModels.length};aliases=${affectedAliases.join(",") || "none"}`,
				);
				return json({
					ok: true,
					provider: updated,
					affectedModels: providerModels.map((m) => m.id),
					affectedAliases,
				});
			} catch {
				return json({ ok: false, error: "provider_update_failed" }, 500);
			}
		}

		if (action === "health-test" && request.method === "POST") {
			const provider = await getProvider(env, id);
			if (!provider) return json({ ok: false, error: "provider_not_found" }, 404);
			const result = id === "google-ai-studio" ? await testGoogleAiStudio(env) : { state: "NOT_CONFIGURED" as const, latencyMs: null, errorMessage: "no health check implemented for this provider" };
			await recordHealthResult(env, id, result.state, result.latencyMs, result.errorMessage);
			await logAudit(env, "provider.health-test", id, result.state);
			return json({ ok: true, ...result });
		}

		if (action === "credential" && request.method === "POST") {
			const provider = await getProvider(env, id);
			if (!provider) return json({ ok: false, error: "provider_not_found" }, 404);
			const body = await readJsonObject(request);
			if (!body) return json({ ok: false, error: "invalid_json" }, 400);
			if (typeof body.value !== "string" || !body.value.trim()) return json({ ok: false, error: "value_required" }, 400);
			const result = await setProviderCredential(env, id, "default", body.value.trim());
			if (result.ok) {
				await setProviderAlias(env, id, "default");
				await logAudit(env, "provider.credential.set", id, `secret_id=${result.secretId}`);

				// Post-config verification
				const health = id === "google-ai-studio" ? await testGoogleAiStudio(env) : { state: "NOT_CONFIGURED" as const, latencyMs: null, errorMessage: "no health check implemented" };
				await recordHealthResult(env, id, health.state, health.latencyMs, health.errorMessage);
				await logAudit(env, "provider.health-test", id, health.state);

				return json({ ...result, healthState: health.state }, 200);
			}
			await recordHealthResult(env, id, "NOT_CONFIGURED", null, result.error || "Credential set failed");
			return json(result, 502);
		}

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

	if (path === "/admin/api/logs" && request.method === "GET") {
		return json({ events: await recentAudit(env) });
	}

	return json({ ok: false, error: "not_found" }, 404);
}