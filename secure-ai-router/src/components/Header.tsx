import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, ChevronDown, ShieldCheck, RefreshCw } from 'lucide-react';
import { CloudflareCloudLogo } from './ProviderLogos';
import { navItems } from './Sidebar';
import { OperationalAlert, SystemReadiness } from '../types';

interface HeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  readiness?: SystemReadiness | null;
  alerts?: OperationalAlert[];
}

export const Header: React.FC<HeaderProps> = ({ onRefresh, isRefreshing, readiness, alerts = [] }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const mainTabs = [
    { label: 'Overview', path: '/' },
    { label: 'Topology', path: '/topology' },
    { label: 'Security', path: '/firewall' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'Settings', path: '/settings' }
  ];

  const quickJumpItems = useMemo(
    () => [...mainTabs, ...navItems.map((item) => ({ label: item.name, path: item.path }))],
    []
  );

  const environmentLabel = useMemo(() => {
    if (typeof window === 'undefined') return 'Runtime';
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'Local';
    if (host.includes('vercel') || host.includes('pages.dev') || host.includes('workers.dev')) return 'Preview';
    return 'Deployed';
  }, []);

  const readinessTone = readiness?.ready
    ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]'
    : readiness
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';

  const readinessLabel = readiness
    ? readiness.ready
      ? `Ready · ${readiness.healthyProviders} healthy`
      : `${readiness.issues.length} issue${readiness.issues.length === 1 ? '' : 's'}`
    : 'No readiness data';

  const handleQuickJump = () => {
    const term = query.trim().toLowerCase();
    if (!term) return;
    const match = quickJumpItems.find((item) => item.label.toLowerCase().includes(term) || item.path.toLowerCase().includes(term));
    if (match) {
      navigate(match.path);
      setQuery('');
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const input = document.getElementById('header-quick-jump') as HTMLInputElement | null;
        input?.focus();
        input?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="h-[56px] flex items-center justify-between px-3.5 bg-white/80 backdrop-blur-xl border border-white/90 rounded-xl shadow-[0_4px_16px_-4px_rgba(15,23,42,0.05),inset_0_1px_0_#FFFFFF] shrink-0 select-none z-30 gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div 
          onClick={() => navigate('/')} 
          className="flex items-center gap-2.5 cursor-pointer group shrink-0"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FFF5ED] to-white border border-[#F48120]/30 shadow-2xs flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
            <CloudflareCloudLogo size={22} />
          </div>
          <div className="hidden sm:flex flex-col min-w-0">
            <h1 className="text-[15px] font-bold text-[#0F172A] tracking-tight leading-none truncate">
              Cloudflare AI Router
            </h1>
            <span className="text-[10px] text-[#64748B] mt-0.5 leading-none truncate">
              Secure AI traffic orchestration across the edge
            </span>
          </div>
        </div>

        <div className="relative hidden md:block min-w-0 flex-1 max-w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
          <input
            id="header-quick-jump"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleQuickJump();
            }}
            placeholder="Quick jump to a page..."
            className="w-full h-[30px] pl-9 pr-11 rounded-full border border-slate-200/80 bg-slate-100/80 text-[11.5px] text-[#0F172A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 shadow-2xs placeholder:text-slate-400 font-medium transition-all"
          />
          <button
            onClick={handleQuickJump}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-white/90 border border-slate-200 text-[9px] font-mono font-bold text-slate-500 shadow-2xs"
            title="Go to matching page"
          >
            ⌘K
          </button>
        </div>
      </div>

      <div className="hidden xl:flex items-center gap-1 bg-[#F1F5F9]/80 p-1 rounded-full border border-[#E2E8F0] shrink-0">
        {mainTabs.map(tab => {
          const isActive = tab.path === '/' 
            ? location.pathname === '/' 
            : location.pathname.startsWith(tab.path);
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`px-3 py-1 text-[11.5px] rounded-full transition-all cursor-pointer font-medium ${
                isActive
                  ? 'bg-white shadow-xs text-[#0051C3] font-bold border border-[#DCEBFA]'
                  : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white/50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-[11.5px] shrink-0">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh live data"
            className="p-1.5 text-[#64748B] hover:text-[#0051C3] transition-colors rounded-lg hover:bg-slate-100 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        )}

        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#DCEBFA] bg-white text-[#0F172A] font-semibold text-[11px] shadow-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
          <span>{environmentLabel}</span>
          <ChevronDown size={12} className="text-gray-500" />
        </div>

        <div className={`hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full border font-semibold text-[11px] shadow-2xs ${readinessTone}`}>
          <ShieldCheck size={12} />
          <span>{readinessLabel}</span>
        </div>

        <button
          onClick={() => navigate('/alerts')}
          className="relative cursor-pointer p-1.5 text-[#64748B] hover:text-[#0F172A] transition-colors rounded-lg hover:bg-slate-100"
          title={alerts.length ? `${alerts.length} active alerts` : 'No active alerts'}
        >
          <Bell size={16} />
          {alerts.length > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] bg-[#EF4444] text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-white px-0.5 shadow-2xs">
              {alerts.length > 99 ? '99+' : alerts.length}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 border-l border-[#E2E8F0] pl-2.5">
          <div className="w-7 h-7 rounded-full bg-[#1E293B] text-white flex items-center justify-center text-[10px] font-bold shadow-2xs">
            AI
          </div>
          <div className="hidden sm:flex flex-col text-left leading-tight">
            <span className="font-bold text-[#0F172A] text-[11px]">Admin UI</span>
            <span className="text-[9px] text-[#64748B]">Live backend data</span>
          </div>
        </div>
      </div>
    </header>
  );
};
