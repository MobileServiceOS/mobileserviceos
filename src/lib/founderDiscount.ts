// ─────────────────────────────────────────────────────────────────────
//  src/lib/founderDiscount.ts — pure founder qualification check
//
//  Decides whether a given business qualifies for the locked-in
//  founder discount coupon. Lives in its own module (no firebase, no
//  React, no env reads) so the rule can be unit-tested without spinning
//  up a Vite environment.
//
//  Consumer: stripeSync.ts startCheckout — calls this after fetching
//  the business doc, before building the Stripe Checkout payload.
// ─────────────────────────────────────────────────────────────────────

/**
 * Pure check: does this business qualify for the founder discount?
 *
 * Rule: account `createdAt` strictly BEFORE the cutoff ISO. Missing or
 * unparseable inputs default to NOT a founder — safer to charge full
 * price than to over-discount a brand-new paying account.
 *
 * @param businessCreatedAt  Business doc's `createdAt` ISO string
 * @param cutoffIso          Cutoff timestamp (from env var)
 */
export function qualifiesForFounderDiscount(
  businessCreatedAt: string | undefined | null,
  cutoffIso: string | undefined,
): boolean {
  if (!businessCreatedAt || !cutoffIso) return false;
  const createdMs = Date.parse(businessCreatedAt);
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(createdMs) || !Number.isFinite(cutoffMs)) return false;
  return createdMs < cutoffMs;
}
