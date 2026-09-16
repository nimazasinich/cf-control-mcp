import type { HealthState, ModelRow, ProviderRow, RoutingRuleRow } from "../admin/types";
import type { CallabilityReason, ProviderRuntimeReadiness } from "../provider-gateway/provider-callability";

export type DoctorSeverity = "ok" | "info" | "warning" | "error";

export type DoctorCode =
	| "HEALTHY"
	| "DISABLED"
	| "NOT_CONFIGURED"
	| "CREDENTIAL_MISSING"
	| "RUNTIME_NOT_CONFIGURED"
	| "HEALTH_UNVERIFIED"
	| "GATEWAY_EVIDENCE_MISSING"
	| "AUTH_ERROR"
	| "RATE_LIMITED"
	| "UPSTREAM_ERROR"
	| "NO_TEST_MODEL"
	| "MODEL_DISABLED"
	| "ROUTE_BROKEN"
	| "STALE_HEALTH"
	| "UNKNOWN";

export interface DoctorFinding {
	code: DoctorCode;
	severity: DoctorSeverity;
	summary: string;
	detail?: string | null;
}

export interface ProviderModelAudit {
	total: number;
	enabled: number;
	disabled: number;
	publicAliases: string[];
	routedAliases: string[];
	orphanRoutingAliases: string[];
	testModelRegistered: boolean;
	testModelEnabled: boolean;
}

export interface ProviderDoctorSnapshot {
	provider: ProviderRow;
	readiness: ProviderRuntimeReadiness;
	findings: DoctorFinding[];
	models: ProviderModelAudit;
	healthFreshness: {
		freshness: string;
		ageMs: number | null;
		stale: boolean;
	};
	aliases: string[];
	diagnosis: DoctorCode;
	callable: boolean;
}

export interface DoctorRouteEntry {
	publicAlias: string;
	modelId: string;
	modelEnabled: boolean | null;
	providerId: string | null;
	providerEnabled: boolean | null;
	providerHealth: HealthState | null;
	providerCallable: boolean;
	state:
		| "ACTIVE"
		| "MODEL_DISABLED"
		| "PROVIDER_DISABLED"
		| "PROVIDER_UNHEALTHY"
		| "BROKEN";
	reasons: string[];
}

export interface DoctorProbeResult {
	providerId: string;
	modelId: string | null;
	state: HealthState;
	diagnosis: DoctorCode;
	latencyMs: number | null;
	httpStatus: number | null;
	gatewayVerified: boolean;
	gatewayLogId: string | null;
	gatewayStep: string | null;
	cfRay: string | null;
	correlationId: string;
	errorMessage: string | null;
	testedAt: string;
}

export interface DoctorRunSummary {
	generatedAt: string;
	providerCount: number;
	callableCount: number;
	healthyCount: number;
	providers: ProviderDoctorSnapshot[];
	routes: DoctorRouteEntry[];
}

export interface PersistedDoctorRun {
	runId: string;
	startedAt: string;
	completedAt: string | null;
	status: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
	providerCount: number;
	probedCount: number;
	errorCount: number;
}
