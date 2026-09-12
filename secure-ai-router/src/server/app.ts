import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { providers, models, apiKeys, policies, requests, routingDecisions, securityEvents, auditLog, requestAttempts } from './db/schema';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { encryptSecret } from './crypto';
import { inspectPrompt, checkAbusePattern } from './firewall';
import { containsSensitiveData } from './policy';
import { routeRequest, getEligibleCandidates, type PolicyContext } from './router';
import { recordProviderOutcome } from './health';
import type { AppDb } from './db/types';
import { buildTopologyPayload } from '../topology/payload';

// ── Runtime contract ────────────────────────────────────────────────────────
// app.ts never imports a concrete database driver. The Node entrypoint (server.ts)
// and the Cloudflare entrypoint (worker.ts) each construct an `AppDb` for their own
// runtime and hand it in as a Hono Binding named `db`; a tiny middleware below copies
// it onto the request context so every handler can do `const db = c.get('db')`.
export interface AppBindings {
  db: AppDb;
  BOOTSTRAP_SECRET?: string;
}

type ApiKeyRow = typeof apiKeys.$inferSelect;

interface AppVariables {
  db: AppDb;
  apiKey: ApiKeyRow;
}

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
app.use('*', cors());
app.use('*', async (c, next) => {
  c.set('db', c.env.db);
  await next();
});

// ─── Auth ───────────────────────────────────────────────────────────────────
type Role = 'admin' | 'gateway';

async function authenticate(db: AppDb, token: string | undefined, requiredRole: Role) {
  if (!token) return null;
  const prefix = token.slice(0, 12);
  const candidates = await db.query.apiKeys.findMany({
    where: and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.revoked, false)),
  });
  for (const candidate of candidates) {
    if (await bcrypt.compare(token, candidate.keyHash)) {
      if (requiredRole === 'admin' && candidate.role !== 'admin') return null;
      await db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, candidate.id));
      return candidate;
    }
  }
  return null;
}

const authMiddleware = (role: Role) => async (c: any, next: any) => {
  const db: AppDb = c.get('db');
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const token = authHeader.slice(7);
  const key = await authenticate(db, token, role);
  if (!key) return c.json({ error: role === 'admin' ? 'Forbidden' : 'Unauthorized' }, role === 'admin' ? 403 : 401);
  c.set('apiKey', key);
  await next();
};

// ─── Audit log helper — every admin mutation writes one entry here ─────────
async function writeAudit(db: AppDb, actor: ApiKeyRow | undefined, action: string, resourceType: string, resourceId: string | null, detail: string) {
  await db.insert(auditLog).values({
    id: uuidv4(),
    timestamp: Date.now(),
    actorKeyId: actor?.id ?? null,
    actorName: actor?.name ?? 'unknown',
    action,
    resourceType,
    resourceId,
    detail,
  });
}

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.get('/api/runtime', (c) => {
  const runtimeProcess = typeof process !== 'undefined' ? process : null;
  const mem = runtimeProcess?.memoryUsage?.();
  const cpu = runtimeProcess?.cpuUsage?.();
  return c.json({
    heapUsedMb: mem ? Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10 : 0,
    heapTotalMb: mem ? Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10 : 0,
    rssMb: mem ? Math.round((mem.rss / 1024 / 1024) * 10) / 10 : 0,
    cpuUserMs: cpu ? Math.round(cpu.user / 1000) : 0,
    cpuSystemMs: cpu ? Math.round(cpu.system / 1000) : 0,
    uptimeSeconds: runtimeProcess?.uptime ? Math.round(runtimeProcess.uptime()) : 0,
  });
});

app.get('/api/readiness', async (c) => {
  const db = c.get('db');
  const since = Date.now() - DAY_MS;
  const [
    allProviders,
    allModels,
    allPolicies,
    allKeys,
    recentRequests,
    errorRows,
    blockedRows,
    lastRequest,
    lastSecurityEvent,
  ] = await Promise.all([
    db.query.providers.findMany(),
    db.query.models.findMany(),
    db.query.policies.findMany(),
    db.query.apiKeys.findMany(),
    db.select({ count: sql<number>`count(*)` }).from(requests).where(gte(requests.timestamp, since)),
    db.select({ count: sql<number>`count(*)` }).from(requests).where(and(gte(requests.timestamp, since), eq(requests.status, 'error'))),
    db.select({ count: sql<number>`count(*)` }).from(requests).where(and(gte(requests.timestamp, since), eq(requests.status, 'blocked'))),
    db.query.requests.findFirst({ orderBy: [desc(requests.timestamp)] }),
    db.query.securityEvents.findFirst({ orderBy: [desc(securityEvents.timestamp)] }),
  ]);

  const activeKeys = allKeys.filter((key) => !key.revoked);
  const adminKeys = activeKeys.filter((key) => key.role === 'admin').length;
  const gatewayKeys = activeKeys.filter((key) => key.role === 'gateway').length;
  const enabledProviders = allProviders.filter((provider) => provider.enabled);
  const healthyProviders = enabledProviders.filter((provider) => provider.healthStatus === 'healthy').length;
  const degradedProviders = enabledProviders.filter((provider) => provider.healthStatus === 'degraded').length;
  const offlineProviders = enabledProviders.filter((provider) => provider.healthStatus === 'offline').length;
  const enabledModelCount = allModels.filter((model) => model.enabled).length;
  const issues: string[] = [];

  if (adminKeys === 0) issues.push('No active admin API key exists; bootstrap is required before admin mutations can work.');
  if (gatewayKeys === 0) issues.push('No active gateway API key exists; external clients cannot call /v1/chat/completions.');
  if (enabledProviders.length === 0) issues.push('No enabled provider is configured.');
  if (enabledProviders.length > 0 && healthyProviders === 0) issues.push('No enabled provider is currently healthy.');
  if (enabledModelCount === 0) issues.push('No enabled model is available for routing.');

  return c.json({
    ready: issues.length === 0,
    checkedAt: Date.now(),
    adminKeys,
    gatewayKeys,
    providerCount: allProviders.length,
    enabledProviders: enabledProviders.length,
    healthyProviders,
    degradedProviders,
    offlineProviders,
    modelCount: allModels.length,
    enabledModelCount,
    policyCount: allPolicies.length,
    requestCount24h: Number(recentRequests[0]?.count ?? 0),
    errorCount24h: Number(errorRows[0]?.count ?? 0),
    blockedCount24h: Number(blockedRows[0]?.count ?? 0),
    lastRequestAt: lastRequest?.timestamp ?? null,
    lastSecurityEventAt: lastSecurityEvent?.timestamp ?? null,
    issues,
  });
});

