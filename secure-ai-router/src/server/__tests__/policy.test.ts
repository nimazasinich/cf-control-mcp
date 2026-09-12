import { describe, it, expect } from 'vitest';
import { routeRequest, type PolicyContext } from '../router';
import { setupTest, insertProvider, insertModel, insertPolicy } from './testHarness';

const ctx: PolicyContext = { clientId: 'client-1', containsSensitiveData: false };

describe('policy engine — action allow|deny semantics (CP05, Stage D)', () => {
  it('deny policy (action=deny) makes a matching model ineligible', async () => {
    const { db } = await setupTest();
    const p = await insertProvider(db);
    await insertModel(db, p, { modelName: 'gpt-x' });
    await insertPolicy(db, { type: 'model_denylist', action: 'deny', config: { models: ['gpt-x'] } });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected).toBeNull();
    expect(result.policyDenied[0].reason).toMatch(/denied/i);
  });

  it('allow policy (action=allow) restricts eligibility to the allowed set — non-matching model denied', async () => {
    const { db } = await setupTest();
    const p = await insertProvider(db);
    await insertModel(db, p, { modelName: 'gpt-x' });
    // "model_denylist" type, but action=allow -> behaves as an allowlist per CP05 semantics
    await insertPolicy(db, { type: 'model_denylist', action: 'allow', config: { models: ['gpt-y'] } });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected).toBeNull();
    expect(result.policyDenied[0].reason).toMatch(/not in allow set/i);
  });

  it('allow policy lets a matching model through', async () => {
    const { db } = await setupTest();
    const p = await insertProvider(db);
    await insertModel(db, p, { modelName: 'gpt-x' });
    await insertPolicy(db, { type: 'model_allowlist', action: 'allow', config: { models: ['gpt-x'] } });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected?.modelName).toBe('gpt-x');
  });

  it('deny provider policy denies that provider', async () => {
    const { db } = await setupTest();
    const p = await insertProvider(db, { name: 'blocked-provider' });
    await insertModel(db, p, { modelName: 'm1' });
    await insertPolicy(db, { type: 'provider_denylist', action: 'deny', config: { providers: ['blocked-provider'] } });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected).toBeNull();
  });

  it('allow provider policy: only the allowed provider is eligible, others denied', async () => {
    const { db } = await setupTest();
    const good = await insertProvider(db, { name: 'good-provider', priority: 1 });
    await insertModel(db, good, { modelName: 'm1' });
    const bad = await insertProvider(db, { name: 'other-provider', priority: 10 });
    await insertModel(db, bad, { modelName: 'm1' });
    await insertPolicy(db, { type: 'provider_denylist', action: 'allow', config: { providers: ['good-provider'] } });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected?.providerName).toBe('good-provider');
  });

  it('conflicting allow + deny on the same model: hard deny wins (precedence)', async () => {
    const { db } = await setupTest();
    const p = await insertProvider(db);
    await insertModel(db, p, { modelName: 'gpt-x' });
    await insertPolicy(db, { type: 'model_allowlist', action: 'allow', config: { models: ['gpt-x'] } });
    await insertPolicy(db, { type: 'model_denylist', action: 'deny', config: { models: ['gpt-x'] } });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected).toBeNull();
    expect(result.policyDenied[0].reason).toMatch(/denied/i);
  });

  it('token_limit_daily: over-limit client is denied', async () => {
    const { db } = await setupTest();
    const p = await insertProvider(db);
    await insertModel(db, p, { modelName: 'm1' });
    await insertPolicy(db, { type: 'token_limit_daily', config: { limit: 100 } });

    const { requests } = await import('../db/schema');
    await db.insert(requests).values({
      id: 'r1', timestamp: Date.now(), clientId: ctx.clientId, requestType: 'chat',
      tokensInput: 60, tokensOutput: 60, status: 'success',
    });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected).toBeNull();
    expect(result.policyDenied[0].reason).toMatch(/token limit/i);
  });

  it('block_external_on_sensitive: sensitive request blocks external (non-local) providers', async () => {
    const { db } = await setupTest();
    const external = await insertProvider(db, { type: 'openai_compatible' });
    await insertModel(db, external, { modelName: 'm1' });
    await insertPolicy(db, { type: 'block_external_on_sensitive' });

    const sensitiveCtx: PolicyContext = { clientId: 'client-1', containsSensitiveData: true };
    const result = await routeRequest(db, 'chat', undefined, sensitiveCtx);
    expect(result.selected).toBeNull();
    expect(result.policyDenied[0].reason).toMatch(/sensitive/i);
  });

  it('no eligible provider at all -> selected is null with a clear reason', async () => {
    const { db } = await setupTest();
    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected).toBeNull();
    expect(result.reasons[0]).toMatch(/no providers/i);
  });

  it('highest-score provider denied by policy -> second-best selected instead', async () => {
    const { db } = await setupTest();
    const best = await insertProvider(db, { name: 'best', priority: 10, latencyMs: 10, successRate: 1 });
    await insertModel(db, best, { modelName: 'm1' });
    const second = await insertProvider(db, { name: 'second', priority: 1, latencyMs: 900, successRate: 0.9 });
    await insertModel(db, second, { modelName: 'm1' });
    await insertPolicy(db, { type: 'provider_denylist', action: 'deny', config: { providers: ['best'] } });

    const result = await routeRequest(db, 'chat', undefined, ctx);
    expect(result.selected?.providerName).toBe('second');
    expect(result.policyDenied.some((d) => d.reason.includes('best'))).toBe(true);
  });
});
