// ═══════════════════════════════════════════════════════════════════
//  tests/incomingCallNotification.test.ts
//  Run: npx tsx tests/incomingCallNotification.test.ts
//
//  Pure logic tests for the IncomingCallNotification component:
//    - computeBadgeState (badge thresholds)
//    - shouldShowLead (missed-call filter)
//    - shouldShowIncomingCall (Phase 1 real-time filter)
//    - computeBalanceDisplay (outstanding-balance pill)
// ═══════════════════════════════════════════════════════════════════

import {
  computeBadgeState,
  shouldShowLead,
  shouldShowIncomingCall,
  computeBalanceDisplay,
} from '../src/components/IncomingCallNotification';

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

console.log('\n── shouldShowIncomingCall filters ──');
{
  const mountMs = 1_000_000;
  const okCall = { id: 'CA_abc123', from: '+13055551234' };

  check('null call: false',
    !shouldShowIncomingCall(null, mountMs, mountMs + 1));
  check('missing from: false',
    !shouldShowIncomingCall({ id: 'CA_abc', from: '' }, mountMs, mountMs + 1));
  check('test call: false (call-test- prefix)',
    !shouldShowIncomingCall({ id: 'call-test-abc', from: '+13055551234' }, mountMs, mountMs + 1));
  check('receivedAt == mountTime: false (boundary)',
    !shouldShowIncomingCall(okCall, mountMs, mountMs));
  check('receivedAt < mountTime: false (historical)',
    !shouldShowIncomingCall(okCall, mountMs, mountMs - 1));
  check('receivedAt > mountTime: true (happy path)',
    shouldShowIncomingCall(okCall, mountMs, mountMs + 1));
}

console.log('\n── computeBalanceDisplay ──');
{
  // No balance and no open invoices → not shown.
  const r1 = computeBalanceDisplay(null, 0);
  check('null customer + 0 invoices: not shown',
    r1.showBalance === false && r1.amount === 0 && r1.label === '');

  const r2 = computeBalanceDisplay({ balance: 0 }, 0);
  check('zero customer balance + 0 invoices: not shown',
    r2.showBalance === false);

  // Positive balance via customer field.
  const r3 = computeBalanceDisplay({ balance: 125.5 }, 0);
  check('positive customer balance: shown',
    r3.showBalance === true && r3.amount === 125.5);
  check('positive balance: label includes money format',
    r3.label.includes('$126') || r3.label.includes('$125'));

  // Positive balance via open invoices only.
  const r4 = computeBalanceDisplay({ balance: 0 }, 90);
  check('positive open invoices, zero customer balance: shown',
    r4.showBalance === true && r4.amount === 90);

  // Both signals — take the max, don't double-count.
  const r5 = computeBalanceDisplay({ balance: 50 }, 200);
  check('both signals: take max (no double-count)',
    r5.showBalance === true && r5.amount === 200);

  // Negative balance → not shown (credit, not debt).
  const r6 = computeBalanceDisplay({ balance: -20 }, 0);
  check('negative customer balance (credit): not shown',
    r6.showBalance === false);

  // Negative balance + positive open invoices → invoice signal wins.
  const r7 = computeBalanceDisplay({ balance: -20 }, 75);
  check('negative balance + positive invoices: shown with invoice amount',
    r7.showBalance === true && r7.amount === 75);

  // Undefined / missing field is treated as zero.
  const r8 = computeBalanceDisplay({}, 0);
  check('undefined balance field: not shown',
    r8.showBalance === false);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
