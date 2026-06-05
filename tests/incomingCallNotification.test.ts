// ═══════════════════════════════════════════════════════════════════
//  tests/incomingCallNotification.test.ts
//  Run: npx tsx tests/incomingCallNotification.test.ts
//
//  Pure logic tests for the IncomingCallNotification badge thresholds
//  and the should-show filter.
// ═══════════════════════════════════════════════════════════════════

import { computeBadgeState, shouldShowLead } from '../src/components/IncomingCallNotification';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── badge thresholds ──');
{
  check('0 jobs: no badges',
    !computeBadgeState(0).isRepeat && !computeBadgeState(0).isVIP);
  check('1 job: no badges',
    !computeBadgeState(1).isRepeat && !computeBadgeState(1).isVIP);
  check('2 jobs: no badges (Repeat threshold is 3)',
    !computeBadgeState(2).isRepeat && !computeBadgeState(2).isVIP);
  check('3 jobs: Repeat only',
    computeBadgeState(3).isRepeat && !computeBadgeState(3).isVIP);
  check('9 jobs: Repeat only',
    computeBadgeState(9).isRepeat && !computeBadgeState(9).isVIP);
  check('10 jobs: VIP only (Repeat falls off)',
    !computeBadgeState(10).isRepeat && computeBadgeState(10).isVIP);
  check('25 jobs: VIP only',
    !computeBadgeState(25).isRepeat && computeBadgeState(25).isVIP);
}

console.log('\n── shouldShowLead filters ──');
{
  const mountMs = 1_000_000;
  const okLead = { id: 'lead-3055551234-2026-06-05', source: 'missed_call' as const };

  check('null lead: false',
    !shouldShowLead(null, mountMs, mountMs + 1));
  check('inbound_sms source: false',
    !shouldShowLead({ id: 'lead-x', source: 'inbound_sms' as const }, mountMs, mountMs + 1));
  check('manual source: false',
    !shouldShowLead({ id: 'lead-x', source: 'manual' as const }, mountMs, mountMs + 1));
  check('test lead: false (lead-test- prefix)',
    !shouldShowLead({ id: 'lead-test-uid-1234', source: 'missed_call' as const }, mountMs, mountMs + 1));
  check('receivedAt <= mountTime: false (historical)',
    !shouldShowLead(okLead, mountMs, mountMs - 1));
  check('receivedAt == mountTime: false (boundary)',
    !shouldShowLead(okLead, mountMs, mountMs));
  check('happy path: true',
    shouldShowLead(okLead, mountMs, mountMs + 1));
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
