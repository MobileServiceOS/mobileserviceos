// src/config/businessTypes/pricing/laborParts.ts
// ═══════════════════════════════════════════════════════════════════
//  Labor+parts pricing engine — used by the mechanic vertical.
//
//  Inputs the form will collect (declared in MECHANIC_CONFIG.jobFields):
//   - laborHours      (number; optional)
//   - partsCost       (number; optional)
//   - revenue         (the customer-facing total entered by tech)
//   - miles           (travel — same as tire's travel calc)
//   - diagnosticFee   (optional override; default 0)
//
//  This engine treats `revenue` as the source of truth for what the
//  customer was charged (matching today's flat-engine semantics for
//  tire). The breakdown reverses the costs to show profit and what
//  each line cost the business:
//    directCost = laborCost + partsCost + partsMarkupAmount
//                 + diagnosticFee + travelCost
//    where laborCost          = laborHours * defaultLaborRate
//          partsMarkupAmount  = partsCost * defaultPartsMarkupPct / 100
//          diagnosticFee      = job.diagnosticFee || 0
//          travelCost         = same formula as flat engine
//
//  `belowMinServiceCharge` is exposed as a non-blocking signal so
//  the UI can render a warning when revenue is below the floor; the
//  engine does NOT auto-bump revenue, because the technician's
//  invoice is the source of truth.
//
//  All numbers rounded via r2 like the flat engine for determinism.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings, QuoteForm, QuoteResult } from '@/types';
import type { LaborPartsPricingModel } from '../types';
import { r2 } from '@/lib/utils';

export interface LaborPartsBreakdown {
  revenue: number;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  partsCost: number;
  partsMarkupPct: number;
  partsMarkupAmount: number;
  diagnosticFee: number;
  travelCost: number;
  travelMiles: number;
  travelChargeable: number;
  freeMilesIncluded: number;
  directCost: number;
  profit: number;
  profitMargin: number;
  quantity: number;
  /** True when revenue < model.defaultMinServiceCharge. UI signal only. */
  belowMinServiceCharge: boolean;
  /** The floor from the active model, exposed so UI can render it. */
  minServiceCharge: number;
}

// ─── Optional mechanic-specific Job fields ─────────────────────────
// Phase 2.1 hasn't extended the Job type with these yet; we read
// them via a widened cast so the engine compiles without a schema
// change. The Job type extension lands in Task C.3.
type MechanicJobShape = Job & {
  laborHours?: number | string;
  partsCost?: number | string;
  diagnosticFee?: number | string;
};

/**
 * Quote calculator for the labor+parts pricing model (mechanic).
 *
 * Mirrors the structure of calcFlatQuote so the AddJob "Suggested
 * price" preview behaves consistently across verticals, but uses
 * mechanic algebra:
 *
 *   laborCost      = laborHours * defaultLaborRate
 *   partsTotal     = partsCost * (1 + markupPct/100)
 *   diagFee        = explicit diagnosticFee OR (default fee when
 *                    job.service mentions diagnostic and no explicit
 *                    override)
 *   directCost     = laborCost + partsTotal + diagFee + travel
 *   targetProfit   = service.minProfit  (from settings.servicePricing
 *                                        if the operator edited it,
 *                                        else the mechanic config seed)
 *   suggested      = ceil((directCost + targetProfit) / 5) * 5
 *                    + surcharges
 *                    floored at MAX(service.basePrice,
 *                                   model.defaultMinServiceCharge)
 *   premium        = ceil(suggested * 1.25 / 5) * 5
 *
 * As the technician fills DynamicJobField inputs (Labor Hours, Parts
 * Cost) the suggested price updates live, so a mechanic sees a real
 * estimate before the customer asks "how much."
 */
export function calcLaborPartsQuote(
  form: QuoteForm,
  settings: Settings,
  model: LaborPartsPricingModel,
): QuoteResult {
  // Service-level pricing — read from settings if the operator edited
  // it, otherwise the mechanic config seed values flow through via
  // createBusiness so this lookup still resolves.
  const sp = settings.servicePricing || {};
  const sd = sp[form.service] || { basePrice: 120, minProfit: 60, enabled: true };

  const laborHours = Number(form.laborHours || 0);
  const partsCost = Number(form.partsCost || 0);
  const markupPct = Number(model.defaultPartsMarkupPct);
  const laborRate = Number(model.defaultLaborRate);

  const laborCost = laborHours * laborRate;
  const partsTotal = partsCost * (1 + markupPct / 100);

  // Auto-apply the default diagnostic fee when the service name hints
  // at a diagnostic-only visit and the operator hasn't overridden via
  // form.diagnosticFee. Keeps the suggested price honest for "Check
  // Engine Light Diagnosis" calls.
  const explicitDiag = Number(form.diagnosticFee || 0);
  const looksLikeDiag = /diagnostic|check engine/i.test(form.service || '');
  const diagFee = explicitDiag > 0
    ? explicitDiag
    : looksLikeDiag ? Number(model.defaultDiagnosticFee) : 0;

  const freeMiles = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, Number(form.miles || 0) - freeMiles);
  const travel = chargeable * Number(settings.costPerMile || 0.65);

  const dc = laborCost + partsTotal + diagFee + travel;
  const tp = Number(sd.minProfit || 0);

  let sug = Math.ceil((dc + tp) / 5) * 5;
  if (form.emergency) sug += 30;
  if (form.lateNight) sug += 25;
  if (form.highway) sug += 20;
  if (form.weekend) sug += 15;
  // Floor at MAX(service base price, model min service charge) so a
  // labor-light job (e.g. a quick fluid top-up) still respects the
  // mechanic's minimum trip charge.
  sug = Math.max(sug, Number(sd.basePrice || 0), Number(model.defaultMinServiceCharge || 0));

  return {
    suggested: sug,
    premium: Math.ceil((sug * 1.25) / 5) * 5,
    directCosts: r2(dc),
    targetProfit: tp,
  };
}

export function computeLaborPartsPrice(
  j: MechanicJobShape,
  s: Settings,
  model: LaborPartsPricingModel,
): LaborPartsBreakdown {
  const revenue = Number(j.revenue || 0);
  const laborHours = Number(j.laborHours || 0);
  const laborRate = Number(model.defaultLaborRate);
  const laborCost = r2(laborHours * laborRate);

  const partsCost = Number(j.partsCost || 0);
  const partsMarkupPct = Number(model.defaultPartsMarkupPct);
  const partsMarkupAmount = r2(partsCost * (partsMarkupPct / 100));

  const diagnosticFee = Number(j.diagnosticFee || 0);

  const miles = Number(j.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));

  const directCost = r2(
    laborCost + partsCost + partsMarkupAmount + diagnosticFee + travelCost,
  );
  const profit = r2(revenue - directCost);

  const minServiceCharge = Number(model.defaultMinServiceCharge);
  const belowMinServiceCharge = revenue > 0 && revenue < minServiceCharge;

  return {
    revenue: r2(revenue),
    laborHours,
    laborRate,
    laborCost,
    partsCost: r2(partsCost),
    partsMarkupPct,
    partsMarkupAmount,
    diagnosticFee: r2(diagnosticFee),
    travelCost,
    travelMiles: miles,
    travelChargeable: chargeable,
    freeMilesIncluded: freeMiles,
    directCost,
    profit,
    profitMargin: revenue > 0 ? profit / revenue : 0,
    quantity: Math.max(1, Math.floor(Number(j.qty) || 1)),
    minServiceCharge,
    belowMinServiceCharge,
  };
}
