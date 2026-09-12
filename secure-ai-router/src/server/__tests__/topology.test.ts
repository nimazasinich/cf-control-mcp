import { describe, expect, it } from 'vitest';
import { buildRailLayout, pageItems } from '../../topology/layout';
import { formatTopologyLatency, formatTopologyPercent } from '../../topology/format';
import { buildTopologyPayload } from '../../topology/payload';

function provider(id: string, name = id, status = 'Healthy', metadata: unknown = { baseLatency: 682 }) {
  return { id, name, status, enabled: true, metadata };
}

describe('topology API payload and scalable rail layout (CP02)', () => {
  it('formats dynamic latency and traffic values safely', () => {
    expect(formatTopologyLatency(3)).toBe('3 ms');
    expect(formatTopologyLatency(682)).toBe('682 ms');
    expect(formatTopologyLatency(12_400)).toBe('12.4 s');
    expect(formatTopologyPercent(0)).toBe('0%');
    expect(formatTopologyPercent(1.4)).toBe('1.4%');
    expect(formatTopologyPercent(68.3)).toBe('68.3%');
    expect(formatTopologyPercent(100)).toBe('100%');
  });

  it('zero providers and empty history returns truthful zero totals and no source nodes', () => {
    const topology = buildTopologyPayload({ clientTraffic: [], providerTraffic: [], apiKeys: [], providers: [], models: [] });
    expect(topology.nodes.providers).toEqual([]);
    expect(topology.nodes.applications).toEqual([]);
    expect(topology.nodes.edge.totalRequestsLast24h).toBe(0);
    expect(topology.nodes.router.totalRequestsLast24h).toBe(0);
  });

  it('one configured provider with no history remains visible without fabricated traffic', () => {
    const topology = buildTopologyPayload({
      clientTraffic: [],
      providerTraffic: [],
      apiKeys: [],
      providers: [provider('openai', 'OpenAI')],
      models: [{ providerId: 'openai' }, { providerId: 'openai' }],
    });
    expect(topology.nodes.providers).toHaveLength(1);
    expect(topology.nodes.providers[0]).toMatchObject({
      id: 'openai',
      label: 'OpenAI',
      requestsLast24h: 0,
      trafficSharePct: 0,
      connectionState: 'configured',
      latencySource: 'health',
      avgLatencyMs: 682,
      modelCount: 2,
      enabledModelCount: null,
    });
    expect(topology.nodes.applications).toHaveLength(0);
  });

  it.each([3, 6, 10, 20, 30])('%i configured providers are all returned without truncation', (count) => {
    const providers = Array.from({ length: count }, (_, index) => provider(`p-${index}`, index === count - 1 ? 'Very-Long-Enterprise-OpenAI-Compatible-Provider' : `Provider ${index}`));
    const topology = buildTopologyPayload({ clientTraffic: [], providerTraffic: [], apiKeys: [], providers, models: [] });
    expect(topology.nodes.providers).toHaveLength(count);
    expect(new Set(topology.nodes.providers.map((node) => node.id)).size).toBe(count);
    expect(topology.nodes.providers.some((node) => node.label === 'Very-Long-Enterprise-OpenAI-Compatible-Provider')).toBe(true);
  });

  it('offline provider status is preserved exactly', () => {
    const topology = buildTopologyPayload({
      clientTraffic: [],
      providerTraffic: [],
      apiKeys: [],
      providers: [provider('offline-provider', 'Offline Provider', 'Offline')],
      models: [],
    });
    expect(topology.nodes.providers[0].health).toBe('offline');
    expect(topology.nodes.providers[0].connectionState).toBe('configured');
  });

  it('unexpected stored health text is surfaced safely as unknown', () => {
    const topology = buildTopologyPayload({
      clientTraffic: [],
      providerTraffic: [],
      apiKeys: [],
      providers: [provider('maintenance-provider', 'Maintenance Provider', 'Maintenance')],
      models: [],
    });
    expect(topology.nodes.providers[0].health).toBe('unknown');
  });

  it('payload reflects DB aggregate records and observed routes only', () => {
    const topology = buildTopologyPayload({
      clientTraffic: [{ clientId: 'client-a', count: 4, avgLatency: 150 }],
      providerTraffic: [
        { providerId: 'provider-a', count: 3, avgLatency: 100 },
        { providerId: 'provider-b', count: 1, avgLatency: 400 },
      ],
      apiKeys: [{ id: 'client-a', name: 'Internal EU Provider', role: 'gateway' }],
      providers: [provider('provider-a', 'Provider A'), provider('provider-b', 'Provider B')],
      models: [],
    });
    expect(topology.nodes.providers.find((node) => node.id === 'provider-a')).toMatchObject({ requestsLast24h: 3, trafficSharePct: 75, avgLatencyMs: 100, connectionState: 'observed', latencySource: 'traffic' });
    expect(topology.nodes.providers.find((node) => node.id === 'provider-b')).toMatchObject({ requestsLast24h: 1, trafficSharePct: 25, avgLatencyMs: 400, connectionState: 'observed', latencySource: 'traffic' });
    expect(topology.nodes.applications[0]).toMatchObject({ label: 'Internal EU Provider', sourceStatus: 'classified', requestsLast24h: 4, trafficSharePct: 100 });
  });

  it('provider traffic share includes unassigned observed requests in the denominator', () => {
    const topology = buildTopologyPayload({
      clientTraffic: [{ clientId: 'gateway', count: 2, avgLatency: 6200 }],
      providerTraffic: [{ providerId: 'provider-share', count: 1, avgLatency: 3 }, { providerId: null, count: 1, avgLatency: 12_400 }],
      apiKeys: [{ id: 'gateway', name: 'Gateway', role: 'gateway' }],
      providers: [provider('provider-share', 'Provider Share')],
      models: [],
    });
    expect(topology.nodes.router.totalRequestsLast24h).toBe(2);
    expect(topology.nodes.providers.find((node) => node.id === 'provider-share')).toMatchObject({ requestsLast24h: 1, trafficSharePct: 50, connectionState: 'observed' });
  });

  it('missing source metadata is unclassified rather than fabricated', () => {
    const topology = buildTopologyPayload({
      clientTraffic: [{ clientId: 'missing-client-record', count: 1, avgLatency: 12_400 }],
      providerTraffic: [{ providerId: null, count: 1, avgLatency: 12_400 }],
      apiKeys: [],
      providers: [],
      models: [],
    });
    expect(topology.nodes.applications).toHaveLength(1);
    expect(topology.nodes.applications[0]).toMatchObject({
      id: 'missing-client-record',
      label: 'Unknown',
      sourceStatus: 'unknown',
      type: 'Unclassified',
      requestsLast24h: 1,
      trafficSharePct: 100,
      avgLatencyMs: 12_400,
    });
    expect(topology.nodes.providers).toHaveLength(0);
  });

  it('mixed healthy, degraded, and offline configuration states remain distinct without traffic', () => {
    const topology = buildTopologyPayload({
      clientTraffic: [],
      providerTraffic: [],
      apiKeys: [],
      providers: [provider('healthy-provider', 'Healthy', 'Healthy'), provider('degraded-provider', 'Degraded', 'Degraded'), provider('offline-provider', 'Offline', 'Offline')],
      models: [],
    });
    const statuses = new Map(topology.nodes.providers.map((node) => [node.id, node.health]));
    expect(statuses.get('healthy-provider')).toBe('healthy');
    expect(statuses.get('degraded-provider')).toBe('degraded');
    expect(statuses.get('offline-provider')).toBe('offline');
    expect(topology.nodes.providers.every((node) => node.connectionState === 'configured')).toBe(true);
    expect(topology.nodes.providers.every((node) => node.requestsLast24h === 0)).toBe(true);
  });

  it('pagination/layout makes every provider reachable across pages', () => {
    const providers = Array.from({ length: 30 }, (_, index) => `provider-${index}`);
    const firstLayout = buildRailLayout(providers.length, 230, 0, { nodeHeight: 56, minGap: 8, maxPerPage: 6 });
    expect(firstLayout.pageSize).toBeGreaterThan(0);
    expect(firstLayout.pageSize).toBeLessThanOrEqual(6);
    const seen: string[] = [];
    for (let page = 0; page < firstLayout.pageCount; page += 1) {
      const layout = buildRailLayout(providers.length, 230, page, { nodeHeight: 56, minGap: 8, maxPerPage: 6 });
      seen.push(...pageItems(providers, layout));
      expect(layout.positions.every((position) => position >= 0)).toBe(true);
      expect(layout.positions.every((position) => position + 56 <= 230)).toBe(true);
    }
    expect(seen).toEqual(providers);
    expect(new Set(seen).size).toBe(30);
  });
});
