// tests/shouldLockApp.test.ts
// Run: npx tsx tests/shouldLockApp.test.ts
//
// FREE-TIER MODEL (2026-06): the hard full-app paywall was removed. Every
// account keeps full use of the free surface; advanced features gate
// individually (see tests/planGating.test.ts for isPaid/requiresUpgrade).
// shouldLockApp is now a no-op that ALWAYS returns false — this suite
// pins that so a future change can't silently re-introduce a wall that
// traps free/expired-trial users out of the whole app.

import { shouldLockApp, isExistingCustomer, EXISTING_CUSTOMER_CUTOFF_ISO } from '@/lib/planAccess';
import { __setGrowthModeForTests } from '@/lib/growthMode';
import type { Settings } from '@/types';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const pastIso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const DAY = 24 * 60 * 60 * 1000;

console.log('\n┌─ Free-tier model: shouldLockApp NEVER locks (growth OFF) ──');
__setGrowthModeForTests(false);
check('null settings → not locked', shouldLockApp(null) === false);
check('undefined settings → not locked', shouldLockApp(undefined) === false);
check('active → not locked', shouldLockApp({ subscriptionStatus: 'active' } as Settings) === false);
check('expired trial → not locked (drops to Free, no wall)',
  shouldLockApp({ subscriptionStatus: 'trialing', trialEndsAt: pastIso(DAY) } as Settings) === false);
check('canceled → not locked (Free tier, not a wall)',
  shouldLockApp({ subscriptionStatus: 'canceled' } as Settings) === false);
check('past_due → not locked', shouldLockApp({ subscriptionStatus: 'past_due' } as Settings) === false);
check('no subscription at all → not locked (free tier)', shouldLockApp({} as Settings) === false);

console.log('\n┌─ Growth mode ON → still never locks ───────────');
__setGrowthModeForTests(true);
check('growth on: expired trial → not locked',
  shouldLockApp({ subscriptionStatus: 'trialing', trialEndsAt: pastIso(DAY) } as Settings) === false);
check('growth on: canceled → not locked',
  shouldLockApp({ subscriptionStatus: 'canceled' } as Settings) === false);
__setGrowthModeForTests(null); // restore build-time default

console.log('\n┌─ isExistingCustomer (pre-paywall grandfather) ─');
const preCutoffIso = '2026-05-14T03:19:04.261Z';
const postCutoffIso = '2026-05-28T08:19:00Z';
check('pre-cutoff onboarding → true',
  isExistingCustomer({ onboardingCompletedAt: preCutoffIso } as Settings) === true);
check('post-cutoff onboarding → false',
  isExistingCustomer({ onboardingCompletedAt: postCutoffIso } as Settings) === false);
check('no onboardingCompletedAt → false', isExistingCustomer({} as Settings) === false);
check('null settings → false', isExistingCustomer(null) === false);
check('cutoff constant unchanged', EXISTING_CUSTOMER_CUTOFF_ISO === '2026-05-28T00:00:00Z');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
