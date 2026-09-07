/**
 * DreamWorker / cf-control-mcp — Admin Usage aggregation extension
 *
 * Purpose:
 * - provide a richer, truthful /admin/api/usage payload from data already persisted in D1
 * - never fabricate gateway request counts, tokens, or cost
 * - read-only: no mutation, no credentials, no provider calls
 */
import type { AdminEnv } from "./types";

interface CountRow { count: number; }
interface AuditWindowRow { total: number; last24h: number; last7d: number; }
interface ActionCountRow { action: string; count: number; }
interface RecentActionRow { action: string; at: string; target: string | null; }
interface RegistryRow {
  providers: number;
  enabledProviders: number;
  models: number;
  enabledModels: number;
  routingRules: number;
  activeRoutes: number;
}
interface HealthCountRow { state: string; count: number; }
interface LatestHealthRow {
  provider_id: string;
  checked_at: string;
  state: string;
  latency_ms: number | null;
  error_message: string | null;
}

export async function getAdminUsageSummary(env: AdminEnv, toolCatalogCount = 0) {
  const [auditWindow, actionCounts, recentActions, registry, healthCounts, latestHealth, healthTotal] = await Promise.all([
    env.DM_DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN at >= datetime('now','-24 hours') THEN 1 ELSE 0 END) AS last24h,
        SUM(CASE WHEN at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS last7d
      FROM audit_events
    `).first<AuditWindowRow>(),

    env.DM_DB.prepare(`
      SELECT action, COUNT(*) AS count
      FROM audit_events
      GROUP BY action
      ORDER BY count DESC, action ASC
      LIMIT 20
    `).all<ActionCountRow>(),

    env.DM_DB.prepare(`
      SELECT action, at, target
      FROM audit_events
      ORDER BY id DESC
      LIMIT 10
    `).all<RecentActionRow>(),

    env.DM_DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM providers) AS providers,
        (SELECT COUNT(*) FROM providers WHERE enabled = 1) AS enabledProviders,
        (SELECT COUNT(*) FROM models) AS models,
        (SELECT COUNT(*) FROM models WHERE enabled = 1) AS enabledModels,
        (SELECT COUNT(*) FROM routing_rules) AS routingRules,
        (
          SELECT COUNT(*)
          FROM routing_rules r
          JOIN models m ON m.id = r.model_id
          JOIN providers p ON p.id = m.provider_id
          WHERE m.enabled = 1 AND p.enabled = 1
        ) AS activeRoutes
    `).first<RegistryRow>(),

    env.DM_DB.prepare(`
      SELECT state, COUNT(*) AS count
      FROM health_checks
      GROUP BY state
      ORDER BY count DESC, state ASC
    `).all<HealthCountRow>(),

    env.DM_DB.prepare(`
      SELECT provider_id, checked_at, state, latency_ms, error_message
      FROM health_checks
      ORDER BY id DESC
      LIMIT 1
    `).first<LatestHealthRow>(),

    env.DM_DB.prepare(`SELECT COUNT(*) AS count FROM health_checks`).first<CountRow>(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    totalAuditEvents: Number(auditWindow?.total ?? 0),
    recentActions: recentActions.results ?? [],
    activity: {
      totalAuditEvents: Number(auditWindow?.total ?? 0),
      last24h: Number(auditWindow?.last24h ?? 0),
      last7d: Number(auditWindow?.last7d ?? 0),
      byAction: actionCounts.results ?? [],
      recentActions: recentActions.results ?? [],
    },
    registry: {
      providers: Number(registry?.providers ?? 0),
      enabledProviders: Number(registry?.enabledProviders ?? 0),
      models: Number(registry?.models ?? 0),
      enabledModels: Number(registry?.enabledModels ?? 0),
      routingRules: Number(registry?.routingRules ?? 0),
      activeRoutes: Number(registry?.activeRoutes ?? 0),
      toolCatalogCount,
    },
    health: {
      totalChecks: Number(healthTotal?.count ?? 0),
      byState: healthCounts.results ?? [],
      latest: latestHealth ?? null,
    },
    coverage: {
      auditActivity: { available: true, source: "D1.audit_events" },
      healthChecks: { available: true, source: "D1.health_checks" },
      registry: { available: true, source: "D1 providers/models/routing_rules" },
      toolCatalog: { available: true, source: "runtime toolCatalog" },
      gatewayRequests: { available: false, reason: "not_instrumented" },
      tokens: { available: false, reason: "not_instrumented" },
      cost: { available: false, reason: "not_instrumented" },
    },
  };
}
