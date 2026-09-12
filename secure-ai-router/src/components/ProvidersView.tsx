import React, { useState } from 'react';
import { Database, Search, RefreshCw, Cloud, Sliders, Check, ToggleLeft, ToggleRight } from 'lucide-react';
import { Provider } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatLatency, formatCurrency, safeParseMetadata, isEnabledFlag } from '../utils/formatters';
import { fetchAdmin } from '../auth/adminAuth';

interface ProvidersViewProps {
  providers: Provider[];
  onRefresh: () => void;
  onEditProvider: (provider: Provider) => void;
}

export const ProvidersSection: React.FC<ProvidersViewProps> = ({
  providers = [],
  onRefresh,
  onEditProvider
}) => {
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<'all' | 'healthy' | 'degraded' | 'offline'>('all');
  const [pinging, setPinging] = useState(false);
  const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);

  const handlePingAll = async () => {
    setPinging(true);
    try {
      await fetchAdmin('/api/admin/providers/ping', { method: 'POST' });
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setPinging(false);
    }
  };

  const handleQuickToggle = async (p: Provider) => {
    setToggleLoadingId(p.id);
    const newEnabled = !isEnabledFlag(p.enabled);
    try {
      await fetchAdmin(`/api/admin/providers/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: newEnabled
        })
      });
      onRefresh();
    } catch (e) {
      console.error('Failed to toggle provider:', e);
    } finally {
      setToggleLoadingId(null);
    }
  };

  const filtered = providers.filter(p => {
    if (statusTab !== 'all') {
      const isEnabled = isEnabledFlag(p.enabled);
      const isHealthy = isEnabled && (p.status === 'Healthy' || p.status === 'healthy');
      const isDegraded = isEnabled && (p.status === 'Degraded' || p.status === 'degraded');
      const isOffline = !isEnabled || p.status === 'Offline' || p.status === 'offline';

      if (statusTab === 'healthy' && !isHealthy) return false;
      if (statusTab === 'degraded' && !isDegraded) return false;
      if (statusTab === 'offline' && !isOffline) return false;
    }
    if (!search) return true;
    const t = search.toLowerCase();
    return p.name?.toLowerCase().includes(t) || p.baseUrl?.toLowerCase().includes(t);
  });

  return (
    <div 
      className="card-3d-glass p-3.5 sm:p-4 flex flex-col justify-between overflow-hidden h-full select-none"
    >
      {/* View Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#E0F2FE] text-[#0051C3] flex items-center justify-center border border-[#BAE6FD] shadow-2xs shrink-0">
            <Database size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] leading-tight">
              Connected AI Providers & Routing Endpoints
            </h2>
            <p className="text-[12px] text-[#64748B]">
              Configure upstream models, fallback priorities, operational states, and automated health checks.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search providers..."
              className="bg-white border border-[#DCEBFA] rounded-full pl-8 pr-3 py-1.5 text-[12px] text-[#0F172A] outline-none shadow-2xs placeholder:text-gray-400 w-44 sm:w-52 focus:border-[#0051C3]"
            />
          </div>

          <button
            onClick={handlePingAll}
            disabled={pinging}
            className="flex items-center px-4 py-1.5 rounded-full bg-[#0051C3] text-white hover:bg-[#003E99] text-[12px] font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={`mr-1.5 ${pinging ? 'animate-spin' : ''}`} />
            {pinging ? 'Probing Endpoints...' : 'Ping All Now'}
          </button>
        </div>
      </div>

      {/* Secondary Tabs */}
      <div className="flex items-center gap-1.5 mb-3 border-b border-[#E2E8F0] pb-2 text-[11.5px]">
        {(['all', 'healthy', 'degraded', 'offline'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setStatusTab(tab)}
            className={`px-3 py-1 rounded-full font-bold capitalize transition-all cursor-pointer shadow-2xs ${
              statusTab === tab
                ? 'bg-[#0051C3] text-white border border-[#0051C3]'
                : 'bg-white text-[#64748B] hover:text-[#0F172A] hover:bg-slate-50 border border-[#DCEBFA]'
            }`}
          >
            {tab === 'all' ? `All Providers (${providers.length})` : tab}
          </button>
        ))}
      </div>

      {/* Providers Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto border border-[#E2E8F0] rounded-xl bg-white/70">
        <table className="w-full text-left text-[12px] border-collapse min-w-[750px]">
          <thead className="text-[#64748B] bg-white/95 border-b border-[#E2E8F0] sticky top-0 backdrop-blur z-10 text-[11px] uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-2.5 px-4 font-semibold">Provider</th>
              <th className="py-2.5 px-3 font-semibold">Base URL</th>
              <th className="py-2.5 px-3 font-semibold text-center w-[90px]">Priority</th>
              <th className="py-2.5 px-3 font-semibold text-center w-[110px]">Enabled</th>
              <th className="py-2.5 px-3 font-semibold text-center w-[110px]">Health Status</th>
              <th className="py-2.5 px-3 font-semibold text-right w-[90px]">Latency</th>
              <th className="py-2.5 px-3 font-semibold text-right w-[90px]">Cost / 1K</th>
              <th className="py-2.5 px-4 font-semibold text-right w-[80px]">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0]/70">
            {filtered.map((p, idx) => {
              const meta = safeParseMetadata(p.metadata);
              const isEnabled = isEnabledFlag(p.enabled);
              const isHealthy = isEnabled && (p.status === 'Healthy' || p.status === 'healthy');
              const isDegraded = isEnabled && (p.status === 'Degraded' || p.status === 'degraded');
              const statusLabel = isHealthy ? 'Healthy' : isDegraded ? 'Degraded' : 'Offline';

              return (
                <tr 
                  key={p.id || idx} 
                  className="hover:bg-slate-50/80 transition-colors group cursor-default"
                >
                  <td className="py-3 px-4 font-semibold text-[#0F172A] whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-white border border-[#DCEBFA] shadow-2xs flex items-center justify-center font-bold text-[10px] text-[#0051C3] shrink-0">
                        <Cloud size={14} />
                      </div>
                      <div>
                        <div className="font-bold text-[#0F172A] text-[13px]">{p.name}</div>
                        <div className="text-[10px] text-[#64748B] font-mono">ID: {p.id}</div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-3 font-mono text-[11px] text-[#64748B] whitespace-nowrap" title={p.baseUrl}>
                    {p.baseUrl}
                  </td>

                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    <span className="px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[#0F172A] font-mono text-[11px] font-bold">
                      Priority {p.priority ?? 1}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    <button
                      onClick={() => handleQuickToggle(p)}
                      disabled={toggleLoadingId === p.id}
                      className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
                        isEnabled 
                          ? 'bg-[#10B981]/15 text-[#059669] border border-[#10B981]/40' 
                          : 'bg-slate-100 text-slate-500 border border-slate-300'
                      }`}
                    >
                      {toggleLoadingId === p.id ? (
                        'Saving...'
                      ) : isEnabled ? (
                        <>
                          <ToggleRight size={14} className="mr-1" />
                          Enabled
                        </>
                      ) : (
                        <>
                          <ToggleLeft size={14} className="mr-1" />
                          Disabled
                        </>
                      )}
                    </button>
                  </td>

                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    <StatusBadge status={statusLabel} size="md" showPulse={isHealthy} />
                  </td>

                  <td className="py-3 px-3 text-right font-mono text-[#0F172A] font-semibold whitespace-nowrap">
                    {formatLatency(Number(meta.baseLatency ?? 0))}
                  </td>

                  <td className="py-3 px-3 text-right font-mono text-[#64748B] whitespace-nowrap">
                    {formatCurrency(Number(meta.costPer1k ?? 0))}
                  </td>

                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      onClick={() => onEditProvider(p)}
                      className="px-2.5 py-1 rounded-lg border border-[#DCEBFA] bg-white text-[#0051C3] hover:bg-[#0051C3]/5 text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                    >
                      <Sliders size={12} className="inline mr-1" />
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[#64748B] text-[13px]">
                  No matching providers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
