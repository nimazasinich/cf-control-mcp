import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCookie, isAuthenticated, clearSessionCookie } from '../src/admin/auth';
import { testGoogleAiStudio } from '../src/admin/health';
import type { AdminEnv } from '../src/admin/types';

const origFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = origFetch;
});

test('Admin Auth: creates and validates session cookie', async () => {
  const env = { MCP_AUTH_TOKEN: 'secret123' } as AdminEnv;
  const cookieHeader = await createSessionCookie(env);
  assert.ok(cookieHeader.startsWith('admin_session='));
  
  const req = new Request('https://example.com/admin', { headers: { Cookie: cookieHeader.split(';')[0] } });
  assert.equal(await isAuthenticated(req, env), true);
  
  // Wrong secret
  const badEnv = { MCP_AUTH_TOKEN: 'wrong' } as AdminEnv;
  assert.equal(await isAuthenticated(req, badEnv), false);
  
  // Clear cookie
  const cleared = clearSessionCookie();
  assert.ok(cleared.startsWith('admin_session=;'));
});

test('Admin Health: google-ai-studio not configured', async () => {
  const env = {} as AdminEnv;
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, 'NOT_CONFIGURED');
});

test('Admin Health: google-ai-studio healthy', async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acc', CF_AIG_GATEWAY_SLUG: 'gw', CF_AIG_TOKEN: 'mock' } as AdminEnv;
  globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, 'HEALTHY');
  assert.ok(res.latencyMs !== null);
  assert.equal(res.errorMessage, null);
});

test('Admin Health: google-ai-studio auth error', async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acc', CF_AIG_GATEWAY_SLUG: 'gw', CF_AIG_TOKEN: 'mock' } as AdminEnv;
  globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response('unauthorized', { status: 401 });
  };
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, 'AUTH_ERROR');
});

test('Provider Gateway: resolves default aliases and custom D1 routing rules', async () => {
  const { resolveModel } = await import('../src/provider-gateway/cloudflare-ai-gateway');
  const baseEnv = { CLOUDFLARE_ACCOUNT_ID: 'acc' };

  // Default aliases
  assert.equal(await resolveModel('fast', baseEnv), 'gemini-3.6-flash');
  assert.equal(await resolveModel('coding', baseEnv), 'gemini-3.8-flash');
  assert.equal(await resolveModel('research', baseEnv), 'gemini-3.8-flash');
  assert.equal(await resolveModel('gemini-1.5-pro', baseEnv), 'gemini-1.5-pro');

  // Custom alias with mock D1 database
  const mockDb = {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (query.includes('routing_rules') && args[0] === 'custom-alias') {
            return { model_id: 'custom-gemini-model' };
          }
          return null;
        },
      }),
    }),
  } as unknown as D1Database;

  assert.equal(await resolveModel('custom-alias', { ...baseEnv, DM_DB: mockDb }), 'custom-gemini-model');
});

test('Provider Gateway: handleModels returns static fallback without D1', async () => {
  const { handleModels } = await import('../src/provider-gateway/models');
  const res = await handleModels({ CLOUDFLARE_ACCOUNT_ID: 'acc' });
  assert.equal(res.status, 200);
  const data = await res.json() as { object: string; data: Array<{ id: string }> };
  assert.equal(data.object, 'list');
  const ids = data.data.map(m => m.id);
  assert.ok(ids.includes('fast'));
  assert.ok(ids.includes('coding'));
  assert.ok(ids.includes('research'));
  assert.ok(ids.includes('gemini-3.5-flash'));
});

test('Provider Gateway: /v1/models reflects only enabled D1 models and aliases', async () => {
  const { handleModels } = await import('../src/provider-gateway/models');
  const mockDb = {
    prepare: (query: string) => ({
      all: async () => {
        if (query.includes('SELECT m.id')) {
          return {
            results: [
              { id: 'gemini-3.8-flash', provider_id: 'google-ai-studio', created_at: '2026-01-01 00:00:00' },
            ],
          };
        }
        if (query.includes('SELECT r.public_alias')) {
          return {
            results: [
              { public_alias: 'coding', created_at: '2026-01-01 00:00:00' },
              { public_alias: 'research', created_at: '2026-01-01 00:00:00' },
            ],
          };
        }
        return { results: [] };
      },
    }),
  } as unknown as D1Database;

  const res = await handleModels({ CLOUDFLARE_ACCOUNT_ID: 'acc', DM_DB: mockDb });
  assert.equal(res.status, 200);
  const data = await res.json() as { data: Array<{ id: string }> };
  const ids = data.data.map(m => m.id);
  assert.deepEqual(ids, ['coding', 'research', 'gemini-3.8-flash']);
  assert.equal(ids.includes('fast'), false);
  assert.equal(ids.includes('gemini-3.6-flash'), false);
});

test('Provider Gateway: disabled D1 model is rejected before upstream fetch', async () => {
  const { handleChatCompletions } = await import('../src/provider-gateway/cloudflare-ai-gateway');
  const mockDb = {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (query.includes('routing_rules')) {
            return args[0] === 'fast' ? { model_id: 'gemini-3.6-flash' } : null;
          }
          if (query.includes('model_enabled')) {
            return { id: 'gemini-3.6-flash', model_enabled: 0, provider_enabled: 1 };
          }
          return null;
        },
      }),
    }),
  } as unknown as D1Database;

  globalThis.fetch = async () => {
    throw new Error('upstream fetch must not be reached for a disabled model');
  };

  const req = new Request('https://example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'fast', messages: [{ role: 'user', content: 'hi' }] }),
  });
  const res = await handleChatCompletions(req, {
    CLOUDFLARE_ACCOUNT_ID: 'acc',
    CF_AIG_GATEWAY_SLUG: 'gw',
    CF_AIG_TOKEN: 'aig-token',
    DM_DB: mockDb,
  });

  assert.equal(res.status, 404);
  const data = await res.json() as { error: { code: string; message: string } };
  assert.equal(data.error.code, 'model_not_found');
  assert.match(data.error.message, /disabled/);
});

test('Provider Gateway: D1 registry failure is fail-closed for /v1/models', async () => {
  const { handleModels } = await import('../src/provider-gateway/models');
  const mockDb = {
    prepare: () => ({
      all: async () => {
        throw new Error('D1 unavailable');
      },
    }),
  } as unknown as D1Database;

  const res = await handleModels({ CLOUDFLARE_ACCOUNT_ID: 'acc', DM_DB: mockDb });
  assert.equal(res.status, 503);
  const data = await res.json() as { error: { code: string } };
  assert.equal(data.error.code, 'model_registry_error');
});

test('Admin API: unauthenticated request handling', async () => {
  const { handleAdmin } = await import('../src/admin/router');
  const env = { MCP_AUTH_TOKEN: 'secret123' } as AdminEnv;

  // Unauthenticated API request returns 401 JSON
  const apiReq = new Request('https://example.com/admin/api/models');
  const apiRes = await handleAdmin(apiReq, env);
  assert.equal(apiRes.status, 401);
  const apiBody = await apiRes.json() as { error: string };
  assert.equal(apiBody.error, 'unauthorized');

  // Unauthenticated UI request renders login page
  const uiReq = new Request('https://example.com/admin');
  const uiRes = await handleAdmin(uiReq, env);
  assert.equal(uiRes.status, 200);
  const html = await uiRes.text();
  assert.ok(html.includes('cf-control-mcp — Admin'));
  assert.ok(html.includes('Sign in'));
});
