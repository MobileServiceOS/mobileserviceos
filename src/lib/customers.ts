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
import { isScheduledPipeline } from '@/lib/jobStatus';

/**
 * Persisted per-customer metadata at `businesses/{bid}/customers/{key}`.
 * Created on first note save / tag toggle. Absent for most customers.
 *
 * `note` is the free-text operator note (existing field).
 * `tags` is the Phase-2 segmentation field — predefined values
 * (VIP / Fleet / Seasonal / Do Not Contact) plus free-text.
 */
export interface CustomerMeta {
  note?: string;
  tags?: string[];
  updatedAt?: string;
}

/** Predefined tag set used for the tag-edit chip grid. The list is
 *  small on purpose — most operators want a handful of categories,
 *  not a tag soup. Free-text additions are still allowed. */
export const PRESET_CUSTOMER_TAGS = ['VIP', 'Fleet', 'Seasonal', 'Do Not Contact'] as const;

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
  /** Count of jobs paid with each method. Drives the Phase-3 payment-
   *  mix bar in the profile drill-down. Keys are the raw payment
   *  method strings from the Job (caller can map via
   *  PAYMENT_METHOD_LABELS for display). */
  paymentMethodCounts: Record<string, number>;
  /** Average days between consecutive jobs for repeat customers.
   *  Null when jobCount < 2 (cadence is undefined for one-job
   *  customers). Computed as (lastDate - firstDate) / (jobCount - 1)
   *  in days. */
  visitCadenceDays: number | null;
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
    // A booked-but-not-done job (Scheduled / En Route / In Progress) hasn't
    // produced revenue yet — skip it entirely so it never inflates a
    // customer's lifetime revenue, profit, or unpaid totals. It rejoins the
    // profile once it's marked Completed.
    if (isScheduledPipeline(j.status)) continue;

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
        paymentMethodCounts: {},
        visitCadenceDays: null,
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
    if (j.paymentMethod) {
      const m = String(j.paymentMethod);
      p.paymentMethodCounts[m] = (p.paymentMethodCounts[m] || 0) + 1;
    }

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
    // Visit cadence — only meaningful for repeat customers.
    if (p.jobCount > 1 && p.firstDate && p.lastDate && p.firstDate !== p.lastDate) {
      const ms = Date.parse(p.lastDate + 'T12:00:00Z') - Date.parse(p.firstDate + 'T12:00:00Z');
      if (Number.isFinite(ms) && ms > 0) {
        p.visitCadenceDays = ms / 86_400_000 / (p.jobCount - 1);
      }
    }
  }
  out.sort((a, b) => b.revenue - a.revenue);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
//  CSV export helper (Phase 3).
//
//  Pure: takes a list of profiles + their metadata map, returns a
//  CSV string. UI handles the Blob + download. Columns ordered for
//  accountant / spreadsheet consumption (name first, money last).
// ─────────────────────────────────────────────────────────────────────

function csvEscape(v: string | number | undefined | null): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function customersToCsv(
  profiles: ReadonlyArray<CustomerProfile>,
  metaByKey: Map<string, CustomerMeta>,
  options: { includeProfit?: boolean } = {},
): string {
  const includeProfit = options.includeProfit !== false;
  const headers = [
    'Name', 'Phone', 'Email',
    'Jobs', 'Repeat',
    'First date', 'Last date',
    'Avg days between visits',
    'Top payment method',
    'Tags', 'Notes',
    'Revenue',
    ...(includeProfit ? ['Profit'] : []),
    'Unpaid jobs', 'Unpaid total',
  ];
  const rows = profiles.map((p) => {
    const meta = metaByKey.get(p.key);
    const topMethod = (() => {
      let best: [string, number] | null = null;
      for (const [k, v] of Object.entries(p.paymentMethodCounts)) {
        if (!best || v > best[1]) best = [k, v];
      }
      return best ? best[0] : '';
    })();
    return [
      csvEscape(p.name),
      csvEscape(p.phone),
      csvEscape(p.email),
      csvEscape(p.jobCount),
      csvEscape(p.isRepeat ? 'yes' : 'no'),
      csvEscape(p.firstDate),
      csvEscape(p.lastDate),
      csvEscape(p.visitCadenceDays != null ? p.visitCadenceDays.toFixed(1) : ''),
      csvEscape(topMethod),
      csvEscape((meta?.tags || []).join('; ')),
      csvEscape(meta?.note || ''),
      csvEscape(p.revenue.toFixed(2)),
      ...(includeProfit ? [csvEscape(p.profit.toFixed(2))] : []),
      csvEscape(p.unpaidCount),
      csvEscape(p.unpaidTotal.toFixed(2)),
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}
