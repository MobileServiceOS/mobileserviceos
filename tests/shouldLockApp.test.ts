// tests/shouldLockApp.test.ts
// Run: npx tsx tests/shouldLockApp.test.ts
//
// Covers the hard-paywall gate. The lock decision drives whether the
// PaywallLockout component replaces the entire app — getting this
// wrong either traps paying customers behind a paywall they don't owe,
// or hands the app away to expired-trial users. Both outcomes are
// real-money bugs, so the coverage here is deliberately exhaustive.

import { shouldLockApp, isExistingCustomer, EXISTING_CUSTOMER_CUTOFF_ISO } from '@/lib/planAccess';
import { __setGrowthModeForTests } from '@/lib/growthMode';
import type { Settings } from '@/types';

// This suite verifies the billing-ENFORCEMENT logic — the lock decisions
// that re-engage when the early-access GROWTH_MODE master switch is off.
// The app currently ships with GROWTH_MODE on (free for everyone), which
// globally bypasses these locks, so force the override off here to keep
// exercising the dormant enforcement paths. A dedicated block at the end
// asserts the growth-mode-ON (free) behavior explicitly.
__setGrowthModeForTests(false);

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const futureIso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const pastIso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

console.log('\n┌─ Safety: no settings / loading state ──────────');
check('null settings → NOT locked (loading state)',
  shouldLockApp(null) === false);
check('undefined settings → NOT locked',
  shouldLockApp(undefined) === false);

console.log('\n┌─ Billing-exempt accounts (Wheel Rush) ─────────');
check('billingExempt: true → NEVER locked, even with no subscription',
  shouldLockApp({ billingExempt: true } as Settings) === false);
check('billingExempt + canceled subscription → still NOT locked',
  shouldLockApp({ billingExempt: true, subscriptionStatus: 'canceled' } as Settings) === false);

console.log('\n┌─ Active paying subscribers ────────────────────');
check('subscriptionStatus active → NOT locked',
  shouldLockApp({ subscriptionStatus: 'active' } as Settings) === false);

console.log('\n┌─ Trial in window — unlocked ───────────────────');
check('trialing + trialEndsAt 7 days out → NOT locked',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: futureIso(7 * DAY),
  } as Settings) === false);
check('trialing + trialEndsAt 30 seconds out → NOT locked',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: futureIso(30_000),
  } as Settings) === false);
check('trialing + missing trialEndsAt → NOT locked (safer default)',
  shouldLockApp({
    subscriptionStatus: 'trialing',
  } as Settings) === false);

console.log('\n┌─ Trial expired — LOCKED ───────────────────────');
check('trialing + trialEndsAt 1 day in past → LOCKED',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: pastIso(DAY),
  } as Settings) === true);
check('trialing + trialEndsAt 1 minute in past → LOCKED',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: pastIso(MIN),
  } as Settings) === true);

console.log('\n┌─ Non-active / non-trialing states — LOCKED ────');
check('past_due → LOCKED',
  shouldLockApp({ subscriptionStatus: 'past_due' } as Settings) === true);
check('canceled → LOCKED',
  shouldLockApp({ subscriptionStatus: 'canceled' } as Settings) === true);
check('inactive → LOCKED',
  shouldLockApp({ subscriptionStatus: 'inactive' } as Settings) === true);
check('no subscriptionStatus at all → LOCKED (pre-paywall account must subscribe)',
  shouldLockApp({} as Settings) === true);

console.log('\n┌─ Date-shape resilience ────────────────────────');
check('trialEndsAt as a Date object in the future → NOT locked',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: new Date(Date.now() + 5 * DAY),
  } as Settings) === false);
check('trialEndsAt as a Date object in the past → LOCKED',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: new Date(Date.now() - DAY),
  } as Settings) === true);
check('trialEndsAt as Firestore Timestamp-shape (toMillis) future → NOT locked',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: { toMillis: () => Date.now() + 2 * DAY } as unknown as Settings['trialEndsAt'],
  } as Settings) === false);
check('trialEndsAt as Firestore Timestamp-shape (toMillis) past → LOCKED',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: { toMillis: () => Date.now() - DAY } as unknown as Settings['trialEndsAt'],
  } as Settings) === true);
