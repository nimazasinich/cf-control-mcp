import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, XCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { DashboardData, OperationalAlert } from '../types';
import { formatRelativeTime } from '../utils/formatters';

interface AlertsViewProps {
  data: DashboardData;
}

function alertAction(alert: OperationalAlert): { label: string; path: string } {
  if (alert.actionLabel && alert.actionPath) return { label: alert.actionLabel, path: alert.actionPath };
  if (alert.type.includes('provider')) return { label: 'Manage Providers', path: '/providers' };
  if (alert.type.includes('security') || alert.type.includes('policy')) return { label: 'View Firewall', path: '/firewall' };
  return { label: 'Open Settings', path: '/settings' };
}

export const AlertsView: React.FC<AlertsViewProps> = ({ data }) => {
  const navigate = useNavigate();
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'high' | 'medium'>('all');

  const alerts = useMemo(() => {
    return (data.alerts ?? []).slice().sort((a, b) => b.timestamp - a.timestamp);
  }, [data.alerts]);

  const filteredAlerts = alerts.filter((alert) => severityFilter === 'all' || alert.severity === severityFilter);
  const criticalCount = alerts.filter((alert) => alert.severity === 'critical').length;

  return (
    <div className="flex flex-col gap-3 h-full w-full select-none overflow-y-auto pr-1">
      <div className="card-3d-glass p-3.5 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center border border-rose-500/20 shadow-2xs">
              <Bell size={14} strokeWidth={2.2} />
            </div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">System Operational Alerts ({alerts.length})</h2>
            {criticalCount > 0 && (
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-700 font-bold border border-rose-500/20">
                {criticalCount} Critical
              </span>
            )}
          </div>
          <p className="text-[10.5px] text-[#475569] mt-1">
            Server-derived alerts from provider health and security event records. No simulated timestamps or synthetic incidents.
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-white border border-[#DCEBFA] rounded-lg p-0.5 text-[11px]">
          {(['all', 'critical', 'high', 'medium'] as const).map((severity) => (
            <button
              key={severity}
              onClick={() => setSeverityFilter(severity)}
              className={`px-2.5 py-1 rounded-md capitalize font-medium transition-all cursor-pointer ${
                severityFilter === severity
                  ? 'bg-[#0051C3] text-white font-bold shadow-2xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              {severity}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto">
        {filteredAlerts.map((alert) => {
          const isCritical = alert.severity === 'critical';
          const isHigh = alert.severity === 'high';
          const action = alertAction(alert);
          return (
            <div
              key={alert.id}
              className={`card-3d-glass p-3.5 flex items-start justify-between gap-4 border transition-all ${
                isCritical
                  ? 'border-red-200/80 bg-red-50/20'
                  : isHigh
                    ? 'border-amber-200/80 bg-amber-50/20'
                    : 'border-[#DCEBFA]'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isCritical ? 'bg-[#EF4444]/15 text-[#EF4444]' : isHigh ? 'bg-[#F59E0B]/15 text-[#D97706]' : 'bg-[#0051C3]/15 text-[#0051C3]'
                }`}>
                  {isCritical ? <XCircle size={18} /> : <AlertTriangle size={18} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-[13px] font-bold text-[#0F172A] truncate" title={alert.title}>{alert.title}</h3>
                    <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold uppercase border shrink-0 ${
                      isCritical
                        ? 'bg-[#EF4444]/15 text-[#DC2626] border-[#EF4444]/30'
                        : isHigh
                          ? 'bg-[#F59E0B]/15 text-[#D97706] border-[#F59E0B]/30'
                          : 'bg-blue-100 text-blue-700 border-blue-200'
                    }`}>
                      {alert.severity}
                    </span>
                    <span className="text-[10px] text-[#64748B] font-mono shrink-0">{alert.source ?? alert.type}</span>
                  </div>
                  <p className="text-[11px] text-[#64748B] mt-1 max-w-[750px] break-words">{alert.detail || 'No additional detail recorded.'}</p>
                  <div className="text-[9.5px] text-[#64748B] mt-1 font-mono">Triggered: {formatRelativeTime(alert.timestamp)}</div>
                </div>
              </div>
              <button
                onClick={() => navigate(action.path)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#DCEBFA] text-[#0051C3] font-semibold text-[11px] hover:bg-[#F5FAFF] shadow-2xs shrink-0 cursor-pointer"
              >
                <span>{action.label}</span>
                <ArrowRight size={12} />
              </button>
            </div>
          );
        })}

        {filteredAlerts.length === 0 && (
          <div className="card-3d-glass p-12 text-center flex flex-col items-center justify-center">
            <CheckCircle2 size={32} className="text-[#10B981] mb-2" />
            <h3 className="text-[14px] font-bold text-[#0F172A]">No Active Alerts</h3>
            <p className="text-[11px] text-[#64748B] mt-1">No server-derived warnings or degradation alerts in the current window.</p>
          </div>
        )}
      </div>
    </div>
  );
};
