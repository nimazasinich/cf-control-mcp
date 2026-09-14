import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Clock3, Cpu, FileText, ShieldAlert, Wifi } from 'lucide-react';
import { DashboardData } from '../types';
import { formatExactNumber, formatLatency, formatNumber, formatRelativeTime } from '../utils/formatters';
import { KpiCard } from './KpiCard';
import { TopologyMap } from './TopologyMap';
import { RuntimeResourcesCard } from './RuntimeResourcesCard';
import { RecentDecisionsTable } from './RecentDecisionsTable';
import { ProviderHealthCard } from './ProviderHealthCard';
import { GlobalEdgeTrafficCard } from './GlobalEdgeTrafficCard';
import { DetailGrid, DetailItem, ModalDialog, SourcePill } from './WorkspacePrimitives';

interface DashboardViewProps { data: DashboardData; }

type DashboardDetail = 'requests' | 'providers' | 'latency' | 'blocked' | 'memory' | 'network' | 'runtime' | null;

function requestSeriesPoints(series: Array<{ count: number }> | undefined): string | undefined {
  if (!series || series.length < 2) return undefined;
  const values = series.slice(-24).map((point) => Number(point.count) || 0);
  const max = Math.max(...values);
  if (max <= 0) return undefined;
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  return values.map((value, index) => {
    const x = values.length === 1 ? 30 : (index / (values.length - 1)) * 60;
    const y = 14 - ((value - min) / span) * 10;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function formatRuntimeMemory(megabytes: number | null): string {
  if (megabytes == null) return '—';
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${Math.round(megabytes)} MB`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ data }) => {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DashboardDetail>(null);
  const hasStats = Boolean(data.stats);
  const providerTotal = data.readiness?.providerCount ?? data.providers.length;
  const enabledProviders = data.readiness?.enabledProviders ?? data.providers.filter((provider) => provider.enabled).length;
  const authoritativeProviderHealth = Boolean(
    data.stats?.providerHealthAuthoritative || data.providers.some((provider) => provider.healthSource === 'omniroute'),
  );
  const healthyProviders = authoritativeProviderHealth
    ? data.providers.filter((provider) => provider.enabled && provider.healthStatus === 'healthy').length
    : null;
  const degradedProviders = authoritativeProviderHealth
    ? data.providers.filter((provider) => provider.enabled && provider.healthStatus === 'degraded').length
    : null;
  const offlineProviders = authoritativeProviderHealth
    ? data.providers.filter((provider) => provider.enabled && provider.healthStatus === 'offline').length
    : null;

  const memUsedMb = data.runtime?.available && data.runtime.heapUsedMb != null ? data.runtime.heapUsedMb : null;
  const memTotalMb = data.runtime?.available && data.runtime.heapTotalMb != null ? data.runtime.heapTotalMb : null;
  const memoryPct = memUsedMb != null && memTotalMb != null && memTotalMb > 0
    ? Math.min(100, Math.round((memUsedMb / memTotalMb) * 100)) : null;

  const securityEvents = data.securityEvents.slice(0, 5);
  const requestSparkline = requestSeriesPoints(data.analytics?.requestVolumeSeries);

  const providerChip = providerTotal > 0
    ? authoritativeProviderHealth
      ? `${healthyProviders ?? 0} healthy`
      : 'Inventory'
    : undefined;

  const providerTrend = providerTotal > 0
    ? authoritativeProviderHealth
      ? `${degradedProviders ?? 0} degraded · ${offlineProviders ?? 0} offline`
      : 'Live health unavailable'
    : undefined;

  const originStatusValue = data.omniRouteStatus?.reachable === true
    ? 'Reachable'
    : data.omniRouteStatus?.reachable === false
      ? 'Unreachable'
      : '—';

  const renderDetail = () => {
    if (!detail) return null;
    const source = detail === 'providers'
      ? (authoritativeProviderHealth ? 'OmniRoute live health' : 'Local provider inventory snapshot')
      : detail === 'network'
        ? 'OmniRoute origin probe'
        : detail === 'memory' || detail === 'runtime'
          ? 'Local Node runtime + observed request analytics'
          : detail === 'blocked'
            ? 'Observed gateway/security records'
            : 'Observed gateway telemetry';

    const titles: Record<Exclude<DashboardDetail, null>, string> = {
      requests: 'Total AI Requests', providers: 'Active Providers', latency: 'Average Latency', blocked: 'Blocked Requests',
      memory: 'Runtime Memory', network: 'Network Health', runtime: 'Runtime Resources',
    };

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div><div className="text-[9px] uppercase tracking-wide text-slate-500">Data source</div><div className="text-[11px] font-semibold text-slate-800">{source}</div></div>
          <SourcePill label={detail === 'providers' && !authoritativeProviderHealth ? 'SNAPSHOT' : detail === 'network' ? 'PROBE' : 'OBSERVED'} tone={detail === 'providers' && !authoritativeProviderHealth ? 'amber' : 'blue'} />
        </div>
        <DetailGrid>
          {detail === 'requests' && <><DetailItem label="Observed requests" value={hasStats ? formatExactNumber(data.stats!.totalRequests) : 'Unknown'} /><DetailItem label="Window" value="Last 24 hours" /></>}
          {detail === 'providers' && <><DetailItem label="Configured providers" value={providerTotal || 'Unknown'} /><DetailItem label="Enabled" value={providerTotal ? enabledProviders : 'Unknown'} /><DetailItem label="Healthy" value={healthyProviders ?? 'Not observed'} /><DetailItem label="Degraded / offline" value={authoritativeProviderHealth ? `${degradedProviders ?? 0} / ${offlineProviders ?? 0}` : 'Not observed'} /></>}
          {detail === 'latency' && <><DetailItem label="Average latency" value={hasStats && data.stats!.avgLatency > 0 ? formatLatency(data.stats!.avgLatency) : 'Not observed'} /><DetailItem label="Window" value="Last 24 hours" /></>}
          {detail === 'blocked' && <><DetailItem label="Blocked records" value={hasStats ? formatExactNumber(data.stats!.blockedThreats) : 'Unknown'} /><DetailItem label="Security events shown" value={securityEvents.length} /></>}
          {(detail === 'memory' || detail === 'runtime') && <><DetailItem label="Heap used" value={formatRuntimeMemory(memUsedMb)} /><DetailItem label="Heap total" value={formatRuntimeMemory(memTotalMb)} /><DetailItem label="Heap utilization" value={memoryPct == null ? 'Not observed' : `${memoryPct}%`} /><DetailItem label="Runtime sample" value={data.runtime?.available ? 'Available' : 'Unavailable'} /></>}
          {detail === 'network' && <><DetailItem label="Origin configured" value={data.omniRouteStatus?.configured ? 'Yes' : 'No'} /><DetailItem label="Reachability" value={originStatusValue} /><DetailItem label="Probe latency" value={data.omniRouteStatus?.latencyMs != null ? formatLatency(data.omniRouteStatus.latencyMs) : 'Not observed'} /></>}
        </DetailGrid>
        <div className="flex flex-wrap gap-2">
          {(detail === 'requests' || detail === 'latency' || detail === 'blocked') && <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700" onClick={() => navigate('/logs')}>View request logs</button>}
          {detail === 'providers' && <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700" onClick={() => navigate('/providers')}>Open Providers</button>}
          {(detail === 'memory' || detail === 'runtime') && <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700" onClick={() => navigate('/metrics')}>Open Metrics</button>}
          {detail === 'network' && <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700" onClick={() => navigate('/settings')}>Open Settings</button>}
        </div>
        <p className="text-[9.5px] leading-relaxed text-slate-500">Dashboard detail only exposes values present in the current data contracts. Missing runtime, provider, geographic, quota, or routing fields remain unavailable rather than being inferred.</p>
      </div>
    );
  };

  return (
    <div className="cf-dashboard-grid">
      <section className="cf-kpi-strip">
        <KpiCard title="Total AI Requests" value={hasStats ? formatNumber(data.stats!.totalRequests) : '—'} rawExactValue={hasStats ? formatExactNumber(data.stats!.totalRequests) : undefined} trend={hasStats ? 'Observed 24h' : undefined} trendType="neutral" subtitle="Across observed gateway traffic" icon={FileText} iconColor="#0C68F7" iconBg="#EBF4FE" sparklineColor="#0C68F7" sparklinePoints={requestSparkline} onClick={() => setDetail('requests')} />
        <KpiCard title="Active Providers" value={providerTotal > 0 ? `${enabledProviders} / ${providerTotal}` : '—'} pillBadge={providerChip} pillColor={authoritativeProviderHealth && healthyProviders === enabledProviders && enabledProviders > 0 ? '#0FB15A' : '#64748B'} trend={providerTrend} trendType={authoritativeProviderHealth && (degradedProviders ?? 0) > 0 ? 'negative' : 'neutral'} subtitle={authoritativeProviderHealth ? 'Current OmniRoute health' : 'Live health unavailable'} icon={Box} iconColor="#0FB15A" iconBg="#EAF8F1" onClick={() => setDetail('providers')} />
        <KpiCard title="Avg Latency" value={hasStats && data.stats!.avgLatency > 0 ? formatLatency(data.stats!.avgLatency) : '—'} trend={hasStats && data.stats!.avgLatency > 0 ? 'Observed 24h' : undefined} trendType="neutral" subtitle="Observed gateway average" icon={Clock3} iconColor="#8E23F5" iconBg="#F4EBFD" onClick={() => setDetail('latency')} />
        <KpiCard title="Blocked Requests" value={hasStats ? formatNumber(data.stats!.blockedThreats) : '—'} trend={hasStats ? (data.stats!.blockedThreats > 0 ? 'Observed 24h' : 'None observed') : undefined} trendType={data.stats?.blockedThreats ? 'negative' : 'neutral'} subtitle="Observed blocked security requests" icon={ShieldAlert} iconColor="#EC1715" iconBg="#FEECEB" onClick={() => setDetail('blocked')} />
        <KpiCard title="Runtime Memory" value={formatRuntimeMemory(memUsedMb)} trend={memoryPct != null ? `${memoryPct}% of heap` : undefined} trendType={memoryPct != null && memoryPct > 80 ? 'negative' : 'neutral'} subtitle={memTotalMb != null ? `${formatRuntimeMemory(memTotalMb)} Node heap allocated` : 'Node runtime sample unavailable'} icon={Cpu} iconColor="#0C68F7" iconBg="#EBF4FE" progressPercent={memoryPct ?? undefined} onClick={() => setDetail('memory')} />
        <KpiCard title="Network Health" value={originStatusValue} trend={data.omniRouteStatus?.latencyMs != null ? `Probe ${formatLatency(data.omniRouteStatus.latencyMs)}` : undefined} trendType={data.omniRouteStatus?.reachable === true ? 'positive' : data.omniRouteStatus?.reachable === false ? 'negative' : 'neutral'} subtitle={data.omniRouteStatus?.configured ? 'OmniRoute /v1/models reachability' : 'OmniRoute origin not configured'} icon={Wifi} iconColor="#0FB15A" iconBg="#EAF8F1" onClick={() => setDetail('network')} />
      </section>

      <section className="cf-dashboard-content">
        <div className="cf-dashboard-left-col">
          <div className="cf-topology-slot" aria-label="Global AI Traffic Topology"><TopologyMap data={data} /></div>
          <div className="cf-bottom-left-row">
            <div aria-label="Recent Edge Requests"><RecentDecisionsTable history={data.history} onViewAll={() => navigate('/logs')} /></div>
            <div aria-label="Provider Health"><ProviderHealthCard providers={data.providers} onManageClick={() => navigate('/providers')} /></div>
          </div>
        </div>

        <div className="cf-dashboard-right-col">
          <div aria-label="Runtime Resources"><RuntimeResourcesCard data={data} onDetailsClick={() => setDetail('runtime')} /></div>
          <section className="cf-panel cf-firewall-card">
            <div className="cf-panel-title"><span className="cf-panel-icon blue"><ShieldAlert size={14} /></span><strong>Security Event Activity</strong><button onClick={() => navigate('/firewall')}>View all →</button></div>
            <div className="cf-firewall-table">
              <div className="cf-firewall-head"><span>Time</span><span>Event</span><span>Source</span><span>Severity</span></div>
              {securityEvents.map((event, i) => <div className="cf-firewall-row" key={event.id ?? `${event.timestamp}-${i}`}><span>{formatRelativeTime(event.timestamp)}</span><span><span className="cf-warning-triangle">⚠</span>{event.eventType.replace(/_/g,' ')}</span><span className="mono">{event.sourceIp || 'Unknown'}</span><span className={`cf-severity ${event.severity.toLowerCase()}`}>{event.severity}</span></div>)}
              {securityEvents.length === 0 && <div className="cf-empty-row">No security events in the current dataset.</div>}
            </div>
          </section>
          <div aria-label="Global Edge Traffic"><GlobalEdgeTrafficCard totalRequests={hasStats ? formatNumber(data.stats!.totalRequests) : '—'} /></div>
        </div>
      </section>

      <ModalDialog open={detail !== null} title={`Dashboard detail · ${detail ? ({requests:'Total AI Requests',providers:'Active Providers',latency:'Average Latency',blocked:'Blocked Requests',memory:'Runtime Memory',network:'Network Health',runtime:'Runtime Resources'} as const)[detail] : ''}`} onClose={() => setDetail(null)}>
        {renderDetail()}
      </ModalDialog>
    </div>
  );
};
