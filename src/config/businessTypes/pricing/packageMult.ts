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

import type { Job, Settings } from '@/types';
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
