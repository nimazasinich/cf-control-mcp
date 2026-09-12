export interface RailLayout {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  startIndex: number;
  endIndex: number;
  positions: number[];
}

export interface RailLayoutOptions {
  nodeHeight?: number;
  minGap?: number;
  maxPerPage?: number;
}

const DEFAULT_NODE_HEIGHT = 56;
const DEFAULT_MIN_GAP = 8;
const DEFAULT_MAX_PER_PAGE = 6;

export function computeRailPageSize(
  availableHeight: number,
  options: RailLayoutOptions = {},
): number {
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const minGap = options.minGap ?? DEFAULT_MIN_GAP;
  const maxPerPage = options.maxPerPage ?? DEFAULT_MAX_PER_PAGE;
  const safeHeight = Math.max(0, availableHeight);
  const fit = Math.floor((safeHeight + minGap) / (nodeHeight + minGap));
  return Math.max(1, Math.min(maxPerPage, fit || 1));
}

export function buildRailLayout(
  totalCount: number,
  availableHeight: number,
  requestedPageIndex: number,
  options: RailLayoutOptions = {},
): RailLayout {
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const minGap = options.minGap ?? DEFAULT_MIN_GAP;
  const pageSize = computeRailPageSize(availableHeight, options);
  const pageCount = Math.max(1, Math.ceil(Math.max(0, totalCount) / pageSize));
  const pageIndex = Math.min(Math.max(0, requestedPageIndex), pageCount - 1);
  const startIndex = Math.min(totalCount, pageIndex * pageSize);
  const visibleCount = Math.min(pageSize, Math.max(0, totalCount - startIndex));
  const endIndex = startIndex + visibleCount;

  if (visibleCount === 0) {
    return { pageIndex, pageSize, pageCount, startIndex, endIndex, positions: [] };
  }

  if (visibleCount === 1) {
    return {
      pageIndex,
      pageSize,
      pageCount,
      startIndex,
      endIndex,
      positions: [Math.max(0, (availableHeight - nodeHeight) / 2)],
    };
  }

  const naturalGap = (availableHeight - visibleCount * nodeHeight) / (visibleCount - 1);
  const gap = Math.max(minGap, naturalGap);
  const usedHeight = visibleCount * nodeHeight + (visibleCount - 1) * gap;
  const startY = Math.max(0, (availableHeight - usedHeight) / 2);
  const positions = Array.from(
    { length: visibleCount },
    (_, index) => startY + index * (nodeHeight + gap),
  );

  return { pageIndex, pageSize, pageCount, startIndex, endIndex, positions };
}

export function pageItems<T>(items: readonly T[], layout: Pick<RailLayout, 'startIndex' | 'endIndex'>): T[] {
  return items.slice(layout.startIndex, layout.endIndex);
}
