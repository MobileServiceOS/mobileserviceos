// ═══════════════════════════════════════════════════════════════════
//  tests/reviewTemplates.test.ts — runnable test harness
// ═══════════════════════════════════════════════════════════════════
//
//  Standalone test file that exercises the new review template system.
//  Designed to run with `tsx` or `ts-node` directly (no Jest/Vitest
//  setup required) so it can be run from any environment including
//  Cloud Shell or Replit:
//
//      npx tsx tests/reviewTemplates.test.ts
//
//  Outputs:
//    - PASS/FAIL line per test
//    - Sample messages for every service bucket at the end (visual
//      verification that templates read naturally and stay under
//      the 250-char body budget).
//
//  Exits with code 1 on any failure so CI can detect regressions.
// ═══════════════════════════════════════════════════════════════════

import {
  buildReviewMessage,
  pickReviewVariant,
  shareReviewMessage,
  openReviewSMSFromJob,
  type ReviewMessageOptions,
} from '../src/lib/reviewTemplates';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ─── Test: basic happy path ────────────────────────────────────────
section('BASIC');

{
  const msg = buildReviewMessage({
    customerName: 'Serge',
    service: 'Mounting & Balancing',
    city: 'Aventura',
    state: 'FL',
    businessName: 'Wheel Rush',
    reviewUrl: 'https://g.page/r/abc',
    variantIndex: 0,  // Variant 0 of REPLACEMENT explicitly includes city.
  });
  check('contains customer first name', msg.includes('Serge'));
  check('contains business name', msg.includes('Wheel Rush'));
  check('contains city', msg.includes('Aventura'));
  check('contains service phrase', msg.toLowerCase().includes('mounting'));
  check('contains review URL', msg.includes('https://g.page/r/abc'));
  check('has single newline before URL',
    msg.split('\n').length === 2,
    `got ${msg.split('\n').length} lines`);
}

// ─── Test: name fallback ────────────────────────────────────────────
section('NAME FALLBACKS');

{
  const noName = buildReviewMessage({ businessName: 'Biz', reviewUrl: 'u' });
  check('missing name → "there" fallback used',
    /\bthere[,.]/i.test(noName),
    `got: ${noName}`);

  const emailJunk = buildReviewMessage({
    customerName: 'serge@example.com',
    businessName: 'Biz',
    reviewUrl: 'u',
  });
  check('email-shaped name rejected', !emailJunk.includes('serge@'));

  const digits = buildReviewMessage({
    customerName: '123 Customer',
    businessName: 'Biz',
    reviewUrl: 'u',
  });
  check('digit-prefixed name rejected', !digits.includes('123'));

  const firstNameOnly = buildReviewMessage({
    customerName: 'Maria Garcia',
    businessName: 'Biz',
    reviewUrl: 'u',
  });
  check('uses first name only',
    firstNameOnly.includes('Maria') && !firstNameOnly.includes('Garcia'));
}

// ─── Test: city / state composition ────────────────────────────────
section('LOCATION FALLBACKS');

{
  const noCity = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    businessName: 'Biz',
    reviewUrl: 'u',
  });
  check('missing city → "your area"', noCity.includes('your area'));

  const cityState = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    city: 'Aventura',
    state: 'FL',
    businessName: 'Biz',
    reviewUrl: 'u',
    variantIndex: 0,  // v0 of FLAT_REPAIR includes city.
  });
  check('city + state combines correctly', cityState.includes('Aventura, FL'));

  const labelOverridesCity = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    city: 'IgnoredCity',
    state: 'XX',
    locationLabel: 'Brickell, FL',
    businessName: 'Biz',
    reviewUrl: 'u',
    variantIndex: 0,  // v0 of FLAT_REPAIR includes city.
  });
  check('explicit locationLabel wins over city/state',
    labelOverridesCity.includes('Brickell, FL') && !labelOverridesCity.includes('IgnoredCity'));
}

// ─── Test: service fallbacks ───────────────────────────────────────
section('SERVICE FALLBACKS');

{
  const noService = buildReviewMessage({
    customerName: 'Serge',
    city: 'Aventura',
    businessName: 'Biz',
    reviewUrl: 'u',
  });
  check('missing service → uses generic bucket',
    noService.includes('thanks') || noService.toLowerCase().includes('helps'));

  const unknownService = buildReviewMessage({
    customerName: 'Serge',
    service: 'Weird Custom Service' as never,
    city: 'Aventura',
    businessName: 'Biz',
    reviewUrl: 'u',
    seed: 'job-99',
  });
  // Should not crash; should produce something reasonable.
  check('unknown service still produces output', unknownService.length > 30);
}

// ─── Test: business name fallback ──────────────────────────────────
section('BUSINESS NAME FALLBACK');

{
  const noBiz = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    city: 'Aventura',
    reviewUrl: 'u',
  });
  check('missing business → "our team"', noBiz.includes('our team'));
}

// ─── Test: link handling ────────────────────────────────────────────
section('LINK HANDLING');

{
  const noUrl = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    city: 'Aventura',
    businessName: 'Biz',
  });
  check('no URL → message returned without trailing newline+url',
    !noUrl.includes('https://') && !noUrl.endsWith('\n'));
}

// ─── Test: deterministic seed ───────────────────────────────────────
section('SEED DETERMINISM');

