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

// Only the flat (tire/roadside) pricing model remains. The labor_parts
// and package_multiplier engines were removed with mechanic/detailing.
export type PricingBreakdownTagged = FlatBreakdown & { model: 'flat' };

export function computePrice(
  job: Job,
  settings: Settings,
  _model: PricingModel,
): PricingBreakdownTagged {
  return { ...computeFlatPrice(job, settings), model: 'flat' };
}

/**
 * Quote dispatcher for the live "Suggested price" preview in AddJob and
 * Dashboard's Quick Quote. Flat (tire) formula only.
 */
export function calcQuoteForModel(
  form: QuoteForm,
  settings: Settings,
  _model: PricingModel,
): QuoteResult {
  return calcFlatQuote(form, settings);
}

export type { FlatBreakdown };
