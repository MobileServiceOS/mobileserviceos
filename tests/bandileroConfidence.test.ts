// tests/bandileroConfidence.test.ts
// Run: npx tsx tests/bandileroConfidence.test.ts
//
// Pins the Data Confidence State primitive + connectivity detection:
//   - every metric carries a state; ESTIMATED requires an assumption;
//     NOT_CONNECTED has value null (never a fake 0/blank).
//   - detectConnectivity reads real config; GBP/SEO/Dispatch are
//     hard-false (no integration exists).

import {
  live, estimated, notConnected, hasValue, assertValidMetric,
} from '@/lib/bandilero/confidence';
import { detectConnectivity } from '@/lib/bandilero/connectivity';
import type { Settings } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}
function throws(fn: () => unknown): boolean { try { fn(); return false; } catch { return true; } }

console.log('\n── constructors ──');
{
  const l = live(42, 'jobs');
  check('live → state LIVE', l.state === 'LIVE');
  check('live → value preserved', l.value === 42);

  const e = estimated(300, 'est. 2 × $150', 'leads');
  check('estimated → state ESTIMATED', e.state === 'ESTIMATED');
  check('estimated → carries assumption', e.assumption === 'est. 2 × $150');

  check('estimated without assumption throws', throws(() => estimated(1, '')));
  check('estimated with blank assumption throws', throws(() => estimated(1, '   ')));

  const nc = notConnected('Twilio not connected', 'leads');
  check('notConnected → state NOT_CONNECTED', nc.state === 'NOT_CONNECTED');
  check('notConnected → value is null (never fake 0)', nc.value === null);
}

console.log('\n── hasValue ──');
{
  check('hasValue true for LIVE', hasValue(live(0, 'jobs')));        // 0 is a real value
  check('hasValue false for NOT_CONNECTED', !hasValue(notConnected()));
}

console.log('\n── assertValidMetric invariants ──');
{
  check('valid LIVE passes', !throws(() => assertValidMetric(live(5, 'x'))));
  check('valid NOT_CONNECTED passes', !throws(() => assertValidMetric(notConnected())));
  check('NOT_CONNECTED with non-null value throws',
    throws(() => assertValidMetric({ state: 'NOT_CONNECTED', value: 0 } as never)));
  check('ESTIMATED without assumption throws',
    throws(() => assertValidMetric({ state: 'ESTIMATED', value: 1 } as never)));
  check('LIVE with null value throws',
    throws(() => assertValidMetric({ state: 'LIVE', value: null } as never)));
  check('missing state throws',
    throws(() => assertValidMetric({ value: 1 } as never)));
}

console.log('\n── detectConnectivity ──');
{
  const base = { businessName: 'X' } as Settings;
  const off = detectConnectivity({ settings: base, aiConfigured: false });
  check('AI off → ai false', off.ai === false);
  check('no twilio number → twilio false', off.twilio === false);
  check('GBP hard-false', off.gbp === false);
  check('SEO hard-false', off.seo === false);
  check('Dispatch hard-false', off.dispatch === false);

  const on = detectConnectivity({
    settings: { ...base, twilioPhoneNumber: '+13055551234', reviewAutomationEnabled: true, googleReviewLink: 'https://g.page/r/x' } as Settings,
    aiConfigured: true,
  });
  check('AI configured → ai true', on.ai === true);
  check('twilio number set → twilio true', on.twilio === true);
  check('review enabled + link → reviews true', on.reviews === true);

  const reviewNoLink = detectConnectivity({
    settings: { ...base, reviewAutomationEnabled: true } as Settings, aiConfigured: false,
  });
  check('review enabled but no link → reviews false', reviewNoLink.reviews === false);

  const reviewBrandUrl = detectConnectivity({
    settings: { ...base, reviewAutomationEnabled: true } as Settings,
    brandReviewUrl: 'https://g.page/r/y', aiConfigured: false,
  });
  check('review enabled + brand reviewUrl → reviews true', reviewBrandUrl.reviews === true);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
