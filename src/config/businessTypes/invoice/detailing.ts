// src/config/businessTypes/invoice/detailing.ts
// ═══════════════════════════════════════════════════════════════════
//  Detailing invoice template — SKELETON for Phase 2.1.
//
//  Active fields:
//    - subtitle, resolveServiceName, footerCopy, notesLabel — minimal
//      detailing nomenclature so a hypothetical detailing invoice
//      generated today does not say "Mobile Tire" anywhere.
//    - servicePerformedFields: vehicle size (the only detailing-
//      specific Job field declared in Phase 2.1; populated in 2.3).
//    - buildLineItems: single line for the package amount. Real
//      package + add-ons + photo-placeholder + membership rows
//      land in Phase 2.3 alongside the package_multiplier engine.
// ═══════════════════════════════════════════════════════════════════

import type { InvoiceTemplate } from './types';

export const DETAILING_INVOICE_TEMPLATE: InvoiceTemplate = {
  subtitle: 'Mobile Car Wash & Detailing',
  resolveServiceName: (raw) => raw || 'Mobile Detailing Service',
  footerCopy:
    'All work performed to industry standards. Customer must inspect ' +
    'and approve before technician leaves the site.',

  servicePerformedFields: [
    { label: 'Vehicle Size', jobKey: 'vehicleSize' },
    { label: 'Vehicle',      jobKey: 'vehicleType' },
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
