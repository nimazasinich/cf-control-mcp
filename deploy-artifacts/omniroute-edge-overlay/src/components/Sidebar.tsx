import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, Bell, Boxes, FileText, GitCompareArrows, Globe2, KeyRound, LayoutDashboard,
  Network, RadioTower, Settings, ShieldCheck, ShieldHalf, SlidersHorizontal,
} from 'lucide-react';
import { OmniRouteStatus, SystemReadiness } from '../types';
import { formatNumber } from '../utils/formatters';

export type NavSection = 'PRIMARY' | 'OBSERVABILITY';

export const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, tone: '#0C68F7', section: 'PRIMARY' as NavSection },
  { name: 'AI Topology', path: '/topology', icon: Network, tone: '#0FA9FA', section: 'PRIMARY' as NavSection },
  { name: 'Providers', path: '/providers', icon: Boxes, tone: '#0FA9FA', section: 'PRIMARY' as NavSection },
  { name: 'Models', path: '/models', icon: Activity, tone: '#8E23F5', section: 'PRIMARY' as NavSection },
  { name: 'Routing Status', path: '/routing', icon: GitCompareArrows, tone: '#F6821F', section: 'PRIMARY' as NavSection },
  { name: 'API Keys', path: '/keys', icon: KeyRound, tone: '#F6821F', section: 'PRIMARY' as NavSection },
  { name: 'Security Policies', path: '/policies', icon: ShieldCheck, tone: '#0C68F7', section: 'OBSERVABILITY' as NavSection },
  { name: 'Security Events', path: '/firewall', icon: ShieldHalf, tone: '#EC1715', section: 'OBSERVABILITY' as NavSection },
  { name: 'Logs', path: '/logs', icon: FileText, tone: '#0C68F7', section: 'OBSERVABILITY' as NavSection },
  { name: 'Metrics', path: '/metrics', icon: BarChart3, tone: '#0C68F7', section: 'OBSERVABILITY' as NavSection },
  { name: 'Traces', path: '/traces', icon: SlidersHorizontal, tone: '#0C68F7', section: 'OBSERVABILITY' as NavSection },
  { name: 'Analytics', path: '/analytics', icon: RadioTower, tone: '#0C68F7', section: 'OBSERVABILITY' as NavSection },
  { name: 'Alerts', path: '/alerts', icon: Bell, tone: '#F6821F', section: 'OBSERVABILITY' as NavSection },
  { name: 'Settings', path: '/settings', icon: Settings, tone: '#0C68F7', section: 'OBSERVABILITY' as NavSection },
];

interface SidebarProps {
  readiness?: SystemReadiness | null;
  observedRequests?: number;
  omniRouteStatus?: OmniRouteStatus | null;
}

export const Sidebar: React.FC<SidebarProps> = ({ readiness, observedRequests = 0, omniRouteStatus }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const readinessReady = readiness?.ready === true;
  const gatewayHealthy = Boolean(readinessReady && omniRouteStatus?.configured && omniRouteStatus.reachable === true);
  const gatewayLabel = !omniRouteStatus?.configured ? 'Not configured' : omniRouteStatus.reachable === false ? 'Upstream down' : omniRouteStatus.reachable === true && readinessReady ? 'Healthy' : 'Unknown';
  const primary = navItems.filter((item) => item.section === 'PRIMARY');
  const observability = navItems.filter((item) => item.section === 'OBSERVABILITY');

  const renderItem = (item: typeof navItems[number]) => {
    const active = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
    const Icon = item.icon;
    return (
      <button key={item.path} className={`cf-side-item ${active ? 'active' : ''}`} onClick={() => navigate(item.path)}>
        <Icon size={14} strokeWidth={2.05} style={{ color: item.tone }} />
        <span>{item.name}</span>
      </button>
    );
  };

  return (
    <aside className="cf-sidebar">
      <nav className="cf-side-nav" aria-label="Workspace navigation">
        {primary.map(renderItem)}
        <div className="cf-side-heading">Observability</div>
        {observability.map(renderItem)}
      </nav>

      <section className="cf-edge-card">
        <div className="cf-edge-title"><Globe2 size={13}/><strong>Gateway Status</strong></div>
        <span className={`cf-edge-status ${gatewayHealthy ? 'healthy' : ''}`}><i/>{gatewayHealthy ? 'Healthy' : gatewayLabel}</span>
        <dl>
          <div><dt>Requests</dt><dd>{observedRequests > 0 ? formatNumber(observedRequests) : '—'}</dd></div>
          <div><dt>Inventory</dt><dd>{readiness ? readiness.providerCount : '—'}</dd></div>
          <div><dt>Probe latency</dt><dd>{omniRouteStatus?.latencyMs != null ? `${omniRouteStatus.latencyMs} ms` : '—'}</dd></div>
        </dl>
        <button onClick={() => navigate('/analytics')}>View network status <span>→</span></button>
      </section>
    </aside>
  );
};