// ════════════════════════════════════════════════════════════════════════
// ADMIN API — provider/model/key/policy management (admin auth required)
// ════════════════════════════════════════════════════════════════════════
const adminApp = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
adminApp.use('*', authMiddleware('admin'));

// Lets the dashboard verify a pasted admin key and learn who it belongs to,
// without needing a username/password login system the schema never modeled.
adminApp.get('/whoami', async (c) => {
  const key = c.get('apiKey');
  return c.json({ id: key.id, name: key.name, role: key.role });
});

adminApp.get('/providers', async (c) => {
  const db = c.get('db');
  const all = await db.query.providers.findMany();
  return c.json(all.map(({ apiKeyEncrypted, ...rest }) => ({ ...rest, hasApiKey: !!apiKeyEncrypted })));
});

adminApp.post('/providers', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  if (!body.name || !body.baseUrl) return c.json({ error: 'name and baseUrl are required' }, 400);
  const id = uuidv4();
  await db.insert(providers).values({
    id,
    name: body.name,
    type: body.type ?? 'openai_compatible',
    baseUrl: body.baseUrl,
    apiKeyEncrypted: body.apiKey ? encryptSecret(body.apiKey) : null,
    enabled: body.enabled ?? true,
    priority: body.priority ?? 1,
    costPerToken: body.costPerToken ?? 0,
    healthStatus: 'offline',
    successRate: 1,
    createdAt: Date.now(),
  });
  await writeAudit(db, c.get('apiKey'), 'create', 'provider', id, `Created provider "${body.name}" (${body.type ?? 'openai_compatible'})`);
  return c.json({ id, status: 'created' });
});

adminApp.put('/providers/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json();
  await db.update(providers).set({
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
    ...(body.apiKey ? { apiKeyEncrypted: encryptSecret(body.apiKey) } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.costPerToken !== undefined ? { costPerToken: body.costPerToken } : {}),
    ...(body.metadata?.costPer1k !== undefined ? { costPerToken: Number(body.metadata.costPer1k) / 1000 } : {}),
  }).where(eq(providers.id, id));
  await writeAudit(db, c.get('apiKey'), 'update', 'provider', id, `Updated provider fields: ${Object.keys(body).filter((k) => k !== 'apiKey').join(', ')}${body.apiKey ? ', apiKey' : ''}`);
  return c.json({ status: 'updated' });
});

adminApp.delete('/providers/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  await db.delete(providers).where(eq(providers.id, id));
  await writeAudit(db, c.get('apiKey'), 'delete', 'provider', id, 'Deleted provider');
  return c.json({ status: 'deleted' });
});

adminApp.get('/models', async (c) => {
  const db = c.get('db');
  const all = await db.select({
    id: models.id,
    providerId: models.providerId,
    modelName: models.modelName,
    capabilities: models.capabilities,
    contextWindow: models.contextWindow,
    inputCost: models.inputCost,
    outputCost: models.outputCost,
    enabled: models.enabled,
    providerName: providers.name,
    providerHealth: providers.healthStatus,
  }).from(models).leftJoin(providers, eq(models.providerId, providers.id));
  return c.json(all);
});

adminApp.post('/models', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  if (!body.providerId || !body.modelName) return c.json({ error: 'providerId and modelName are required' }, 400);
  const id = uuidv4();
  await db.insert(models).values({
    id,
    providerId: body.providerId,
    modelName: body.modelName,
    capabilities: JSON.stringify(body.capabilities ?? []),
    contextWindow: body.contextWindow ?? 8192,
    inputCost: body.inputCost ?? 0,
    outputCost: body.outputCost ?? 0,
    enabled: body.enabled ?? true,
    createdAt: Date.now(),
  });
  await writeAudit(db, c.get('apiKey'), 'create', 'model', id, `Created model "${body.modelName}" for provider ${body.providerId}`);
  return c.json({ id, status: 'created' });
});

adminApp.put('/models/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json();
  await db.update(models).set({
    ...(body.modelName !== undefined ? { modelName: body.modelName } : {}),
    ...(body.capabilities !== undefined ? { capabilities: JSON.stringify(body.capabilities) } : {}),
    ...(body.contextWindow !== undefined ? { contextWindow: body.contextWindow } : {}),
    ...(body.inputCost !== undefined ? { inputCost: body.inputCost } : {}),
    ...(body.outputCost !== undefined ? { outputCost: body.outputCost } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  }).where(eq(models.id, id));
  await writeAudit(db, c.get('apiKey'), 'update', 'model', id, `Updated model fields: ${Object.keys(body).join(', ')}`);
  return c.json({ status: 'updated' });
});

adminApp.delete('/models/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  await db.delete(models).where(eq(models.id, id));
  await writeAudit(db, c.get('apiKey'), 'delete', 'model', id, 'Deleted model');
  return c.json({ status: 'deleted' });
});

adminApp.get('/policies', async (c) => {
  const rows = await c.get('db').query.policies.findMany();
  return c.json(rows.map((p) => ({ ...p, value: describePolicyConfig(p.type, p.config) })));
});

adminApp.post('/policies', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  if (!body.type) return c.json({ error: 'type is required' }, 400);
  const id = uuidv4();
  const config = body.config ?? legacyPolicyValueToConfig(body.type, body.value);
  const policyName = body.name ?? body.type.replace(/_/g, ' ');
  await db.insert(policies).values({
    id,
    name: policyName,
    type: body.type,
    config: JSON.stringify(config ?? {}),
    action: body.action ?? 'deny',
    enabled: body.enabled ?? true,
    createdAt: Date.now(),
  });
  await writeAudit(db, c.get('apiKey'), 'create', 'policy', id, `Created policy "${policyName}" (${body.type})`);
  return c.json({ id, status: 'created' });
});

adminApp.put('/policies/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json();
  await db.update(policies).set({
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.config !== undefined ? { config: JSON.stringify(body.config) } : {}),
    ...(body.action !== undefined ? { action: body.action } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  }).where(eq(policies.id, id));
  await writeAudit(db, c.get('apiKey'), 'update', 'policy', id, `Updated policy fields: ${Object.keys(body).join(', ')}`);
  return c.json({ status: 'updated' });
});

adminApp.delete('/policies/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  await db.delete(policies).where(eq(policies.id, id));
  await writeAudit(db, c.get('apiKey'), 'delete', 'policy', id, 'Deleted policy');
  return c.json({ status: 'deleted' });
});

