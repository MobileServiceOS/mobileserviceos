// src/lib/mechanicJob.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers for the mechanic parts + inventory workflow.
//  See docs/superpowers/specs/2026-05-21-mechanic-operations-design.md
//  Every function in this file is pure: no I/O, no globals, no React.
// ═══════════════════════════════════════════════════════════════════

import type {
  Job,
  JobPartLine,
  InventoryItem,
  InventoryDeduction,
  PartsMarginSnapshot,
} from '@/types';
import { r2 } from '@/lib/round';

// ─────────────────────────────────────────────────────────────────
//  Derivation: parts → legacy partsCost mirror
// ─────────────────────────────────────────────────────────────────

export function deriveLegacyPartsCost(parts: ReadonlyArray<JobPartLine>): number {
  return r2(
    parts.reduce(
      (s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0),
      0,
    ),
  );
}

// ─────────────────────────────────────────────────────────────────
//  Derivation: parts → margin snapshot
//  Only when every line has unitCost > 0 — a single zero invalidates
//  the snapshot for the whole job (misleading number is worse than
//  no number).
// ─────────────────────────────────────────────────────────────────

export function derivePartsMarginSnapshot(
  parts: ReadonlyArray<JobPartLine>,
): PartsMarginSnapshot | undefined {
  if (parts.length === 0) return undefined;
  for (const l of parts) {
    const uc = Number(l.unitCost);
    if (!Number.isFinite(uc) || uc <= 0) return undefined;
  }
  const revenue = r2(
    parts.reduce(
      (s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0),
      0,
    ),
  );
  const costBasis = r2(
    parts.reduce(
      (s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0),
      0,
    ),
  );
  return { revenue, costBasis, margin: r2(revenue - costBasis) };
}

// ─────────────────────────────────────────────────────────────────
//  Inventory deduction diff (edit-job semantics)
// ─────────────────────────────────────────────────────────────────

/**
 * Compares the new parts list against the previously-saved parts list.
 * Returns a per-inventory-item-id signed delta — applied via
 * FieldValue.increment(delta) at the call site. Negative = additional
 * deduction; positive = refund into inventory. Lines whose source is
 * not 'inventory' contribute nothing.
 */
export function diffPartsForDeduction(
  oldParts: ReadonlyArray<JobPartLine> | undefined,
  newParts: ReadonlyArray<JobPartLine>,
): Record<string, number> {
  const oldByItem: Record<string, number> = {};
  for (const l of oldParts ?? []) {
    if (l.source === 'inventory' && l.inventoryItemId) {
      oldByItem[l.inventoryItemId] =
        (oldByItem[l.inventoryItemId] || 0) + Number(l.qty || 0);
    }
  }
  const newByItem: Record<string, number> = {};
  for (const l of newParts) {
    if (l.source === 'inventory' && l.inventoryItemId) {
      newByItem[l.inventoryItemId] =
        (newByItem[l.inventoryItemId] || 0) + Number(l.qty || 0);
    }
  }
  const out: Record<string, number> = {};
  const allIds = new Set([
    ...Object.keys(oldByItem),
    ...Object.keys(newByItem),
  ]);
  for (const id of allIds) {
    const oldQty = oldByItem[id] || 0;
    const newQty = newByItem[id] || 0;
    const d = newQty - oldQty;
    // delta in our convention: negative = deduct, positive = refund.
    // newQty > oldQty means we're deducting more, so output -d.
    if (d !== 0) out[id] = -d;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
//  partsInventoryDeductions[] snapshot builder
// ─────────────────────────────────────────────────────────────────

/** Build the `partsInventoryDeductions[]` snapshot from the current
 *  parts list. Reuses the existing tire-shape `InventoryDeduction`
 *  type — mechanic sets `size = ''` and `cost = unitCost`. */
export function buildPartsInventoryDeductions(
  parts: ReadonlyArray<JobPartLine>,
): InventoryDeduction[] {
  const out: InventoryDeduction[] = [];
  for (const l of parts) {
    if (l.source === 'inventory' && l.inventoryItemId) {
      out.push({
        id: l.inventoryItemId,
        size: '',
        qty: Number(l.qty || 0),
        cost: Number(l.unitCost || 0),
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
//  Rollback (delete / cancel a mechanic job)
// ─────────────────────────────────────────────────────────────────

/** For a deleted or cancelled job, returns the per-item refund map
 *  (positive numbers = qty to add back to inventory). Aggregates
 *  duplicate ids within the deductions array. */
export function rollbackPartsDeductions(
  job: Pick<Job, 'partsInventoryDeductions'>,
): Record<string, number> {
  const refund: Record<string, number> = {};
  for (const d of job.partsInventoryDeductions ?? []) {
    if (!d || !d.id) continue;
    refund[d.id] = (refund[d.id] || 0) + Number(d.qty || 0);
  }
  return refund;
}

// ─────────────────────────────────────────────────────────────────
//  Soft warning at save-time
// ─────────────────────────────────────────────────────────────────

/** Returns true when the line's inventory deduction would push the
 *  on-hand qty below zero, accounting for the previously-saved qty
 *  of the same line on this job (edit case). The save flow surfaces
 *  a confirmation dialog only when this is true. Non-inventory
 *  sources never warn. */
export function shouldWarnOnDeduction(
  line: JobPartLine,
  inventory: ReadonlyArray<InventoryItem>,
  oldLineQty: number = 0,
): boolean {
  if (line.source !== 'inventory' || !line.inventoryItemId) return false;
  const item = inventory.find((i) => i.id === line.inventoryItemId);
  if (!item) return false;
  const onHand = Number(item.qty || 0);
  const incrementalQty = Number(line.qty || 0) - oldLineQty;
  return incrementalQty > onHand;
}
