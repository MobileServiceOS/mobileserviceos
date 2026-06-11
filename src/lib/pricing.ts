// src/lib/pricing.ts
// ═══════════════════════════════════════════════════════════════════
//  Pricing — thin compatibility wrapper that dispatches to the
//  active business type's engine.
//
//  Public surface: computeBreakdown(job, settings) returning a
//  PricingBreakdown identical to what this module exported before
//  Phase 2.1. Tire businesses hit the flat engine (same numbers as
//  before); mechanic businesses hit the labor+parts engine; detailing
//  businesses hit the package-multiplier stub.
//
//  Old export name preserved so every existing call site
//  (`computeBreakdown(j, s)`) keeps compiling and behaving identically
//  for tire.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { resolveVertical } from '@/lib/verticalContext';
import { computePrice, type PricingBreakdownTagged } from '@/config/businessTypes/pricing';

// Preserve the original PricingBreakdown shape (every existing caller
// reads only these fields). It happens to be the shape of FlatBreakdown.
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

/**
 * Compute the per-job pricing breakdown for the active business type.
 *
 * For tire (flat model) the return value is byte-for-byte identical
 * to the pre-Phase-2.1 implementation. For mechanic/detailing the
 * shape is normalized into the legacy PricingBreakdown so existing
 * UI surfaces (AddJob's tire-style breakdown card) continue to
 * render numerical totals without code changes — Phase 2.1's D.5
 * task will then rewire AddJob to use computeBreakdownTagged() for
 * a vertical-aware breakdown layout.
 *
 *   - tire: revenue, tireCost, materialCost, travelCost — all from
 *     flat engine, byte-identical to today.
 *   - mechanic: tireCost is always 0; materialCost is the aggregate
 *     non-travel cost (laborCost + partsCost + partsMarkupAmount
 *     + diagnosticFee) so the existing "Material cost" line in
 *     AddJob shows a meaningful number until D.5 splits it.
 *   - detailing: tireCost / materialCost / travelCost all 0
 *     (stub engine; Phase 2.3 fills it in).
 */
export function computeBreakdown(
  j: Job,
  s: Settings,
): PricingBreakdown {
  const config = resolveVertical(s);
  const tagged = computePrice(j, s, config.pricingModel);

  // Tire/roadside flat pricing is the only model.
  return {
    revenue: tagged.revenue,
    tireCost: tagged.tireCost,
    materialCost: tagged.materialCost,
    travelCost: tagged.travelCost,
    travelMiles: tagged.travelMiles,
    travelChargeable: tagged.travelChargeable,
    freeMilesIncluded: tagged.freeMilesIncluded,
    directCost: tagged.directCost,
    profit: tagged.profit,
    profitMargin: tagged.profitMargin,
    quantity: tagged.quantity,
  };
}

/**
 * Tagged-breakdown accessor for callers that need engine-specific
 * fields (laborCost, partsMarkupAmount, vehicleSizeMultiplier, etc).
 * Phase 2.1 task D.5 wires AddJob to this; until then,
 * computeBreakdown() above remains the back-compat shim for tire's
 * existing UI.
 */
export function computeBreakdownTagged(
  j: Job,
  s: Settings,
): PricingBreakdownTagged {
  const config = resolveVertical(s);
  return computePrice(j, s, config.pricingModel);
}

// ─── helpers ───────────────────────────────────────────────────────

import { r2 } from '@/lib/utils';

function r2sum(...nums: number[]): number {
  return r2(nums.reduce((s, n) => s + n, 0));
}
