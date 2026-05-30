import type { TireQuote, TireQuoteOption, QuoteOptionTier } from './tireQuoteTypes';
import { money } from './utils';

// ─────────────────────────────────────────────────────────────────────
//  src/lib/tireQuoteMessage.ts — Pure SMS/email body builder for the
//  Tire Quote Engine + a thin opener that hands the body to the
//  native share sheet.
//
//  Two modes:
//    1. ALL OPTIONS — sent when the customer hasn't picked a tier
//       yet ("here are your options"). Lists every available quote
//       option in the order Used Economy → Used Premium → Good →
//       Better → Best (customer reads cheapest-first; matches how
//       most tire shops present quotes verbally).
//    2. SELECTED — sent after the customer picks a tier. Just the
//       one option, formatted as a clean offer.
//
//  Format aims for ≤300 chars when there's a single option,
//  ≤700 chars when sending all 5 tiers. SMS gateways tolerate
//  longer bodies (segment-split transparently), but we keep it
//  tight for readability.
// ─────────────────────────────────────────────────────────────────────

/** Customer-facing label for each tier — what shows up in the SMS. */
const TIER_LABEL: Record<QuoteOptionTier, string> = {
  good: 'GOOD (Budget New)',
  better: 'BETTER (Most Popular)',
  best: 'BEST (Premium)',
  used_economy: 'USED ECONOMY',
  used_premium: 'USED PREMIUM',
};

/** Sort order for the all-options message (cheapest-first by tier). */
const TIER_ORDER: QuoteOptionTier[] = [
  'used_economy', 'used_premium', 'good', 'better', 'best',
];

export interface BuildQuoteMessageInput {
  /** Customer's first name. Falls back to "there" with proper
   *  greeting via greetingFor() so we never start a sentence with
   *  the lowercase fallback. */
  customerName?: string;
  /** Business name. Falls back to "our team". */
  businessName?: string;
  /** Tire size the quote is for — used in the message header. */
  tireSize?: string;
  /** Available options. Length 1–5. */
  options: ReadonlyArray<TireQuoteOption>;
  /** When set, only this tier's option is rendered. When undefined,
   *  all options are listed. */
  selectedTier?: QuoteOptionTier;
}

/** Salutation that's safe at sentence start regardless of whether
 *  the customer name was captured. */
function greetingFor(name?: string): string {
  const n = (name || '').trim();
  if (!n) return 'Hi there';
  return `Hi ${n.split(/\s+/)[0]}`;
}

/** Format one option as a single SMS-friendly line. */
function lineFor(opt: TireQuoteOption): string {
  const label = TIER_LABEL[opt.tier] || opt.tier;
  const brand = (opt.brand || '').trim();
  const model = (opt.model || '').trim();
  const tireDesc = [brand, model].filter(Boolean).join(' ') || opt.tireSize;
  const price = money(opt.customerPrice);
  const etaTag = opt.etaDays === undefined
    ? ''
    : opt.etaDays === 0 ? ' · same day'
    : opt.etaDays === 1 ? ' · next day'
    : opt.etaDays <= 7 ? ` · ${opt.etaDays} days`
    : ` · ~${opt.etaDays} days`;
  return `${label}: ${tireDesc} — ${price} installed${etaTag}`;
}

/**
 * Build the customer-facing message body. Pure. Returns the full
 * text (no link line — caller appends review/booking link if
 * needed). Same multi-channel-safe shape as buildReviewMessage().
 */
export function buildQuoteMessage(input: BuildQuoteMessageInput): string {
  const greeting = greetingFor(input.customerName);
  const biz = (input.businessName || '').trim() || 'our team';
  const size = (input.tireSize || '').trim();

  // SELECTED mode — single option.
  if (input.selectedTier) {
    const opt = input.options.find((o) => o.tier === input.selectedTier);
    if (opt) {
      const sizeClause = size ? ` for ${size}` : '';
      return [
        `${greeting}, here's your tire quote from ${biz}${sizeClause}:`,
        '',
        lineFor(opt),
        '',
        'Reply to schedule.',
      ].join('\n');
    }
    // Fall through to ALL mode if selectedTier doesn't match an
    // available option (operator misconfiguration; better to send
    // something than nothing).
  }

  // ALL OPTIONS mode.
  const sortedOptions = [...input.options].sort((a, b) => {
    return TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
  });
  const sizeClause = size ? ` for ${size}` : '';
  const lines = [
    `${greeting}, here's your tire quote from ${biz}${sizeClause}:`,
    '',
    ...sortedOptions.map(lineFor),
    '',
    'Reply to schedule.',
  ];
  return lines.join('\n');
}

// ─── Share-sheet openers ──────────────────────────────────────────
//
// Thin wrappers that build the message body and hand it to the
// native SMS / email app. Same approach the review SMS system
// uses (see reviewTemplates.shareReviewMessage).

/** Open the user's native SMS composer with the quote body
 *  pre-filled. Phone digits stripped of formatting. */
export function openSmsForQuote(
  input: BuildQuoteMessageInput & { phone?: string },
): string {
  const body = buildQuoteMessage(input);
  if (typeof window === 'undefined') return body;
  const phoneDigits = (input.phone || '').replace(/\D/g, '');
  const encoded = encodeURIComponent(body);
  const url = phoneDigits ? `sms:${phoneDigits}?body=${encoded}` : `sms:?body=${encoded}`;
  window.open(url);
  return body;
}

/** Open the user's native email composer with the quote body
 *  pre-filled. Subject auto-generated from the tire size. */
export function openEmailForQuote(
  input: BuildQuoteMessageInput & { email?: string },
): string {
  const body = buildQuoteMessage(input);
  if (typeof window === 'undefined') return body;
  const to = (input.email || '').trim();
  const subject = encodeURIComponent(
    input.tireSize ? `Tire quote: ${input.tireSize}` : 'Your tire quote',
  );
  const encoded = encodeURIComponent(body);
  const url = `mailto:${to}?subject=${subject}&body=${encoded}`;
  window.open(url);
  return body;
}

/**
 * Pick which TireQuote.serviceType maps to which existing tire-
 * vertical service catalog entry. Used by Create Job to fill in
 * the right `service` field on the prefilled Job draft.
 *
 * Maps the Phase-1 QuoteServiceType enum to canonical service ids
 * from src/config/businessTypes/tire.ts. Adding new entries here
 * is the integration point if the user adds more service types in
 * the future.
 */
export function serviceForQuote(
  quote: Pick<TireQuote, 'serviceType'>,
): string {
  switch (quote.serviceType) {
    case 'used_tire': return 'Used Tire Replacement';
    case 'new_tire': return 'New Tire Replacement';
    case 'emergency_replacement': return 'Emergency Highway Service';
    case 'replacement':
    default: return 'Tire Replacement';
  }
}
