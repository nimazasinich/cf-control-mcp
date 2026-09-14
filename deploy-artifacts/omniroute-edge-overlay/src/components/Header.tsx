import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, CheckCircle2, ChevronDown, CircleHelp, LogOut, Search, UserRound } from 'lucide-react';
import { navItems } from './Sidebar';
import { ModalDialog, SourcePill } from './WorkspacePrimitives';
import { OmniRouteStatus, OperationalAlert, SystemReadiness } from '../types';
import { useAuth } from '../auth/AuthProvider';

interface HeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  readiness?: SystemReadiness | null;
  alerts?: OperationalAlert[] | null;
  omniRouteStatus?: OmniRouteStatus | null;
  environment?: string | null;
}

type HeaderMenu = 'environment' | 'health' | 'notifications' | 'account' | null;

const CloudflareMark = () => (
  <svg className="cf-brand-logo" viewBox="0 0 120 78" aria-hidden="true">
    <defs>
      <linearGradient id="cf-brand-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#F6821F" />
        <stop offset="100%" stopColor="#FAAE40" />
      </linearGradient>
    </defs>
    <path d="M96.4 34.6c-2.4-12.8-13.6-22.5-27-22.5-10.9 0-20.4 6.4-24.9 15.8-3.4-2.8-7.8-4.5-12.6-4.5-10.8 0-19.6 8.5-20.2 19.2C13.8 44.2 7 51.9 7 61.1 7 71.5 15.5 80 25.9 80h69.2c13.7 0 24.9-11.2 24.9-24.9 0-11.8-8.3-21.7-19.5-24-1.3 1.2-2.7 2.3-4.1 3.5z" fill="url(#cf-brand-grad)"/>
  </svg>
);

