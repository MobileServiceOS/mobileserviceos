// src/lib/notificationTemplates.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure rendering for NOTIFICATION_TEMPLATES — variable substitution
//  + builder that derives the substitution context from a Job +
//  business brand + settings.
//
//  Missing variables render as the literal `{var.name}` and emit a
//  dev-only console warning. Production stays silent.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Brand, Settings } from '@/types';
import { money } from '@/lib/utils';
import type { NotificationTemplate } from '@/config/notifications/templates';

export interface TemplateVars {
  customer: { firstName: string; name: string; phone: string; email?: string };
  business: { name: string; phone: string; email: string; reviewUrl: string; paymentMethods: string };
  job: { shortId: string; service: string; totalFormatted: string };
  tech: { name: string };
}

const VAR_RE = /\{([a-zA-Z]+)\.([a-zA-Z]+)\}/g;

export function renderTemplate(
  template: NotificationTemplate,
  vars: TemplateVars,
): { subject?: string; body: string } {
  const substitute = (input: string): string =>
    input.replace(VAR_RE, (match, group: string, key: string) => {
      const bucket = (vars as unknown as Record<string, Record<string, string | undefined>>)[group];
      if (!bucket) {
        if (import.meta?.env?.DEV) {
          // eslint-disable-next-line no-console
          console.warn(`[notificationTemplates] unknown group: ${match}`);
        }
        return match;
      }
      const v = bucket[key];
      if (v === undefined || v === null || v === '') {
        if (import.meta?.env?.DEV) {
          // eslint-disable-next-line no-console
          console.warn(`[notificationTemplates] empty variable: ${match}`);
        }
        return match;
      }
      return String(v);
    });

  return {
    subject: template.subject ? substitute(template.subject) : undefined,
    body: substitute(template.body),
  };
}

export function buildTemplateVars(
  job: Job,
  brand: Brand,
  settings: Settings,
  techName: string,
): TemplateVars {
  const fullName = String(job.customerName || '').trim();
  const firstName = fullName ? fullName.split(/\s+/)[0] : 'there';
  const shortId = String(job.id || '').slice(-6).toUpperCase();
  const total = money(Number(job.revenue || 0));
  // settings.acceptedPaymentMethods isn't a declared field today; use
  // the hardcoded fallback so we don't break the build. Future:
  // operator-editable list via Settings.
  const paymentMethods = ((settings as Settings & { acceptedPaymentMethods?: string[] }).acceptedPaymentMethods
    ?? ['Cash', 'Zelle', 'Card']).join(', ');

  return {
    customer: {
      firstName,
      name: fullName || 'customer',
      phone: String(job.customerPhone || ''),
      email: job.customerEmail || undefined,
    },
    business: {
      name: brand.businessName || 'our business',
      phone: brand.phone || '',
      email: brand.email || '',
      reviewUrl: brand.reviewUrl || '',
      paymentMethods,
    },
    job: {
      shortId: shortId || 'NEW',
      service: job.service || 'service',
      totalFormatted: total,
    },
    tech: {
      name: techName || 'your technician',
    },
  };
}
