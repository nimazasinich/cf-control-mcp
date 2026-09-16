import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCookie } from '../src/admin/auth';
import { handleAdmin } from '../src/admin/router';
import type { AdminEnv, ProviderRow } from '../src/admin/types';

function providerFixture(): ProviderRow {
  return {
    id: 'google-ai-studio',
    display_name: 'Google AI Studio',
    kind: 'google-ai-studio',
    provider_slug: 'google-ai-studio',
    transport: 'gateway-native',
    auth_type: 'byok',
    base_url: null,
    api_path: null,
    priority: 10,
    credential_required: 1,
    custom_provider_id: null,
    test_model: 'gemini-3.6-flash',
    enabled: 1,
    byok_alias: 'default',
    health_state: 'CONFIGURED',
    last_success_at: null,
    last_error_at: null,
    last_error_message: null,
    last_latency_ms: null,
    last_http_status: null,
    last_gateway_log_id: null,
    last_gateway_step: null,
    last_cf_ray: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };
}

function makeDb(provider: ProviderRow): D1Database {
  function statement(query: string, args: unknown[] = []): any {
    const sql = query.replace(/\s+/g, ' ').trim();
    return {
      bind: (...next: unknown[]) => statement(query, next),
      first: async () => {
        if (sql.includes('SELECT * FROM providers WHERE id = ?')) {
          return args[0] === provider.id ? { ...provider } : null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (sql.startsWith('UPDATE providers SET health_state = ?')) {
          provider.health_state = String(args[0]) as ProviderRow['health_state'];
          provider.last_latency_ms = args[1] == null ? null : Number(args[1]);
          provider.last_http_status = args[2] == null ? null : Number(args[2]);
          provider.last_gateway_log_id = args[3] == null ? null : String(args[3]);
          provider.last_gateway_step = args[4] == null ? null : String(args[4]);
          provider.last_cf_ray = args[5] == null ? null : String(args[5]);
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
  }
  return { prepare: (query: string) => statement(query) } as unknown as D1Database;
}

test('Admin provider health-test persists Cloudflare gateway evidence required for callability', async () => {
  const provider = providerFixture();
  const env = {
    DM_DB: makeDb(provider),
    MCP_AUTH_TOKEN: 'owner-secret',
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CF_AIG_GATEWAY_SLUG: 'gateway',
    CF_AIG_TOKEN: 'gateway-auth',
    CLOUDFLARE_API_TOKEN: 'cf-api',
  } as AdminEnv;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'google-ai-studio/gemini-3.6-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-log-id': 'gateway-log-verified',
        'cf-aig-step': 'provider',
        'cf-ray': 'ray-test',
      },
    },
  );

  try {
    const cookie = (await createSessionCookie(env)).split(';', 1)[0];
    const response = await handleAdmin(new Request(
      'https://example.com/admin/api/providers/google-ai-studio/health-test',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://example.com',
        },
      },
    ), env);

    assert.equal(response.status, 200);
    const body = await response.json() as {
      state: string;
      gatewayVerified?: boolean;
      gatewayLogId?: string | null;
      httpStatus?: number | null;
    };
    assert.equal(body.state, 'HEALTHY');
    assert.equal(body.gatewayVerified, true);
    assert.equal(body.gatewayLogId, 'gateway-log-verified');
    assert.equal(body.httpStatus, 200);

    assert.equal(provider.health_state, 'HEALTHY');
    assert.equal(provider.last_http_status, 200);
    assert.equal(provider.last_gateway_log_id, 'gateway-log-verified');
    assert.equal(provider.last_gateway_step, 'provider');
    assert.equal(provider.last_cf_ray, 'ray-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('Admin provider health-test supports Workers AI binding and persists real gateway evidence', async () => {
  const provider: ProviderRow = {
    ...providerFixture(),
    id: 'workers-ai',
    display_name: 'Workers AI',
    kind: 'workers-ai',
    provider_slug: 'workers-ai',
    transport: 'workers-ai-binding',
    auth_type: 'cloudflare-binding',
    credential_required: 0,
    test_model: '@cf/zai-org/glm-4.7-flash',
    byok_alias: null,
    health_state: 'NOT_CONFIGURED',
  };
  const ai = {
    aiGatewayLogId: 'workers-gateway-log',
    run: async () => ({ response: 'OK' }),
  };
  const env = {
    DM_DB: makeDb(provider),
    MCP_AUTH_TOKEN: 'owner-secret',
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CF_AIG_GATEWAY_SLUG: 'gateway',
    AI: ai,
  } as unknown as AdminEnv;
  const cookie = (await createSessionCookie(env)).split(';', 1)[0];
  const response = await handleAdmin(new Request(
    'https://example.com/admin/api/providers/workers-ai/health-test',
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://example.com',
      },
    },
  ), env);

  assert.equal(response.status, 200);
  const body = await response.json() as {
    state: string;
    gatewayVerified?: boolean;
    gatewayLogId?: string | null;
    httpStatus?: number | null;
  };
  assert.equal(body.state, 'HEALTHY');
  assert.equal(body.gatewayVerified, true);
  assert.equal(body.gatewayLogId, 'workers-gateway-log');
  assert.equal(body.httpStatus, 200);
  assert.equal(provider.health_state, 'HEALTHY');
  assert.equal(provider.last_http_status, 200);
  assert.equal(provider.last_gateway_log_id, 'workers-gateway-log');
});
