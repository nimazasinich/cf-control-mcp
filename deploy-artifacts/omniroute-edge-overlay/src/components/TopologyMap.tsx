import React, { useMemo } from 'react';
import { BarChart3, Bot, Database, FileText, Globe, Server, Share2, Shield, SlidersHorizontal } from 'lucide-react';
import { CloudflareCloudLogo } from './ProviderLogos';
import { DashboardData, Provider, TopologyApplicationNode, TopologyProviderNode } from '../types';
import { formatTopologyCount, formatTopologyLatency, formatTopologyPercent } from '../topology/format';

interface TopologyMapProps {
  data: DashboardData;
  onSelectProvider?: (provider: Provider) => void;
  onSelectSource?: (source: TopologyApplicationNode) => void;
}

const healthColors: Record<TopologyProviderNode['health'], string> = {
  healthy: '#0FB15A',
  degraded: '#F6821F',
  offline: '#EC1715',
  disabled: '#8E95B8',
  unknown: '#8E95B8',
};

const upperControls = [
  { label: 'Gateway Auth', desc: 'Bearer-token gateway', icon: Shield, color: '#0C68F7', bg: '#EBF4FE' },
  { label: 'Rate Limit', desc: 'Edge request-rate', icon: SlidersHorizontal, color: '#8E23F5', bg: '#F4EBFD' },
  { label: 'Origin Guard', desc: 'Validated OmniRoute', icon: Globe, color: '#0F766E', bg: '#EAF8F1' },
];

const lowerControls = [
  { label: 'D1 Telemetry', desc: 'Observed edge records', icon: Database, color: '#0C68F7', bg: '#EBF4FE' },
  { label: 'Request IDs', desc: 'Correlation and traces', icon: FileText, color: '#8E23F5', bg: '#F4EBFD' },
  { label: 'OmniRoute Authority', desc: 'Routing authority', icon: BarChart3, color: '#0FB15A', bg: '#EAF8F1' },
];

function titleHealth(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Unknown';
}

function sourceY(index: number, count: number): number {
  if (count <= 1) return 88;
  return 34 + index * Math.min(25, 108 / Math.max(1, count - 1));
}

function providerY(index: number, count: number): number {
  if (count <= 1) return 88;
  return 34 + index * Math.min(23, 112 / Math.max(1, count - 1));
}

