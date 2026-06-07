// src/components/bandilero/CustomerIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Customer Intelligence panel (real Firestore data only).
//
//  Answers: best customers · who's lapsed · most revenue · city repeat
//  rates · most common tire sizes. Headline counts + city/tire/service
//  trends are operational (all roles); lifetime revenue ($) is financial
//  and redacted (not faked) for technicians.
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import { labeled } from '@/lib/bandilero/confidence';
import type { CustomerIntel, RankedCustomer } from '@/lib/bandilero/services/customerIntel';
import { MetricCard } from './MetricCard';

function CustList({ title, rows, canViewFinancials, showDaysSince }: {
  title: string; rows: RankedCustomer[]; canViewFinancials: boolean; showDaysSince?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.key} className="bnd-card" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 11px',
          }}>
            <span style={{ minWidth: 0, overflow: 'hidden' }}>
              <span style={{ fontSize: 12.5, color: '#e8ebf2', fontWeight: 600 }}>{r.name}</span>
              <span style={{ fontSize: 10.5, color: '#7e8a9e', marginLeft: 7 }}>
                {r.jobCount} job{r.jobCount === 1 ? '' : 's'} · {r.city}
                {showDaysSince && Number.isFinite(r.daysSince) ? ` · ${r.daysSince}d ago` : ''}
              </span>
            </span>
            <span style={{ fontSize: 11, color: '#9aa3b2', whiteSpace: 'nowrap', fontWeight: 700 }}>
              {canViewFinancials ? money(r.revenue) : r.vipTier}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniList({ title, rows, unit }: { title: string; rows: { label: string; count: number }[]; unit: string }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {rows.map((r) => (
          <span key={r.label} className="bnd-card" style={{ padding: '6px 10px', fontSize: 11.5, color: '#e8ebf2' }}>
            {r.label} <span style={{ color: 'var(--bnd-cyan, #22d3ee)', fontWeight: 800 }}>{r.count}</span>
            <span style={{ color: '#7e8a9e' }}> {unit}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function CustomerIntelPanel({ intel, canViewFinancials }: { intel: CustomerIntel; canViewFinancials: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div className="bandilero-grid">
        <MetricCard metric={labeled(intel.totalCustomers, 'Customers', 'count')} />
        <MetricCard metric={labeled(intel.returningCustomers, 'Returning', 'count')} />
        <MetricCard metric={labeled(intel.returningRatePct, 'Repeat rate', 'pct')} />
        <MetricCard metric={labeled(intel.inactive90Count, 'Inactive 90d+', 'count')} />
      </div>

      <CustList title="Best customers (lifetime value)" rows={intel.bestCustomers} canViewFinancials={canViewFinancials} />
      <CustList title="Follow-up opportunities — lapsed repeat customers" rows={intel.followUps} canViewFinancials={canViewFinancials} showDaysSince />

      {intel.cityTrends.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>
            City repeat-customer rates
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {intel.cityTrends.map((c) => (
              <div key={c.city} className="bnd-card" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 11px' }}>
                <span style={{ fontSize: 12.5, color: '#e8ebf2', fontWeight: 600 }}>{c.city}</span>
                <span style={{ fontSize: 11, color: '#9aa3b2' }}>
                  <span style={{ color: 'var(--bnd-cyan, #22d3ee)', fontWeight: 800 }}>{c.repeatPct}%</span> repeat · {c.total} customers
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <MiniList title="Most common tire sizes" rows={intel.topTireSizes.map((m) => ({ label: m.value, count: m.count }))} unit="jobs" />
      <MiniList title="Most common services" rows={intel.topServices.map((m) => ({ label: m.value, count: m.count }))} unit="jobs" />
    </div>
  );
}
