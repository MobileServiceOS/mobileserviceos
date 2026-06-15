// src/components/inventory/InventoryIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Compact, on-device inventory intelligence — sits at the top of the
//  Inventory screen. Three tappable headline stats (reorder count, dead-
//  stock cash, top mover) wired to the existing health filters, plus the
//  top-5 reorder list (in-demand + low). Deterministic; no AI.
// ═══════════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';
import { money } from '@/lib/utils';
import type { InventoryIntel } from '@/lib/inventoryIntel';
import type { BestSellerWindow } from '@/lib/bestSellingTires';

const WINDOW_TABS: ReadonlyArray<readonly [BestSellerWindow, string]> = [
  [7, 'Week'], [30, '30d'], [90, '90d'], ['all', 'All'],
];
/** Short suffix for the per-row demand label, e.g. "8 jobs/90d". */
const winSuffix = (w: BestSellerWindow): string => (w === 'all' ? '' : `/${w}d`);

export function InventoryIntelPanel({ intel, window, onWindow, onViewAll }: {
  intel: InventoryIntel;
  window: BestSellerWindow;
  onWindow: (w: BestSellerWindow) => void;
  onViewAll: (bucket: 'low' | 'dead') => void;
}): JSX.Element | null {
  const { reorderNow, fastMovers, reorderCount, deadStockValue, deadStockCount } = intel;
  if (reorderCount === 0 && deadStockCount === 0 && fastMovers.length === 0) return null;
  const topMover = fastMovers[0];
  const sfx = winSuffix(window);

  return (
    <div className="card card-pad" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <div style={titleStyle}>Inventory Intelligence</div>
        {/* Demand window — Reorder Now / dead stock / top mover all rank by
            distinct JOBS within the selected window. */}
        <div style={{ display: 'flex', gap: 3 }} role="group" aria-label="Demand window">
          {WINDOW_TABS.map(([w, label]) => (
            <button key={String(w)} type="button" onClick={() => onWindow(w)} style={tabStyle(window === w)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: reorderNow.length ? 12 : 0 }}>
        <button type="button" onClick={() => onViewAll('low')} disabled={reorderCount === 0}
          style={statStyle(reorderCount > 0 ? '#f59e0b' : undefined)} aria-label={`${reorderCount} to reorder`}>
          <span style={statVal}>{reorderCount}</span>
          <span style={statLabel}>Reorder now</span>
        </button>
        <button type="button" onClick={() => onViewAll('dead')} disabled={deadStockCount === 0}
          style={statStyle(deadStockValue > 0 ? '#ef4444' : undefined)} aria-label={`${money(deadStockValue)} dead stock`}>
          <span style={statVal}>{money(deadStockValue)}</span>
          <span style={statLabel}>Dead stock</span>
        </button>
        {topMover && (
          <div style={statStyle()}>
            <span style={{ ...statVal, fontSize: 15 }}>{topMover.size}</span>
            <span style={statLabel}>Top mover · {topMover.jobs} job{topMover.jobs === 1 ? '' : 's'}{sfx}</span>
          </div>
        )}
      </div>

      {reorderNow.length > 0 && (
        <div>
          <div style={miniLabel}>Reorder now — in demand · low stock</div>
          {reorderNow.map((i) => (
            <div key={i.id} style={miniRow}>
              <span style={{ fontWeight: 700, color: 'var(--t1)' }}>{i.size}</span>
              <span style={{ color: 'var(--t3)', fontSize: 11 }}>{i.jobs} job{i.jobs === 1 ? '' : 's'}{sfx} · {i.units} sold · {i.qty} on hand</span>
            </div>
          ))}
          {reorderCount > reorderNow.length && (
            <button type="button" className="btn xs secondary" style={{ marginTop: 8 }} onClick={() => onViewAll('low')}>
              View all {reorderCount}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const titleStyle: CSSProperties = {
  fontSize: 12, fontWeight: 800, color: 'var(--t2)',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
function tabStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'var(--brand-primary)' : 'transparent',
    color: active ? '#0a0a0a' : 'var(--t3)',
    border: `1px solid ${active ? 'var(--brand-primary)' : 'var(--border)'}`,
    borderRadius: 7, fontSize: 10, fontWeight: 700, padding: '3px 8px',
    cursor: 'pointer', letterSpacing: 0.3,
  };
}
function statStyle(accent?: string): CSSProperties {
  return {
    flex: 1, minWidth: 92,
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
    background: 'var(--s2)', border: `1px solid ${accent ? accent + '55' : 'var(--border)'}`,
    borderRadius: 10, padding: '9px 11px', textAlign: 'left',
    color: 'var(--t1)', cursor: accent ? 'pointer' : 'default',
  };
}
const statVal: CSSProperties = { fontSize: 20, fontWeight: 800, lineHeight: 1.1 };
const statLabel: CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--t3)',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const miniLabel: CSSProperties = {
  fontSize: 10, fontWeight: 800, color: 'var(--t3)',
  textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6,
};
const miniRow: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '5px 0', borderTop: '1px solid var(--border2)', fontSize: 13,
};
