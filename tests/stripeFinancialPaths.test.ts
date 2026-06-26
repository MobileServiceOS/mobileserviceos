// tests/stripeFinancialPaths.test.ts
// Run: npx tsx tests/stripeFinancialPaths.test.ts
//
// Hotfix #4 (2026-05-31, audit): the financial-path modules
// (src/lib/stripeSync.ts, src/lib/planAccess.ts) had ZERO unit tests
// covering the four functions that decide every Pro-vs-Core gate and
// every Stripe-state → MSOS-state translation. The double-increment
// bug from Hotfix #3 would have been caught here as well.
//
// This file establishes a baseline of unit tests for:
//   - mapStripeStatus       (Stripe status → MSOS SubscriptionStatus)
//   - extractPlan           (msos_plan metadata → Plan)
//   - pickPrimary           (priority sort + recency tiebreaker)
//   - resolvePlan           (settings → AccessTier with exemption + trial)
//   - isBillingExempt       (per-account exemption + growthMode)
//   - hasActiveSubscription (compose of above)
//   - planLiteralIsPro      (raw plan field check)
//   - sanitizeSubscriptionWrite (strips locked fields client-side)

import type { Settings, Plan } from '@/types';
import {
  mapStripeStatus,
  extractPlan,
  pickPrimary,
  type StripeSubscriptionDoc,
} from '@/lib/stripeSync';
import {
  resolvePlan,
  isBillingExempt,
  hasActiveSubscription,
  planLiteralIsPro,
  sanitizeSubscriptionWrite,
} from '@/lib/planAccess';
import { __setGrowthModeForTests } from '@/lib/growthMode';

// These tests verify the Stripe-state → gating translation that the
// early-access GROWTH_MODE switch globally overrides while the app ships
// free. Force the override off so the dormant enforcement/exemption logic
// is actually exercised (a growth-mode-ON block at the end covers the free
// behavior). Restored to the build-time default before the suite ends.
__setGrowthModeForTests(false);

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

// Test fixture for Stripe Timestamp shape. The real type has .toMillis()
// — we only need that one method for these tests.
const ts = (millis: number) => ({ toMillis: () => millis } as { toMillis(): number });

function makeStripeDoc(overrides: Partial<StripeSubscriptionDoc> & { _docId?: string } = {}): StripeSubscriptionDoc {
  return {
    status: 'active',
    trial_end: null,
    current_period_end: null,
    price: { product: { metadata: { msos_plan: 'pro' } } },
    ...overrides,
  } as StripeSubscriptionDoc;
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { plan: 'pro', subscriptionStatus: 'active', ...overrides } as Settings;
}

// ════════════════════════════════════════════════════════════════════
//  mapStripeStatus
// ════════════════════════════════════════════════════════════════════
section('mapStripeStatus — Stripe → MSOS state translation');
{
  check("'trialing' → 'trialing'", mapStripeStatus('trialing') === 'trialing');
  check("'active' → 'active'", mapStripeStatus('active') === 'active');
  check("'past_due' → 'past_due'", mapStripeStatus('past_due') === 'past_due');
  check("'unpaid' → 'past_due' (REGRESSION GUARD — must collapse to past_due)",
    mapStripeStatus('unpaid') === 'past_due',
    'audit: collapsing unpaid to past_due is the intentional UX — if this changes, the "needs payment" banner stops firing on unpaid');
  check("'canceled' → 'canceled'", mapStripeStatus('canceled') === 'canceled');
  check("'incomplete' → 'inactive'", mapStripeStatus('incomplete') === 'inactive');
  check("'incomplete_expired' → 'inactive'", mapStripeStatus('incomplete_expired') === 'inactive');
  check("'paused' → 'inactive'", mapStripeStatus('paused') === 'inactive');
  check('undefined → inactive (safe default)', mapStripeStatus(undefined) === 'inactive');
  check('unknown status → inactive (safe default)', mapStripeStatus('bogus_status') === 'inactive');
}

// ════════════════════════════════════════════════════════════════════
//  extractPlan
// ════════════════════════════════════════════════════════════════════
section('extractPlan — msos_plan metadata → Plan');
{
  check("metadata 'pro' → 'pro'",
    extractPlan(makeStripeDoc({ price: { product: { metadata: { msos_plan: 'pro' } } } })) === 'pro');
  check("metadata 'core' → 'core'",
    extractPlan(makeStripeDoc({ price: { product: { metadata: { msos_plan: 'core' } } } })) === 'core');
  check('missing metadata → defaults to pro',
    extractPlan(makeStripeDoc({ price: { product: { metadata: undefined } } } as unknown as StripeSubscriptionDoc)) === 'pro');
  check('bogus metadata → defaults to pro',
    extractPlan(makeStripeDoc({ price: { product: { metadata: { msos_plan: 'unknown' as Plan } } } })) === 'pro');
}

