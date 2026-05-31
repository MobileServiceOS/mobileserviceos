// tests/referralCounter.test.ts
// Run: npx tsx tests/referralCounter.test.ts
//
// Hotfix #3 (2026-05-31, audit P1): referralCreditsMonths was being
// incremented twice on every successful referral — once by
// onSubscriptionWrite.applyReferralReward(), once by the trigger
// onReferralStatusChanged.
//
// Two protections:
//   (A) Unit-test shouldIncrementReferralCounter() to pin the
//       decision contract.
//   (B) Source-content assertion that onSubscriptionWrite still
//       stamps the `_counterIncremented: true` marker in the same
//       update where it sets status: 'rewarded'. If anyone removes
//       that stamp, the trigger's defensive branch will fire in
//       parallel and the bug returns.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldIncrementReferralCounter } from '../functions/src/lib/referralCounter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

// ────────── A — pure helper contract ──────────

section('shouldIncrementReferralCounter — increments');
{
  check(
    'pending → rewarded, marker absent → INCREMENT',
    shouldIncrementReferralCounter({ prevStatus: 'pending', nextStatus: 'rewarded', markerSet: false })
  );
  check(
    'converted → rewarded, marker absent → INCREMENT',
    shouldIncrementReferralCounter({ prevStatus: 'converted', nextStatus: 'rewarded', markerSet: false })
  );
  check(
    'undefined prev → rewarded, marker absent → INCREMENT (admin-manual reward path)',
    shouldIncrementReferralCounter({ prevStatus: undefined, nextStatus: 'rewarded', markerSet: false })
  );
}

section('shouldIncrementReferralCounter — DOES NOT increment');
{
  check(
    'pending → rewarded, marker SET → SKIP (onSubscriptionWrite already did the work)',
    shouldIncrementReferralCounter({ prevStatus: 'pending', nextStatus: 'rewarded', markerSet: true }) === false,
    'audit P1 regression — trigger now double-increments'
  );
  check(
    'rewarded → rewarded → SKIP (no transition)',
    shouldIncrementReferralCounter({ prevStatus: 'rewarded', nextStatus: 'rewarded', markerSet: false }) === false
  );
  check(
    'pending → converted → SKIP (not the target transition)',
    shouldIncrementReferralCounter({ prevStatus: 'pending', nextStatus: 'converted', markerSet: false }) === false
  );
  check(
    'pending → cancelled → SKIP',
    shouldIncrementReferralCounter({ prevStatus: 'pending', nextStatus: 'cancelled', markerSet: false }) === false
  );
  check(
    'rewarded → cancelled → SKIP (claw-back is handled elsewhere)',
    shouldIncrementReferralCounter({ prevStatus: 'rewarded', nextStatus: 'cancelled', markerSet: false }) === false
  );
  check(
    'rewarded → rewarded with marker SET → SKIP',
    shouldIncrementReferralCounter({ prevStatus: 'rewarded', nextStatus: 'rewarded', markerSet: true }) === false
  );
}

// ────────── B — source-content regression assertion ──────────

section('onSubscriptionWrite source contract');
{
  const oswPath = resolve(repoRoot, 'functions/src/onSubscriptionWrite.ts');
  const osw = readFileSync(oswPath, 'utf-8');

  // Find the .update() call that sets status: 'rewarded' and assert
  // it also includes the marker. We use a tolerant match: anywhere in
  // the file, look for an update with both `status: 'rewarded'` and
  // `_counterIncremented: true`. If either token is missing the
  // double-increment bug returns.
  const hasStatusRewardedUpdate = /status:\s*['"]rewarded['"]/.test(osw);
  check(
    "onSubscriptionWrite sets status: 'rewarded' somewhere",
    hasStatusRewardedUpdate,
    'file may have been restructured — update this regression test'
  );
  check(
    'onSubscriptionWrite stamps _counterIncremented: true',
    /_counterIncremented:\s*true/.test(osw),
    "audit P1 regression — onSubscriptionWrite no longer stamps the marker; the firestoreTriggers' defensive branch will double-increment referralCreditsMonths"
  );

  // The marker should appear in the SAME update block as the status
  // transition. We locate the update block and check it contains both.
  const updateBlocks = osw.match(/\.update\(\{[\s\S]*?\}\)/g) ?? [];
  const rewardedUpdate = updateBlocks.find((b) => /status:\s*['"]rewarded['"]/.test(b));
  check(
    "rewarded-status update block exists",
    rewardedUpdate !== undefined
  );
  if (rewardedUpdate) {
    check(
      'marker is stamped in the SAME update as status: rewarded',
      /_counterIncremented:\s*true/.test(rewardedUpdate),
      "marker is in a different update — there's a race window where the trigger fires after the status update but before the marker write"
    );
  }
}

section('firestoreTriggers source contract');
{
  const ftPath = resolve(repoRoot, 'functions/src/firestoreTriggers.ts');
  const ft = readFileSync(ftPath, 'utf-8');

  check(
    'firestoreTriggers imports shouldIncrementReferralCounter',
    /shouldIncrementReferralCounter/.test(ft),
    'trigger no longer uses the typed helper — silent reintroduction of inline decision logic'
  );
  check(
    'firestoreTriggers still increments the counter (defensive path retained)',
    /referralCreditsMonths:\s*admin\.firestore\.FieldValue\.increment\(1\)/.test(ft),
    'defensive increment removed — admin-manual rewards now silently fail to bump the counter'
  );
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
