// src/lib/bandilero/services/inventory.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Inventory service (DETERMINISTIC, no LLM).
//
//  Inventory is a real Firestore collection, so these are LIVE — even a
//  zero count is a true fact (not a fake substitution). Reuses the
//  existing inventoryHealthCounts / categorizeInventoryHealth buckets so
//  Bandilero matches the Inventory page.
//
//  Low stock matches the Inventory page's inline rule:
//    low = qty > 0 && qty <= (item.reorderPoint ?? 1)
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, Job } from '@/types';
import {
  inventoryHealthCounts,
  categorizeInventoryHealth,
  type InventoryHealthBucket,
} from '@/lib/inventoryHealth';
import { type Metric, live } from '../confidence';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Items at or below their reorder point but not yet out of stock. */
export function lowStockItems(items: ReadonlyArray<InventoryItem>): InventoryItem[] {
  return (items || []).filter((i) => {
    const qty = Number(i.qty || 0);
    const reorder = Number(i.reorderPoint ?? 1);
    return qty > 0 && qty <= reorder;
  });
}

/** Out-of-stock items (qty === 0). */
export function outOfStockItems(items: ReadonlyArray<InventoryItem>): InventoryItem[] {
  return (items || []).filter((i) => Number(i.qty || 0) === 0);
}

/** Capital tied up in dead stock = Σ(qty × cost) over 'dead' items. LIVE. */
export function deadStockValue(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
): number {
  let total = 0;
  for (const item of items || []) {
    const bucket: InventoryHealthBucket = categorizeInventoryHealth(item, jobs, today);
    if (bucket === 'dead') total += Number(item.qty || 0) * Number(item.cost || 0);
  }
  return round2(total);
}

export interface InventoryAlertMetrics {
  critical: Metric<number>;
  low: Metric<number>;
  dead: Metric<number>;
  /** Dollar value of capital tied up in dead stock. */
  deadValue: Metric<number>;
}

/** Health-bucket counts + dead-stock value, all LIVE (real collection). */
export function inventoryAlertMetrics(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
): InventoryAlertMetrics {
  const counts = inventoryHealthCounts(items, jobs, today);
  return {
    critical: live(counts.critical, 'inventory', today),
    low: live(counts.low, 'inventory', today),
    dead: live(counts.dead, 'inventory', today),
    deadValue: live(deadStockValue(items, jobs, today), 'inventory', today),
  };
}
