// src/lib/bandilero/services/inventoryIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Inventory intelligence (DETERMINISTIC, no LLM).
//
//  Builds on the Phase 1 inventory service: which low/out-of-stock
//  items are still SELLING (recent demand) and worth reordering,
//  ranked by a demand × margin priority; plus dead-stock capital.
//  Inventory is a real collection → LIVE.
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, Job } from '@/types';
import { normalizeTireSize } from '@/lib/utils';
import { type Metric, live } from '../confidence';
import { deadStockValue } from './inventory';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Days a size's jobs count as "recent demand". */
const DEMAND_WINDOW_DAYS = 30;

function daysBetween(today: string, date: string): number {
  const a = new Date(today + 'T12:00:00').getTime();
  const b = new Date(date + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

/** Map of normalized tire size → recent completed-job demand count. */
export function recentDemandBySize(jobs: ReadonlyArray<Job>, today: string, windowDays = DEMAND_WINDOW_DAYS): Map<string, number> {
  const m = new Map<string, number>();
  for (const j of jobs || []) {
    if (j.status !== 'Completed' || !j.date) continue;
    if (daysBetween(today, j.date) > windowDays) continue;
    const size = normalizeTireSize(j.tireSize || '');
    if (!size) continue;
    m.set(size, (m.get(size) || 0) + Math.max(1, Math.floor(Number(j.qty) || 1)));
  }
  return m;
}

export interface ReorderSuggestion {
  item: InventoryItem;
  /** Recent demand (units sold of this size in the window). */
  demand: number;
  /** Per-unit margin (retailPrice − unit cost); 0 when unknown. */
  unitMargin: number;
  /** Heuristic restock priority = demand × max(1, unitMargin). */
  priority: number;
}

/**
 * Items at/below reorder point (or out of stock) whose SIZE still has
 * recent demand — i.e. worth restocking, not dead stock. Sorted by
 * priority desc.
 */
export function reorderSuggestions(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
  windowDays = DEMAND_WINDOW_DAYS,
): ReorderSuggestion[] {
  const demandBySize = recentDemandBySize(jobs, today, windowDays);
  const out: ReorderSuggestion[] = [];
  for (const item of items || []) {
    const qty = Number(item.qty || 0);
    const reorder = Number(item.reorderPoint ?? 1);
    const atOrBelow = qty <= reorder;
    if (!atOrBelow) continue;
    const size = normalizeTireSize(item.size || '');
    const demand = size ? (demandBySize.get(size) || 0) : 0;
    if (demand <= 0) continue; // no recent demand → not a reorder priority (that's dead/idle stock)
    const unitMargin = round2(Number(item.retailPrice ?? 0) - Number(item.unitCost ?? item.cost ?? 0));
    out.push({ item, demand, unitMargin, priority: round2(demand * Math.max(1, unitMargin)) });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

export interface InventoryIntel {
  reorderCount: Metric<number>;
  deadValue: Metric<number>;
  reorderList: ReorderSuggestion[];
  /** Best-selling size in the window, or null when there's no demand. */
  topSellerSize: string | null;
}

export function inventoryIntel(
  items: ReadonlyArray<InventoryItem>,
  jobs: ReadonlyArray<Job>,
  today: string,
): InventoryIntel {
  const reorderList = reorderSuggestions(items, jobs, today);
  const demandBySize = recentDemandBySize(jobs, today);
  // First-seen user-facing label per normalized size, so topSellerSize
  // displays "225/65R17", not the normalized "22565R17".
  const rawLabel = new Map<string, string>();
  for (const j of jobs || []) {
    if (j.status !== 'Completed' || !j.tireSize) continue;
    const n = normalizeTireSize(j.tireSize);
    if (n && !rawLabel.has(n)) rawLabel.set(n, j.tireSize);
  }
  let topNorm: string | null = null;
  let topDemand = 0;
  for (const [size, d] of demandBySize) {
    if (d > topDemand) { topDemand = d; topNorm = size; }
  }
  const topSellerSize = topNorm ? (rawLabel.get(topNorm) ?? topNorm) : null;
  return {
    reorderCount: live(reorderList.length, 'inventory', today),
    deadValue: live(deadStockValue(items, jobs, today), 'inventory', today),
    reorderList,
    topSellerSize,
  };
}
