import { providers, models, policies, requests } from './db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import type { AppDb } from './db/types';

export interface RoutingCandidate {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  healthScore: number;
  latencyScore: number;
  costScore: number;
  capabilityScore: number;
  priorityScore: number;
  finalScore: number;
  policyIneligible?: boolean;
  policyDenyReason?: string;
  policyEvaluations?: PolicyEvaluationRecord[];
}

/** One row of the policy audit trail for a single candidate.
 * Covers exactly what CP05 requires the audit to record: policy id, policy
 * name, action, what it matched against, the decision, and why. */
export interface PolicyEvaluationRecord {
  policyId: string;
  policyName: string;
  policyType: string;
  action: 'allow' | 'deny';
  matched: boolean;
  decision: 'eligible' | 'denied';
  reason: string;
}

export interface RoutingResult {
  selected: RoutingCandidate | null;
  reasons: string[];
  candidates: RoutingCandidate[];
  policyDenied: { providerId: string; reason: string }[];
}

export interface PolicyContext {
  requestedModel?: string;
  clientId: string;
  containsSensitiveData: boolean;
}

const WEIGHTS = {
  health: 0.40,
  latency: 0.25,
  cost: 0.20,
  capability: 0.10,
  priority: 0.05,
};

const REQUEST_TYPE_CAPABILITY: Record<string, string> = {
  coding: 'coding',
  vision: 'vision',
  reasoning: 'reasoning',
  embeddings: 'embeddings',
  chat: 'chat',
};

/** Domain a "list" policy type applies to. Legacy type names (model_allowlist,
 * model_denylist, provider_denylist) only decide the domain (model vs provider) —
 * the row's `action` column ('allow' | 'deny') is the actual source of truth for
 * behavior. This is what makes `policies.action` a real, load-bearing field
 * instead of unused configuration: an admin can create a `model_denylist`-typed
 * policy with `action: 'allow'` and it behaves as a model allowlist, and vice versa. */
function policyDomain(type: string): 'model' | 'provider' | null {
  if (type.startsWith('model_')) return 'model';
  if (type.startsWith('provider_')) return 'provider';
  return null;
}

/** Evaluate every enabled policy against a single candidate (provider + model),
 * producing a full audit trail plus a final eligibility verdict.
 *
 * Precedence (deterministic, applied after every policy has been evaluated so the
 * audit trail is always complete):
 *   1. hard deny     — any `action: 'deny'` policy (or token_limit_daily /
 *                       block_external_on_sensitive) that matches -> ineligible.
 *   2. allow constraint — any `action: 'allow'` policy with a non-empty match list
 *                       requires the candidate to be IN that list -> ineligible if not.
 *   3. normal routing — nothing matched -> eligible.
 */
