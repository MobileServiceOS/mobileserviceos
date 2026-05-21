// src/config/businessTypes/pricing/index.ts
// ═══════════════════════════════════════════════════════════════════
//  Pricing dispatcher — picks the engine by PricingModel.kind.
//
//  Public callers should NOT import this directly; they call the
//  thin wrapper in src/lib/pricing.ts which resolves the active
//  business type via verticalContext and dispatches here.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import type { PricingModel } from '../types';
import { computeFlatPrice, type FlatBreakdown } from './flat';
import { computeLaborPartsPrice, type LaborPartsBreakdown } from './laborParts';
import { computePackageMultiplierPrice, type PackageMultBreakdown } from './packageMult';

export type PricingBreakdownTagged =
  | (FlatBreakdown & { model: 'flat' })
  | (LaborPartsBreakdown & { model: 'labor_parts' })
  | (PackageMultBreakdown & { model: 'package_multiplier' });

export function computePrice(
  job: Job,
  settings: Settings,
  model: PricingModel,
): PricingBreakdownTagged {
  switch (model.kind) {
    case 'flat':
      return { ...computeFlatPrice(job, settings), model: 'flat' };
    case 'labor_parts':
      return { ...computeLaborPartsPrice(job, settings, model), model: 'labor_parts' };
    case 'package_multiplier':
      return { ...computePackageMultiplierPrice(job, settings, model), model: 'package_multiplier' };
  }
}

export type { FlatBreakdown, LaborPartsBreakdown, PackageMultBreakdown };
