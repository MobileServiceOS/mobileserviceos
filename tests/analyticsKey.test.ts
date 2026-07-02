// tests/analyticsKey.test.ts
// Run: npx tsx tests/analyticsKey.test.ts
//
// The Firestore counter key builder for the first-party analytics tracker.
// Must be stable + sanitized (keys become map field names).

import { analyticsKey } from '@/lib/analytics';

let passed = 0, failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

check('event only', analyticsKey('job_logged') === 'job_logged');
check('event + detail joined with __', analyticsKey('locked_feature_viewed', 'payouts') === 'locked_feature_viewed__payouts');
check('detail is sanitized (drops special chars)', analyticsKey('checkout_started', 'pro-plan!') === 'checkout_started__proplan');
check('empty/whitespace detail → event only', analyticsKey('job_logged', '') === 'job_logged');
check('all-special detail → event only', analyticsKey('signup_completed', '!!!') === 'signup_completed');
check('long detail is truncated to <= 48', analyticsKey('locked_feature_viewed', 'a'.repeat(80)).length <= 'locked_feature_viewed__'.length + 48);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
