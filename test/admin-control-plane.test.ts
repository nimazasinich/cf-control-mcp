import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCookie } from '../src/admin/auth';
import { handleAdmin } from '../src/admin/router';
import type { AdminEnv, ModelRow, ProviderRow, RoutingRuleRow } from '../src/admin/types';

type AuditRow = { action: string; target: string | null; detail: string | null };

type State = {
  providers: ProviderRow[];
  models: ModelRow[];
  rules: RoutingRuleRow[];
  audits: AuditRow[];
};

function makeState(): State {
  return {
    providers: [{
      id: 'google-ai-studio',
      display_name: 'Google AI Studio',
      kind: 'google-ai-studio',
      enabled: 1,
      byok_alias: 'default',
      health_state: 'HEALTHY',
      last_success_at: null,
      last_error_at: null,
      last_error_message: null,
      last_latency_ms: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
    }],
    models: [
      { id: 'gemini-3.6-flash', provider_id: 'google-ai-studio', public_alias: null, enabled: 1, created_at: '2026-01-01 00:00:00' },
      { id: 'gemini-3.8-flash', provider_id: 'google-ai-studio', public_alias: null, enabled: 1, created_at: '2026-01-01 00:00:00' },
    ],
    rules: [
      { public_alias: 'fast', model_id: 'gemini-3.6-flash', updated_at: '2026-01-01 00:00:00' },
      { public_alias: 'coding', model_id: 'gemini-3.8-flash', updated_at: '2026-01-01 00:00:00' },
      { public_alias: 'research', model_id: 'gemini-3.8-flash', updated_at: '2026-01-01 00:00:00' },
    ],
    audits: [],
  };
}

function makeDb(state: State): D1Database {
  function statement(query: string, args: unknown[] = []): any {
    const sql = query.replace(/\s+/g, ' ').trim();
    return {
      bind: (...next: unknown[]) => statement(query, next),
      first: async () => {
        if (sql.includes('SELECT * FROM models WHERE id = ?')) {
          return state.models.find((m) => m.id === args[0]) ?? null;
        }
        if (sql.includes('SELECT * FROM providers WHERE id = ?')) {
          return state.providers.find((p) => p.id === args[0]) ?? null;
        }
        return null;
      },
      all: async () => {
        if (sql.includes('SELECT * FROM providers ORDER BY id')) return { results: [...state.providers] };
        if (sql.includes('SELECT * FROM models ORDER BY id')) return { results: [...state.models] };
        if (sql.includes('SELECT * FROM routing_rules ORDER BY public_alias')) return { results: [...state.rules] };
        if (sql.includes('SELECT * FROM health_checks')) return { results: [] };
        if (sql.includes('SELECT * FROM audit_events')) return { results: state.audits.map((a, i) => ({ id: i + 1, at: '2026-01-01 00:00:00', ...a })) };
        return { results: [] };
      },
      run: async () => {
        if (sql.startsWith('UPDATE models SET enabled = ? WHERE id = ?')) {
          const model = state.models.find((m) => m.id === args[1]);
          if (model) model.enabled = Number(args[0]);
          return { success: true, meta: { changes: model ? 1 : 0 } };
        }
        if (sql.startsWith("UPDATE providers SET enabled = ?, updated_at = datetime('now') WHERE id = ?")) {
          const provider = state.providers.find((p) => p.id === args[1]);
          if (provider) provider.enabled = Number(args[0]);
          return { success: true, meta: { changes: provider ? 1 : 0 } };
        }
        if (sql.startsWith('INSERT INTO audit_events')) {
          state.audits.push({ action: String(args[0]), target: args[1] == null ? null : String(args[1]), detail: args[2] == null ? null : String(args[2]) });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
    };
  }
  return { prepare: (query: string) => statement(query) } as unknown as D1Database;
}

async function makeEnv(state: State): Promise<{ env: AdminEnv; cookie: string }> {
  const env = {
    DM_DB: makeDb(state),
    MCP_AUTH_TOKEN: 'owner-secret',
  } as AdminEnv;
  const cookie = (await createSessionCookie(env)).split(';')[0];
  return { env, cookie };
}

function adminRequest(path: string, cookie: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set('Cookie', cookie);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request('https://example.com' + path, { ...init, headers });
}

test('Admin model PATCH requires an actual boolean', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: 'false' }),
  }), env);
  assert.equal(res.status, 400);
  assert.equal(state.models[0].enabled, 1);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'enabled_must_be_boolean');
});

