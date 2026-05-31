// ─────────────────────────────────────────────────────────────────────
//  referralCounter — pure helper for the referral-reward counter
//  increment decision.
//
//  Hotfix (2026-05-31, audit P1): on every successful referral,
//  `referralCreditsMonths` on the referrer's settings/main was being
//  incremented TWICE — once by onSubscriptionWrite directly, once
//  by onReferralStatusChanged via its idempotency check.
//
//  Root cause: the trigger's `_counterIncremented` marker was meant to
//  serialize the two paths, but onSubscriptionWrite never stamped the
//  marker in the same Firestore update where it transitioned status →
//  'rewarded'. The trigger fired, saw no marker, incremented, then
//  onSubscriptionWrite incremented again.
//
//  The fix:
//    1. onSubscriptionWrite stamps `_counterIncremented: true` in the
//       same .update() where it sets status:'rewarded'. The trigger
//       sees the marker (now part of the after-snapshot) and skips.
//    2. This helper centralises the trigger's "should I increment?"
//       decision so it's unit-testable from the main project's tsx
//       test runner without spinning up the Functions emulator.
//
//  Contract: the trigger should call shouldIncrementReferralCounter()
//  with the previous status, next status, and current marker state.
//  Increment only when it returns true.
// ─────────────────────────────────────────────────────────────────────

export interface CounterIncrementInput {
  /** Previous status from the trigger's `before` snapshot. */
  prevStatus: string | undefined;
  /** Current status from the trigger's `after` snapshot. */
  nextStatus: string;
  /** Whether `_counterIncremented` is true on the after snapshot. */
  markerSet: boolean;
}

export function shouldIncrementReferralCounter(
  input: CounterIncrementInput
): boolean {
  // Only the pending → rewarded transition warrants an increment.
  if (input.nextStatus !== 'rewarded') return false;
  // Idempotent: if we already moved through 'rewarded' before
  // (e.g. status was bumped to 'rewarded' twice via separate updates),
  // skip.
  if (input.prevStatus === 'rewarded') return false;
  // Idempotent: if onSubscriptionWrite already stamped the marker as
  // part of its status transition (the canonical path), skip — the
  // counter increment was its responsibility, not ours.
  if (input.markerSet) return false;
  return true;
}
