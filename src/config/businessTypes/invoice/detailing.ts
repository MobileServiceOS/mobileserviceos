// src/config/businessTypes/invoice/detailing.ts
// ═══════════════════════════════════════════════════════════════════
//  Detailing invoice template — Phase 2.3 full slice.
//
//  Line composition:
//   - Package line: "{service} — {vehicleSize} ({mult}×)" + packageCost
//     (multiplier suffix omitted when mult === 1.0)
//   - One line per add-on: label = add-on id, amount = addOnPrices[i]
//   - Travel line when chargeable miles > 0
//
//  Legacy fallback (jobs without package_multiplier breakdown):
//  render a single line at job.revenue.
// ═══════════════════════════════════════════════════════════════════

import type { InvoiceTemplate, InvoiceLineItem } from './types';

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

  buildLineItems: (job, breakdown, serviceName) => {
    const items: InvoiceLineItem[] = [];

    if (breakdown.model !== 'package_multiplier') {
      // Defensive fallback (vertical / engine misconfiguration or
      // legacy detailing job with a non-package breakdown).
      items.push({
        description: serviceName,
        qty: Math.max(1, Math.floor(Number(job.qty) || 1)),
        amount: Number(job.revenue || 0),
      });
      return items;
    }

    // Package line — main service × vehicle-size multiplier.
    if (breakdown.packageCost > 0) {
      const mult = breakdown.vehicleSizeMultiplier;
      const sizeLabel = mult === 1
        ? breakdown.vehicleSize
        : `${breakdown.vehicleSize} (${mult}×)`;
      items.push({
        description: `${serviceName} — ${sizeLabel}`,
        amount: breakdown.packageCost,
      });
    }

    // Add-on lines — one per declared add-on with its individual
    // price from the breakdown (no settings lookup needed here).
    for (let i = 0; i < breakdown.addOnIds.length; i++) {
      const id = breakdown.addOnIds[i];
      const price = breakdown.addOnPrices[i] ?? 0;
      if (price <= 0) continue;
      items.push({
        description: id,
        amount: price,
      });
    }

    // Travel line.
    if (breakdown.travelCost > 0) {
      items.push({
        description: `Travel (${breakdown.travelChargeable} mi)`,
        amount: breakdown.travelCost,
      });
    }

    return items;
  },

  notesLabel: 'NOTES',
};
