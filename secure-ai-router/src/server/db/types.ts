import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/**
 * The app's business logic (app.ts, router.ts, policy.ts, health.ts) is written
 * against this driver-agnostic type and never imports a concrete driver directly.
 * That keeps those modules safe to bundle for either runtime:
 *  - Node / local dev  -> db/node.ts constructs a LibSQLDatabase (SQLite file)
 *  - Cloudflare Worker  -> db/d1.ts constructs a DrizzleD1Database (env.DB binding)
 *
 * Both `LibSQLDatabase<TSchema>` and `DrizzleD1Database<TSchema>` extend
 * `BaseSQLiteDatabase<'async', TResult, TSchema>` (they only differ in the driver
 * result-row type) — using that shared base here (with the result type erased to
 * `any`) is what lets query builder calls like `.select()` and `.insert()` etc.
 * type-check correctly without a concrete driver import.
 *
 * The `query` property is explicitly typed below instead of relying on
 * BaseSQLiteDatabase's generic inference, because drizzle-orm 0.45.x has a
 * type-inference gap in `BuildQueryResult` that causes every column to widen to
 * `unknown` when the result kind passes through `BaseSQLiteDatabase<'async', any, …>`.
 * Using each table's `$inferSelect` (which TypeScript resolves correctly from the
 * column builder chain) is the accurate, non-lying alternative to `as any` casts.
 *
 * Only server.ts (Node entrypoint) and worker.ts (Cloudflare entrypoint) are
 * allowed to import the concrete db/node.ts or db/d1.ts modules — everything
 * else receives an already-constructed `AppDb` via Hono's context variables.
 */

// Helper: extract $inferSelect from any drizzle table object.
type SelectOf<T> = T extends { $inferSelect: infer R } ? R : never;

// Subset of the schema that has a $inferSelect (i.e. the table objects only).
type TableKeys = {
  [K in keyof typeof schema]: typeof schema[K] extends { $inferSelect: any } ? K : never;
}[keyof typeof schema];

// Override the `query` property so findMany / findFirst return properly typed rows.
// The (config?: any) parameter intentionally accepts any DBQueryConfig to preserve
// the ability to pass `where`, `with`, `orderBy`, etc. while keeping this type
// file free of heavy drizzle generic imports.
type TypedQueryApi = {
  [K in TableKeys]: {
    findMany(config?: any): Promise<SelectOf<typeof schema[K]>[]>;
    findFirst(config?: any): Promise<SelectOf<typeof schema[K]> | undefined>;
  };
};

export type AppDb = Omit<BaseSQLiteDatabase<'async', any, typeof schema>, 'query'> & {
  query: TypedQueryApi;
};
