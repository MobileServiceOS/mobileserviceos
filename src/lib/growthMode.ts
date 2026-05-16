
// ═══════════════════════════════════════════════════════════════════
//  src/lib/growthMode.ts — Founding Member / early-access feature flag
// ═══════════════════════════════════════════════════════════════════
//
//  GROWTH MODE is a single, central feature flag that governs the
//  early-access "Founding Member" phase of Mobile Service OS.
//
//  WHAT IT DOES
//  ────────────
//  While GROWTH_MODE is true:
//    - New signups are stamped as Founding Members (Onboarding).
//    - Stripe billing ENFORCEMENT is bypassed — no forced checkout,
//      no trial-expiration lockouts, no feature-lock modals.
//    - The app presents premium "Founding Member" copy instead of
//      trial / subscribe wording.
//
//  WHAT IT DOES *NOT* DO
//  ─────────────────────
//  It does NOT remove, disable, or delete ANY billing architecture.
//  Stripe, the firestore-stripe-payments extension, webhooks, the
//  subscription mirror (stripeSync.ts), referral rewards, the plan
//  matrix, and every Firestore collection remain fully intact and
//  production-ready. Growth mode only changes ENFORCEMENT and COPY.
//
//  HOW THE BYPASS WORKS
//  ────────────────────
//  Billing enforcement in this app funnels through ONE chokepoint:
//  `isBillingExempt()` in src/lib/planAccess.ts. Growth mode hooks
//  into that single function — when GROWTH_MODE is true, every
//  account is treated as billing-exempt for the duration of the
//  early-access phase. Nothing else in the gating layer changes.
//
//  HOW TO REACTIVATE BILLING LATER
//  ───────────────────────────────
//  Set GROWTH_MODE = false below and redeploy. On the next build:
//    - NEW signups go through the normal Stripe checkout flow again
//      (Onboarding stops stamping foundingMember on fresh accounts).
//    - EXISTING Founding Members keep their stamped founder fields
//      (foundingMember / founderDiscountPercent / founderPricingLocked
//      / foundingJoinedAt). Their locked founder discount is applied
//      as a Stripe coupon when they first go through paid checkout.
//    - All paywall UI, trial logic, and feature locks re-engage
//      automatically — they were never deleted, only bypassed.
//
//  No data migration is needed to flip the switch either direction.
// ═══════════════════════════════════════════════════════════════════

/**
 * MASTER SWITCH for the Founding Member early-access phase.
 *
 * true  → early-access phase: billing bypassed, founder copy shown.
 * false → normal operation: Stripe checkout enforced for new users,
 *         existing Founding Members keep their locked founder rate.
 *
 * This is a build-time constant (not a runtime/remote flag) on
 * purpose: it must be impossible for a client to toggle billing
 * enforcement, and the value needs to be statically analyzable so
 * dead-code paths are obvious in review.
 */
export const GROWTH_MODE = true as const;

/**
 * Founder discount terms — the offer Founding Members lock in.
 *
 * Honest framing: Founding Members are NOT charged during early
 * access and are NOT comped forever. When paid billing begins they
 * receive `FOUNDER_DISCOUNT_PERCENT` off for
 * `FOUNDER_DISCOUNT_TERM_MONTHS` months, then move to standard
 * pricing. All founder-facing copy must reflect this exactly.
 */
export const FOUNDER_DISCOUNT_PERCENT = 69 as const;
export const FOUNDER_DISCOUNT_TERM_MONTHS = 12 as const;

/**
 * Is the app currently in the Founding Member early-access phase?
 *
 * Thin accessor around GROWTH_MODE so call sites read intentfully
 * (`if (isGrowthMode())`) and so a future change to runtime-flag
 * sourcing only touches this one function.
 */
export function isGrowthMode(): boolean {
  return GROWTH_MODE === true;
}

/**
 * The Founding Member field set stamped onto a new account's Settings
 * doc at signup. Centralized here so Onboarding and any future
 * back-fill use an identical, auditable shape.
 *
 * Returns an empty object when growth mode is off — so flipping the
 * switch cleanly stops new accounts from being marked as founders
 * without any conditional logic at the call site.
 */
export function foundingMemberStamp(): {
  foundingMember?: boolean;
  founderDiscountPercent?: number;
  founderDiscountTermMonths?: number;
  billingDeferred?: boolean;
  founderPricingLocked?: boolean;
  foundingJoinedAt?: string;
} {
  if (!isGrowthMode()) return {};
  return {
    foundingMember: true,
    founderDiscountPercent: FOUNDER_DISCOUNT_PERCENT,
    founderDiscountTermMonths: FOUNDER_DISCOUNT_TERM_MONTHS,
    billingDeferred: true,
    founderPricingLocked: true,
    foundingJoinedAt: new Date().toISOString(),
  };
}

/**
 * Human-readable founder discount line for UI copy.
 * e.g. "69% off for your first 12 months"
 */
export const FOUNDER_DISCOUNT_LINE =
  `${FOUNDER_DISCOUNT_PERCENT}% off for your first ${FOUNDER_DISCOUNT_TERM_MONTHS} months` as const;