// ════════════════════════════════════════════════════════════════════
//  pickPrimary — priority sort
// ════════════════════════════════════════════════════════════════════
section('pickPrimary — priority sort');
{
  check('empty list → null', pickPrimary([]) === null);
  check('single active → that doc',
    pickPrimary([makeStripeDoc({ status: 'active' })])?.status === 'active');
  check('active beats trialing',
    pickPrimary([
      makeStripeDoc({ status: 'trialing' }),
      makeStripeDoc({ status: 'active' }),
    ])?.status === 'active');
  check('trialing beats past_due',
    pickPrimary([
      makeStripeDoc({ status: 'past_due' }),
      makeStripeDoc({ status: 'trialing' }),
    ])?.status === 'trialing');
  check('past_due beats unpaid',
    pickPrimary([
      makeStripeDoc({ status: 'unpaid' }),
      makeStripeDoc({ status: 'past_due' }),
    ])?.status === 'past_due');
  check('canceled beats incomplete',
    pickPrimary([
      makeStripeDoc({ status: 'incomplete' }),
      makeStripeDoc({ status: 'canceled' }),
    ])?.status === 'canceled');
  check('unknown status falls to lowest priority',
    pickPrimary([
      makeStripeDoc({ status: 'made_up_status' }),
      makeStripeDoc({ status: 'incomplete' }),
    ])?.status === 'incomplete');
}

section('pickPrimary — current_period_end tiebreaker (same priority bucket)');
{
  const newer = makeStripeDoc({ status: 'active', current_period_end: ts(2_000_000) });
  const older = makeStripeDoc({ status: 'active', current_period_end: ts(1_000_000) });
  check('most-recent current_period_end wins',
    pickPrimary([older, newer])?.current_period_end?.toMillis() === 2_000_000);
  check('reversed input order, still picks newer',
    pickPrimary([newer, older])?.current_period_end?.toMillis() === 2_000_000);
  check('null period_end → 0, loses to any positive',
    pickPrimary([
      makeStripeDoc({ status: 'active', current_period_end: null }),
      makeStripeDoc({ status: 'active', current_period_end: ts(1) }),
    ])?.current_period_end?.toMillis() === 1);
}

// ════════════════════════════════════════════════════════════════════
//  resolvePlan — settings → AccessTier
// ════════════════════════════════════════════════════════════════════
section('resolvePlan — settings → AccessTier');
{
  check('billingExempt:true → pro (regardless of plan field)',
    resolvePlan(makeSettings({ billingExempt: true, plan: 'core' })) === 'pro');
  check('plan:pro + active → pro',
    resolvePlan(makeSettings({ plan: 'pro', subscriptionStatus: 'active' })) === 'pro');
  check('plan:pro + trialing → pro',
    resolvePlan(makeSettings({ plan: 'pro', subscriptionStatus: 'trialing' })) === 'pro');
  check('plan:core + active → core',
    resolvePlan(makeSettings({ plan: 'core', subscriptionStatus: 'active' })) === 'core');
  check('null settings → core (safe default)',
    resolvePlan(null) === 'core');
  check('undefined settings → core (safe default)',
    resolvePlan(undefined) === 'core');
  check('plan:pro + canceled → pro (plan field takes precedence; the canceled status governs renewal UI, not plan tier)',
    resolvePlan(makeSettings({ plan: 'pro', subscriptionStatus: 'canceled' })) === 'pro');
  check('plan:core + canceled → core',
    resolvePlan(makeSettings({ plan: 'core', subscriptionStatus: 'canceled' })) === 'core');
  check('plan:core + trialing → pro (trial overrides plan field)',
    resolvePlan(makeSettings({ plan: 'core', subscriptionStatus: 'trialing' })) === 'pro');
}

// ════════════════════════════════════════════════════════════════════
//  isBillingExempt
// ════════════════════════════════════════════════════════════════════
section('isBillingExempt — per-account exemption');
{
  check('billingExempt:true → exempt',
    isBillingExempt(makeSettings({ billingExempt: true })));
  check('billingExempt:false → not exempt',
    isBillingExempt(makeSettings({ billingExempt: false })) === false);
  check('billingExempt:undefined → not exempt',
    isBillingExempt(makeSettings({})) === false);
  check('null settings → not exempt',
    isBillingExempt(null) === false);
  check('billingExempt:true → resolvePlan === pro (cross-check)',
    resolvePlan(makeSettings({ billingExempt: true })) === 'pro');
}

