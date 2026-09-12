import { describe, it, expect, afterEach } from 'vitest';
import { requests, requestAttempts } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { setupTest, insertProvider, insertModel, stubUpstream, jsonResponse } from './testHarness';

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe('failover — request/attempt persistence (CP04, Stage A)', () => {
  it('creates the request row before any attempt is inserted — no FK violation', async () => {
    const { db, call } = await setupTest();
    const providerId = await insertProvider(db, { baseUrl: 'https://a.test/v1' });
    await insertModel(db, providerId, { modelName: 'm1' });

    const upstream = stubUpstream({
      'https://a.test/v1': [async () => jsonResponse(200, { id: 'x', usage: { prompt_tokens: 1, completion_tokens: 1 } })],
    });
    restoreFetch = upstream.restore;

    const res = await call('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);

    const reqRows = await db.select().from(requests);
    expect(reqRows).toHaveLength(1);
    expect(reqRows[0].status).toBe('success');

    const attemptRows = await db.select().from(requestAttempts).where(eq(requestAttempts.requestId, reqRows[0].id));
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0].result).toBe('success');
  });

  it('rejects an orphan request_attempts row under real FK enforcement (proves the pragma is active)', async () => {
    const { db } = await setupTest();
    await expect(
      db.insert(requestAttempts).values({
        id: 'orphan', requestId: 'does-not-exist', attemptNumber: 1,
        providerId: 'p', modelName: 'm', startedAt: Date.now(), result: 'success',
      })
    ).rejects.toThrow();
  });

  it('A 500 -> B success: fails over and records both attempts against the same request', async () => {
    const { db, call } = await setupTest();
    const a = await insertProvider(db, { baseUrl: 'https://a.test/v1', priority: 10 });
    await insertModel(db, a, { modelName: 'm1' });
    const b = await insertProvider(db, { baseUrl: 'https://b.test/v1', priority: 1 });
    await insertModel(db, b, { modelName: 'm1' });

    const upstream = stubUpstream({
      'https://a.test/v1': [async () => jsonResponse(500, { error: 'boom' })],
      'https://b.test/v1': [async () => jsonResponse(200, { id: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1 } })],
    });
    restoreFetch = upstream.restore;

    const res = await call('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);

    const reqRow = (await db.select().from(requests))[0];
    expect(reqRow.status).toBe('success');
    expect(reqRow.providerId).toBe(b);

    const attempts = await db.select().from(requestAttempts).where(eq(requestAttempts.requestId, reqRow.id)).orderBy(asc(requestAttempts.attemptNumber));
    expect(attempts.map((r) => r.result)).toEqual(['retryable_error', 'success']);
    expect(attempts[0].failureCategory).toBe('upstream_5xx');
    expect(attempts.every((r) => r.requestId === reqRow.id)).toBe(true);
  });

  it('A 429 -> B success', async () => {
    const { db, call } = await setupTest();
    const a = await insertProvider(db, { baseUrl: 'https://a.test/v1', priority: 10 });
    await insertModel(db, a, { modelName: 'm1' });
    const b = await insertProvider(db, { baseUrl: 'https://b.test/v1', priority: 1 });
    await insertModel(db, b, { modelName: 'm1' });

    const upstream = stubUpstream({
      'https://a.test/v1': [async () => jsonResponse(429, { error: 'rate limited' })],
      'https://b.test/v1': [async () => jsonResponse(200, { id: 'ok' })],
    });
    restoreFetch = upstream.restore;

    const res = await call('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(200);
    const attempts = await db.select().from(requestAttempts);
    expect(attempts[0].failureCategory).toBe('rate_limited');
    expect(attempts[0].result).toBe('retryable_error');
  });

  it('A timeout (network error) -> B success', async () => {
    const { db, call } = await setupTest();
    const a = await insertProvider(db, { baseUrl: 'https://a.test/v1', priority: 10 });
    await insertModel(db, a, { modelName: 'm1' });
    const b = await insertProvider(db, { baseUrl: 'https://b.test/v1', priority: 1 });
    await insertModel(db, b, { modelName: 'm1' });

    const upstream = stubUpstream({
      'https://a.test/v1': [async () => { throw new Error('fetch failed: connection timeout exceeded'); }],
      'https://b.test/v1': [async () => jsonResponse(200, { id: 'ok' })],
    });
    restoreFetch = upstream.restore;

    const res = await call('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(200);
    const attempts = await db.select().from(requestAttempts);
    expect(attempts[0].failureCategory).toBe('timeout');
  });

  it('non-retryable 4xx stops immediately without trying the next candidate', async () => {
    const { db, call } = await setupTest();
    const a = await insertProvider(db, { baseUrl: 'https://a.test/v1', priority: 10 });
    await insertModel(db, a, { modelName: 'm1' });
    const b = await insertProvider(db, { baseUrl: 'https://b.test/v1', priority: 1 });
    await insertModel(db, b, { modelName: 'm1' });

    const upstream = stubUpstream({
      'https://a.test/v1': [async () => jsonResponse(401, { error: 'bad key' })],
      'https://b.test/v1': [async () => jsonResponse(200, { id: 'should-not-be-called' })],
    });
    restoreFetch = upstream.restore;

    const res = await call('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(401);
    const attempts = await db.select().from(requestAttempts);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].result).toBe('non_retryable_error');
    expect(upstream.calls).toHaveLength(1); // provider B was never called
  });

  it('all providers fail -> 503 and every attempt persisted against the request', async () => {
    const { db, call } = await setupTest();
    const a = await insertProvider(db, { baseUrl: 'https://a.test/v1', priority: 10 });
    await insertModel(db, a, { modelName: 'm1' });
    const b = await insertProvider(db, { baseUrl: 'https://b.test/v1', priority: 1 });
    await insertModel(db, b, { modelName: 'm1' });

    const upstream = stubUpstream({
      'https://a.test/v1': [async () => jsonResponse(500, {})],
      'https://b.test/v1': [async () => jsonResponse(503, {})],
    });
    restoreFetch = upstream.restore;

    const res = await call('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(503);
    const reqRow = (await db.select().from(requests))[0];
    expect(reqRow.status).toBe('error');
    const attempts = await db.select().from(requestAttempts).where(eq(requestAttempts.requestId, reqRow.id));
    expect(attempts).toHaveLength(2);
  });

  it('respects the max attempt limit (3) even with more eligible candidates', async () => {
    const { db, call } = await setupTest();
    const urls = ['https://a.test/v1', 'https://b.test/v1', 'https://c.test/v1', 'https://d.test/v1'];
    for (const [i, url] of urls.entries()) {
      const p = await insertProvider(db, { baseUrl: url, priority: 10 - i });
      await insertModel(db, p, { modelName: 'm1' });
    }

    const script: Record<string, Array<() => Response | Promise<Response>>> = {};
    for (const url of urls) script[url] = [async () => jsonResponse(500, {})];
    const upstream = stubUpstream(script);
    restoreFetch = upstream.restore;

    const res = await call('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(503);
    const attempts = await db.select().from(requestAttempts);
    expect(attempts).toHaveLength(3); // MAX_FAILOVER_ATTEMPTS, not 4
    expect(upstream.calls).toHaveLength(3);
  });
});
