import React, { useState, useMemo } from 'react';
import { 
  Share2, Filter, RefreshCw, Layers, ShieldCheck, Zap, Server, 
  Activity, CheckCircle2, AlertTriangle, XCircle, ChevronRight,
  Info, Cpu, ArrowUpRight, Globe, Lock, ExternalLink
} from 'lucide-react';
import { DashboardData, Provider, TopologyApplicationNode } from '../types';
import { formatNumber } from '../utils/formatters';
import { TopologyMap } from './TopologyMap';
import { formatTopologyLatency, formatTopologyPercent } from '../topology/format';

interface TopologyViewProps {
  data: DashboardData;
  onOpenEditModal: (provider: Provider) => void;
}

type TopologyStatusFilter = 'all' | 'healthy' | 'degraded' | 'offline';

const topologyStatusFilters: readonly TopologyStatusFilter[] = ['all', 'healthy', 'degraded', 'offline'];

function isTopologyStatusFilter(value: string): value is TopologyStatusFilter {
  return topologyStatusFilters.includes(value as TopologyStatusFilter);
}

type SelectedNodeType = 
  | { type: 'provider'; provider: Provider }
  | { type: 'router'; data: DashboardData }
  | { type: 'source'; source: TopologyApplicationNode }
  | { type: 'edge'; popCount: number; status: string }
  | { type: 'firewall'; blockedCount: number }
  | null;

