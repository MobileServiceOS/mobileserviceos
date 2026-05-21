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

import type { Job, Settings } from '@/types';
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
