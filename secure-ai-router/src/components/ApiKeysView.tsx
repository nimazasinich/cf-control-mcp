import React, { useState, useEffect } from 'react';
import { Key, Plus, Copy, Check, ShieldAlert, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { ApiKeyItem } from '../types';
import { fetchAdmin } from '../auth/adminAuth';

export const ApiKeysView: React.FC = () => {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRole, setNewKeyRole] = useState<'gateway' | 'admin'>('gateway');
  const [createdKeyData, setCreatedKeyData] = useState<{ rawSecret: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    try {
      const res = await fetchAdmin('/api/admin/keys', {});
      const data = await res.json();
      setKeys(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch keys:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    try {
      const res = await fetchAdmin('/api/admin/keys', {
        method: 'POST',
                body: JSON.stringify({ name: newKeyName, role: newKeyRole })
      });
      const result = await res.json();
      const rawSecret = result.rawSecret ?? result.rawKey;
      if (rawSecret) {
        setCreatedKeyData({ rawSecret, name: result.name ?? newKeyName });
        setIsCreateOpen(false);
        setNewKeyName('');
        fetchKeys();
      }
    } catch (err) {
      console.error('Failed to create key:', err);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;
    try {
      await fetchAdmin(`/api/admin/keys/${id}/revoke`, { method: 'POST' });
      fetchKeys();
    } catch (err) {
      console.error('Failed to revoke key:', err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-y-auto pr-1">
      {/* Top Banner */}
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs">
              <Key size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">
              Gateway API Keys & Secrets
            </h2>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Authenticate incoming inference requests to the Cloudflare AI Router (/v1/chat/completions).
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0051C3] text-white font-semibold text-[11px] hover:bg-[#0E60D4] shadow-xs cursor-pointer"
        >
          <Plus size={13} />
          Create New API Key
        </button>
      </div>

      {/* Security Warning Notice */}
      <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 flex items-start gap-2.5 text-[11px] text-amber-900 shrink-0">
        <ShieldAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Zero-Exposure Key Policy:</span> Secret tokens are only displayed once upon generation and are securely hashed in the database. Never transmit API keys via client-side frontend code.
        </div>
      </div>

      {/* Keys Table Card */}
      <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col flex-1 min-h-[300px]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-bold text-[#0F172A]">
            Registered Gateway Credentials ({keys.length})
          </h3>
          <span className="text-[10px] text-[#64748B] font-mono">
            Authorization: Bearer &lt;key&gt;
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[#64748B] border-b border-[#E2E8F0] bg-slate-50/50">
              <tr>
                <th className="py-2 pl-2">Name / Label</th>
                <th className="py-2">Key Secret</th>
                <th className="py-2">Role</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right pr-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]/70">
              {keys.map(k => (
                <tr key={k.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 pl-2 font-bold text-[#0F172A]">
                    {k.name}
                  </td>
                  <td className="py-2.5 font-mono text-[10.5px] text-[#64748B]">
                    {k.maskedKey}
                  </td>
                  <td className="py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-slate-100 text-[#0F172A] border border-slate-200">
                      {k.role}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {k.revoked ? (
                      <span className="text-[#EF4444] font-semibold flex items-center gap-1 text-[10px]">
                        <XCircle size={12} /> Revoked
                      </span>
                    ) : (
                      <span className="text-[#059669] font-semibold flex items-center gap-1 text-[10px]">
                        <CheckCircle2 size={12} /> Active
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right pr-2">
                    {!k.revoked && (
                      <button
                        onClick={() => handleRevoke(k.id)}
                        className="text-[10px] text-[#EF4444] hover:underline font-semibold cursor-pointer"
                      >
                        Revoke Key
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {keys.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#64748B]">
                    No API keys generated yet. Click "Create New API Key" above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create API Key */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#DCEBFA] shadow-xl p-5 w-full max-w-[400px]">
            <h3 className="text-[14px] font-bold text-[#0F172A] mb-1">Create Gateway API Key</h3>
            <p className="text-[11px] text-[#64748B] mb-4">
              Enter a descriptive label to identify this client integration.
            </p>

            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-[#0F172A] block mb-1">Key Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production Mobile App"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#DCEBFA] text-[12px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#0F172A] block mb-1">Role / Permissions</label>
                <select
                  value={newKeyRole}
                  onChange={(e) => setNewKeyRole(e.target.value === 'admin' ? 'admin' : 'gateway')}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#DCEBFA] text-[12px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
                >
                  <option value="gateway">Gateway Ingress (Inference only)</option>
                  <option value="admin">Administrator (Full control)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-[#E2E8F0] text-[11px] text-[#64748B] hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-[#0051C3] text-white font-semibold text-[11px] hover:bg-[#0E60D4] shadow-xs cursor-pointer"
                >
                  Generate Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: One-Time Secret Reveal */}
      {createdKeyData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#DCEBFA] shadow-2xl p-5 w-full max-w-[440px]">
            <div className="flex items-center gap-2 text-[#059669] mb-1">
              <CheckCircle2 size={16} />
              <h3 className="text-[14px] font-bold text-[#0F172A]">API Key Generated Successfully</h3>
            </div>
            <p className="text-[11px] text-[#64748B] mb-3">
              Copy this secret key now. <span className="text-[#DC2626] font-semibold">You will not be able to see it again.</span>
            </p>

            <div className="p-3 rounded-lg bg-slate-900 text-white font-mono text-[11px] flex items-center justify-between break-all mb-3 select-all">
              <span>{createdKeyData.rawSecret}</span>
              <button
                onClick={() => copyToClipboard(createdKeyData.rawSecret)}
                className="ml-2 p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white shrink-0 cursor-pointer"
                title="Copy Secret"
              >
                {copied ? <Check size={14} className="text-[#10B981]" /> : <Copy size={14} />}
              </button>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setCreatedKeyData(null)}
                className="px-4 py-1.5 rounded-lg bg-[#0051C3] text-white font-semibold text-[11px] hover:bg-[#0E60D4] shadow-xs cursor-pointer"
              >
                I have saved my key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
