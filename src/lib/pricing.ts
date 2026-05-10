// Single source of truth for job pricing math. Every UI surface that displays
// revenue, cost, or profit must call into this module so the numbers shown to
// the user always match what gets persisted.

import type { Job, Settings } from '@/types';
import { r2 } from '@/lib/utils';

export interface PricingBreakdown {
  revenue: number;
  tireCost: number;
  materialCost: number;
  travelCost: number;
  travelMiles: number;
  travelChargeable: number;
  freeMilesIncluded: number;
  directCost: number;
  profit: number;
  profitMargin: number; // 0..1
}

/**
 * Compute the full pricing breakdown for a job-like form value.
 *
 * Travel cost = max(0, miles - freeMilesIncluded) * costPerMile
 * Direct cost = tireCost + materialCost + travelCost
 * Profit      = revenue - directCost
 *
 * Tire cost is ALWAYS included. When the job pulls from inventory, the caller
 * should pass the inventory-derived tire cost (saveJob does this in App.tsx).
 */
export function computeBreakdown(j: Pick<Job, 'revenue' | 'tireCost' | 'materialCost' | 'miscCost' | 'miles'>, s: Settings): PricingBreakdown {
  const revenue = Number(j.revenue || 0);
  const tireCost = Number(j.tireCost || 0);
  const materialCost = Number(j.materialCost || j.miscCost || 0);
  const miles = Number(j.miles || 0);
  const freeMiles = Number((s as Settings & { freeMilesIncluded?: number }).freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));
  const directCost = r2(tireCost + materialCost + travelCost);
  const profit = r2(revenue - directCost);
  return {
    revenue: r2(revenue),
    tireCost: r2(tireCost),
    materialCost: r2(materialCost),
    travelCost,
    travelMiles: miles,
    travelChargeable: chargeable,
    freeMilesIncluded: freeMiles,
    directCost,
    profit,
    profitMargin: revenue > 0 ? profit / revenue : 0,
  };
}
