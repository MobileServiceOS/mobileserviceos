import type { Job } from '@/types';
import { extractTireSize } from '@/lib/inventoryNotesParser';

// ─────────────────────────────────────────────────────────────────────
//  Best-selling tires — pure aggregation over completed jobs.
//
//  Public API:
//    computeBestSellingTires(jobs, options) → BestSellerRow[]
//
//  Default behavior:
//    - Counts "work done" jobs: status === 'Completed' OR 'Pending'
//      (Pending = legacy done-but-unpaid; still a real sale). The
//      scheduled pipeline (Scheduled/En Route/In Progress) + Cancelled
//      are excluded — same rule the revenue metrics use.
//    - Groups by CANONICAL tireSize via extractTireSize (e.g.
//      "225/65-17" / "225-65-17" / "225 65 17" all → "225/65R17"
//      so the same physical size doesn't split across rows AND the
//      display value is operator-readable)
//    - Sort order is configurable:
//        'quantity' — qty DESC, tie-break revenue DESC (default,
//                     the "best sellers" answer most operators want)
//        'revenue'  — revenue DESC, tie-break qty DESC
//        'size'     — numeric by tire size (width, aspect, rim) ASC
//                     so 215/55R17 < 225/65R17 < 235/65R17 etc.
//    - Returns the top N rows (default 10)
//
//  Window:
//    - 'all'  → no date filter (every completed job)
//    - 30/90  → last N days from `today` (today defaults to now-ISO,
//               overridable for tests)
//
//  Sentinel-safe: jobs with empty / unparseable tireSize are skipped
//  rather than thrown — operators sometimes log a job without filling
//  the tire size, and dropping bad rows shouldn't break the rest of
//  the chart.
// ─────────────────────────────────────────────────────────────────────

export interface BestSellerRow {
  /** Canonical tire size, e.g. "225/65R17". */
  tireSize: string;
  /** Total tires sold across all included jobs. */
  quantity: number;
  /** Total revenue across all included jobs (sum of job.revenue). */
  revenue: number;
  /** Number of distinct jobs this size appeared on. */
  jobCount: number;
  /** Average revenue per tire (revenue / quantity). 0 if quantity 0. */
  avgPerTire: number;
}

export type BestSellerWindow = 7 | 30 | 90 | 'all';
// 'jobs' (default) ranks by demand EVENTS — distinct jobs a size appears
// in — so a one-job set-of-4 sale doesn't outrank four separate single-tire
// jobs. 'quantity' keeps the raw tire-unit ranking; 'size'/'revenue' as before.
export type BestSellerSort = 'jobs' | 'quantity' | 'size' | 'revenue';

export interface BestSellerOptions {
  /** Rolling window in days, or 'all' for no date filter. Default 90. */
  windowDays?: BestSellerWindow;
  /** Top-N cap. Default 10. */
  limit?: number;
  /** Sort order. Default 'jobs' (demand events). */
  sortBy?: BestSellerSort;
  /** Current on-hand per CANONICAL size (extractTireSize key) — used only
   *  for the 'jobs' tie-break, where out-of-stock sizes rank first so a
   *  hot seller you're out of surfaces. Optional. */
  onHandBySize?: Map<string, number>;
  /** Override "now" for tests. Default `new Date()`. */
  now?: Date;
}

/**
 * Parse a canonical tire-size string ("WIDTH/ASPECTRRIM") into a
 * numeric triple for size-order comparison. Returns [0,0,0] for
 * unparseable input — sinks bad rows to the top in size-sort where
 * they're easy to notice. Stays in this module rather than utils
 * because the consumer (BestSellersCard) is the only call site.
 */
function tireSizeKey(canonical: string): [number, number, number] {
  const m = canonical.match(/^(\d+)\/(\d+)R(\d+)$/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function computeBestSellingTires(
  jobs: Job[] | null | undefined,
  options: BestSellerOptions = {},
): BestSellerRow[] {
  const { windowDays = 90, limit = 10, sortBy = 'jobs', now = new Date(), onHandBySize } = options;
  if (!jobs || jobs.length === 0) return [];

  const cutoffMs = windowDays === 'all'
    ? -Infinity
    : now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const buckets = new Map<string, BestSellerRow>();

  for (const j of jobs) {
    // Count both "work done" states. 'Pending' is the legacy done-but-unpaid
    // status — a sold/installed tire is a real sale even before payment clears,
    // and the revenue + demand metrics already treat Pending as done work (see
    // `liveJobs` in insights.ts). Previously this counted ONLY 'Completed', so
    // every Pending sale was silently dropped from Best Sellers — which is why
    // a size sold many times could fail to appear. The forward-looking
    // scheduled pipeline (Scheduled/En Route/In Progress) and Cancelled are
    // still excluded: those are not completed sales.
    if (j.status !== 'Completed' && j.status !== 'Pending') continue;
    const sizeRaw = (j.tireSize || '').trim();
    if (!sizeRaw) continue;
    // extractTireSize returns canonical "WIDTH/ASPECTRRIM" or '' when
    // the input doesn't match a tire-size pattern. Operators
    // occasionally type free-text in this field; that's fine — it's
    // simply excluded from the ranking rather than skewing it.
    const tireSize = extractTireSize(sizeRaw);
    if (!tireSize) continue;

    // Date filter — Jobs store ISO date strings (YYYY-MM-DD). Parse
    // permissively; an unparseable date in 'all' mode still passes
    // because cutoffMs is -Infinity.
    if (windowDays !== 'all') {
      const jobMs = Date.parse(j.date || '');
      if (!Number.isFinite(jobMs)) continue;
      if (jobMs < cutoffMs) continue;
    }

    const qty = Number(j.qty || 0) || 0;
    const rev = Number(j.revenue || 0) || 0;
    if (qty <= 0 && rev <= 0) continue; // no signal

    const existing = buckets.get(tireSize);
    if (existing) {
      existing.quantity += qty;
      existing.revenue += rev;
      existing.jobCount += 1;
    } else {
      buckets.set(tireSize, {
        tireSize,
        quantity: qty,
        revenue: rev,
        jobCount: 1,
        avgPerTire: 0,
      });
    }
  }

  // Compute avgPerTire after totals settle.
  for (const row of buckets.values()) {
    row.avgPerTire = row.quantity > 0 ? row.revenue / row.quantity : 0;
  }

  const isOut = (size: string): boolean => (onHandBySize?.get(size) ?? 0) === 0;

  const sorted = Array.from(buckets.values()).sort((a, b) => {
    if (sortBy === 'size') {
      const [aw, aa, ar] = tireSizeKey(a.tireSize);
      const [bw, ba, br] = tireSizeKey(b.tireSize);
      if (aw !== bw) return aw - bw;
      if (aa !== ba) return aa - ba;
      return ar - br;
    }
    if (sortBy === 'revenue') {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return b.quantity - a.quantity;
    }
    if (sortBy === 'quantity') {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return b.revenue - a.revenue;
    }
    // 'jobs' (default) — demand events. Tie-break: out-of-stock first,
    // then revenue, then tire units.
    if (b.jobCount !== a.jobCount) return b.jobCount - a.jobCount;
    const aOut = isOut(a.tireSize), bOut = isOut(b.tireSize);
    if (aOut !== bOut) return aOut ? -1 : 1;
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return b.quantity - a.quantity;
  });

  return sorted.slice(0, limit);
}
