import React, { useState } from 'react';
import { Box, Search, Cloud, Sliders } from 'lucide-react';
import { Provider, Model } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatLatency, formatCurrency, safeParseMetadata, isEnabledFlag } from '../utils/formatters';

interface ModelsViewProps {
  providers: Provider[];
  models?: Model[];
  onConfigureProvider?: (provider: Provider) => void;
}

export const Models: React.FC<ModelsViewProps> = ({
  providers = [],
  models = [],
  onConfigureProvider
}) => {
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('ALL');

  const filteredProviders = providers.filter(p => {
    const term = search.toLowerCase();
    const matchesSearch = !term || 
      p.name?.toLowerCase().includes(term) || 
      p.baseUrl?.toLowerCase().includes(term);

    if (!matchesSearch) return false;

    const isEnabled = isEnabledFlag(p.enabled);
    const isHealthy = isEnabled && (p.status === 'Healthy' || p.status === 'healthy');
    const isDegraded = isEnabled && (p.status === 'Degraded' || p.status === 'degraded');
    const isOffline = !isEnabled || p.status === 'Offline' || p.status === 'offline' || p.status === 'Disabled';

    if (healthFilter === 'Healthy') return isHealthy;
    if (healthFilter === 'Degraded') return isDegraded;
    if (healthFilter === 'Offline') return isOffline;
    return true;
  });

  return (
    <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col justify-between overflow-hidden h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs shrink-0">
            <Box size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] leading-tight">
              AI Models & Provider Catalog
            </h2>
            <p className="text-[12px] text-[#64748B]">
              Active health telemetry and operational routing across unified model endpoints.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Health status filter */}
          <select
            value={healthFilter}
            onChange={e => setHealthFilter(e.target.value)}
            className="bg-white border border-[#DCEBFA] rounded-lg px-2.5 py-1.5 text-[12px] text-[#475569] outline-none shadow-2xs font-medium cursor-pointer"
          >
            <option value="ALL">All Health States</option>
            <option value="Healthy">Healthy Only (Green)</option>
            <option value="Degraded">Degraded Only (Yellow)</option>
            <option value="Offline">Disabled / Offline (Red)</option>
          </select>

          {/* Search box */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search providers or models..."
              className="bg-white border border-[#DCEBFA] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#0F172A] outline-none shadow-2xs placeholder:text-gray-400 w-48 sm:w-56 focus:border-[#0051C3]"
            />
          </div>
        </div>
      </div>

      {/* Models & Providers Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto border border-[#E2E8F0] rounded-xl bg-white/70">
        <table className="w-full text-left text-[12px] border-collapse min-w-[700px]">
          <thead className="text-[#64748B] bg-white/95 border-b border-[#E2E8F0] sticky top-0 backdrop-blur z-10 text-[11px] uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-2.5 px-4 font-semibold">Provider</th>
              <th className="py-2.5 px-3 font-semibold">Supported Model(s)</th>
              <th className="py-2.5 px-3 font-semibold">Base URL / Endpoint</th>
              <th className="py-2.5 px-3 font-semibold text-center w-[80px]">Priority</th>
              <th className="py-2.5 px-3 font-semibold text-right w-[90px]">Latency</th>
              <th className="py-2.5 px-3 font-semibold text-right w-[90px]">Cost / 1K</th>
              <th className="py-2.5 px-3 font-semibold text-center w-[110px]">Health</th>
              <th className="py-2.5 px-4 font-semibold text-right w-[80px]">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0]/70">
            {filteredProviders.map((p, idx) => {
              const meta = safeParseMetadata(p.metadata);
              const isEnabled = isEnabledFlag(p.enabled);
              const isHealthy = isEnabled && (p.status === 'Healthy' || p.status === 'healthy');
              const isDegraded = isEnabled && (p.status === 'Degraded' || p.status === 'degraded');
              const isOffline = !isEnabled || p.status === 'Offline' || p.status === 'offline' || p.status === 'Disabled';

              // Map models for this provider
              const provModels = models.filter(m => m.providerId === p.id);
              const modelNames = provModels.length > 0
                ? provModels.map(m => m.name || m.modelName || m.id).join(', ')
                : 'No models registered';

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

                  <td className="py-3 px-3 font-medium text-[#0F172A] whitespace-nowrap" title={modelNames}>
                    <div className="flex items-center gap-1.5">
                      <Box size={13} className="text-[#0051C3] shrink-0" />
                      <span className="whitespace-nowrap">{modelNames}</span>
                    </div>
                  </td>

                  <td className="py-3 px-3 font-mono text-[11px] text-[#64748B] whitespace-nowrap" title={p.baseUrl}>
                    {p.baseUrl}
                  </td>

                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[#0F172A] font-mono text-[11px] font-bold">
                      Priority {p.priority ?? 1}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-right font-mono text-[#0F172A] font-semibold whitespace-nowrap">
                    {formatLatency(Number(meta.baseLatency ?? 0))}
                  </td>

                  <td className="py-3 px-3 text-right font-mono text-[#64748B] whitespace-nowrap">
                    {formatCurrency(Number(meta.costPer1k ?? 0))}
                  </td>

                  {/* Health status indicator column using CSS classes to color-code the state: Green for 'Healthy', Yellow for 'Degraded', and Red for 'Disabled/Offline' */}
                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    {isHealthy ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#10B981]/15 text-[#059669] border border-[#10B981]/30 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] mr-1.5 animate-pulse" />
                        Healthy
                      </span>
                    ) : isDegraded ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#F59E0B]/15 text-[#D97706] border border-[#F59E0B]/30 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mr-1.5" />
                        Degraded
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#EF4444]/15 text-[#DC2626] border border-[#EF4444]/30 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] mr-1.5" />
                        Disabled/Offline
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      onClick={() => onConfigureProvider?.(p)}
                      className="px-2.5 py-1 rounded-lg border border-[#DCEBFA] bg-white text-[#0051C3] hover:bg-[#0051C3]/5 text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                    >
                      <Sliders size={12} className="inline mr-1" />
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredProviders.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[#64748B] text-[13px]">
                  No matching providers or models found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
