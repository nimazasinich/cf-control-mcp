/**
 * v1.8 Admin Console — router.
 * Owner-only auth (session cookie signed with MCP_AUTH_TOKEN). Never
 * protected only by GATEWAY_AUTH_TOKEN. Called for any /admin* path.
 */
import type { AdminEnv, ModelRow, ProviderRow, RoutingRuleRow } from "./types";
import { createSessionCookie, clearSessionCookie, isAuthenticated, verifyOwnerToken } from "./auth";
import { loginPageHtml, dashboardHtml } from "./ui";
import { preLoginLoadingHtml } from "./ui/prelogin";
import { getAdminUsageSummary } from "./usage-ext";
import { getAdminSettingsSummary } from "./settings-ext";
import { checkAdminSameOrigin, isAdminMutationMethod } from "./request-security";
import { queryAuditEvents } from "./audit-ext";
import {
	createModel,
	createProvider,
	deleteProviderLocalState,
	MODEL_DESCRIPTION_MAX_LENGTH,
	MODEL_DISPLAY_NAME_MAX_LENGTH,
	listProviders,
	setProviderEnabled,
	setModelEnabled,
	setModelMetadata,
	setModelPublicAlias,
	setRoutingRuleTarget,
	recordHealthResult,
	logAudit,
	recentAudit,
	getProvider,
	getModel,
	getModelByPublicAlias,
	getRoutingRule,
	setProviderAlias,
	listModels,
	listRoutingRules,
	listRecentHealthChecks,
} from "./db";
import { testGoogleAiStudio } from "./health";
import { setProviderCredential, deleteProviderCredential } from "./credentials";
import { createCloudflareCustomProvider, deleteCloudflareCustomProvider, normalizeCustomProviderSlug, validateCustomProviderBaseUrl } from "./custom-providers";
import { beginProviderOperation, updateProviderOperation } from "./lifecycle";
import { isProviderAuthType, isProviderTransport, knownProviderTemplate } from "./provider-catalog";

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

const PROVIDER_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const MODEL_ID_RE = /^[A-Za-z0-9@._:/-]{1,160}$/;
const ALIAS_RE = /^[a-z][a-z0-9._-]{0,63}$/;

function optionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	return text ? text : null;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function numberOrDefault(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(9999, Math.trunc(value)));
}

function metadataValue(body: Record<string, unknown>, key: "displayName" | "description", maxLength: number): string | null | undefined {
	if (!(key in body)) return undefined;
	const value = body[key];
	if (value === null) return null;
	if (typeof value !== "string") throw new Error(`${key}_must_be_string_or_null`);
	if (value.length > maxLength) throw new Error(`${key}_too_long`);
	return value.trim() || null;
}

