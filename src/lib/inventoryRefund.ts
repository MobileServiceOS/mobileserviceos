import type { InventoryItem, Job } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  src/lib/inventoryRefund.ts — pure inventory refund math
//
//  Computes the new inventory state when a job's prior deductions are
//  refunded. Used by saveJob() in App.tsx when an edit transitions a
//  Completed/Pending job to Cancelled, and conceptually by deleteJob
//  for the same purpose.
//
//  Pure: no Firestore, no React, no side effects. The caller is
//  responsible for actually writing the new InventoryItem array to
//  storage. This module just answers "given these prior deductions
//  against this inventory, what's the post-refund inventory and how
//  many items were restored?"
//
//  Why extract: the live refund code in App.tsx mixes the math with
//  Firestore writes, toast UI, and state setters, which makes it
//  impossible to unit-test the math directly. Bugs in this math
//  manifest as inventory drift — operators oversell because the
//  numbers in their app don't match what's on the truck.
// ─────────────────────────────────────────────────────────────────────

/** Shape of a single deduction entry stored on a job. Mirrors the
 *  inventoryDeductions and partsInventoryDeductions arrays the
 *  saveJob path writes — we accept the minimal subset needed for
 *  refund math. */
export interface DeductionEntry {
  /** Inventory item id the deduction was taken against. */
  id: string;
  /** How many units were deducted. Number or numeric string (Job
   *  fields are typed as `number | string` in places — we coerce). */
  qty: number | string;
}

export interface RefundResult {
  /** New inventory list with refunded quantities applied. Item
   *  reference identity is preserved for non-affected rows so a
   *  React render layer can rely on shallow-compare optimizations. */
  inventory: InventoryItem[];
  /** Sum of all refunded qty across both deduction arrays. Used by
   *  the saveJob toast ("restored N items"). */
  totalRestored: number;
}

/**
 * Apply refund deductions to an inventory list. Every entry in
 * `deductions` adds its qty back onto the matching InventoryItem
 * (by id). Entries pointing at an item that no longer exists in
 * `inventory` are silently skipped — the most common cause is an
 * item that was deleted between the deduction and the refund.
 * Skipping is the safe default: we don't conjure a deleted SKU back
 * into existence.
 *
 * Both deduction arrays (tire + mechanic parts) get merged into
 * the same refund loop because the saveJob cancel path needs to
 * restore both atomically. Each array is optional; pass null/empty
 * for verticals that don't use it.
 *
 * @param inventory   Current InventoryItem array (typically
 *                    inventoryRef.current at the saveJob site).
 * @param tireDeds    Job's prior inventoryDeductions array, or null.
 * @param partsDeds   Job's prior partsInventoryDeductions array, or null.
 * @returns           New inventory + total qty restored.
 */
export function refundJobDeductions(
  inventory: ReadonlyArray<InventoryItem>,
  tireDeds: ReadonlyArray<DeductionEntry> | null | undefined,
  partsDeds: ReadonlyArray<DeductionEntry> | null | undefined,
): RefundResult {
  if ((!tireDeds || tireDeds.length === 0) && (!partsDeds || partsDeds.length === 0)) {
    return { inventory: [...inventory], totalRestored: 0 };
  }

  // Copy the array so we don't mutate the caller's reference.
  // Items themselves are spread when touched so untouched rows
  // keep their identity.
  const working: InventoryItem[] = [...inventory];
  let totalRestored = 0;

  const all: ReadonlyArray<DeductionEntry> = [
    ...(tireDeds ?? []),
    ...(partsDeds ?? []),
  ];

  for (const d of all) {
    const idx = working.findIndex((i) => i.id === d.id);
    if (idx < 0) continue; // item deleted; refund target gone
    const refundQty = Number(d.qty || 0);
    if (!Number.isFinite(refundQty) || refundQty <= 0) continue;
    const current = Number(working[idx].qty || 0);
    working[idx] = { ...working[idx], qty: current + refundQty };
    totalRestored += refundQty;
  }

  return { inventory: working, totalRestored };
}

/**
 * Convenience accessor: pull the deduction arrays out of a Job
 * doc with the same null-safety the saveJob caller uses. Returns
 * (tireDeds, partsDeds) — either may be null. Job's typed shape
 * allows undefined here so callers can't rely on `Array.isArray`
 * alone without the type guard this helper provides.
 */
export function extractJobDeductions(
  job: Job | null | undefined,
): {
  tireDeds: DeductionEntry[] | null;
  partsDeds: DeductionEntry[] | null;
} {
  if (!job) return { tireDeds: null, partsDeds: null };
  const t = (job as { inventoryDeductions?: unknown }).inventoryDeductions;
  const p = (job as { partsInventoryDeductions?: unknown }).partsInventoryDeductions;
  return {
    tireDeds: Array.isArray(t) ? (t as DeductionEntry[]) : null,
    partsDeds: Array.isArray(p) ? (p as DeductionEntry[]) : null,
  };
}
