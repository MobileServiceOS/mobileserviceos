// src/lib/customerIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Deterministic customer intelligence — pure, on-device, no AI.
//
//  From the persisted customer list, surfaces the two actionable groups
//  the Customers screen doesn't already show:
//    • atRisk     — repeat customers (2+ jobs) who haven't been back in
//                   90+ days, ranked by lifetime value → who to win back
//    • topByValue — highest lifetime-revenue customers → who to protect
//  Plus the repeat rate. Nothing fabricated; every number traces to a
//  customer field.
// ═══════════════════════════════════════════════════════════════════

export interface IntelCustomer {
  id: string;
  name: string;
  lifetimeRevenue: number;
  jobCount: number;
  daysSince: number | null;   // days since last job, or null if unknown
  vipTier?: 'Standard' | 'Gold' | 'Platinum';
}

export interface CustomerIntel {
  atRisk: IntelCustomer[];      // top 5 by lifetime value
  topByValue: IntelCustomer[];  // top 5 by lifetime value
  atRiskCount: number;
  repeatRatePct: number;
  total: number;
}

interface RawCustomer {
  id: string;
  name?: string;
  lifetimeRevenue?: number;
  jobCount?: number;
  lastJobAt?: string;
  vipTier?: 'Standard' | 'Gold' | 'Platinum';
}

const AT_RISK_DAYS = 90;
const TOP = 5;

function daysBetween(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / 86_400_000);
}

/** Build customer intelligence from the persisted customer list. Pure. */
export function computeCustomerIntel(customers: RawCustomer[], nowMs: number): CustomerIntel {
  const enriched: IntelCustomer[] = customers.map((c) => ({
    id: c.id,
    name: (c.name ?? '').trim() || 'Unknown',
    lifetimeRevenue: Number(c.lifetimeRevenue) || 0,
    jobCount: Number(c.jobCount) || 0,
    daysSince: daysBetween(c.lastJobAt, nowMs),
    vipTier: c.vipTier,
  }));

  const byValueDesc = (a: IntelCustomer, b: IntelCustomer) => b.lifetimeRevenue - a.lifetimeRevenue;

  const atRiskAll = enriched
    .filter((c) => c.jobCount >= 2 && c.daysSince !== null && c.daysSince >= AT_RISK_DAYS)
    .sort(byValueDesc);

  const topByValue = [...enriched].sort(byValueDesc).filter((c) => c.lifetimeRevenue > 0).slice(0, TOP);

  const repeat = enriched.filter((c) => c.jobCount > 1).length;
  const total = enriched.length;

  return {
    atRisk: atRiskAll.slice(0, TOP),
    topByValue,
    atRiskCount: atRiskAll.length,
    repeatRatePct: total > 0 ? Math.round((repeat / total) * 100) : 0,
    total,
  };
}
