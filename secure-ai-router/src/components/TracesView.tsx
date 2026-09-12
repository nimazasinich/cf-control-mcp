import React, { useEffect, useMemo, useState } from 'react';
import { Radio, RefreshCw, Search, Route, Trophy, AlertTriangle } from 'lucide-react';
import { formatLatency, formatDateTime } from '../utils/formatters';

type TraceCandidate = {
  providerId?: string;
  providerName?: string;
  modelId?: string;
  modelName?: string;
  finalScore?: number;
  score?: number;
  reasons?: string[];
};

type TraceRow = {
  id: string;
  requestId: string;
  timestamp: number;
  requestType: string;
  selectedProviderId?: string | null;
  selectedModelId?: string | null;
  providerName?: string | null;
  modelName?: string | null;
  requestedModel?: string | null;
  status?: string | null;
  latencyMs?: number | null;
  cost?: number | null;
  score?: number | null;
  reasons: string[];
  candidates: TraceCandidate[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

function normalizeCandidate(value: unknown): TraceCandidate {
  const row = asRecord(value);
  return {
    providerId: row.providerId ? String(row.providerId) : undefined,
    providerName: row.providerName ? String(row.providerName) : undefined,
    modelId: row.modelId ? String(row.modelId) : undefined,
    modelName: row.modelName ? String(row.modelName) : undefined,
    finalScore: Number.isFinite(Number(row.finalScore)) ? Number(row.finalScore) : undefined,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : undefined,
    reasons: asStringList(row.reasons),
  };
}

function normalizeTrace(value: unknown): TraceRow {
  const row = asRecord(value);
  return {
    id: String(row.id ?? row.requestId ?? ''),
    requestId: String(row.requestId ?? ''),
    timestamp: Number(row.timestamp ?? Date.now()),
    requestType: String(row.requestType ?? 'chat'),
    selectedProviderId: row.selectedProviderId ? String(row.selectedProviderId) : null,
    selectedModelId: row.selectedModelId ? String(row.selectedModelId) : null,
    providerName: row.providerName ? String(row.providerName) : null,
    modelName: row.modelName ? String(row.modelName) : null,
    requestedModel: row.requestedModel ? String(row.requestedModel) : null,
    status: row.status ? String(row.status) : null,
    latencyMs: Number.isFinite(Number(row.latencyMs)) ? Number(row.latencyMs) : null,
    cost: Number.isFinite(Number(row.cost)) ? Number(row.cost) : null,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
    reasons: asStringList(row.reasons),
    candidates: Array.isArray(row.candidates) ? row.candidates.map(normalizeCandidate) : [],
  };
}

export const TracesView: React.FC = () => {
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchTraces = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/traces?limit=100');
      const data = await res.json().catch(() => []);
      const normalized = Array.isArray(data) ? data.map(normalizeTrace) : [];
      setRows(normalized);
      setSelectedId((current) => current ?? normalized[0]?.id ?? null);
    } catch (err) {
      console.error('Failed to fetch traces:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTraces();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => [
      row.requestId,
      row.requestType,
      row.providerName,
      row.modelName,
      row.requestedModel,
      row.status,
      ...row.reasons,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [rows, search]);

  const selected = filtered.find((row) => row.id === selectedId) ?? filtered[0] ?? null;
  const bestCandidates = selected?.candidates
    .slice()
    .sort((a, b) => Number(b.finalScore ?? b.score ?? 0) - Number(a.finalScore ?? a.score ?? 0)) ?? [];

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-hidden pr-1">
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs">
              <Radio size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Routing Decision Traces</h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-100 text-[#475569] font-mono border border-slate-200">
              {rows.length} captured
            </span>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Explainable per-request scoring trail from the real routing_decisions table.
          </p>
        </div>
        <button
          onClick={fetchTraces}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCEBFA] bg-white text-[#0051C3] font-semibold text-[11px] hover:bg-[#F5FAFF] shadow-xs cursor-pointer"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="xl:col-span-5 card-3d-glass p-3.5 flex flex-col min-h-0">
          <div className="relative mb-2 shrink-0">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trace, model, provider, reason..."
              className="w-full h-[30px] pl-7 pr-2 rounded-lg border border-[#DCEBFA] bg-white text-[11px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#E2E8F0]/70 rounded-xl border border-[#E2E8F0] bg-white/70">
            {filtered.map((row) => (
              <button
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                className={`w-full text-left p-2.5 transition-colors ${selected?.id === row.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-[#64748B]">{formatDateTime(row.timestamp)}</span>
                  <span className={`text-[9.5px] uppercase font-bold rounded-full px-2 py-0.5 border ${row.status === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                    {row.status ?? 'unknown'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 min-w-0">
                  <Route size={12} className="text-[#0051C3] shrink-0" />
                  <span className="font-bold text-[12px] text-[#0F172A] truncate" title={row.providerName ?? row.selectedProviderId ?? 'Unknown provider'}>
                    {row.providerName ?? row.selectedProviderId ?? 'Unknown provider'}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-[#64748B] truncate font-mono" title={row.modelName ?? row.selectedModelId ?? 'Unknown model'}>
                  {row.modelName ?? row.selectedModelId ?? 'Unknown model'} · {formatLatency(row.latencyMs ?? 0)}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-8 text-center text-[12px] text-[#64748B]">No routing traces found.</div>
            )}
          </div>
        </div>

        <div className="xl:col-span-7 card-3d-glass p-3.5 flex flex-col min-h-0 overflow-hidden">
          {selected ? (
            <>
              <div className="shrink-0 pb-2 border-b border-[#E2E8F0]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[13px] font-bold text-[#0F172A]">Decision Evidence</h3>
                  <span className="font-mono text-[10px] text-[#64748B] truncate" title={selected.requestId}>{selected.requestId || selected.id}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10.5px]">
                  <div className="rounded-lg border border-[#E2E8F0] bg-white p-2"><span className="text-[#64748B]">Type</span><div className="font-bold text-[#0F172A]">{selected.requestType}</div></div>
                  <div className="rounded-lg border border-[#E2E8F0] bg-white p-2"><span className="text-[#64748B]">Latency</span><div className="font-bold font-mono text-[#0F172A]">{formatLatency(selected.latencyMs ?? 0)}</div></div>
                  <div className="rounded-lg border border-[#E2E8F0] bg-white p-2"><span className="text-[#64748B]">Score</span><div className="font-bold font-mono text-[#0F172A]">{selected.score?.toFixed(2) ?? 'No data'}</div></div>
                  <div className="rounded-lg border border-[#E2E8F0] bg-white p-2"><span className="text-[#64748B]">Candidates</span><div className="font-bold font-mono text-[#0F172A]">{bestCandidates.length}</div></div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0 mt-3">
                <div className="min-h-0 flex flex-col">
                  <h4 className="text-[11px] font-bold text-[#0F172A] mb-2 flex items-center gap-1.5"><Trophy size={12} /> Candidate Scores</h4>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                    {bestCandidates.map((candidate, index) => {
                      const score = Number(candidate.finalScore ?? candidate.score ?? 0);
                      return (
                        <div key={`${candidate.providerId ?? 'provider'}-${candidate.modelId ?? index}`} className="rounded-xl border border-[#E2E8F0] bg-white p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-[#0F172A] truncate" title={candidate.providerName ?? candidate.providerId ?? 'Unknown'}>
                              {candidate.providerName ?? candidate.providerId ?? 'Unknown provider'}
                            </span>
                            <span className="font-mono text-[10px] font-bold text-[#0051C3]">{score.toFixed(2)}</span>
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-[#64748B] truncate" title={candidate.modelName ?? candidate.modelId ?? 'Unknown model'}>
                            {candidate.modelName ?? candidate.modelId ?? 'Unknown model'}
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-[#0051C3]" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {bestCandidates.length === 0 && <div className="text-[11px] text-[#64748B]">No candidate scoring data recorded for this request.</div>}
                  </div>
                </div>

                <div className="min-h-0 flex flex-col">
                  <h4 className="text-[11px] font-bold text-[#0F172A] mb-2 flex items-center gap-1.5"><AlertTriangle size={12} /> Routing Reasons</h4>
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-2.5 text-[11px] text-[#475569] space-y-2">
                    {selected.reasons.map((reason, index) => (
                      <div key={`${reason}-${index}`} className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                        {reason}
                      </div>
                    ))}
                    {selected.reasons.length === 0 && <div>No routing reason recorded.</div>}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-[#64748B]">
              <Radio size={30} className="mb-2 text-[#94A3B8]" />
              <h3 className="text-[14px] font-bold text-[#0F172A]">No trace data yet</h3>
              <p className="text-[11px] mt-1 max-w-sm">Once gateway requests are routed, the scoring candidates and reasons appear here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
