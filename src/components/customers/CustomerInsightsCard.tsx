// src/components/customers/CustomerInsightsCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerInsightsCard — 9 metrics + VIP badge + progress subline.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Customer Insights Card (Phase 9)"
//
//  Reads:
//    - Customer doc (for persisted rollups + name + tier)
//    - Bounded 100-job array loaded by CustomerProfile parent
//
//  Financial metrics gated by permissions.canViewFinancials.
//  Stale-rollup contract: if lastJobAt is newer than updatedAt by
//  >30s, recompute client-side.
// ═══════════════════════════════════════════════════════════════════

import { memo, useMemo } from 'react';
import {
  deriveVipTier, deriveVipProgress,
  computeMostCommonVehicle, computeMostCommonTireSize, computeMostCommonServiceType,
} from '@/lib/customerInsights';
import type { Customer } from '@/lib/customerEntity';

interface JobLite {
  id: string;
  revenue?: number | string;
  vehicleMakeModel?: string;
  tireSize?: string;
  service?: string;
  date?: string;
}

interface Props {
  customer: Customer;
  jobs: JobLite[];
  canViewFinancials: boolean;
  serviceLabelFor?: (id: string) => string;
}

interface Metrics {
  lifetimeRevenue: number;
  totalJobs: number;
  averageTicket: number | null;
  lastServiceDate: string | null;
  mostCommonVehicle: string | null;
  mostCommonTireSize: string | null;
  mostCommonServiceType: string | null;
  referralCount: number;
  vipTier: 'Standard' | 'Gold' | 'Platinum';
  vipProgress: { nextTier: 'Gold' | 'Platinum' | null; remaining: number };
}

function _deriveMetrics(args: {
  customer: Customer;
  jobs: JobLite[];
  canViewFinancials: boolean;
}): Metrics {
  const { customer, jobs, canViewFinancials } = args;
  const totalJobs = jobs.length;

  let lifetimeRevenue = 0;
  if (canViewFinancials) {
    for (const j of jobs) {
      const n = typeof j.revenue === 'number' ? j.revenue : parseFloat(String(j.revenue ?? '0'));
      if (Number.isFinite(n)) lifetimeRevenue += n;
    }
  }

  const averageTicket = canViewFinancials && totalJobs > 0
    ? Math.round((lifetimeRevenue / totalJobs) * 100) / 100
    : null;

  const lastServiceDate = customer.lastJobAt
    ?? (jobs[0]?.date ?? null);

  return {
    lifetimeRevenue,
    totalJobs,
    averageTicket,
    lastServiceDate,
    mostCommonVehicle:     computeMostCommonVehicle(jobs),
    mostCommonTireSize:    computeMostCommonTireSize(jobs),
    mostCommonServiceType: computeMostCommonServiceType(jobs),
    referralCount:         customer.referralCount ?? 0,
    vipTier:               deriveVipTier(lifetimeRevenue),
    vipProgress:           deriveVipProgress(lifetimeRevenue),
  };
}

function _shouldRecomputeClientSide(args: { lastJobAt?: string; updatedAt?: string }): boolean {
  if (!args.lastJobAt) return false;
  if (!args.updatedAt) return true;
  const lj = Date.parse(args.lastJobAt);
  const up = Date.parse(args.updatedAt);
  if (!Number.isFinite(lj) || !Number.isFinite(up)) return true;
  return (lj - up) > 30_000;
}

function fmtMoney(n: number): string {
  return '$' + n.toFixed(2).replace(/\.00$/, '');
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function CustomerInsightsCardImpl({ customer, jobs, canViewFinancials, serviceLabelFor }: Props) {
  const metrics = useMemo(
    () => _deriveMetrics({ customer, jobs, canViewFinancials }),
    [customer, jobs, canViewFinancials],
  );

  const serviceLabel = metrics.mostCommonServiceType
    ? (serviceLabelFor?.(metrics.mostCommonServiceType) ?? metrics.mostCommonServiceType)
    : '—';

  const vipSubline = metrics.vipProgress.nextTier
    ? `${metrics.vipProgress.nextTier} tier in ${fmtMoney(metrics.vipProgress.remaining)}`
    : 'Top tier reached';

  const vipBg = metrics.vipTier === 'Platinum' ? '#b5a5e8'
    : metrics.vipTier === 'Gold' ? '#d4af37'
    : 'var(--s3)';

  return (
    <section className="form-group card-anim" aria-label="Customer Insights">
      <div className="form-group-title">Customer Insights</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          display: 'inline-block', padding: '4px 10px', borderRadius: 12,
          background: vipBg, color: '#1a1a1a',
          fontSize: 11, fontWeight: 700,
        }}>{metrics.vipTier}</span>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{vipSubline}</span>
      </div>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '10px 16px', margin: 0,
      }}>
        {canViewFinancials && (
          <>
            <div><dt style={dtStyle}>Lifetime Revenue</dt><dd style={ddStyle}>{fmtMoney(metrics.lifetimeRevenue)}</dd></div>
            <div><dt style={dtStyle}>Average Ticket</dt><dd style={ddStyle}>{metrics.averageTicket !== null ? fmtMoney(metrics.averageTicket) : '—'}</dd></div>
          </>
        )}
        <div><dt style={dtStyle}>Total Jobs</dt><dd style={ddStyle}>{metrics.totalJobs}</dd></div>
        <div><dt style={dtStyle}>Last Service</dt><dd style={ddStyle}>{fmtDate(metrics.lastServiceDate)}</dd></div>
        <div><dt style={dtStyle}>Most Common Vehicle</dt><dd style={ddStyle}>{metrics.mostCommonVehicle ?? '—'}</dd></div>
        <div><dt style={dtStyle}>Most Common Tire Size</dt><dd style={ddStyle}>{metrics.mostCommonTireSize ?? '—'}</dd></div>
        <div><dt style={dtStyle}>Most Common Service</dt><dd style={ddStyle}>{serviceLabel}</dd></div>
        <div><dt style={dtStyle}>Referrals</dt><dd style={ddStyle}>{metrics.referralCount}</dd></div>
      </dl>
    </section>
  );
}

const dtStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--t3)', marginBottom: 2, fontWeight: 500,
};
const ddStyle: React.CSSProperties = {
  fontSize: 14, color: 'var(--t1)', fontWeight: 600, margin: 0,
};

export const CustomerInsightsCard = memo(CustomerInsightsCardImpl);

export const __pureHooks = {
  deriveMetrics: _deriveMetrics,
  shouldRecomputeClientSide: _shouldRecomputeClientSide,
};
