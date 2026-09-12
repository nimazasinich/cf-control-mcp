import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronLeft, ChevronRight, Database, Globe, RefreshCw, Server, Share2 } from 'lucide-react';
import { WorldMapPattern } from './WorldMapPattern';
import { CloudflareCloudLogo } from './ProviderLogos';
import { DashboardData, Provider, TopologyApplicationNode, TopologyProviderNode } from '../types';
import { buildRailLayout, pageItems } from '../topology/layout';
import { formatTopologyCount, formatTopologyLatency, formatTopologyPercent } from '../topology/format';

interface TopologyMapProps {
  data: DashboardData;
  onSelectProvider?: (provider: Provider) => void;
  onSelectSource?: (source: TopologyApplicationNode) => void;
  timeRange?: string;
  onTimeRangeChange?: (range: string) => void;
}

interface PathDef {
  id: string;
  d: string;
  color: string;
  isDashed: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const NODE_HEIGHT = 56;
const MIN_GAP = 8;
const MAX_NODES_PER_PAGE = 6;

const healthColors: Record<TopologyProviderNode['health'], string> = {
  healthy: '#10B981',
  degraded: '#F59E0B',
  offline: '#EF4444',
  disabled: '#94A3B8',
  unknown: '#64748B',
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function titleCase(value: string): string {
  if (!value) return 'Unknown';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pathToRouter(
  side: 'left' | 'right',
  railX: number,
  nodeCenterY: number,
  centerX: number,
  centerY: number,
  radius: number,
  ordinal: number,
  visibleCount: number,
): PathDef {
  const denom = Math.max(1, visibleCount - 1);
  const normalized = visibleCount === 1 ? 0 : (ordinal - denom / 2) / (denom / 2);
  const routerY = centerY + normalized * radius * 0.32;
  const routerX = side === 'left' ? centerX - radius : centerX + radius;
  const startX = side === 'left' ? railX : routerX;
  const endX = side === 'left' ? routerX : railX;
  const startY = side === 'left' ? nodeCenterY : routerY;
  const endY = side === 'left' ? routerY : nodeCenterY;
  const dx = endX - startX;
  return {
    id: `${side}-${ordinal}-${Math.round(nodeCenterY)}`,
    d: `M ${startX} ${startY} C ${startX + dx * 0.42} ${startY}, ${endX - dx * 0.42} ${endY}, ${endX} ${endY}`,
    color: side === 'left' ? '#0051C3' : '#10B981',
    isDashed: side === 'right',
    startX,
    startY,
    endX,
    endY,
  };
}

export const TopologyMap: React.FC<TopologyMapProps> = ({
  data,
  onSelectProvider,
  onSelectSource,
  timeRange = 'Last 24 hours',
  onTimeRangeChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 960, height: 440 });
  const [selectedTimeframe, setSelectedTimeframe] = useState(timeRange);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [sourcePage, setSourcePage] = useState(0);
  const [providerPage, setProviderPage] = useState(0);

  const topology = data.topology?.nodes;
  const applicationNodes: TopologyApplicationNode[] = topology?.applications ?? [];
  const providerNodes: TopologyProviderNode[] = topology?.providers ?? [];
  const totalRequests = topology?.router.totalRequestsLast24h ?? 0;

  const providerById = useMemo(() => {
    return new Map((data.providers ?? []).map((provider) => [provider.id, provider]));
  }, [data.providers]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDimensions({ width, height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const width = Math.max(320, dimensions.width);
    const height = Math.max(260, dimensions.height);
    const railWidth = width < 760 ? 176 : 208;
    const railTop = 28;
    const railFooter = 28;
    const railHeight = Math.max(96, height - railTop - railFooter);
    const radius = width < 760 ? 52 : 62;
    const diameter = radius * 2;
    const centerX = width / 2;
    const centerY = height / 2;
    const sourceLayout = buildRailLayout(applicationNodes.length, railHeight, sourcePage, {
      nodeHeight: NODE_HEIGHT,
      minGap: MIN_GAP,
      maxPerPage: MAX_NODES_PER_PAGE,
    });
    const providerLayout = buildRailLayout(providerNodes.length, railHeight, providerPage, {
      nodeHeight: NODE_HEIGHT,
      minGap: MIN_GAP,
      maxPerPage: MAX_NODES_PER_PAGE,
    });

    const visibleSources = pageItems<TopologyApplicationNode>(applicationNodes, sourceLayout);
    const visibleProviders = pageItems<TopologyProviderNode>(providerNodes, providerLayout);
    const leftPinX = railWidth;
    const rightPinX = width - railWidth;
    const leftPaths = visibleSources.map((source, index) => {
      const nodeCenterY = railTop + sourceLayout.positions[index] + NODE_HEIGHT / 2;
      return {
        ...pathToRouter('left', leftPinX, nodeCenterY, centerX, centerY, radius, index, visibleSources.length),
        id: `source-${source.id}`,
        color: source.sourceStatus === 'classified' ? '#0051C3' : '#64748B',
        isDashed: source.sourceStatus !== 'classified',
      };
    });
    const observedProviders = visibleProviders.filter((provider) => provider.connectionState === 'observed' && provider.requestsLast24h > 0);
    const rightPaths = observedProviders.map((provider, index) => {
      const visibleIndex = visibleProviders.findIndex((item) => item.id === provider.id);
      const nodeCenterY = railTop + providerLayout.positions[visibleIndex] + NODE_HEIGHT / 2;
      return {
        ...pathToRouter('right', rightPinX, nodeCenterY, centerX, centerY, radius, index, observedProviders.length),
        id: `provider-${provider.id}`,
        color: healthColors[provider.health] ?? '#64748B',
        isDashed: provider.health !== 'healthy',
      };
    });

    return {
      width,
      height,
      railWidth,
      railTop,
      railHeight,
      radius,
      diameter,
      centerX,
      centerY,
      sourceLayout,
      providerLayout,
      visibleSources,
      visibleProviders,
      leftPaths,
      rightPaths,
    };
  }, [applicationNodes, providerNodes, dimensions, sourcePage, providerPage]);

  useEffect(() => {
    setSourcePage((current) => Math.min(current, geometry.sourceLayout.pageCount - 1));
    setProviderPage((current) => Math.min(current, geometry.providerLayout.pageCount - 1));
  }, [geometry.sourceLayout.pageCount, geometry.providerLayout.pageCount]);

  const timeframeOptions = ['Last 1 hour', 'Last 24 hours', 'Last 7 days'];

  return (
    <div className="card-3d-glass p-3 flex h-full min-h-0 w-full flex-col overflow-hidden select-none">
      <div className="z-30 mb-2 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#BAE6FD] bg-[#E0F2FE] text-[#0051C3] shadow-2xs">
            <Share2 size={15} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold leading-tight text-[#0F172A] sm:text-[16px]">
              Global AI Traffic Topology
            </h2>
            <p className="truncate text-[11px] text-[#475569] sm:text-[11.5px]">
              Backend-driven topology: observed sources → Cloudflare edge → AI router → configured and observed providers.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <div className="flex items-center gap-2 font-semibold text-[#1E293B]">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#10B981]" /> Healthy</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#F59E0B]" /> Degraded</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#EF4444]" /> Offline</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#94A3B8]" /> Configured</span>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowTimeDropdown(!showTimeDropdown)}
              className="flex items-center gap-1.5 rounded-full border border-[#DCEBFA] bg-white px-3 py-1 text-[11.5px] font-semibold text-[#0F172A] shadow-2xs transition-colors hover:bg-slate-50"
            >
              <span>{selectedTimeframe}</span>
            </button>
            {showTimeDropdown && (
              <div className="absolute right-0 top-full z-40 mt-1 w-36 rounded-xl border border-[#E2E8F0] bg-white py-1 text-[11.5px] shadow-lg">
                {timeframeOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      setSelectedTimeframe(option);
                      setShowTimeDropdown(false);
                      onTimeRangeChange?.(option);
                    }}
                    className="w-full px-3 py-1.5 text-left font-medium text-[#0F172A] hover:bg-slate-50"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-0 w-full flex-1 overflow-hidden rounded-xl">
        <WorldMapPattern />
        <svg
          className="absolute inset-0 z-10 h-full w-full overflow-hidden pointer-events-none"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <style>{`@keyframes flowAnim { from { stroke-dashoffset: 28; } to { stroke-dashoffset: 0; } } .flow-dashed { animation: flowAnim 1.4s linear infinite; }`}</style>

          {[...geometry.leftPaths, ...geometry.rightPaths].map((path) => (
            <g key={path.id}>
              <path d={path.d} fill="none" stroke={path.color} strokeWidth="5" opacity="0.18" strokeLinecap="round" />
              <path
                d={path.d}
                fill="none"
                stroke={path.color}
                strokeWidth="2.2"
                strokeDasharray={path.isDashed ? '6 5' : undefined}
                className={path.isDashed ? 'flow-dashed' : undefined}
                opacity="0.9"
                strokeLinecap="round"
                filter="url(#lineGlow)"
              />
              <circle cx={path.startX} cy={path.startY} r="3.5" fill={path.color} stroke="#FFFFFF" strokeWidth="1.2" />
              <circle cx={path.endX} cy={path.endY} r="2.5" fill={path.color} opacity="0.85" />
            </g>
          ))}
        </svg>

        <div className="absolute left-0 top-0 bottom-0 z-20 flex flex-col py-1 pointer-events-auto" style={{ width: geometry.railWidth }}>
          <RailHeader title="Application Sources" count={applicationNodes.length} layout={geometry.sourceLayout} page={sourcePage} onPage={setSourcePage} />
          <div className="relative flex-1 min-h-0">
            {geometry.visibleSources.length === 0 ? (
              <EmptyRail label="No observed sources" detail="No data" side="left" />
            ) : geometry.visibleSources.map((source, index) => (
              <button
                key={source.id}
                onClick={() => onSelectSource?.(source)}
                title={`${source.label} · ${source.type} · ${formatTopologyCount(source.requestsLast24h)} requests`}
                className="absolute left-0 right-1 rounded-xl border border-[#E2E8F0]/90 bg-gradient-to-b from-white to-[#F8FAFC] px-2.5 py-1.5 text-left shadow-[0_2px_5px_-1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#BAE6FD] hover:shadow-md"
                style={{ top: geometry.sourceLayout.positions[index], height: NODE_HEIGHT }}
              >
                <div className="flex h-full min-w-0 items-center gap-2">
                  <div className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/60', source.sourceStatus === 'classified' ? 'bg-[#E0F2FE] text-[#0284C7]' : 'bg-slate-100 text-slate-500')}>
                    {source.sourceStatus === 'classified' ? <Globe size={14} /> : <Database size={14} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-bold leading-tight text-[#0F172A]">{source.label}</div>
                    <div className="truncate font-mono text-[9.5px] leading-tight text-[#64748B]">
                      {formatTopologyCount(source.requestsLast24h)} req · {formatTopologyPercent(source.trafficSharePct)}
                    </div>
                    <div className="truncate text-[8.5px] font-medium leading-tight text-[#64748B]">
                      {source.sourceStatus === 'classified' ? source.type : 'Unclassified'}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div
          className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center pointer-events-auto"
          style={{ left: geometry.centerX, top: geometry.centerY, width: geometry.diameter, height: geometry.diameter }}
        >
          <div className="absolute -inset-4 -z-10 rounded-full opacity-75 blur-xl" style={{ background: 'radial-gradient(circle, rgba(249, 115, 22, 0.35) 0%, rgba(22, 119, 255, 0.15) 55%, transparent 75%)' }} />
          <div className="orb-3d-emissive h-full w-full transition-transform duration-300 hover:scale-[1.04]">
            <div className="mb-0.5 drop-shadow-[0_2px_4px_rgba(243,128,32,0.35)]">
              <CloudflareCloudLogo size={Math.max(26, geometry.radius * 0.52)} />
            </div>
            <span className="text-[11px] font-bold leading-tight text-[#0F172A]">Cloudflare</span>
            <span className="text-[13px] font-black leading-tight tracking-tight text-[#0F172A]">AI Router</span>
            <span className="mt-0.5 text-[8px] font-semibold tracking-wide text-[#64748B]">
              {formatTopologyCount(totalRequests)} observed req
            </span>
          </div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 z-20 flex flex-col py-1 pointer-events-auto" style={{ width: geometry.railWidth }}>
          <RailHeader title="AI Model Providers" count={providerNodes.length} layout={geometry.providerLayout} page={providerPage} onPage={setProviderPage} align="right" />
          <div className="relative flex-1 min-h-0">
            {geometry.visibleProviders.length === 0 ? (
              <EmptyRail label="No providers configured" detail="No data" side="right" />
            ) : geometry.visibleProviders.map((provider, index) => {
              const configuredProvider = providerById.get(provider.id);
              return (
                <button
                  key={provider.id}
                  onClick={() => configuredProvider && onSelectProvider?.(configuredProvider)}
                  disabled={!configuredProvider}
                  title={`${provider.label} · ${titleCase(provider.health)} · ${formatTopologyCount(provider.requestsLast24h)} observed requests`}
                  className={cx(
                    'absolute left-1 right-0 rounded-xl border border-[#E2E8F0]/90 bg-gradient-to-b from-white to-[#F8FAFC] px-2.5 py-1.5 text-left shadow-[0_2px_5px_-1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)] transition-all',
                    configuredProvider && 'hover:-translate-y-0.5 hover:border-[#BAE6FD] hover:shadow-md',
                    !configuredProvider && 'cursor-default opacity-85',
                  )}
                  style={{ top: geometry.providerLayout.positions[index], height: NODE_HEIGHT }}
                >
                  <div className="flex h-full min-w-0 items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-[#0051C3]">
                      <Bot size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-bold leading-tight text-[#0F172A]">{provider.label}</div>
                      <div className="truncate font-mono text-[9.5px] leading-tight text-[#64748B]">
                        {formatTopologyLatency(provider.avgLatencyMs)} · {formatTopologyPercent(provider.trafficSharePct)}
                      </div>
                      <div className="truncate text-[8.5px] font-medium leading-tight text-[#64748B]">
                        {provider.connectionState === 'observed' ? 'Observed traffic' : 'Configured · no observed traffic'} · {provider.modelCount} models
                      </div>
                    </div>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: healthColors[provider.health] ?? '#64748B' }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="absolute bottom-1 left-1/2 z-20 -translate-x-1/2 pointer-events-auto">
          <div className="flex items-center gap-1.5 rounded-full border border-[#DCEBFA] bg-white/95 px-3 py-0.5 text-[#475569] shadow-[0_2px_6px_rgba(15,23,42,0.06),inset_0_1px_0_#FFFFFF]">
            <Server size={11} className="text-[#0051C3]" />
            <span className="text-[9px] font-medium">{topology?.edge.label ?? 'Cloudflare Edge'} · {formatTopologyCount(totalRequests)} observed requests</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface RailHeaderProps {
  title: string;
  count: number;
  layout: ReturnType<typeof buildRailLayout>;
  page: number;
  onPage: (page: number) => void;
  align?: 'left' | 'right';
}

const RailHeader: React.FC<RailHeaderProps> = ({ title, count, layout, page, onPage, align = 'left' }) => {
  const hasPages = layout.pageCount > 1;
  return (
    <div className={cx('mb-1 flex h-6 items-center gap-1 px-1 text-[11.5px] font-bold text-[#0F172A]', align === 'right' ? 'justify-end text-right' : 'justify-start')}>
      <span className="min-w-0 truncate">{title}</span>
      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-[#64748B]">{count}</span>
      {hasPages && (
        <div className="ml-1 flex items-center gap-0.5 rounded-full border border-[#E2E8F0] bg-white px-1 py-0.5 font-mono text-[9px] text-[#64748B]">
          <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} className="disabled:opacity-35" aria-label={`Previous ${title} page`}>
            <ChevronLeft size={11} />
          </button>
          <span>{layout.startIndex + 1}-{layout.endIndex}/{count}</span>
          <button onClick={() => onPage(Math.min(layout.pageCount - 1, page + 1))} disabled={page >= layout.pageCount - 1} className="disabled:opacity-35" aria-label={`Next ${title} page`}>
            <ChevronRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
};

const EmptyRail: React.FC<{ label: string; detail: string; side: 'left' | 'right' }> = ({ label, detail, side }) => (
  <div className={cx('absolute top-1/2 w-[calc(100%-0.25rem)] -translate-y-1/2 rounded-xl border border-dashed border-[#CBD5E1] bg-white/80 p-3 text-[11px] text-[#64748B]', side === 'right' ? 'right-0 text-right' : 'left-0')}>
    <div className="font-bold text-[#0F172A]">{label}</div>
    <div className="mt-0.5 font-medium">{detail}</div>
  </div>
);
