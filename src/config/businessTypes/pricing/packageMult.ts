// src/config/businessTypes/pricing/packageMult.ts
// ═══════════════════════════════════════════════════════════════════
//  Package-multiplier pricing engine — STUB for Phase 2.1.
//
//  Filled in by Phase 2.3 (Detailing full slice). For now the
//  engine returns a trivial breakdown so the dispatcher's switch
//  remains exhaustive. The detailing vertical has no UI consumers
//  in 2.1, so this stub is never actually called at runtime.
//
//  Phase 2.3 will expand this to handle:
//    - base package price * vehicleSizeMultiplier
//    - add-on flat-price line items
//    - recurring-membership discount layer
//    - travel fee (same shape as flat/labor_parts)
//    - minimum service floor (mirroring labor_parts shape)
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings, QuoteForm, QuoteResult } from '@/types';
import type { PackageMultiplierPricingModel } from '../types';
import { r2 } from '@/lib/utils';

export interface PackageMultBreakdown {
  revenue: number;
  vehicleSize: string;
  vehicleSizeMultiplier: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
}

type DetailingJobShape = Job & { vehicleSize?: string };

/**
 * Quote calculator for the package-multiplier pricing model
 * (detailing). STUB for Phase 2.1. Real package selection + add-on
 * roll-up + recurring-membership discount logic lands in Phase 2.3.
 *
 * For now: suggested = vehicleSize multiplier * service.basePrice,
 * floored at service.basePrice. No surcharges, no travel
 * (the detailing engine handles its own travel formulas in 2.3).
 */
export function calcPackageMultiplierQuote(
  form: QuoteForm,
  settings: Settings,
  model: PackageMultiplierPricingModel,
): QuoteResult {
  const sp = settings.servicePricing || {};
  const sd = sp[form.service] || { basePrice: 100, minProfit: 50, enabled: true };
  const vehicleSize = form.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;
  const sug = Math.max(Number(sd.basePrice || 0) * multiplier, Number(sd.basePrice || 0));
  return {
    suggested: Math.ceil(sug / 5) * 5,
    premium: Math.ceil((sug * 1.25) / 5) * 5,
    directCosts: 0,
    targetProfit: Number(sd.minProfit || 0),
  };
}

export function computePackageMultiplierPrice(
  j: DetailingJobShape,
  _s: Settings,
  model: PackageMultiplierPricingModel,
): PackageMultBreakdown {
  const revenue = Number(j.revenue || 0);
  const vehicleSize = j.vehicleSize || 'Sedan';
  const multiplier = model.vehicleSizeMultipliers[vehicleSize] ?? 1;
  return {
    revenue: r2(revenue),
    vehicleSize,
    vehicleSizeMultiplier: multiplier,
    directCost: 0,
    profit: r2(revenue),
    profitMargin: revenue > 0 ? 1 : 0,
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
  };
}