function cleanApiPath(value: unknown, fallback: string | null): string | null {
	const raw = optionalString(value) ?? fallback;
	if (!raw) return null;
	if (/^https?:\/\//i.test(raw)) throw new Error("api_path_must_be_relative");
	if (raw.includes("?") || raw.includes("#") || raw.includes("\\")) throw new Error("invalid_api_path");
	return raw.replace(/^\/+/, "");
}

function validTransportAuth(transport: string, authType: string): boolean {
	if (transport === "gateway-custom") return authType === "byok" || authType === "none";
	if (transport === "gateway-native") return authType === "byok" || authType === "cloudflare-unified";
	if (transport === "cloudflare-rest") return authType === "cloudflare-unified";
	if (transport === "workers-ai-binding") return authType === "cloudflare-binding";
	return false;
}

async function safeBeginProviderOperation(env: AdminEnv, providerId: string | null): Promise<string | null> {
	try {
		return await beginProviderOperation(env, "create", providerId, "validate");
	} catch {
		return null;
	}
}

async function safeUpdateProviderOperation(
	env: AdminEnv,
	operationId: string | null,
	step: string,
	state: "PENDING" | "IN_PROGRESS" | "COMPENSATING" | "RECONCILIATION_REQUIRED" | "SUCCEEDED" | "FAILED",
	externalCustomProviderId?: string | null,
	error?: unknown,
): Promise<void> {
	if (!operationId) return;
	try {
		await updateProviderOperation(env, operationId, { step, state, externalCustomProviderId, error });
	} catch {
		// Operation evidence is useful, but must not hide the authoritative API result.
	}
}

async function handleCreateProvider(body: Record<string, unknown>, env: AdminEnv): Promise<Response> {
	const template = optionalString(body.templateId) ? knownProviderTemplate(String(body.templateId)) : undefined;
	if (body.templateId && !template) return json({ ok: false, error: "unsupported_provider_template" }, 400);

	const id = (optionalString(body.id) ?? template?.id ?? "").toLowerCase();
	if (!PROVIDER_ID_RE.test(id)) return json({ ok: false, error: "invalid_provider_id" }, 400);
	if (await getProvider(env, id)) return json({ ok: false, error: "provider_already_exists" }, 409);

	const displayName = optionalString(body.displayName) ?? template?.displayName ?? id;
	const kind = optionalString(body.kind) ?? template?.id ?? "custom";
	const transport = optionalString(body.transport) ?? template?.transport ?? "gateway-custom";
	if (!isProviderTransport(transport)) return json({ ok: false, error: "unsupported_transport" }, 400);
	const authType = optionalString(body.authType) ?? template?.authType ?? "byok";
	if (!isProviderAuthType(authType)) return json({ ok: false, error: "unsupported_auth_type" }, 400);
	if (template && !template.allowedAuthTypes.includes(authType)) return json({ ok: false, error: "unsupported_auth_for_template" }, 400);
	if (!validTransportAuth(transport, authType)) return json({ ok: false, error: "unsupported_transport_auth_combination" }, 400);

	const credentialRequired = boolOrDefault(body.credentialRequired, template?.credentialRequired ?? authType === "byok");
	const credentialValue = optionalString(body.credentialValue);
	if (authType === "none" && (credentialRequired || credentialValue)) return json({ ok: false, error: "credential_not_supported_for_auth_type" }, 400);
	if (credentialRequired && boolOrDefault(body.enabled, false) && !credentialValue) return json({ ok: false, error: "credential_required_before_enable" }, 400);

	let apiPath: string | null;
	try {
		apiPath = cleanApiPath(body.apiPath, template?.apiPath ?? (transport === "gateway-custom" ? "v1/chat/completions" : null));
	} catch (error) {
		return json({ ok: false, error: error instanceof Error ? error.message : "invalid_api_path" }, 400);
	}

	let providerSlug = optionalString(body.providerSlug) ?? template?.providerSlug ?? id;
	let baseUrl = optionalString(body.baseUrl) ?? template?.baseUrl ?? null;
	let customProviderId: string | null = null;
	const operationId = await safeBeginProviderOperation(env, id);

	try {
		await safeUpdateProviderOperation(env, operationId, "validate", "IN_PROGRESS");
		if (transport === "gateway-custom") {
			if (!baseUrl) throw new Error("base_url_required");
			const customSlug = normalizeCustomProviderSlug(providerSlug);
			baseUrl = validateCustomProviderBaseUrl(baseUrl);
			await safeUpdateProviderOperation(env, operationId, "provision_custom_provider", "IN_PROGRESS");
			const custom = await createCloudflareCustomProvider(env, { name: displayName, slug: customSlug, baseUrl });
			customProviderId = custom.id;
			providerSlug = `custom-${custom.slug}`;
			baseUrl = custom.baseUrl;
			await safeUpdateProviderOperation(env, operationId, "persist_provider", "IN_PROGRESS", customProviderId);
		}

		const provider = await createProvider(env, {
			id,
			displayName,
			kind,
			providerSlug,
			transport,
			authType,
			baseUrl,
			apiPath,
			priority: numberOrDefault(body.priority, template ? 100 : 200),
			credentialRequired,
			customProviderId,
			testModel: optionalString(body.testModel) ?? template?.testModel ?? null,
			enabled: boolOrDefault(body.enabled, false),
		});

		if (credentialValue && authType === "byok") {
			await safeUpdateProviderOperation(env, operationId, "store_credential", "IN_PROGRESS", customProviderId);
			const credential = await setProviderCredential(env, provider.provider_slug, "default", credentialValue);
			if (!credential.ok) throw new Error(credential.error || "credential_store_failed");
			await setProviderAlias(env, id, "default");
		}

		const createdModels: ModelRow[] = [];
		const modelInputs = Array.isArray(body.models) ? body.models : [];
		for (const item of modelInputs) {
			if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_model_definition");
			const model = item as Record<string, unknown>;
			const modelId = optionalString(model.id);
			if (!modelId || !MODEL_ID_RE.test(modelId)) throw new Error("invalid_model_id");
			const publicAlias = optionalString(model.publicAlias);
			if (publicAlias) {
				if (!ALIAS_RE.test(publicAlias)) throw new Error("invalid_public_alias");
				if (await getRoutingRule(env, publicAlias)) throw new Error("alias_conflicts_with_routing_rule");
				const aliasModel = await getModelByPublicAlias(env, publicAlias);
				if (aliasModel) throw new Error("alias_conflicts_with_model");
			}
			createdModels.push(await createModel(env, {
				id: modelId,
				providerId: id,
				enabled: boolOrDefault(model.enabled, true),
				publicAlias,
				displayName: optionalString(model.displayName),
				description: optionalString(model.description),
			}));
		}

		await logAudit(env, "provider.create", id, `transport=${transport};auth=${authType};models=${createdModels.length};credential=${credentialValue ? "configured" : "not_submitted"};custom_provider=${customProviderId ? "created" : "none"}`);
		await safeUpdateProviderOperation(env, operationId, "succeeded", "SUCCEEDED", customProviderId);
		const finalProvider = (await getProvider(env, id)) ?? provider;
		return json({ ok: true, operationId, provider: finalProvider, models: createdModels }, 201);
	} catch (error) {
		const message = error instanceof Error ? error.message : "provider_create_failed";
		await safeUpdateProviderOperation(env, operationId, "compensate", "COMPENSATING", customProviderId, message);
		let cleanup = "none";
		try {
			await deleteProviderLocalState(env, id, true);
			cleanup = "local";
		} catch {
			cleanup = "local_failed";
		}
		if (customProviderId) {
			try {
				await deleteCloudflareCustomProvider(env, customProviderId);
				cleanup += "+custom_provider";
			} catch (cleanupError) {
				await safeUpdateProviderOperation(env, operationId, "reconciliation_required", "RECONCILIATION_REQUIRED", customProviderId, cleanupError);
				await logAudit(env, "provider.create.failed", id, `error=${message};cleanup=reconciliation_required`);
				return json({ ok: false, error: message, operationId, cleanup: "reconciliation_required" }, 502);
			}
		}
		await safeUpdateProviderOperation(env, operationId, "failed", "FAILED", customProviderId, message);
		await logAudit(env, "provider.create.failed", id, `error=${message};cleanup=${cleanup}`);
		const status = message === "provider_already_exists"
			? 409
			: message.startsWith("custom_provider_create_failed") || message.includes("Secret") || message.includes("Secrets Store") || message.includes("Provider Config") || message === "credential_store_failed"
				? 502
				: 400;
		return json({ ok: false, error: message, operationId, cleanup }, status);
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

	if (isAdminMutationMethod(request.method)) {
		const sameOrigin = checkAdminSameOrigin(request);
		if (!sameOrigin.ok) return json({ ok: false, error: "forbidden_origin", source: sameOrigin.source }, 403);
	}

	if ((path === "/admin/" || path === "/admin/index.html") && request.method === "GET") {
		return new Response(null, { status: 308, headers: { Location: "/admin", "Cache-Control": "private, no-store" } });
	}

	if (path === "/admin/login" && request.method === "POST") {
		const form = await request.formData();
		const token = form.get("token");
		if (typeof token !== "string" || !(await verifyOwnerToken(token, env))) {
			return new Response(loginPageHtml("Invalid token"), { status: 401, headers: { "Content-Type": "text/html" } });
		}
		const cookie = await createSessionCookie(env);
		await logAudit(env, "admin.login", null, null);
		return new Response(null, { status: 302, headers: { Location: "/admin", "Set-Cookie": cookie } });
	}

	if (path === "/admin/logout" && request.method === "POST") {
		return new Response(null, { status: 302, headers: { Location: "/admin/login", "Set-Cookie": clearSessionCookie() } });
	}

	const authed = await isAuthenticated(request, env);

	if (path === "/admin/login" && request.method === "GET") {
		if (authed) return new Response(null, { status: 302, headers: { Location: "/admin" } });
		return new Response(loginPageHtml(), { headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" } });
	}

	if (path === "/admin/loading" && request.method === "GET") {
		return new Response(preLoginLoadingHtml(), { headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" } });
	}

	if (!authed) {
		if (path === "/admin" && request.method === "GET") {
			return new Response(preLoginLoadingHtml(), { headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" } });
		}
		if (!path.startsWith("/admin/api")) {
			return new Response(null, { status: 302, headers: { Location: "/admin/login" } });
		}
		return json({ ok: false, error: "unauthorized" }, 401);
	}

	// Authenticated Admin application (SPA fallback for all /admin and /admin/* routes)
	if (request.method === "GET" && !path.startsWith("/admin/api")) {
		return new Response(dashboardHtml(), { headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" } });
	}


	if (path === "/admin/api/overview" && request.method === "GET") {
		const [providers, models, rules] = await Promise.all([
			listProviders(env),
			listModels(env),
			listRoutingRules(env),
		]);
		const providersById = new Map(providers.map((p) => [p.id, p]));
		const modelsById = new Map(models.map((m) => [m.id, m]));
		const activeRoutes = rules.filter((r) => routingState(r, modelsById, providersById) === "ACTIVE").length;
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

	if (path === "/admin/api/providers" && request.method === "POST") {
		const body = await readJsonObject(request);
		if (!body) return json({ ok: false, error: "invalid_json" }, 400);
		return handleCreateProvider(body, env);
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

	if (path === "/admin/api/models" && request.method === "POST") {
		const body = await readJsonObject(request);
		if (!body) return json({ ok: false, error: "invalid_json" }, 400);
		const id = optionalString(body.id);
		const providerId = optionalString(body.providerId);
		if (!id || !MODEL_ID_RE.test(id)) return json({ ok: false, error: "invalid_model_id" }, 400);
		if (!providerId) return json({ ok: false, error: "provider_id_required" }, 400);
		const publicAlias = optionalString(body.publicAlias);
		if (publicAlias) {
			if (!ALIAS_RE.test(publicAlias)) return json({ ok: false, error: "invalid_public_alias" }, 400);
			if (await getRoutingRule(env, publicAlias)) return json({ ok: false, error: "alias_conflicts_with_routing_rule" }, 409);
			if (await getModelByPublicAlias(env, publicAlias)) return json({ ok: false, error: "alias_conflicts_with_model" }, 409);
		}
		try {
			const model = await createModel(env, {
				id,
				providerId,
				enabled: boolOrDefault(body.enabled, true),
				freeTier: boolOrDefault(body.freeTier, false),
				publicAlias,
				displayName: optionalString(body.displayName),
				description: optionalString(body.description),
			});
			await logAudit(env, "model.create", id, `provider=${providerId};alias=${publicAlias || "none"}`);
			return json({ ok: true, model }, 201);
		} catch (error) {
			const message = error instanceof Error ? error.message : "model_create_failed";
			const status = message === "provider_not_found" ? 404 : message === "model_already_exists" ? 409 : 400;
			return json({ ok: false, error: message }, status);
		}
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

	const routingMatch = path.match(/^\/admin\/api\/routing\/([^/]+)$/);
	if (routingMatch && request.method === "PATCH") {
		const alias = decodeURIComponent(routingMatch[1]);
		const body = await readJsonObject(request);
		if (!body) return json({ ok: false, error: "invalid_json" }, 400);
		const modelId = optionalString(body.modelId);
		if (!modelId) return json({ ok: false, error: "model_id_required" }, 400);
		const model = await getModel(env, modelId);
		if (!model) return json({ ok: false, error: "model_not_found" }, 404);
		if (!ALIAS_RE.test(alias)) return json({ ok: false, error: "invalid_routing_alias" }, 400);
		const rule = await setRoutingRuleTarget(env, alias, modelId);
		const provider = await getProvider(env, model.provider_id);
		await logAudit(env, "routing.update", alias, `model=${modelId};provider=${model.provider_id}`);
		return json({
			ok: true,
			rule: {
				...rule,
				provider_id: model.provider_id,
				model_enabled: model.enabled,
				provider_enabled: provider?.enabled ?? null,
				state: routingState(rule, new Map([[model.id, model]]), new Map(provider ? [[provider.id, provider]] : [])),
			},
		});
	}

	if (path === "/admin/api/health" && request.method === "GET") {
		return json({ checks: await listRecentHealthChecks(env) });
	}

	if (path === "/admin/api/usage" && request.method === "GET") {
		return json(await getAdminUsageSummary(env, toolCatalog.length));
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
		return json(getAdminSettingsSummary(env));
	}

	const modelActionMatch = path.match(/^\/admin\/api\/models\/([^/]+)\/(alias|metadata)$/);
	if (modelActionMatch) {
		const id = decodeURIComponent(modelActionMatch[1]);
		const action = modelActionMatch[2];
		const body = await readJsonObject(request);
		if (!body) return json({ ok: false, error: "invalid_json" }, 400);
		const existing = await getModel(env, id);
		if (!existing) return json({ ok: false, error: "model_not_found" }, 404);

		if (action === "alias" && request.method === "PATCH") {
			const publicAlias = optionalString(body.publicAlias);
			if (publicAlias && !ALIAS_RE.test(publicAlias)) return json({ ok: false, error: "invalid_public_alias" }, 400);
			if (publicAlias) {
				if (await getRoutingRule(env, publicAlias)) return json({ ok: false, error: "alias_conflicts_with_routing_rule" }, 409);
				const aliasModel = await getModelByPublicAlias(env, publicAlias);
				if (aliasModel && aliasModel.id !== id) return json({ ok: false, error: "alias_conflicts_with_model" }, 409);
			}
			const updated = await setModelPublicAlias(env, id, publicAlias);
			if (!updated) return json({ ok: false, error: "model_not_found" }, 404);
			await logAudit(env, publicAlias ? "model.alias.set" : "model.alias.clear", id, publicAlias);
			return json({ ok: true, model: updated });
		}

		if (action === "metadata" && request.method === "PATCH") {
			try {
				const displayName = metadataValue(body, "displayName", MODEL_DISPLAY_NAME_MAX_LENGTH);
				const description = metadataValue(body, "description", MODEL_DESCRIPTION_MAX_LENGTH);
				if (displayName === undefined && description === undefined) return json({ ok: false, error: "displayName_or_description_required" }, 400);
				const updated = await setModelMetadata(env, id, { displayName, description });
				if (!updated) return json({ ok: false, error: "model_not_found" }, 404);
				await logAudit(env, "model.metadata.set", id, `displayName=${displayName === undefined ? "unchanged" : "set"};description=${description === undefined ? "unchanged" : "set"}`);
				return json({ ok: true, model: updated });
			} catch (error) {
				return json({ ok: false, error: error instanceof Error ? error.message : "model_metadata_invalid" }, 400);
			}
		}
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
			const result = await setProviderCredential(env, provider.provider_slug, "default", body.value.trim());
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
			const result = await deleteProviderCredential(env, provider.provider_slug, "default");
			if (result.ok) {
				await setProviderAlias(env, id, null);
				await logAudit(env, "provider.credential.delete", id, null);
				await recordHealthResult(env, id, "REVOKED", null, null);
			}
			return json(result, result.ok ? 200 : 502);
		}
	}

	if (path === "/admin/api/logs" && request.method === "GET") {
		const q = url.searchParams;
		if (q.has("search") || q.has("action") || q.has("actor") || q.has("target") || q.has("limit")) {
			const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 50));
			return json(await queryAuditEvents(env, {
				search: q.get("search") || undefined,
				actionPrefix: q.get("action") || undefined,
				actor: q.get("actor") || undefined,
				target: q.get("target") || undefined,
				limit,
			}));
		}
		return json({ events: await recentAudit(env) });
	}

	return json({ ok: false, error: "not_found" }, 404);
}
