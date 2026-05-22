// src/lib/inventoryHealth.ts
// ═══════════════════════════════════════════════════════════════════
//  Inventory health categorization for the tire-vertical Inventory
//  page (roadmap inventory upgrade — Phase 2).
//
//  Each item lands in one of four buckets:
//    critical — qty 0 (out of stock)
//    low      — 0 < qty ≤ 1
//    dead     — qty > 1 AND no matching-size job in last `deadDays`
//    healthy  — qty > 1 AND a matching-size job in the window
//
//  Pure helper. No I/O, no React.
//  Spec: docs/superpowers/specs/2026-05-22-inventory-health-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, Job } from '@/types';
import { normalizeTireSize } from '@/lib/utils';

export type InventoryHealthBucket = 'critical' | 'low' | 'healthy' | 'dead';

export const HEALTH_BUCKETS: InventoryHealthBucket[] = [
  'critical', 'low', 'healthy', 'dead',
];

export interface InventoryHealthOpts {
  /** Days a tire size must go without a matching job to be "dead".
   *  Default 90. */
  deadDays?: number;
}

const DEFAULT_DEAD_DAYS = 90;

function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T00:00:00Z').getTime();
  const tb = new Date(b + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

// Build the set of normalized sizes that have a job within the
// recency window. O(jobs) once per call; categorize() then runs in
// O(1) per item.
function recentlySoldSizes(
  jobs: ReadonlyArray<Job>,
  today: string,
  deadDays: number,
): Set<string> {
  const set = new Set<string>();
  for (const j of jobs) {
    const size = normalizeTireSize(j.tireSize || '');
    if (!size || !j.date) continue;
    if (daysBetween(today, j.date) <= deadDays) set.add(size);
  }
  return set;
}

export function categorizeInventoryHealth(
  item: InventoryItem,
  jobs: ReadonlyArray<Job>,
  today: string,
  opts?: InventoryHealthOpts,
): InventoryHealthBucket {
  const qty = Number(item.qty || 0);
  if (qty === 0) return 'critical';
  if (qty <= 1) return 'low';
  // qty > 1 from here on — distinguish healthy vs dead.
  const size = normalizeTireSize(item.size || '');
  if (!size) return 'healthy'; // no size to match against → cannot mark dead.
  const window = opts?.deadDays ?? DEFAULT_DEAD_DAYS;
  const sold = recentlySoldSizes(jobs, today, window);
  return sold.has(size) ? 'healthy' : 'dead';
}

export function inventoryHealthCounts(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
  opts?: InventoryHealthOpts,
): Record<InventoryHealthBucket, number> {
  // Precompute the sold set once so the loop is O(items) total.
  const window = opts?.deadDays ?? DEFAULT_DEAD_DAYS;
  const sold = recentlySoldSizes(jobs, today, window);
  const counts: Record<InventoryHealthBucket, number> = {
    critical: 0, low: 0, healthy: 0, dead: 0,
  };
  for (const item of items) {
    const qty = Number(item.qty || 0);
    let bucket: InventoryHealthBucket;
    if (qty === 0) bucket = 'critical';
    else if (qty <= 1) bucket = 'low';
    else {
      const size = normalizeTireSize(item.size || '');
      bucket = !size || sold.has(size) ? 'healthy' : 'dead';
    }
    counts[bucket] += 1;
  }
  return counts;
}
