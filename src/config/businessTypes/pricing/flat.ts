// src/config/businessTypes/pricing/flat.ts
// ═══════════════════════════════════════════════════════════════════
//  Flat-pricing engine — used by the tire vertical.
//
//  Computation is VERBATIM identical to today's
//  src/lib/pricing.ts::computeBreakdown. The dispatcher at
//  pricing/index.ts wraps the result with `model: 'flat'` for type
//  discrimination. Every existing call site that reads
//  `breakdown.revenue / profit / directCost / …` continues to work.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings, QuoteForm, QuoteResult } from '@/types';
import { r2 } from '@/lib/round';
import { DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING } from '@/lib/defaults';

export interface FlatBreakdown {
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

/**
 * Quote calculator for the flat pricing model (tire vertical).
 *
 * VERBATIM transplant of the pre-Phase-2.1 src/lib/utils.ts::calcQuote
 * body. Same formula, same rounding, same defaults — so tire's live
 * "Suggested price" preview in AddJob / Dashboard's Quick Quote
 * produces byte-identical numbers.
 *
 *   directCost = tireCost * qty + materialCost + travel
 *   targetProfit = service.minProfit + vehicle.addOnProfit
 *   suggested = ceil((dc + tp) / 5) * 5
 *              + surcharges (emergency 30 / lateNight 25 / highway 20 / weekend 15)
 *              floored at service.basePrice
 *   premium = ceil(suggested * 1.25 / 5) * 5
 */
export function calcFlatQuote(form: QuoteForm, settings: Settings): QuoteResult {
  const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
  const vp = settings.vehiclePricing || DEFAULT_VEHICLE_PRICING;
  const sd = sp[form.service] || { basePrice: 100, minProfit: 80, enabled: true };
  const vd = vp[form.vehicleType] || { addOnProfit: 0 };
  const tc = Number(form.tireCost || 0) * Number(form.qty || 1);
  const mc = Number(form.materialCost || form.miscCost || 0);
  const freeMiles = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, Number(form.miles || 0) - freeMiles);
  const travel = chargeable * Number(settings.costPerMile || 0.65);
  const dc = tc + mc + travel;
  const tp = Number(sd.minProfit || 0) + Number(vd.addOnProfit || 0);
  let sug = Math.ceil((dc + tp) / 5) * 5;
  if (form.emergency) sug += 30;
  if (form.lateNight) sug += 25;
  if (form.highway) sug += 20;
  if (form.weekend) sug += 15;
  sug = Math.max(sug, Number(sd.basePrice || 0));
  return {
    suggested: sug,
    premium: Math.ceil((sug * 1.25) / 5) * 5,
    directCosts: r2(dc),
    targetProfit: tp,
  };
}

export function computeFlatPrice(
  j: Pick<Job, 'revenue' | 'tireCost' | 'materialCost' | 'miscCost' | 'miles' | 'qty'>,
  s: Settings,
): FlatBreakdown {
  const revenue = Number(j.revenue || 0);
  const tireCostPerUnit = Number(j.tireCost || 0);
  const materialCost = Number(j.materialCost || j.miscCost || 0);
  const miles = Number(j.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));
  const qty = Math.max(1, Math.floor(Number(j.qty) || 1));
  // tireCost stored on the job is PER-UNIT. Direct cost must scale by qty
  // to match calcFlatQuote (flat.ts:50) — the suggested-price engine.
  // Pre-fix, multi-tire profit was overstated by tireCostPerUnit * (qty - 1).
  const tireCostTotal = r2(tireCostPerUnit * qty);
  const directCost = r2(tireCostTotal + materialCost + travelCost);
  const profit = r2(revenue - directCost);
  return {
    revenue: r2(revenue),
    tireCost: tireCostTotal,
    materialCost: r2(materialCost),
    travelCost,
    travelMiles: miles,
    travelChargeable: chargeable,
    freeMilesIncluded: freeMiles,
    directCost,
    profit,
    profitMargin: revenue > 0 ? profit / revenue : 0,
    quantity: qty,
  };
}
