// ═══════════════════════════════════════════════════════════════════
//  tests/onJobCompletedReviewRequest.test.ts
//  Run: npx tsx tests/onJobCompletedReviewRequest.test.ts
//
//  Exercises the 6-guard decision tree of the SP4A Firestore trigger.
//  Pure logic — no emulator. The real onDocumentWritten wrapper is
//  thin; the decision logic lives in __testHooks.decide().
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/onJobCompletedReviewRequest';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { decide, computeRequestId } = __testHooks;

const baseCustomer = { id: 'cust1', name: 'Maria Lopez', phoneE164: '+13055551234' };
const baseSettings = {
  reviewAutomationEnabled: true,
  reviewSmsTemplate: 'Hi {firstName}, thanks. {reviewLink}',
  reviewDelayMinutes: 0,
  googleReviewLink: 'https://g.page/r/xxx',
  businessName: 'Wheel Rush',
};
const completedAfter = { id: 'jobA', status: 'Completed', date: '2026-06-03', service: 'Tire Replacement', city: 'Hollywood', customerId: 'cust1' };

console.log('\n── guard #1: already Completed before ──');
check('skips when before.status === Completed',
  decide({ status: 'Completed' }, completedAfter, baseCustomer, baseSettings).action === 'skip');

console.log('\n── guard #2: status !== Completed ──');
check('skips when after.status === Pending',
  decide(null, { ...completedAfter, status: 'Pending' }, baseCustomer, baseSettings).action === 'skip');

console.log('\n── guard #3: reviewRequestSent === true ──');
check('skips when job already flagged as sent',
  decide(null, { ...completedAfter, reviewRequestSent: true }, baseCustomer, baseSettings).action === 'skip');

console.log('\n── guard #4: settings toggle OFF ──');
check('skips when reviewAutomationEnabled === false',
  decide(null, completedAfter, baseCustomer, { ...baseSettings, reviewAutomationEnabled: false }).action === 'skip');

console.log('\n── guard #5: empty googleReviewLink ──');
check('skips when googleReviewLink empty',
  decide(null, completedAfter, baseCustomer, { ...baseSettings, googleReviewLink: '' }).action === 'skip');
check('skips when googleReviewLink whitespace',
  decide(null, completedAfter, baseCustomer, { ...baseSettings, googleReviewLink: '   ' }).action === 'skip');

console.log('\n── guard #6: customer has no phone ──');
check('skips when phoneE164 missing',
  decide(null, completedAfter, { ...baseCustomer, phoneE164: undefined }, baseSettings).action === 'skip');

console.log('\n── happy path — all guards pass ──');
{
  const out = decide(null, completedAfter, baseCustomer, baseSettings);
  check('action is enqueue', out.action === 'enqueue');
  check('rendered SMS substitutes firstName', !!out.patch && out.patch.templateRendered.includes('Hi Maria'));
  check('rendered SMS contains reviewLink', !!out.patch && out.patch.templateRendered.includes('https://g.page/r/xxx'));
  check('requestId follows req-{jobId}-{date} pattern',
    !!out.requestId && /^req-jobA-2026-06-03$/.test(out.requestId));
  check('phoneE164 propagated to request',
    !!out.patch && out.patch.phoneE164 === '+13055551234');
  check('status pending', !!out.patch && out.patch.status === 'pending');
  check('retryCount 0', !!out.patch && out.patch.retryCount === 0);
  check('invokedByUid system tag', !!out.patch && out.patch.invokedByUid === 'system:reviewAutomation');
}

console.log('\n── delay arithmetic ──');
{
  const out = decide(null, completedAfter, baseCustomer, { ...baseSettings, reviewDelayMinutes: 15 });
  check('sendAfterAt is set', !!out.patch && typeof out.patch.sendAfterAtEpochMs === 'number');
  // The decision returns epochMs (numeric) instead of a Timestamp so it stays pure.
  // The wrapper translates it to admin Timestamp before writing.
  // We can't assert exact ms without freezing the clock — assert >= 14min and <= 16min from now.
  const now = Date.now();
  const dt = (out.patch?.sendAfterAtEpochMs ?? 0) - now;
  check('delay between 14 and 16 minutes', dt > 14 * 60_000 && dt < 16 * 60_000, `dt=${dt}ms`);
}

console.log('\n── city fallback chain ──');
{
  // No job.city, no job.area, but settings.serviceArea → "in South Florida"
  const cityTemplate = 'Hi {firstName}, thanks for the service in {city}. {reviewLink}';
  const out = decide(null, { ...completedAfter, city: undefined, area: undefined } as never, baseCustomer, { ...baseSettings, reviewSmsTemplate: cityTemplate, serviceArea: 'South Florida' });
  check('uses settings.serviceArea when job.city + job.area missing',
    out.action === 'enqueue' && !!out.patch && out.patch.templateRendered.includes('South Florida'));
}
{
  // No city anywhere → smart-empty stripping; no "undefined" in body
  const noCityTemplate = 'Hi {firstName}, thanks for the {serviceType} in {city}. {reviewLink}';
  const out = decide(null, { ...completedAfter, city: undefined, area: undefined } as never, baseCustomer, { ...baseSettings, reviewSmsTemplate: noCityTemplate, serviceArea: undefined });
  check('strips " in {city}" when no city signal anywhere',
    out.action === 'enqueue' && !!out.patch && !out.patch.templateRendered.includes('undefined') && !out.patch.templateRendered.includes('{city}'));
}

console.log('\n── computeRequestId is idempotent ──');
check('same jobId + same date → same id',
  computeRequestId('jobA', '2026-06-03') === 'req-jobA-2026-06-03');
check('different date → different id',
  computeRequestId('jobA', '2026-06-03') !== computeRequestId('jobA', '2026-06-04'));

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
