import React, { useState, useMemo } from 'react';
import { GitMerge, Search, Code, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { RoutingDecision } from '../types';
import { formatDateTime, formatFullDateTime, formatLatency } from '../utils/formatters';

interface RecentDecisionsTableProps {
  history: RoutingDecision[];
  className?: string;
}

export const RecentDecisionsTable: React.FC<RecentDecisionsTableProps> = ({
  history = [],
  className = ''
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // Extract unique request types for filtering
  const requestTypes = useMemo(() => {
    const types = new Set<string>();
    history.forEach(item => {
      if (item.requestType) types.add(item.requestType);
    });
    return Array.from(types);
  }, [history]);

  // Filtered dataset
  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const term = searchTerm.toLowerCase();
      const matchesSearch = !term || 
        item.requestType?.toLowerCase().includes(term) ||
        item.selectedModel?.toLowerCase().includes(term) ||
        item.routingReason?.toLowerCase().includes(term);

      const matchesType = selectedType === 'ALL' || item.requestType === selectedType;
      return matchesSearch && matchesType;
    });
  }, [history, searchTerm, selectedType]);

  // Pagination calculation
  const totalItems = filteredHistory.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const startIndex = (validCurrentPage - 1) * pageSize;
    return filteredHistory.slice(startIndex, startIndex + pageSize);
  }, [filteredHistory, validCurrentPage, pageSize]);

  return (
    <div 
      className={`card-3d-glass p-3 sm:p-3.5 flex flex-col justify-between overflow-hidden h-full select-none ${className}`}
    >
      
      {/* Table Header Controls */}
      <div className="flex items-center justify-between gap-2 mb-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-white to-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-white flex items-center justify-center text-blue-600 shrink-0">
            <GitMerge size={13} strokeWidth={2.3} />
          </div>
          <div>
            <h3 className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.08em] leading-tight">
              Recent AI Routing Decisions
            </h3>
            <span className="text-[9.5px] text-slate-500 leading-none">
              Latency & policy-aware provider routing
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Type Filter */}
          <div className="relative">
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-white border border-slate-200 rounded-full px-2 py-0.5 text-[10px] text-slate-600 outline-none shadow-xs font-semibold cursor-pointer"
            >
              <option value="ALL">All Types</option>
              {requestTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search..."
              className="bg-white border border-slate-200 rounded-full pl-6 pr-2 py-0.5 text-[10px] text-slate-800 outline-none shadow-xs placeholder:text-gray-400 w-24 focus:border-blue-600"
            />
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-x-auto overflow-y-auto border border-slate-200/80 rounded-xl bg-white/70 min-h-0">
        <table className="w-full text-left text-[11.5px] border-collapse min-w-[480px]">
          <thead className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider bg-slate-50/90 border-b border-slate-200 sticky top-0 backdrop-blur z-10">
            <tr>
              <th className="py-1 px-2.5 w-[80px]">Time</th>
              <th className="py-1 px-2.5">Request Type</th>
              <th className="py-1 px-2.5">Selected Model</th>
              <th className="py-1 px-2.5">Reason</th>
              <th className="py-1 px-2.5 text-right w-[70px]">Latency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 font-medium text-slate-700">
            {paginatedItems.map((item, idx) => (
              <tr 
                key={item.id || idx} 
                className="hover:bg-slate-50/80 transition-colors group"
                title={`Request at ${formatFullDateTime(item.timestamp)}`}
              >
                <td className="py-1 px-2.5 text-slate-500 font-mono text-[10.5px] whitespace-nowrap">
                  {formatDateTime(item.timestamp)}
                </td>

                <td className="py-1 px-2.5 font-semibold text-slate-900 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <Code size={11} className="text-blue-600 shrink-0" />
                    <span>{item.requestType}</span>
                  </div>
                </td>

                <td className="py-1 px-2.5 text-slate-900 font-medium whitespace-nowrap">
                  <span className="px-1.5 py-0.2 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono font-medium">
                    {item.selectedModel}
                  </span>
                </td>

                <td className="py-1 px-2.5 text-slate-600 whitespace-nowrap text-[10.5px]" title={item.routingReason}>
                  {item.routingReason}
                </td>

                <td className="py-1 px-2.5 text-right font-mono text-slate-900 font-semibold whitespace-nowrap text-[10.5px]">
                  {formatLatency(item.latency)}
                </td>
              </tr>
            ))}

            {paginatedItems.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500 text-[11px]">
                  No matching routing decisions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between pt-1.5 text-[10px] text-slate-500 border-t border-slate-200/60 mt-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <span>Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-white border border-slate-200 rounded px-1 py-0.2 text-[10px] font-medium outline-none cursor-pointer"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
          </select>
          <span className="text-slate-300">|</span>
          <span>
            {totalItems === 0 
              ? '0 results' 
              : `${(validCurrentPage - 1) * pageSize + 1}-${Math.min(validCurrentPage * pageSize, totalItems)} of ${totalItems}`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={validCurrentPage <= 1}
            className="p-0.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs"
            title="Previous page"
          >
            <ChevronLeft size={12} />
          </button>
          <span className="font-semibold text-slate-800 px-1">
            {validCurrentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={validCurrentPage >= totalPages}
            className="p-0.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs"
            title="Next page"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

    </div>
  );
};