check('garbage trialEndsAt string + trialing → NOT locked (safer default)',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialEndsAt: 'not-a-date' as unknown as Settings['trialEndsAt'],
  } as Settings) === false);

console.log('\n┌─ Realistic scenarios ──────────────────────────');
// Wheel Rush — the founder account.
check('Wheel Rush exempt + canceled subscription override → unlocked',
  shouldLockApp({
    billingExempt: true,
    subscriptionStatus: 'canceled',
    subscriptionOverride: 'lifetime',
  } as Settings) === false);
// Fresh signup right after Onboarding stamps the trial.
check('Brand-new signup (just stamped trialing, 14 days out) → unlocked',
  shouldLockApp({
    subscriptionStatus: 'trialing',
    trialStartedAt: new Date().toISOString(),
    trialEndsAt: futureIso(14 * DAY),
  } as Settings) === false);
// Pre-paywall account that never trialed (existed before today's flip).
check('Pre-paywall account, no trial, no subscription → LOCKED',
  shouldLockApp({
    plan: undefined,
    subscriptionStatus: undefined,
    trialEndsAt: undefined,
  } as Settings) === true);
// User who paid then canceled mid-cycle.
check('Paid subscriber who canceled (status canceled) → LOCKED',
  shouldLockApp({
    subscriptionStatus: 'canceled',
    plan: 'pro',
  } as Settings) === true);

console.log('\n┌─ Existing-customer grandfather (pre-paywall) ──');
const preCutoffIso = '2026-05-14T03:19:04.261Z';     // Wheel Rush onboarding date
const postCutoffIso = '2026-05-28T08:19:00Z';        // Day-of-flip test signup
check('isExistingCustomer with pre-cutoff onboarding → true',
  isExistingCustomer({ onboardingCompletedAt: preCutoffIso } as Settings) === true);
check('isExistingCustomer with post-cutoff onboarding → false',
  isExistingCustomer({ onboardingCompletedAt: postCutoffIso } as Settings) === false);
check('isExistingCustomer with no onboardingCompletedAt → false',
  isExistingCustomer({} as Settings) === false);
check('isExistingCustomer with null settings → false',
  isExistingCustomer(null) === false);
check('cutoff constant matches paywall flip moment',
  EXISTING_CUSTOMER_CUTOFF_ISO === '2026-05-28T00:00:00Z');

check('pre-cutoff signup, no subscriptionStatus → NOT locked (grandfathered)',
  shouldLockApp({
    onboardingCompletedAt: preCutoffIso,
  } as Settings) === false);
check('pre-cutoff signup, canceled status → STILL locked (status wins over grandfather)',
  shouldLockApp({
    onboardingCompletedAt: preCutoffIso,
    subscriptionStatus: 'canceled',
  } as Settings) === true);
check('post-cutoff signup, no subscriptionStatus → LOCKED (must subscribe)',
  shouldLockApp({
    onboardingCompletedAt: postCutoffIso,
  } as Settings) === true);
check('pre-cutoff signup with stamped trialing (post-migration) → unlocked',
  shouldLockApp({
    onboardingCompletedAt: preCutoffIso,
    subscriptionStatus: 'trialing',
    trialEndsAt: futureIso(10 * DAY),
  } as Settings) === false);

console.log('\n┌─ Growth mode ON → app is free (every lock bypassed) ──');
__setGrowthModeForTests(true);
check('growth on: expired trial → NOT locked',
  shouldLockApp({ subscriptionStatus: 'trialing', trialEndsAt: pastIso(DAY) } as Settings) === false);
check('growth on: canceled → NOT locked',
  shouldLockApp({ subscriptionStatus: 'canceled' } as Settings) === false);
check('growth on: past_due → NOT locked',
  shouldLockApp({ subscriptionStatus: 'past_due' } as Settings) === false);
check('growth on: no subscription at all → NOT locked',
  shouldLockApp({} as Settings) === false);
check('growth on: post-cutoff signup, no status → NOT locked',
  shouldLockApp({ onboardingCompletedAt: postCutoffIso } as Settings) === false);
__setGrowthModeForTests(null); // restore the build-time default

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
