import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { fetchAdmin, hasStoredAdminToken } from '../auth/adminAuth';
import { formatDateTime } from '../utils/formatters';

type AuditEntry = {
  id: string;
  timestamp: number;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detail: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeAuditEntry(value: unknown): AuditEntry {
  const row = asRecord(value);
  return {
    id: String(row.id ?? `${row.timestamp ?? Date.now()}`),
    timestamp: Number.isFinite(Number(row.timestamp)) ? Number(row.timestamp) : Date.now(),
    actorName: String(row.actorName ?? 'unknown'),
    action: String(row.action ?? 'unknown'),
    resourceType: String(row.resourceType ?? 'resource'),
    resourceId: row.resourceId === null || row.resourceId === undefined ? null : String(row.resourceId),
    detail: String(row.detail ?? 'No detail recorded'),
  };
}

export const AuditLogView: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdmin('/api/admin/audit-log?limit=250');
      const payload = await res.json().catch(() => []);
      if (!res.ok) {
        const message = asRecord(payload).error ? String(asRecord(payload).error) : `Audit request failed with HTTP ${res.status}`;
        setError(message);
        setEntries([]);
        return;
      }
      setEntries(Array.isArray(payload) ? payload.map(normalizeAuditEntry) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit request failed.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((entry) => [
      entry.actorName,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.detail,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [entries, search]);

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-hidden pr-1">
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs">
              <ClipboardList size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Admin Audit Log</h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-100 text-[#475569] font-mono border border-slate-200">
              {entries.length} events
            </span>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Authenticated control-plane changes from the real audit_log table. Raw secrets are not exposed.
          </p>
        </div>
        <button
          onClick={fetchAudit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCEBFA] bg-white text-[#0051C3] font-semibold text-[11px] hover:bg-[#F5FAFF] shadow-xs cursor-pointer"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="card-3d-glass p-3.5 flex flex-col min-h-0 flex-1">
        <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between shrink-0 mb-3">
          <div className="relative min-w-0 md:w-[360px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search actor, resource, action, detail..."
              className="w-full h-[30px] pl-7 pr-2 rounded-lg border border-[#DCEBFA] bg-white text-[11px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-[#64748B]">
            <ShieldCheck size={12} className={hasStoredAdminToken() ? 'text-emerald-600' : 'text-amber-600'} />
            {hasStoredAdminToken() ? 'Admin token found in this browser' : 'Admin token required; configure it in Settings'}
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 p-3 text-[11px]">
            {error}. Open Settings to store an admin token or bootstrap the first admin key.
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white/75 divide-y divide-[#E2E8F0]">
          {filtered.map((entry) => (
            <div key={entry.id} className="p-3 grid grid-cols-1 md:grid-cols-[120px_110px_130px_1fr] gap-2 md:gap-3 text-[11px]">
              <div className="font-mono text-[#64748B]">{formatDateTime(entry.timestamp)}</div>
              <div className="font-bold text-[#0F172A] truncate" title={entry.actorName}>{entry.actorName}</div>
              <div className="min-w-0">
                <span className="inline-flex px-2 py-0.5 rounded-full bg-blue-50 text-[#0051C3] border border-blue-100 uppercase font-bold text-[9.5px]">
                  {entry.action}
                </span>
                <div className="mt-1 font-mono text-[9.5px] text-[#64748B] truncate" title={entry.resourceId ?? undefined}>{entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId}` : ''}</div>
              </div>
              <div className="text-[#475569] break-words">{entry.detail}</div>
            </div>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="p-10 text-center text-[12px] text-[#64748B]">
              {entries.length === 0 ? 'No audit events available.' : 'No audit event matches your search.'}
            </div>
          )}
          {loading && entries.length === 0 && (
            <div className="p-10 text-center text-[12px] text-[#64748B]">Loading audit log...</div>
          )}
        </div>
      </div>
    </div>
  );
};
