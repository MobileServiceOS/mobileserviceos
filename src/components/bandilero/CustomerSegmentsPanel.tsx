// src/components/bandilero/CustomerSegmentsPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Customer segments panel (Phase 2).
//
//  Segment COUNTS are operational (all roles). The VIP list shows
//  lifetime revenue ($) — a financial figure — so it is redacted (names
//  + tier only, never faked) for technicians.
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import { deriveVipTier } from '@/lib/customerInsights';
import { labeled } from '@/lib/bandilero/confidence';
import type { CustomerSegments } from '@/lib/bandilero/services/customerSegments';
import type { CustomerProfile } from '@/lib/customers';
import { MetricCard } from './MetricCard';

function Row({ p, showRevenue }: { p: CustomerProfile; showRevenue: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      padding: '8px 11px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{ fontSize: 12.5, color: '#e8ebf2', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {p.name || 'Unnamed'}
      </span>
      <span style={{ fontSize: 11, color: '#9aa3b2', whiteSpace: 'nowrap' }}>
        {showRevenue ? money(p.revenue) : deriveVipTier(p.revenue)}
      </span>
    </div>
  );
}

export function CustomerSegmentsPanel({
  segments, canViewFinancials,
}: { segments: CustomerSegments; canViewFinancials: boolean }) {
  const c = segments.counts;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="bandilero-grid">
        <MetricCard metric={labeled(c.vip, 'VIP customers', 'count')} />
        <MetricCard metric={labeled(c.repeat, 'Repeat customers', 'count')} />
        <MetricCard metric={labeled(c.newCustomers, 'New (30d)', 'count')} />
        <MetricCard metric={labeled(c.atRisk, 'At-risk', 'count')} />
      </div>

      {segments.vipList.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>
            Top VIPs{!canViewFinancials ? ' (revenue hidden)' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {segments.vipList.map((p) => <Row key={p.key} p={p} showRevenue={canViewFinancials} />)}
          </div>
        </div>
      )}

      {segments.atRiskList.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9aa3b2', fontWeight: 700, margin: '2px 0 7px 2px' }}>
            At-risk — overdue for a visit
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {segments.atRiskList.map((p) => <Row key={p.key} p={p} showRevenue={false} />)}
          </div>
        </div>
      )}
    </div>
  );
}
