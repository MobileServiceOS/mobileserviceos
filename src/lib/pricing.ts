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
  profitMargin: number;
  quantity: number;
}

export function computeBreakdown(
  j: Pick<Job, 'revenue' | 'tireCost' | 'materialCost' | 'miscCost' | 'miles' | 'qty'>,
  s: Settings
): PricingBreakdown {
  const revenue = Number(j.revenue || 0);
  // tireCost in the Job model is total cost across all tires (set at save
  // time from the inventory plan or the bought-for-this-job purchase price),
  // so we don't multiply by qty here.
  const tireCost = Number(j.tireCost || 0);
  const materialCost = Number(j.materialCost || j.miscCost || 0);
  const miles = Number(j.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
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
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
  };
}
