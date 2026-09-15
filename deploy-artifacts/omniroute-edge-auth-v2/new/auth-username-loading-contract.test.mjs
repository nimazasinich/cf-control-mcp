import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('browser auth supports username-or-email login without weakening session auth', async () => {
  const schema = await read('src/server/db/schema.ts');
  const migration = await read('drizzle/0006_auth_username.sql');
  const auth = await read('src/server/browserAuth.ts');
  const app = await read('src/server/app.ts');
  const client = await read('src/auth/browserSession.ts');

  assert.ok(schema.includes('username: text("username")'), 'auth_users schema must expose username');
  assert.match(migration, /ALTER TABLE [`"]?auth_users[`"]? ADD COLUMN [`"]?username[`"]? text/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS [`"]?idx_auth_users_username[`"]?/i);
  assert.ok(auth.includes('normalizeUsername'), 'username normalization helper must exist');
  assert.ok(auth.includes('findUserByIdentifier'), 'server auth must resolve username or email centrally');
  assert.ok(app.includes("identifier?: unknown"), 'login endpoint must accept identifier');
  assert.ok(app.includes('findUserByIdentifier(db, identifier)'), 'login endpoint must use identifier resolver');
  assert.ok(client.includes('JSON.stringify({ identifier, password })'), 'browser client must send username-or-email identifier');
  assert.ok(client.includes('username: string | null'), 'public browser user shape must expose username');
});

test('bootstrap captures a unique admin username and keeps email login compatible', async () => {
  const app = await read('src/server/app.ts');
  const client = await read('src/auth/browserSession.ts');
  const screen = await read('src/components/DreamWorkerAuthScreen.tsx');

  assert.ok(app.includes('username?: unknown'), 'bootstrap endpoint must accept username');
  assert.ok(app.includes("'USERNAME_TAKEN'"), 'bootstrap must fail clearly on username collision');
  assert.ok(client.includes('username: input.username'), 'bootstrap client must send username');
  assert.ok(screen.includes('Admin username'), 'bootstrap modal must expose admin username field');
  assert.ok(screen.includes('Username or email'), 'sign-in form must label the identifier correctly');
  assert.equal(screen.includes('type="email" value={email}'), false, 'primary sign-in field must not force email-only input');
});

test('login and connecting screens use Cloudflare AI Router branding and visible real loading', async () => {
  const login = await read('src/components/DreamWorkerAuthScreen.tsx');
  const loading = await read('src/components/DreamWorkerLoadingScreen.tsx');

  for (const source of [login, loading]) {
    assert.ok(source.includes('Cloudflare AI Router'), 'auth/loading surface must use current product branding');
    assert.equal(source.includes('/dreamworker-logo.webp'), false, 'legacy DreamWorker logo must be removed from auth/loading surface');
    assert.equal(source.includes('MCP Control Plane'), false, 'legacy MCP Control Plane subtitle must be removed from auth/loading surface');
  }
  assert.ok(loading.includes('MIN_LOADING_MS'), 'loading flow must enforce a visible minimum duration');
  assert.ok(loading.includes('performance.now()'), 'minimum loading duration must be measured, not guessed');
  assert.ok(loading.includes('Session verified'), 'loading phase must communicate real session verification');
  assert.ok(loading.includes('Control APIs ready'), 'loading phase must communicate real workspace readiness');
  assert.ok(loading.includes('Permissions verified'), 'loading phase must communicate real permission verification');
  assert.ok(loading.includes('Retry checks'), 'failed real checks must remain retryable');
});
