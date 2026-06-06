// ═══════════════════════════════════════════════════════════════════
//  tests/twilioIncomingCallDecide.test.ts
//  Run: npx tsx tests/twilioIncomingCallDecide.test.ts
//
//  Exercises the twilioIncomingCall webhook's pure decision tree via
//  __testHooks.decide(). The wrapper handles signature validation,
//  business routing, Firestore writes, and TwiML response; this file
//  only tests the doc-shape decision.
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/twilioIncomingCall';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { decide, isValidE164, digitsOnly } = __testHooks;

function form(over: Record<string, string> = {}) {
  return {
    From: '+13055551234',
    To:   '+15555550000',
    CallSid: 'CA_abc123',
    Direction: 'inbound',
    ...over,
  };
}

console.log('\n── isValidE164 + digitsOnly helpers ──');
{
  check('valid E.164 US number', isValidE164('+13055551234'));
  check('reject missing +',     !isValidE164('13055551234'));
  check('reject too-short',     !isValidE164('+1'));
  check('reject leading 0',     !isValidE164('+03055551234'));
  check('digitsOnly strips +',  digitsOnly('+13055551234') === '13055551234');
  check('digitsOnly empty',     digitsOnly('') === '');
}

console.log('\n── skip: invalid From ──');
{
  const r = decide(form({ From: '' }), null);
  check('empty From: skip',
    r.action === 'skip' && r.reason === 'invalid-from');

  const r2 = decide(form({ From: '305-555-1234' }), null);
  check('non-E.164 From: skip',
    r2.action === 'skip' && r2.reason === 'invalid-from');
}

console.log('\n── skip: invalid To ──');
{
  const r = decide(form({ To: '' }), null);
  check('empty To: skip', r.action === 'skip' && r.reason === 'invalid-to');
}

console.log('\n── skip: missing CallSid ──');
{
  const r = decide(form({ CallSid: '' }), null);
  check('missing CallSid: skip',
    r.action === 'skip' && r.reason === 'missing-callsid');
}

console.log('\n── customer-exists path ──');
{
  const r = decide(form(), { id: 'p_13055551234' });
  check('action=write',           r.action === 'write');
  if (r.action === 'write') {
    check('callSid carried',      r.callSid === 'CA_abc123');
    check('customerId set',       r.doc.customerId === 'p_13055551234');
    check('customerExists=true',  r.doc.customerExists === true);
    check('from carried',         r.doc.from === '+13055551234');
    check('to carried',           r.doc.to === '+15555550000');
    check('direction inbound',    r.doc.direction === 'inbound');
    check('callStatus ringing',   r.doc.callStatus === 'ringing');
    check('id == callSid',        r.doc.id === r.callSid);
  }
}

console.log('\n── customer-absent path ──');
{
  const r = decide(form(), null);
  check('action=write',           r.action === 'write');
  if (r.action === 'write') {
    check('customerId null',      r.doc.customerId === null);
    check('customerExists=false', r.doc.customerExists === false);
    check('still has from/to',
      r.doc.from === '+13055551234' && r.doc.to === '+15555550000');
  }
}

console.log('\n── distinct callSids produce distinct decisions ──');
{
  const r1 = decide(form({ CallSid: 'CA_111' }), null);
  const r2 = decide(form({ CallSid: 'CA_222' }), null);
  check('callSid differentiates',
    r1.action === 'write' && r2.action === 'write'
    && r1.callSid !== r2.callSid
    && r1.doc.id !== r2.doc.id);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
