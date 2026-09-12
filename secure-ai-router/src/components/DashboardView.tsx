import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, Box, Clock, ShieldAlert, Cpu, Activity,
  Database, Shield, ArrowUpRight, ArrowDownRight, ChevronDown
} from 'lucide-react';
import { DashboardData, Provider } from '../types';
import { formatNumber, formatLatency, formatBytes, formatExactNumber, formatRelativeTime } from '../utils/formatters';
import { KpiCard } from './KpiCard';
import { TopologyMap } from './TopologyMap';
import { RecentDecisionsTable } from './RecentDecisionsTable';
import { ProviderHealthCard } from './ProviderHealthCard';
import { GlobalEdgeTrafficCard } from './GlobalEdgeTrafficCard';
import { CentralHubCard } from './CentralHubCard';

interface DashboardViewProps {
  data: DashboardData;
  onOpenEditModal: (provider: Provider) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ data, onOpenEditModal }) => {
  const navigate = useNavigate();
  const memoryUsage = data.runtime ? data.runtime.heapUsedMb / 1024 : data.analytics?.memoryUsage ?? 0;
  const memoryAllocated = data.runtime ? data.runtime.heapTotalMb / 1024 : data.analytics?.memoryAllocated && data.analytics.memoryAllocated > 0 ? data.analytics.memoryAllocated : 0;
  const memoryPercent = memoryAllocated ? Math.round((memoryUsage / memoryAllocated) * 100) : 0;
  const networkHealth = data.readiness
    ? data.readiness.ready
      ? 'Ready'
      : `${data.readiness.issues.length} issue${data.readiness.issues.length === 1 ? '' : 's'}`
    : 'No data';
  const cpuUsage = data.analytics?.cpuUsage ?? 0;
  const requestsPerSec = data.analytics?.requestsPerSec ?? 0;
  const avgExecution = data.analytics?.avgExecution ?? data.analytics?.avgLatencyMs ?? data.stats?.avgLatency ?? 0;
  const cpuTrend = data.analytics?.cpuTrend ?? 0;
  const requestsTrend = data.analytics?.requestsTrend ?? 0;
  const executionTrend = data.analytics?.executionTrend ?? 0;
  const firewallEvents = data.securityEvents.slice(0, 4);

  return (
    <div className="flex flex-col gap-2.5 sm:gap-3 w-full min-w-0 select-none pb-2">
      {/* 1. TOP KPI ROW - 6 3D Frosted Glass Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3 w-full shrink-0">
        <KpiCard
          title="Total AI Requests"
          value={data.stats ? formatNumber(data.stats.totalRequests) : "Loading"}
          rawExactValue={data.stats ? formatExactNumber(data.stats.totalRequests) : "Loading"}
          trend={data.stats ? "Observed window" : "Loading"}
          trendType="positive"
          subtitle="Across all applications"
          icon={FileText}
          iconColor="#0284C7"
          iconBg="#E0F2FE"
        />

        <KpiCard
          title="Active Providers"
          value={data.stats ? `${Math.max(0, data.stats.activeProviders - data.stats.degradedProviders - data.stats.offlineProviders)} / ${data.stats.activeProviders}` : "Loading"}
          rawExactValue={data.stats ? `${data.stats.activeProviders} registered` : "Loading"}
          trend={data.stats ? `${data.stats.degradedProviders} degraded · ${data.stats.offlineProviders} offline` : "Loading"}
          trendType="positive"
          subtitle={data.stats ? `${data.stats.degradedProviders} degraded · ${data.stats.offlineProviders} offline` : "No data yet"}
          icon={Box}
          iconColor="#10B981"
          iconBg="#ECFDF5"
        />

        <KpiCard
          title="Avg Latency"
          value={data.stats ? formatLatency(data.stats.avgLatency) : "Loading"}
          rawExactValue={data.stats ? `${data.stats.avgLatency} ms` : "Loading"}
          trend={data.stats ? "Observed average" : "Loading"}
          trendType="positive"
          subtitle="Global median response time"
          icon={Clock}
          iconColor="#9333EA"
          iconBg="#F3E8FF"
        />

        <KpiCard
          title="Blocked Threats"
          value={data.stats ? formatNumber(data.stats.blockedThreats) : "Loading"}
          rawExactValue={data.stats ? formatExactNumber(data.stats.blockedThreats) : "Loading"}
          trend="Observed window"
          trendType="negative"
          subtitle="Malicious requests blocked"
          icon={ShieldAlert}
          iconColor="#EF4444"
          iconBg="#FEF2F2"
        />

        <KpiCard
          title="Runtime Memory"
          value={data.runtime || data.analytics ? formatBytes(memoryUsage) : "Loading"}
          rawExactValue={data.runtime || data.analytics ? `${memoryUsage.toFixed(2)} GB` : "Loading"}
          progressPercent={memoryPercent}
          subtitle={memoryAllocated ? `of ${memoryAllocated.toFixed(1)} GB allocated` : 'Runtime not available'}
          icon={Cpu}
          iconColor="#0284C7"
          iconBg="#E0F2FE"
        />

        <KpiCard
          title="Network Health"
          value={networkHealth}
          trend={data.readiness ? `${data.readiness.healthyProviders} healthy · ${data.readiness.offlineProviders} offline` : 'Loading'}
          trendType={data.readiness?.ready ? "positive" : "negative"}
          subtitle="Control plane readiness"
          icon={Activity}
          iconColor="#10B981"
          iconBg="#ECFDF5"
        />
      </section>

      {/* 2. MIDDLE ROW: TOPOLOGY & RUNTIME/FIREWALL PANELS */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-2.5 sm:gap-3 w-full min-h-[380px] lg:min-h-[410px]">
        {/* Topology Canvas */}
        <div className="xl:col-span-8 flex flex-col min-w-0 h-full min-h-[380px] relative">
          <TopologyMap data={data} onSelectProvider={onOpenEditModal} />
        </div>

        {/* Resources Panel */}
        <div className="xl:col-span-4 flex flex-col gap-2.5 sm:gap-3 min-w-0 h-full min-h-[380px]">
          
          {/* Central Hub Card */}
          <div className="flex-1 min-h-0">
            <CentralHubCard data={data} />
          </div>

          {/* AI Firewall Activity Card */}
          <div className="card-3d-glass p-3 flex flex-col justify-between flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-white to-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-white flex items-center justify-center text-rose-600">
                  <Shield size={13} strokeWidth={2.3} />
                </div>
                <div>
                  <h3 className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.08em] leading-tight">
                    AI Firewall Activity
                  </h3>
                  <span className="text-[9.5px] text-slate-500 leading-none">Live threat detection log</span>
                </div>
              </div>

              <span 
                onClick={() => navigate('/firewall')} 
                className="text-[10.5px] text-[#0051C3] font-bold hover:underline cursor-pointer"
              >
                View all →
              </span>
            </div>

            <div className="flex-1 overflow-y-auto pr-0.5 min-h-0">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-200/80 sticky top-0 bg-white/95">
                  <tr>
                    <th className="pb-1 pl-1">Time</th>
                    <th className="pb-1">Event</th>
                    <th className="pb-1">Source</th>
                    <th className="pb-1 text-right pr-1">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {firewallEvents.map((event, idx) => {
                    const severityTone = event.severity === 'Critical'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : event.severity === 'High'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : event.severity === 'Medium'
                          ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200';

                    return (
                      <tr key={event.id || idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-1 pl-1 text-[10px] text-slate-500 whitespace-nowrap">{formatRelativeTime(event.timestamp)}</td>
                        <td className="py-1 text-[11px] font-semibold text-slate-900">
                          {event.eventType.replaceAll('_', ' ')}
                        </td>
                        <td className="py-1 font-mono text-[9.5px] text-slate-500">{event.sourceIp || 'Unknown'}</td>
                        <td className="py-1 text-right pr-1">
                          <span className={`px-2 py-0.5 rounded-md text-[9.5px] font-extrabold shadow-xs border inline-block ${severityTone}`}>
                            {event.severity}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  {firewallEvents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-[10.5px] text-slate-500">
                        No security events recorded in the current dataset.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </section>

      {/* 3. BOTTOM ROW: RECENT ROUTING DECISIONS & PROVIDER HEALTH & GLOBAL EDGE TRAFFIC */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-2.5 sm:gap-3 w-full min-h-[240px]">
        {/* Recent Routing Decisions Table */}
        <div className="md:col-span-1 xl:col-span-5 min-w-0 h-[240px]">
          <RecentDecisionsTable history={data.history} />
        </div>

        {/* Provider Health Card */}
        <div className="md:col-span-1 xl:col-span-4 min-w-0 h-[240px]">
          <ProviderHealthCard 
            providers={data.providers} 
            onConfigureProvider={onOpenEditModal}
            onManageClick={() => navigate('/providers')}
          />
        </div>

        {/* Global Edge Traffic Card */}
        <div className="md:col-span-2 xl:col-span-3 min-w-0 h-[240px]">
          <GlobalEdgeTrafficCard 
            totalRequests={data.stats ? formatNumber(data.stats.totalRequests) : "No data"}
          />
        </div>
      </section>
    </div>
  );
};
