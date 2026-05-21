// src/config/businessTypes/invoice/types.ts
// ═══════════════════════════════════════════════════════════════════
//  Invoice template type contract — one InvoiceTemplate per business
//  type. The PDF generator in src/lib/invoice.ts reads these
//  per-vertical settings to produce a vertical-appropriate invoice.
//
//  Design notes:
//   - Tire's template ships values that reproduce today's invoice
//     output byte-for-byte (single line item, same field rows,
//     same "NOTES" label, same footer copy).
//   - Mechanic's template ships multi-line invoice items (labor,
//     parts, parts markup, diagnostic fee) by inspecting the
//     PricingBreakdownTagged that the engine already computes.
//   - Detailing ships a skeleton template; full population is
//     Phase 2.3.
//   - The renderer never branches on businessType — it iterates the
//     template arrays. Adding a fourth vertical means writing one
//     template file; the PDF code does not change.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';
import type { PricingBreakdownTagged } from '@/config/businessTypes/pricing';

/**
 * One row in the "SERVICE PERFORMED" block under the BILL TO header.
 * The renderer skips rows whose resolved value is empty. Order is
 * preserved.
 */
export interface ServicePerformedRow {
  /** Label printed in the left column, e.g. "Tire Size", "Vehicle". */
  label: string;
  /** Key to read from the Job. May be a known top-level field
   *  (`tireSize`, `vehicleType`) or a vertical-specific optional one
   *  (`vehicleMakeModel`, `mileage`, `vehicleSize`). */
  jobKey: keyof Job & string;
  /** Optional value formatter. Default is `String(raw)`. */
  format?: (raw: unknown) => string;
}

/**
 * One line of the invoice line-item table. Tire's template returns
 * exactly one of these per invoice; mechanic returns three to five
 * (labor / parts / markup / diagnostic / travel).
 */
export interface InvoiceLineItem {
  /** Description column — what the customer reads. */
  description: string;
  /** Quantity column. Omit (or pass undefined) for cost-only rows
   *  like "Diagnostic fee" that don't have a meaningful unit count. */
  qty?: number;
  /** Amount column (dollars, already in customer-billed units). */
  amount: number;
}

export interface InvoiceTemplate {
  /** Header subtitle, e.g. "Mobile Tire & Roadside Service". */
  subtitle: string;

  /**
   * Resolve a stored service name into the customer-friendly form
   * used on the printed invoice. Each vertical owns its map.
   */
  resolveServiceName: (raw: string | null | undefined) => string;

  /**
   * Footer disclaimer / warranty boilerplate, vertical-specific.
   * Rendered only when the business has not configured its own
   * `brand.invoiceFooter` override (Pro feature).
   */
  footerCopy: string;

  /**
   * Rows shown under SERVICE PERFORMED. Each row is rendered only if
   * the corresponding Job field has a non-empty value, so a tire
   * template can list `tireSize` and `vehicleType` without leaving
   * blank rows when those fields are absent.
   */
  servicePerformedFields: ReadonlyArray<ServicePerformedRow>;

  /**
   * Build the invoice line-item table from a job + the computed
   * pricing breakdown + the resolved service name.
   *
   * Tire returns one line: `{ description: friendlyServiceName, qty,
   * amount: revenue }` — preserving today's exact rendering.
   *
   * Mechanic returns up to five lines covering labor, parts,
   * parts-markup, diagnostic fee, and travel — each priced from the
   * breakdown's labor_parts tagged fields.
   *
   * Detailing returns a single line in 2.1; package + add-ons +
   * membership rows land in Phase 2.3.
   *
   * The sum of `amount` across the returned rows is what the
   * subtotal row displays. For tire this equals `job.revenue`; for
   * mechanic it equals the breakdown's direct cost components.
   */
  buildLineItems: (
    job: Job,
    breakdown: PricingBreakdownTagged,
    serviceName: string,
  ) => ReadonlyArray<InvoiceLineItem>;

  /**
   * Label used for the optional notes section. Tire: "NOTES";
   * Mechanic: "RECOMMENDATIONS"; Detailing: "NOTES".
   * The renderer only emits this block when `job.note` is non-empty.
   */
  notesLabel: string;
}
