import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCookie } from '../src/admin/auth';
import { handleAdmin } from '../src/admin/router';
import { MODEL_DISPLAY_NAME_MAX_LENGTH, MODEL_DESCRIPTION_MAX_LENGTH } from '../src/admin/db';
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
      provider_slug: 'google-ai-studio',
      transport: 'gateway-native',
      auth_type: 'byok',
      base_url: null,
      api_path: null,
      priority: 20,
      credential_required: 1,
      custom_provider_id: null,
      test_model: null,
      enabled: 1,
      byok_alias: 'default',
      health_state: 'HEALTHY',
      last_success_at: null,
      last_error_at: null,
      last_error_message: null,
      last_latency_ms: null,
      last_http_status: null,
      last_gateway_log_id: 'gw-log-test',
      last_gateway_step: null,
      last_cf_ray: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
    }],
    models: [
      { id: 'gemini-3.6-flash', provider_id: 'google-ai-studio', public_alias: null, enabled: 1, free_tier: 0, display_name: null, description: null, created_at: '2026-01-01 00:00:00' },
    ],
    rules: [
      { public_alias: 'fast', model_id: 'gemini-3.6-flash', updated_at: '2026-01-01 00:00:00' },
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
        if (sql.includes('SELECT * FROM models WHERE public_alias = ?')) {
          return state.models.find((m) => m.public_alias === args[0]) ?? null;
        }
        if (sql.includes('SELECT * FROM providers WHERE id = ?')) {
          return state.providers.find((p) => p.id === args[0]) ?? null;
        }
        if (sql.includes('SELECT * FROM routing_rules WHERE public_alias = ?')) {
          return state.rules.find((r) => r.public_alias === args[0]) ?? null;
        }
        return null;
      },
      all: async () => {
        if (sql.includes('SELECT * FROM providers ORDER BY id')) return { results: [...state.providers] };
        if (sql.includes('SELECT * FROM models ORDER BY id')) return { results: [...state.models] };
        if (sql.includes('SELECT * FROM routing_rules ORDER BY public_alias')) return { results: [...state.rules] };
        if (sql.includes('SELECT * FROM audit_events')) return { results: state.audits.map((a, i) => ({ id: i + 1, at: '2026-01-01 00:00:00', ...a })) };
        return { results: [] };
      },
      run: async () => {
        if (sql.startsWith('INSERT INTO models')) {
          if (state.models.some((m) => m.id === args[0])) throw new Error('model_already_exists');
          state.models.push({
            id: String(args[0]),
            provider_id: String(args[1]),
            public_alias: args[2] == null ? null : String(args[2]),
            enabled: Number(args[3]),
            free_tier: Number(args[4]),
            display_name: args[5] == null ? null : String(args[5]),
            description: args[6] == null ? null : String(args[6]),
            created_at: '2026-01-01 00:00:00',
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE models SET display_name = ?, description = ? WHERE id = ?')) {
          const model = state.models.find((m) => m.id === args[2]);
          if (model) {
            model.display_name = args[0] == null ? null : String(args[0]);
            model.description = args[1] == null ? null : String(args[1]);
          }
          return { success: true, meta: { changes: model ? 1 : 0 } };
        }
        if (sql.startsWith('UPDATE models SET enabled = ? WHERE id = ?')) {
          const model = state.models.find((m) => m.id === args[1]);
          if (model) model.enabled = Number(args[0]);
          return { success: true, meta: { changes: model ? 1 : 0 } };
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
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CF_AIG_GATEWAY_SLUG: 'gateway',
    CF_AIG_TOKEN: 'gateway-auth',
    CLOUDFLARE_API_TOKEN: 'cf-api',
  } as AdminEnv;
  const cookie = (await createSessionCookie(env)).split(';')[0];
  return { env, cookie };
}

function adminRequest(path: string, cookie: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set('Cookie', cookie);
  if (init?.method && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(init.method.toUpperCase())) headers.set('Origin', 'https://example.com');
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request('https://example.com' + path, { ...init, headers });
}

test('Model create accepts optional displayName/description and persists them', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models', cookie, {
    method: 'POST',
    body: JSON.stringify({ id: 'gemini-3.9-flash', providerId: 'google-ai-studio', displayName: 'Gemini 3.9 Flash', description: 'Fast tier candidate' }),
  }), env);
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; model: ModelRow };
  assert.equal(body.ok, true);
  assert.equal(body.model.display_name, 'Gemini 3.9 Flash');
  assert.equal(body.model.description, 'Fast tier candidate');
  assert.equal(state.models.find((m) => m.id === 'gemini-3.9-flash')?.display_name, 'Gemini 3.9 Flash');
});

test('Model metadata PATCH updates display_name and description in D1 and returns them', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ displayName: 'Gemini 3.6 (Fast)', description: 'Default fast-routing model' }),
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; model: ModelRow };
  assert.equal(body.ok, true);
  assert.equal(body.model.display_name, 'Gemini 3.6 (Fast)');
  assert.equal(body.model.description, 'Default fast-routing model');
  assert.equal(state.models[0].display_name, 'Gemini 3.6 (Fast)');
  assert.equal(state.models[0].description, 'Default fast-routing model');
});

test('Model metadata PATCH can clear a field with explicit null without touching the other', async () => {
  const state = makeState();
  state.models[0].display_name = 'Existing Label';
  state.models[0].description = 'Existing description';
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ description: null }),
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; model: ModelRow };
  assert.equal(body.model.display_name, 'Existing Label');
  assert.equal(body.model.description, null);
});

test('Model metadata PATCH rejects an id in the body silently by ignoring it (model id is immutable)', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ id: 'renamed-model-id', displayName: 'Still the same model' }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal(state.models.length, 1);
  assert.equal(state.models[0].id, 'gemini-3.6-flash');
  assert.equal(state.models[0].display_name, 'Still the same model');
});

test('Model metadata PATCH rejects non-string values', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ displayName: 12345 }),
  }), env);
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'displayName_must_be_string_or_null');
});

test('Model metadata PATCH rejects a display_name over the length limit', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const tooLong = 'x'.repeat(MODEL_DISPLAY_NAME_MAX_LENGTH + 1);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ displayName: tooLong }),
  }), env);
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'displayName_too_long');
  assert.equal(state.models[0].display_name, null);
});

test('Model metadata PATCH rejects a description over the length limit', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const tooLong = 'x'.repeat(MODEL_DESCRIPTION_MAX_LENGTH + 1);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ description: tooLong }),
  }), env);
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'description_too_long');
});

test('Model metadata PATCH returns 404 for unknown model and does not create one', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/not-real/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ displayName: 'Ghost' }),
  }), env);
  assert.equal(res.status, 404);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'model_not_found');
  assert.equal(state.models.length, 1);
});

test('Model metadata PATCH with neither field is rejected', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  const res = await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }), env);
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'displayName_or_description_required');
});

test('Model metadata PATCH writes an audit event', async () => {
  const state = makeState();
  const { env, cookie } = await makeEnv(state);
  await handleAdmin(adminRequest('/admin/api/models/gemini-3.6-flash/metadata', cookie, {
    method: 'PATCH',
    body: JSON.stringify({ displayName: 'Audited Label' }),
  }), env);
  const last = state.audits[state.audits.length - 1];
  assert.equal(last.action, 'model.metadata.set');
  assert.equal(last.target, 'gemini-3.6-flash');
});
