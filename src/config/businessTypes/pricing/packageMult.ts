// src/config/businessTypes/pricing/packageMult.ts
// ═══════════════════════════════════════════════════════════════════
//  Package-multiplier pricing engine — used by the detailing vertical
//  (Phase 2.3 full slice).
//
//   packageCost      = settings.servicePricing[job.service].basePrice
//                      × vehicleSizeMultiplier[job.vehicleSize]
//   addOnsCost       = Σ basePrice for id in job.detailingAddons
//                      (flat-priced, NO multiplier applied)
//   travelCost       = chargeable miles × costPerMile
//   directCost       = packageCost + addOnsCost + travelCost
//   targetProfit     = service.minProfit
//   suggested        = ceil((directCost + targetProfit) / 5) × 5
//                      floored at model.defaultMinServiceCharge
//   premium          = ceil(suggested × 1.25 / 5) × 5
//
//  All numbers rounded via r2 for determinism, matching the flat and
//  labor_parts engines.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings, QuoteForm, QuoteResult } from '@/types';
import type { PackageMultiplierPricingModel } from '../types';
import { r2 } from '@/lib/round';

export interface PackageMultBreakdown {
  revenue: number;
  vehicleSize: string;
  vehicleSizeMultiplier: number;
  packageCost: number;
  addOnsCost: number;
  addOnIds: ReadonlyArray<string>;
  /** Per-add-on prices, parallel to `addOnIds`. Used by the invoice
   *  template to emit one line per add-on without re-reading
   *  settings.servicePricing at render time. */
  addOnPrices: ReadonlyArray<number>;
  travelCost: number;
  travelMiles: number;
  travelChargeable: number;
  freeMilesIncluded: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
  belowMinServiceCharge: boolean;
  minServiceCharge: number;
}

type DetailingJobShape = Job & {
  vehicleSize?: string;
  detailingAddons?: ReadonlyArray<string>;
};

export function computePackageMultiplierPrice(
  j: DetailingJobShape,
  s: Settings,
  model: PackageMultiplierPricingModel,
): PackageMultBreakdown {
  const revenue = Number(j.revenue || 0);
  const vehicleSize = j.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;

  const sp = s.servicePricing || {};
  const packageBase = Number(sp[j.service]?.basePrice ?? 0);
  const packageCost = r2(packageBase * multiplier);

  const addOnIds = j.detailingAddons ?? [];
  const addOnPrices: number[] = [];
  let addOnsAccumulator = 0;
  for (const id of addOnIds) {
    const price = Number(sp[id]?.basePrice ?? 0);
    addOnPrices.push(price);
    addOnsAccumulator += price;
  }
  const addOnsCost = r2(addOnsAccumulator);

  const miles = Number(j.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));

  const directCost = r2(packageCost + addOnsCost + travelCost);
  const profit = r2(revenue - directCost);

  const minServiceCharge = Number(model.defaultMinServiceCharge ?? 40);
  const belowMinServiceCharge = revenue > 0 && revenue < minServiceCharge;

  return {
    revenue: r2(revenue),
    vehicleSize,
    vehicleSizeMultiplier: multiplier,
    packageCost,
    addOnsCost,
    addOnIds,
    addOnPrices,
    travelCost,
    travelMiles: miles,
    travelChargeable: chargeable,
    freeMilesIncluded: freeMiles,
    directCost,
    profit,
    profitMargin: revenue > 0 ? profit / revenue : 0,
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
    belowMinServiceCharge,
    minServiceCharge,
  };
}

export function calcPackageMultiplierQuote(
  form: QuoteForm,
  settings: Settings,
  model: PackageMultiplierPricingModel,
): QuoteResult {
  const sp = settings.servicePricing || {};
  const sd = sp[form.service] || { basePrice: 100, minProfit: 50, enabled: true };
  const vehicleSize = form.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;

  const packageCost = Number(sd.basePrice ?? 0) * multiplier;

  const addOnIds = form.detailingAddons ?? [];
  let addOnsCost = 0;
  for (const id of addOnIds) {
    addOnsCost += Number(sp[id]?.basePrice ?? 0);
  }

  const miles = Number(form.miles || 0);
  const freeMiles = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = chargeable * Number(settings.costPerMile || 0.65);

  const directCost = packageCost + addOnsCost + travelCost;
  const targetProfit = Number(sd.minProfit || 0);
  const minServiceCharge = Number(model.defaultMinServiceCharge ?? 40);

  const raw = Math.max(directCost + targetProfit, minServiceCharge);
  const suggested = Math.ceil(raw / 5) * 5;
  const premium = Math.ceil((suggested * 1.25) / 5) * 5;

  return {
    suggested,
    premium,
    directCosts: r2(directCost),
    targetProfit,
  };
}
