// src/lib/inventoryIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Deterministic inventory intelligence — pure, on-device, no AI.
//
//  Turns the stock list + a per-size DEMAND map into the three
//  operationally-actionable lists a tire shop runs on:
//    • reorderNow  — in demand (jobs in window) AND low/out of stock
//    • fastMovers  — highest demand (distinct jobs)
//    • deadStock   — in stock but NO demand, ranked by tied-up cash
//  Plus the headline numbers (reorder count, total dead-stock value).
//
//  TWO design rules that fix the prior unit/duplicate bugs:
//    1. DEMAND IS MEASURED IN JOBS, not tire units. One job that sells a
//       set of 4 = ONE demand event, same as one single-tire job — so
//       set-buys don't 4× inflate ranking. Units stay available for
//       display, but ranking/priority is by `jobs`.
//    2. ON-HAND IS AGGREGATED PER SIZE. Inventory can hold several line
//       items for one size (duplicates, or a New + Used split). On-hand,
//       reorder, and dead-stock all read the SUMMED per-size total — keyed
//       by sizeKey so "205/55R16" / "205/55/16" / case/space
//       variants group as one size — never a single entry. (Aggregated at
//       read time; no records are merged or deleted.)
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';

/**
 * Canonical grouping key for a tire size. Collapses formatting variants so
 * true duplicates group: uppercases, strips every non-alphanumeric, then
 * drops the section letter(s) between aspect and rim. So
 *   "205/55R16", "205/55/16", "205-55-16", "205 55 16", "205/55ZR16"
 * all → "2055516". Non-tire / odd formats fall back to the compacted
 * string (still groups byte-identical entries). NOTE: deliberately more
 * aggressive than utils.normalizeTireSize, which keeps the 'R' and so
 * fails to unify slash-vs-R variants — that gap was the duplicate bug.
 */
export function sizeKey(s: string): string {
  const compact = (s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return compact.replace(/^(\d{3})(\d{2})[A-Z]+(\d{2})$/, '$1$2$3') || compact;
}

/** Per-size demand within a window. jobs = distinct demand events. */
export interface SizeDemand {
  jobs: number;
  units: number;
  revenue: number;
}

export interface IntelItem {
  /** Representative entry id (React key only). */
  id: string;
  /** Display size — the first entry's raw string for this size. */
  size: string;
  /** CONSOLIDATED on-hand: summed across every inventory entry of this size. */
  qty: number;
  /** Reorder threshold — the highest set across the size's entries (default 1). */
  reorderPoint: number;
  /** Distinct jobs this size appeared in within the window (the demand signal). */
  jobs: number;
  /** Tire units sold in the window (kept for display, NOT for ranking). */
  units: number;
  /** Revenue in the window. */
  revenue: number;
  /** Consolidated qty × unit cost — cash sitting on the shelf. */
  tiedValue: number;
}

export interface InventoryIntel {
  reorderNow: IntelItem[];
  fastMovers: IntelItem[];
  deadStock: IntelItem[];
  reorderCount: number;
  deadStockValue: number;
  deadStockCount: number;
}

interface RawItem {
  id: string;
  size?: string;
  qty?: number;
  cost?: number;
  reorderPoint?: number;
}

const TOP = 5;
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Per-size demand within a rolling window, keyed by sizeKey.
 * One Completed job = one demand event for its size regardless of how
 * many tires it moved (that's the whole point). `units` and `revenue`
 * are summed alongside for display.
 */
export function computeSizeDemand(
  jobs: ReadonlyArray<Job> | null | undefined,
  opts: { windowDays?: number | 'all'; now?: Date } = {},
): Map<string, SizeDemand> {
  const m = new Map<string, SizeDemand>();
  if (!jobs) return m;
  const { windowDays = DEFAULT_WINDOW_DAYS, now = new Date() } = opts;
  const cutoff = windowDays === 'all' ? -Infinity : now.getTime() - windowDays * 86_400_000;
  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    const size = sizeKey(j.tireSize || '');
    if (!size) continue;
    if (windowDays !== 'all') {
      const t = new Date((j.date || '') + 'T00:00:00Z').getTime();
      if (!Number.isFinite(t) || t < cutoff) continue;
    }
    const d = m.get(size) ?? { jobs: 0, units: 0, revenue: 0 };
    d.jobs += 1;
    d.units += Number(j.qty || 0) || 1;
    d.revenue += Number(j.revenue || 0) || 0;
    m.set(size, d);
  }
  return m;
}

/** Priority comparator: demand events desc → out-of-stock first → revenue → units. */
function byDemand(a: IntelItem, b: IntelItem): number {
  if (b.jobs !== a.jobs) return b.jobs - a.jobs;
  const aOut = a.qty === 0, bOut = b.qty === 0;
  if (aOut !== bOut) return aOut ? -1 : 1;
  if (b.revenue !== a.revenue) return b.revenue - a.revenue;
  return b.units - a.units;
}

/**
 * Build the inventory intelligence lists. `demandBySize` is the per-size
 * demand map (see computeSizeDemand), keyed by sizeKey.
 * Pure — same inputs, same output.
 */
export function computeInventoryIntel(
  items: RawItem[],
  demandBySize: Map<string, SizeDemand>,
): InventoryIntel {
  // Aggregate inventory entries per normalized size so duplicate line
  // items — and New + Used splits — report ONE combined on-hand.
  const bySize = new Map<string, IntelItem>();
  for (const i of items) {
    const raw = String(i.size ?? '').trim();
    if (!raw) continue;
    const key = sizeKey(raw);
    if (!key) continue;
    const qty = Number(i.qty) || 0;
    const cost = Number(i.cost) || 0;
    const rp = Number(i.reorderPoint ?? 1);
    const prev = bySize.get(key);
    if (prev) {
      prev.qty += qty;
      prev.tiedValue += qty * cost;
      prev.reorderPoint = Math.max(prev.reorderPoint, rp);
    } else {
      const d = demandBySize.get(key);
      bySize.set(key, {
        id: i.id,
        size: raw,
        qty,
        reorderPoint: rp,
        jobs: d?.jobs ?? 0,
        units: d?.units ?? 0,
        revenue: d?.revenue ?? 0,
        tiedValue: qty * cost,
      });
    }
  }
  const enriched = Array.from(bySize.values());

  // In demand (jobs > 0) AND at/below the size's reorder point → reorder.
  const reorder = enriched.filter((i) => i.jobs > 0 && i.qty <= i.reorderPoint).sort(byDemand);
  const fast = enriched.filter((i) => i.jobs > 0).sort(byDemand);
  // In stock but no demand events → dead. Biggest cash drain first.
  const dead = enriched.filter((i) => i.qty > 0 && i.jobs === 0).sort((a, b) => b.tiedValue - a.tiedValue);

  return {
    reorderNow: reorder.slice(0, TOP),
    fastMovers: fast.slice(0, TOP),
    deadStock: dead.slice(0, TOP),
    reorderCount: reorder.length,
    deadStockValue: dead.reduce((s, i) => s + i.tiedValue, 0),
    deadStockCount: dead.length,
  };
}
