// src/config/businessTypes/invoice/index.ts
// ═══════════════════════════════════════════════════════════════════
//  Invoice template registry — strongly-typed lookup by
//  BusinessTypeKey. Unknown keys safely degrade to the tire template.
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeKey } from '../types';
import type { InvoiceTemplate } from './types';
import { TIRE_INVOICE_TEMPLATE } from './tire';

export const INVOICE_TEMPLATE_REGISTRY: Readonly<Record<BusinessTypeKey, InvoiceTemplate>> = {
  tire: TIRE_INVOICE_TEMPLATE,
};

export function getInvoiceTemplate(
  key: BusinessTypeKey | null | undefined,
): InvoiceTemplate {
  if (key && INVOICE_TEMPLATE_REGISTRY[key]) {
    return INVOICE_TEMPLATE_REGISTRY[key];
  }
  return TIRE_INVOICE_TEMPLATE;
}

export type { InvoiceTemplate, ServicePerformedRow, InvoiceLineItem } from './types';
