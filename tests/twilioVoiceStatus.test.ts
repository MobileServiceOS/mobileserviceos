// ═══════════════════════════════════════════════════════════════════
//  tests/twilioVoiceStatus.test.ts
//  Run: npx tsx tests/twilioVoiceStatus.test.ts
//
//  Exercises the twilioVoiceStatus webhook decision tree via the
//  __testHooks.decide() pure function. Shimmed Firestore is NOT used
//  here — _decide is pure, returns { action, patch } for the wrapper
//  to apply.
//
//  Production wrapper handles signature validation, the Firestore
//  transaction, and the 200 OK / 403 response. The wrapper is
//  exercised in the emulator smoke (Task 17).
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/twilioVoiceStatus';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { decide, computeLeadId } = __testHooks;

function form(over: Record<string, string> = {}) {
  return {
    From: '+13055551234',
    To:   '+15555550000',
    CallSid: 'CA_abc123',
    CallStatus: 'no-answer',
    CallDuration: '0',
    Direction: 'inbound',
    ...over,
  };
}

const baseSettings = {
  reviewAutomationEnabled: false,
  missedCallAutoTextEnabled: true,
  missedCallTemplate: 'Hi, thanks for contacting {businessName}. Reply with details.',
  businessName: 'Wheel Rush',
  twilioPhoneNumber: '+15555550000',
};

console.log('\n── guard: Direction outbound ──');
{
  const out = decide(form({ Direction: 'outbound-api' }), baseSettings, null, null);
  check('skips when outbound', out.action === 'skip' && out.reason === 'not-inbound');
}

console.log('\n── guard: CallStatus completed ──');
{
  const out = decide(form({ CallStatus: 'completed' }), baseSettings, null, null);
  check('skips when completed', out.action === 'skip' && out.reason === 'not-missed');
}

console.log('\n── guard: CallStatus in-progress ──');
{
  const out = decide(form({ CallStatus: 'in-progress' }), baseSettings, null, null);
  check('skips when in-progress', out.action === 'skip');
}

console.log('\n── guard: From invalid ──');
{
  const out = decide(form({ From: 'gibberish' }), baseSettings, null, null);
  check('skips when phone invalid', out.action === 'skip' && out.reason === 'invalid-phone');
}

console.log('\n── guard: 24h dedup ──');
{
  // existingLead24h is non-null → Lead already created from this number today
  const out = decide(form(), baseSettings, null, { id: 'lead-3055551234-2026-06-04' });
  check('skips when lead exists in 24h window', out.action === 'skip' && out.reason === 'dedup');
}

console.log('\n── busy CallStatus → still proceeds (it is a missed call) ──');
{
  const out = decide(form({ CallStatus: 'busy' }), baseSettings, null, null);
  check('action enqueue on busy', out.action === 'enqueue');
}

console.log('\n── failed CallStatus → still proceeds ──');
{
  const out = decide(form({ CallStatus: 'failed' }), baseSettings, null, null);
  check('action enqueue on failed', out.action === 'enqueue');
}

console.log('\n── happy path with NEW customer ──');
{
  const out = decide(form(), baseSettings, null, null);
  check('action is enqueue', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('wasNewCustomer is true', out.wasNewCustomer === true);
    check('leadId matches lead-{digits}-{date}',
      /^lead-13055551234-\d{4}-\d{2}-\d{2}$/.test(out.leadId),
      out.leadId);
    check('source missed_call', out.lead.source === 'missed_call');
    check('status New', out.lead.status === 'New');
    check('autoTextSent false', out.lead.autoTextSent === false);
    check('callStatus mapped to no-answer', out.lead.callStatus === 'no-answer');
    check('outbound enqueued (toggle ON)', !!out.outboundSms);
    if (out.outboundSms) {
      check('SMS rendered contains business name',
        out.outboundSms.templateRendered.includes('Wheel Rush'));
      check('outbound kind is missed_call_response',
        out.outboundSms.kind === 'missed_call_response');
      check('outbound id is sms-{leadId}',
        out.outboundSms.id === `sms-${out.leadId}`);
    }
  }
}

console.log('\n── happy path with EXISTING customer ──');
{
  const existingCustomer = {
    id: 'p_13055551234',
    name: 'Maria Lopez',
    phoneE164: '+13055551234',
    kind: 'individual' as const,
    vipTier: 'Gold' as const,
    jobCount: 5,
  };
  const out = decide(form(), baseSettings, existingCustomer, null);
  check('action enqueue', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('wasNewCustomer false', out.wasNewCustomer === false);
    check('customerId points to existing doc', out.lead.customerId === 'p_13055551234');
  }
}

console.log('\n── toggle OFF: writes Lead but no outboundSms ──');
{
  const out = decide(form(), { ...baseSettings, missedCallAutoTextEnabled: false }, null, null);
  check('action enqueue (Lead still created)', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('outbound NOT enqueued', !out.outboundSms);
  }
}

console.log('\n── voicemail CallStatus maps to voicemail ──');
{
  // Twilio's voice-status callback uses `CallStatus=completed` for voicemail-
  // dropped calls; we conservatively also accept the explicit `voicemail`
  // string in case a future TwiML config produces it. Treated as missed.
  const out = decide(form({ CallStatus: 'voicemail' }), baseSettings, null, null);
  check('voicemail proceeds (treated as missed call)', out.action === 'enqueue');
  if (out.action === 'enqueue') {
    check('callStatus voicemail', out.lead.callStatus === 'voicemail');
  }
}

console.log('\n── computeLeadId stability ──');
{
  const a = computeLeadId('+13055551234', '2026-06-04');
  const b = computeLeadId('+13055551234', '2026-06-04');
  check('same input → same id', a === b);
  check('matches lead-{digits}-{date}', a === 'lead-13055551234-2026-06-04');
  const c = computeLeadId('+13055551234', '2026-06-05');
  check('different date → different id', a !== c);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
