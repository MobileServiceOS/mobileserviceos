// src/lib/planJobInventory.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure inventory plan for a tire job save. Extracted verbatim from the
//  Inventory branch of App.tsx::saveJob so the deduction logic — the
//  riskiest, correctness-critical part of the god-function — is testable
//  in isolation. saveJob keeps ONLY the I/O (fbSetFast writes,
//  setInventoryRaw, toasts) and feeds the result here.
//
//  Steps (order matters):
//    1. Restore the job's PREVIOUS deductions onto a working copy. On an
//       edit this returns the about-to-be-replaced stock before we plan
//       the new deduction, so re-saving the same job is idempotent.
//    2. Plan the new deduction (FIFO by cost) against the restored copy.
//    3. Apply it, recording which item ids were touched (the ones saveJob
//       must persist) and any whose target id vanished from the snapshot
//       (a defensive guard — unreachable while plan + apply share one
//       array, kept for parity with the original).
//
//  The returned tireCost is the TOTAL (weighted FIFO), via the shared
//  computeJobTireCost. Pure — no Firestore, no React.
// ═══════════════════════════════════════════════════════════════════

import { planInventoryDeduction } from '@/lib/utils';
import { computeJobTireCost } from '@/lib/jobTireCost';
import type { InventoryItem, InventoryDeduction } from '@/types';

export interface JobInventoryPlan {
  /** Deductions to stamp onto the job doc. */
  deductions: InventoryDeduction[];
  /** The working inventory after restore + deduct — feed to local state. */
  nextInventory: InventoryItem[];
  /** Item ids whose qty changed and must be written to Firestore. */
  touchedIds: string[];
  /** Planned deductions whose item id was absent from the snapshot. */
  skipped: InventoryDeduction[];
  /** Units that couldn't be sourced from stock. */
  shortfall: number;
  /** Resolved TOTAL tire cost for the job. */
  tireCost: number;
}

export function planJobInventory(args: {
  tireSize: string;
  qty: number | string;
  inventory: InventoryItem[];
  /** The previous job's tire deductions, to restore first (edit). */
  prevDeductions?: InventoryDeduction[] | null;
  /** The job's existing tireCost — kept when nothing is deductible. */
  fallbackTireCost?: number | string;
}): JobInventoryPlan {
  const working = args.inventory.map((i) => ({ ...i }));

  // 1. Restore previous deductions (no-op on a fresh job).
  if (args.prevDeductions) {
    for (const d of args.prevDeductions) {
      const idx = working.findIndex((i) => i.id === d.id);
      if (idx >= 0) {
        working[idx] = { ...working[idx], qty: Number(working[idx].qty || 0) + Number(d.qty || 0) };
      }
    }
  }

  // 2. Plan against the restored snapshot.
  const plan = planInventoryDeduction(args.tireSize, Number(args.qty || 1), working);

  // 3. Apply, recording touched + (defensively) skipped.
  const touchedIds: string[] = [];
  const skipped: InventoryDeduction[] = [];
  for (const d of plan.deductions) {
    const idx = working.findIndex((i) => i.id === d.id);
    if (idx < 0) { skipped.push(d); continue; }
    working[idx] = { ...working[idx], qty: Math.max(0, Number(working[idx].qty || 0) - Number(d.qty || 0)) };
    touchedIds.push(working[idx].id);
  }

  const planTotal = plan.deductions.reduce((s, d) => s + d.cost * d.qty, 0);
  const tireCost = computeJobTireCost({
    tireSource: 'Inventory', fifoPlanTotal: planTotal, fallbackTireCost: args.fallbackTireCost,
  });

  return { deductions: plan.deductions, nextInventory: working, touchedIds, skipped, shortfall: plan.shortfall, tireCost };
}
