// src/lib/inventoryBulkMerge.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helper for the bulk-import merge logic. Takes the current
//  inventory list plus a batch of incoming parsed rows and returns
//  the next inventory list with two-axis dedup applied:
//
//    1. Incoming row matches an EXISTING item (same normalized-size +
//       condition) → bump qty on that item.
//    2. Incoming row matches a row WE JUST ADDED in this same batch
//       (e.g. three "215/55R17 1" lines pasted from notes) →
//       accumulate qty on the new row rather than creating two
//       separate cards for the same SKU.
//
//  Match key intentionally ignores cost/notes — a price update on
//  the same SKU should merge, not split.
//
//  Extracted from Inventory.tsx so the dedup correctness is testable
//  in isolation. The inline implementation in Inventory.tsx delegated
//  to React state which made the second-match case (axis 2) hard to
//  trace; a regression in that case shipped this morning and would
//  have been caught by these tests if they had existed.
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem } from '@/types';
import { normalizeTireSize } from '@/lib/utils';

export interface IncomingRow {
  tireSize: string;
  condition: string;
  quantity: number;
  cost: number;
  sellingPrice: number;
  vendor: string;
  notes: string;
}

export interface MergeResult {
  /** Next inventory list — new rows prepended, existing rows merged
   *  in place. Same shape as `list` so the caller can plug it into
   *  the existing `update(next)` flow without further mapping. */
  next: InventoryItem[];
  /** Count of incoming rows that merged into either an existing item
   *  or an earlier new row in this same batch. */
  mergedCount: number;
  /** Count of incoming rows that created brand-new inventory cards
   *  (no prior match in either dimension). */
  addedCount: number;
}

const keyOf = (size: string, condition: string): string =>
  normalizeTireSize(size) + '|' + (condition || 'New');

const buildNotes = (r: IncomingRow): string => [
  r.vendor && `Vendor: ${r.vendor}`,
  r.sellingPrice ? `Sell: $${r.sellingPrice}` : '',
  r.notes,
].filter(Boolean).join(' · ');

/**
 * Apply two-axis dedup to a batch of incoming rows. Pure function;
 * does not mutate `list` or `incoming`.
 *
 * @param list      Current inventory list (snapshot of state).
 * @param incoming  Rows the operator just parsed/uploaded. Caller
 *                  filters out _error rows BEFORE passing.
 * @param freshId   Function that returns a unique id for new items.
 *                  Passed in so tests can produce deterministic ids
 *                  and the production caller passes `uid` from utils.
 */
export function mergeBulkRows(
  list: ReadonlyArray<InventoryItem>,
  incoming: ReadonlyArray<IncomingRow>,
  freshId: () => string,
): MergeResult {
  type Ref = { in: 'existing'; idx: number } | { in: 'new'; idx: number };
  const byKey = new Map<string, Ref>();
  list.forEach((i, idx) => {
    byKey.set(keyOf(i.size, i.condition || 'New'), { in: 'existing', idx });
  });
  // Snapshot of existing items — mutated in-place as we accumulate
  // qty on matches. The original `list` is left untouched.
  const merged: InventoryItem[] = list.map((i) => ({ ...i }));
  const newRows: InventoryItem[] = [];
  let mergedCount = 0;
  for (const r of incoming) {
    const k = keyOf(r.tireSize, r.condition);
    const ref = byKey.get(k);
    if (ref) {
      if (ref.in === 'existing') {
        merged[ref.idx] = {
          ...merged[ref.idx],
          qty: Number(merged[ref.idx].qty || 0) + Number(r.quantity || 0),
        };
      } else {
        newRows[ref.idx] = {
          ...newRows[ref.idx],
          qty: Number(newRows[ref.idx].qty || 0) + Number(r.quantity || 0),
        };
      }
      mergedCount++;
    } else {
      const fresh: InventoryItem = {
        id: freshId(),
        size: r.tireSize,
        qty: r.quantity,
        cost: r.cost,
        condition: r.condition,
        brand: '',
        model: '',
        notes: buildNotes(r),
      };
      newRows.push(fresh);
      byKey.set(k, { in: 'new', idx: newRows.length - 1 });
    }
  }
  return {
    next: [...newRows, ...merged],
    mergedCount,
    addedCount: newRows.length,
  };
}
