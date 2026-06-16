// src/lib/inventoryRestock.ts
// ───────────────────────────────────────────────────────────────────
//  Pure helper for the "reorder action" — recording restocked stock for
//  a size from the Inventory focus banner. The app records inventory, it
//  doesn't place purchase orders, so "reorder" means: add the received
//  quantity to that size's stock.
//
//  Adds to the FIRST existing entry of the size (consolidation keeps it to
//  one row per size). If the size has no entry yet — e.g. it sold
//  historically but was never stocked, like an out-of-stock reorder
//  candidate — a new entry is created so the restock is still recorded.
//  Pure: returns a new list, never mutates the input.
// ───────────────────────────────────────────────────────────────────

import type { InventoryItem } from '@/types';
import { sizeKey } from '@/lib/inventoryIntel';
import { uid } from '@/lib/utils';

export function addStockForSize(
  list: ReadonlyArray<InventoryItem>,
  size: string,
  addQty: number,
): InventoryItem[] {
  const key = sizeKey(size || '');
  const add = Math.max(0, Math.floor(Number(addQty) || 0));
  if (!key || add <= 0) return list.slice();

  const idx = list.findIndex((i) => sizeKey(i.size || '') === key);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = { ...next[idx], qty: (Number(next[idx].qty) || 0) + add };
    return next;
  }

  // No entry for this size yet → create one so the restock is recorded.
  return [
    { id: uid(), size: (size || '').trim(), qty: add, cost: 0, condition: 'New', reorderPoint: 1 },
    ...list,
  ];
}
