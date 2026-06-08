// src/lib/inventoryIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Deterministic inventory intelligence — pure, on-device, no AI.
//
//  Turns the stock list + a 30-day sold-velocity map into the three
//  operationally-actionable lists a tire shop runs on:
//    • reorderNow  — in demand (sold in 30d) AND low/out of stock
//    • fastMovers  — highest 30-day sold velocity
//    • deadStock   — in stock but NOT moving, ranked by tied-up cash
//  Plus the headline numbers (reorder count, total dead-stock value).
//
//  No revenue/profit-by-size here: tire items carry a cost basis but no
//  sell price, so a true "most profitable size" can't be computed
//  honestly from stock alone — velocity is the proxy that is.
// ═══════════════════════════════════════════════════════════════════

import { normalizeTireSize } from '@/lib/utils';

export interface IntelItem {
  id: string;
  size: string;
  qty: number;
  reorderPoint: number;
  velocity: number;     // units sold in the last 30 days
  tiedValue: number;    // qty × unit cost — cash sitting on the shelf
}

export interface InventoryIntel {
  reorderNow: IntelItem[];
  fastMovers: IntelItem[];
  deadStock: IntelItem[];
  reorderCount: number;
  deadStockValue: number;
  deadStockCount: number;
}

interface RawItem {
  id: string;
  size?: string;
  qty?: number;
  cost?: number;
  reorderPoint?: number;
}

const TOP = 5;

/**
 * Build the inventory intelligence lists. `velocityBySize` is the
 * 30-day units-sold map keyed by normalized tire size (already computed
 * by the Inventory page). Pure — same inputs, same output.
 */
export function computeInventoryIntel(
  items: RawItem[],
  velocityBySize: Map<string, number>,
): InventoryIntel {
  const enriched: IntelItem[] = items
    .filter((i) => (i.size ?? '').trim() !== '')
    .map((i) => {
      const size = String(i.size);
      const n = normalizeTireSize(size);
      const qty = Number(i.qty) || 0;
      const cost = Number(i.cost) || 0;
      return {
        id: i.id,
        size,
        qty,
        reorderPoint: Number(i.reorderPoint ?? 1),
        velocity: (n && velocityBySize.get(n)) || 0,
        tiedValue: qty * cost,
      };
    });

  // In demand AND low/out → reorder. Most-sold first.
  const reorder = enriched
    .filter((i) => i.velocity > 0 && i.qty <= i.reorderPoint)
    .sort((a, b) => b.velocity - a.velocity);

  const fast = enriched
    .filter((i) => i.velocity > 0)
    .sort((a, b) => b.velocity - a.velocity);

  // In stock but not moving → dead. Biggest cash drain first.
  const dead = enriched
    .filter((i) => i.qty > 0 && i.velocity === 0)
    .sort((a, b) => b.tiedValue - a.tiedValue);

  return {
    reorderNow: reorder.slice(0, TOP),
    fastMovers: fast.slice(0, TOP),
    deadStock: dead.slice(0, TOP),
    reorderCount: reorder.length,
    deadStockValue: dead.reduce((s, i) => s + i.tiedValue, 0),
    deadStockCount: dead.length,
  };
}
