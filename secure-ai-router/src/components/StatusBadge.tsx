import React from 'react';

export type HealthStatus = 'Healthy' | 'Degraded' | 'Offline' | 'Disabled' | string;

interface StatusBadgeProps {
  status: HealthStatus;
  size?: 'sm' | 'md';
  showPulse?: boolean;
  className?: string;
  label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showPulse = true,
  className = '',
  label
}) => {
  const norm = String(status || '').toLowerCase();

  let colorClasses = 'bg-slate-100 text-slate-700 border-slate-200';
  let dotColor = 'bg-slate-500';
  let displayLabel = label || status || 'Unknown';

  if (norm === 'healthy' || norm === 'allowed' || norm === 'active') {
    colorClasses = 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    dotColor = 'bg-emerald-500';
    displayLabel = label || 'Healthy';
  } else if (norm === 'degraded' || norm === 'warning' || norm === 'challenged' || norm === 'simulated') {
    colorClasses = 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    dotColor = 'bg-amber-500';
    displayLabel = label || (norm === 'simulated' ? 'Simulated' : 'Degraded');
  } else if (norm === 'offline' || norm === 'disabled' || norm === 'blocked' || norm === 'critical') {
    colorClasses = 'bg-rose-500/10 text-rose-700 border-rose-500/20';
    dotColor = 'bg-rose-500';
    displayLabel = label || (norm === 'disabled' ? 'Disabled' : norm === 'offline' ? 'Offline' : 'Blocked');
  }

  const sizeClasses = size === 'sm' 
    ? 'text-[10px] px-2 py-0.5 gap-1.5' 
    : 'text-[11px] px-2.5 py-1 gap-1.5';

  return (
    <span 
      className={`inline-flex items-center font-bold rounded-full border shadow-2xs select-none transition-colors whitespace-nowrap ${sizeClasses} ${colorClasses} ${className}`}
    >
      <span 
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} ${
          showPulse && (norm === 'healthy' || norm === 'allowed' || norm === 'active') ? 'animate-pulse ring-2 ring-emerald-500/20' : ''
        }`} 
      />
      <span>{displayLabel}</span>
    </span>
  );
};
