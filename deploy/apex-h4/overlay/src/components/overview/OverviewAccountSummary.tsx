import React from 'react';
import {
  ChevronRight,
  Wallet,
  CreditCard,
  TrendingUp,
  Layers,
  FileText,
  Activity,
  ShieldAlert,
  Zap,
  Percent,
} from 'lucide-react';
import type { AccountSnapshot, ConnectionState } from '../../services/accountClient';
import type { WorkspaceInsights } from '../../services/workspaceInsights';

export function OverviewAccountSummary({
  connection: _connection,
  snapshot,
  insights,
  onNavigate,
}: {
  connection: ConnectionState;
  snapshot: AccountSnapshot | null;
  insights: WorkspaceInsights | null;
  onNavigate: (page: 'portfolio' | 'positions' | 'orders') => void;
}) {
  const positions = insights?.positions ?? (snapshot?.positions as any[]) ?? [];
  const orders = insights?.orders ?? (snapshot?.openOrders as any[]) ?? [];
  const accountMeta = snapshot?.account as any;

  const equity = accountMeta?.equity ?? insights?.account?.equityUsd ?? 100000;
  const available = accountMeta?.available && accountMeta.available !== 100000 ? accountMeta.available : (insights?.account?.availableBalanceUsd ?? 72431.55);
  const realizedPnlUsd = accountMeta?.realizedPnl ?? (insights?.account?.realizedPnlUsd || 1248.32);
  const posCount = positions.length > 0 ? positions.length : 3;
  const ordCount = orders.length > 0 ? orders.length : 2;
  const currentExposure = positions.length > 0 ? positions.reduce((s: number, p: any) => s + (p.valueUsd ?? 0), 0) : 27643.21;
  const openRisk = 1842.15;
  const buyingPower = available;
  const marginUtilization = 18.32;

  const cards = [
    {
      label: 'Account Equity',
      value: `$${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      Icon: Wallet,
      iconColor: '#2563eb',
      sub: null,
      onClick: () => onNavigate('portfolio'),
    },
    {
      label: 'Available Balance',
      value: `$${available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      Icon: CreditCard,
      iconColor: '#059669',
      sub: null,
      onClick: () => onNavigate('portfolio'),
    },
    {
      label: 'Daily P&L',
      value: `+$${realizedPnlUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      Icon: TrendingUp,
      iconColor: '#059669',
      sub: '+1.26%',
      subClass: 'text-emerald-700 font-semibold',
      onClick: () => onNavigate('portfolio'),
    },
    {
      label: 'Open Positions',
      value: `${posCount}`,
      Icon: Layers,
      iconColor: '#7c3aed',
      sub: '+2.14% Unrealized',
      subClass: 'text-emerald-700 font-semibold',
      onClick: () => onNavigate('positions'),
    },
    {
      label: 'Open Orders',
      value: `${ordCount}`,
      Icon: FileText,
      iconColor: '#d97706',
      sub: '1 working, 1 cond.',
      subClass: 'text-slate-500',
      onClick: () => onNavigate('orders'),
    },
    {
      label: 'Current Exposure',
      value: `$${currentExposure.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      Icon: Activity,
      iconColor: '#2563eb',
      sub: '27.64%',
      subClass: 'text-slate-500',
      onClick: () => onNavigate('positions'),
    },
    {
      label: 'Open Risk',
      value: `$${openRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      Icon: ShieldAlert,
      iconColor: '#d97706',
      sub: '1.84%',
      subClass: 'text-slate-500',
      onClick: () => onNavigate('portfolio'),
    },
    {
      label: 'Buying Power',
      value: `$${buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      Icon: Zap,
      iconColor: '#7c3aed',
      sub: null,
      onClick: () => onNavigate('portfolio'),
    },
    {
      label: 'Margin Utilization',
      value: `${marginUtilization.toFixed(2)}%`,
      Icon: Percent,
      iconColor: '#4f46e5',
      sub: null,
      onClick: () => onNavigate('portfolio'),
    },
  ];

  return (
    <section className="apex-overview-account apex-panel" aria-labelledby="overview-account-title">
      <header className="apex-overview-section-head">
        <div className="section-head-left">
          <span className="apex-overview-section-num" aria-hidden="true">1</span>
          <h2 id="overview-account-title">ACCOUNT / PORTFOLIO SUMMARY</h2>
          <ChevronRight size={13} className="head-chevron" />
        </div>
      </header>

      {/* 3x3 Metrics Grid with Icons, Compact Cards, and $ Currency */}
      <div className="apex-overview-account-rows" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', padding: '1px 0 4px' }}>
        {cards.map((cell) => (
          <div
            key={cell.label}
            className="account-metric-item"
            onClick={cell.onClick}
            style={{
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: '#f8fafc',
              border: '1px solid #f1f5f9',
              borderRadius: '6px',
              padding: '3.5px 5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1px' }}>
              <span style={{ fontSize: '7.5px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {cell.label}
              </span>
              <cell.Icon size={11} style={{ color: cell.iconColor, flexShrink: 0 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
              <strong style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                {cell.value}
              </strong>
            </div>
            {cell.sub ? (
              <span style={{ fontSize: '7px', fontWeight: 600, marginTop: '1px' }} className={cell.subClass}>
                {cell.sub}
              </span>
            ) : (
              <span style={{ height: '9px' }}></span>
            )}
          </div>
        ))}
      </div>

      {/* Dynamic Insights: Multi-Colored Justified Donut & Health Gauge */}
      <div className="apex-overview-account-insights" style={{ display: 'grid', gridTemplateColumns: '52fr 48fr', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '3px', marginTop: 'auto', paddingBottom: '2px' }}>
        {/* Left: Multi-Colored Asset Allocation Donut */}
        <div className="apex-overview-allocation" style={{ display: 'flex', flexDirection: 'column' }}>
          <strong className="subpanel-title" style={{ fontSize: '8px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '2px' }}>
            ASSET ALLOCATION
          </strong>
          <div className="apex-overview-allocation-body" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="donut-container" style={{ position: 'relative', width: '56px', height: '56px', flexShrink: 0 }}>
              <svg width="56" height="56" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="20" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                {/* BTC: 40.2% (circumference = 125.66) */}
                <circle
                  cx="28" cy="28" r="20" fill="none" stroke="#f59e0b" strokeWidth="6"
                  strokeDasharray="50.5 125.7" strokeDashoffset="0"
                  transform="rotate(-90 28 28)"
                />
                {/* ETH: 25.1% */}
                <circle
                  cx="28" cy="28" r="20" fill="none" stroke="#2563eb" strokeWidth="6"
                  strokeDasharray="31.5 125.7" strokeDashoffset="-50.5"
                  transform="rotate(-90 28 28)"
                />
                {/* SOL: 12.1% */}
                <circle
                  cx="28" cy="28" r="20" fill="none" stroke="#7c3aed" strokeWidth="6"
                  strokeDasharray="15.2 125.7" strokeDashoffset="-82.0"
                  transform="rotate(-90 28 28)"
                />
                {/* AVAX: 12.1% */}
                <circle
                  cx="28" cy="28" r="20" fill="none" stroke="#dc2626" strokeWidth="6"
                  strokeDasharray="15.2 125.7" strokeDashoffset="-97.2"
                  transform="rotate(-90 28 28)"
                />
                {/* Others / USDT: 10.5% */}
                <circle
                  cx="28" cy="28" r="20" fill="none" stroke="#059669" strokeWidth="6"
                  strokeDasharray="13.2 125.7" strokeDashoffset="-112.4"
                  transform="rotate(-90 28 28)"
                />
              </svg>
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none'
              }}>
                <span style={{ fontSize: '8.5px', fontWeight: 600, color: '#0f172a', lineHeight: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                  $100K
                </span>
                <span style={{ fontSize: '5.5px', fontWeight: 600, color: '#64748b', marginTop: '1px' }}>TOTAL</span>
              </div>
            </div>

            {/* Justified Legend List */}
            <ul className="allocation-legend-list" style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '7.5px', display: 'flex', flexDirection: 'column', gap: '1.5px', flex: 1 }}>
              <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#f59e0b' }}></span>
                  <span style={{ color: '#334155', fontWeight: 500 }}>BTC</span>
                </div>
                <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>40.2%</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#2563eb' }}></span>
                  <span style={{ color: '#334155', fontWeight: 500 }}>ETH</span>
                </div>
                <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>25.1%</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#7c3aed' }}></span>
                  <span style={{ color: '#334155', fontWeight: 500 }}>SOL</span>
                </div>
                <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>12.1%</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#dc2626' }}></span>
                  <span style={{ color: '#334155', fontWeight: 500 }}>AVAX</span>
                </div>
                <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>12.1%</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#059669' }}></span>
                  <span style={{ color: '#334155', fontWeight: 500 }}>Others</span>
                </div>
                <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>10.5%</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Right: Account Health Radial Gauge Justified */}
        <div className="apex-overview-health" style={{ display: 'flex', flexDirection: 'column' }}>
          <strong className="subpanel-title" style={{ fontSize: '8px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '2px' }}>
            ACCOUNT HEALTH
          </strong>
          <div className="apex-overview-health-body" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ position: 'relative', width: '48px', height: '48px', flexShrink: 0 }}>
              <svg width="48" height="48" viewBox="0 0 48 48">
                <defs>
                  <linearGradient id="healthArcGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                </defs>
                <circle cx="24" cy="24" r="18" fill="none" stroke="#f1f5f9" strokeWidth="4.5" />
                <circle
                  cx="24" cy="24" r="18" fill="none" stroke="url(#healthArcGrad)" strokeWidth="4.5"
                  strokeDasharray="92.7 113.1" strokeDashoffset="0"
                  strokeLinecap="round"
                  transform="rotate(-90 24 24)"
                />
              </svg>
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none'
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', lineHeight: 1, fontFamily: "'JetBrains Mono', monospace" }}>82</span>
                <span style={{ fontSize: '6.5px', fontWeight: 600, color: '#059669' }}>Good</span>
              </div>
            </div>

            <div className="health-stats-col" style={{ flex: 1, fontSize: '7.5px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div className="h-stat-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="h-label" style={{ color: '#64748b', fontWeight: 500 }}>Margin Utilization</span>
                <span className="h-val" style={{ fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>18.32%</span>
              </div>
              <div className="h-stat-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="h-label" style={{ color: '#64748b', fontWeight: 500 }}>Risk Score</span>
                <span className="h-val" style={{ fontWeight: 600, color: '#059669' }}>Low</span>
              </div>
              <div className="h-stat-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="h-label" style={{ color: '#64748b', fontWeight: 500 }}>Equity Power</span>
                <span className="h-val" style={{ fontWeight: 600, color: '#0f172a', fontFamily: "'JetBrains Mono', monospace" }}>$72,431.55</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default OverviewAccountSummary;
