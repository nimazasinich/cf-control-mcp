import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import * as schema from './schema';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { AppDb } from './types';

let client: Client | null = null;
let nodeDb: AppDb | null = null;

/** Lazily creates (once) and returns the Node/libsql drizzle instance. */
export function getNodeDb(): AppDb {
  if (!nodeDb) {
    const dbPath = process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), 'sqlite.db');
    client = createClient({ url: dbPath === ':memory:' ? ':memory:' : `file:${dbPath}` });
    nodeDb = drizzle(client, { schema }) as unknown as AppDb;
  }
  return nodeDb;
}

function generateApiKey(prefix: string) {
  const raw = crypto.randomBytes(32).toString('base64url');
  return `${prefix}_${raw}`;
}

/** Creates a brand-new, isolated (non-singleton) Node/libsql db + schema — for tests only.
 * Each call gets its own connection and its own set of tables, so tests never share state
 * with each other or with the process-wide getNodeDb() singleton. */
export async function createTestDb(): Promise<{ db: AppDb; client: Client }> {
  const testClient = createClient({ url: ':memory:' });
  const testDb = drizzle(testClient, { schema }) as unknown as AppDb;
  await runMigrations(testClient, { seedAdminKey: false });
  return { db: testDb, client: testClient };
}

/** Creates tables (if missing) and bootstraps the first admin key. Node/local dev only —
 * Cloudflare D1 uses `npm run cf:d1:migrate` (drizzle-kit generated migrations) instead. */
export async function initializeDb() {
  getNodeDb();
  if (!client) throw new Error('Node db client was not initialized');
  console.log('Initializing database schema...');
  await runMigrations(client, { seedAdminKey: true });
}

async function runMigrations(execClient: Client, opts: { seedAdminKey: boolean }) {
  // Foreign keys are OFF by default in SQLite/libsql connections — without this,
  // request_attempts.request_id -> requests.id has no real enforcement, and the
  // CP04 ordering bug (attempts inserted before the parent request row exists)
  // would silently "work" locally while still being unsafe in general.
  // Must run before any INSERT for this connection.
  await execClient.execute('PRAGMA foreign_keys = ON');

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'openai_compatible',
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 1,
      health_status TEXT NOT NULL DEFAULT 'offline',
      latency_ms INTEGER,
      success_rate REAL NOT NULL DEFAULT 1,
      cost_per_token REAL NOT NULL DEFAULT 0,
      last_health_check INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_name TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]',
      context_window INTEGER NOT NULL DEFAULT 8192,
      input_cost REAL NOT NULL DEFAULT 0,
      output_cost REAL NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'gateway',
      revoked INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      action TEXT NOT NULL DEFAULT 'deny',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      client_id TEXT NOT NULL,
      request_type TEXT NOT NULL DEFAULT 'chat',
      requested_model TEXT,
      selected_model TEXT,
      provider_id TEXT,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      tokens_input INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      routing_reason TEXT,
      status TEXT NOT NULL DEFAULT 'success'
    )
  `);
  await execClient.execute(`CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp)`);
  await execClient.execute(`CREATE INDEX IF NOT EXISTS idx_requests_client ON requests(client_id)`);

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS routing_decisions (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      timestamp INTEGER NOT NULL,
      request_type TEXT NOT NULL,
      selected_provider_id TEXT,
      selected_model_id TEXT,
      score REAL,
      reasons TEXT NOT NULL DEFAULT '[]',
      candidates TEXT NOT NULL DEFAULT '[]'
    )
  `);

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      source TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      request_id TEXT
    )
  `);
  await execClient.execute(`CREATE INDEX IF NOT EXISTS idx_security_events_timestamp ON security_events(timestamp)`);

  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      actor_key_id TEXT,
      actor_name TEXT NOT NULL DEFAULT 'unknown',
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      detail TEXT
    )
  `);
  await execClient.execute(`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`);

  // CP04: failover attempt evidence
  await execClient.execute(`
    CREATE TABLE IF NOT EXISTS request_attempts (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      provider_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      result TEXT NOT NULL,
      failure_category TEXT,
      http_status INTEGER,
      error_detail TEXT
    )
  `);

  // Bootstrap a single admin key on first boot only. No providers/models/requests are seeded —
  // an empty, real database is the correct starting state (no mock/demo data).
  if (!opts.seedAdminKey) return;
  const res = await execClient.execute("SELECT count(*) as count FROM api_keys WHERE role = 'admin'");
  if (Number(res.rows[0].count) === 0) {
    const configuredDevKey = process.env.DEV_ADMIN_TOKEN;
    const rawKey = configuredDevKey ?? (process.env.NODE_ENV === 'production' ? generateApiKey('admin') : 'admin_secret');
    const keyHash = await bcrypt.hash(rawKey, 10);
    await execClient.execute({
      sql: 'INSERT INTO api_keys (id, key_hash, key_prefix, name, role, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [uuidv4(), keyHash, rawKey.slice(0, 12), 'Default Admin', 'admin', 0, Date.now()],
    });
    console.log('================================================================');
    console.log(' No admin API key existed — created one.');
    if (configuredDevKey || process.env.NODE_ENV !== 'production') {
      console.log(' Local dashboard compatibility token is active: admin_secret or DEV_ADMIN_TOKEN.');
    } else {
      console.log(' This production key is shown ONCE:');
      console.log(` ${rawKey}`);
      console.log(' Store it now — it is hashed at rest and cannot be recovered.');
    }
    console.log('================================================================');
  }
}
