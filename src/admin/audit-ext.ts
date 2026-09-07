/**
 * DreamWorker / cf-control-mcp — richer read-only Audit API helpers.
 *
 * Optional backend extension. It does not mutate data and never exposes secrets.
 * Use this only if you want server-side filtering/pagination beyond the current
 * /admin/api/logs response, which returns recentAudit(env) directly.
 */
import type { AdminEnv } from "./types";

export interface AuditQuery {
  limit?: number;
  beforeId?: number;
  actor?: string;
  actionPrefix?: string;
  target?: string;
  search?: string;
}

interface CountRow { count: number; }
interface AuditEventRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

export async function queryAuditEvents(env: AdminEnv, query: AuditQuery = {}) {
  const limit = Math.max(1, Math.min(100, Number(query.limit ?? 50)));
  const where: string[] = [];
  const bindings: Array<string | number> = [];

  if (Number.isInteger(query.beforeId) && Number(query.beforeId) > 0) {
    where.push("id < ?");
    bindings.push(Number(query.beforeId));
  }
  if (query.actor?.trim()) {
    where.push("actor = ?");
    bindings.push(query.actor.trim());
  }
  if (query.actionPrefix?.trim()) {
    where.push("action LIKE ?");
    bindings.push(`${query.actionPrefix.trim()}%`);
  }
  if (query.target?.trim()) {
    where.push("target = ?");
    bindings.push(query.target.trim());
  }
  if (query.search?.trim()) {
    where.push("(action LIKE ? OR actor LIKE ? OR COALESCE(target,'') LIKE ? OR COALESCE(detail,'') LIKE ?)");
    const q = `%${query.search.trim()}%`;
    bindings.push(q, q, q, q);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.DM_DB.prepare(`
    SELECT id, at, actor, action, target, detail
    FROM audit_events
    ${clause}
    ORDER BY id DESC
    LIMIT ?
  `).bind(...bindings, limit).all<AuditEventRow>();

  const count = await env.DM_DB.prepare(`
    SELECT COUNT(*) AS count
    FROM audit_events
    ${clause}
  `).bind(...bindings).first<CountRow>();

  const events = rows.results ?? [];
  return {
    events,
    totalMatching: Number(count?.count ?? 0),
    nextBeforeId: events.length === limit ? events[events.length - 1]?.id ?? null : null,
    query: {
      limit,
      actor: query.actor ?? null,
      actionPrefix: query.actionPrefix ?? null,
      target: query.target ?? null,
      search: query.search ?? null,
    },
  };
}
