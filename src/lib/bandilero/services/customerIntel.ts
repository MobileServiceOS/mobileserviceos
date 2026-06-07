// src/lib/bandilero/services/customerIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Customer Intelligence (DETERMINISTIC, no LLM, no Twilio).
//
//  The single consolidated customer system (Customer Segments is merged
//  in here). Built ENTIRELY from existing Firestore data (jobs →
//  customer profiles). Every value LIVE — no estimates, no fabrication.
//  Reuses deriveCustomerProfiles + the segment predicates (isVip /
//  isNewCustomer / isAtRisk).
//
//  Structure: Overview · Value · Behavior · Follow-Up (30/60/90) ·
//  Insights — answering: best customers, who's lapsed, most revenue,
//  city repeat rates, common tire sizes.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { deriveCustomerProfiles, type CustomerProfile } from '@/lib/customers';
import { deriveVipTier } from '@/lib/customerInsights';
import { isVip, isNewCustomer, isAtRisk } from './customerSegments';
import { type Metric, live } from '../confidence';

export const INACTIVE_DAYS = 90;
const MIN_CITY_SAMPLE = 2;
const TOP_N = 8;

function round2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100; }
function fmt$(n: number): string { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
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
  key: string; name: string; revenue: number; jobCount: number;
  lastDate: string; daysSince: number; isRepeat: boolean; city: string;
  vipTier: 'Standard' | 'Gold' | 'Platinum';
}
function toRanked(p: CustomerProfile, today: string): RankedCustomer {
  return {
    key: p.key, name: p.name || 'Unnamed', revenue: round2(p.revenue), jobCount: p.jobCount,
    lastDate: p.lastDate, daysSince: p.lastDate ? daysBetween(today, p.lastDate) : Infinity,
    isRepeat: p.isRepeat, city: customerCity(p), vipTier: deriveVipTier(p.revenue),
  };
}

export interface CityTrend { city: string; total: number; repeat: number; repeatPct: number; }
export interface ModeRow { value: string; count: number; }
export interface CustomerInsight { kind: 'risk' | 'opportunity' | 'action'; text: string; }

function topModes(jobs: ReadonlyArray<Job>, pick: (j: Job) => string): ModeRow[] {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    const v = (pick(j) || '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count).slice(0, TOP_N);
}

export interface CustomerIntel {
  // ── Overview ──
  totalCustomers: Metric<number>;
  newCustomers: Metric<number>;
  returningCustomers: Metric<number>;
  returningRatePct: Metric<number>;
  vipCustomers: Metric<number>;
  atRiskCustomers: Metric<number>;
  // ── Value ──
  totalRevenue: Metric<number>;
  bestCustomers: RankedCustomer[];
  top5RevenueSharePct: Metric<number>;
  // ── Behavior ──
  topServices: ModeRow[];
  topTireSizes: ModeRow[];
  cityTrends: CityTrend[];
  // ── Follow-Up (cumulative inactivity thresholds) ──
  inactive30Count: Metric<number>;
  inactive60Count: Metric<number>;
  inactive90Count: Metric<number>;
  inactive90: RankedCustomer[];
  followUps: RankedCustomer[];
  // ── Bandilero Insights (deterministic; risks / opportunities / actions) ──
  insights: CustomerInsight[];
}

export function customerIntelligence(jobs: ReadonlyArray<Job>, settings: Settings, today: string): CustomerIntel {
  const profiles = deriveCustomerProfiles(jobs as Job[], settings);
  const ranked = profiles.map((p) => toRanked(p, today));
  const total = ranked.length;

  const returning = ranked.filter((r) => r.isRepeat);
  const news = profiles.filter((p) => isNewCustomer(p, today));
  const vips = profiles.filter(isVip);
  const atRisk = profiles.filter((p) => isAtRisk(p, today));

  const inactiveOver = (d: number) => ranked.filter((r) => r.lastDate && r.daysSince > d);
  const inactive30 = inactiveOver(30);
  const inactive60 = inactiveOver(60);
  const inactive90Full = inactiveOver(90);
  const inactive90 = [...inactive90Full].sort((a, b) => b.daysSince - a.daysSince).slice(0, TOP_N);
  const followUps = inactive90Full.filter((r) => r.isRepeat).sort((a, b) => b.revenue - a.revenue).slice(0, TOP_N);

  const totalRevenue = round2(ranked.reduce((t, r) => t + r.revenue, 0));
  const bestCustomers = [...ranked].sort((a, b) => b.revenue - a.revenue).slice(0, TOP_N);
  const top5Rev = bestCustomers.slice(0, 5).reduce((t, r) => t + r.revenue, 0);
  const top5SharePct = totalRevenue > 0 ? Math.round((top5Rev / totalRevenue) * 100) : 0;

  // City repeat-rate trends.
  const cityAgg = new Map<string, { total: number; repeat: number }>();
  for (const r of ranked) {
    const e = cityAgg.get(r.city) || { total: 0, repeat: 0 };
    e.total += 1; if (r.isRepeat) e.repeat += 1; cityAgg.set(r.city, e);
  }
  const cityTrends: CityTrend[] = Array.from(cityAgg.entries())
    .filter(([city, e]) => city !== 'Unknown' && e.total >= MIN_CITY_SAMPLE)
    .map(([city, e]) => ({ city, total: e.total, repeat: e.repeat, repeatPct: Math.round((e.repeat / e.total) * 100) }))
    .sort((a, b) => (b.repeatPct - a.repeatPct) || (b.total - a.total)).slice(0, TOP_N);

  const topServices = topModes(jobs, (j) => j.service || '');
  const topTireSizes = topModes(jobs, (j) => j.tireSize || '');

  // ── Deterministic insights (real, derived from the above) ──
  const insights: CustomerInsight[] = [];
  if (followUps.length > 0) {
    const f = followUps[0];
    insights.push({ kind: 'opportunity', text: `Re-engage ${followUps.length} lapsed repeat customer(s) — top: ${f.name} (${fmt$(f.revenue)} lifetime, ${f.daysSince}d ago).` });
  }
  if (atRisk.length > 0) {
    insights.push({ kind: 'risk', text: `${atRisk.length} repeat customer(s) are overdue for a visit.` });
  }
  if (cityTrends.length > 0) {
    const c = cityTrends[0];
    insights.push({ kind: 'opportunity', text: `${c.city} has the highest repeat rate (${c.repeatPct}% of ${c.total} customers).` });
  }
  if (bestCustomers.length > 0 && top5SharePct > 0) {
    insights.push({ kind: 'action', text: `Top 5 customers drive ${top5SharePct}% of revenue — protect these relationships.` });
  }

  return {
    totalCustomers: live(total, 'customers', today),
    newCustomers: live(news.length, 'customers', today),
    returningCustomers: live(returning.length, 'customers', today),
    returningRatePct: live(total > 0 ? Math.round((returning.length / total) * 100) : 0, 'customers', today),
    vipCustomers: live(vips.length, 'customers', today),
    atRiskCustomers: live(atRisk.length, 'customers', today),
    totalRevenue: live(totalRevenue, 'customers', today),
    bestCustomers,
    top5RevenueSharePct: live(top5SharePct, 'customers', today),
    topServices,
    topTireSizes,
    cityTrends,
    inactive30Count: live(inactive30.length, 'customers', today),
    inactive60Count: live(inactive60.length, 'customers', today),
    inactive90Count: live(inactive90Full.length, 'customers', today),
    inactive90,
    followUps,
    insights,
  };
}
