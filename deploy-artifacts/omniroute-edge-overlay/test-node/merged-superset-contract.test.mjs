import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('merged build keeps browser auth and normalized v2 control APIs together', () => {
  const app = read('src/server/app.ts');
  const schema = read('src/server/db/schema.ts');
  const worker = read('src/worker.ts');
  assert.match(app, /browser-session/);
  assert.match(app, /app\.route\('\/api\/v2\/system', systemV2\)/);
  assert.match(app, /app\.use\('\/api\/v2\/\*', adminAuthMiddleware\)/);
  assert.match(schema, /export const authUsers/);
  assert.match(schema, /export const routingDecisionIndex/);
  assert.match(worker, /AUTH_SESSION_TTL_HOURS/);
});

test('migration order preserves browser auth before routing decision index', () => {
  const authMigration = read('drizzle/0004_browser_auth.sql');
  const routingMigration = read('drizzle/0005_routing_decision_index.sql');
  assert.match(authMigration, /CREATE TABLE IF NOT EXISTS [`"]?auth_users[`"]?/);
  assert.match(routingMigration, /CREATE TABLE IF NOT EXISTS [`"]?routing_decision_index[`"]?/);
});

test('Cloudflare AI Router UI branding uses server-session auth rather than local token-only auth', () => {
  const header = read('src/components/Header.tsx');
  const loading = read('src/components/DreamWorkerLoadingScreen.tsx');
  const app = read('src/App.tsx');
  assert.match(header, /Cloudflare AI Router/);
  assert.match(header, /useAuth/);
  assert.match(loading, /checkSession/);
  assert.match(loading, /loadWorkspace/);
  assert.match(app, /AuthProvider/);
  assert.doesNotMatch(app, /hasStoredAdminToken/);
});
