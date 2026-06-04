// ═══════════════════════════════════════════════════════════════════
//  tests/missedCallCallables.test.ts
//  Run: npx tsx tests/missedCallCallables.test.ts
//
//  Exercises buildPatch helpers for both SP4B callables. Pure logic,
//  no Firestore. The full callables' auth + Firestore path is tested
//  in the emulator smoke (Task 17).
// ═══════════════════════════════════════════════════════════════════

import { __testHooks as testHooks } from '../functions/src/sendTestMissedCall';
import { __testHooks as manualHooks } from '../functions/src/sendManualOutboundSms';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── sendTestMissedCall.buildLeadAndSms — happy ──');
{
  const out = testHooks.buildLeadAndSms({
    uid: 'uid-owner',
    settings: {
      missedCallTemplate: 'Hi, thanks for contacting {businessName}.',
      businessName: 'Wheel Rush',
    },
    phoneE164: '+13055551234',
  });
  check('lead id starts with lead-test-', /^lead-test-uid-owner-\d+$/.test(out.leadId));
  check('lead has source missed_call', out.lead.source === 'missed_call');
  check('lead status New', out.lead.status === 'New');
  check('lead wasNewCustomer false (test path matches caller)', out.lead.wasNewCustomer === false);
  check('lead callStatus no-answer', out.lead.callStatus === 'no-answer');
  check('lead phoneE164 matches input', out.lead.phoneE164 === '+13055551234');
  check('outboundSms id is sms-{leadId}', out.outboundSms.id === `sms-${out.leadId}`);
  check('outboundSms isTest=true', out.outboundSms.isTest === true);
  check('outboundSms templateRendered contains businessName',
    out.outboundSms.templateRendered.includes('Wheel Rush'));
  check('outboundSms status pending', out.outboundSms.status === 'pending');
}

console.log('\n── sendTestMissedCall — refuses without twilioPhoneNumber set ──');
{
  let threw = false;
  try {
    testHooks.buildLeadAndSms({
      uid: 'uid-owner',
      settings: { missedCallTemplate: 'Hi {businessName}.', businessName: 'X' },
      phoneE164: '',
    });
  } catch { threw = true; }
  check('buildLeadAndSms refuses empty phoneE164', threw);
}

console.log('\n── sendManualOutboundSms.buildPatch — happy ──');
{
  const out = manualHooks.buildPatch({
    leadId: 'lead-3055551234-2026-06-04',
    customerId: 'p_13055551234',
    phoneE164: '+13055551234',
    body: 'Hi Maria — got your message, calling back in 5min.',
    uid: 'uid-operator',
  });
  check('kind is manual_lead_reply', out.kind === 'manual_lead_reply');
  check('isManual=true', out.isManual === true);
  check('isTest is undefined/false', !out.isTest);
  check('templateUsed echoes body', out.templateUsed === 'Hi Maria — got your message, calling back in 5min.');
  check('templateRendered equals templateUsed (no substitutions for manual)',
    out.templateRendered === 'Hi Maria — got your message, calling back in 5min.');
  check('leadId carried', out.leadId === 'lead-3055551234-2026-06-04');
  check('customerId carried', out.customerId === 'p_13055551234');
  check('phoneE164 carried', out.phoneE164 === '+13055551234');
  check('status pending', out.status === 'pending');
  check('invokedByUid carries caller uid', out.invokedByUid === 'uid-operator');
}

console.log('\n── sendManualOutboundSms — refuses empty body ──');
{
  let threw = false;
  try {
    manualHooks.buildPatch({
      leadId: 'lead-3055551234-2026-06-04',
      customerId: 'p_13055551234',
      phoneE164: '+13055551234',
      body: '   ',
      uid: 'uid-operator',
    });
  } catch { threw = true; }
  check('buildPatch refuses whitespace-only body', threw);
}

console.log('\n── sendManualOutboundSms — refuses empty phoneE164 ──');
{
  let threw = false;
  try {
    manualHooks.buildPatch({
      leadId: 'lead-3055551234-2026-06-04',
      customerId: 'p_13055551234',
      phoneE164: '',
      body: 'Hi.',
      uid: 'uid-operator',
    });
  } catch { threw = true; }
  check('buildPatch refuses empty phoneE164', threw);
}

console.log('\n── computeManualSmsId pattern ──');
{
  const id = manualHooks.computeSmsId('lead-3055551234-2026-06-04', 1717480000000);
  check('matches sms-manual-{leadId}-{ms}',
    id === 'sms-manual-lead-3055551234-2026-06-04-1717480000000');
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
