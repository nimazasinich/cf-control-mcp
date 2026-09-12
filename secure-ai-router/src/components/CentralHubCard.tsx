import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowUpRight, GitMerge, Radio, ShieldCheck } from 'lucide-react';
import { DashboardData } from '../types';
import { formatLatency, formatNumber } from '../utils/formatters';

interface CentralHubCardProps {
  data: DashboardData;
}

function readinessLabel(data: DashboardData): string {
  if (!data.readiness) return 'No readiness data';
  if (data.readiness.ready) return 'Ready';
  const issues = data.readiness.issues.length;
  return `${issues} issue${issues === 1 ? '' : 's'}`;
}

export const CentralHubCard: React.FC<CentralHubCardProps> = ({ data }) => {
  const navigate = useNavigate();
  const observedRequests = data.stats?.totalRequests ?? 0;
  const providerCount = data.readiness?.providerCount ?? data.providers.length;
  const healthyProviders = data.readiness?.healthyProviders ?? data.providers.filter((provider) => provider.status === 'Healthy').length;
  const alertCount = data.alerts?.length ?? 0;
  const averageLatency = data.stats?.avgLatency ?? data.analytics?.avgLatencyMs ?? 0;
  const readiness = readinessLabel(data);
  const modeLabel = observedRequests > 0 ? 'Observed traffic active' : providerCount > 0 ? 'Configured, waiting for traffic' : 'No providers configured';

  return (
    <div className="card-3d-glass p-3 flex flex-col justify-between min-h-0 overflow-hidden relative">
      <div className="absolute inset-x-6 top-6 h-20 rounded-full bg-[radial-gradient(circle,rgba(244,129,32,0.20),rgba(255,255,255,0))] blur-2xl pointer-events-none" />

      <div className="flex items-center justify-between gap-2 mb-2 shrink-0 relative z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-white to-orange-50 shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-white flex items-center justify-center text-orange-500 shrink-0">
            <Radio size={13} strokeWidth={2.3} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.08em] leading-tight">
              Central Control Hub
            </h3>
            <span className="text-[9.5px] text-slate-500 leading-none">Observed traffic, routing readiness, and operator posture</span>
          </div>
        </div>

        <button
          onClick={() => navigate('/topology')}
          className="text-[10px] text-[#0051C3] font-bold hover:underline cursor-pointer shrink-0"
          title="Open topology"
        >
          Topology →
        </button>
      </div>

      <div className="relative z-10 flex items-center justify-center py-1.5">
        <div className="hub-asset-shell">
          <div className="hub-orbit-ring hub-orbit-ring-a" />
          <div className="hub-orbit-ring hub-orbit-ring-b" />
          <div className="hub-halo-pulse" />
          <img
            src="/dashboard-hub.png"
            alt="Cloudflare Router central hub"
            className="hub-dashboard-image"
          />
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-2 text-[10px] mt-1.5">
        <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 min-w-0">
          <div className="flex items-center gap-1 text-slate-500"><GitMerge size={10} /> Observed Requests</div>
          <div className="mt-1 text-[13px] font-black text-slate-900 font-mono">{formatNumber(observedRequests)}</div>
          <div className="text-[9px] text-slate-500">{modeLabel}</div>
        </div>

        <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 min-w-0">
          <div className="flex items-center gap-1 text-slate-500"><ShieldCheck size={10} /> Readiness</div>
          <div className="mt-1 text-[13px] font-black text-slate-900">{readiness}</div>
          <div className="text-[9px] text-slate-500">{healthyProviders} healthy of {providerCount}</div>
        </div>

        <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 min-w-0">
          <div className="flex items-center gap-1 text-slate-500"><AlertTriangle size={10} /> Active Alerts</div>
          <div className="mt-1 text-[13px] font-black text-slate-900 font-mono">{formatNumber(alertCount)}</div>
          <div className="text-[9px] text-slate-500">{alertCount > 0 ? 'Requires operator review' : 'No active operational alerts'}</div>
        </div>

        <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 min-w-0">
          <div className="flex items-center gap-1 text-slate-500"><Activity size={10} /> Avg Latency</div>
          <div className="mt-1 text-[13px] font-black text-slate-900 font-mono">{formatLatency(averageLatency)}</div>
          <div className="text-[9px] text-slate-500">Observed routing performance</div>
        </div>
      </div>

      <div className="relative z-10 pt-2 mt-2 border-t border-slate-200/80 flex items-center justify-between gap-3 text-[10px]">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">Central orchestration surface</div>
          <div className="text-slate-500">Asset resized for dashboard use with subtle motion and glow.</div>
        </div>
        <button
          onClick={() => navigate('/routing')}
          className="shrink-0 text-[10px] font-bold text-[#0051C3] hover:underline flex items-center gap-0.5"
        >
          Review routing <ArrowUpRight size={10} />
        </button>
      </div>
    </div>
  );
};
