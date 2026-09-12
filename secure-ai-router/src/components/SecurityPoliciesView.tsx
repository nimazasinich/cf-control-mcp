import React, { useState, useEffect } from 'react';
import { Shield, Plus, Trash2, CheckCircle2, AlertTriangle, Lock, ShieldCheck } from 'lucide-react';
import { SecurityPolicy } from '../types';
import { fetchAdmin } from '../auth/adminAuth';

export const SecurityPoliciesView: React.FC = () => {
  const [policies, setPolicies] = useState<SecurityPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newType, setNewType] = useState('model_allowlist');
  const [newValue, setNewValue] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');

  const fetchPolicies = async () => {
    try {
      const res = await fetchAdmin('/api/admin/policies', {});
      const data = await res.json();
      setPolicies(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch policies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newValue.trim()) return;

    try {
      await fetchAdmin('/api/admin/policies', {
        method: 'POST',
                body: JSON.stringify({
          type: newType,
          value: newValue,
          action: newAction
        })
      });
      setIsCreateOpen(false);
      setNewValue('');
      fetchPolicies();
    } catch (err) {
      console.error('Failed to create policy:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this policy rule?')) return;
    try {
      await fetchAdmin(`/api/admin/policies/${id}`, { method: 'DELETE' });
      fetchPolicies();
    } catch (err) {
      console.error('Failed to delete policy:', err);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-y-auto pr-1">
      {/* Top Banner */}
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0051C3]/10 text-[#0051C3] flex items-center justify-center border border-[#0051C3]/20 shadow-2xs">
              <Shield size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">
              AI Security Policies & Governance Rules
            </h2>
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Configure Zero Trust boundary enforcement, model whitelisting, and compliance filters.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0051C3] text-white font-semibold text-[11px] hover:bg-[#0E60D4] shadow-xs cursor-pointer"
        >
          <Plus size={13} />
          Add Security Policy
        </button>
      </div>

      {/* Zero Trust Active Modules */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 shrink-0">
        <div className="card-3d-glass p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-[11.5px] font-bold text-[#0F172A]">Prompt Injection Shield</div>
            <div className="text-[9.5px] text-emerald-700 font-bold">Enforced at Edge (BLOCK)</div>
          </div>
        </div>

        <div className="card-3d-glass p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0051C3]/15 text-[#0051C3] flex items-center justify-center">
            <Lock size={18} />
          </div>
          <div>
            <div className="text-[11.5px] font-bold text-[#0F172A]">Credential & PII Masking</div>
            <div className="text-[9.5px] text-[#0051C3] font-bold">SSN / API Key Redaction</div>
          </div>
        </div>

        <div className="card-3d-glass p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#8B5CF6]/15 text-[#8B5CF6] flex items-center justify-center">
            <Shield size={18} />
          </div>
          <div>
            <div className="text-[11.5px] font-bold text-[#0F172A]">Zero Trust Token Audit</div>
            <div className="text-[9.5px] text-[#8B5CF6] font-bold">mTLS Handshake Required</div>
          </div>
        </div>
      </div>

      {/* Policies Table Card */}
      <div className="card-3d-glass p-3.5 sm:p-4 flex flex-col flex-1 min-h-[300px]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-bold text-[#0F172A]">
            Active Governance Policies ({policies.length})
          </h3>
          <span className="text-[10px] text-[#64748B] font-mono">
            Evaluated synchronously on each route
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[#64748B] border-b border-[#E2E8F0] bg-slate-50/50">
              <tr>
                <th className="py-2 pl-2">Policy Type</th>
                <th className="py-2">Configuration / Match Value</th>
                <th className="py-2">Action</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right pr-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]/70">
              {policies.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 pl-2 font-bold text-[#0F172A]">
                    {p.type.replace(/_/g, ' ').toUpperCase()}
                  </td>
                  <td className="py-2.5 font-mono text-[10.5px] text-[#64748B]">
                    {p.value}
                  </td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold border ${
                      p.action.toLowerCase() === 'allow'
                        ? 'bg-[#10B981]/15 text-[#059669] border-[#10B981]/30'
                        : 'bg-[#EF4444]/15 text-[#DC2626] border-[#EF4444]/30'
                    }`}>
                      {p.action.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 text-[#059669] font-medium text-[10px] flex items-center gap-1 mt-1">
                    <CheckCircle2 size={12} /> Active
                  </td>
                  <td className="py-2.5 text-right pr-2">
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-[#EF4444] hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer"
                      title="Delete Policy"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}

              {policies.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#64748B]">
                    No custom security policies configured. Default Zero Trust policies apply.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add Policy */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#DCEBFA] shadow-xl p-5 w-full max-w-[420px]">
            <h3 className="text-[14px] font-bold text-[#0F172A] mb-1">Add Security Policy</h3>
            <p className="text-[11px] text-[#64748B] mb-4">
              Define a new guardrail rule enforced by the Edge AI Router.
            </p>

            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-[#0F172A] block mb-1">Policy Category</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#DCEBFA] text-[12px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
                >
                  <option value="model_allowlist">Model Allowlist (Only permit specific models)</option>
                  <option value="provider_denylist">Provider Denylist (Block specific upstream)</option>
                  <option value="rate_limit_ip">IP Rate Limiter (Max requests / min)</option>
                  <option value="token_budget">Token Budget Cap (Max tokens / request)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#0F172A] block mb-1">Value / Target Pattern</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. gpt-4o, claude-3-5-sonnet, or 100/min"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#DCEBFA] text-[12px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#0F172A] block mb-1">Action</label>
                <select
                  value={newAction}
                  onChange={(e) => setNewAction(e.target.value === 'allow' ? 'allow' : 'deny')}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#DCEBFA] text-[12px] text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0051C3]"
                >
                  <option value="allow">ALLOW / PERMIT</option>
                  <option value="deny">DENY / BLOCK</option>
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
                  Save Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
