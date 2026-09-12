export function formatTopologyLatency(ms: number | null | undefined): string {
  if (!Number.isFinite(ms ?? NaN) || (ms ?? 0) <= 0) return 'No latency';
  const value = Number(ms);
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

export function formatTopologyPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '0%';
  const percent = Number(value);
  if (percent === 0 || percent === 100) return `${percent}%`;
  return `${percent.toFixed(1)}%`;
}

export function formatTopologyCount(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) return '0';
  const count = Number(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return `${Math.round(count)}`;
}
