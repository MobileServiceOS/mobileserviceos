// ═══════════════════════════════════════════════════════════════════
//  tests/reviewAutomationCallables.test.ts
//  Run: npx tsx tests/reviewAutomationCallables.test.ts
//
//  Exercises buildPatch() for both callables. Validates required-field
//  enforcement, the isTest/isManual flag wiring, and the shared
//  doc-id idempotency.
// ═══════════════════════════════════════════════════════════════════

import { __testHooks as testHooks } from '../functions/src/sendTestReviewSms';
import { __testHooks as manualHooks } from '../functions/src/sendManualReviewRequest';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── sendTestReviewSms — buildPatch ──');
{
  const out = testHooks.buildPatch({
    phoneE164: '+13055551234',
    template: 'Hi {firstName}, this is a test. {reviewLink}',
    settings: { reviewSmsTemplate: 'X', googleReviewLink: 'https://g.page/r/xxx', businessName: 'Wheel Rush' },
    uid: 'uid-owner',
  });
  check('isTest flag set', out.isTest === true);
  check('isManual flag undefined or false', !out.isManual);
  check('invokedByUid carries caller uid', out.invokedByUid === 'uid-owner');
  check('phoneE164 propagated', out.phoneE164 === '+13055551234');
  check('templateUsed reflects passed template', out.templateUsed === 'Hi {firstName}, this is a test. {reviewLink}');
  check('reviewLink substituted into rendered body', out.templateRendered.includes('https://g.page/r/xxx'));
  check('status pending', out.status === 'pending');
  check('retryCount 0', out.retryCount === 0);
}

console.log('\n── sendManualReviewRequest — buildPatch ──');
{
  const out = manualHooks.buildPatch({
    jobId: 'jobA', customerId: 'cust1',
    customerName: 'Maria Lopez', phoneE164: '+13055551234',
    serviceType: 'Tire Replacement', city: 'Hollywood',
    vehicleMakeModel: 'Honda Civic',
    settings: {
      reviewSmsTemplate: 'Hi {firstName} {lastName}, thanks for choosing {businessName} for your {serviceType} in {city}. {reviewLink}',
      googleReviewLink: 'https://g.page/r/xxx',
      businessName: 'Wheel Rush',
    },
    uid: 'uid-owner',
  });
  check('isManual flag set', out.isManual === true);
  check('isTest absent', !out.isTest);
  check('invokedByUid carries caller uid', out.invokedByUid === 'uid-owner');
  check('jobId carried', out.jobId === 'jobA');
  check('customerId carried', out.customerId === 'cust1');
  check('templateRendered contains firstName Maria', out.templateRendered.includes('Maria'));
  check('templateRendered contains lastName Lopez', out.templateRendered.includes('Lopez'));
  check('templateRendered contains vehicle if template uses {vehicle} — none here, but business name should',
    out.templateRendered.includes('Wheel Rush'));
}

console.log('\n── computeRequestId — same job same day = same id ──');
{
  const a = manualHooks.computeRequestId('jobA', '2026-06-03');
  const b = manualHooks.computeRequestId('jobA', '2026-06-03');
  check('idempotent doc id', a === b);
  check('matches req-{jobId}-{date} shape', /^req-jobA-2026-06-03$/.test(a));
}

console.log('\n── sendTestReviewSms — defaults phone when omitted from input ──');
{
  // buildPatch requires phoneE164; the wrapper is what defaults to the caller's
  // member phone. We assert the helper REJECTS when caller doesn't supply.
  let threw = false;
  try {
    testHooks.buildPatch({
      phoneE164: '',
      template: 'X', settings: { googleReviewLink: 'https://g.page/r/x' }, uid: 'u',
    });
  } catch { threw = true; }
  check('buildPatch refuses empty phoneE164', threw);
}

console.log('\n── sendManualReviewRequest — refuses without googleReviewLink ──');
{
  let threw = false;
  try {
    manualHooks.buildPatch({
      jobId: 'jobA', customerId: 'cust1',
      customerName: 'Maria', phoneE164: '+13055551234',
      serviceType: 'X', city: 'Y',
      settings: { reviewSmsTemplate: 'Hi {firstName}', googleReviewLink: '' },
      uid: 'u',
    });
  } catch { threw = true; }
  check('buildPatch refuses when googleReviewLink empty', threw);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