export const Header: React.FC<HeaderProps> = ({ readiness, alerts, omniRouteStatus, environment }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [menu, setMenu] = useState<HeaderMenu>(null);
  const { user, logout } = useAuth();

  const mainTabs = [
    { label: 'Overview', path: '/' },
    { label: 'Topology', path: '/topology' },
    { label: 'Security', path: '/firewall' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'Settings', path: '/settings' },
  ];

  const quickJumpItems = useMemo(() => {
    const merged = [...mainTabs, ...navItems.map(({ name, path }) => ({ label: name, path }))];
    return merged.filter((item, index) => merged.findIndex((candidate) => candidate.path === item.path) === index);
  }, []);

  const filteredCommands = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return quickJumpItems;
    return quickJumpItems.filter((item) => item.label.toLowerCase().includes(term) || item.path.toLowerCase().includes(term));
  }, [query, quickJumpItems]);

  const environmentLabel = environment?.trim()
    ? environment.trim().charAt(0).toUpperCase() + environment.trim().slice(1)
    : 'Environment Unknown';
  const alertCount = alerts?.length ?? 0;
  const systemHealthy = Boolean(readiness?.ready && omniRouteStatus?.configured && omniRouteStatus.reachable === true);
  const systemLabel = systemHealthy
    ? 'All Systems Healthy'
    : !omniRouteStatus?.configured
      ? 'OmniRoute Not Configured'
      : omniRouteStatus.reachable === false
        ? 'OmniRoute Unreachable'
        : 'Status Unknown';

  const handleQuickJump = (term: string = query) => {
    const normalized = term.trim().toLowerCase();
    if (!normalized) return;
    const match = quickJumpItems.find((item) => item.label.toLowerCase().includes(normalized) || item.path.toLowerCase() === normalized);
    if (match) {
      navigate(match.path);
      setQuery('');
      setCommandOpen(false);
      setMenu(null);
    }
  };

  const jump = (path: string) => {
    navigate(path);
    setQuery('');
    setCommandOpen(false);
    setMenu(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleMenu = (next: Exclude<HeaderMenu, null>) => setMenu((current) => current === next ? null : next);
  const initials = (user?.displayName || user?.email || 'A').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <>
      <header className="cf-global-header">
        <button className="cf-brand" onClick={() => jump('/')} aria-label="Cloudflare AI Router dashboard home">
          <CloudflareMark />
          <span className="cf-brand-copy">
            <strong>Cloudflare AI Router</strong>
            <small>Secure AI traffic orchestration across the edge</small>
          </span>
        </button>

        <button className="cf-header-search" type="button" onClick={() => setCommandOpen(true)} aria-label="Open Command palette">
          <Search size={14} />
          <span className="cf-header-search-copy">Search requests, profiles, providers, models, rules...</span>
          <kbd>⌘ K</kbd>
        </button>

        <nav className="cf-header-tabs" aria-label="Primary navigation">
          {mainTabs.map((tab) => {
            const active = tab.path === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.path);
            return <button key={tab.path} className={active ? 'active' : ''} onClick={() => jump(tab.path)}>{tab.label}</button>;
          })}
        </nav>

        <div className="cf-header-actions">
          <div className="relative">
            <button className="cf-environment-chip" type="button" onClick={() => toggleMenu('environment')} aria-expanded={menu === 'environment'}>{environmentLabel}<ChevronDown size={9} /></button>
            {menu === 'environment' ? <div className="cf-header-popover w-[260px] right-0"><strong>Environment</strong><p>Current application environment from the control plane.</p><div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px]"><div className="font-bold text-slate-800">{environmentLabel}</div><div className="mt-1 text-slate-500">Environment switching is not configured in this build.</div></div></div> : null}
          </div>

          <div className="relative">
            <button className={`cf-health-chip ${systemHealthy ? 'healthy' : 'unknown'}`} type="button" onClick={() => toggleMenu('health')} aria-expanded={menu === 'health'}><CheckCircle2 size={10}/>{systemLabel}</button>
            {menu === 'health' ? <div className="cf-header-popover w-[300px] right-0"><div className="flex items-center justify-between"><strong>System health</strong><SourcePill label={omniRouteStatus?.reachable === true ? 'LIVE · OMNIROUTE' : 'CONTROL PLANE'} tone={systemHealthy ? 'green' : 'amber'}/></div><div className="mt-2 grid gap-2 text-[9.5px]"><div className="flex justify-between"><span>Readiness</span><b>{readiness?.ready === true ? 'Ready' : readiness ? 'Needs attention' : 'Unknown'}</b></div><div className="flex justify-between"><span>OmniRoute</span><b>{omniRouteStatus?.reachable === true ? 'Reachable' : omniRouteStatus?.reachable === false ? 'Unreachable' : omniRouteStatus?.configured ? 'Unknown' : 'Not configured'}</b></div><div className="flex justify-between"><span>Probe latency</span><b>{omniRouteStatus?.latencyMs != null ? `${omniRouteStatus.latencyMs} ms` : '—'}</b></div></div><button className="mt-3 text-[9.5px] font-bold text-blue-700" onClick={() => jump('/settings')}>Open diagnostics →</button></div> : null}
          </div>

          <div className="relative">
            <button className="cf-bell" onClick={() => toggleMenu('notifications')} aria-label="Notifications" aria-expanded={menu === 'notifications'}><Bell size={15}/>{alertCount > 0 ? <span>{alertCount > 99 ? '99+' : alertCount}</span> : null}</button>
            {menu === 'notifications' ? <div className="cf-header-popover w-[340px] right-0"><div className="flex items-center justify-between"><strong>Notifications</strong><button className="text-[9px] font-bold text-blue-700" onClick={() => jump('/alerts')}>View all</button></div><div className="mt-2 grid gap-1.5">{alerts?.slice(0,4).map((alert) => <button key={alert.id} onClick={() => jump('/alerts')} className="rounded-lg border border-slate-200 p-2 text-left hover:bg-slate-50"><div className="flex items-center gap-2"><span className="text-[9px] font-bold uppercase text-slate-500">{alert.severity}</span><span className="truncate text-[10px] font-bold text-slate-800">{alert.title}</span></div><p className="mt-1 line-clamp-2 text-[9px] text-slate-500">{alert.detail}</p></button>)}{!alerts?.length ? <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-[9.5px] text-slate-500">No observed alerts in the current response.</div> : null}</div></div> : null}
          </div>

          <div className="relative">
            <button className="cf-user" type="button" onClick={() => toggleMenu('account')} aria-expanded={menu === 'account'}><div className="cf-avatar">{initials}</div><span><strong>{user?.displayName || 'Administrator'}</strong><small>{user?.role || 'authenticated'}</small></span><ChevronDown size={9}/></button>
            {menu === 'account' ? <div className="cf-header-popover w-[270px] right-0"><div className="flex items-center gap-2"><UserRound size={16} className="text-blue-600"/><div className="min-w-0"><span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Account</span><strong className="block">{user?.displayName || 'Administrator'}</strong><p className="truncate">{user?.email || 'Authenticated session'}</p></div></div><div className="mt-2 rounded-lg bg-slate-50 p-2 text-[9.5px] text-slate-500">Session-backed browser authentication · {user?.loginMethod || 'authenticated'}</div><button type="button" onClick={async()=>{ setMenu(null); await logout(); navigate('/signin', { replace: true }); }} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-700"><LogOut size={13}/>Sign out</button></div> : null}
          </div>
        </div>
      </header>

      <ModalDialog open={commandOpen} onClose={() => setCommandOpen(false)} title="Command palette" description="Navigate to a workspace. Search does not imply a backend data search." size="md">
        <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3"><Search size={15} className="text-slate-400"/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 outline-none text-[12px]" placeholder="Search requests, profiles, providers, models, rules..." onKeyDown={(event) => { if (event.key === 'Enter') handleQuickJump(); }}/></label>
        <div className="mt-3 grid gap-1">
          {filteredCommands.map((item) => <button key={item.path} onClick={() => jump(item.path)} className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] hover:bg-blue-50"><span className="font-semibold text-slate-800">{item.label}</span><span className="font-mono text-[9px] text-slate-400">{item.path}</span></button>)}
          {!filteredCommands.length ? <div className="py-8 text-center text-[10px] text-slate-500"><CircleHelp size={18} className="mx-auto mb-2"/>No matching workspace.</div> : null}
        </div>
      </ModalDialog>
    </>
  );
};
