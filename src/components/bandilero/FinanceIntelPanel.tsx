// src/components/bandilero/FinanceIntelPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Revenue / Finance Intelligence panel.
//
//  Financial by nature → owner/admin only (redacted, not faked, for
//  technicians). Numbers reconcile with Dashboard / Payouts. All LIVE.
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import { labeled } from '@/lib/bandilero/confidence';
import type { FinanceIntel } from '@/lib/bandilero/services/financeIntel';
import { MetricCard } from './MetricCard';

function TrendBars({ trend }: { trend: FinanceIntel['revenueTrend'] }) {
  const max = Math.max(1, ...trend.map((p) => p.revenue));
  return (
    <div>
      <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 8px 2px' }}>
        Revenue — last 8 weeks
      </div>
      <div className="bnd-card" style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 78, padding: '10px 12px' }}>
        {trend.map((p) => (
          <div key={p.weekStart} title={`${p.weekStart}: ${money(p.revenue)}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{
              height: `${Math.round((p.revenue / max) * 100)}%`,
              minHeight: p.revenue > 0 ? 3 : 0,
              borderRadius: '3px 3px 0 0',
              background: 'linear-gradient(180deg, var(--bnd-cyan, #22d3ee), rgba(59,130,246,0.45))',
              boxShadow: '0 0 10px -2px rgba(34,211,238,0.5)',
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FinanceIntelPanel({ intel, canViewFinancials }: { intel: FinanceIntel; canViewFinancials: boolean }) {
  if (!canViewFinancials) {
    return (
      <div style={{ fontSize: 12, color: '#8b93a3', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        🔒 Revenue &amp; Finance is available to owners and admins.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div className="bandilero-grid">
        <MetricCard metric={labeled(intel.revenueToday, 'Revenue today', 'money')} />
        <MetricCard metric={labeled(intel.revenueWeek, 'Revenue (week)', 'money')} />
        <MetricCard metric={labeled(intel.revenueMonth, 'Revenue (month)', 'money')} />
        <MetricCard metric={labeled(intel.grossProfitWeek, 'Gross profit (week)', 'money')} />
        <MetricCard metric={labeled(intel.netProfitMonth, 'Net profit (month)', 'money')} />
        <MetricCard metric={labeled(intel.expensesMonth, 'Expenses (month)', 'money')} />
        <MetricCard metric={labeled(intel.monthlyRecurring, 'Monthly recurring', 'money')} />
        <MetricCard metric={labeled(intel.distributableWeek, 'Distributable (week)', 'money')} />
      </div>

      <TrendBars trend={intel.revenueTrend} />

      {intel.ownerShares.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>
            Weekly payout split
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {intel.ownerShares.map((o) => (
              <div key={o.name} className="bnd-card" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 11px' }}>
                <span style={{ fontSize: 12.5, color: '#e8ebf2', fontWeight: 600 }}>{o.name} <span style={{ color: '#7e8a9e', fontWeight: 400 }}>· {o.pct}%</span></span>
                <span style={{ fontSize: 12.5, color: 'var(--bnd-cyan, #22d3ee)', fontWeight: 800 }}>{money(o.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {intel.topExpenseCategories.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>
            Top expense categories (8 weeks)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {intel.topExpenseCategories.map((c) => (
              <span key={c.label} className="bnd-card" style={{ padding: '6px 10px', fontSize: 11.5, color: '#e8ebf2' }}>
                {c.label} <span style={{ color: '#ff9d9d', fontWeight: 800 }}>{money(c.total)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
