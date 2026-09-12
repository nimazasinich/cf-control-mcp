import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Share2, Database, Box, GitMerge, 
  Key, Shield, ShieldAlert, FileText, Activity, Bell, Settings,
  Radio, ArrowUpRight, ClipboardList
} from 'lucide-react';
import { SystemReadiness } from '../types';
import { formatNumber } from '../utils/formatters';

export const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'AI Topology', path: '/topology', icon: Share2 },
  { name: 'Providers', path: '/providers', icon: Database },
  { name: 'Models', path: '/models', icon: Box },
  { name: 'Routing Rules', path: '/routing', icon: GitMerge },
  { name: 'API Keys', path: '/keys', icon: Key },
  { name: 'Security Policies', path: '/policies', icon: Shield },
  { name: 'AI Firewall', path: '/firewall', icon: ShieldAlert },
  { name: 'Logs', path: '/logs', icon: FileText },
  { name: 'Metrics', path: '/metrics', icon: Activity },
  { name: 'Traces', path: '/traces', icon: Radio },
  { name: 'Audit Log', path: '/audit', icon: ClipboardList },
  { name: 'Analytics', path: '/analytics', icon: Activity },
  { name: 'Alerts', path: '/alerts', icon: Bell },
  { name: 'Settings', path: '/settings', icon: Settings },
];

interface SidebarProps {
  readiness?: SystemReadiness | null;
  observedRequests?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ readiness, observedRequests = 0 }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const statusTone = readiness?.ready
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : readiness
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';
  const statusLabel = readiness?.ready ? 'Ready' : readiness ? 'Attention' : 'No data';

  return (
    <aside className="w-[210px] xl:w-[220px] h-full shrink-0 flex flex-col bg-white/70 backdrop-blur-xl border-r border-slate-200/60 shadow-[2px_0_12px_rgba(0,0,0,0.02)] p-2.5 sm:p-3 gap-2 z-20 select-none overflow-hidden justify-between">
      <nav className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pr-0.5">
        {navItems.map(item => {
          const isActive = item.path === '/' 
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);
          const Icon = item.icon;

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              title={item.name}
              className={`h-[28px] w-full flex items-center px-2.5 text-[11.5px] transition-all cursor-pointer select-none rounded-lg shrink-0 ${
                isActive
                  ? 'bg-gradient-to-r from-blue-500/10 to-orange-500/10 border border-blue-500/30 text-blue-700 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80 font-medium'
              }`}
            >
              <Icon 
                size={14} 
                className={`mr-2.5 shrink-0 ${isActive ? 'text-[#0051C3]' : 'text-slate-400'}`} 
                strokeWidth={isActive ? 2.3 : 1.8} 
              />
              <span className="whitespace-nowrap tracking-tight">{item.name}</span>
            </button>
          );
        })}
      </nav>

      <div className="w-full shrink-0">
        <div className="card-3d-glass p-2.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-white to-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-white flex items-center justify-center text-blue-600">
                <Radio size={11} strokeWidth={2.2} />
              </div>
              <span className="text-[11px] font-bold text-slate-900">Edge Network</span>
            </div>
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold shadow-xs border flex items-center gap-1 ${statusTone}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${readiness?.ready ? 'bg-emerald-500 animate-pulse' : readiness ? 'bg-amber-500' : 'bg-slate-400'}`} />
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-col gap-0.5 text-[9.5px] text-slate-600 font-mono mt-0.5">
            <div className="flex items-center justify-between gap-2">
              <span>Observed requests</span>
              <span className="font-bold text-slate-900">{formatNumber(observedRequests)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Healthy providers</span>
              <span className="font-bold text-slate-900">{readiness?.healthyProviders ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Last window</span>
              <span className="font-bold text-slate-900">24h</span>
            </div>
          </div>

          <button 
            onClick={() => navigate('/analytics')} 
            className="text-[9.5px] text-[#0051C3] font-semibold hover:underline flex items-center justify-between pt-1 border-t border-slate-200/80 cursor-pointer mt-0.5"
          >
            <span>View network status</span>
            <ArrowUpRight size={10} />
          </button>
        </div>
      </div>
    </aside>
  );
};
