/**
 * Formatting utilities for enterprise operational ranges
 */

export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    const val = abs / 1_000_000_000;
    return `${sign}${val >= 10 ? val.toFixed(1) : val.toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    const val = abs / 1_000_000;
    return `${sign}${val >= 10 ? val.toFixed(1) : val.toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    const val = abs / 1_000;
    return `${sign}${val >= 10 ? val.toFixed(1) : val.toFixed(1)}K`;
  }
  return `${sign}${Math.round(abs)}`;
}

export function formatExactNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return num.toLocaleString();
}

export function formatLatency(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '0 ms';
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${Math.round(ms)} ms`;
}

export function formatBytes(valInGB: number | undefined | null): string {
  if (valInGB === undefined || valInGB === null || isNaN(valInGB)) return '0 GB';
  if (valInGB < 1) {
    return `${Math.round(valInGB * 1024)} MB`;
  }
  return `${valInGB.toFixed(1)} GB`;
}

export function formatCurrency(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0.00';
  if (amount < 0.01 && amount > 0) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

export function formatRelativeTime(timestamp: number | undefined | null): string {
  if (!timestamp) return 'just now';
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

export function formatDateTime(timestamp: number | undefined | null): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatFullDateTime(timestamp: number | undefined | null): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

export function isEnabledFlag(value: unknown): boolean {
  return value !== false && value !== 0 && value !== '0' && value !== 'false';
}

export function safeParseMetadata(meta: unknown): Record<string, unknown> {
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  }
  return {};
}
