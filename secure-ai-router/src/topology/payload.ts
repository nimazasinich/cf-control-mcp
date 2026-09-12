import type { TopologyData, TopologyProviderNode } from '../types';

export interface TopologyClientTrafficRecord {
  clientId: string | null;
  count: number;
  avgLatency: number | null;
}

export interface TopologyProviderTrafficRecord {
  providerId: string | null;
  count: number;
  avgLatency: number | null;
}

export interface TopologyApiKeyRecord {
  id: string;
  name: string;
  role?: string | null;
}

export interface TopologyProviderRecord {
  id: string;
  name: string;
  status?: string | null;
  enabled?: boolean | null;
  metadata?: unknown;
}

export interface TopologyModelRecord {
  providerId?: string | null;
  enabled?: boolean | null;
}

export interface BuildTopologyPayloadInput {
  clientTraffic: TopologyClientTrafficRecord[];
  providerTraffic: TopologyProviderTrafficRecord[];
  apiKeys: TopologyApiKeyRecord[];
  providers: TopologyProviderRecord[];
  models: TopologyModelRecord[];
}

export type TopologyHealth = TopologyProviderNode['health'];

export function normalizeTopologyHealth(value: string | null | undefined, enabled?: boolean | null): TopologyHealth {
  if (enabled === false) return 'disabled';
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'healthy') return 'healthy';
  if (normalized === 'degraded') return 'degraded';
  if (normalized === 'offline') return 'offline';
  if (normalized === 'disabled') return 'disabled';
  return 'unknown';
}

export function readTopologyMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numericMetadataValue(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundPercent(part: number, denominator: number): number {
  return Math.round((part / denominator) * 1000) / 10;
}

export function buildTopologyPayload(input: BuildTopologyPayloadInput): TopologyData {
  const keyById = new Map(input.apiKeys.map((key) => [String(key.id), key]));
  const keyByName = new Map(input.apiKeys.map((key) => [String(key.name), key]));
  const providerById = new Map(input.providers.map((provider) => [String(provider.id), provider]));
  const modelSummaryByProvider = new Map<string, { total: number; enabled: number | null }>();

  for (const model of input.models) {
    if (!model.providerId) continue;
    const providerId = String(model.providerId);
    const summary = modelSummaryByProvider.get(providerId) ?? { total: 0, enabled: null };
    summary.total += 1;
    if (model.enabled !== undefined && model.enabled !== null) {
      summary.enabled = (summary.enabled ?? 0) + (model.enabled ? 1 : 0);
    }
    modelSummaryByProvider.set(providerId, summary);
  }

  const totalRequests = input.clientTraffic.reduce((sum, row) => sum + Number(row.count), 0);
  const denominator = totalRequests || 1;

  const applications = input.clientTraffic
    .map((row) => {
      const rawClientId = row.clientId ? String(row.clientId) : null;
      const matchedKey = rawClientId ? (keyById.get(rawClientId) ?? keyByName.get(rawClientId)) : undefined;
      return {
        id: rawClientId ?? 'unknown-source',
        label: matchedKey?.name ?? 'Unknown',
        sourceStatus: matchedKey ? 'classified' as const : 'unknown' as const,
        requestsLast24h: Number(row.count),
        trafficSharePct: roundPercent(Number(row.count), denominator),
        avgLatencyMs: Math.round(Number(row.avgLatency) || 0),
        type: matchedKey?.role ?? 'Unclassified',
      };
    })
    .sort((a, b) => b.requestsLast24h - a.requestsLast24h || a.label.localeCompare(b.label));

  const providers: TopologyProviderNode[] = input.providerTraffic
    .filter((row) => row.providerId !== null)
    .map((row) => {
      const providerId = String(row.providerId);
      const provider = providerById.get(providerId);
      const modelSummary = modelSummaryByProvider.get(providerId) ?? { total: 0, enabled: null };
      return {
        id: providerId,
        label: provider?.name ?? 'Unknown',
        type: 'provider',
        health: normalizeTopologyHealth(provider?.status, provider?.enabled),
        requestsLast24h: Number(row.count),
        trafficSharePct: roundPercent(Number(row.count), denominator),
        avgLatencyMs: Math.round(Number(row.avgLatency) || 0),
        latencySource: 'traffic',
        connectionState: 'observed',
        modelCount: modelSummary.total,
        enabledModelCount: modelSummary.enabled,
      };
    });

  const seenProviderIds = new Set(providers.map((node) => node.id));
  for (const provider of input.providers) {
    const providerId = String(provider.id);
    if (seenProviderIds.has(providerId)) continue;
    const metadata = readTopologyMetadata(provider.metadata);
    const modelSummary = modelSummaryByProvider.get(providerId) ?? { total: 0, enabled: null };
    const healthLatency = numericMetadataValue(metadata, 'baseLatency');
    providers.push({
      id: providerId,
      label: provider.name,
      type: 'provider',
      health: normalizeTopologyHealth(provider.status, provider.enabled),
      requestsLast24h: 0,
      trafficSharePct: 0,
      avgLatencyMs: healthLatency ?? 0,
      latencySource: healthLatency !== null ? 'health' : 'none',
      connectionState: 'configured',
      modelCount: modelSummary.total,
      enabledModelCount: modelSummary.enabled,
    });
  }

  providers.sort((a, b) => {
    if (a.connectionState !== b.connectionState) return a.connectionState === 'observed' ? -1 : 1;
    if (a.requestsLast24h !== b.requestsLast24h) return b.requestsLast24h - a.requestsLast24h;
    return a.label.localeCompare(b.label);
  });

  return {
    nodes: {
      applications,
      edge: { label: 'Cloudflare Edge', totalRequestsLast24h: totalRequests },
      router: { label: 'AI Router', totalRequestsLast24h: totalRequests },
      providers,
    },
  };
}
