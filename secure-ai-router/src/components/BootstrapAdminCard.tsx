import React, { useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { setStoredAdminToken } from '../auth/adminAuth';

type BootstrapResponse = {
  status?: string;
  adminKeyId?: string;
  adminKeyName?: string;
  rawAdminKey?: string;
  warning?: string;
  error?: string;
};

function readErrorMessage(payload: BootstrapResponse, fallback: string): string {
  return payload.error || payload.warning || fallback;
}

export const BootstrapAdminCard: React.FC = () => {
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [adminName, setAdminName] = useState('Default Admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);

  const bootstrap = async () => {
    setBusy(true);
    setError(null);
    setRawKey(null);
    setStored(false);
    setCopied(false);
    try {
      const res = await fetch('/api/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bootstrapSecret, adminName }),
      });
      const payload = await res.json().catch(() => ({} as BootstrapResponse));
      if (!res.ok || !payload.rawAdminKey) {
        setError(readErrorMessage(payload, `Bootstrap failed with HTTP ${res.status}`));
        return;
      }
      setRawKey(payload.rawAdminKey);
      setStored(true);
      setStoredAdminToken(payload.rawAdminKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bootstrap request failed.');
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    if (!rawKey || !navigator.clipboard) return;
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className="text-amber-600" />
          <h3 className="text-[13px] font-bold text-[#0F172A]">First-Run Bootstrap</h3>
        </div>
        <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-mono border border-amber-200">
          zero-admin only
        </span>
      </div>
      <p className="text-[10.5px] text-[#64748B]">
        Create the first admin key on a fresh deployment using BOOTSTRAP_SECRET. The server closes this endpoint after an active admin key exists.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          type="password"
          value={bootstrapSecret}
          onChange={(event) => setBootstrapSecret(event.target.value)}
          placeholder="BOOTSTRAP_SECRET"
          className="min-w-0 h-9 px-3 rounded-lg border border-[#DCEBFA] bg-white text-[12px] font-mono text-[#0F172A] outline-none focus:border-[#0051C3]"
        />
        <input
          value={adminName}
          onChange={(event) => setAdminName(event.target.value)}
          placeholder="Admin name"
          className="min-w-0 h-9 px-3 rounded-lg border border-[#DCEBFA] bg-white text-[12px] text-[#0F172A] outline-none focus:border-[#0051C3]"
        />
      </div>
      <button
        onClick={bootstrap}
        disabled={busy || !bootstrapSecret.trim()}
        className="h-9 rounded-lg bg-[#0F172A] text-white text-[11px] font-bold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
        Create first admin key
      </button>
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[10.5px] p-2.5">
          {error}
        </div>
      )}
      {rawKey && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[10.5px] text-emerald-800 space-y-2">
          <div className="flex items-center gap-1.5 font-bold"><CheckCircle2 size={13} /> Admin key created and stored locally.</div>
          <textarea readOnly value={rawKey} className="w-full min-h-[58px] rounded-md border border-emerald-200 bg-white p-2 font-mono text-[10px] text-[#0F172A] resize-none" />
          <button onClick={copyKey} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-emerald-200 font-bold text-emerald-700">
            <Copy size={11} /> {copied ? 'Copied' : 'Copy key'}
          </button>
          <div>{stored ? 'This browser can now call admin mutation APIs.' : 'Store this key now; the server will not show it again.'}</div>
        </div>
      )}
    </div>
  );
};
