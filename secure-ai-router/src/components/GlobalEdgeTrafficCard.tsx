import React from 'react';
import { Globe, ArrowUpRight, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface GlobalEdgeTrafficCardProps {
  totalRequests?: string;
  className?: string;
}

export const GlobalEdgeTrafficCard: React.FC<GlobalEdgeTrafficCardProps> = ({
  totalRequests = 'No data',
  className = ''
}) => {
  const navigate = useNavigate();

  return (
    <div className={`card-3d-glass p-3 sm:p-3.5 flex flex-col justify-between overflow-hidden h-full relative select-none ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-white to-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-white flex items-center justify-center text-blue-600 shrink-0">
            <Globe size={14} strokeWidth={2.3} />
          </div>
          <div>
            <h3 className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.08em] leading-tight">Gateway Traffic</h3>
            <span className="text-[9.5px] text-slate-500 leading-none">Observed request records only</span>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-800 font-semibold text-[10px] shadow-xs">Last 24h</span>
      </div>

      <div className="grid grid-cols-12 gap-2 my-auto items-center min-h-0">
        <div className="col-span-7 relative h-24 flex items-center justify-center">
          <svg viewBox="0 0 200 105" className="w-full h-full opacity-60" aria-hidden="true">
            <g fill="#CBD5E1">
              <path d="M 25,18 Q 45,15 58,28 Q 50,42 42,48 Q 28,40 22,30 Z" />
              <path d="M 48,54 Q 60,56 64,68 Q 58,88 52,94 Q 44,78 46,60 Z" />
              <path d="M 88,22 Q 106,20 110,32 Q 98,40 92,36 Q 84,30 88,22 Z" />
              <path d="M 90,44 Q 112,42 118,56 Q 112,82 100,88 Q 92,72 88,54 Z" />
              <path d="M 116,18 Q 160,16 172,38 Q 160,62 138,58 Q 124,42 118,30 Z" />
              <path d="M 152,72 Q 172,70 174,84 Q 162,92 148,86 Z" />
            </g>
            <circle cx="98" cy="48" r="4" fill="#0051C3" />
            <circle cx="98" cy="48" r="12" fill="none" stroke="#0051C3" strokeWidth="1.2" opacity="0.45" className="animate-ping" />
          </svg>
        </div>
        <div className="col-span-5 flex flex-col gap-2 pl-1.5 border-l border-slate-200/70 text-[10px]">
          <div className="rounded-lg border border-[#E2E8F0] bg-white/80 p-2">
            <div className="flex items-center gap-1.5 text-[#64748B]"><Database size={11} /> Source</div>
            <div className="mt-1 font-bold text-[#0F172A]">requests table</div>
          </div>
          <div className="rounded-lg border border-[#E2E8F0] bg-white/80 p-2">
            <div className="text-[#64748B]">Regional split</div>
            <div className="mt-1 font-bold text-[#0F172A]">No data</div>
          </div>
        </div>
      </div>

      <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[13px] font-black text-slate-900 font-mono leading-none truncate">{totalRequests}</span>
          <span className="text-[9px] text-slate-500 shrink-0">observed requests</span>
        </div>
        <button
          onClick={() => navigate('/analytics')}
          className="text-[9.5px] font-bold text-[#0051C3] hover:underline cursor-pointer flex items-center gap-0.5 shrink-0"
        >
          Detailed analytics <ArrowUpRight size={9} />
        </button>
      </div>
    </div>
  );
};
