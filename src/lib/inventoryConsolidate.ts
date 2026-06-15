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
const filled = (s: string | undefined): boolean => !!(s || '').trim();

export function consolidateInventoryBySize(items: ReadonlyArray<InventoryItem>): ConsolidateResult {
  // Pass 1 — build the survivor (summed) record for each size.
  const survivors = new Map<string, InventoryItem>();
  const counts = new Map<string, number>();
  for (const i of items) {
    const raw = (i.size || '').trim();
    const key = raw ? sizeKey(raw) : '';
    if (!key) continue; // blank / unparseable → handled in pass 2
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const prev = survivors.get(key);
    if (!prev) {
      survivors.set(key, { ...i, size: raw, qty: num(i.qty) });
    } else {
      survivors.set(key, {
        ...prev,
        qty: num(prev.qty) + num(i.qty),
        reservations: [...(prev.reservations || []), ...(i.reservations || [])],
        reorderPoint: Math.max(num(prev.reorderPoint ?? 1), num(i.reorderPoint ?? 1)),
        // Keep the survivor's descriptors; fall back to the folded entry
        // only where the survivor's field is empty.
        brand: filled(prev.brand) ? prev.brand : i.brand,
        model: filled(prev.model) ? prev.model : i.model,
        cost: num(prev.cost) > 0 ? prev.cost : num(i.cost),
        notes: filled(prev.notes) ? prev.notes : i.notes,
        condition: filled(prev.condition) ? prev.condition : i.condition,
      });
    }
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
