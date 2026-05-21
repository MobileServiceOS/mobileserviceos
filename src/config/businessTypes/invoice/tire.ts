// src/config/businessTypes/invoice/tire.ts
// ═══════════════════════════════════════════════════════════════════
//  Tire invoice template — extracts today's customerFriendlyServiceName
//  table from src/lib/invoice.ts verbatim. Existing tire invoices
//  render byte-for-byte identically after this lands:
//
//    - servicePerformedFields lists tireSize + vehicleType + a
//      "Used tire" indicator (rendered only when tireCondition=='Used').
//      The renderer iterates this list and skips empty rows, so a
//      tire job without a tireSize emits no row — same as today.
//
//    - buildLineItems returns exactly ONE line per invoice:
//      { description: friendly-name, qty: job.qty, amount: job.revenue }.
//      This matches the existing single-line LINE ITEM TABLE.
//
//    - notesLabel: 'NOTES' (today's label).
// ═══════════════════════════════════════════════════════════════════

import type { InvoiceTemplate } from './types';

function resolveTireServiceName(raw: string | null | undefined): string {
  if (!raw) return 'Mobile Tire Service';
  const k = raw.trim().toLowerCase();

  // VERBATIM order from src/lib/invoice.ts (specific keys first).
  const map: Array<[string, string]> = [
    ['tire repair',           'Flat Tire Repair Service'],
    ['flat tire',             'Flat Tire Repair Service'],
    ['tire replacement',      'Mobile Tire Replacement Service'],
    ['tire installation',     'Tire Installation Service'],
    ['tire change',           'Mobile Tire Replacement Service'],
    ['spare',                 'Spare Tire Installation'],
    ['mount',                 'Tire Mount & Balance'],
    ['balance',               'Tire Mount & Balance'],
    ['roadside',              'Emergency Roadside Tire Service'],
    ['emergency',             'Emergency Roadside Tire Service'],
    ['rotation',              'Tire Rotation Service'],
    ['tractor-trailer',       'Commercial Tire Service'],
    ['semi',                  'Commercial Tire Service'],
    ['plug',                  'Flat Tire Repair Service'],
    ['patch',                 'Flat Tire Repair Service'],
    ['tire',                  'Mobile Tire Service'],
    ['service',               'Mobile Tire Service'],
    ['dispatch',              'Mobile Tire Service'],
  ];

  for (const [needle, friendly] of map) {
    if (k.includes(needle)) return friendly;
  }
  return raw;
}

export const TIRE_INVOICE_TEMPLATE: InvoiceTemplate = {
  subtitle: 'Mobile Tire & Roadside Service',
  resolveServiceName: resolveTireServiceName,
  footerCopy:
    'All work is guaranteed for 30 days against defects in workmanship. ' +
    'Customer is responsible for following any care/break-in instructions provided.',

  servicePerformedFields: [
    { label: 'Tire Size', jobKey: 'tireSize' },
    { label: 'Vehicle',   jobKey: 'vehicleType' },
    // Used-tire indicator (per user requirement): only rendered when
    // the job records the tire as Used. The renderer skips this row
    // for new/unspecified jobs, preserving today's behaviour for the
    // common case.
    {
      label: 'Tire Condition',
      jobKey: 'tireCondition',
      format: (raw) => (raw === 'Used' ? 'Used tire installed' : ''),
    },
  ],

  buildLineItems: (job, _breakdown, serviceName) => [
    {
      description: serviceName,
      qty: Math.max(1, Math.floor(Number(job.qty) || 1)),
      amount: Number(job.revenue || 0),
    },
  ],

  notesLabel: 'NOTES',
};
