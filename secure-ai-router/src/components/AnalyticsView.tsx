import React, { useMemo } from 'react';
import { Activity, TrendingUp, DollarSign, Clock, Cpu, BarChart2 } from 'lucide-react';
import { DashboardData } from '../types';
import { formatNumber, formatLatency, formatBytes, formatCurrency } from '../utils/formatters';

interface AnalyticsViewProps {
  data: DashboardData;
}

function buildSeriesPath(points: Array<{ timestamp: number; count: number }>, width: number, height: number): { line: string; area: string } | null {
  if (!points.length) return null;
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const denominator = Math.max(1, points.length - 1);
  const coords = points.map((point, index) => {
    const x = (index / denominator) * width;
    const y = height - (point.count / maxCount) * (height - 16) - 8;
    return { x, y };
  });
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return { line, area };
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ data }) => {
  const analytics = data.analytics;
  const providerBuckets = analytics?.byProvider ?? [];
  const totalProviderRequests = providerBuckets.reduce((sum, provider) => sum + provider.count, 0);
  const series = analytics?.requestVolumeSeries ?? [];
  const path = useMemo(() => buildSeriesPath(series, 500, 160), [series]);
  const runtimeMemoryGb = data.runtime ? data.runtime.heapUsedMb / 1024 : analytics?.memoryUsage ?? 0;
  const memoryAllocated = data.runtime ? data.runtime.heapTotalMb / 1024 : analytics?.memoryAllocated && analytics.memoryAllocated > 0 ? analytics.memoryAllocated : 0;
  const memoryPercent = memoryAllocated ? Math.round((runtimeMemoryGb / memoryAllocated) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-y-auto pr-1">
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs">
              <Activity size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Platform Telemetry & Routing Analytics</h2>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Backend-derived throughput, provider allocation, token usage, and runtime resources.
          </p>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 shadow-2xs">
            Window: Past {analytics?.windowHours ?? 24} Hours
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 shrink-0">
        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#0051C3]"><TrendingUp size={14} /><span className="text-[10px] font-semibold text-[#64748B]">Observed</span></div>
          <div className="mt-2">
            <span className="text-[10px] text-[#64748B]">Total Requests</span>
            <div className="text-[18px] font-bold text-[#0F172A] font-mono">{formatNumber(analytics?.totalRequests ?? 0)}</div>
          </div>
        </div>
        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8B5CF6]"><Clock size={14} /><span className="text-[10px] font-semibold text-[#64748B]">Average</span></div>
          <div className="mt-2">
            <span className="text-[10px] text-[#64748B]">Latency</span>
            <div className="text-[18px] font-bold text-[#0F172A] font-mono">{formatLatency(analytics?.avgLatencyMs ?? data.stats?.avgLatency ?? 0)}</div>
          </div>
        </div>
        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#10B981]"><DollarSign size={14} /><span className="text-[10px] font-semibold text-[#64748B]">Actual</span></div>
          <div className="mt-2">
            <span className="text-[10px] text-[#64748B]">Estimated Cost</span>
            <div className="text-[18px] font-bold text-[#0F172A] font-mono">{formatCurrency(analytics?.estimatedCost ?? 0)}</div>
          </div>
        </div>
        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#F59E0B]"><Cpu size={14} /><span className="text-[10px] font-semibold text-[#64748B]">Runtime</span></div>
          <div className="mt-2">
            <span className="text-[10px] text-[#64748B]">Memory</span>
            <div className="text-[18px] font-bold text-[#0F172A] font-mono">{formatBytes(runtimeMemoryGb)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 flex-1 min-h-[320px]">
        <div className="lg:col-span-8 card-3d-glass p-3.5 sm:p-4 flex flex-col justify-between min-h-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-[13px] font-bold text-[#0F172A]">Inference Traffic Over Time</h3>
              <span className="text-[10px] text-[#64748B]">Request buckets from the real request log.</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-semibold text-[#0051C3]"><BarChart2 size={12} /> Volume</div>
          </div>
          <div className="relative flex-1 w-full flex items-center justify-center my-3 min-h-[160px] rounded-xl border border-[#E2E8F0] bg-white/60 overflow-hidden">
            {path ? (
              <svg className="w-full h-full min-h-[160px]" viewBox="0 0 500 160" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0051C3" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#0051C3" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="40" x2="500" y2="40" stroke="#E2E8F0" strokeDasharray="3 3" />
                <line x1="0" y1="80" x2="500" y2="80" stroke="#E2E8F0" strokeDasharray="3 3" />
                <line x1="0" y1="120" x2="500" y2="120" stroke="#E2E8F0" strokeDasharray="3 3" />
                <path d={path.area} fill="url(#reqGrad)" />
                <path d={path.line} fill="none" stroke="#0051C3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <div className="text-center text-[12px] text-[#64748B]">
                <div className="font-bold text-[#0F172A]">No request history yet</div>
                <div className="mt-1">The chart will appear after gateway traffic is recorded.</div>
              </div>
            )}
          </div>
          <div className="flex justify-between text-[9.5px] text-[#64748B] font-mono border-t border-[#E2E8F0] pt-1.5">
            <span>{series[0] ? new Date(series[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No data'}</span>
            <span>{series.length ? `${series.length} buckets` : '0 buckets'}</span>
            <span>Now</span>
          </div>
        </div>

        <div className="lg:col-span-4 card-3d-glass p-3.5 sm:p-4 flex flex-col justify-between min-h-0">
          <div>
            <h3 className="text-[13px] font-bold text-[#0F172A]">Provider Traffic Share</h3>
            <span className="text-[10px] text-[#64748B]">Only providers with observed routed calls are shown here.</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 my-3 pr-1">
            {providerBuckets.filter((provider) => provider.count > 0).map((provider) => {
              const share = totalProviderRequests ? Math.round((provider.count / totalProviderRequests) * 1000) / 10 : 0;
              return (
                <div key={provider.providerId ?? provider.providerName} className="flex flex-col gap-1">
                  <div className="flex justify-between gap-2 text-[11px] font-semibold text-[#0F172A]">
                    <span className="truncate min-w-0" title={provider.providerName}>{provider.providerName}</span>
                    <span className="font-mono text-[#64748B] shrink-0">{share}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                    <div className="h-full rounded-full bg-[#0051C3]" style={{ width: `${share}%` }} />
                  </div>
                  <div className="flex justify-between text-[9.5px] text-[#64748B] font-mono"><span>{provider.count} req</span><span>{formatLatency(provider.avgLatencyMs)}</span></div>
                </div>
              );
            })}
            {providerBuckets.filter((provider) => provider.count > 0).length === 0 && (
              <div className="rounded-xl border border-[#E2E8F0] bg-white/70 p-4 text-center text-[11px] text-[#64748B]">
                No observed provider traffic yet.
              </div>
            )}
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] text-[10.5px]">
            <div className="flex justify-between text-[#64748B]"><span>Prompt Tokens:</span><span className="font-bold text-[#0F172A] font-mono">{formatNumber(analytics?.tokensIn ?? 0)}</span></div>
            <div className="flex justify-between text-[#64748B] mt-1"><span>Completion Tokens:</span><span className="font-bold text-[#0F172A] font-mono">{formatNumber(analytics?.tokensOut ?? 0)}</span></div>
            <div className="flex justify-between text-[#64748B] mt-1"><span>Memory Pressure:</span><span className="font-bold text-[#0F172A] font-mono">{memoryPercent}%</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};
