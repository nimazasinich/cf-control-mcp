import { policies, requests } from './db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import type { AppDb } from './db/types';

export interface PolicyContext {
  requestedModel?: string;
  providerId?: string;
  providerName?: string;
  clientId: string;
  containsSensitiveData: boolean;
  isExternalProvider: boolean;
}

export interface PolicyVerdict {
  allowed: boolean;
  reason?: string;
  policyName?: string;
}

export async function evaluatePolicies(db: AppDb, ctx: PolicyContext): Promise<PolicyVerdict> {
  const activePolicies = await db.query.policies.findMany({ where: eq(policies.enabled, true) });

  for (const policy of activePolicies) {
    const config = safeParse(policy.config);

    switch (policy.type) {
      case 'model_allowlist': {
        const allowed: string[] = config.models ?? [];
        if (allowed.length && ctx.requestedModel && !allowed.includes(ctx.requestedModel)) {
          return { allowed: false, reason: `Model "${ctx.requestedModel}" is not in the allowlist for policy "${policy.name}"`, policyName: policy.name };
        }
        break;
      }
      case 'model_denylist': {
        const denied: string[] = config.models ?? [];
        if (ctx.requestedModel && denied.includes(ctx.requestedModel)) {
          return { allowed: false, reason: `Model "${ctx.requestedModel}" is denied by policy "${policy.name}"`, policyName: policy.name };
        }
        break;
      }
      case 'provider_denylist': {
        const denied: string[] = config.providers ?? [];
        if (ctx.providerName && denied.includes(ctx.providerName)) {
          return { allowed: false, reason: `Provider "${ctx.providerName}" is denied by policy "${policy.name}"`, policyName: policy.name };
        }
        break;
      }
      case 'token_limit_daily': {
        const limit: number = config.limit ?? Infinity;
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const used = await db
          .select({ total: sql<number>`coalesce(sum(${requests.tokensInput} + ${requests.tokensOutput}), 0)` })
          .from(requests)
          .where(and(eq(requests.clientId, ctx.clientId), gte(requests.timestamp, since)));
        const totalUsed = Number(used[0]?.total ?? 0);
        if (totalUsed >= limit) {
          return { allowed: false, reason: `Daily token limit of ${limit} reached (${totalUsed} used) under policy "${policy.name}"`, policyName: policy.name };
        }
        break;
      }
      case 'block_external_on_sensitive': {
        if (ctx.containsSensitiveData && ctx.isExternalProvider) {
          return { allowed: false, reason: `Sensitive data detected — external providers blocked by policy "${policy.name}"`, policyName: policy.name };
        }
        break;
      }
      default:
        break;
    }
  }

  return { allowed: true };
}

function safeParse(value: unknown): any {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value ?? '{}'));
  } catch {
    return {};
  }
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b(?:\d[ -]*?){13,16}\b/, // credit card-ish
  /\bpassword\s*[:=]/i,
  /\bconfidential\b/i,
];

export function containsSensitiveData(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}
