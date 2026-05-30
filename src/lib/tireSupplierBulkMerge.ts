import type { TireSupplierPrice } from './tireQuoteTypes';
import { extractTireSize } from './inventoryNotesParser';

// ─────────────────────────────────────────────────────────────────────
//  src/lib/tireSupplierBulkMerge.ts — pure two-axis dedup for CSV
//  supplier-price import.
//
//  Same shape + pattern as src/lib/inventoryBulkMerge.ts. When an
//  operator pastes a CSV of supplier prices, we need to:
//
//    1. Drop duplicates WITHIN the new batch (same supplier+brand+
//       model+size+condition appearing twice in the CSV — merge qty,
//       keep one row).
//    2. Drop duplicates AGAINST EXISTING records (the operator
//       uploaded a fresh price list that overlaps with what's
//       already in Firestore — bump qty / refresh cost / refresh
//       lastUpdated rather than create a parallel row).
//
//  Match key: normalize(supplierName) + normalize(tireSize) +
//             normalize(brand) + normalize(model) + condition.
//
//  Tire size normalization runs through extractTireSize so
//  "225/65R17", "225/65-17", "225 65 17" all collapse to the
//  canonical form. Supplier name + brand + model are
//  case-insensitive trimmed string compare.
//
//  Pure function — no React, no Firestore. Caller is responsible
//  for writing the returned `next` array to storage.
// ─────────────────────────────────────────────────────────────────────

/** Subset of TireSupplierPrice required to compute the match key.
 *  Lets callers pass parsed CSV rows that don't yet have
 *  `id`/`lastUpdated`/`createdBy` populated. */
export interface MergeableSupplierRow {
  supplierName: string;
  tireSize: string;
  brand: string;
  model: string;
  condition: 'new' | 'used';
  cost: number;
  quantityAvailable: number;
  category?: TireSupplierPrice['category'];
  treadDepth?: number;
  runFlat?: boolean;
  evRated?: boolean;
  xlLoad?: boolean;
  speedRating?: string;
  loadIndex?: string;
  notes?: string;
}

export interface BulkMergeResult {
  /** The new full inventory list after applying both dedup axes. */
  next: TireSupplierPrice[];
  /** Count of incoming rows that merged into an existing record. */
  mergedCount: number;
  /** Count of incoming rows that were added as new records. */
  addedCount: number;
  /** Count of incoming rows that collapsed within the batch
   *  before reaching the existing-list check. */
  collapsedCount: number;
}

/** Compute a stable lookup key from the identifying fields. */
function keyOf(row: { supplierName: string; tireSize: string; brand: string; model: string; condition: string }): string {
  const sup = row.supplierName.trim().toLowerCase();
  const sz = extractTireSize(row.tireSize) || row.tireSize.trim().toLowerCase();
  const br = row.brand.trim().toLowerCase();
  const mo = row.model.trim().toLowerCase();
  return `${sup}|${sz}|${br}|${mo}|${row.condition}`;
}

/**
 * Merge a batch of incoming supplier rows against an existing list.
 *
 * Strategy:
 *   1. Walk the existing list, build a Map<key, index>.
 *   2. Walk the incoming rows once to collapse same-batch dupes
 *      (sum quantities, keep first row's cost). This is the
 *      "operator pasted the same row twice" case.
 *   3. Walk the collapsed batch and either UPDATE the matching
 *      existing row (bump qty, refresh cost/notes/lastUpdated) or
 *      ADD a new row.
 *
 * @param existing  Current list from Firestore (or [] for empty)
 * @param incoming  Parsed CSV rows
 * @param freshId   ID generator for new rows (caller passes uid())
 * @param now       ISO timestamp for lastUpdated (caller passes new Date().toISOString())
 * @param createdBy uid of the operator doing the import
 */
export function mergeSupplierBulkRows(
  existing: ReadonlyArray<TireSupplierPrice>,
  incoming: ReadonlyArray<MergeableSupplierRow>,
  freshId: () => string,
  now: string,
  createdBy: string,
): BulkMergeResult {
  // Step 1: build existing-key index.
  const existingByKey = new Map<string, number>();
  for (let i = 0; i < existing.length; i++) {
    existingByKey.set(keyOf(existing[i]), i);
  }

  // Step 2: collapse same-batch duplicates.
  const collapsedByKey = new Map<string, MergeableSupplierRow>();
  let collapsedCount = 0;
  for (const row of incoming) {
    const k = keyOf(row);
    const prior = collapsedByKey.get(k);
    if (prior) {
      // Same-batch dupe: sum qty, keep first row's other fields.
      prior.quantityAvailable += row.quantityAvailable;
      collapsedCount++;
    } else {
      // Clone so we don't mutate the caller's array.
      collapsedByKey.set(k, { ...row });
    }
  }

  // Step 3: cross-batch merge against existing.
  const next: TireSupplierPrice[] = [...existing];
  let mergedCount = 0;
  let addedCount = 0;

  for (const [k, row] of collapsedByKey) {
    const existingIdx = existingByKey.get(k);
    if (existingIdx !== undefined) {
      // Update in place: bump qty, refresh cost + lastUpdated + optional fields.
      const prev = next[existingIdx];
      next[existingIdx] = {
        ...prev,
        cost: row.cost > 0 ? row.cost : prev.cost,
        quantityAvailable: Number(prev.quantityAvailable || 0) + row.quantityAvailable,
        category: row.category ?? prev.category,
        treadDepth: row.treadDepth ?? prev.treadDepth,
        runFlat: row.runFlat ?? prev.runFlat,
        evRated: row.evRated ?? prev.evRated,
        xlLoad: row.xlLoad ?? prev.xlLoad,
        speedRating: row.speedRating ?? prev.speedRating,
        loadIndex: row.loadIndex ?? prev.loadIndex,
        notes: row.notes ?? prev.notes,
        lastUpdated: now,
      };
      mergedCount++;
    } else {
      // Add fresh row.
      const tireSize = extractTireSize(row.tireSize) || row.tireSize.trim();
      next.push({
        id: freshId(),
        supplierName: row.supplierName.trim(),
        tireSize,
        brand: row.brand.trim(),
        model: row.model.trim(),
        cost: row.cost,
        quantityAvailable: row.quantityAvailable,
        condition: row.condition,
        category: row.category ?? 'midrange',
        runFlat: row.runFlat ?? false,
        evRated: row.evRated ?? false,
        xlLoad: row.xlLoad ?? false,
        treadDepth: row.treadDepth,
        speedRating: row.speedRating,
        loadIndex: row.loadIndex,
        notes: row.notes,
        lastUpdated: now,
        createdBy,
      });
      addedCount++;
    }
  }

  return { next, mergedCount, addedCount, collapsedCount };
}
