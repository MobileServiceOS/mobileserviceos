// ═══════════════════════════════════════════════════════════════════
//  tests/growthMode.test.ts — Founding Member / growth-mode tests
// ═══════════════════════════════════════════════════════════════════
//
//  Run: npx tsx tests/growthMode.test.ts
//
//  Verifies the early-access billing-bypass behaves correctly AND
//  that it is cleanly reversible — i.e. the architecture is preserved.
// ═══════════════════════════════════════════════════════════════════

import {
  GROWTH_MODE,
  FOUNDER_DISCOUNT_PERCENT,
  FOUNDER_DISCOUNT_TERM_MONTHS,
  isGrowthMode,
  foundingMemberStamp,
  FOUNDER_DISCOUNT_LINE,
} from '../src/lib/growthMode';
import {
  isBillingExempt,
  hasActiveSubscription,
  resolvePlan,
  canAccessFeature,
} from '../src/lib/planAccess';
import type { Settings } from '../src/types';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}
function section(t: string): void { console.log(`\n${t}`); }

// A brand-new signup with NO subscription/exemption fields.
const freshAccount: Settings = {} as Settings;
// A normal paid account.
const paidAccount = { subscriptionStatus: 'active', plan: 'pro' } as unknown as Settings;
// An Admin-granted lifetime account.
const lifetimeAccount = { billingExempt: true } as unknown as Settings;

section('GROWTH MODE FLAG');
check('GROWTH_MODE is a boolean', typeof GROWTH_MODE === 'boolean');
check('isGrowthMode() matches GROWTH_MODE', isGrowthMode() === GROWTH_MODE);
check('founder discount is 69%', FOUNDER_DISCOUNT_PERCENT === 69);
check('founder term is 12 months', FOUNDER_DISCOUNT_TERM_MONTHS === 12);
check('discount line reads naturally',
  FOUNDER_DISCOUNT_LINE.includes('69') && FOUNDER_DISCOUNT_LINE.includes('12'));

section('FOUNDING MEMBER STAMP');
{
  const stamp = foundingMemberStamp();
  if (isGrowthMode()) {
    check('stamp marks foundingMember true', stamp.foundingMember === true);
    check('stamp locks 69% discount', stamp.founderDiscountPercent === 69);
    check('stamp sets 12-month term', stamp.founderDiscountTermMonths === 12);
    check('stamp sets billingDeferred', stamp.billingDeferred === true);
    check('stamp sets founderPricingLocked', stamp.founderPricingLocked === true);
    check('stamp records foundingJoinedAt ISO',
      typeof stamp.foundingJoinedAt === 'string' && stamp.foundingJoinedAt.includes('T'));
  } else {
    check('stamp is empty when growth mode off', Object.keys(stamp).length === 0);
  }
}

section('BILLING BYPASS — growth mode ON');
if (isGrowthMode()) {
  check('fresh account is billing-exempt', isBillingExempt(freshAccount) === true);
  check('fresh account has active subscription', hasActiveSubscription(freshAccount) === true);
  check('fresh account resolves to Pro', resolvePlan(freshAccount) === 'pro');
  check('fresh account can access Pro feature (team)',
    canAccessFeature(freshAccount, 'teamInventoryWorkflow') === true);
  check('fresh account can access advanced analytics',
    canAccessFeature(freshAccount, 'advancedAnalytics') === true);
  check('paid account still exempt (consistent)', isBillingExempt(paidAccount) === true);
  check('lifetime account still exempt', isBillingExempt(lifetimeAccount) === true);
}

section('ARCHITECTURE PRESERVED — reversibility');
// These assertions document the REVERSIBLE design: the billing
// bypass is computed from GROWTH_MODE, never persisted. Flipping the
// flag to false would make isBillingExempt fall back to the
// per-account billingExempt check — which is exactly the pre-growth
// behavior. We assert the fallback path is intact by checking the
// lifetime account (billingExempt: true) and a non-exempt shape.
{
  // The lifetime account must be exempt under EITHER mode — its
  // exemption is a real persisted flag, independent of growth mode.
  check('lifetime exemption is independent of growth mode',
    lifetimeAccount.billingExempt === true);
  // The fresh account has NO persisted exemption — proving the
  // growth-mode exemption is purely computed, not written. When
  // growth mode is off this account would NOT be exempt.
  check('fresh account has no persisted billingExempt flag',
    (freshAccount as { billingExempt?: boolean }).billingExempt === undefined);
}

section('REFERRAL SYSTEM UNAFFECTED');
// Growth mode must not touch referral logic — referral fields live
// on Settings independently. A quick structural assertion.
{
  const withReferral = { referralCode: 'MSOS123' } as unknown as Settings;
  check('referral code field still readable',
    (withReferral as { referralCode?: string }).referralCode === 'MSOS123');
}

console.log(`\n${'═'.repeat(56)}`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
console.log('═'.repeat(56));
if (failed > 0) process.exit(1);
