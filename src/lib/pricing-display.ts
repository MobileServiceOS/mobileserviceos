// ─────────────────────────────────────────────────────────────────────
//  Plan price strings — single source of truth for the marketing UI.
//
//  These are DISPLAY values only — NOT the source of truth for
//  Stripe charges. The actual amount charged is whatever Stripe says
//  the configured price ID costs. Keep these strings in sync with the
//  Stripe dashboard so the UI matches what the customer is billed.
//
//  Why centralize:
//    Before this module, the price was hand-coded in 8 separate UI
//    strings across PlanCard, UpgradeModal, SubscribeButton,
//    Settings.tsx, comment blocks, etc. Updating to a new price meant
//    grepping every reference. Now it's a one-line edit.
//
//  How to use:
//    import { PRO_PRICE, CORE_PRICE, PRO_PRICE_LINE } from '@/lib/pricing-display';
//
//    <div>{PRO_PRICE_LINE}</div>          // "$89.99 / month"
//    <button>Subscribe · {PRO_PRICE_LINE}</button>
//
//  When Stripe price changes:
//    1. Update Stripe dashboard with the new amount
//    2. Update PRO_PRICE / CORE_PRICE below to match
//    3. Update VITE_STRIPE_PRO_PRICE_ID if the price ID itself changed
// ─────────────────────────────────────────────────────────────────────

/** Pro plan monthly price, dollar-formatted for inline use (no period). */
export const PRO_PRICE = '$89.99' as const;

/** Core plan monthly price. */
export const CORE_PRICE = '$39' as const;

/** Pre-composed "$89.99 / month" line used in buttons and headers. */
export const PRO_PRICE_LINE = `${PRO_PRICE} / month` as const;

/** Pre-composed "$39.99 / month" line for Core. */
export const CORE_PRICE_LINE = `${CORE_PRICE} / month` as const;

/** "$89.99/month" without spaces — used in summary lines where the
 *  spaced version takes too much horizontal space. */
export const PRO_PRICE_LINE_COMPACT = `${PRO_PRICE}/month` as const;

/** "$39.99/month" compact. */
export const CORE_PRICE_LINE_COMPACT = `${CORE_PRICE}/month` as const;
