// src/lib/inventoryConsolidate.ts
// ═══════════════════════════════════════════════════════════════════
//  One-time consolidation migration for duplicate inventory entries.
//
//  The inventory engine reads on-hand as the SUM across every entry of a
//  size (see inventoryIntel.sizeKey / computeInventoryIntel) — that fix
//  is durable at read time. This helper is the matching CLEANUP: it
//  collapses the stored records so each size is a SINGLE row whose qty is
//  the combined total, bringing the persisted data in line with how it's
//  already counted.
//
//  Grouping is by normalized SIZE only (sizeKey), so formatting variants
//  — "205/55R16" vs "205/55/16" vs case/space, R vs slash — and a
//  New + Used split of the same size all fold into one row. (Read-time
//  aggregation already treats them as one size; this makes it explicit.)
//
//  Non-destructive & idempotent:
//   - Quantities and reservations are SUMMED into one surviving record;
//     no qty is ever dropped. The survivor keeps its descriptive fields
//     (brand / model / cost / condition / notes), falling back to a
//     folded entry's value only where the survivor's is blank.
//   - The caller persists `next` as one atomic document write, so the
//     combined total is written before the extra rows cease to exist —
//     there is no partial state where qty could be lost.
//   - Re-running on already-consolidated data is a no-op (mergedCount 0),
//     so the migration is safe to trigger repeatedly.
//
//  Pure: same input → same output. Blank/in-progress rows (no size) and
//  rows whose size doesn't normalize are passed through untouched, in
//  their original positions.
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem } from '@/types';
import { sizeKey } from '@/lib/inventoryIntel';

export interface ConsolidateResult {
  /** The consolidated list — one row per size, survivors in first-seen
   *  order, blank/odd rows left in place. */
  next: InventoryItem[];
  /** How many entries were folded away (total entries − surviving rows). */
  mergedCount: number;
  /** How many distinct sizes had more than one entry. */
  sizesAffected: number;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

interface Agg {
  /** First-seen entry id — survivor keeps it so the card's position / React
   *  key stays stable. */
  firstId: string;
  /** First-seen raw size string — used for display. */
  size: string;
  qty: number;
  reservations: NonNullable<InventoryItem['reservations']>;
  reorderPoint: number;
  /** The entry holding the most stock — its descriptors (brand / model /
   *  condition / cost / notes) represent the merged row, so the surviving
   *  card reflects where the stock actually is rather than an arbitrary
   *  first entry (e.g. a New entry with 2 wins over a Used entry with 0). */
  dominant: InventoryItem;
}

export function consolidateInventoryBySize(items: ReadonlyArray<InventoryItem>): ConsolidateResult {
  // Pass 1 — accumulate per size: summed qty, merged reservations, max
  // reorder point, and the dominant (most-stock) entry for descriptors.
  const aggs = new Map<string, Agg>();
  const counts = new Map<string, number>();
  for (const i of items) {
    const raw = (i.size || '').trim();
    const key = raw ? sizeKey(raw) : '';
    if (!key) continue; // blank / unparseable → handled in pass 2
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const q = num(i.qty);
    const prev = aggs.get(key);
    if (!prev) {
      aggs.set(key, {
        firstId: i.id,
        size: raw,
        qty: q,
        reservations: [...(i.reservations || [])],
        reorderPoint: num(i.reorderPoint ?? 1),
        dominant: i,
      });
    } else {
      prev.qty += q;
      prev.reservations.push(...(i.reservations || []));
      prev.reorderPoint = Math.max(prev.reorderPoint, num(i.reorderPoint ?? 1));
      // Strictly greater so ties keep the earlier (first-seen) entry.
      if (q > num(prev.dominant.qty)) prev.dominant = i;
    }
  }

  // Build the survivor record for each size from its dominant entry, with
  // the accumulated totals layered on top.
  const survivors = new Map<string, InventoryItem>();
  for (const [key, a] of aggs) {
    survivors.set(key, {
      ...a.dominant,
      id: a.firstId,
      size: a.size,
      qty: a.qty,
      reservations: a.reservations,
      reorderPoint: a.reorderPoint,
    });
  }

  // Pass 2 — emit survivors at the position of their first occurrence and
  // pass blank/odd rows through in place, preserving original order.
  const emitted = new Set<string>();
  const next: InventoryItem[] = [];
  for (const i of items) {
    const raw = (i.size || '').trim();
    const key = raw ? sizeKey(raw) : '';
    if (!key) { next.push(i); continue; }
    if (emitted.has(key)) continue; // a later duplicate — folded into the survivor
    emitted.add(key);
    next.push(survivors.get(key)!);
  }

  let mergedCount = 0;
  let sizesAffected = 0;
  for (const n of counts.values()) {
    if (n > 1) { mergedCount += n - 1; sizesAffected += 1; }
  }

  return { next, mergedCount, sizesAffected };
}