async function evaluateCandidatePolicies(
  db: AppDb,
  ctx: PolicyContext,
  candidate: { providerId: string; providerName: string; modelName: string; isExternal: boolean },
  activePolicies: (typeof policies.$inferSelect)[]
): Promise<{ denied: boolean; reason: string | null; records: PolicyEvaluationRecord[] }> {
  const records: PolicyEvaluationRecord[] = [];
  let hardDenyReason: string | null = null;
  let allowFailureReason: string | null = null;

  for (const policy of activePolicies) {
    const config = safeParse(policy.config);
    const action: 'allow' | 'deny' = policy.action === 'allow' ? 'allow' : 'deny';
    const domain = policyDomain(policy.type);

    if (domain) {
      const list: string[] = (domain === 'model' ? config.models : config.providers) ?? [];
      const matchValue = domain === 'model' ? candidate.modelName : candidate.providerName;
      const inList = list.includes(matchValue);

      if (list.length === 0) {
        // No matches configured — this policy has nothing to enforce yet.
        continue;
      }

      if (action === 'deny') {
        const matched = inList;
        const reason = matched
          ? `${domain === 'model' ? 'Model' : 'Provider'} "${matchValue}" denied (policy: ${policy.name})`
          : `${domain === 'model' ? 'Model' : 'Provider'} "${matchValue}" not matched by deny policy "${policy.name}"`;
        records.push({
          policyId: policy.id, policyName: policy.name, policyType: policy.type, action,
          matched, decision: matched ? 'denied' : 'eligible', reason,
        });
        if (matched && !hardDenyReason) hardDenyReason = reason;
      } else {
        // action === 'allow': candidate must be IN the list to satisfy this constraint.
        const satisfied = inList;
        const reason = satisfied
          ? `${domain === 'model' ? 'Model' : 'Provider'} "${matchValue}" allowed (policy: ${policy.name})`
          : `${domain === 'model' ? 'Model' : 'Provider'} "${matchValue}" not in allow set (policy: ${policy.name})`;
        records.push({
          policyId: policy.id, policyName: policy.name, policyType: policy.type, action,
          matched: satisfied, decision: satisfied ? 'eligible' : 'denied', reason,
        });
        if (!satisfied && !allowFailureReason) allowFailureReason = reason;
      }
      continue;
    }

    switch (policy.type) {
      case 'token_limit_daily': {
        const limit: number = config.limit ?? Infinity;
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const used = await db
          .select({ total: sql<number>`coalesce(sum(${requests.tokensInput} + ${requests.tokensOutput}), 0)` })
          .from(requests)
          .where(and(eq(requests.clientId, ctx.clientId), gte(requests.timestamp, since)));
        const totalUsed = Number(used[0]?.total ?? 0);
        const matched = totalUsed >= limit;
        const reason = `Daily token limit ${limit} ${matched ? 'reached' : 'not reached'} (${totalUsed} used, policy: ${policy.name})`;
        records.push({
          policyId: policy.id, policyName: policy.name, policyType: policy.type, action: 'deny',
          matched, decision: matched ? 'denied' : 'eligible', reason,
        });
        if (matched && !hardDenyReason) hardDenyReason = reason;
        break;
      }
      case 'block_external_on_sensitive': {
        const matched = ctx.containsSensitiveData && candidate.isExternal;
        const reason = matched
          ? `Sensitive data detected — external provider blocked (policy: ${policy.name})`
          : `No sensitive-data conflict (policy: ${policy.name})`;
        records.push({
          policyId: policy.id, policyName: policy.name, policyType: policy.type, action: 'deny',
          matched, decision: matched ? 'denied' : 'eligible', reason,
        });
        if (matched && !hardDenyReason) hardDenyReason = reason;
        break;
      }
      default:
        break;
    }
  }

  // Precedence: hard deny beats an allow-constraint failure beats normal routing.
  if (hardDenyReason) return { denied: true, reason: hardDenyReason, records };
  if (allowFailureReason) return { denied: true, reason: allowFailureReason, records };
  return { denied: false, reason: null, records };
}