test('Admin model PATCH returns 404 for unknown model', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/not-real', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  }), env);
  assert.equal(res.status, 404);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'model_not_found');
});

test('Admin model disable/re-enable updates D1, routing state, overview and audit', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);

  const disable = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  }), env);
  assert.equal(disable.status, 200);
  const disabledBody = await disable.json() as { ok: boolean; affectedAliases: string[] };
  assert.equal(disabledBody.ok, true);
  assert.deepEqual(disabledBody.affectedAliases, ['fast']);
  assert.equal(state.models.find((m) => m.id === 'gemini-3.6-flash')?.enabled, 0);
  assert.equal(state.audits.at(-1)?.action, 'model.disable');

  const routing = await handleAdmin(adminRequest('/admin/api/routing', cookie), env);
  const routingBody = await routing.json() as { rules: Array<{ public_alias: string; state: string }> };
  assert.equal(routingBody.rules.find((r) => r.public_alias === 'fast')?.state, 'MODEL_DISABLED');

  const models = await handleAdmin(adminRequest('/admin/api/models', cookie), env);
  const modelsBody = await models.json() as { models: Array<{ id: string; available: boolean }> };
  assert.equal(modelsBody.models.find((m) => m.id === 'gemini-3.6-flash')?.available, false);

  const overview = await handleAdmin(adminRequest('/admin/api/overview', cookie), env);
  const overviewBody = await overview.json() as { availableModelCount: number; activeRoutingAliasCount: number; unavailableRoutingAliasCount: number };
  assert.equal(overviewBody.availableModelCount, 1);
  assert.equal(overviewBody.activeRoutingAliasCount, 2);
  assert.equal(overviewBody.unavailableRoutingAliasCount, 1);

  const enable = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: true }),
  }), env);
  assert.equal(enable.status, 200);
  assert.equal(state.models.find((m) => m.id === 'gemini-3.6-flash')?.enabled, 1);
  assert.equal(state.audits.at(-1)?.action, 'model.enable');

  const routingAgain = await handleAdmin(adminRequest('/admin/api/routing', cookie), env);
  const routingAgainBody = await routingAgain.json() as { rules: Array<{ public_alias: string; state: string }> };
  assert.equal(routingAgainBody.rules.find((r) => r.public_alias === 'fast')?.state, 'ACTIVE');
});

test('Admin provider disable/re-enable controls effective model and routing availability', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);

  const disable = await handleAdmin(adminRequest('/admin/api/providers/google-ai-studio', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  }), env);
  assert.equal(disable.status, 200);
  assert.equal(state.providers[0].enabled, 0);
  assert.equal(state.audits.at(-1)?.action, 'provider.disable');

  const routing = await handleAdmin(adminRequest('/admin/api/routing', cookie), env);
  const routingBody = await routing.json() as { rules: Array<{ state: string }> };
  assert.ok(routingBody.rules.every((r) => r.state === 'PROVIDER_DISABLED'));

  const models = await handleAdmin(adminRequest('/admin/api/models', cookie), env);
  const modelsBody = await models.json() as { models: Array<{ available: boolean }> };
  assert.ok(modelsBody.models.every((m) => m.available === false));

  const enable = await handleAdmin(adminRequest('/admin/api/providers/google-ai-studio', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: true }),
  }), env);
  assert.equal(enable.status, 200);
  assert.equal(state.providers[0].enabled, 1);

  const routingAgain = await handleAdmin(adminRequest('/admin/api/routing', cookie), env);
  const routingAgainBody = await routingAgain.json() as { rules: Array<{ state: string }> };
  assert.ok(routingAgainBody.rules.every((r) => r.state === 'ACTIVE'));
});

test('Admin provider PATCH returns 404 for unknown provider', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/providers/not-real', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  }), env);
  assert.equal(res.status, 404);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'provider_not_found');
});
