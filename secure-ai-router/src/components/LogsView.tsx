import React, { useState, useEffect } from 'react';
import { FileText, Search, RefreshCw, Filter, Download, ArrowUpRight } from 'lucide-react';
import { formatLatency } from '../utils/formatters';

interface LogItem {
  id: string;
  timestamp: number;
  clientId: string;
  requestType: string;
  modelRequested: string;
  modelUsed: string;
  providerId: string;
  routingReason: string;
  latency: number;
  tokensPrompt: number;
  tokensCompletion: number;
  cost: number;
  status: number;
}


function normalizeLogItem(item: unknown): LogItem {
  const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
  const statusText = String(row.status ?? '').toLowerCase();
  const statusCode = typeof row.status === 'number'
    ? row.status
    : statusText === 'success'
      ? 200
      : statusText === 'blocked'
        ? 403
        : statusText === 'error'
          ? 500
          : Number(row.status) || 0;
  return {
    id: String(row.id ?? ''),
    timestamp: Number(row.timestamp ?? Date.now()),
    clientId: String(row.clientId ?? row.clientName ?? ''),
    requestType: String(row.requestType ?? 'chat'),
    modelRequested: String(row.requestedModel ?? row.modelRequested ?? ''),
    modelUsed: String(row.selectedModel ?? row.modelUsed ?? ''),
    providerId: String(row.providerName ?? row.providerId ?? ''),
    routingReason: String(row.routingReason ?? ''),
    latency: Number(row.latencyMs ?? row.latency ?? 0),
    tokensPrompt: Number(row.tokensInput ?? row.tokensPrompt ?? 0),
    tokensCompletion: Number(row.tokensOutput ?? row.tokensCompletion ?? 0),
    cost: Number(row.cost ?? 0),
    status: statusCode,
  };
}

export const LogsView: React.FC = () => {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '200' | '403' | '500'>('all');
  const [providerFilter, setProviderFilter] = useState('all');

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/logs');
      const data = await res.json();
      const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      setLogs(items.map(normalizeLogItem));
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(l => {
    if (statusFilter !== 'all' && String(l.status) !== statusFilter) return false;
    if (providerFilter !== 'all' && l.providerId !== providerFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchClient = l.clientId?.toLowerCase().includes(term);
      const matchModel = l.modelUsed?.toLowerCase().includes(term);
      const matchReason = l.routingReason?.toLowerCase().includes(term);
      return matchClient || matchModel || matchReason;
    }
    return true;
  });

  const uniqueProviders = Array.from(new Set(logs.map(l => l.providerId).filter(Boolean)));

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-y-auto pr-1">
      {/* Top Banner */}
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs">
              <FileText size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">
              Inference Request Audit Logs
            </h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-100 text-[#475569] font-mono border border-slate-200">
              Last {logs.length} Requests
            </span>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Immutable log record of every request routed through Cloudflare AI Router with token counts and latency.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCEBFA] bg-white text-[#0051C3] font-semibold text-[11px] hover:bg-[#F5FAFF] shadow-xs cursor-pointer"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh Logs
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card-3d-glass p-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative w-full max-w-[260px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={12} />
            <input
              type="text"
              placeholder="Search by client, model, or reason..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[28px] pl-7 pr-2 rounded-lg border border-[#DCEBFA] bg-white text-[11px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value === '200' || e.target.value === '403' || e.target.value === '500' ? e.target.value : 'all')}
            className="bg-white border border-[#DCEBFA] rounded-lg px-2 py-1 text-[10.5px] text-[#0F172A] focus:outline-none font-medium h-[28px]"
          >
            <option value="all">All HTTP Statuses</option>
            <option value="200">200 OK Only</option>
            <option value="403">403 Forbidden</option>
            <option value="500">500 Server Error</option>
          </select>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="bg-white border border-[#DCEBFA] rounded-lg px-2 py-1 text-[10.5px] text-[#0F172A] focus:outline-none font-medium h-[28px]"
          >
            <option value="all">All Providers</option>
            {uniqueProviders.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <span className="text-[10.5px] text-[#64748B] font-mono">
          Showing {filteredLogs.length} of {logs.length} entries
        </span>
      </div>

      {/* Logs Table Card */}
      <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col flex-1 min-h-[350px]">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[#64748B] border-b border-[#E2E8F0] bg-slate-50/50">
              <tr>
                <th className="py-2 pl-2">Time</th>
                <th className="py-2">Client ID</th>
                <th className="py-2">Model Used</th>
                <th className="py-2">Provider</th>
                <th className="py-2">Routing Reason</th>
                <th className="py-2 text-right">Tokens</th>
                <th className="py-2 text-right">Latency</th>
                <th className="py-2 text-right">Cost</th>
                <th className="py-2 text-right pr-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]/70">
              {filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 pl-2 font-mono text-[10px] text-[#64748B] whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2.5 font-mono text-[10px] text-[#0F172A] whitespace-nowrap">
                    {log.clientId || 'gateway-client'}
                  </td>
                  <td className="py-2.5 font-bold text-[#0F172A] whitespace-nowrap">
                    {log.modelUsed || log.modelRequested}
                  </td>
                  <td className="py-2.5 text-[#475569] font-medium whitespace-nowrap">
                    {log.providerId || 'Unknown'}
                  </td>
                  <td className="py-2.5 text-[#0051C3] font-semibold text-[10.5px] whitespace-nowrap">
                    {log.routingReason || 'No routing reason recorded'}
                  </td>
                  <td className="py-2.5 text-right font-mono text-[10px] text-[#64748B]">
                    {(log.tokensPrompt || 0) + (log.tokensCompletion || 0)}
                  </td>
                  <td className="py-2.5 text-right font-mono font-semibold text-[#0F172A]">
                    {formatLatency(log.latency)}
                  </td>
                  <td className="py-2.5 text-right font-mono text-[10.5px] text-[#64748B]">
                    ${(log.cost || 0).toFixed(4)}
                  </td>
                  <td className="py-2.5 text-right pr-2">
                    <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold border ${
                      log.status === 200
                        ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-700 border-rose-500/20'
                    }`}>
                      {log.status === 200 ? '200 OK' : `${log.status || 'ERR'}`}
                    </span>
                  </td>
                </tr>
              ))}

              {filteredLogs.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#64748B]">
                    No request logs found matching filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