// ════════════════════════════════════════════════════════════════════
//  hasActiveSubscription
// ════════════════════════════════════════════════════════════════════
section('hasActiveSubscription');
{
  check("status 'active' → true",
    hasActiveSubscription(makeSettings({ subscriptionStatus: 'active' })));
  check("status 'trialing' → true (trial is active)",
    hasActiveSubscription(makeSettings({ subscriptionStatus: 'trialing' })));
  check("billingExempt:true → true (exempt → always active)",
    hasActiveSubscription(makeSettings({ billingExempt: true, subscriptionStatus: 'inactive' })));
  check("status 'canceled' → false",
    hasActiveSubscription(makeSettings({ subscriptionStatus: 'canceled' })) === false);
  check("status 'past_due' → true (has payment method, just needs update)",
    hasActiveSubscription(makeSettings({ subscriptionStatus: 'past_due' })) === true);
  check("status 'inactive' → false",
    hasActiveSubscription(makeSettings({ subscriptionStatus: 'inactive' })) === false);
  check('null settings → false',
    hasActiveSubscription(null) === false);
}

// ════════════════════════════════════════════════════════════════════
//  planLiteralIsPro
// ════════════════════════════════════════════════════════════════════
section('planLiteralIsPro');
{
  check("'pro' → true", planLiteralIsPro('pro'));
  check("'core' → false", planLiteralIsPro('core') === false);
  check('null → false', planLiteralIsPro(null) === false);
  check('undefined → false', planLiteralIsPro(undefined) === false);
}

// ════════════════════════════════════════════════════════════════════
//  sanitizeSubscriptionWrite — strips locked fields from client writes
// ════════════════════════════════════════════════════════════════════
section('sanitizeSubscriptionWrite — prevents Stripe state from demoting exempt accounts');
{
  // The sanitizer strips the 4 Stripe-state fields
  // (plan, subscriptionStatus, trialStartedAt, trialEndsAt) when the
  // CURRENT settings doc is billing-exempt. Purpose: a Stripe webhook
  // event (or the client mirror) cannot accidentally write
  // plan='core' / subscriptionStatus='canceled' onto an exempt
  // (lifetime / founder) account. Other locked fields (billingExempt,
  // referralCreditsMonths, etc.) are defended by Firestore rules, not
  // by this client-side helper.

  const exemptCurrent = makeSettings({ billingExempt: true });
  const nonExemptCurrent = makeSettings({ billingExempt: false });

  const stripeUpdate = {
    plan: 'core',
    subscriptionStatus: 'canceled',
    trialStartedAt: '2026-01-01',
    trialEndsAt: '2026-01-31',
    stripeSubscriptionId: 'sub_legit',
  };

  const sanitizedExempt = sanitizeSubscriptionWrite(exemptCurrent, stripeUpdate);
  check('exempt + strips plan', !('plan' in sanitizedExempt));
  check('exempt + strips subscriptionStatus', !('subscriptionStatus' in sanitizedExempt));
  check('exempt + strips trialStartedAt', !('trialStartedAt' in sanitizedExempt));
  check('exempt + strips trialEndsAt', !('trialEndsAt' in sanitizedExempt));
  check('exempt + preserves stripeSubscriptionId (not a protected field)',
    sanitizedExempt.stripeSubscriptionId === 'sub_legit');

  const passedThrough = sanitizeSubscriptionWrite(nonExemptCurrent, stripeUpdate);
  check('non-exempt → passthrough (plan + status flow through normally)',
    passedThrough.plan === 'core' && passedThrough.subscriptionStatus === 'canceled');
  check('non-exempt → trial fields flow through',
    passedThrough.trialStartedAt === '2026-01-01');

  // Regression — input must NOT be mutated.
  check('input object not mutated',
    'plan' in stripeUpdate && stripeUpdate.plan === 'core');
}

section('GROWTH MODE ON — billing globally bypassed (app is free)');
{
  __setGrowthModeForTests(true);
  check('any account resolves to Pro', resolvePlan(makeSettings({ plan: 'core', subscriptionStatus: 'canceled' })) === 'pro');
  check('non-exempt account treated as billing-exempt', isBillingExempt(makeSettings({ billingExempt: false })) === true);
  check('canceled account reports active subscription', hasActiveSubscription(makeSettings({ subscriptionStatus: 'canceled' })) === true);
  __setGrowthModeForTests(null); // restore the build-time default
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
