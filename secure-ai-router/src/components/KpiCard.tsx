import React from 'react';
import { ArrowUpRight, ArrowDownRight, Info, type LucideIcon } from 'lucide-react';

export interface KpiCardProps {
  title: string;
  value: string | number;
  rawExactValue?: string | number;
  trend?: string;
  trendType?: 'positive' | 'negative' | 'neutral';
  subtitle: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  progressPercent?: number;
  className?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  rawExactValue,
  trend,
  trendType,
  subtitle,
  icon: Icon,
  iconColor = '#0051C3',
  iconBg,
  progressPercent,
  className = ''
}) => {
  const isUp = trend?.startsWith('↑') || trend?.startsWith('+');
  const isThreatsOrErrors = title.toLowerCase().includes('threat') || title.toLowerCase().includes('error');
  
  const isPositive = trendType 
    ? trendType === 'positive' 
    : isThreatsOrErrors ? !isUp : isUp;

  // Determine status badge color scheme
  const getPillClasses = () => {
    if (trend?.includes('All online')) {
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    }
    if (isThreatsOrErrors) {
      // For threats, an increase is alert (rose), decrease is healthy (emerald)
      return isUp 
        ? 'bg-rose-500/10 text-rose-700 border-rose-500/20' 
        : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    }
    return isPositive 
      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' 
      : 'bg-amber-500/10 text-amber-700 border-amber-500/20';
  };

  return (
    <div 
      className={`card-3d-glass p-2.5 sm:p-3 flex flex-col justify-between min-w-0 min-h-[86px] gap-1.5 relative select-none cursor-default group hover:shadow-md transition-all ${className}`}
      title={rawExactValue ? `${title}: ${rawExactValue}` : undefined}
    >
      {/* 1. Header with icon, title and Info Icon */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div 
            className="w-6 h-6 rounded-lg flex items-center justify-center bg-gradient-to-br from-white to-slate-100 border border-slate-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0 transition-transform group-hover:scale-105"
            style={{ color: iconColor }}
          >
            <Icon size={12} strokeWidth={2.2} />
          </div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider truncate">
            {title}
          </span>
        </div>

        <button 
          type="button"
          className="text-slate-300 hover:text-slate-500 transition-colors cursor-pointer shrink-0 p-0.5" 
          title="Metric details"
        >
          <Info size={10} />
        </button>
      </div>

      {/* 2. Main Metric Value and Trend Badge */}
      <div className="flex items-baseline justify-between gap-1.5 flex-nowrap my-auto min-w-0">
        <div className="text-[17px] sm:text-[18px] font-bold text-slate-800 tracking-tight leading-none font-mono">
          {value}
        </div>

        {trend && (
          <span 
            className={`inline-flex items-center font-medium text-[9px] px-1.5 py-0.5 rounded-full border shadow-2xs shrink-0 whitespace-nowrap ${getPillClasses()}`}
          >
            {trend.includes('All online') ? (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
            ) : isUp ? (
              <ArrowUpRight size={9} className="mr-0.5 shrink-0" strokeWidth={2.4} />
            ) : (
              <ArrowDownRight size={9} className="mr-0.5 shrink-0" strokeWidth={2.4} />
            )}
            {trend}
          </span>
        )}

        {/* Optional Progress pill for Runtime Memory */}
        {progressPercent !== undefined && !trend && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-8 bg-slate-100 rounded-full h-1.5 overflow-hidden border border-slate-200">
              <div 
                className="bg-[#0051C3] h-full rounded-full transition-all duration-500" 
                style={{ width: `${progressPercent}%` }} 
              />
            </div>
            <span className="text-[9px] font-semibold text-[#0051C3] font-mono">
              {progressPercent}%
            </span>
          </div>
        )}
      </div>

      {/* 3. Subtitle / Context description */}
      <div className="text-[9.5px] text-slate-400 truncate font-normal leading-none">
        {subtitle}
      </div>
    </div>
  );
};
