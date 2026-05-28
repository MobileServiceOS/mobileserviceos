// tests/founderDiscount.test.ts
// Run: npx tsx tests/founderDiscount.test.ts
//
// Covers qualifiesForFounderDiscount — the pure check inside
// startCheckout that decides whether to attach the MSOS_FOUNDER
// coupon to a Stripe Checkout session. The rule is intentionally
// boring on purpose: createdAt strictly BEFORE cutoff, otherwise no
// discount. Edge cases (missing field, junk strings, equal-to-cutoff)
// MUST default to "not a founder" so we never accidentally over-
// discount a brand-new paying account.

import { qualifiesForFounderDiscount } from '@/lib/founderDiscount';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const CUTOFF = '2026-05-28T00:00:00Z';

console.log('\n┌─ Founder qualification — happy path ───────────');
check('signed up the day before cutoff → founder',
  qualifiesForFounderDiscount('2026-05-27T15:00:00Z', CUTOFF) === true);
check('signed up months before cutoff → founder',
  qualifiesForFounderDiscount('2026-01-15T08:30:00Z', CUTOFF) === true);
check('signed up a millisecond before cutoff → founder',
  qualifiesForFounderDiscount('2026-05-27T23:59:59.999Z', CUTOFF) === true);

console.log('\n┌─ Founder qualification — not a founder ────────');
check('signed up exactly at cutoff → NOT founder (strict <)',
  qualifiesForFounderDiscount('2026-05-28T00:00:00Z', CUTOFF) === false);
check('signed up an hour after cutoff → NOT founder',
  qualifiesForFounderDiscount('2026-05-28T01:00:00Z', CUTOFF) === false);
check('signed up months after cutoff → NOT founder',
  qualifiesForFounderDiscount('2026-08-01T12:00:00Z', CUTOFF) === false);

console.log('\n┌─ Safe defaults — missing / malformed inputs ───');
check('null createdAt → NOT founder',
  qualifiesForFounderDiscount(null, CUTOFF) === false);
check('undefined createdAt → NOT founder',
  qualifiesForFounderDiscount(undefined, CUTOFF) === false);
check('empty string createdAt → NOT founder',
  qualifiesForFounderDiscount('', CUTOFF) === false);
check('non-ISO garbage createdAt → NOT founder',
  qualifiesForFounderDiscount('not-a-date', CUTOFF) === false);
check('missing cutoff env var → NOT founder',
  qualifiesForFounderDiscount('2026-05-27T15:00:00Z', undefined) === false);
check('empty cutoff env var → NOT founder',
  qualifiesForFounderDiscount('2026-05-27T15:00:00Z', '') === false);
check('non-ISO garbage cutoff → NOT founder',
  qualifiesForFounderDiscount('2026-05-27T15:00:00Z', 'never') === false);

console.log('\n┌─ Realistic operator scenarios ─────────────────');
// Wheel Rush: created 2026-05-14, well before cutoff. Even though
// they're billingExempt and don't hit checkout, the qualification
// check still resolves true — defense in depth.
check('Wheel Rush createdAt (2026-05-14) → founder',
  qualifiesForFounderDiscount('2026-05-14T03:19:04.261Z', CUTOFF) === true);
// A fresh signup arriving 10 seconds after we flip the paywall on:
// they should pay full price even though the calendar date matches.
check('signup 10s into cutoff day → NOT founder',
  qualifiesForFounderDiscount('2026-05-28T00:00:10Z', CUTOFF) === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
