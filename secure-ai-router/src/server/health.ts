import { providers } from './db/schema';
import { eq } from 'drizzle-orm';
import { decryptSecret } from './crypto';
import type { AppDb } from './db/types';

const ROLLING_ALPHA = 0.3; // weight given to the newest sample when updating successRate

export async function checkProviderHealth(db: AppDb, provider: typeof providers.$inferSelect) {
  const start = Date.now();
  let ok = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const headers: Record<string, string> = {};
    if (provider.apiKeyEncrypted) {
      try {
        headers['Authorization'] = `Bearer ${decryptSecret(provider.apiKeyEncrypted)}`;
      } catch {
        // Key can't be decrypted (missing STORAGE_ENCRYPTION_KEY) — probe without auth.
      }
    }

    const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/models`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    ok = res.ok;
  } catch {
    ok = false;
  }

  const latency = Date.now() - start;
  const prevSuccessRate = provider.successRate ?? 1;
  const sample = ok ? 1 : 0;
  const nextSuccessRate = prevSuccessRate * (1 - ROLLING_ALPHA) + sample * ROLLING_ALPHA;
  const consecutiveFailures = ok ? 0 : (provider.consecutiveFailures ?? 0) + 1;

  let healthStatus: 'healthy' | 'degraded' | 'offline';
  if (consecutiveFailures >= 3) healthStatus = 'offline';
  else if (!ok || nextSuccessRate < 0.9) healthStatus = 'degraded';
  else healthStatus = 'healthy';

  await db
    .update(providers)
    .set({
      latencyMs: ok ? latency : provider.latencyMs,
      successRate: Math.max(0, Math.min(1, nextSuccessRate)),
      healthStatus,
      lastHealthCheck: Date.now(),
      consecutiveFailures,
    })
    .where(eq(providers.id, provider.id));

  return { healthStatus, latency, successRate: nextSuccessRate };
}

/** Reactive update called right after a live gateway proxy call, so a single failure
 * is reflected immediately instead of waiting for the next periodic probe. */
export async function recordProviderOutcome(db: AppDb, providerId: string, success: boolean, latencyMs: number) {
  const provider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
  if (!provider) return;

  const prevSuccessRate = provider.successRate ?? 1;
  const sample = success ? 1 : 0;
  const nextSuccessRate = prevSuccessRate * (1 - ROLLING_ALPHA) + sample * ROLLING_ALPHA;
  const consecutiveFailures = success ? 0 : (provider.consecutiveFailures ?? 0) + 1;

  let healthStatus: 'healthy' | 'degraded' | 'offline';
  if (consecutiveFailures >= 3) healthStatus = 'offline';
  else if (!success || nextSuccessRate < 0.9) healthStatus = 'degraded';
  else healthStatus = 'healthy';

  await db
    .update(providers)
    .set({
      latencyMs: success ? latencyMs : provider.latencyMs,
      successRate: Math.max(0, Math.min(1, nextSuccessRate)),
      healthStatus,
      lastHealthCheck: Date.now(),
      consecutiveFailures,
    })
    .where(eq(providers.id, providerId));
}

/** Background periodic prober. Node/local-dev only (see worker.ts for why this isn't
 * started on Cloudflare) — pass the Node db instance explicitly. */
export function startHealthCheck(db: AppDb, intervalMs = 30000) {
  console.log(`[HealthCheck] Starting background provider health checks every ${intervalMs}ms`);

  const run = async () => {
    try {
      const activeProviders = await db.query.providers.findMany({ where: eq(providers.enabled, true) });
      await Promise.all(activeProviders.map((p) => checkProviderHealth(db, p).catch(() => null)));
    } catch (err) {
      console.error('[HealthCheck] Error running health check loop', err);
    }
  };

  run(); // run immediately on boot instead of waiting a full interval
  setInterval(run, intervalMs);
}
