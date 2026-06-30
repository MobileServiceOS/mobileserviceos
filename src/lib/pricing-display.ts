// ─────────────────────────────────────────────────────────────────────
//  Plan price strings — single source of truth for the marketing UI.
//
//  These are DISPLAY values only — NOT the source of truth for Stripe
//  charges. The actual amount is whatever the configured Stripe price
//  costs. Keep in sync with the Stripe dashboard.
//
//  PRICING MODEL (2026-06): TWO tiers — Free and Paid.
//    • Free  — $0, usable; advanced features show locked states.
//    • Paid  — $35/month, unlocks everything (the only purchasable plan).
//
//  The old three-value Core ($39) / Pro ($79) split is collapsed: there
//  is now ONE paid price. The `PRO_*` / `CORE_*` exports are kept as
//  back-compat aliases (the internal tier literal for "paid" is still
//  'pro') and now resolve to the single $35 price.
//
//  When the Stripe price changes:
//    1. Update the Stripe dashboard amount.
//    2. Update PAID_PRICE below to match.
//    3. Update VITE_STRIPE_PAID_PRICE_ID if the price ID itself changed.
// ─────────────────────────────────────────────────────────────────────

/** The single paid-tier monthly price, dollar-formatted (no period). */
export const PAID_PRICE = '$35' as const;

/** Pre-composed "$35 / month" line for buttons and headers. */
export const PAID_PRICE_LINE = `${PAID_PRICE} / month` as const;

/** "$35/month" compact (no spaces) for tight summary lines. */
export const PAID_PRICE_LINE_COMPACT = `${PAID_PRICE}/month` as const;

// ─── Back-compat aliases ─────────────────────────────────────────────
// The resolved paid tier is still the 'pro' literal internally, so these
// keep existing imports working and now point at the single $35 price.
/** @deprecated Use PAID_PRICE. */
export const PRO_PRICE = PAID_PRICE;
/** @deprecated Use PAID_PRICE_LINE. */
export const PRO_PRICE_LINE = PAID_PRICE_LINE;
/** @deprecated Use PAID_PRICE_LINE_COMPACT. */
export const PRO_PRICE_LINE_COMPACT = PAID_PRICE_LINE_COMPACT;
// Core is no longer a separately-priced tier; aliases resolve to the
// single paid price so any lingering reference renders consistently.
/** @deprecated Core is no longer sold; the free tier replaces it. */
export const CORE_PRICE = PAID_PRICE;
/** @deprecated Core is no longer sold; the free tier replaces it. */
export const CORE_PRICE_LINE = PAID_PRICE_LINE;
/** @deprecated Core is no longer sold; the free tier replaces it. */
export const CORE_PRICE_LINE_COMPACT = PAID_PRICE_LINE_COMPACT;
