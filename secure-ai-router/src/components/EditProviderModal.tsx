import React, { useState, useEffect } from 'react';
import { Sliders, X, Check, AlertCircle, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { Provider } from '../types';
import { safeParseMetadata, isEnabledFlag } from '../utils/formatters';
import { fetchAdmin } from '../auth/adminAuth';

interface EditProviderModalProps {
  provider: Provider | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const EditProviderModal: React.FC<EditProviderModalProps> = ({
  provider,
  isOpen,
  onClose,
  onSaved
}) => {
  if (!isOpen || !provider) return null;

  const [baseUrl, setBaseUrl] = useState(provider.baseUrl || '');
  const [enabled, setEnabled] = useState<boolean>(isEnabledFlag(provider.enabled));
  const [priority, setPriority] = useState<number>(Number(provider.priority) || 1);
  const [name, setName] = useState(provider.name || '');

  const meta = safeParseMetadata(provider.metadata);
  const [costPer1k, setCostPer1k] = useState<number>(Number(meta.costPer1k ?? 0) || 0.001);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (provider) {
      setBaseUrl(provider.baseUrl || '');
      setEnabled(isEnabledFlag(provider.enabled));
      setPriority(Number(provider.priority) || 1);
      setName(provider.name || '');
      const m = safeParseMetadata(provider.metadata);
      setCostPer1k(Number(m.costPer1k) || 0.001);
      setError(null);
      setSuccess(false);
    }
  }, [provider]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetchAdmin(`/api/admin/providers/${provider.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          enabled: Boolean(enabled),
          priority: Number(priority),
          metadata: {
            ...meta,
            costPer1k: Number(costPer1k)
          }
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update provider configuration');
      }

      setSuccess(true);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 400);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred while saving.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#DCEBFA] w-full max-w-[480px] overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-gradient-to-r from-[#F8FAFC] to-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#E0F2FE] text-[#0051C3] flex items-center justify-center font-bold border border-[#BAE6FD] shadow-2xs">
              <Sliders size={16} />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[#0F172A] leading-tight">
                Edit Provider Configuration
              </h3>
              <p className="text-[12px] text-[#64748B]">
                Configure routing priority, base endpoint, and operational state.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-[#64748B] hover:text-[#0F172A] p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-[13px]">
          {error && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-[#DC2626] text-[12px] flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-[#059669] text-[12px] flex items-center gap-2 font-medium">
              <Check size={16} className="shrink-0" />
              <span>Provider configuration updated successfully!</span>
            </div>
          )}

          <div>
            <label className="block font-semibold text-[#0F172A] mb-1.5">Provider Name</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)}
              required
              className="w-full h-9 px-3 bg-white border border-[#DCEBFA] rounded-lg text-[13px] text-[#0F172A] focus:ring-2 focus:ring-[#0051C3]/20 focus:border-[#0051C3] outline-none shadow-2xs font-medium"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#0F172A] mb-1.5">
              Base URL / Endpoint <span className="text-[#64748B] font-normal text-[11px]">(Pinged by health check worker)</span>
            </label>
            <input 
              type="url" 
              value={baseUrl} 
              onChange={e => setBaseUrl(e.target.value)}
              required
              placeholder="https://api.openai.com"
              className="w-full h-9 px-3 font-mono bg-white border border-[#DCEBFA] rounded-lg text-[12px] text-[#0F172A] focus:ring-2 focus:ring-[#0051C3]/20 focus:border-[#0051C3] outline-none shadow-2xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">
                Routing Priority <span className="text-[#64748B] font-normal text-[11px]">(1-5)</span>
              </label>
              <select 
                value={priority} 
                onChange={e => setPriority(Number(e.target.value))}
                className="w-full h-9 px-3 bg-white border border-[#DCEBFA] rounded-lg text-[13px] text-[#0F172A] outline-none shadow-2xs font-medium cursor-pointer"
              >
                <option value={1}>1 - Standard Fallback</option>
                <option value={2}>2 - Secondary</option>
                <option value={3}>3 - Primary Balanced</option>
                <option value={4}>4 - High Priority</option>
                <option value={5}>5 - Highest Priority</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">
                Cost / 1K Tokens ($)
              </label>
              <input 
                type="number" 
                step="0.00001" 
                min="0"
                value={costPer1k} 
                onChange={e => setCostPer1k(parseFloat(e.target.value) || 0)}
                className="w-full h-9 px-3 font-mono bg-white border border-[#DCEBFA] rounded-lg text-[13px] text-[#0F172A] outline-none shadow-2xs"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between">
            <div>
              <span className="font-semibold text-[#0F172A] block">Operational Status</span>
              <span className="text-[11px] text-[#64748B]">
                When disabled, router marks as Offline and bypasses this provider.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`flex items-center px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all cursor-pointer shadow-2xs ${
                enabled 
                  ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]' 
                  : 'bg-slate-100 text-slate-500 border border-slate-300'
              }`}
            >
              {enabled ? (
                <>
                  <ToggleRight size={18} className="mr-1.5" />
                  Enabled
                </>
              ) : (
                <>
                  <ToggleLeft size={18} className="mr-1.5" />
                  Disabled
                </>
              )}
            </button>
          </div>

          <div className="flex justify-end gap-2.5 pt-4 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-[#DCEBFA] text-[#475569] hover:bg-slate-50 font-medium cursor-pointer transition-colors shadow-2xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-[#0051C3] text-white hover:bg-[#003E99] font-semibold shadow-xs flex items-center cursor-pointer transition-colors"
            >
              {saving ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Check size={14} className="mr-2" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
