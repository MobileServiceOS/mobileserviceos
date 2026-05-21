// src/config/businessTypes/invoice/mechanic.ts
// ═══════════════════════════════════════════════════════════════════
//  Mechanic invoice template.
//
//   - Service-name map is mechanic-friendly ("diagnostic" -> "Vehicle
//     Diagnostic Service", "brake" -> "Brake System Service", etc.)
//
//   - servicePerformedFields show vehicle make/model and mileage,
//     plus the diagnostic code when present.
//
//   - buildLineItems produces a multi-row invoice that breaks the
//     customer-billed revenue into its cost components:
//        Labor         X hrs × $rate            -> laborCost
//        Parts                                  -> partsCost
//        Parts markup  (X% markup)              -> partsMarkupAmount
//        Diagnostic fee                         -> diagnosticFee
//        Travel        (X miles)                -> travelCost
//     Each row appears only when its amount is > 0, so a simple
//     no-parts no-diagnostic mechanic job produces a clean labor-only
//     invoice. The sum of these rows equals the breakdown.directCost;
//     the existing TOTAL block continues to show job.revenue (the
//     amount the customer actually pays), separate from the
//     line-by-line cost itemization — matching how the existing
//     tire invoice presents `job.revenue` as the single amount, but
//     widened so mechanic customers see *what they're paying for*
//     without exposing internal margin.
//
//   - notesLabel: 'RECOMMENDATIONS' so a mechanic note (e.g. "Belt
//     showing wear, recommend replacement at next service") reads
//     as actionable customer advice rather than incidental notes.
//
//  Footer copy mentions labor + parts warranty separately because
//  parts carry the manufacturer warranty, not the mechanic's.
// ═══════════════════════════════════════════════════════════════════

import type { InvoiceTemplate, InvoiceLineItem } from './types';

function resolveMechanicServiceName(raw: string | null | undefined): string {
  if (!raw) return 'Mobile Mechanic Service';
  const k = raw.trim().toLowerCase();

  const map: Array<[string, string]> = [
    ['check engine',        'Check Engine Light Diagnosis'],
    ['diagnostic',          'Vehicle Diagnostic Service'],
    ['oil change',          'Oil & Filter Change'],
    ['battery',             'Battery Replacement Service'],
    ['brake',               'Brake System Service'],
    ['alternator',          'Alternator Replacement'],
    ['starter',             'Starter Replacement'],
    ['spark plug',          'Spark Plug Replacement'],
    ['serpentine',          'Serpentine Belt Replacement'],
    ['belt',                'Belt Replacement Service'],
    ['hose',                'Cooling System Hose Replacement'],
    ['radiator',            'Radiator Replacement'],
    ['thermostat',          'Thermostat Replacement'],
    ['suspension',          'Suspension Repair'],
    ['pre-purchase',        'Pre-Purchase Inspection'],
    ['tune-up',             'Mobile Tune-Up Service'],
    ['fluid',               'Vehicle Fluid Service'],
    ['fuel pump',           'Fuel Pump Replacement'],
    ['ignition coil',       'Ignition Coil Replacement'],
    ['repair',              'Mobile Mechanic Service'],
    ['service',             'Mobile Mechanic Service'],
  ];

  for (const [needle, friendly] of map) {
    if (k.includes(needle)) return friendly;
  }
  return raw;
}

export const MECHANIC_INVOICE_TEMPLATE: InvoiceTemplate = {
  subtitle: 'Mobile Mechanic Service',
  resolveServiceName: resolveMechanicServiceName,
  footerCopy:
    'Labor is guaranteed for 90 days. Parts carry the manufacturer warranty included with each part. ' +
    'No-start and intermittent issues may require return visits for proper diagnosis.',

  servicePerformedFields: [
    { label: 'Vehicle',     jobKey: 'vehicleMakeModel' },
    {
      label: 'Mileage',
      jobKey: 'mileage',
      format: (raw) => {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) return '';
        return n.toLocaleString('en-US') + ' miles';
      },
    },
    { label: 'Diagnostic Code', jobKey: 'diagnosticCode' },
  ],

  buildLineItems: (job, breakdown, serviceName) => {
    const items: InvoiceLineItem[] = [];

    // Service header line: customer-friendly mechanic service name.
    // No qty and no amount — this acts as a section heading; the
    // rows below itemize labor/parts/markup/diagnostic/travel. The
    // PDF renderer treats a row with no qty + amount===0 as
    // description-only (no QTY/AMOUNT column text).
    items.push({
      description: serviceName,
      amount: 0,
    });

    if (breakdown.model !== 'labor_parts') {
      // Defensive fallback: a mechanic job with a non-labor_parts
      // breakdown means upstream config drift. Render a single line
      // with the customer-billed revenue so the invoice still totals.
      items.push({
        description: 'Service total',
        amount: Number(job.revenue || 0),
      });
      return items;
    }

    if (breakdown.laborCost > 0) {
      const hrs = breakdown.laborHours;
      const rate = breakdown.laborRate;
      const hrsLabel = hrs === Math.floor(hrs) ? `${hrs}` : hrs.toFixed(1);
      items.push({
        description: `Labor (${hrsLabel} hrs × $${rate}/hr)`,
        amount: breakdown.laborCost,
      });
    }

    if (breakdown.partsCost > 0) {
      items.push({
        description: 'Parts',
        amount: breakdown.partsCost,
      });
    }

    if (breakdown.partsMarkupAmount > 0) {
      items.push({
        description: `Parts handling (${breakdown.partsMarkupPct}%)`,
        amount: breakdown.partsMarkupAmount,
      });
    }

    if (breakdown.diagnosticFee > 0) {
      items.push({
        description: 'Diagnostic fee',
        amount: breakdown.diagnosticFee,
      });
    }

    if (breakdown.travelCost > 0) {
      items.push({
        description: `Travel (${breakdown.travelMiles} mi)`,
        amount: breakdown.travelCost,
      });
    }

    return items;
  },

  notesLabel: 'RECOMMENDATIONS',
};