adminApp.get('/keys', async (c) => {
  const all = await c.get('db').query.apiKeys.findMany();
  return c.json(all.map(({ keyHash, ...rest }) => ({
    ...rest,
    maskedKey: rest.keyPrefix ? `${rest.keyPrefix}…` : '****',
  })));
});

adminApp.post('/keys', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  const role: Role = body.role === 'admin' ? 'admin' : 'gateway';
  const raw = `${role === 'admin' ? 'admin' : 'sk'}_${crypto.randomBytes(32).toString('base64url')}`;
  const keyHash = await bcrypt.hash(raw, 10);
  const id = uuidv4();
  await db.insert(apiKeys).values({
    id,
    keyHash,
    keyPrefix: raw.slice(0, 12),
    name: body.name ?? 'Unnamed key',
    role,
    revoked: false,
    createdAt: Date.now(),
  });
  await writeAudit(db, c.get('apiKey'), 'create', 'api_key', id, `Issued ${role} key "${body.name ?? 'Unnamed key'}"`);
  // Raw key is returned exactly once — the server never stores or logs it again.
  return c.json({ id, name: body.name ?? 'Unnamed key', rawKey: raw, rawSecret: raw, status: 'created' });
});

adminApp.post('/keys/:id/revoke', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  await db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, id));
  await writeAudit(db, c.get('apiKey'), 'revoke', 'api_key', id, 'Revoked API key');
  return c.json({ status: 'revoked' });
});

adminApp.delete('/keys/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  await db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, id));
  await writeAudit(db, c.get('apiKey'), 'revoke', 'api_key', id, 'Revoked API key');
  return c.json({ status: 'revoked' });
});

adminApp.get('/audit-log', async (c) => {
  const db = c.get('db');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const entries = await db.query.auditLog.findMany({ orderBy: [desc(auditLog.timestamp)], limit });
  return c.json(entries);
});


adminApp.get('/topology', async (c) => {
  return c.json(await readTopologyPayload(c.get('db')));
});

adminApp.post('/providers/ping', async (c) => {
  const db = c.get('db');
  const { checkProviderHealth } = await import('./health');
  const allProviders = await db.query.providers.findMany({ where: eq(providers.enabled, true) });
  const settled = await Promise.allSettled(allProviders.map((provider) => checkProviderHealth(db, provider)));
  await writeAudit(db, c.get('apiKey'), 'health_check', 'provider', null, `Manual health check for ${allProviders.length} providers`);
  return c.json({
    checked: allProviders.length,
    fulfilled: settled.filter((item) => item.status === 'fulfilled').length,
    rejected: settled.filter((item) => item.status === 'rejected').length,
  });
});

app.route('/api/admin', adminApp);

// ════════════════════════════════════════════════════════════════════════
// DASHBOARD READ API — aggregated operational data, no secrets exposed.
// Kept unauthenticated deliberately: these are read-only observability views
// (no provider credentials or raw gateway/admin keys are ever returned here).
// Admin mutation routes above still require a Bearer admin key.
// ════════════════════════════════════════════════════════════════════════

function legacyPolicyValueToConfig(type: string, value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || String(value).trim() === '') return {};
  const values = String(value).split(',').map((v) => v.trim()).filter(Boolean);
  if (type.startsWith('model_')) return { models: values };
  if (type.startsWith('provider_')) return { providers: values };
  if (type === 'token_limit_daily' || type === 'token_budget') return { limit: Number(values[0] ?? 0) || 0 };
  if (type === 'rate_limit_ip') return { requestsPerMinute: Number(values[0] ?? 0) || 0 };
  return { value };
}

