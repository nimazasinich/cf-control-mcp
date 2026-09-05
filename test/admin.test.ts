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
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acc', CF_AIG_GATEWAY_SLUG: 'gw' } as AdminEnv;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, 'HEALTHY');
  assert.ok(res.latencyMs !== null);
  assert.equal(res.errorMessage, null);
});

test('Admin Health: google-ai-studio auth error', async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acc', CF_AIG_GATEWAY_SLUG: 'gw' } as AdminEnv;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    return new Response('unauthorized', { status: 401 });
  };
  const res = await testGoogleAiStudio(env);
  assert.equal(res.state, 'AUTH_ERROR');
});
