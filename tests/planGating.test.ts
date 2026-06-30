// tests/planGating.test.ts
// Run: npx tsx tests/planGating.test.ts
//
// Free + Paid ($35/mo) feature gating. Verifies isPaid()/requiresUpgrade()
// across the four states that matter: free (locked), paid (unlocked),
// trial-in-window (unlocked), and trial-expired (gracefully → free,
// re-locked). Growth-mode ON must unlock everything (staged rollout).

import { isPaid, requiresUpgrade, isInTrial, trialDaysRemaining, type PaidFeature } from '@/lib/planAccess';
import { __setGrowthModeForTests } from '@/lib/growthMode';
import type { Settings } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
const futureIso = (ms: number) => new Date(Date.now() + ms).toISOString();
const pastIso = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;
const FEATURES: PaidFeature[] = ['insightsDashboard', 'payouts', 'bulkInventoryUpload', 'teamManagement', 'brandedInvoices'];

// Exercise real enforcement: force growth OFF for the core matrix.
__setGrowthModeForTests(false);

console.log('\n┌─ Free tier — everything locked ────────────────');
const free = {} as Settings;
check('isPaid(free) === false', isPaid(free) === false);
check('all paid features require upgrade for free', FEATURES.every((f) => requiresUpgrade(free, f) === true));
check('canceled === free (locked)', isPaid({ subscriptionStatus: 'canceled' } as Settings) === false);
check('past_due === free (locked)', isPaid({ subscriptionStatus: 'past_due' } as Settings) === false);

console.log('\n┌─ Paid (active) — everything unlocked ──────────');
const paid = { subscriptionStatus: 'active', plan: 'pro' } as Settings;
check('isPaid(active) === true', isPaid(paid) === true);
check('no paid feature requires upgrade', FEATURES.every((f) => requiresUpgrade(paid, f) === false));

console.log('\n┌─ Billing-exempt (founder) — unlocked ──────────');
check('isPaid(exempt) === true', isPaid({ billingExempt: true } as Settings) === true);

console.log('\n┌─ Trial in window — unlocked ───────────────────');
const trial = { subscriptionStatus: 'trialing', trialEndsAt: futureIso(7 * DAY) } as Settings;
check('isPaid(trial-in-window) === true', isPaid(trial) === true);
check('isInTrial === true', isInTrial(trial) === true);
check('trialDaysRemaining ~7', trialDaysRemaining(trial) === 7);
check('missing trialEndsAt → treated as in-trial', isPaid({ subscriptionStatus: 'trialing' } as Settings) === true);

console.log('\n┌─ Trial expired — gracefully drops to Free ─────');
const expired = { subscriptionStatus: 'trialing', trialEndsAt: pastIso(DAY) } as Settings;
check('isPaid(expired trial) === false', isPaid(expired) === false);
check('isInTrial(expired) === false', isInTrial(expired) === false);
check('trialDaysRemaining(expired) === 0', trialDaysRemaining(expired) === 0);
check('expired trial re-locks features', FEATURES.every((f) => requiresUpgrade(expired, f) === true));

console.log('\n┌─ Growth mode ON — staged: everything free/unlocked ──');
__setGrowthModeForTests(true);
check('growth on: isPaid(free) === true', isPaid({} as Settings) === true);
check('growth on: nothing requires upgrade', FEATURES.every((f) => requiresUpgrade({} as Settings, f) === false));
__setGrowthModeForTests(null);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