{
  const opts: ReviewMessageOptions = {
    customerName: 'Serge',
    service: 'Tire Replacement',
    city: 'Aventura',
    state: 'FL',
    businessName: 'Wheel Rush',
    reviewUrl: 'u',
    seed: 'job-abc-123',
  };
  const a = buildReviewMessage(opts);
  const b = buildReviewMessage(opts);
  const c = buildReviewMessage(opts);
  check('same seed → identical output', a === b && b === c);

  const d = buildReviewMessage({ ...opts, seed: 'job-different' });
  // Two different seeds COULD pick the same variant by chance; check
  // many seeds for variance instead.
  const samples = new Set<string>();
  for (let i = 0; i < 20; i++) {
    samples.add(buildReviewMessage({ ...opts, seed: `seed-${i}` }));
  }
  check('many seeds produce variant rotation',
    samples.size >= 2,
    `got ${samples.size} unique outputs across 20 seeds`);
  void d;
}

// ─── Test: variant override ────────────────────────────────────────
section('VARIANT OVERRIDE');

{
  const m0 = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    city: 'Aventura',
    businessName: 'Biz',
    reviewUrl: 'u',
    variantIndex: 0,
  });
  const m1 = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    city: 'Aventura',
    businessName: 'Biz',
    reviewUrl: 'u',
    variantIndex: 1,
  });
  check('different variantIndex → different output', m0 !== m1);

  const info = pickReviewVariant({
    service: 'Flat Tire Repair',
    variantIndex: 0,
  });
  check('pickReviewVariant returns bucket', info.bucket === 'flat_repair');
  check('pickReviewVariant returns index 0', info.index === 0);
  check('flat_repair has 4 variants', info.variantCount === 4);
}

// ─── Test: character budget ────────────────────────────────────────
section('CHARACTER BUDGET');

const services = [
  'Flat Tire Repair',
  'Tire Replacement',
  'Mounting & Balancing',
  'Spare Tire Installation',
  'Wheel Lock Removal',
  'Roadside Tire Assistance',
  'Jump Start',
  'Fleet Tire Service',
];

for (const svc of services) {
  // Test all variants for this service.
  const info = pickReviewVariant({ service: svc, variantIndex: 0 });
  for (let i = 0; i < info.variantCount; i++) {
    const body = buildReviewMessage({
      customerName: 'Serge',
      service: svc,
      city: 'Aventura',
      state: 'FL',
      businessName: 'Wheel Rush',
      variantIndex: i,
      // No URL — measuring body only
    });
    check(`${svc} v${i} body ≤ 250 chars (actual: ${body.length})`, body.length <= 250);
  }
}

// ─── Test: channel routing ─────────────────────────────────────────
section('SHARE CHANNELS');

{
  // We can't actually open windows in this test env, but we can
  // verify that shareReviewMessage returns the body for all channels.
  const opts: ReviewMessageOptions & { phone?: string } = {
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    city: 'Aventura',
    businessName: 'Biz',
    reviewUrl: 'https://g.page/r/abc',
    phone: '555-123-4567',
    seed: 'fixed',
  };

  // Stub window.open so the test doesn't actually try to navigate.
  const g = globalThis as unknown as { window?: { open: (u: string) => void } };
  let lastUrl = '';
  g.window = { open: (u: string) => { lastUrl = u; } };

  const smsBody = shareReviewMessage(opts, 'sms');
  check('sms returns body', smsBody.length > 0);
  check('sms uses sms: scheme', lastUrl.startsWith('sms:5551234567?body='));

  const waBody = shareReviewMessage(opts, 'whatsapp');
  check('whatsapp returns body', waBody.length > 0);
  check('whatsapp uses wa.me', lastUrl.startsWith('https://wa.me/5551234567'));

  const imsgBody = shareReviewMessage(opts, 'imessage');
  check('imessage uses sms: scheme (iOS routes)', lastUrl.startsWith('sms:'));
  void imsgBody;

  // Clipboard: no navigation, just return body.
  lastUrl = '';
  const clipBody = shareReviewMessage(opts, 'clipboard');
  check('clipboard does NOT open window', lastUrl === '');
  check('clipboard returns body', clipBody.length > 0);

  delete g.window;
}

// ─── Test: openReviewSMSFromJob wrapper ────────────────────────────
section('JOB WRAPPER');

{
  const g = globalThis as unknown as { window?: { open: (u: string) => void } };
  let lastUrl = '';
  g.window = { open: (u: string) => { lastUrl = u; } };

  const body = openReviewSMSFromJob({
    phone: '555-111-2222',
    reviewUrl: 'https://g.page/r/test',
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    locationLabel: 'Aventura, FL',
    businessName: 'Wheel Rush',
    jobId: 'job-stable-001',
  });
  check('job wrapper produces message', body.includes('Serge'));
  check('job wrapper opens SMS URL', lastUrl.startsWith('sms:5551112222?body='));

  delete g.window;
}

// ─── Sample output (visual inspection) ─────────────────────────────
section('SAMPLE OUTPUTS — for visual inspection');

const sampleServices = [
  'Flat Tire Repair',
  'Tire Replacement',
  'Mounting & Balancing',
  'Spare Tire Installation',
  'Wheel Lock Removal',
  'Roadside Tire Assistance',
  'Jump Start',
  'Fleet Tire Service',
];

for (const svc of sampleServices) {
  console.log(`\n  📱 ${svc}`);
  console.log('  ─────────────────────────────────────────────');
  // Show one variant per service (the v0 — most representative).
  const msg = buildReviewMessage({
    customerName: 'Serge',
    service: svc,
    city: 'Aventura',
    state: 'FL',
    businessName: 'Wheel Rush',
    reviewUrl: 'https://g.page/r/CSxample',
    variantIndex: 0,
  });
  console.log('  ' + msg.split('\n').join('\n  '));
}

// ─── Summary ───────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
console.log('═'.repeat(60));

if (failed > 0) {
  process.exit(1);
}