export async function routeRequest(
  db: AppDb,
  requestType: string,
  requestedModel: string | undefined,
  policyCtx: PolicyContext
): Promise<RoutingResult> {
  // Step 1: load all active policies once
  const activePolicies = await db.query.policies.findMany({ where: eq(policies.enabled, true) });

  // Step 2: load enabled providers (include offline — policy/capability/health filters applied below)
  const eligibleProviders = await db.query.providers.findMany({
    where: eq(providers.enabled, true),
  });

  if (eligibleProviders.length === 0) {
    return { selected: null, reasons: ['No providers configured'], candidates: [], policyDenied: [] };
  }

  const providerIds = eligibleProviders.map((p) => p.id);
  const allModels = await db.query.models.findMany({ where: eq(models.enabled, true) });
  let candidateModels = allModels.filter((m) => providerIds.includes(m.providerId));

  if (requestedModel) {
    const exact = candidateModels.filter((m) => m.modelName === requestedModel);
    if (exact.length > 0) candidateModels = exact;
  }

  if (candidateModels.length === 0) {
    return { selected: null, reasons: ['No enabled models available'], candidates: [], policyDenied: [] };
  }

  const neededCapability = REQUEST_TYPE_CAPABILITY[requestType];
  const providerById = new Map(eligibleProviders.map((p) => [p.id, p]));

  const rawLatencies = candidateModels.map((m) => providerById.get(m.providerId)?.latencyMs ?? 2000);
  const minLatency = Math.max(1, Math.min(...rawLatencies));
  const rawCosts = candidateModels.map((m) => (m.inputCost + m.outputCost) || 0.0001);
  const minCost = Math.max(0.0001, Math.min(...rawCosts));

  // Step 3: score all candidates (before policy filter, so full audit trail is available)
  const allCandidates: RoutingCandidate[] = candidateModels.map((m) => {
    const provider = providerById.get(m.providerId)!;
    const latency = provider.latencyMs ?? 2000;
    const cost = (m.inputCost + m.outputCost) || 0.0001;
    const capabilities = parseCapabilities(m.capabilities);

    const healthBase = clamp(provider.successRate * 100, 0, 100);
    const healthScore = provider.healthStatus === 'healthy' ? healthBase : healthBase * 0.5;
    const latencyScore = clamp((minLatency / latency) * 100, 0, 100);
    const costScore = clamp((minCost / cost) * 100, 0, 100);
    const capabilityScore = neededCapability ? (capabilities.includes(neededCapability) ? 100 : 40) : 70;
    const priorityScore = clamp(provider.priority * 10, 0, 100);
    const finalScore =
      healthScore * WEIGHTS.health +
      latencyScore * WEIGHTS.latency +
      costScore * WEIGHTS.cost +
      capabilityScore * WEIGHTS.capability +
      priorityScore * WEIGHTS.priority;

    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId: m.id,
      modelName: m.modelName,
      healthScore: round(healthScore),
      latencyScore: round(latencyScore),
      costScore: round(costScore),
      capabilityScore: round(capabilityScore),
      priorityScore: round(priorityScore),
      finalScore: round(finalScore),
    };
  });

  allCandidates.sort((a, b) => b.finalScore - a.finalScore);

  // Step 4: apply policy filter — per-candidate eligibility check
  const policyDenied: { providerId: string; reason: string }[] = [];
  const eligibleCandidates: RoutingCandidate[] = [];

  for (const c of allCandidates) {
    const provider = providerById.get(c.providerId)!;

    // Exclude offline providers from routing (health gate)
    if (provider.healthStatus === 'offline') {
      c.policyIneligible = true;
      c.policyDenyReason = 'Provider offline';
      policyDenied.push({ providerId: c.providerId, reason: 'Provider offline' });
      continue;
    }

    const evaluation = await evaluateCandidatePolicies(db, policyCtx, {
      providerId: provider.id,
      providerName: provider.name,
      modelName: c.modelName,
      isExternal: provider.type !== 'local',
    }, activePolicies);

    c.policyEvaluations = evaluation.records;

    if (evaluation.denied) {
      c.policyIneligible = true;
      c.policyDenyReason = evaluation.reason ?? 'Denied by policy';
      policyDenied.push({ providerId: c.providerId, reason: c.policyDenyReason });
    } else {
      eligibleCandidates.push(c);
    }
  }

  if (eligibleCandidates.length === 0) {
    const topDeny = policyDenied[0];
    return {
      selected: null,
      reasons: [topDeny ? `No eligible providers: ${topDeny.reason}` : 'All candidates blocked by policy'],
      candidates: allCandidates,
      policyDenied,
    };
  }

  const selected = eligibleCandidates[0];
  const reasons: string[] = [];
  if (neededCapability && selected.capabilityScore === 100) reasons.push(`${neededCapability} optimized`);
  if (eligibleCandidates.length > 1 && selected.costScore >= Math.max(...eligibleCandidates.map((c) => c.costScore))) {
    reasons.push('lower cost');
  }
  if (selected.healthScore >= 90) reasons.push('provider healthy');
  if (eligibleCandidates.length > 1 && selected.latencyScore >= Math.max(...eligibleCandidates.map((c) => c.latencyScore))) {
    reasons.push('lowest latency');
  }
  if (selected.priorityScore >= 80) reasons.push('high priority provider');
  if (reasons.length === 0) reasons.push('highest overall routing score');
  if (policyDenied.length > 0) reasons.push(`${policyDenied.length} candidate(s) excluded by policy`);

  return { selected, reasons, candidates: allCandidates, policyDenied };
}

// Returns the ordered list of eligible candidates for failover use
export async function getEligibleCandidates(
  db: AppDb,
  requestType: string,
  requestedModel: string | undefined,
  policyCtx: PolicyContext
): Promise<{ candidates: RoutingCandidate[]; policyDenied: { providerId: string; reason: string }[] }> {
  const result = await routeRequest(db, requestType, requestedModel, policyCtx);
  const eligible = result.candidates.filter((c) => !c.policyIneligible);
  return { candidates: eligible, policyDenied: result.policyDenied };
}

function parseCapabilities(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParse(value: unknown): any {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value ?? '{}')); } catch { return {}; }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