function describePolicyConfig(type: string, raw: unknown): string {
  const config = typeof raw === 'string' ? safeObject(raw) : (raw && typeof raw === 'object' ? raw as Record<string, unknown> : {});
  if (type.startsWith('model_') && Array.isArray(config.models)) return config.models.join(', ');
  if (type.startsWith('provider_') && Array.isArray(config.providers)) return config.providers.join(', ');
  if ('limit' in config) return String(config.limit);
  if ('requestsPerMinute' in config) return String(config.requestsPerMinute);
  return Object.keys(config).length ? JSON.stringify(config) : 'No data';
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function readTopologyPayload(db: AppDb) {
  const since = Date.now() - DAY_MS;

  const byClient = await db
    .select({
      clientId: requests.clientId,
      count: sql<number>`count(*)`,
      avgLatency: sql<number>`avg(${requests.latencyMs})`,
    })
    .from(requests)
    .where(gte(requests.timestamp, since))
    .groupBy(requests.clientId);

  const byProvider = await db
    .select({
      providerId: requests.providerId,
      count: sql<number>`count(*)`,
      avgLatency: sql<number>`avg(${requests.latencyMs})`,
    })
    .from(requests)
    .where(gte(requests.timestamp, since))
    .groupBy(requests.providerId);

  const [keys, allProviders, allModels] = await Promise.all([
    db.query.apiKeys.findMany(),
    db.query.providers.findMany(),
    db.query.models.findMany(),
  ]);

  return buildTopologyPayload({
    clientTraffic: byClient.map((row) => ({
      clientId: row.clientId ? String(row.clientId) : null,
      count: Number(row.count),
      avgLatency: row.avgLatency === null ? null : Number(row.avgLatency),
    })),
    providerTraffic: byProvider.map((row) => ({
      providerId: row.providerId ? String(row.providerId) : null,
      count: Number(row.count),
      avgLatency: row.avgLatency === null ? null : Number(row.avgLatency),
    })),
    apiKeys: keys.map((key) => ({ id: String(key.id), name: String(key.name), role: key.role })),
    providers: allProviders.map((provider) => ({
      id: String(provider.id),
      name: provider.name,
      status: provider.enabled ? provider.healthStatus : 'disabled',
      enabled: provider.enabled,
      metadata: {
        baseLatency: provider.latencyMs ?? undefined,
        successRate: Math.round((provider.successRate ?? 0) * 1000) / 10,
        costPer1k: Math.round((provider.costPerToken ?? 0) * 1000 * 1_000_000) / 1_000_000,
      },
    })),
    models: allModels.map((model) => ({
      providerId: model.providerId ? String(model.providerId) : null,
      enabled: model.enabled,
    })),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

app.get('/api/providers', async (c) => {
  const all = await c.get('db').query.providers.findMany();
  return c.json(all.map(({ apiKeyEncrypted, ...rest }) => rest));
});


app.get('/api/models', async (c) => {
  const db = c.get('db');
  const rows = await db.select({
    id: models.id,
    providerId: models.providerId,
    modelName: models.modelName,
    capabilities: models.capabilities,
    contextWindow: models.contextWindow,
    inputCost: models.inputCost,
    outputCost: models.outputCost,
    enabled: models.enabled,
    providerName: providers.name,
    providerHealth: providers.healthStatus,
  }).from(models).leftJoin(providers, eq(models.providerId, providers.id));
  return c.json(rows);
});

app.get('/api/providers/health', async (c) => {
  const db = c.get('db');
  const since = Date.now() - DAY_MS;
  const all = await db.query.providers.findMany();
  const traffic = await db
    .select({ providerId: requests.providerId, count: sql<number>`count(*)` })
    .from(requests)
    .where(gte(requests.timestamp, since))
    .groupBy(requests.providerId);
  const observedTraffic = traffic.reduce((sum, t) => sum + Number(t.count), 0);
  const totalTraffic = observedTraffic > 0 ? observedTraffic : 1;
  const trafficByProvider = new Map<string | null, number>(traffic.map((t) => [t.providerId as (string | null), Number(t.count)]));

  return c.json(all.map(({ apiKeyEncrypted, ...p }) => ({
    ...p,
    requestsLast24h: trafficByProvider.get(String(p.id)) ?? 0,
    trafficSharePct: Math.round(((trafficByProvider.get(String(p.id)) ?? 0) / totalTraffic) * 1000) / 10,
  })));
});

app.get('/api/routing/history', async (c) => {
  const db = c.get('db');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const history = await db
    .select({
      id: routingDecisions.id,
      timestamp: routingDecisions.timestamp,
      requestType: routingDecisions.requestType,
      selectedProviderId: routingDecisions.selectedProviderId,
      selectedModelId: routingDecisions.selectedModelId,
      score: routingDecisions.score,
      reasons: routingDecisions.reasons,
      latencyMs: requests.latencyMs,
      status: requests.status,
      providerName: providers.name,
      modelName: models.modelName,
    })
    .from(routingDecisions)
    .leftJoin(requests, eq(routingDecisions.requestId, requests.id))
    .leftJoin(providers, eq(routingDecisions.selectedProviderId, providers.id))
    .leftJoin(models, eq(routingDecisions.selectedModelId, models.id))
    .orderBy(desc(routingDecisions.timestamp))
    .limit(limit);
  return c.json(history);
});

app.get('/api/security/events', async (c) => {
  const db = c.get('db');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const events = await db.query.securityEvents.findMany({
    orderBy: [desc(securityEvents.timestamp)],
    limit,
  });
  return c.json(events);
});

app.get('/api/topology', async (c) => {
  return c.json(await readTopologyPayload(c.get('db')));
});

app.get('/api/analytics', async (c) => {
  const db = c.get('db');
  const windowHours = Math.min(Math.max(Number(c.req.query('hours') ?? 24), 1), 24 * 30);
  const since = Date.now() - windowHours * 60 * 60 * 1000;

  const totals = await db
    .select({
      count: sql<number>`count(*)`,
      avgLatency: sql<number>`avg(${requests.latencyMs})`,
      tokensIn: sql<number>`coalesce(sum(${requests.tokensInput}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${requests.tokensOutput}), 0)`,
      cost: sql<number>`coalesce(sum(${requests.cost}), 0)`,
    })
    .from(requests)
    .where(gte(requests.timestamp, since));

  const byStatus = await db
    .select({ status: requests.status, count: sql<number>`count(*)` })
    .from(requests)
    .where(gte(requests.timestamp, since))
    .groupBy(requests.status);

  const byRequestType = await db
    .select({ requestType: requests.requestType, count: sql<number>`count(*)` })
    .from(requests)
    .where(gte(requests.timestamp, since))
    .groupBy(requests.requestType);

  const byProvider = await db
    .select({ providerId: requests.providerId, count: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${requests.cost}), 0)`, avgLatency: sql<number>`avg(${requests.latencyMs})` })
    .from(requests)
    .where(gte(requests.timestamp, since))
    .groupBy(requests.providerId);

  const bySeverity = await db
    .select({ severity: securityEvents.severity, count: sql<number>`count(*)` })
    .from(securityEvents)
    .where(gte(securityEvents.timestamp, since))
    .groupBy(securityEvents.severity);

  // Hourly request-volume series for the trend chart, bucketed to the requested window.
  const bucketMs = windowHours <= 24 ? 60 * 60 * 1000 : DAY_MS;
  const buckets = await db
    .select({ bucket: sql<number>`(${requests.timestamp} / ${bucketMs}) * ${bucketMs}`, count: sql<number>`count(*)` })
    .from(requests)
    .where(gte(requests.timestamp, since))
    .groupBy(sql`(${requests.timestamp} / ${bucketMs})`)
    .orderBy(sql`(${requests.timestamp} / ${bucketMs})`);

  const allProviders = await db.query.providers.findMany();
  const providerById = new Map(allProviders.map((p) => [p.id, p.name]));

  return c.json({
    windowHours,
    totalRequests: Number(totals[0]?.count ?? 0),
    avgLatencyMs: Math.round(Number(totals[0]?.avgLatency) || 0),
    totalTokens: Number(totals[0]?.tokensIn ?? 0) + Number(totals[0]?.tokensOut ?? 0),
    tokensIn: Number(totals[0]?.tokensIn ?? 0),
    tokensOut: Number(totals[0]?.tokensOut ?? 0),
    estimatedCost: Number(totals[0]?.cost ?? 0),
    byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
    byRequestType: byRequestType.map((r) => ({ requestType: r.requestType, count: Number(r.count) })),
    byProvider: byProvider.map((r) => ({
      providerId: r.providerId,
      providerName: r.providerId ? providerById.get(r.providerId) ?? 'Unknown' : 'Unassigned',
      count: Number(r.count),
      cost: Number(r.cost),
      avgLatencyMs: Math.round(Number(r.avgLatency) || 0),
    })),
    securityBySeverity: bySeverity.map((r) => ({ severity: r.severity, count: Number(r.count) })),
    requestVolumeSeries: buckets.map((b) => ({ timestamp: Number(b.bucket), count: Number(b.count) })),
  });
});

app.get('/api/dashboard/stats', async (c) => {
  const db = c.get('db');
  const since = Date.now() - DAY_MS;

  const allProviders = await db.query.providers.findMany({ where: eq(providers.enabled, true) });
  const healthy = allProviders.filter((p) => p.healthStatus === 'healthy').length;
  const degraded = allProviders.filter((p) => p.healthStatus === 'degraded').length;
  const offline = allProviders.filter((p) => p.healthStatus === 'offline').length;

  const totals = await db
    .select({
      count: sql<number>`count(*)`,
      avgLatency: sql<number>`avg(${requests.latencyMs})`,
      tokens: sql<number>`coalesce(sum(${requests.tokensInput} + ${requests.tokensOutput}), 0)`,
      cost: sql<number>`coalesce(sum(${requests.cost}), 0)`,
    })
    .from(requests)
    .where(gte(requests.timestamp, since));

  const blockedThreats = await db
    .select({ count: sql<number>`count(*)` })
    .from(securityEvents)
    .where(and(gte(securityEvents.timestamp, since), eq(securityEvents.action, 'BLOCK')));

  const avgSuccessRate = allProviders.length
    ? allProviders.reduce((s, p) => s + (p.successRate ?? 0), 0) / allProviders.length
    : 0;

  return c.json({
    totalRequestsLast24h: Number(totals[0]?.count ?? 0),
    activeProviders: allProviders.length,
    healthyProviders: healthy,
    degradedProviders: degraded,
    offlineProviders: offline,
    avgLatencyMs: Math.round(Number(totals[0]?.avgLatency) || 0),
    blockedThreatsLast24h: Number(blockedThreats[0]?.count ?? 0),
    tokenUsageLast24h: Number(totals[0]?.tokens ?? 0),
    estimatedCostLast24h: Number(totals[0]?.cost ?? 0),
    networkHealthPct: Math.round(avgSuccessRate * 1000) / 10,
  });
});

// Raw per-request log stream — powers the "Logs" page. Supports simple filtering +
// cursor-free offset pagination, which is enough for an operational log viewer.
app.get('/api/logs', async (c) => {
  const db = c.get('db');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const status = c.req.query('status');
  const requestType = c.req.query('requestType');

  const conditions = [];
  if (status) conditions.push(eq(requests.status, status));
  if (requestType) conditions.push(eq(requests.requestType, requestType));

  const allProviders = await db.query.providers.findMany();
  const providerById = new Map(allProviders.map((p) => [p.id, p.name]));
  const allKeys = await db.query.apiKeys.findMany();
  const keyById = new Map(allKeys.map((k) => [k.id, k.name]));

  const rows = await db
    .select()
    .from(requests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(requests.timestamp))
    .limit(limit)
    .offset(offset);

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(requests)
    .where(conditions.length ? and(...conditions) : undefined);

  return c.json({
    total: Number(totalRow[0]?.count ?? 0),
    items: rows.map((r) => ({
      ...r,
      providerName: r.providerId ? providerById.get(r.providerId) ?? 'Unknown' : null,
      clientName: keyById.get(r.clientId) ?? 'Unknown client',
    })),
  });
});

// Full explainable routing trail (candidate scoring) behind each request — powers
// the "Traces" page. Same underlying table as /api/routing/history but returns the
// full `candidates` array instead of just the winner, for the detail drill-down view.
app.get('/api/traces', async (c) => {
  const db = c.get('db');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

  const rows = await db
    .select({
      id: routingDecisions.id,
      requestId: routingDecisions.requestId,
      timestamp: routingDecisions.timestamp,
      requestType: routingDecisions.requestType,
      selectedProviderId: routingDecisions.selectedProviderId,
      selectedModelId: routingDecisions.selectedModelId,
      score: routingDecisions.score,
      reasons: routingDecisions.reasons,
      candidates: routingDecisions.candidates,
      latencyMs: requests.latencyMs,
      status: requests.status,
      requestedModel: requests.requestedModel,
      tokensInput: requests.tokensInput,
      tokensOutput: requests.tokensOutput,
      cost: requests.cost,
      providerName: providers.name,
      modelName: models.modelName,
    })
    .from(routingDecisions)
    .leftJoin(requests, eq(routingDecisions.requestId, requests.id))
    .leftJoin(providers, eq(routingDecisions.selectedProviderId, providers.id))
    .leftJoin(models, eq(routingDecisions.selectedModelId, models.id))
    .orderBy(desc(routingDecisions.timestamp))
    .limit(limit);

  return c.json(rows.map((r) => ({
    ...r,
    reasons: safeJsonArray(r.reasons),
    candidates: safeJsonArray(r.candidates),
  })));
});

// Computed alert feed — derived from live provider health + recent security events.
// No separate "alerts" table exists in the schema; these are read straight off state
// that's already tracked elsewhere, so there is nothing to fall out of sync.
app.get('/api/alerts', async (c) => {
  const db = c.get('db');
  const since = Date.now() - DAY_MS;

  const allProviders = await db.query.providers.findMany({ where: eq(providers.enabled, true) });
  const recentSecurityEvents = await db.query.securityEvents.findMany({
    where: gte(securityEvents.timestamp, since),
    orderBy: [desc(securityEvents.timestamp)],
    limit: 100,
  });

  const alerts: Array<{ id: string; severity: string; type: string; title: string; detail: string; timestamp: number; actionPath?: string; actionLabel?: string; source?: string }> = [];

  for (const p of allProviders) {
    if (p.healthStatus === 'offline') {
      alerts.push({
        id: `provider-offline-${p.id}`, severity: 'critical', type: 'provider_offline',
        title: `${p.name} is offline`,
        detail: `${p.consecutiveFailures} consecutive health-check failures. Requests are being routed around this provider.`,
        timestamp: p.lastHealthCheck ?? Date.now(),
        actionPath: '/providers',
        actionLabel: 'Manage Providers',
        source: 'Health Monitor',
      });
    } else if (p.healthStatus === 'degraded') {
      alerts.push({
        id: `provider-degraded-${p.id}`, severity: 'medium', type: 'provider_degraded',
        title: `${p.name} is degraded`,
        detail: `Rolling success rate is ${(p.successRate * 100).toFixed(1)}%.`,
        timestamp: p.lastHealthCheck ?? Date.now(),
        actionPath: '/routing',
        actionLabel: 'Review Routing',
        source: 'Health Monitor',
      });
    }
  }

  for (const e of recentSecurityEvents) {
    if (e.severity === 'critical' || e.severity === 'high') {
      alerts.push({
        id: `security-${e.id}`, severity: e.severity, type: e.eventType,
        title: `${e.eventType.replace(/_/g, ' ')} — ${e.action}`,
        detail: e.detail ?? '', timestamp: e.timestamp,
        actionPath: '/firewall',
        actionLabel: 'View Firewall',
        source: e.source ?? 'AI Firewall',
      });
    }
  }

  alerts.sort((a, b) => b.timestamp - a.timestamp);
  return c.json(alerts);
});

function safeJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════
// GATEWAY API — OpenAI-compatible surface (gateway-key auth)
// ════════════════════════════════════════════════════════════════════════

app.get('/v1/models', authMiddleware('gateway'), async (c) => {
  const db = c.get('db');
  const enabledModels = await db.query.models.findMany({ where: eq(models.enabled, true) });
  return c.json({
    object: 'list',
    data: enabledModels.map((m) => ({ id: m.modelName, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'omniroute' })),
  });
});

const MAX_FAILOVER_ATTEMPTS = 3;

/** Classify whether an upstream failure is retryable for failover purposes. */
function classifyFailure(httpStatus: number | null, err: Error | null): {
  retryable: boolean;
  category: string;
} {
  if (err) {
    const msg = err.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) return { retryable: true, category: 'timeout' };
    return { retryable: true, category: 'network' };
  }
  if (httpStatus === null) return { retryable: true, category: 'network' };
  if (httpStatus === 429) return { retryable: true, category: 'rate_limited' };
  if (httpStatus >= 500 && httpStatus <= 599) return { retryable: true, category: 'upstream_5xx' };
  // 4xx (except 429) = client error or auth — not retryable
  return { retryable: false, category: `http_${httpStatus}` };
}

app.post('/v1/chat/completions', authMiddleware('gateway'), async (c) => {
  const db = c.get('db');
  const apiKey = c.get('apiKey');
  const startTime = Date.now();
  const body = await c.req.json().catch(() => null);

  if (!body || !Array.isArray(body.messages)) {
    return c.json({ error: { message: 'messages[] is required', type: 'invalid_request' } }, 400);
  }

  const requestId = uuidv4();
  const promptText = body.messages.map((m: any) => String(m?.content ?? '')).join('\n');
  const requestType: string = body.request_type ?? inferRequestType(body.model, promptText);
  const wantsStream = body.stream === true;
  const sensitiveDataDetected = containsSensitiveData(promptText);

  // ── 0. Create the request lifecycle row FIRST ───────────────────────────
  // request_attempts.request_id references requests.id (FK). Every attempt
  // insert below must happen against an already-existing request row, so the
  // row is created here in a 'pending' state and finalized via finalizeRequest()
  // on every exit path below — never inserted twice.
  await db.insert(requests).values({
    id: requestId,
    timestamp: Date.now(),
    clientId: apiKey.id,
    requestType,
    requestedModel: body.model,
    latencyMs: 0,
    tokensInput: 0,
    tokensOutput: 0,
    cost: 0,
    status: 'pending',
  });

  // ── 1. AI Firewall ──────────────────────────────────────────────────────
  const firewallResult = inspectPrompt(promptText);

  const since60s = Date.now() - 60_000;
  const recent = await db
    .select({ count: sql<number>`count(*)` })
    .from(requests)
    .where(and(eq(requests.clientId, apiKey.id), gte(requests.timestamp, since60s)));
  const abuseResult = checkAbusePattern(Number(recent[0]?.count ?? 0), 60, 60);

  const effectiveVerdict = firewallResult.verdict === 'BLOCK' || abuseResult.verdict === 'BLOCK' ? 'BLOCK'
    : firewallResult.verdict === 'WARN' || abuseResult.verdict === 'WARN' ? 'WARN' : 'ALLOW';
  const triggering = firewallResult.verdict !== 'ALLOW' ? firewallResult : abuseResult;

  if (effectiveVerdict !== 'ALLOW') {
    await logSecurityEvent(db, triggering, apiKey.name, requestId);
  }

  if (effectiveVerdict === 'BLOCK') {
    await finalizeRequest(db, requestId, {
      status: 'blocked', routingReason: triggering.detail, latencyMs: Date.now() - startTime,
    });
    return c.json({ error: { message: triggering.detail ?? 'Blocked by AI Firewall', type: 'security_error' } }, 403);
  }

  // ── 2. Policy-aware routing — policy is evaluated BEFORE provider selection ──
  // Candidates are pre-filtered by policy; only eligible candidates are ranked.
  const policyCtx: PolicyContext = {
    requestedModel: body.model,
    clientId: apiKey.id,
    containsSensitiveData: sensitiveDataDetected,
  };

  const routing = await routeRequest(db, requestType, body.model, policyCtx);

  if (!routing.selected) {
    // Log a policy_violation security event if policy was the blocker. `detail` carries the
    // full structured audit trail (policy id, name, action, match, decision, reason) for every
    // policy that was evaluated against every candidate — not just a flattened reason string.
    if (routing.policyDenied.length > 0) {
      const auditTrail = routing.candidates.flatMap((cand) =>
        (cand.policyEvaluations ?? []).map((rec) => ({ candidateProviderId: cand.providerId, candidateModel: cand.modelName, ...rec }))
      );
      await db.insert(securityEvents).values({
        id: uuidv4(), timestamp: Date.now(), eventType: 'policy_violation', severity: 'medium',
        source: apiKey.name, action: 'BLOCK',
        detail: JSON.stringify({ summary: routing.policyDenied.map(d => d.reason), auditTrail }),
        requestId,
      });
    }
    await finalizeRequest(db, requestId, {
      status: routing.policyDenied.length > 0 ? 'blocked' : 'error',
      routingReason: routing.reasons.join('; '), latencyMs: Date.now() - startTime,
    });
    return c.json({
      error: { message: routing.reasons.join('; ') || 'No eligible provider available', type: 'routing_error' },
    }, 503);
  }

  // ── 3. Failover loop — attempt up to MAX_FAILOVER_ATTEMPTS eligible candidates ──
  // The candidate list is already policy-filtered and score-ordered by routeRequest.
  const eligibleCandidates = routing.candidates.filter((c) => !c.policyIneligible);
  const { decryptSecret } = await import('./crypto');

  // Streaming: failover only before any bytes are committed.
  // After stream start, no safe retry is possible — we commit to the first candidate.
  if (wantsStream) {
    const selected = routing.selected;
    const selectedProvider = await db.query.providers.findFirst({ where: eq(providers.id, selected.providerId) });
    if (!selectedProvider) {
      return c.json({ error: { message: 'Selected provider no longer exists', type: 'routing_error' } }, 503);
    }

    c.header('Content-Type', 'text/event-stream; charset=utf-8');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    return stream(c, async (streamApi) => {
      const proxyStart = Date.now();
      let proxyOk = true;
      let tokensInput = 0;
      let tokensOutput = 0;

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
        if (selectedProvider.apiKeyEncrypted) {
          headers['Authorization'] = `Bearer ${decryptSecret(selectedProvider.apiKeyEncrypted)}`;
        }
        const proxyRes = await fetch(`${selectedProvider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, model: selected.modelName, stream: true, stream_options: { include_usage: true } }),
        });
        proxyOk = proxyRes.ok && !!proxyRes.body;

        if (!proxyRes.body) {
          const errText = await proxyRes.text().catch(() => '');
          await streamApi.write(`data: ${JSON.stringify({ error: { message: errText || 'Upstream returned no body', type: 'upstream_error' } })}\n\n`);
          await streamApi.write('data: [DONE]\n\n');
        } else {
          const reader = proxyRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await streamApi.write(value);
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const line = chunk.replace(/^data:\s*/, '').trim();
              if (!line || line === '[DONE]') continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.usage) {
                  tokensInput = Number(parsed.usage.prompt_tokens ?? tokensInput);
                  tokensOutput = Number(parsed.usage.completion_tokens ?? tokensOutput);
                }
              } catch { /* ignore non-JSON SSE lines */ }
            }
          }
        }
      } catch (err: any) {
        proxyOk = false;
        try {
          await streamApi.write(`data: ${JSON.stringify({ error: { message: `Upstream provider request failed: ${err.message}`, type: 'upstream_error' } })}\n\n`);
          await streamApi.write('data: [DONE]\n\n');
        } catch { /* client disconnected */ }
      }

      const proxyLatency = Date.now() - proxyStart;
      const attemptResult = proxyOk ? 'success' : 'retryable_error';
      await db.insert(requestAttempts).values({
        id: uuidv4(), requestId, attemptNumber: 1,
        providerId: selectedProvider.id, modelName: selected.modelName,
        startedAt: proxyStart, latencyMs: proxyLatency,
        result: attemptResult, failureCategory: proxyOk ? null : 'upstream_error',
        httpStatus: null, errorDetail: proxyOk ? null : 'stream failed',
      });
      await recordProviderOutcome(db, selectedProvider.id, proxyOk, proxyLatency);

      const modelRecord = await db.query.models.findFirst({ where: eq(models.id, selected.modelId) });
      const cost = modelRecord
        ? (tokensInput / 1000) * modelRecord.inputCost + (tokensOutput / 1000) * modelRecord.outputCost : 0;
      const totalLatency = Date.now() - startTime;

      await finalizeRequest(db, requestId, {
        selectedModel: selected.modelName, providerId: selectedProvider.id,
        status: proxyOk ? 'success' : 'error', routingReason: `${routing.reasons.join('; ')} (streamed)`,
        latencyMs: totalLatency, tokensInput, tokensOutput, cost,
      });
      await db.insert(routingDecisions).values({
        id: uuidv4(), requestId, timestamp: Date.now(), requestType,
        selectedProviderId: selectedProvider.id, selectedModelId: selected.modelId,
        score: selected.finalScore, reasons: JSON.stringify(routing.reasons),
        candidates: JSON.stringify(routing.candidates),
      });
    });
  }

  // ── Non-streaming: failover loop ─────────────────────────────────────────
  let responseData: any = null;
  let finalStatus = 502;
  let finalProviderId: string | null = null;
  let finalModelName: string | null = null;
  let finalModelId: string | null = null;
  let finalScore: number | null = null;
  let finalReasons: string[] = routing.reasons;
  let failoverOccurred = false;
  const attemptedProviderIds = new Set<string>();

  for (let attemptNum = 1; attemptNum <= Math.min(MAX_FAILOVER_ATTEMPTS, eligibleCandidates.length); attemptNum++) {
    // Pick next candidate not yet attempted
    const candidate = eligibleCandidates.find((c) => !attemptedProviderIds.has(c.providerId));
    if (!candidate) break;
    attemptedProviderIds.add(candidate.providerId);
    if (attemptNum > 1) failoverOccurred = true;

    const providerRow = await db.query.providers.findFirst({ where: eq(providers.id, candidate.providerId) });
    if (!providerRow) continue;

    const attemptStart = Date.now();
    let httpStatus: number | null = null;
    let attemptOk = false;
    let attemptErr: Error | null = null;
    let attemptData: any = null;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (providerRow.apiKeyEncrypted) {
        headers['Authorization'] = `Bearer ${decryptSecret(providerRow.apiKeyEncrypted)}`;
      }
      const proxyRes = await fetch(`${providerRow.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, model: candidate.modelName }),
      });
      httpStatus = proxyRes.status;
      attemptOk = proxyRes.ok;
      attemptData = await proxyRes.json();
    } catch (err: any) {
      attemptErr = err;
      attemptOk = false;
    }

    const attemptLatency = Date.now() - attemptStart;
    const { retryable, category } = classifyFailure(httpStatus, attemptErr);

    await db.insert(requestAttempts).values({
      id: uuidv4(), requestId, attemptNumber: attemptNum,
      providerId: providerRow.id, modelName: candidate.modelName,
      startedAt: attemptStart, latencyMs: attemptLatency,
      result: attemptOk ? 'success' : (retryable ? 'retryable_error' : 'non_retryable_error'),
      failureCategory: attemptOk ? null : category,
      httpStatus,
      errorDetail: attemptOk ? null : (attemptErr?.message ?? `HTTP ${httpStatus}`),
    });

    await recordProviderOutcome(db, providerRow.id, attemptOk, attemptLatency);

    if (attemptOk) {
      responseData = attemptData;
      finalStatus = httpStatus ?? 200;
      finalProviderId = providerRow.id;
      finalModelName = candidate.modelName;
      finalModelId = candidate.modelId;
      finalScore = candidate.finalScore;
      if (failoverOccurred) finalReasons = [...routing.reasons, `failover from attempt 1 to ${attemptNum}`];
      break;
    }

    // Non-retryable failure — stop attempting, report error
    if (!retryable) {
      responseData = attemptData ?? { error: { message: `Provider returned ${httpStatus}`, type: 'upstream_error' } };
      finalStatus = httpStatus ?? 502;
      finalProviderId = providerRow.id;
      finalModelName = candidate.modelName;
      finalModelId = candidate.modelId;
      finalScore = candidate.finalScore;
      break;
    }
    // retryable — continue loop
  }

  if (responseData === null) {
    // All candidates exhausted
    responseData = { error: { message: 'All available providers failed', type: 'upstream_error' } };
    finalStatus = 503;
  }

  const totalLatency = Date.now() - startTime;
  const tokensInput = Number(responseData?.usage?.prompt_tokens ?? 0);
  const tokensOutput = Number(responseData?.usage?.completion_tokens ?? 0);
  const modelRecord = finalModelId ? await db.query.models.findFirst({ where: eq(models.id, finalModelId) }) : null;
  const cost = modelRecord
    ? (tokensInput / 1000) * modelRecord.inputCost + (tokensOutput / 1000) * modelRecord.outputCost : 0;

  const reqStatus = finalStatus >= 200 && finalStatus < 300 ? 'success' : 'error';
  await finalizeRequest(db, requestId, {
    selectedModel: finalModelName ?? undefined, providerId: finalProviderId ?? undefined,
    status: reqStatus, routingReason: finalReasons.join('; '),
    latencyMs: totalLatency, tokensInput, tokensOutput, cost,
  });

  if (finalProviderId && finalModelId) {
    await db.insert(routingDecisions).values({
      id: uuidv4(), requestId, timestamp: Date.now(), requestType,
      selectedProviderId: finalProviderId, selectedModelId: finalModelId,
      score: finalScore ?? 0,
      reasons: JSON.stringify(finalReasons),
      candidates: JSON.stringify(routing.candidates),
    });
  }

  return c.json(responseData, finalStatus as any);
});

// ─── helpers ────────────────────────────────────────────────────────────────

function inferRequestType(model: string | undefined, text: string): string {
  const m = (model ?? '').toLowerCase();
  if (m.includes('embed')) return 'embeddings';
  if (m.includes('vision') || /\bimage\b/i.test(text)) return 'vision';
  if (m.includes('coder') || /```|\bfunction\b|\bclass\b|\bimport\b/.test(text)) return 'coding';
  if (m.includes('o1') || m.includes('reason')) return 'reasoning';
  return 'chat';
}

