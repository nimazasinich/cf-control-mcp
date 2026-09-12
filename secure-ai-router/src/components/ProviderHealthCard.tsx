import React, { useState } from 'react';
import { Activity, Cloud, Search, Sliders, ArrowUpRight } from 'lucide-react';
import { Provider } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatLatency, formatCurrency, safeParseMetadata, isEnabledFlag } from '../utils/formatters';

interface ProviderHealthCardProps {
  providers: Provider[];
  onConfigureProvider?: (provider: Provider) => void;
  onManageClick?: () => void;
  className?: string;
}

export const ProviderHealthCard: React.FC<ProviderHealthCardProps> = ({
  providers = [],
  onConfigureProvider,
  onManageClick,
  className = ''
}) => {
  const [filter, setFilter] = useState('');

  const filtered = providers.filter(p => {
    if (!filter) return true;
    const t = filter.toLowerCase();
    return p.name?.toLowerCase().includes(t) || p.baseUrl?.toLowerCase().includes(t);
  });

  return (
    <div 
      className={`card-3d-glass p-3 sm:p-3.5 flex flex-col justify-between overflow-hidden h-full select-none ${className}`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 mb-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-white to-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-white flex items-center justify-center text-emerald-600 shrink-0">
            <Activity size={13} strokeWidth={2.3} />
          </div>
          <div>
            <h3 className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.08em] leading-tight">
              AI Provider Health & SLAs
            </h3>
            <span className="text-[9.5px] text-slate-500 leading-none">
              Registered providers ({providers.length} total)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="bg-white border border-slate-200 rounded-full pl-6 pr-2 py-0.5 text-[10px] text-slate-800 outline-none shadow-xs placeholder:text-gray-400 w-20 focus:border-blue-600"
            />
          </div>

          <button
            onClick={onManageClick}
            className="text-[10.5px] text-[#0051C3] font-bold hover:underline cursor-pointer whitespace-nowrap"
          >
            View details →
          </button>
        </div>
      </div>

      {/* Scrollable Provider Rows */}
      <div className="flex-1 overflow-x-auto overflow-y-auto border border-slate-200/80 rounded-xl bg-white/70 min-h-0">
        <table className="w-full text-left text-[11.5px] border-collapse min-w-[340px]">
          <thead className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider bg-slate-50/90 border-b border-slate-200 sticky top-0 backdrop-blur z-10">
            <tr>
              <th className="py-1 px-2.5">Provider</th>
              <th className="py-1 px-2">Status</th>
              <th className="py-1 px-2 text-right">Latency</th>
              <th className="py-1 px-2 text-center w-[60px]">Traffic</th>
              <th className="py-1 px-2 text-right">Cost/1K</th>
              <th className="py-1 px-2.5 text-right w-[50px]">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 font-medium text-slate-700">
            {filtered.map((p, idx) => {
              const meta = safeParseMetadata(p.metadata);
              const isEnabled = isEnabledFlag(p.enabled);
              const isHealthy = isEnabled && (p.status === 'Healthy' || p.status === 'healthy');
              const isDegraded = isEnabled && (p.status === 'Degraded' || p.status === 'degraded');
              const statusLabel = !isEnabled ? 'Disabled' : isHealthy ? 'Healthy' : isDegraded ? 'Degraded' : 'Offline';

              const latency = Number(meta.baseLatency ?? 0);
              const trafficShare = Number(meta.trafficShare ?? 0);
              const costPer1k = Number(meta.costPer1k ?? 0);

              return (
                <tr 
                  key={p.id || idx} 
                  className="hover:bg-slate-50/80 transition-colors group cursor-default"
                >
                  <td className="py-1 px-2.5 font-semibold text-slate-900 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4.5 h-4.5 rounded bg-white border border-slate-200 shadow-2xs flex items-center justify-center font-bold text-[8.5px] text-[#0051C3] shrink-0">
                        {p.name?.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-[11px]">{p.name}</span>
                    </div>
                  </td>

                  <td className="py-1 px-2 whitespace-nowrap">
                    <StatusBadge status={statusLabel} size="sm" showPulse={isHealthy} />
                  </td>

                  <td className="py-1 px-2 text-right font-mono text-slate-900 whitespace-nowrap font-medium text-[10.5px]">
                    {formatLatency(latency)}
                  </td>

                  <td className="py-1 px-2 text-center whitespace-nowrap">
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden border border-slate-200">
                      <div 
                        className="bg-[#0051C3] h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(5, trafficShare))}%` }}
                      />
                    </div>
                  </td>

                  <td className="py-1 px-2 text-right font-mono text-slate-500 whitespace-nowrap text-[10.5px]">
                    {formatCurrency(costPer1k)}
                  </td>

                  <td className="py-1 px-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => onConfigureProvider?.(p)}
                      className="p-0.5 rounded text-[#0051C3] hover:bg-[#0051C3]/10 font-semibold text-[10.5px] transition-colors cursor-pointer"
                      title={`Configure ${p.name}`}
                    >
                      <Sliders size={11} className="inline mr-0.5" />
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-500 text-[11px]">
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
