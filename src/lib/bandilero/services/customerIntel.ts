// src/lib/bandilero/services/customerIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Customer Intelligence (DETERMINISTIC, no LLM, no Twilio).
//
//  Built ENTIRELY from existing Firestore data (jobs → customer
//  profiles). Every value is LIVE and real — no estimates, no
//  fabrication, no call/Twilio dependency. Reuses deriveCustomerProfiles
//  (the canonical per-customer rollup) + deriveVipTier.
//
//  Answers: who are my best customers · who hasn't used us recently ·
//  which customers generate the most revenue · which cities have the
//  highest repeat-customer rates · which tire sizes are most common.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { deriveCustomerProfiles, type CustomerProfile } from '@/lib/customers';
import { deriveVipTier } from '@/lib/customerInsights';
import { type Metric, live } from '../confidence';

/** A customer is "inactive" after this many days without a job. */
export const INACTIVE_DAYS = 90;
/** Min customers in a city before its repeat-rate is trend-worthy. */
const MIN_CITY_SAMPLE = 2;
const TOP_N = 8;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function daysBetween(today: string, date: string): number {
  const a = new Date(today + 'T12:00:00').getTime();
  const b = new Date(date + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

/** Most-frequent non-empty city across a customer's jobs ("Unknown" if none). */
export function customerCity(p: CustomerProfile): string {
  const counts = new Map<string, number>();
  for (const j of p.jobs || []) {
    const c = (j.city || '').trim();
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [c, k] of counts) if (k > n) { n = k; best = c; }
  return best || 'Unknown';
}

export interface RankedCustomer {
  key: string;
  name: string;
  /** Lifetime revenue (CLV). */
  revenue: number;
  jobCount: number;
  lastDate: string;
  daysSince: number;
  isRepeat: boolean;
  city: string;
  vipTier: 'Standard' | 'Gold' | 'Platinum';
}

function toRanked(p: CustomerProfile, today: string): RankedCustomer {
  return {
    key: p.key,
    name: p.name || 'Unnamed',
    revenue: round2(p.revenue),
    jobCount: p.jobCount,
    lastDate: p.lastDate,
    daysSince: p.lastDate ? daysBetween(today, p.lastDate) : Infinity,
    isRepeat: p.isRepeat,
    city: customerCity(p),
    vipTier: deriveVipTier(p.revenue),
  };
}

export interface CityTrend {
  city: string;
  total: number;
  repeat: number;
  repeatPct: number;
}

export interface ModeRow { value: string; count: number; }

/** Top-N modes of a string field over completed jobs. */
function topModes(jobs: ReadonlyArray<Job>, pick: (j: Job) => string): ModeRow[] {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    const v = (pick(j) || '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N);
}

export interface CustomerIntel {
  totalCustomers: Metric<number>;
  returningCustomers: Metric<number>;
  returningRatePct: Metric<number>;
  inactive90Count: Metric<number>;
  /** Highest lifetime-revenue customers (best / most revenue). */
  bestCustomers: RankedCustomer[];
  /** Customers with no job in 90+ days (hasn't used us recently). */
  inactive90: RankedCustomer[];
  /** Repeat customers who've lapsed 90+ days — re-engagement targets. */
  followUps: RankedCustomer[];
  /** City repeat-customer rates, highest first. */
  cityTrends: CityTrend[];
  topTireSizes: ModeRow[];
  topServices: ModeRow[];
}

export function customerIntelligence(jobs: ReadonlyArray<Job>, settings: Settings, today: string): CustomerIntel {
  const profiles = deriveCustomerProfiles(jobs as Job[], settings);
  const ranked = profiles.map((p) => toRanked(p, today));

  const returning = ranked.filter((r) => r.isRepeat);
  const inactive = ranked.filter((r) => r.lastDate && r.daysSince > INACTIVE_DAYS);

  const bestCustomers = [...ranked].sort((a, b) => b.revenue - a.revenue).slice(0, TOP_N);
  const inactive90 = [...inactive].sort((a, b) => b.daysSince - a.daysSince).slice(0, TOP_N);
  const followUps = [...inactive].filter((r) => r.isRepeat).sort((a, b) => b.revenue - a.revenue).slice(0, TOP_N);

  // City repeat-rate trends.
  const cityAgg = new Map<string, { total: number; repeat: number }>();
  for (const r of ranked) {
    const e = cityAgg.get(r.city) || { total: 0, repeat: 0 };
    e.total += 1;
    if (r.isRepeat) e.repeat += 1;
    cityAgg.set(r.city, e);
  }
  const cityTrends: CityTrend[] = Array.from(cityAgg.entries())
    .filter(([city, e]) => city !== 'Unknown' && e.total >= MIN_CITY_SAMPLE)
    .map(([city, e]) => ({ city, total: e.total, repeat: e.repeat, repeatPct: Math.round((e.repeat / e.total) * 100) }))
    .sort((a, b) => (b.repeatPct - a.repeatPct) || (b.total - a.total))
    .slice(0, TOP_N);

  const total = ranked.length;
  return {
    totalCustomers: live(total, 'customers', today),
    returningCustomers: live(returning.length, 'customers', today),
    returningRatePct: live(total > 0 ? Math.round((returning.length / total) * 100) : 0, 'customers', today),
    inactive90Count: live(inactive.length, 'customers', today),
    bestCustomers,
    inactive90,
    followUps,
    cityTrends,
    topTireSizes: topModes(jobs, (j) => j.tireSize || ''),
    topServices: topModes(jobs, (j) => j.service || ''),
  };
}