/** Finalizes the request row created up-front in the /v1/chat/completions handler.
 * Always an UPDATE against an already-existing row — never a second INSERT — so
 * request_attempts (inserted mid-flight, before this runs) always has a valid parent. */
async function finalizeRequest(db: AppDb, id: string, data: {
  selectedModel?: string; providerId?: string; status: string; routingReason?: string;
  latencyMs: number; tokensInput?: number; tokensOutput?: number; cost?: number;
}) {
  await db.update(requests).set({
    selectedModel: data.selectedModel,
    providerId: data.providerId,
    latencyMs: data.latencyMs,
    tokensInput: data.tokensInput ?? 0,
    tokensOutput: data.tokensOutput ?? 0,
    cost: data.cost ?? 0,
    routingReason: data.routingReason,
    status: data.status,
  }).where(eq(requests.id, id));
}

async function logSecurityEvent(db: AppDb, result: { eventType?: string; severity: string; detail?: string; verdict: string }, source: string, requestId: string) {
  await db.insert(securityEvents).values({
    id: uuidv4(),
    timestamp: Date.now(),
    eventType: result.eventType ?? 'suspicious_instruction',
    severity: result.severity,
    source,
    action: result.verdict,
    detail: result.detail,
    requestId,
  });
}


// ════════════════════════════════════════════════════════════════════════
// D1 BOOTSTRAP — one-time admin key seeding for fresh Cloudflare deployments
// Available only when zero admin keys exist.  Protected by a bootstrap secret
// set as a Cloudflare Worker secret: `wrangler secret put BOOTSTRAP_SECRET`.
// After the first admin key is created this endpoint is permanently closed
// (returns 403) for the lifetime of the database.
// ════════════════════════════════════════════════════════════════════════
app.post('/api/bootstrap', async (c) => {
  const db = c.get('db');

  // Fail closed immediately if any admin keys already exist.
  const existing = await db
    .select({ count: sql<number>`count(*)` })
    .from(apiKeys)
    .where(and(eq(apiKeys.role, 'admin'), eq(apiKeys.revoked, false)));
  if (Number(existing[0]?.count ?? 0) > 0) {
    return c.json({ error: 'Bootstrap already completed — endpoint is closed' }, 403);
  }

  // Verify the one-time bootstrap secret (env var, NOT a stored DB secret).
  const body = await c.req.json().catch(() => null);
  const providedSecret: string | undefined = body?.bootstrapSecret;
  const runtimeProcess = typeof process !== 'undefined' ? process : null;
  const envSecret: string | undefined =
    c.env?.BOOTSTRAP_SECRET ?? runtimeProcess?.env?.BOOTSTRAP_SECRET;

  if (!envSecret) {
    return c.json({ error: 'BOOTSTRAP_SECRET is not configured on this deployment' }, 503);
  }
  if (!providedSecret || providedSecret !== envSecret) {
    return c.json({ error: 'Invalid bootstrap secret' }, 403);
  }

  const name: string = body?.adminName ?? 'Default Admin';
  const rawKey = `admin_${crypto.randomBytes(32).toString('base64url')}`;
  const keyHash = await bcrypt.hash(rawKey, 10);
  const id = uuidv4();

  await db.insert(apiKeys).values({
    id,
    keyHash,
    keyPrefix: rawKey.slice(0, 12),
    name,
    role: 'admin',
    revoked: false,
    createdAt: Date.now(),
  });

  await db.insert(auditLog).values({
    id: uuidv4(),
    timestamp: Date.now(),
    actorKeyId: null,
    actorName: 'bootstrap',
    action: 'create',
    resourceType: 'api_key',
    resourceId: id,
    detail: `Bootstrap admin key created: "${name}". Endpoint is now permanently closed.`,
  });

  // Return the raw key exactly once — never stored or logged in plaintext.
  return c.json({
    status: 'bootstrapped',
    adminKeyId: id,
    adminKeyName: name,
    rawAdminKey: rawKey,
    warning: 'Store this key immediately — it will never be shown again.',
  });
});

// Admin-triggered manual health check — lets a newly created provider be probed
// immediately rather than waiting for the next Cron run.
adminApp.post('/providers/:id/health-check', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  const { checkProviderHealth } = await import('./health');
  const result = await checkProviderHealth(db, provider);
  await writeAudit(db, c.get('apiKey'), 'health_check', 'provider', id,
    `Manual health check: ${result.healthStatus} (latency ${result.latency}ms, successRate ${(result.successRate * 100).toFixed(1)}%)`);
  return c.json({ providerId: id, ...result });
});

export default app;
