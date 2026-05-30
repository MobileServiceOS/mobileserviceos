import type { TireQuote, QuoteStatus } from './tireQuoteTypes';

// ─────────────────────────────────────────────────────────────────────
//  src/lib/tireQuoteAnalytics.ts — pure rollup helpers for the Quote
//  History page.
//
//  Phase 4 of the Tire Quote Engine. No React, no Firestore, no side
//  effects — operates on plain TireQuote[] arrays.
//
//  Operator-facing metrics the page displays:
//    • Total quotes
//    • Conversion rate (accepted + convertedToJob) / total
//    • Accepted revenue — sum of customerPrice across accepted + converted
//    • Per-status breakdown (draft / sent / accepted / declined / converted)
//
//  Convention: "conversion" treats both ACCEPTED and CONVERTED_TO_JOB
//  as the success states. A quote that's been accepted by the customer
//  but hasn't yet flipped to a Job (because the operator hasn't logged
//  the job yet) is still a converted lead from the customer's POV.
// ─────────────────────────────────────────────────────────────────────

export interface QuoteAnalytics {
  /** Quotes the rollup considered. */
  totalQuotes: number;
  /** Count of quotes in each status bucket. Missing/unknown status
   *  values bucket under 'draft' (safe default for partial docs). */
  byStatus: Record<QuoteStatus, number>;
  /** Quotes where the customer accepted (status === 'accepted' OR
   *  'convertedToJob'). Used as the numerator for conversion rate. */
  acceptedCount: number;
  /** Quotes where the customer declined. Used for decline rate. */
  declinedCount: number;
  /** Conversion rate as a decimal (0.42 = 42%). 0 when totalQuotes
   *  is 0 to avoid NaN. */
  conversionRate: number;
  /** Decline rate as a decimal. 0 when totalQuotes is 0. */
  declineRate: number;
  /** Sum of customerPrice across accepted + converted quotes. The
   *  "money on the table" metric — what these quotes are worth IF
   *  the operator follows through and logs the jobs. */
  acceptedRevenue: number;
  /** Sum of estimatedProfit on accepted + converted quotes. Owner/
   *  admin only — UI must gate visibility on canEditPricingSettings. */
  acceptedProfit: number;
}

const ZERO_BY_STATUS: Record<QuoteStatus, number> = {
  draft: 0,
  sent: 0,
  accepted: 0,
  declined: 0,
  convertedToJob: 0,
};

/**
 * Aggregate a list of quotes into the metrics the Quote History
 * page displays. Pure function — input/output deterministic, no
 * side effects, no Date.now() coupling. Caller filters quotes by
 * time range BEFORE passing in if a windowed view is wanted.
 *
 * Empty input returns a zeroed-out QuoteAnalytics rather than
 * throwing, so the UI can call this unconditionally on first
 * render before any quotes have loaded.
 */
export function computeQuoteAnalytics(
  quotes: ReadonlyArray<TireQuote> | null | undefined,
): QuoteAnalytics {
  const byStatus: Record<QuoteStatus, number> = { ...ZERO_BY_STATUS };
  let totalQuotes = 0;
  let acceptedRevenue = 0;
  let acceptedProfit = 0;

  if (!quotes || quotes.length === 0) {
    return {
      totalQuotes: 0,
      byStatus,
      acceptedCount: 0,
      declinedCount: 0,
      conversionRate: 0,
      declineRate: 0,
      acceptedRevenue: 0,
      acceptedProfit: 0,
    };
  }

  for (const q of quotes) {
    totalQuotes += 1;
    const status: QuoteStatus = (q.status as QuoteStatus) || 'draft';
    if (status in byStatus) {
      byStatus[status] += 1;
    } else {
      // Unknown / malformed status falls to draft for safety.
      byStatus.draft += 1;
    }
    if (status === 'accepted' || status === 'convertedToJob') {
      acceptedRevenue += Number(q.customerPrice || 0);
      acceptedProfit += Number(q.estimatedProfit || 0);
    }
  }

  const acceptedCount = byStatus.accepted + byStatus.convertedToJob;
  const declinedCount = byStatus.declined;
  const conversionRate = totalQuotes > 0 ? acceptedCount / totalQuotes : 0;
  const declineRate = totalQuotes > 0 ? declinedCount / totalQuotes : 0;

  return {
    totalQuotes,
    byStatus,
    acceptedCount,
    declinedCount,
    conversionRate,
    declineRate,
    acceptedRevenue,
    acceptedProfit,
  };
}

/**
 * Apply the Quote History page's combined filter set to a quote
 * list. All filters are AND'd: a quote must match every active
 * filter to remain. Empty / 'all' filters pass through.
 *
 * Returns a new array — never mutates the input.
 */
export interface QuoteFilters {
  /** Free-text search across customerName + customerPhone. */
  search?: string;
  /** Restrict to a single tire size. Compares against the search
   *  input on the quote (kind === 'size' carries tireSize). */
  tireSize?: string;
  /** Restrict to quotes created by a specific user uid. */
  createdBy?: string;
  /** Restrict to a QuoteServiceType (replacement / used_tire /
   *  new_tire / emergency_replacement). */
  serviceType?: string;
  /** Restrict to a QuoteStatus. */
  status?: QuoteStatus;
}

export function filterQuotes(
  quotes: ReadonlyArray<TireQuote>,
  filters: QuoteFilters,
): TireQuote[] {
  const search = (filters.search || '').trim().toLowerCase();
  return quotes.filter((q) => {
    if (filters.status && q.status !== filters.status) return false;
    if (filters.createdBy && q.createdBy !== filters.createdBy) return false;
    if (filters.serviceType && q.serviceType !== filters.serviceType) return false;
    if (filters.tireSize) {
      const target = filters.tireSize.trim().toLowerCase();
      const inSearch = q.search.kind === 'size'
        ? q.search.tireSize.toLowerCase()
        : '';
      if (inSearch !== target) return false;
    }
    if (search) {
      const hay = [
        q.customerName, q.customerPhone, q.customerCity,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
