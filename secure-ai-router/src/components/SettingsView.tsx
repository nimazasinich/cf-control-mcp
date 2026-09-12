import React, { useEffect, useState } from 'react';
import { Settings, Shield, Cpu, Clock, CheckCircle2, Lock, Info, Server, KeyRound, AlertTriangle, Trash2 } from 'lucide-react';
import { DashboardData } from '../types';
import { clearStoredAdminToken, getStoredAdminToken, setStoredAdminToken } from '../auth/adminAuth';
import { formatRelativeTime } from '../utils/formatters';
import { BootstrapAdminCard } from './BootstrapAdminCard';

interface SettingsViewProps {
  data: DashboardData;
}

const scoreRows = [
  ['Health & Uptime Influence', 'Healthy = 40 pts, Degraded = 20 pts, Offline = 0 pts', '40%'],
  ['Network Latency Influence', 'Inverse ratio curve: Max(0, 25 - (latency / 2000) * 25)', '25%'],
  ['Inference Cost Influence', 'Token efficiency curve: Max(0, 20 - (cost / 0.05) * 20)', '20%'],
  ['Capability Matching', 'Matches reasoning, vision, and tool compatibility', '10%'],
  ['Priority Tier Bias', 'Configured priority tier tiebreaker', '5%'],
] as const;