export const TopologyMap: React.FC<TopologyMapProps> = ({ data, onSelectProvider, onSelectSource }) => {
  const topology = data.topology?.nodes;
  const sources = (topology?.applications ?? []).slice(0, 5);
  const topologyProviders = (topology?.providers ?? []).slice(0, 6);
  const totalRequests = topology?.router.totalRequestsLast24h ?? data.stats?.totalRequests ?? 0;

  const providerById = useMemo(() => new Map((data.providers ?? []).map((provider) => [provider.id, provider])), [data.providers]);
  const firstModelByProvider = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of data.models ?? []) {
      if (model.providerId && !map.has(model.providerId)) map.set(model.providerId, model.name || model.id);
    }
    return map;
  }, [data.models]);

  return (
    <section className="cf-reference-topology">
      <header className="cf-topology-header">
        <div className="cf-topology-heading">
          <span className="cf-topology-title-icon"><Share2 size={14} /></span>
          <div>
            <h2>Global AI Traffic Topology</h2>
            <p>Observed edge traffic with configured provider inventory; routing authority remains OmniRoute.</p>
          </div>
        </div>
        <div className="cf-topology-header-right">
          <div className="cf-topology-legend">
            <span><i className="healthy"/>Healthy</span>
            <span><i className="degraded"/>Degraded</span>
            <span><i className="offline"/>Offline</span>
            <span><i className="routed"/>Observed route</span>
          </div>
          <span className="cf-observed-pill">Observed 24h</span>
        </div>
      </header>

      <div className="cf-topology-canvas">
        <svg className="cf-topology-lines" viewBox="0 0 786 290" preserveAspectRatio="none" aria-hidden="true">
          {sources.map((source, index) => {
            const y = sourceY(index, sources.length);
            return <line key={`s-${source.id}`} x1="162" y1={y} x2="351" y2={110 + (index - (sources.length - 1) / 2) * 8} stroke="#0C68F7" strokeWidth="1.4" opacity="0.78"/>;
          })}
          {topologyProviders.filter((provider) => provider.connectionState === 'observed' && provider.requestsLast24h > 0).map((provider, index, list) => {
            const y = providerY(index, list.length);
            return <line key={`p-${provider.id}`} x1="435" y1={110 + (index - (list.length - 1) / 2) * 8} x2="624" y2={y} stroke="#0FB15A" strokeWidth="1.4" opacity="0.78"/>;
          })}
          {upperControls.map((control, index) => {
            const x = 315 + index * 79;
            return <line key={`u-${control.label}`} x1={x} y1="48" x2="393" y2="110" stroke="#0C68F7" strokeWidth="1" opacity="0.42"/>;
          })}
          {lowerControls.map((control, index) => {
            const x = 259 + index * 133;
            return <line key={`l-${control.label}`} x1={x} y1="205" x2="393" y2="110" stroke="#0C68F7" strokeWidth="1" opacity="0.35"/>;
          })}
        </svg>

        <div className="cf-topology-source-card">
          <div className="cf-topology-box-title">Application Sources <span>{topology?.applications.length ?? 0}</span></div>
          {sources.length === 0 ? (
            <div className="cf-topology-empty"><strong>No observed sources</strong><span>No data</span></div>
          ) : sources.map((source) => (
            <button key={source.id} className="cf-topology-source-row" onClick={() => onSelectSource?.(source)}>
              <span className="cf-source-icon">{source.sourceStatus === 'classified' ? <Globe size={11}/> : <Database size={11}/>}</span>
              <span className="cf-source-copy"><strong>{source.label}</strong><small>{formatTopologyCount(source.requestsLast24h)} req/day · {formatTopologyPercent(source.trafficSharePct)}</small></span>
              <span className={`cf-node-dot ${source.sourceStatus === 'classified' ? 'healthy' : 'unknown'}`}/>
            </button>
          ))}
        </div>

        <div className="cf-topology-upper-controls">
          {upperControls.map(({ label, desc, icon: Icon, color, bg }) => (
            <div className="cf-topology-control" key={label}>
              <span style={{ color, background: bg }}><Icon size={11}/></span>
              <div><strong>{label}</strong><small>{desc}</small></div>
            </div>
          ))}
        </div>

        <div className="cf-central-router">
          <div className="cf-router-halo" />
          <div className="cf-router-circle">
            <CloudflareCloudLogo size={31} />
            <span>Cloudflare</span>
            <strong>AI Router</strong>
            <small>{formatTopologyCount(totalRequests)} observed req</small>
          </div>
        </div>

        <div className="cf-topology-provider-card">
          <div className="cf-topology-box-title">AI Model Providers <span>{topology?.providers.length ?? data.providers.length}</span></div>
          {topologyProviders.length === 0 ? (
            <div className="cf-topology-empty right"><strong>No providers configured</strong><span>No data</span></div>
          ) : topologyProviders.map((provider) => {
            const configured = providerById.get(provider.id);
            const model = firstModelByProvider.get(provider.id);
            return (
              <button key={provider.id} className="cf-topology-provider-row" disabled={!configured} onClick={() => configured && onSelectProvider?.(configured)}>
                <span className="cf-provider-mini-logo"><Bot size={11}/></span>
                <span className="cf-provider-copy"><strong>{provider.label}</strong><small>{model || `${provider.modelCount} model${provider.modelCount === 1 ? '' : 's'}`}</small></span>
                <span className="cf-node-dot" style={{ background: healthColors[provider.health] }} title={`${titleHealth(provider.health)} · ${formatTopologyLatency(provider.avgLatencyMs)}`}/>
              </button>
            );
          })}
        </div>

        <div className="cf-topology-lower-controls">
          {lowerControls.map(({ label, desc, icon: Icon, color, bg }) => (
            <div className="cf-topology-control" key={label}>
              <span style={{ color, background: bg }}><Icon size={11}/></span>
              <div><strong>{label}</strong><small>{desc}</small></div>
            </div>
          ))}
        </div>

        <div className="cf-edge-router-bar">
          <div className="cf-edge-router-left">
            <span className="cf-edge-router-icon"><Server size={12}/></span>
            <strong>Cloudflare Edge Router</strong>
            <small>Edge network · {formatTopologyCount(totalRequests)} observed requests</small>
          </div>
          <span>View traffic evidence →</span>
        </div>
      </div>
    </section>
  );
};
