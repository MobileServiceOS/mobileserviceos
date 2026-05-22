// src/lib/insights.ts
// ═══════════════════════════════════════════════════════════════════
//  Business analytics — pure derivation layer for the Insights page.
//
//  Everything is computed live from the job list. No stored
//  analytics, no migration. One entry point, computeInsights(),
//  so the page does a single call. Pure + side-effect free —
//  unit-tested in tests/insights.test.ts.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { jobGrossProfit, resolvePaymentStatus, getWeekStart } from '@/lib/utils';
import { deriveCustomerProfiles } from '@/lib/customers';

export interface WeekPoint {
  weekStart: string;
  revenue: number;
  profit: number;
}
export interface ServiceStat {
  service: string;
  revenue: number;
  profit: number;
  count: number;
}
export interface SourceStat {
  source: string;
  revenue: number;
  count: number;
}
export interface CityStat {
  city: string;
  profit: number;
  count: number;
}
export type AgingBucket = '0-7d' | '8-30d' | '31-60d' | '60d+';
export interface AgingRow {
  bucket: AgingBucket;
  count: number;
  total: number;
}
export interface Insights {
  /** Last 8 weeks, oldest → newest, zero-filled. */
  revenueTrend: WeekPoint[];
  /** Service types ranked by total profit, highest first. */
  topServices: ServiceStat[];
  /** Lead sources ranked by total revenue, highest first. */
  topSources: SourceStat[];
  /** Cities ranked by total profit, highest first. */
  topCities: CityStat[];
  repeat: { total: number; repeat: number; pct: number };
  /** Unpaid jobs bucketed by age. Always all 4 buckets, in order. */
  unpaidAging: AgingRow[];
}

const TREND_WEEKS = 8;

/** Days between two YYYY-MM-DD dates (a - b), floored, non-negative. */
function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T12:00:00').getTime();
  const tb = new Date(b + 'T12:00:00').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 7) return '0-7d';
  if (ageDays <= 30) return '8-30d';
  if (ageDays <= 60) return '31-60d';
  return '60d+';
}

export function computeInsights(
  jobs: ReadonlyArray<Job>,
  settings: Settings,
  today: string,
): Insights {
  const list = jobs || [];
  const weekStartDay =
    typeof settings.workWeekStartDay === 'number' ? settings.workWeekStartDay : 1;

  // ── Revenue trend — last 8 weeks, zero-filled ───────────────────
  // Build the 8 expected week-start keys ending with this week, so
  // a quiet week still renders as a zero bar (stable chart).
  const thisWeek = getWeekStart(today, weekStartDay);
  const weekKeys: string[] = [];
  {
    const d = new Date(thisWeek + 'T12:00:00');
    for (let i = TREND_WEEKS - 1; i >= 0; i--) {
      const w = new Date(d);
      w.setDate(w.getDate() - i * 7);
      weekKeys.push(w.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
    }
  }
  const trendMap = new Map<string, WeekPoint>();
  for (const k of weekKeys) trendMap.set(k, { weekStart: k, revenue: 0, profit: 0 });

  // ── Single pass for the rankings + trend ────────────────────────
  const svc = new Map<string, ServiceStat>();
  const src = new Map<string, SourceStat>();
  const cty = new Map<string, CityStat>();
  const aging = new Map<AgingBucket, AgingRow>([
    ['0-7d', { bucket: '0-7d', count: 0, total: 0 }],
    ['8-30d', { bucket: '8-30d', count: 0, total: 0 }],
    ['31-60d', { bucket: '31-60d', count: 0, total: 0 }],
    ['60d+', { bucket: '60d+', count: 0, total: 0 }],
  ]);

  for (const j of list) {
    const revenue = Number(j.revenue || 0);
    const profit = jobGrossProfit(j, settings);

    // Trend — only weeks inside the 8-week window count.
    if (j.date) {
      const wk = getWeekStart(j.date, weekStartDay);
      const point = trendMap.get(wk);
      if (point) {
        point.revenue += revenue;
        point.profit += profit;
      }
    }

    // Top services — by profit.
    const sName = (j.service || '').trim() || 'Other';
    const s = svc.get(sName) || { service: sName, revenue: 0, profit: 0, count: 0 };
    s.revenue += revenue; s.profit += profit; s.count += 1;
    svc.set(sName, s);

    // Top lead sources — by revenue.
    const srcName = (j.source || '').trim() || 'Unknown';
    const so = src.get(srcName) || { source: srcName, revenue: 0, count: 0 };
    so.revenue += revenue; so.count += 1;
    src.set(srcName, so);

    // Top cities — by profit.
    const cName =
      (j.city || '').trim() ||
      (j.fullLocationLabel || '').trim() ||
      (j.area || '').trim();
    if (cName) {
      const c = cty.get(cName) || { city: cName, profit: 0, count: 0 };
      c.profit += profit; c.count += 1;
      cty.set(cName, c);
    }

    // Unpaid aging.
    if (resolvePaymentStatus(j) !== 'Paid' && j.date) {
      const row = aging.get(bucketFor(daysBetween(today, j.date)));
      if (row) { row.count += 1; row.total += revenue; }
    }
  }

  // ── Repeat-customer rate ────────────────────────────────────────
  const profiles = deriveCustomerProfiles(list, settings);
  const repeatCount = profiles.filter((p) => p.isRepeat).length;
  const total = profiles.length;

  return {
    revenueTrend: weekKeys.map((k) => trendMap.get(k) as WeekPoint),
    topServices: Array.from(svc.values()).sort((a, b) => b.profit - a.profit),
    topSources: Array.from(src.values()).sort((a, b) => b.revenue - a.revenue),
    topCities: Array.from(cty.values()).sort((a, b) => b.profit - a.profit),
    repeat: {
      total,
      repeat: repeatCount,
      pct: total > 0 ? Math.round((repeatCount / total) * 100) : 0,
    },
    unpaidAging: ['0-7d', '8-30d', '31-60d', '60d+'].map(
      (b) => aging.get(b as AgingBucket) as AgingRow,
    ),
  };
}