export const SettingsView: React.FC<SettingsViewProps> = ({ data }) => {
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);

  useEffect(() => {
    setTokenDraft(getStoredAdminToken());
  }, []);

  const saveToken = () => {
    setStoredAdminToken(tokenDraft);
    setTokenSaved(true);
    window.setTimeout(() => setTokenSaved(false), 1500);
  };

  const clearToken = () => {
    clearStoredAdminToken();
    setTokenDraft('');
    setTokenSaved(true);
    window.setTimeout(() => setTokenSaved(false), 1500);
  };

  const readiness = data.readiness;
  const ready = readiness?.ready ?? false;

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-y-auto pr-1">
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs">
              <Settings size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Router & Control Plane Configuration</h2>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Runtime readiness, admin access, routing constants, and deployment-safe operational settings.
          </p>
        </div>
        <div className="text-right">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-2xs ${ready ? 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-700 bg-amber-500/10 border-amber-500/20'}`}>
            {ready ? 'Control Plane Ready' : 'Needs Configuration'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 shrink-0">
        <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
            <div className="flex items-center gap-2"><KeyRound size={14} className="text-[#0051C3]" /><h3 className="text-[13px] font-bold text-[#0F172A]">Admin Access</h3></div>
            <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-slate-100 text-[#64748B] font-mono border border-slate-200">localStorage only</span>
          </div>
          <p className="text-[10.5px] text-[#64748B]">
            Store the admin bearer token locally so provider/key/policy actions do not rely on a hardcoded development token.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              placeholder="admin_..."
              className="min-w-0 flex-1 h-9 px-3 rounded-lg border border-[#DCEBFA] bg-white text-[12px] font-mono text-[#0F172A] outline-none focus:border-[#0051C3]"
            />
            <button onClick={saveToken} className="px-3 rounded-lg bg-[#0051C3] text-white text-[11px] font-bold shadow-xs">Save</button>
            <button onClick={clearToken} className="px-2 rounded-lg border border-[#E2E8F0] text-[#64748B] hover:bg-slate-50" title="Clear token"><Trash2 size={13} /></button>
          </div>
          <div className="text-[10px] text-[#64748B]">
            {tokenSaved ? 'Token setting updated.' : tokenDraft ? 'Admin token is configured in this browser.' : 'No admin token stored. Read-only pages still work.'}
          </div>
        </div>

        <div className="xl:col-span-2 card-3d-glass p-3.5 sm:p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
            <div className="flex items-center gap-2"><Server size={14} className="text-[#0051C3]" /><h3 className="text-[13px] font-bold text-[#0F172A]">System Readiness</h3></div>
            <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-white text-[#64748B] font-mono border border-slate-200">
              {readiness ? `Checked ${formatRelativeTime(readiness.checkedAt)}` : 'No data'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10.5px]">
            <div className="rounded-lg bg-slate-50 border border-[#E2E8F0] p-2"><span className="text-[#64748B]">Providers</span><div className="font-bold text-[#0F172A]">{readiness?.enabledProviders ?? 0} / {readiness?.providerCount ?? 0}</div></div>
            <div className="rounded-lg bg-slate-50 border border-[#E2E8F0] p-2"><span className="text-[#64748B]">Models</span><div className="font-bold text-[#0F172A]">{readiness?.enabledModelCount ?? 0} / {readiness?.modelCount ?? 0}</div></div>
            <div className="rounded-lg bg-slate-50 border border-[#E2E8F0] p-2"><span className="text-[#64748B]">Keys</span><div className="font-bold text-[#0F172A]">{readiness?.gatewayKeys ?? 0} gateway · {readiness?.adminKeys ?? 0} admin</div></div>
            <div className="rounded-lg bg-slate-50 border border-[#E2E8F0] p-2"><span className="text-[#64748B]">24h</span><div className="font-bold text-[#0F172A]">{readiness?.requestCount24h ?? 0} req · {readiness?.errorCount24h ?? 0} err</div></div>
          </div>
          <div className="min-h-[54px] rounded-xl border border-[#E2E8F0] bg-white/70 p-2.5 text-[10.5px] text-[#475569]">
            {readiness && readiness.issues.length > 0 ? (
              <div className="space-y-1">
                {readiness.issues.map((issue) => <div key={issue} className="flex items-start gap-1.5"><AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" /> <span>{issue}</span></div>)}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold"><CheckCircle2 size={13} /> Ready for routed gateway traffic.</div>
            )}
          </div>
        </div>
      </div>

      <BootstrapAdminCard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-[360px]">
        <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0] mb-3">
              <div className="flex items-center gap-2"><Cpu size={14} className="text-[#0051C3]" /><h3 className="text-[13px] font-bold text-[#0F172A]">Smart Router Scoring Weights</h3></div>
              <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-slate-100 text-[#64748B] font-mono border border-slate-200">Read-Only Engine Policy</span>
            </div>
            <p className="text-[11px] text-[#64748B] mb-3">
              These match the checked-in routing engine constants and explain why a provider wins a request.
            </p>
            <div className="flex flex-col gap-2">
              {scoreRows.map(([title, detail, weight]) => (
                <div key={title} className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="text-[11px] font-bold text-[#0F172A]">{title}</div><span className="text-[9.5px] text-[#64748B] break-words">{detail}</span></div>
                  <span className="text-[14px] font-bold text-[#0051C3] font-mono shrink-0">{weight}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 p-2.5 rounded-lg bg-blue-50/60 border border-blue-200/80 text-[10.5px] text-[#1E40AF]">
            Total Weight Sum: <span className="font-bold">100% Normalized</span>. Routing remains deterministic and auditable.
          </div>
        </div>

        <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0] mb-3">
              <div className="flex items-center gap-2"><Clock size={14} className="text-[#0051C3]" /><h3 className="text-[13px] font-bold text-[#0F172A]">Operational Thresholds & Failover</h3></div>
              <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-blue-50 text-[#0051C3] font-mono border border-blue-200">Configured</span>
            </div>
            <div className="flex flex-col gap-2.5 text-[11px]">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] flex items-center justify-between gap-3"><div><span className="font-bold text-[#0F172A]">Failover Attempts</span><p className="text-[9.5px] text-[#64748B]">Retryable upstream failures are recorded per request in request_attempts.</p></div><span className="font-mono font-bold text-[#0F172A] bg-white px-2 py-1 rounded border border-[#E2E8F0]">3 max</span></div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] flex items-center justify-between gap-3"><div><span className="font-bold text-[#0F172A]">Provider Degraded Threshold</span><p className="text-[9.5px] text-[#64748B]">Rolling health and latency lower the candidate score before failover.</p></div><span className="font-mono font-bold text-[#0F172A] bg-white px-2 py-1 rounded border border-[#E2E8F0]">health.ts</span></div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] flex items-center justify-between gap-3"><div><span className="font-bold text-[#0F172A]">Zero Trust AI Firewall</span><p className="text-[9.5px] text-[#64748B]">Prompt inspection runs before provider routing and records security events.</p></div><span className="font-semibold text-[#059669] bg-[#10B981]/15 px-2 py-0.5 rounded-full border border-[#10B981]/30 text-[10px]">INLINE</span></div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] flex items-center justify-between gap-3"><div><span className="font-bold text-[#0F172A]">Audit Log</span><p className="text-[9.5px] text-[#64748B]">Admin mutations are appended without raw secrets.</p></div><span className="font-mono font-bold text-[#0F172A] bg-white px-2 py-1 rounded border border-[#E2E8F0]">enabled</span></div>
            </div>
          </div>
          <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-[#E2E8F0] text-[10px] text-[#64748B] flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5"><Shield size={12} /> Gateway surface: /v1/chat/completions</span>
            <span className="font-mono text-[#059669]">{data.runtime ? `uptime ${Math.round(data.runtime.uptimeSeconds / 60)}m` : 'runtime pending'}</span>
          </div>
        </div>
      </div>

      <div className="card-3d-glass p-3 text-[10.5px] text-[#64748B] flex items-start gap-2 shrink-0">
        <Info size={13} className="text-[#0051C3] mt-0.5 shrink-0" />
        <span>Configuration shown here is operational guidance plus live readiness. Secrets are never displayed after creation; only local admin-token storage is controlled from the browser.</span>
      </div>
    </div>
  );
};
