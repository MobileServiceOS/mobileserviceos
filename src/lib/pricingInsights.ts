// src/lib/pricingInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  Smart Pricing — pure helpers.
//  Mirrors aiInventoryInsights.ts: build a compact per-(service, size)
//  digest, ground Claude's reply against the digest's number set.
//
//  Owner/admin only at the UI layer; pure here.
//  Spec: docs/superpowers/specs/2026-05-26-smart-pricing-design.md
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { normalizeTireSize } from '@/lib/utils';

export interface PricingGroup {
  service: string;
  size: string;            // user-facing tire size string (first seen)
  sales: number;
  medianRevenue: number;
  p25Revenue: number;
  p75Revenue: number;
  configuredMin: number;   // settings.servicePricing[service].basePrice
  gapPct: number;          // (median - configuredMin) / configuredMin * 100, rounded
}

export interface PricingDigest {
  vertical: 'tire';
  windowDays: 90;
  totalCompletedJobs: number;
  currency: 'USD';
  groups: PricingGroup[];
}

export type PricingInsightsResult =
  | { ok: true; bullets: string[] }
  | { ok: false; error: 'unparseable' | 'malformed' | 'ungrounded' };

const WINDOW_DAYS = 90;
const MIN_SALES_PER_GROUP = 3;
const TOP_N_GROUPS = 5;
const MAX_BULLETS = 5;
const r = Math.round;

function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T00:00:00Z').getTime();
  const tb = new Date(b + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

/** Median of a sorted (ascending) array. Caller sorts. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Linear-interpolation percentile (0..1). Sorted (asc) input. */
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Build the per-(service, normalized-size) digest from completed jobs
 * in the last 90 days. Excludes:
 *   - non-Completed jobs
 *   - jobs outside the 90-day window
 *   - groups with fewer than MIN_SALES_PER_GROUP sales
 *   - groups whose service has no configured basePrice (>0)
 *
 * Sorts groups by (gapPct * sales) descending, takes the top 5.
 */
export function buildPricingDigest(
  jobs: ReadonlyArray<Job>,
  settings: Settings,
  today: string,
): PricingDigest {
  // Bucket by (service|normalized-size) → revenue list + user-facing label.
  const buckets = new Map<string, {
    service: string;
    sizeLabel: string;
    revenues: number[];
  }>();

  let totalCompleted = 0;
  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    if (!j.date || daysBetween(today, j.date) > WINDOW_DAYS) continue;
    totalCompleted++;
    const norm = normalizeTireSize(j.tireSize || '');
    if (!norm || !j.service) continue;
    const rev = Number(j.revenue || 0);
    if (!Number.isFinite(rev) || rev <= 0) continue;
    const key = j.service + '|' + norm;
    let b = buckets.get(key);
    if (!b) {
      b = { service: j.service, sizeLabel: j.tireSize || norm, revenues: [] };
      buckets.set(key, b);
    }
    b.revenues.push(rev);
  }

  const groups: PricingGroup[] = [];
  for (const b of buckets.values()) {
    if (b.revenues.length < MIN_SALES_PER_GROUP) continue;
    const cfg = settings.servicePricing?.[b.service];
    const baseP = Number(cfg?.basePrice || 0);
    if (baseP <= 0) continue;                         // skip no-baseline groups
    const sorted = b.revenues.slice().sort((x, y) => x - y);
    const med = r(median(sorted));
    const p25 = r(percentile(sorted, 0.25));
    const p75 = r(percentile(sorted, 0.75));
    const gapPct = r(((med - baseP) / baseP) * 100);
    groups.push({
      service: b.service,
      size: b.sizeLabel,
      sales: b.revenues.length,
      medianRevenue: med,
      p25Revenue: p25,
      p75Revenue: p75,
      configuredMin: baseP,
      gapPct,
    });
  }

  // Sort by |gapPct| × sales descending — high-volume gaps in EITHER
  // direction (over- or under-priced) lead. Take top N.
  groups.sort((a, b) => Math.abs(b.gapPct) * b.sales - Math.abs(a.gapPct) * a.sales);

  return {
    vertical: 'tire',
    windowDays: WINDOW_DAYS,
    totalCompletedJobs: totalCompleted,
    currency: 'USD',
    groups: groups.slice(0, TOP_N_GROUPS),
  };
}

/**
 * Flatten every numeric value in the digest into a Set<number>.
 * Tire size strings contribute their CONSTITUENT digits (225/65R17
 * → 225, 65, 17) so a bullet referencing a size by its digits is
 * considered grounded. Mirrors aiInventoryInsights.digestNumbers.
 */
function digestNumbers(d: PricingDigest): Set<number> {
  const set = new Set<number>();
  const add = (n: number): void => { if (Number.isFinite(n)) set.add(n); };
  add(d.totalCompletedJobs);
  add(d.windowDays);
  const addSizeDigits = (size: string): void => {
    const tokens = size.match(/\d+/g);
    if (!tokens) return;
    for (const t of tokens) add(parseInt(t, 10));
  };
  for (const g of d.groups) {
    add(g.sales);
    add(g.medianRevenue);
    add(g.p25Revenue);
    add(g.p75Revenue);
    add(g.configuredMin);
    add(g.gapPct);
    addSizeDigits(g.size);
  }
  return set;
}

/**
 * Parse the proxy reply, validate shape, and ground every numeric
 * token in each bullet against the digest. Drops ungrounded bullets;
 * returns ok:false if 0 grounded bullets remain. Mirrors
 * aiInventoryInsights.parseInventoryInsightsResponse.
 */
export function parsePricingInsightsResponse(
  text: string,
  digest: PricingDigest,
): PricingInsightsResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'unparseable' };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  const raw = (obj as { bullets?: unknown }).bullets;
  if (!Array.isArray(raw)) return { ok: false, error: 'malformed' };

  const numbers = digestNumbers(digest);
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const bullet = item.trim();
    if (!bullet || seen.has(bullet)) continue;
    const tokens = bullet.match(/\d[\d,]*(?:\.\d+)?/g);
    if (!tokens) continue;                            // a bullet with no numbers can't ground
    const grounded = tokens.every((t) => numbers.has(parseFloat(t.replace(/,/g, ''))));
    if (!grounded) continue;
    seen.add(bullet);
    bullets.push(bullet);
    if (bullets.length >= MAX_BULLETS) break;
  }
  if (!bullets.length) return { ok: false, error: 'ungrounded' };
  return { ok: true, bullets };
}

// ─── Visibility helper ─────────────────────────────────────────────
/**
 * Count completed jobs in the same 90-day window the digest uses.
 * Drives the visibility gate in PricingInsightsCard (>=10 to render).
 * Exposed here so the gate uses the SAME window as the digest itself.
 */
export function countCompletedJobsInWindow(
  jobs: ReadonlyArray<Job>,
  today: string,
): number {
  let n = 0;
  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    if (!j.date || daysBetween(today, j.date) > WINDOW_DAYS) continue;
    n++;
  }
  return n;
}
