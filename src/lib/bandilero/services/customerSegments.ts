// src/lib/bandilero/services/customerSegments.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Customer segmentation service (DETERMINISTIC, no LLM).
//
//  Derives segments from the real job list via deriveCustomerProfiles
//  (NOT the persisted customer rollups — lifetimeRevenue is never
//  persisted by privacy contract, so revenue-based segments must be
//  computed from jobs). VIP thresholds reuse deriveVipTier; at-risk
//  reuses cadence + deriveCustomerStatus. All LIVE.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { deriveCustomerProfiles, type CustomerProfile } from '@/lib/customers';
import { deriveVipTier, deriveCustomerStatus } from '@/lib/customerInsights';
import { type Metric, live } from '../confidence';

/** Days a repeat customer must exceed their own cadence by to be "at risk". */
const AT_RISK_CADENCE_FACTOR = 1.5;
/** A customer is "new" if their first job was within this many days. */
const NEW_CUSTOMER_DAYS = 30;

function daysBetween(todayISO: string, dateISO: string): number {
  const a = new Date(todayISO + 'T12:00:00').getTime();
  const b = new Date(dateISO + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

export function isVip(p: CustomerProfile): boolean {
  return deriveVipTier(p.revenue) !== 'Standard';
}

export function isNewCustomer(p: CustomerProfile, today: string): boolean {
  return !!p.firstDate && daysBetween(today, p.firstDate) <= NEW_CUSTOMER_DAYS;
}

/**
 * At-risk = a repeat customer who is overdue. Overdue means either their
 * gap since last visit exceeds their own cadence by the factor, OR they
 * have crossed the 12-month Inactive threshold.
 */
export function isAtRisk(p: CustomerProfile, today: string): boolean {
  if (!p.isRepeat || !p.lastDate) return false;
  const since = daysBetween(today, p.lastDate);
  const overdueByCadence = p.visitCadenceDays != null && since > p.visitCadenceDays * AT_RISK_CADENCE_FACTOR;
  const inactive = deriveCustomerStatus({ lastJobAt: p.lastDate }) === 'Inactive';
  return overdueByCadence || inactive;
}

export interface SegmentCounts {
  total: Metric<number>;
  vip: Metric<number>;
  repeat: Metric<number>;
  newCustomers: Metric<number>;
  atRisk: Metric<number>;
}

export interface CustomerSegments {
  counts: SegmentCounts;
  /** Highest-revenue VIPs (top 5). */
  vipList: CustomerProfile[];
  /** Most-overdue at-risk customers (top 5). */
  atRiskList: CustomerProfile[];
}

export function customerSegments(jobs: ReadonlyArray<Job>, settings: Settings, today: string): CustomerSegments {
  const profiles = deriveCustomerProfiles(jobs as Job[], settings);

  const vips = profiles.filter(isVip);
  const repeats = profiles.filter((p) => p.isRepeat);
  const news = profiles.filter((p) => isNewCustomer(p, today));
  const atRisk = profiles.filter((p) => isAtRisk(p, today));

  const vipList = [...vips].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const atRiskList = [...atRisk]
    .sort((a, b) => daysBetween(today, b.lastDate) - daysBetween(today, a.lastDate))
    .slice(0, 5);

  return {
    counts: {
      total: live(profiles.length, 'customers', today),
      vip: live(vips.length, 'customers', today),
      repeat: live(repeats.length, 'customers', today),
      newCustomers: live(news.length, 'customers', today),
      atRisk: live(atRisk.length, 'customers', today),
    },
    vipList,
    atRiskList,
  };
}
