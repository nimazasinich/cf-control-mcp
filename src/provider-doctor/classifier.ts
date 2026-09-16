import type { ProviderRow } from "../admin/types";
import type { ProviderRuntimeReadiness } from "../provider-gateway/provider-callability";
import type { DoctorCode, DoctorFinding } from "./types";

function finding(code: DoctorCode, severity: DoctorFinding["severity"], summary: string, detail?: string | null): DoctorFinding {
	return { code, severity, summary, detail: detail ?? null };
}

export function classifyProvider(
	provider: ProviderRow,
	readiness: ProviderRuntimeReadiness,
	freshness: { stale: boolean; freshness: string },
): { diagnosis: DoctorCode; findings: DoctorFinding[] } {
	const findings: DoctorFinding[] = [];

	if (!readiness.enabled) findings.push(finding("DISABLED", "info", "Provider is disabled."));
	if (!readiness.configured) findings.push(finding("NOT_CONFIGURED", "warning", "Provider configuration is incomplete."));
	if (!readiness.credentialReady) findings.push(finding("CREDENTIAL_MISSING", "error", "Required provider credential is not configured."));
	if (!readiness.runtimeReady) findings.push(finding("RUNTIME_NOT_CONFIGURED", "error", "Cloudflare runtime prerequisites are missing."));
	if (provider.health_state === "AUTH_ERROR") findings.push(finding("AUTH_ERROR", "error", "Provider authentication failed.", provider.last_error_message));
	if (provider.health_state === "RATE_LIMITED") findings.push(finding("RATE_LIMITED", "warning", "Provider is rate limited.", provider.last_error_message));
	if (provider.health_state === "UPSTREAM_ERROR") findings.push(finding("UPSTREAM_ERROR", "error", "Provider upstream request failed.", provider.last_error_message));
	if (readiness.healthVerified && !readiness.gatewayVerified) {
		findings.push(finding("GATEWAY_EVIDENCE_MISSING", "error", "Upstream health exists but Cloudflare AI Gateway evidence is missing."));
	}
	if (!readiness.healthVerified && !["AUTH_ERROR", "RATE_LIMITED", "UPSTREAM_ERROR"].includes(provider.health_state)) {
		findings.push(finding("HEALTH_UNVERIFIED", "warning", "Provider does not have verified HEALTHY evidence."));
	}
	if (freshness.stale) findings.push(finding("STALE_HEALTH", "warning", "Last HEALTHY evidence is stale."));

	if (readiness.callable && !freshness.stale) {
		findings.unshift(finding("HEALTHY", "ok", "Provider is configured, verified through AI Gateway, and callable."));
		return { diagnosis: "HEALTHY", findings };
	}

	const priority: DoctorCode[] = [
		"AUTH_ERROR",
		"CREDENTIAL_MISSING",
		"RUNTIME_NOT_CONFIGURED",
		"NOT_CONFIGURED",
		"UPSTREAM_ERROR",
		"RATE_LIMITED",
		"GATEWAY_EVIDENCE_MISSING",
		"STALE_HEALTH",
		"HEALTH_UNVERIFIED",
		"DISABLED",
	];
	const first = priority.find((code) => findings.some((item) => item.code === code));
	return { diagnosis: first ?? "UNKNOWN", findings };
}

export function classifyProbeState(state: ProviderRow["health_state"], gatewayVerified: boolean): DoctorCode {
	if (state === "HEALTHY" && gatewayVerified) return "HEALTHY";
	if (state === "AUTH_ERROR") return "AUTH_ERROR";
	if (state === "RATE_LIMITED") return "RATE_LIMITED";
	if (state === "UPSTREAM_ERROR") return "UPSTREAM_ERROR";
	if (gatewayVerified) return "HEALTH_UNVERIFIED";
	return "GATEWAY_EVIDENCE_MISSING";
}
