// src/components/bandilero/CustomerIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Customer Intelligence panel (consolidated; real data).
//
//  The single customer system (Customer Segments merged in). Sections:
//  Overview · Value · Behavior · Follow-Up · Bandilero Insights.
//  Lifetime revenue ($) is redacted (not faked) for technicians; counts
//  and trends are operational.
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import { labeled } from '@/lib/bandilero/confidence';
import type { CustomerIntel, RankedCustomer, CustomerInsight } from '@/lib/bandilero/services/customerIntel';
import { MetricCard } from './MetricCard';

function SubTitle({ children }: { children: string }) {
  return <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--bnd-cyan,#22d3ee)', opacity: 0.85, margin: '4px 0 8px 2px' }}>{children}</div>;
}

function CustRow({ r, canViewFinancials, showDaysSince }: { r: RankedCustomer; canViewFinancials: boolean; showDaysSince?: boolean }) {
  return (
    <div className="bnd-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 11px' }}>
      <span style={{ minWidth: 0, overflow: 'hidden' }}>
        <span style={{ fontSize: 12.5, color: '#e8ebf2', fontWeight: 600 }}>{r.name}</span>
        <span style={{ fontSize: 10.5, color: '#7e8a9e', marginLeft: 7 }}>
          {r.jobCount} job{r.jobCount === 1 ? '' : 's'} · {r.city}{showDaysSince && Number.isFinite(r.daysSince) ? ` · ${r.daysSince}d ago` : ''}
        </span>
      </span>
      <span style={{ fontSize: 11, color: '#9aa3b2', whiteSpace: 'nowrap', fontWeight: 700 }}>
        {canViewFinancials ? money(r.revenue) : r.vipTier}
      </span>
    </div>
  );
}

function Chips({ rows, color, unit }: { rows: { label: string; n: number | string }[]; color: string; unit?: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map((r) => (
        <span key={r.label} className="bnd-card" style={{ padding: '6px 10px', fontSize: 11.5, color: '#e8ebf2' }}>
          {r.label} <span style={{ color, fontWeight: 800 }}>{r.n}</span>{unit ? <span style={{ color: '#7e8a9e' }}> {unit}</span> : null}
        </span>
      ))}
    </div>
  );
}

const INSIGHT_COLOR: Record<CustomerInsight['kind'], string> = { risk: '#ff8f8f', opportunity: '#7ef7cf', action: '#9bd0ff' };

export function CustomerIntelPanel({ intel, canViewFinancials }: { intel: CustomerIntel; canViewFinancials: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Overview */}
      <div>
        <SubTitle>Overview</SubTitle>
        <div className="bandilero-grid">
          <MetricCard metric={labeled(intel.totalCustomers, 'Total customers', 'count')} />
          <MetricCard metric={labeled(intel.newCustomers, 'New (30d)', 'count')} />
          <MetricCard metric={labeled(intel.returningCustomers, 'Returning', 'count')} />
          <MetricCard metric={labeled(intel.vipCustomers, 'VIP', 'count')} />
          <MetricCard metric={labeled(intel.atRiskCustomers, 'At-risk', 'count')} />
          <MetricCard metric={labeled(intel.returningRatePct, 'Repeat rate', 'pct')} />
        </div>
      </div>

      {/* Value */}
      <div>
        <SubTitle>Customer value</SubTitle>
        {canViewFinancials && (
          <div className="bandilero-grid" style={{ marginBottom: 8 }}>
            <MetricCard metric={labeled(intel.totalRevenue, 'Lifetime revenue', 'money')} />
            <MetricCard metric={labeled(intel.top5RevenueSharePct, 'Top-5 revenue share', 'pct')} />
          </div>
        )}
        <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>Top customers (lifetime value)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {intel.bestCustomers.map((r) => <CustRow key={r.key} r={r} canViewFinancials={canViewFinancials} />)}
        </div>
      </div>

      {/* Behavior */}
      <div>
        <SubTitle>Behavior</SubTitle>
        {intel.topServices.length > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10.5, color: '#9aa3b2', margin: '0 0 6px 2px' }}>Most common services</div><Chips rows={intel.topServices.map((m) => ({ label: m.value, n: m.count }))} color="var(--bnd-cyan,#22d3ee)" unit="jobs" /></div>}
        {intel.topTireSizes.length > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10.5, color: '#9aa3b2', margin: '0 0 6px 2px' }}>Most common tire sizes</div><Chips rows={intel.topTireSizes.map((m) => ({ label: m.value, n: m.count }))} color="var(--bnd-cyan,#22d3ee)" unit="jobs" /></div>}
        {intel.cityTrends.length > 0 && (
          <div>
            <div style={{ fontSize: 10.5, color: '#9aa3b2', margin: '0 0 6px 2px' }}>City repeat rates</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {intel.cityTrends.map((c) => (
                <div key={c.city} className="bnd-card" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 11px' }}>
                  <span style={{ fontSize: 12.5, color: '#e8ebf2', fontWeight: 600 }}>{c.city}</span>
                  <span style={{ fontSize: 11, color: '#9aa3b2' }}><span style={{ color: 'var(--bnd-cyan,#22d3ee)', fontWeight: 800 }}>{c.repeatPct}%</span> repeat · {c.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Follow-Up */}
      <div>
        <SubTitle>Follow-up opportunities</SubTitle>
        <div className="bandilero-grid" style={{ marginBottom: 8 }}>
          <MetricCard metric={labeled(intel.inactive30Count, 'Inactive 30d+', 'count')} />
          <MetricCard metric={labeled(intel.inactive60Count, 'Inactive 60d+', 'count')} />
          <MetricCard metric={labeled(intel.inactive90Count, 'Inactive 90d+', 'count')} />
        </div>
        {intel.followUps.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>Lapsed repeat customers — re-engage</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {intel.followUps.map((r) => <CustRow key={r.key} r={r} canViewFinancials={canViewFinancials} showDaysSince />)}
            </div>
          </>
        )}
      </div>

      {/* Bandilero Insights */}
      {intel.insights.length > 0 && (
        <div>
          <SubTitle>Bandilero insights</SubTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {intel.insights.map((ins, i) => (
              <div key={i} className="bnd-card" style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 11px', borderLeft: `3px solid ${INSIGHT_COLOR[ins.kind]}` }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: INSIGHT_COLOR[ins.kind], whiteSpace: 'nowrap', marginTop: 1 }}>{ins.kind}</span>
                <span style={{ fontSize: 12, color: '#dbe2ee', lineHeight: 1.4 }}>{ins.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
