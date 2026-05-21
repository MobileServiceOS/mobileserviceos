// src/config/businessTypes/pricing/index.ts
// ═══════════════════════════════════════════════════════════════════
//  Pricing dispatcher — picks the engine by PricingModel.kind.
//
//  Public callers should NOT import this directly; they call the
//  thin wrapper in src/lib/pricing.ts which resolves the active
//  business type via verticalContext and dispatches here.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings, QuoteForm, QuoteResult } from '@/types';
import type { PricingModel } from '../types';
import { computeFlatPrice, calcFlatQuote, type FlatBreakdown } from './flat';
import { computeLaborPartsPrice, calcLaborPartsQuote, type LaborPartsBreakdown } from './laborParts';
import { computePackageMultiplierPrice, calcPackageMultiplierQuote, type PackageMultBreakdown } from './packageMult';

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

/**
 * Quote dispatcher — same pattern as computePrice, for the live
 * "Suggested price" preview shown in AddJob and Dashboard's Quick
 * Quote. Tire uses the flat formula (byte-identical to pre-Phase-2.1);
 * mechanic uses the labor+parts formula; detailing uses the package-
 * multiplier stub (filled in 2.3).
 */
export function calcQuoteForModel(
  form: QuoteForm,
  settings: Settings,
  model: PricingModel,
): QuoteResult {
  switch (model.kind) {
    case 'flat':
      return calcFlatQuote(form, settings);
    case 'labor_parts':
      return calcLaborPartsQuote(form, settings, model);
    case 'package_multiplier':
      return calcPackageMultiplierQuote(form, settings, model);
  }
}

export type { FlatBreakdown, LaborPartsBreakdown, PackageMultBreakdown };
