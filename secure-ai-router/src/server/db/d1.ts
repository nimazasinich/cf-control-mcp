import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { AppDb } from './types';

// Minimal structural type for the D1 binding — avoids depending on @cloudflare/workers-types
// being installed just for this one shape. Matches env.DB from wrangler.toml's d1_databases binding.
export interface D1Binding {
  prepare: (query: string) => unknown;
  batch: (statements: unknown[]) => Promise<unknown[]>;
  exec: (query: string) => Promise<unknown>;
}

// One drizzle instance per D1 binding — the binding is stable across requests within an
// isolate, so this avoids re-wrapping it on every single request.
const cache = new WeakMap<object, AppDb>();

export function getD1Db(binding: D1Binding): AppDb {
  const key = binding as unknown as object;
  let db = cache.get(key);
  if (!db) {
    db = drizzle(binding as any, { schema }) as unknown as AppDb;
    cache.set(key, db);
  }
  return db;
}
