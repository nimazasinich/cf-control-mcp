import type { AdminEnv } from "../admin/types";
import { buildProviderDoctorSnapshot, getProviderDoctorSnapshot, runProviderDoctorProbe } from "./doctor";
import {
	beginDoctorRun,
	finishDoctorRun,
	listDoctorRuns,
	providerDoctorPersistenceAvailable,
	recordDoctorProbe,
} from "./persistence";

export interface ProviderDoctorToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	mcpCapability: string;
	annotations?: {
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
	handler: (args: Record<string, unknown>, env: AdminEnv) => Promise<unknown>;
}

function providerId(args: Record<string, unknown>): string | undefined {
	if (typeof args.provider_id !== "string") return undefined;
	const value = args.provider_id.trim();
	return value || undefined;
}

function concurrency(args: Record<string, unknown>): number {
	const raw = typeof args.concurrency === "number" ? args.concurrency : 2;
	return Math.max(1, Math.min(4, Math.trunc(raw)));
}

export const providerDoctorTools: ProviderDoctorToolDef[] = [
	{
		name: "provider_doctor_summary",
		mcpCapability: "mcp:read",
		description:
			"Read-only Provider Doctor snapshot over D1 provider/model/routing metadata. " +
			"Reports fail-closed readiness, health freshness, model registration and routing state. Never returns raw credentials.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		handler: async (_args, env) => buildProviderDoctorSnapshot(env),
	},
	{
		name: "provider_doctor_provider",
		mcpCapability: "mcp:read",
		description:
			"Read-only diagnostic snapshot for one provider. Does not perform network inference and never exposes raw credentials.",
		inputSchema: {
			type: "object",
			properties: { provider_id: { type: "string", minLength: 1, maxLength: 64 } },
			required: ["provider_id"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		handler: async (args, env) => {
			const id = providerId(args);
			if (!id) throw new Error("provider_id_required");
			const snapshot = await getProviderDoctorSnapshot(env, id);
			if (!snapshot) throw new Error("provider_not_found");
			return snapshot;
		},
	},
	{
		name: "provider_doctor_history",
		mcpCapability: "mcp:read",
		description: "Reads recent sanitized Provider Doctor run metadata from D1. Requires migration 0011.",
		inputSchema: {
			type: "object",
			properties: { limit: { type: "number", minimum: 1, maximum: 100 } },
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		handler: async (args, env) => {
			if (!(await providerDoctorPersistenceAvailable(env))) {
				return { available: false, reason: "provider_doctor_migration_0011_required", runs: [] };
			}
			const limit = typeof args.limit === "number" ? args.limit : 20;
			return { available: true, runs: await listDoctorRuns(env, limit) };
		},
	},
	{
		name: "provider_doctor_probe",
		mcpCapability: "mcp:execute",
		description:
			"Runs fresh real provider inference probes through the project's existing Cloudflare provider runtime. " +
			"Does not mutate provider configuration or routing. May consume upstream/provider quota. Never returns raw credentials.",
		inputSchema: {
			type: "object",
			properties: {
				provider_id: { type: "string", minLength: 1, maxLength: 64 },
				concurrency: { type: "number", minimum: 1, maximum: 4 },
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		handler: async (args, env) => ({
			probes: await runProviderDoctorProbe(env, providerId(args), concurrency(args)),
		}),
	},
	{
		name: "provider_doctor_probe_record",
		mcpCapability: "mcp:admin",
		description:
			"Runs fresh provider probes and stores sanitized diagnostic evidence in Provider Doctor D1 tables. " +
			"Requires migration 0011. Never changes provider enablement, aliases, routing or credentials.",
		inputSchema: {
			type: "object",
			properties: {
				provider_id: { type: "string", minLength: 1, maxLength: 64 },
				concurrency: { type: "number", minimum: 1, maximum: 4 },
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		handler: async (args, env) => {
			if (!(await providerDoctorPersistenceAvailable(env))) throw new Error("provider_doctor_migration_0011_required");
			const probes = await runProviderDoctorProbe(env, providerId(args), concurrency(args));
			const runId = await beginDoctorRun(env, probes.length);
			let errors = 0;
			try {
				for (const probe of probes) {
					if (probe.diagnosis !== "HEALTHY") errors += 1;
					await recordDoctorProbe(env, runId, probe);
				}
				await finishDoctorRun(env, runId, errors === 0 ? "COMPLETED" : "PARTIAL", probes.length, errors);
			} catch (error) {
				await finishDoctorRun(env, runId, "FAILED", 0, 1).catch(() => undefined);
				throw error;
			}
			return { run_id: runId, probes, status: errors === 0 ? "COMPLETED" : "PARTIAL" };
		},
	},
];
