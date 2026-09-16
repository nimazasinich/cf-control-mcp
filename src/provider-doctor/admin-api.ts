import type { AdminEnv } from "../admin/types";
import { buildProviderDoctorSnapshot, getProviderDoctorSnapshot, runProviderDoctorProbe } from "./doctor";
import {
	beginDoctorRun,
	finishDoctorRun,
	listDoctorRuns,
	providerDoctorPersistenceAvailable,
	recordDoctorProbe,
} from "./persistence";

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
	});
}

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
	try {
		const value: unknown = await request.json();
		return value && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}

/**
 * Call this only AFTER the existing Admin auth + same-origin guards have run.
 * Returns null when the request is not a Provider Doctor endpoint.
 */
export async function handleProviderDoctorAdmin(
	request: Request,
	env: AdminEnv,
): Promise<Response | null> {
	const url = new URL(request.url);
	const path = url.pathname;

	if (path === "/admin/api/provider-doctor/summary" && request.method === "GET") {
		return json({ ok: true, doctor: await buildProviderDoctorSnapshot(env) });
	}

	if (path.startsWith("/admin/api/provider-doctor/provider/") && request.method === "GET") {
		const id = decodeURIComponent(path.slice("/admin/api/provider-doctor/provider/".length));
		const provider = await getProviderDoctorSnapshot(env, id);
		return provider ? json({ ok: true, provider }) : json({ ok: false, error: "provider_not_found" }, 404);
	}

	if (path === "/admin/api/provider-doctor/probe" && request.method === "POST") {
		const body = await bodyObject(request);
		const id = typeof body.providerId === "string" && body.providerId.trim() ? body.providerId.trim() : undefined;
		const c = typeof body.concurrency === "number" ? Math.max(1, Math.min(4, Math.trunc(body.concurrency))) : 2;
		return json({ ok: true, probes: await runProviderDoctorProbe(env, id, c) });
	}

	if (path === "/admin/api/provider-doctor/probe-record" && request.method === "POST") {
		if (!(await providerDoctorPersistenceAvailable(env))) {
			return json({ ok: false, error: "provider_doctor_migration_0011_required" }, 409);
		}
		const body = await bodyObject(request);
		const id = typeof body.providerId === "string" && body.providerId.trim() ? body.providerId.trim() : undefined;
		const c = typeof body.concurrency === "number" ? Math.max(1, Math.min(4, Math.trunc(body.concurrency))) : 2;
		const probes = await runProviderDoctorProbe(env, id, c);
		const runId = await beginDoctorRun(env, probes.length);
		let errors = 0;
		try {
			for (const probe of probes) {
				if (probe.diagnosis !== "HEALTHY") errors += 1;
				await recordDoctorProbe(env, runId, probe);
			}
			await finishDoctorRun(env, runId, errors === 0 ? "COMPLETED" : "PARTIAL", probes.length, errors);
			return json({ ok: true, runId, status: errors === 0 ? "COMPLETED" : "PARTIAL", probes });
		} catch (err) {
			await finishDoctorRun(env, runId, "FAILED", 0, 1).catch(() => undefined);
			return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
		}
	}

	if (path === "/admin/api/provider-doctor/history" && request.method === "GET") {
		if (!(await providerDoctorPersistenceAvailable(env))) {
			return json({ ok: true, available: false, reason: "provider_doctor_migration_0011_required", runs: [] });
		}
		const url2 = new URL(request.url);
		const limit = parseInt(url2.searchParams.get("limit") ?? "20", 10);
		return json({ ok: true, available: true, runs: await listDoctorRuns(env, limit) });
	}

	return null;
}
