// src/lib/customers.ts
// ═══════════════════════════════════════════════════════════════════
//  Customer CRM — pure derivation layer.
//
//  Customers are NOT a stored entity. Every profile field below is
//  computed live from the job list, so the CRM is always accurate
//  with zero migration. The only persisted per-customer datum is a
//  free-text operator note (customers/{key} doc) — handled by the
//  Customers page UI, not here.
//
//  This module is pure + side-effect free — unit-tested in
//  tests/customerProfiles.test.ts.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { jobGrossProfit, resolvePaymentStatus } from '@/lib/utils';

export interface CustomerProfile {
  /** Firestore-safe, normalized key — also the customers/{key}
   *  note-doc id. See customerKey(). */
  key: string;
  name: string;
  phone: string;
  email: string;
  jobCount: number;
  /** More than one job logged for this customer. */
  isRepeat: boolean;
  /** Lifetime revenue + profit across all the customer's jobs. */
  revenue: number;
  profit: number;
  /** ISO dates of the first + most recent job. */
  firstDate: string;
  lastDate: string;
  /** The customer's jobs, most recent first. */
  jobs: Job[];
  /** Distinct non-empty tire sizes seen (tire vertical). */
  tireSizes: string[];
  /** Distinct non-empty vehicle make/model strings (mechanic). */
  vehicles: string[];
  /** Distinct payment methods used. */
  paymentMethods: string[];
  /** How many of the customer's jobs have had a review requested. */
  reviewsSent: number;
  /** Jobs not fully Paid — count + outstanding revenue total. */
  unpaidCount: number;
  unpaidTotal: number;
}

/**
 * Stable, normalized, Firestore-safe identity for a customer.
 *
 *   phone present → 'p_' + digits-only(phone)
 *   else name     → 'n_' + slug(name)
 *   else          → ''  (unidentifiable — caller skips)
 *
 * Digit-normalizing the phone means '(555) 123-4567' and
 * '555-123-4567' resolve to the SAME customer (the old raw-string
 * key split them). The 'p_'/'n_' prefix prevents a phone-keyed and
 * a name-keyed customer from ever colliding, and the result is
 * always a legal Firestore document id.
 */
export function customerKey(
  job: Pick<Job, 'customerPhone' | 'customerName'>,
): string {
  const digits = (job.customerPhone || '').replace(/\D/g, '');
  if (digits) return `p_${digits}`;
  const slug = (job.customerName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `n_${slug}` : '';
}

function pushDistinct(arr: string[], v: string | undefined | null): void {
  const s = (v || '').trim();
  if (s && !arr.includes(s)) arr.push(s);
}

/**
 * Aggregate a job list into per-customer profiles, sorted by
 * lifetime revenue (highest first).
 */
export function deriveCustomerProfiles(
  jobs: ReadonlyArray<Job>,
  settings: Settings,
): CustomerProfile[] {
  const map = new Map<string, CustomerProfile>();

  for (const j of jobs || []) {
    const key = customerKey(j);
    if (!key) continue;

    let p = map.get(key);
    if (!p) {
      p = {
        key,
        name: (j.customerName || '').trim() || 'Unknown',
        phone: j.customerPhone || '',
        email: j.customerEmail || '',
        jobCount: 0,
        isRepeat: false,
        revenue: 0,
        profit: 0,
        firstDate: j.date || '',
        lastDate: j.date || '',
        jobs: [],
        tireSizes: [],
        vehicles: [],
        paymentMethods: [],
        reviewsSent: 0,
        unpaidCount: 0,
        unpaidTotal: 0,
      };
      map.set(key, p);
    }

    p.jobs.push(j);
    p.jobCount += 1;
    p.revenue += Number(j.revenue || 0);
    p.profit += jobGrossProfit(j, settings);

    const d = j.date || '';
    if (d && (!p.firstDate || d < p.firstDate)) p.firstDate = d;
    if (d && d > p.lastDate) p.lastDate = d;

    // Fill in identity fields from any job that has them.
    if ((!p.name || p.name === 'Unknown') && (j.customerName || '').trim()) {
      p.name = (j.customerName || '').trim();
    }
    if (!p.phone && j.customerPhone) p.phone = j.customerPhone;
    if (!p.email && j.customerEmail) p.email = j.customerEmail;

    pushDistinct(p.tireSizes, j.tireSize);
    pushDistinct(p.vehicles, j.vehicleMakeModel);
    pushDistinct(p.paymentMethods, j.paymentMethod);

    if (j.reviewRequested) p.reviewsSent += 1;
    if (resolvePaymentStatus(j) !== 'Paid') {
      p.unpaidCount += 1;
      p.unpaidTotal += Number(j.revenue || 0);
    }
  }

  const out = Array.from(map.values());
  for (const p of out) {
    p.isRepeat = p.jobCount > 1;
    // Most recent job first within each profile.
    p.jobs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  out.sort((a, b) => b.revenue - a.revenue);
  return out;
}
