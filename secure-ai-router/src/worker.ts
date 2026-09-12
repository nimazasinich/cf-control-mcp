import app, { type AppBindings } from './server/app';
import { getD1Db, type D1Binding } from './server/db/d1';
import { checkProviderHealth } from './server/health';
import { providers } from './server/db/schema';
import { eq } from 'drizzle-orm';

// This is the Cloudflare Worker entry point.
//
// Two exports are provided:
//   fetch     — handles all HTTP requests (the main gateway + dashboard API)
//   scheduled — handles Cron Trigger events (see wrangler.toml [[triggers]])
//               for provider health-check polling.  Workers cannot use
//               setInterval for long-lived background work; the Cron Trigger
//               is the correct Cloudflare-native mechanism.
//
// NOTE on background health checks:
//   Node/local dev uses server.ts's `startHealthCheck` (setInterval).
//   Cloudflare Workers use the `scheduled` export below, triggered by the
//   "*/5 * * * *" cron in wrangler.toml.
//   Reactive health updates still happen on every live gateway call via
//   `recordProviderOutcome` regardless of environment.

interface WorkerEnv {
  DB: D1Binding;
  ENVIRONMENT?: string;
  STORAGE_ENCRYPTION_KEY?: string;
  BOOTSTRAP_SECRET?: string;
}

// Minimal structural stand-in for Cloudflare's `ExecutionContext`.
interface MinimalExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: MinimalExecutionContext): Promise<Response> {
    bridgeEnvSecrets(env);
    const bindings: AppBindings = { db: getD1Db(env.DB) };
    return app.fetch(request, bindings, ctx as any);
  },

  async scheduled(_event: { scheduledTime: number; cron: string }, env: WorkerEnv, ctx: MinimalExecutionContext): Promise<void> {
    // Run provider health checks on every Cron Trigger invocation.
    // waitUntil keeps the isolate alive until all checks complete.
    ctx.waitUntil((async () => {
      bridgeEnvSecrets(env);
      const db = getD1Db(env.DB);
      try {
        const allProviders = await db.query.providers.findMany({
          where: eq(providers.enabled, true),
        });
        await Promise.allSettled(allProviders.map((p) => checkProviderHealth(db, p)));
      } catch (err) {
        // Swallow errors so a transient failure doesn't crash the cron run.
        console.error('[Cron] Health check failed:', err);
      }
    })());
  },
};

/** Cloudflare Worker secrets arrive via `env`, but modules like crypto.ts read
 * `process.env` directly (nodejs_compat provides `process` in Workers).
 * Bridge the secrets we need on every invocation. */
function bridgeEnvSecrets(env: WorkerEnv) {
  if (env.STORAGE_ENCRYPTION_KEY && !process.env.STORAGE_ENCRYPTION_KEY) {
    process.env.STORAGE_ENCRYPTION_KEY = env.STORAGE_ENCRYPTION_KEY;
  }
  if (env.BOOTSTRAP_SECRET && !process.env.BOOTSTRAP_SECRET) {
    process.env.BOOTSTRAP_SECRET = env.BOOTSTRAP_SECRET;
  }
}
