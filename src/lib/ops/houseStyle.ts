// src/lib/ops/houseStyle.ts
// ═══════════════════════════════════════════════════════════════════
//  House-style rules for the review-reply autodraft (Loop 2).
//
//  The reply must, strictly:
//    • contain NO emoji
//    • contain NO dashes of any kind (hyphen, en dash, em dash, …)
//    • include the exact phrase "mobile tire repair service"
//    • reference both Broward and Miami Dade
//    • be warm, professional, and specific (judged by a human; only the
//      mechanical rules above are validated here)
//
//  The model is prompted with these rules, but a draft is the owner's to
//  edit before sending — so we VALIDATE the draft and surface any
//  violations in the UI rather than trusting the model blindly.
// ═══════════════════════════════════════════════════════════════════

export const REQUIRED_PHRASE = 'mobile tire repair service';
export const REQUIRED_COUNTIES = ['Broward', 'Miami Dade'] as const;

// Extended pictographic covers the emoji range (😀, 🛞, ✅, …). The `u`
// flag is required for the property escape.
const EMOJI_RE = /\p{Extended_Pictographic}/u;

// Every dash variant: hyphen-minus, the Unicode hyphen/dash block
// (U+2010–U+2015), and the math minus sign (U+2212).
const DASH_RE = /[-‐‑‒–—―−]/;

export function hasEmoji(s: string): boolean {
  return EMOJI_RE.test(s ?? '');
}

export function hasDash(s: string): boolean {
  return DASH_RE.test(s ?? '');
}

export function includesRequiredPhrase(s: string): boolean {
  return (s ?? '').toLowerCase().includes(REQUIRED_PHRASE);
}

/** Normalize for county matching: lowercase and treat dashes as spaces
 *  so "Miami-Dade" still matches the dash-free "miami dade". */
function normalizeForCounty(s: string): string {
  return (s ?? '').toLowerCase().replace(DASH_RE, ' ').replace(/\s+/g, ' ');
}

export function referencesBroward(s: string): boolean {
  return normalizeForCounty(s).includes('broward');
}

export function referencesMiamiDade(s: string): boolean {
  return normalizeForCounty(s).includes('miami dade');
}

export type HouseStyleViolation =
  | 'empty'
  | 'emoji'
  | 'dash'
  | 'missing-phrase'
  | 'missing-broward'
  | 'missing-miami-dade';

export interface HouseStyleResult {
  ok: boolean;
  violations: HouseStyleViolation[];
}

/** Validate a review reply against every mechanical house-style rule. */
export function validateReviewReply(reply: string): HouseStyleResult {
  const violations: HouseStyleViolation[] = [];
  const text = (reply ?? '').trim();

  if (!text) {
    return { ok: false, violations: ['empty'] };
  }
  if (hasEmoji(text)) violations.push('emoji');
  if (hasDash(text)) violations.push('dash');
  if (!includesRequiredPhrase(text)) violations.push('missing-phrase');
  if (!referencesBroward(text)) violations.push('missing-broward');
  if (!referencesMiamiDade(text)) violations.push('missing-miami-dade');

  return { ok: violations.length === 0, violations };
}

/** Human-readable label for a violation (UI surfacing). */
export function describeViolation(v: HouseStyleViolation): string {
  switch (v) {
    case 'empty':
      return 'Reply is empty';
    case 'emoji':
      return 'Contains an emoji (not allowed)';
    case 'dash':
      return 'Contains a dash (hyphens, en/em dashes not allowed)';
    case 'missing-phrase':
      return `Missing the required phrase "${REQUIRED_PHRASE}"`;
    case 'missing-broward':
      return 'Does not reference Broward';
    case 'missing-miami-dade':
      return 'Does not reference Miami Dade';
  }
}
