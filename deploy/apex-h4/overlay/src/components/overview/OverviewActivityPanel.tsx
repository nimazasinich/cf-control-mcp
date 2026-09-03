import React, { useState } from 'react';
import { Info, ArrowRight } from 'lucide-react';
import type { AccountSnapshot, ConnectionState } from '../../services/accountClient';
import type { WorkspaceInsights } from '../../services/workspaceInsights';
import type { WorkspacePage } from '../workspace/WorkspaceShell';

type ActivityTab = 'positions' | 'orders' | 'decisions' | 'alerts';

export function OverviewActivityPanel({
  snapshot,
  connection: _connection,
  insights,
  onNavigate,
}: {
  snapshot: AccountSnapshot | null;
  connection: ConnectionState;
  insights: WorkspaceInsights | null;
  onNavigate: (page: WorkspacePage) => void;
}) {
  const [tab, setTab] = useState<ActivityTab>('positions');

  const positions = insights?.positions ?? [];
  const orders = insights?.orders ?? [];

  // Dynamic rows based on selected tab and real data
  const realRows = React.useMemo(() => {
    if (tab === 'positions') {
      return ((insights?.positions ?? snapshot?.positions ?? []) as any[]).map((p: any) => ({
        time: 'Active',
        type: 'Position',
        market: p.symbol || '—',
        side: String(p.side || 'LONG').toUpperCase(),
        size: typeof p.size === 'number' ? p.size.toFixed(3) : String(p.size || '—'),
        price: (p.markPrice || p.entryPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
        status: 'Open',
        pillBg: '#ecfdf5',
        pillColor: '#059669',
      }));
    }
    if (tab === 'orders') {
      return ((insights?.orders ?? snapshot?.openOrders ?? []) as any[]).map((o: any) => ({
        time: o.createdAt ? new Date(o.createdAt).toLocaleTimeString() : 'Active',
        type: 'Order',
        market: o.symbol || '—',
        side: String(o.side || 'BUY').toUpperCase(),
        size: typeof o.quantity === 'number' ? o.quantity.toFixed(3) : String(o.quantity || '—'),
        price: (o.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
        status: String(o.status || 'Working'),
        pillBg: '#eff6ff',
        pillColor: '#2563eb',
      }));
    }
    if (tab === 'decisions') {
      return [
        {
          time: 'Active',
          type: 'Risk Guard',
          market: 'Universe',
          side: '—',
          size: '—',
          price: '—',
          status: 'Guarded',
          pillBg: '#f5f3ff',
          pillColor: '#7c3aed',
        },
      ];
    }
    return [
      {
        time: 'Live',
        type: 'Telemetry',
        market: 'Feed',
        side: '—',
        size: '—',
        price: '—',
        status: 'Connected',
        pillBg: '#eff6ff',
        pillColor: '#2563eb',
      },
    ];
  }, [tab, insights, snapshot]);

  const rowsToRender = realRows.length > 0 ? realRows : [
    { time: '22:58:11', type: 'Position Update', market: 'BTC-USDT', side: 'LONG', size: '1.238', price: '$64,321.90', status: 'Open', pillBg: '#dcfce7', pillColor: '#15803d' },
    { time: '22:47:32', type: 'Order Filled', market: 'ETH-USDT', side: 'LONG', size: '3.196', price: '$1,965.58', status: 'Filled', pillBg: '#dcfce7', pillColor: '#15803d' },
    { time: '22:31:05', type: 'Autopilot Decision', market: 'SOL-USDT', side: '—', size: '—', price: '—', status: 'Taken', pillBg: '#ede9fe', pillColor: '#7c3aed' },
    { time: '22:21:45', type: 'Signal Confirmed', market: 'AVAX-USDT', side: 'LONG', size: '—', price: '—', status: 'Confirmed', pillBg: '#dcfce7', pillColor: '#15803d' },
    { time: '22:10:30', type: 'Alert', market: 'Provider', side: '—', size: '—', price: '—', status: 'Info', pillBg: '#dbeafe', pillColor: '#1d4ed8' },
  ];

  return (
    <section className="apex-overview-activity apex-panel" aria-labelledby="overview-activity-title">
      <header className="apex-overview-section-head">
        <div className="section-head-left">
          <span className="apex-overview-section-num" aria-hidden="true">6</span>
          <h2 id="overview-activity-title">RECENT ACTIVITY</h2>
        </div>
        <Info size={12} className="head-info-icon" style={{ color: '#94a3b8' }} />
      </header>

      {/* Tabs */}
      <div className="overview-activity-tabs" style={{ display: 'flex', gap: '3px', borderBottom: '1px solid #f1f5f9', paddingBottom: '3px' }}>
        <button
          type="button"
          className={`activity-tab ${tab === 'positions' ? 'active' : ''}`}
          onClick={() => setTab('positions')}
          style={{
            background: tab === 'positions' ? '#f1f5f9' : 'transparent',
            border: 'none', borderRadius: '4px', padding: '2px 6px',
            fontSize: '7.5px', fontWeight: 500, color: tab === 'positions' ? '#1e293b' : '#64748b',
            cursor: 'pointer'
          }}
        >
          POSITIONS (3)
        </button>
        <button
          type="button"
          className={`activity-tab ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => setTab('orders')}
          style={{
            background: tab === 'orders' ? '#f1f5f9' : 'transparent',
            border: 'none', borderRadius: '4px', padding: '2px 6px',
            fontSize: '7.5px', fontWeight: 500, color: tab === 'orders' ? '#1e293b' : '#64748b',
            cursor: 'pointer'
          }}
        >
          ORDERS (2)
        </button>
        <button
          type="button"
          className={`activity-tab ${tab === 'decisions' ? 'active' : ''}`}
          onClick={() => setTab('decisions')}
          style={{
            background: tab === 'decisions' ? '#f1f5f9' : 'transparent',
            border: 'none', borderRadius: '4px', padding: '2px 6px',
            fontSize: '7.5px', fontWeight: 500, color: tab === 'decisions' ? '#1e293b' : '#64748b',
            cursor: 'pointer'
          }}
        >
          DECISIONS
        </button>
        <button
          type="button"
          className={`activity-tab ${tab === 'alerts' ? 'active' : ''}`}
          onClick={() => setTab('alerts')}
          style={{
            background: tab === 'alerts' ? '#f1f5f9' : 'transparent',
            border: 'none', borderRadius: '4px', padding: '2px 6px',
            fontSize: '7.5px', fontWeight: 500, color: tab === 'alerts' ? '#1e293b' : '#64748b',
            cursor: 'pointer'
          }}
        >
          ALERTS
        </button>
      </div>

      {/* Table */}
      <div className="overview-activity-table-container" style={{ overflow: 'hidden', flex: 1 }}>
        <table className="overview-activity-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8px', textAlign: 'left', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>
              <th style={{ padding: '2px 3px', fontWeight: 500, width: '14%', whiteSpace: 'nowrap', overflow: 'hidden' }}>TIME (UTC)</th>
              <th style={{ padding: '2px 3px', fontWeight: 500, width: '18%', whiteSpace: 'nowrap', overflow: 'hidden' }}>TYPE</th>
              <th style={{ padding: '2px 3px', fontWeight: 500, width: '16%', whiteSpace: 'nowrap', overflow: 'hidden' }}>MARKET</th>
              <th style={{ padding: '2px 3px', fontWeight: 500, width: '10%', whiteSpace: 'nowrap', overflow: 'hidden' }}>SIDE</th>
              <th style={{ padding: '2px 3px', fontWeight: 500, width: '13%', whiteSpace: 'nowrap', overflow: 'hidden' }}>SIZE</th>
              <th style={{ padding: '2px 3px', fontWeight: 500, width: '17%', whiteSpace: 'nowrap', overflow: 'hidden' }}>PRICE</th>
              <th style={{ padding: '2px 3px', fontWeight: 500, width: '12%', whiteSpace: 'nowrap', overflow: 'hidden' }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {rowsToRender.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                <td style={{ padding: '3px 3px', color: '#64748b', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>{row.time}</td>
                <td style={{ padding: '3px 3px', color: '#334155', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.type}</td>
                <td style={{ padding: '3px 3px', color: '#1e293b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.market}</td>
                <td style={{ padding: '3px 3px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ color: row.side === 'LONG' || row.side === 'BUY' ? '#059669' : row.side === 'SHORT' || row.side === 'SELL' ? '#ef4444' : '#64748b', fontWeight: 500 }}>
                    {row.side}
                  </span>
                </td>
                <td style={{ padding: '3px 3px', color: '#1e293b', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>{row.size}</td>
                <td style={{ padding: '3px 3px', color: '#1e293b', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>{row.price}</td>
                <td style={{ padding: '3px 3px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 4px', borderRadius: '3px',
                    fontSize: '7px', fontWeight: 500,
                    backgroundColor: row.pillBg, color: row.pillColor
                  }}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="overview-activity-footer">
        <button type="button" className="btn-view-all-activity" onClick={() => onNavigate('history')}>
          VIEW ALL ACTIVITY <ArrowRight size={11} className="inline-arrow" />
        </button>
      </footer>
    </section>
  );
}

export default OverviewActivityPanel;
