// src/components/customers/CustomerIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Compact, on-device customer intelligence — top of the Customers
//  screen. Headline stats (at-risk count, repeat rate, top customer) +
//  a tappable at-risk list (who to win back). Revenue is redacted for
//  non-financial roles. Deterministic; no AI.
// ═══════════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';
import { money } from '@/lib/utils';
import type { CustomerIntel } from '@/lib/customerIntel';

function relDays(d: number | null): string {
  if (d === null) return '';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 24) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export function CustomerIntelPanel({ intel, canViewFinancials, onSelectCustomer }: {
  intel: CustomerIntel;
  canViewFinancials: boolean;
  onSelectCustomer?: (id: string) => void;
}): JSX.Element | null {
  const { atRisk, topByValue, atRiskCount, repeatRatePct, total } = intel;
  if (total === 0) return null;
  const topCust = topByValue[0];

  return (
    <div className="card card-pad" style={{ marginBottom: 12 }}>
      <div style={titleStyle}>Customer Intelligence</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: atRisk.length ? 12 : 0 }}>
        <div style={statStyle(atRiskCount > 0 ? '#f59e0b' : undefined)}>
          <span style={statVal}>{atRiskCount}</span>
          <span style={statLabel}>At risk · 90d+</span>
        </div>
        <div style={statStyle()}>
          <span style={statVal}>{repeatRatePct}%</span>
          <span style={statLabel}>Repeat rate</span>
        </div>
        {topCust && (
          <button type="button" style={statStyle('var(--brand-primary)')} onClick={() => onSelectCustomer?.(topCust.id)}>
            <span style={{ ...statVal, fontSize: 14 }}>{topCust.name}</span>
            <span style={statLabel}>Top customer{canViewFinancials ? ` · ${money(topCust.lifetimeRevenue)}` : ''}</span>
          </button>
        )}
      </div>

      {atRisk.length > 0 && (
        <div>
          <div style={miniLabel}>Win back — repeat customers gone 90+ days</div>
          {atRisk.map((c) => (
            <button key={c.id} type="button" style={miniRow} onClick={() => onSelectCustomer?.(c.id)}>
              <span style={{ fontWeight: 700, color: 'var(--t1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              <span style={{ color: 'var(--t3)', fontSize: 11, flexShrink: 0 }}>
                {canViewFinancials ? `${money(c.lifetimeRevenue)} · ` : ''}{relDays(c.daysSince)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const titleStyle: CSSProperties = {
  fontSize: 12, fontWeight: 800, color: 'var(--t2)',
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10,
};
function statStyle(accent?: string): CSSProperties {
  return {
    flex: 1, minWidth: 92,
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
    background: 'var(--s2)', border: `1px solid ${accent ? accent + '55' : 'var(--border)'}`,
    borderRadius: 10, padding: '9px 11px', textAlign: 'left',
    color: 'var(--t1)', cursor: accent === 'var(--brand-primary)' ? 'pointer' : 'default',
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
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
  width: '100%', padding: '7px 0', fontSize: 13,
  background: 'transparent', border: 'none', borderTop: '1px solid var(--border2)',
  cursor: 'pointer', textAlign: 'left', color: 'var(--t1)',
};
