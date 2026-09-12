import React from 'react';
import { GitMerge, Activity, Clock, DollarSign, Award, Shield, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { DashboardData } from '../types';
import { formatLatency } from '../utils/formatters';

interface RoutingRulesViewProps {
  data: DashboardData;
}

export const RoutingRulesView: React.FC<RoutingRulesViewProps> = ({ data }) => {
  // Compute live scores for all providers using the actual backend algorithm
  const providerScores = (data.providers || []).map(p => {
    const meta = (typeof p.metadata === 'object' && p.metadata !== null) ? p.metadata : {};
    const baseLatency = meta.baseLatency ?? 300;
    const costPer1k = meta.costPer1k ?? 0.002;
    const priority = p.priority ?? 1;

    // Health (40%)
    const healthScore = p.status === 'Healthy' ? 40 : (p.status === 'Degraded' ? 20 : 0);
    // Latency (25%)
    const latencyScore = Math.max(0, 25 - (baseLatency / 2000) * 25);
    // Cost (20%)
    const costScore = Math.max(0, 20 - (costPer1k / 0.05) * 20);
    // Capability (10%)
    const capabilityScore = 10;
    // Priority (5%)
    const priorityScore = Math.min(5, priority * 1);

    const totalScore = p.status === 'Offline' ? 0 : (healthScore + latencyScore + costScore + capabilityScore + priorityScore);

    return {
      provider: p,
      baseLatency,
      costPer1k,
      healthScore,
      latencyScore: Number(latencyScore.toFixed(1)),
      costScore: Number(costScore.toFixed(1)),
      capabilityScore,
      priorityScore,
      totalScore: Number(totalScore.toFixed(1)),
      isEligible: p.enabled && p.status !== 'Offline'
    };
  }).sort((a, b) => b.totalScore - a.totalScore);

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-y-auto pr-1">
      {/* Top Banner */}
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#8B5CF6]/10 text-[#8B5CF6] flex items-center justify-center border border-[#8B5CF6]/20 shadow-2xs">
              <GitMerge size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">
              Smart Routing Engine & Scoring Rules
            </h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-100 text-[#475569] font-mono border border-slate-200">
              Read-Only Engine Policy
            </span>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Cloudflare AI Router executes a deterministic 5-factor mathematical scoring model on every inference request.
          </p>
        </div>

        <div className="text-right">
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 shadow-2xs">
            Active Algorithm: Combined Multi-Factor v2.4
          </span>
        </div>
      </div>

      {/* 5-Factor Scoring Breakdown Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 shrink-0">
        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#10B981]">
            <Activity size={14} />
            <span className="text-[12px] font-bold font-mono">40%</span>
          </div>
          <div className="mt-2">
            <h4 className="text-[11px] font-bold text-[#0F172A]">Health & Status</h4>
            <p className="text-[9.5px] text-[#64748B] mt-0.5">
              Healthy: 40 pts • Degraded: 20 pts • Offline: Excluded
            </p>
          </div>
        </div>

        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8B5CF6]">
            <Clock size={14} />
            <span className="text-[12px] font-bold font-mono">25%</span>
          </div>
          <div className="mt-2">
            <h4 className="text-[11px] font-bold text-[#0F172A]">Network Latency</h4>
            <p className="text-[9.5px] text-[#64748B] mt-0.5">
              Max(0, 25 - (latency / 2000) * 25)
            </p>
          </div>
        </div>

        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#0051C3]">
            <DollarSign size={14} />
            <span className="text-[12px] font-bold font-mono">20%</span>
          </div>
          <div className="mt-2">
            <h4 className="text-[11px] font-bold text-[#0F172A]">Inference Cost</h4>
            <p className="text-[9.5px] text-[#64748B] mt-0.5">
              Max(0, 20 - (cost / 0.05) * 20)
            </p>
          </div>
        </div>

        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#F59E0B]">
            <Award size={14} />
            <span className="text-[12px] font-bold font-mono">10%</span>
          </div>
          <div className="mt-2">
            <h4 className="text-[11px] font-bold text-[#0F172A]">Capability Match</h4>
            <p className="text-[9.5px] text-[#64748B] mt-0.5">
              Chat, Vision, Reasoning, Code compatibility
            </p>
          </div>
        </div>

        <div className="card-3d-glass p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#06B6D4]">
            <Shield size={14} />
            <span className="text-[12px] font-bold font-mono">5%</span>
          </div>
          <div className="mt-2">
            <h4 className="text-[11px] font-bold text-[#0F172A]">Priority Tier</h4>
            <p className="text-[9.5px] text-[#64748B] mt-0.5">
              Min(5, priority * 1) tier tiebreaker
            </p>
          </div>
        </div>
      </div>

      {/* Live Provider Scoring & Selection Simulation Table */}
      <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col flex-1 min-h-[260px]">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <h3 className="text-[13px] font-bold text-[#0F172A]">
              Live Provider Scoring & Selection Ranking
            </h3>
            <span className="text-[10px] text-[#64748B]">
              Real-time calculations based on latest background health pings
            </span>
          </div>
          <span className="text-[10px] text-[#64748B] font-mono">
            Provider with highest score is selected for next request
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[#64748B] border-b border-[#E2E8F0] bg-slate-50/50">
              <tr>
                <th className="py-2 pl-2">Rank</th>
                <th className="py-2">Provider</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Health (40)</th>
                <th className="py-2 text-right">Latency (25)</th>
                <th className="py-2 text-right">Cost (20)</th>
                <th className="py-2 text-right">Caps (10)</th>
                <th className="py-2 text-right">Tier (5)</th>
                <th className="py-2 text-right pr-2 font-bold text-[#0F172A]">Total Score</th>
                <th className="py-2 text-center">Eligibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]/70">
              {providerScores.map((ps, idx) => {
                const isSelected = idx === 0 && ps.isEligible;
                return (
                  <tr key={ps.provider.id} className={`hover:bg-slate-50/80 transition-colors ${
                    isSelected ? 'bg-[#0051C3]/5' : ''
                  }`}>
                    <td className="py-2.5 pl-2 font-bold text-[#0F172A]">
                      #{idx + 1}
                    </td>
                    <td className="py-2.5">
                      <div className="font-bold text-[#0F172A] flex items-center gap-1.5">
                        {ps.provider.name}
                        {isSelected && (
                          <span className="px-1.5 py-0.2 rounded-full bg-[#0051C3] text-white text-[8.5px] font-semibold">
                            Primary Pick
                          </span>
                        )}
                      </div>
                      <span className="text-[9.5px] text-[#64748B] font-mono">{ps.provider.baseUrl}</span>
                    </td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold border ${
                        ps.provider.status === 'Healthy'
                          ? 'bg-[#10B981]/15 text-[#059669] border-[#10B981]/30'
                          : ps.provider.status === 'Degraded'
                          ? 'bg-[#F59E0B]/15 text-[#D97706] border-[#F59E0B]/30'
                          : 'bg-[#EF4444]/15 text-[#DC2626] border-[#EF4444]/30'
                      }`}>
                        {ps.provider.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-[#10B981] font-semibold">
                      +{ps.healthScore}
                    </td>
                    <td className="py-2.5 text-right font-mono text-[#8B5CF6]">
                      +{ps.latencyScore} <span className="text-[8.5px] text-[#64748B]">({formatLatency(ps.baseLatency)})</span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-[#0051C3]">
                      +{ps.costScore} <span className="text-[8.5px] text-[#64748B]">(${ps.costPer1k}/k)</span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-[#F59E0B]">
                      +{ps.capabilityScore}
                    </td>
                    <td className="py-2.5 text-right font-mono text-[#06B6D4]">
                      +{ps.priorityScore}
                    </td>
                    <td className="py-2.5 text-right pr-2 font-mono font-bold text-[12px] text-[#0F172A]">
                      {ps.totalScore} / 100
                    </td>
                    <td className="py-2.5 text-center">
                      {ps.isEligible ? (
                        <span className="text-[#059669] flex items-center justify-center gap-1 font-semibold text-[10px]">
                          <CheckCircle2 size={12} /> Active
                        </span>
                      ) : (
                        <span className="text-[#EF4444] flex items-center justify-center gap-1 font-semibold text-[10px]">
                          <AlertTriangle size={12} /> Excluded
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Routing Decision Examples from Logs */}
      <div className="card-3d-glass p-3.5 sm:p-4 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[12.5px] font-bold text-[#0F172A]">
            Recent Decision Audits (from SQLite logs)
          </h3>
          <span className="text-[10px] text-[#64748B]">Last 5 evaluated requests</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-[10.5px]">
          {data.history.slice(0, 5).map((h, i) => (
            <div key={h.id || i} className="p-2 rounded-lg bg-white/80 border border-[#E2E8F0] shadow-2xs">
              <div className="flex justify-between items-center text-[9px] text-[#64748B]">
                <span className="font-mono">#{h.id?.slice(0, 6) || i + 1}</span>
                <span className="font-mono font-semibold text-[#0F172A]">{h.latency}ms</span>
              </div>
              <div className="font-bold text-[#0F172A] mt-1 whitespace-nowrap">
                {h.selectedModel}
              </div>
              <div className="text-[9.5px] text-[#0051C3] font-semibold mt-0.5 whitespace-nowrap">
                {h.routingReason || 'Optimal score'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
