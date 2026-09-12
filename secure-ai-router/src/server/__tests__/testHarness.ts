import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { createTestDb } from '../db/node';
import { providers, models, policies, apiKeys } from '../db/schema';
import app, { type AppBindings } from '../app';
import type { AppDb } from '../db/types';

/** Builds a fresh, isolated in-memory DB (foreign keys ON) plus a gateway API key,
 * ready to drive the real Hono app via app.fetch(). Every test gets its own DB —
 * nothing is shared across test files or test cases. */
export async function setupTest() {
  const { db, client } = await createTestDb();
  const rawKey = await seedApiKey(db, 'gateway');
  const bindings: AppBindings = { db };

  async function call(path: string, init: RequestInit = {}, opts: { auth?: boolean } = { auth: true }) {
    const headers = new Headers(init.headers);
    if (opts.auth !== false) headers.set('Authorization', `Bearer ${rawKey}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.fetch(new Request(`http://test.local${path}`, { ...init, headers }), bindings);
  }

  return { db, client, rawKey, call };
}

export async function seedApiKey(db: AppDb, role: 'admin' | 'gateway'): Promise<string> {
  const raw = `${role}_${uuidv4().replace(/-/g, '')}`;
  const keyHash = await bcrypt.hash(raw, 4); // low bcrypt cost — tests only
  await db.insert(apiKeys).values({
    id: uuidv4(), keyHash, keyPrefix: raw.slice(0, 12), name: `test-${role}`,
    role, revoked: false, createdAt: Date.now(),
  });
  return raw;
}

export async function insertProvider(db: AppDb, overrides: Partial<typeof providers.$inferInsert> = {}) {
  const id = overrides.id ?? uuidv4();
  await db.insert(providers).values({
    id,
    name: overrides.name ?? `provider-${id.slice(0, 6)}`,
    type: overrides.type ?? 'local',
    baseUrl: overrides.baseUrl ?? 'https://fake-upstream.test/v1',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 5,
    healthStatus: overrides.healthStatus ?? 'healthy',
    latencyMs: overrides.latencyMs ?? 100,
    successRate: overrides.successRate ?? 1,
    costPerToken: overrides.costPerToken ?? 0,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    createdAt: Date.now(),
    ...overrides,
  });
  return id;
}

export async function insertModel(db: AppDb, providerId: string, overrides: Partial<typeof models.$inferInsert> = {}) {
  const id = overrides.id ?? uuidv4();
  await db.insert(models).values({
    id,
    providerId,
    modelName: overrides.modelName ?? 'test-model',
    capabilities: overrides.capabilities ?? [],
    contextWindow: overrides.contextWindow ?? 8192,
    inputCost: overrides.inputCost ?? 0,
    outputCost: overrides.outputCost ?? 0,
    enabled: overrides.enabled ?? true,
    createdAt: Date.now(),
    ...overrides,
  });
  return id;
}

export async function insertPolicy(db: AppDb, overrides: Partial<typeof policies.$inferInsert> & { type: string }) {
  const id = overrides.id ?? uuidv4();
  await db.insert(policies).values({
    id,
    name: overrides.name ?? `policy-${id.slice(0, 6)}`,
    type: overrides.type,
    config: overrides.config ?? {},
    action: overrides.action ?? 'deny',
    enabled: overrides.enabled ?? true,
    createdAt: Date.now(),
    ...overrides,
  });
  return id;
}

/** A minimal deterministic fake upstream — no real network calls, ever.
 * `script` maps provider baseUrl -> queue of responses to return, one per call. */
export function stubUpstream(script: Record<string, Array<() => Response | Promise<Response>>>) {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    const base = Object.keys(script).find((b) => url.startsWith(b));
    if (!base) throw new Error(`stubUpstream: no script entry for ${url}`);
    const queue = script[base];
    const next = queue.shift();
    if (!next) throw new Error(`stubUpstream: script exhausted for ${base}`);
    return next();
  }) as any;
  return {
    calls,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

export function jsonResponse(status: number, body: any): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
