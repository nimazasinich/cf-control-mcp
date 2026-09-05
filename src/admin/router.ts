/**
 * v1.8 Admin Console — router.
 * Owner-only auth (session cookie signed with MCP_AUTH_TOKEN). Never
 * protected only by GATEWAY_AUTH_TOKEN. Called for any /admin* path.
 */
import type { AdminEnv } from "./types";
import { createSessionCookie, clearSessionCookie, isAuthenticated } from "./auth";
import { loginPageHtml, dashboardHtml } from "./ui";
import { listProviders, setProviderEnabled, recordHealthResult, logAudit, recentAudit, getProvider, setProviderAlias } from "./db";
import { testGoogleAiStudio } from "./health";
import { setProviderCredential, deleteProviderCredential } from "./credentials";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
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

	if (!authed) return json({ error: "unauthorized" }, 401);

	if (path === "/admin/api/overview" && request.method === "GET") {
		const providers = await listProviders(env);
		return json({ providerCount: providers.length, healthyCount: providers.filter((p) => p.health_state === "HEALTHY").length });
	}

	if (path === "/admin/api/providers" && request.method === "GET") {
		return json({ providers: await listProviders(env) });
	}

	const providerMatch = path.match(/^\/admin\/api\/providers\/([^/]+)(\/(health-test|credential))?$/);
	if (providerMatch) {
		const id = providerMatch[1];
		const action = providerMatch[3];

		if (!action && request.method === "PATCH") {
			const body = await request.json<{ enabled: boolean }>();
			await setProviderEnabled(env, id, Boolean(body.enabled));
			await logAudit(env, body.enabled ? "provider.enable" : "provider.disable", id, null);
			return json({ ok: true });
		}

		if (action === "health-test" && request.method === "POST") {
			const provider = await getProvider(env, id);
			if (!provider) return json({ error: "not found" }, 404);
			const result = id === "google-ai-studio" ? await testGoogleAiStudio(env) : { state: "NOT_CONFIGURED" as const, latencyMs: null, errorMessage: "no health check implemented for this provider" };
			await recordHealthResult(env, id, result.state, result.latencyMs, result.errorMessage);
			await logAudit(env, "provider.health-test", id, result.state);
			return json(result);
		}

		if (action === "credential" && request.method === "POST") {
			const body = await request.json<{ value: string }>();
			if (!body.value?.trim()) return json({ ok: false, error: "value is required" }, 400);
			const result = await setProviderCredential(env, id, "default", body.value.trim());
			if (result.ok) {
				await setProviderAlias(env, id, "default");
				await logAudit(env, "provider.credential.set", id, `secret_id=${result.secretId}`);
			}
			return json(result, result.ok ? 200 : 502);
		}

		if (action === "credential" && request.method === "DELETE") {
			const result = await deleteProviderCredential(env, id, "default");
			if (result.ok) {
				await setProviderAlias(env, id, null);
				await logAudit(env, "provider.credential.delete", id, null);
			}
			return json(result, result.ok ? 200 : 502);
		}
	}

	if (path === "/admin/api/logs" && request.method === "GET") {
		return json({ events: await recentAudit(env) });
	}

	return json({ error: "not found" }, 404);
}