export const TopologyView: React.FC<TopologyViewProps> = ({ data, onOpenEditModal }) => {
  const [activeTab, setActiveTab] = useState<'graph' | 'flow' | 'inspector'>('graph');
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [statusFilter, setStatusFilter] = useState<TopologyStatusFilter>('all');
  const [selectedNode, setSelectedNode] = useState<SelectedNodeType>({
    type: 'router',
    data: data
  });

  const providers = useMemo(() => {
    let list = data.providers || [];
    if (statusFilter !== 'all') {
      list = list.filter(p => p.status.toLowerCase() === statusFilter);
    }
    return list;
  }, [data.providers, statusFilter]);

  const totalObservedTopologyRequests = data.topology?.nodes.router.totalRequestsLast24h ?? 0;

  const selectedProviderTopology = useMemo(() => {
    if (selectedNode?.type !== 'provider') return null;
    return data.topology?.nodes.providers.find((node) => node.id === selectedNode.provider.id) ?? null;
  }, [data.topology, selectedNode]);

  const readProviderMeta = (provider: Provider): Record<string, unknown> => {
    if (!provider.metadata) return {};
    if (typeof provider.metadata === 'object') return provider.metadata;
    try {
      const parsed = JSON.parse(provider.metadata);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  };

  return (
    <div className="flex flex-col h-full w-full gap-2.5 select-none">
      {/* Top Header & Operational Filters Bar */}
      <div className="card-3d-glass p-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20">
              <Share2 size={13} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A] tracking-tight">
              AI Topology Workspace
            </h2>
            <span className="text-[10.5px] px-2 py-0.2 rounded-full bg-[#10B981]/15 text-[#059669] font-semibold border border-[#10B981]/25">
              {totalObservedTopologyRequests > 0 ? 'Observed Traffic' : 'Configured / No Traffic'}
            </span>
          </div>
          <p className="text-[10px] text-[#64748B] mt-0.5">
            Backend-driven graph: observed ingress clients → edge/router → configured and observed LLM providers
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center flex-wrap gap-2 text-[11px]">
          {/* Submenu tabs */}
          <div className="flex bg-slate-100/80 p-0.5 rounded-lg border border-[#E2E8F0]">
            <button
              onClick={() => setActiveTab('graph')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                activeTab === 'graph' 
                  ? 'bg-white text-[#0051C3] shadow-2xs font-semibold' 
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Interactive Mesh
            </button>
            <button
              onClick={() => setActiveTab('flow')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                activeTab === 'flow' 
                  ? 'bg-white text-[#0051C3] shadow-2xs font-semibold' 
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Pipeline Stages
            </button>
          </div>

          {/* Time Range Filter */}
          <div className="flex items-center bg-white border border-[#DCEBFA] rounded-md px-1.5 py-0.5 text-[10.5px] shadow-2xs">
            <span className="text-[#64748B] mr-1 font-medium">Window:</span>
            {(['1h', '24h', '7d'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTimeRange(t)}
                className={`px-1.5 py-0.5 rounded font-mono ${
                  timeRange === t ? 'bg-[#0051C3] text-white font-bold' : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Provider Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              const next = e.target.value;
              if (isTopologyStatusFilter(next)) setStatusFilter(next);
            }}
            className="bg-white border border-[#DCEBFA] rounded-md px-2 py-1 text-[10.5px] text-[#0F172A] font-medium shadow-2xs focus:outline-none"
          >
            <option value="all">All Statuses ({providers.length})</option>
            <option value="healthy">Healthy Only</option>
            <option value="degraded">Degraded Only</option>
            <option value="offline">Offline Only</option>
          </select>

          <button
            onClick={() => data.refetch()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#DCEBFA] bg-white text-[#0051C3] font-semibold text-[10.5px] hover:bg-[#F5FAFF] shadow-2xs cursor-pointer"
          >
            <RefreshCw size={11} className={data.loading ? 'animate-spin' : ''} />
            Sync Mesh
          </button>
        </div>
      </div>

      {/* Main Interactive Stage & Side Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 flex-1 min-h-0">
        {/* Left Column: Full Pipeline Canvas (8 cols) */}
        <div className="lg:col-span-8 card-3d-glass p-3 sm:p-4 flex flex-col relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] mb-2 z-10">
            <div className="flex items-center gap-3">
              <span className="text-[#64748B] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#0051C3]" /> Ingress Sources
              </span>
              <span className="text-[#64748B] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#10B981]" /> Cloudflare Edge
              </span>
              <span className="text-[#64748B] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" /> AI Router
              </span>
              <span className="text-[#64748B] font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> LLM Backends
              </span>
            </div>
            <span className="text-[10px] text-[#64748B] font-mono">
              Click any node to inspect telemetry
            </span>
          </div>

          {activeTab === 'graph' ? (
            /* INTERACTIVE LIVE MESH VIEW MATCHING REFERENCE THEME */
            <div className="flex-1 w-full h-full min-h-0 relative">
              <TopologyMap 
                data={data} 
                onSelectProvider={(p) => {
                  setSelectedNode({ type: 'provider', provider: p });
                  onOpenEditModal(p);
                }}
                onSelectSource={(source) => setSelectedNode({ type: 'source', source })}
              />
            </div>
          ) : (
            /* PIPELINE STAGES VIEW */
            <div className="flex-1 overflow-y-auto pr-1 py-2 flex flex-col gap-3">
              <div className="p-3 rounded-xl bg-white border border-[#DCEBFA]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#0051C3] text-white flex items-center justify-center text-[10px] font-bold">1</span>
                    <h4 className="text-[12px] font-bold text-[#0F172A]">Request Normalization & Ingress</h4>
                  </div>
                  <span className="text-[10px] text-[#059669] font-bold">Passed</span>
                </div>
                <p className="text-[11px] text-[#64748B]">
                  Normalizes client requests from OpenAI-compatible payloads, Anthropic structures, and Gemini schemas into a unified JSON format with client identity tagging.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white border border-[#DCEBFA]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#EF4444] text-white flex items-center justify-center text-[10px] font-bold">2</span>
                    <h4 className="text-[12px] font-bold text-[#0F172A]">Zero Trust AI Firewall Inspection</h4>
                  </div>
                  <span className="text-[10px] text-[#0051C3] font-bold">Active Shield</span>
                </div>
                <p className="text-[11px] text-[#64748B]">
                  Performs pre-flight prompt injection payload inspection, sensitive PII/credential sanitization (SSN, credit card, API keys), and IP reputation blocking prior to provider routing.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white border border-[#DCEBFA]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#8B5CF6] text-white flex items-center justify-center text-[10px] font-bold">3</span>
                    <h4 className="text-[12px] font-bold text-[#0F172A]">Smart Dynamic Scoring Decision</h4>
                  </div>
                  <span className="text-[10px] text-[#059669] font-bold">Dynamic (40/25/20/10/5)</span>
                </div>
                <p className="text-[11px] text-[#64748B]">
                  Computes the real-time suitability score across all enabled providers: Health (40%), Latency (25%), Cost (20%), Capability Match (10%), Priority (5%). Selects optimal provider or initiates failover.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white border border-[#DCEBFA]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#10B981] text-white flex items-center justify-center text-[10px] font-bold">4</span>
                    <h4 className="text-[12px] font-bold text-[#0F172A]">Upstream Provider Execution & Logging</h4>
                  </div>
                  <span className="text-[10px] text-[#059669] font-bold">Streaming / Direct</span>
                </div>
                <p className="text-[11px] text-[#64748B]">
                  Executes the request against the upstream provider endpoint with encrypted API key injection, records execution latency, calculated token usage, cost, and stores immutable decision audit logs.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Node Inspector Detail Panel (4 cols) */}
        <div className="lg:col-span-4 card-3d-glass p-3.5 sm:p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0] mb-3">
              <div className="flex items-center gap-2">
                <Info size={14} className="text-[#0051C3]" />
                <h3 className="text-[13px] font-bold text-[#0F172A]">
                  Node Inspector
                </h3>
              </div>
              <span className="text-[10px] text-[#64748B] font-mono uppercase">
                {selectedNode?.type || 'Telemetry'}
              </span>
            </div>

            {selectedNode?.type === 'provider' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] font-bold text-[#0F172A]">
                      {selectedNode.provider.name}
                    </div>
                    <span className="text-[10px] text-[#64748B] font-mono break-all block">
                      {selectedNode.provider.baseUrl}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    selectedNode.provider.status === 'Healthy'
                      ? 'bg-[#10B981]/15 text-[#059669] border-[#10B981]/30'
                      : selectedNode.provider.status === 'Degraded'
                      ? 'bg-[#F59E0B]/15 text-[#D97706] border-[#F59E0B]/30'
                      : 'bg-[#EF4444]/15 text-[#DC2626] border-[#EF4444]/30'
                  }`}>
                    {selectedNode.provider.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E2E8F0]">
                  <div className="p-2 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                    <span className="text-[9px] text-[#64748B]">Base Latency</span>
                    <div className="text-[13px] font-bold text-[#0F172A] font-mono">
                      {selectedProviderTopology?.latencySource === 'none' ? 'No data' : formatTopologyLatency(selectedProviderTopology?.avgLatencyMs)}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                    <span className="text-[9px] text-[#64748B]">Success Rate</span>
                    <div className="text-[13px] font-bold text-[#059669] font-mono">
                      {String(readProviderMeta(selectedNode.provider).successRate ?? 'No data')}{readProviderMeta(selectedNode.provider).successRate ? '%' : ''}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                    <span className="text-[9px] text-[#64748B]">Traffic Share</span>
                    <div className="text-[13px] font-bold text-[#0051C3] font-mono">
                      {selectedProviderTopology ? formatTopologyPercent(selectedProviderTopology.trafficSharePct) : 'No data'}
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                    <span className="text-[9px] text-[#64748B]">Routing Priority</span>
                    <div className="text-[13px] font-bold text-[#0F172A] font-mono">
                      Tier {selectedNode.provider.priority || 1}
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#DCEBFA] text-[10.5px]">
                  <div className="font-semibold text-[#0F172A] mb-1">Provider Credentials</div>
                  <div className="flex items-center justify-between text-[#64748B]">
                    <span>Authentication:</span>
                    <span className="text-[#059669] font-medium">Configured (Encrypted)</span>
                  </div>
                  <div className="flex items-center justify-between text-[#64748B] mt-1">
                    <span>Active Status:</span>
                    <span className="text-[#0F172A] font-medium">{selectedNode.provider.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </div>

                <button
                  onClick={() => onOpenEditModal(selectedNode.provider)}
                  className="w-full py-1.5 rounded-lg bg-[#0051C3] text-white font-semibold text-[11px] hover:bg-[#0E60D4] shadow-xs cursor-pointer text-center"
                >
                  Configure Provider Settings
                </button>
              </div>
            )}

            {selectedNode?.type === 'router' && (
              <div className="flex flex-col gap-2.5">
                <div>
                  <div className="text-[14px] font-bold text-[#0F172A]">
                    Cloudflare AI Router Engine
                  </div>
                  <span className="text-[10px] text-[#64748B]">
                    Multi-factor scoring runtime engine
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                  <div className="text-[11px] font-bold text-[#0F172A] mb-1.5">
                    Active Scoring Weights (100%)
                  </div>
                  <div className="flex flex-col gap-1 text-[10px] text-[#64748B]">
                    <div className="flex justify-between"><span>Health & Uptime:</span><span className="font-bold text-[#0F172A]">40%</span></div>
                    <div className="flex justify-between"><span>Base Latency:</span><span className="font-bold text-[#0F172A]">25%</span></div>
                    <div className="flex justify-between"><span>Token Cost:</span><span className="font-bold text-[#0F172A]">20%</span></div>
                    <div className="flex justify-between"><span>Capability Match:</span><span className="font-bold text-[#0F172A]">10%</span></div>
                    <div className="flex justify-between"><span>Priority Tier:</span><span className="font-bold text-[#0F172A]">5%</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                    <span className="text-[9px] text-[#64748B]">Total Routed</span>
                    <div className="text-[13px] font-bold text-[#0F172A] font-mono">
                      {formatNumber(totalObservedTopologyRequests)}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                    <span className="text-[9px] text-[#64748B]">Active Providers</span>
                    <div className="text-[13px] font-bold text-[#10B981] font-mono">
                      {data.topology?.nodes.providers.filter(p => p.health === 'healthy').length ?? 0} / {data.topology?.nodes.providers.length ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedNode?.type === 'source' && (
              <div className="flex flex-col gap-2.5">
                <div>
                  <div className="text-[14px] font-bold text-[#0F172A]">
                    {selectedNode.source.label}
                  </div>
                  <span className="text-[10px] text-[#64748B]">
                    Source type: {selectedNode.source.type || 'Unclassified'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0]">
                  <span className="text-[10px] text-[#64748B]">Traffic Volume</span>
                  <div className="text-[16px] font-bold text-[#0051C3] font-mono">
                    {formatNumber(selectedNode.source.requestsLast24h)} reqs
                  </div>
                  <div className="text-[9.5px] text-[#059669] font-medium mt-0.5">
                    {formatTopologyPercent(selectedNode.source.trafficSharePct)} of observed ingress
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#DCEBFA] text-[10.5px]">
                  <div className="font-semibold text-[#0F172A] mb-1">Security Posture</div>
                  <div className="flex justify-between text-[#64748B]">
                    <span>Classification:</span>
                    <span className="text-[#0F172A] font-semibold">{selectedNode.source.sourceStatus === 'classified' ? 'Classified' : 'Unclassified'}</span>
                  </div>
                  <div className="flex justify-between text-[#64748B] mt-1">
                    <span>Average latency:</span>
                    <span className="text-[#0F172A] font-semibold">{formatTopologyLatency(selectedNode.source.avgLatencyMs)}</span>
                  </div>
                </div>
              </div>
            )}

            {selectedNode?.type === 'edge' && (
              <div className="flex flex-col gap-2.5">
                <div className="text-[14px] font-bold text-[#0F172A]">
                  Cloudflare Global Anycast Edge
                </div>
                <p className="text-[11px] text-[#64748B]">
                  Edge is shown as a topology stage only; request totals below come from observed backend routing history.
                </p>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] font-mono text-[11px]">
                  <div>Observed requests: {formatNumber(totalObservedTopologyRequests)}</div>
                  <div className="text-[#0F172A] font-bold mt-1">Status: {totalObservedTopologyRequests > 0 ? 'Observed traffic' : 'No traffic observed'}</div>
                </div>
              </div>
            )}

            {selectedNode?.type === 'firewall' && (
              <div className="flex flex-col gap-2.5">
                <div className="text-[14px] font-bold text-[#0F172A]">
                  Zero Trust AI Firewall
                </div>
                <p className="text-[11px] text-[#64748B]">
                  Real-time pattern inspection for prompt injection exploits, system prompt extraction, SSN/credit card PII, and API secret leakage.
                </p>
                <div className="p-2.5 rounded-lg bg-[#FFF5F5] border border-[#EF4444]/30">
                  <div className="text-[11px] font-bold text-[#EF4444]">
                    Blocked Threats: {data.stats?.blockedThreats ?? 0}
                  </div>
                  <div className="text-[9.5px] text-[#64748B] mt-1">
                    Enforcement Action: BLOCK / 403 Forbidden
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-2.5 border-t border-[#E2E8F0] text-[10px] text-[#64748B] flex items-center justify-between">
            <span>Topology source</span>
            <span className="font-mono text-[#059669]">API</span>
          </div>
        </div>
      </div>
    </div>
  );
};
