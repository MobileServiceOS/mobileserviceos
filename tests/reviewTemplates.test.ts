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
  // Pin variantIndex to v0 — only variants that reference ${city}
  // exhibit the "your area" fallback. Without pinning, the random
  // seed could land on v3 (which omits city entirely), making the
  // assertion flake intermittently — observed in CI as ~20% failure
  // rate before this fix.
  const noCity = buildReviewMessage({
    customerName: 'Serge',
    service: 'Flat Tire Repair',
    businessName: 'Biz',
    reviewUrl: 'u',
    variantIndex: 0,
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
  // Assert via universal fields (customer name + business name)
  // rather than substring-matching variant-specific words. The
  // previous check (`thanks || helps`) flaked when the random
  // variant picked v1 of GENERIC, which contains capital "Thanks"
  // and singular "help" — neither matched the case-sensitive
  // substrings. What we actually want to verify here is "the
  // service was missing AND we still produced a coherent message"
  // — that's the bucket-fallback contract.
  const noService = buildReviewMessage({
    customerName: 'Serge',
    city: 'Aventura',
    businessName: 'Biz',
    reviewUrl: 'u',
  });
  check('missing service → uses generic bucket',
    noService.includes('Serge') && noService.includes('Biz') && noService.length > 30);

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
  // FLAT_REPAIR expanded from 4 → 8 variants (see commit
  // expanding the rotation pool). Lower-bound the assertion
  // so future expansions don't keep breaking the test.
  check('flat_repair has at least 4 variants', info.variantCount >= 4);
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

// ─── Regression: city,name comma collision ─────────────────────────
// Sentences like "in ${city}, ${name}." became unreadable when city
// already had a state suffix like "Aventura, FL" — the result was
// "in Aventura, FL, Serge." which parses as if Serge is part of the
// address. Fix moved the name to the start of the sentence. This
// guard sweeps every variant across every bucket with a state-
// suffixed location and asserts the body never contains
// ", FL, " or the comma-name-period sequence that signalled the bug.
section('Regression: city/name comma collision');
{
  const allServices = [
    undefined,
    'Flat Tire Repair', 'Tire Repair', 'Tire Replacement', 'Tire Installation',
    'Mounting & Balancing', 'Tire Mount & Balance', 'Used Tire Installation',
    'New Tire Installation', 'Spare Tire Installation', 'Spare Change',
    'Tire Rotation', 'Wheel Lock Removal', 'Valve Stem Replacement',
    'Roadside Tire Assistance', 'Roadside Tire Service',
    'Emergency Highway Service',
    'Mobile Tire Service', 'Jump Start', 'Fuel Delivery', 'Lockout',
    'Fleet Tire Service', 'Heavy-Duty Tire Service',
    'Commercial Truck Tire Service', 'RV Tire Service',
    // Mechanic vertical
    'Mobile Mechanic Services', 'Battery Replacement', 'Oil Change',
    'Brake Service',
    // Detailing vertical
    'Car Wash', 'Detailing',
    'Custom Unknown',
  ];
  for (const svc of allServices) {
    const seedFor = `seed-${svc || 'none'}`;
    // Walk every variant by passing variantIndex 0..6 (max bucket
    // is 4 variants, so a few of those will modulo back, but we
    // still exercise the full set).
    for (let i = 0; i < 6; i++) {
      const body = buildReviewMessage({
        customerName: 'Serge',
        service: svc,
        locationLabel: 'Aventura, FL',
        businessName: 'Wheel Rush',
        seed: seedFor,
        variantIndex: i,
      });
      // The exact failure signature: ", FL, " mid-sentence (a state
      // code wrapped by commas implies a city,state,name stack).
      const hasStateNameComma = / FL, \S+\.\s/.test(body);
      check(
        `[${svc || 'none'}#${i}] no comma-stack around state code`,
        !hasStateNameComma,
        `body: ${body}`,
      );
    }
  }
}

// ─── Regression: sentence-case enforcement on missing name ────────
// Field-reported. When the customer name is missing, the fallback
// is the lowercase word "there" — fine in mid-sentence positions
// ("Hi there, ...") but several templates open with the name
// directly ("${name}, hope you're..."), which produced "there,
// hope you're..." with a lowercase sentence start. The fix
// uppercases the very first character of the body unconditionally.
// This sweep checks every variant of every bucket with no name
// supplied and asserts the message begins with an uppercase letter.
section('Regression: sentence-case when name fallback fires');
{
  const allServices = [
    undefined,
    'Flat Tire Repair', 'Tire Repair', 'Tire Replacement', 'Tire Installation',
    'Mounting & Balancing', 'Tire Mount & Balance', 'Used Tire Installation',
    'New Tire Installation', 'Spare Tire Installation', 'Spare Change',
    'Tire Rotation', 'Wheel Lock Removal', 'Valve Stem Replacement',
    'Roadside Tire Assistance', 'Roadside Tire Service',
    'Emergency Highway Service',
    'Mobile Tire Service', 'Jump Start', 'Fuel Delivery', 'Lockout',
    'Fleet Tire Service', 'Heavy-Duty Tire Service',
    'Commercial Truck Tire Service', 'RV Tire Service',
    // Mechanic vertical
    'Mobile Mechanic Services', 'Battery Replacement', 'Oil Change',
    'Brake Service',
    // Detailing vertical
    'Car Wash', 'Detailing',
    'Custom Unknown',
  ];
  for (const svc of allServices) {
    for (let i = 0; i < 6; i++) {
      const body = buildReviewMessage({
        // customerName intentionally omitted → fallback "there"
        service: svc,
        locationLabel: 'Aventura, FL',
        businessName: 'Wheel Rush',
        seed: `noname-${svc || 'none'}`,
        variantIndex: i,
      });
      const firstChar = body.charAt(0);
      check(
        `[${svc || 'none'}#${i}] body starts with uppercase letter`,
        /[A-Z]/.test(firstChar),
        `body: ${body}`,
      );
      // Stronger guard: the body must NEVER open with the bare
      // word "There" — that signals a sentence-start template
      // pulled the lowercase "there" fallback without converting
      // to a real greeting. Real openers look like "Hi there,"
      // or "There ..." (used as a place adverb mid-thought,
      // which doesn't appear in any template). The test asserts
      // any "There" at position 0 is followed by another word
      // (greeting form), not a comma.
      check(
        `[${svc || 'none'}#${i}] no "There," lonely opener`,
        !body.startsWith('There,'),
        `body: ${body}`,
      );
    }
  }
}

// ─── Vehicle interpolation ─────────────────────────────────────────
// Feature added in c0f0360 follow-up: when the job captured a
// vehicle, vehicle-aware variants weave it in ("...on your Toyota
// Camry"). When missing, the same variant falls back cleanly with
// no dangling "on your" or double-space artifacts.
section('Vehicle interpolation');
{
  // Find at least one variant per bucket that mentions vehicle.
  // Sweep with vehicle supplied and assert the body contains the
  // exact vehicle string somewhere.
  const buckets = [
    'Tire Repair', 'Tire Replacement', 'Valve Stem Replacement',
    'Roadside Tire Assistance', 'Fleet Tire Service',
    'Mobile Mechanic Services', 'Battery Replacement', 'Oil Change',
    'Brake Service', 'Car Wash', 'Detailing',
  ];
  for (const svc of buckets) {
    let foundWithVehicle = false;
    // Iterate over the full variant pool for this bucket so we
    // don't miss vehicle-aware variants at the tail of the array.
    const { variantCount } = pickReviewVariant({
      customerName: 'Serge', service: svc, locationLabel: 'Aventura, FL',
      businessName: 'Wheel Rush', seed: 'discover',
    });
    for (let i = 0; i < variantCount; i++) {
      const body = buildReviewMessage({
        customerName: 'Serge',
        service: svc,
        locationLabel: 'Aventura, FL',
        businessName: 'Wheel Rush',
        vehicle: 'Toyota Camry',
        seed: `veh-${svc}`,
        variantIndex: i,
      });
      if (body.includes('Toyota Camry')) foundWithVehicle = true;
      // Regardless of variant, body must never contain "your your"
      // or "on  your" (double space) — those signal a broken
      // vehicleClause concat.
      check(
        `[${svc}#${i}] no double "your your" artifact`,
        !body.includes('your your'),
        body,
      );
      check(
        `[${svc}#${i}] no double-space artifact`,
        !/  /.test(body),
        body,
      );
    }
    check(
      `[${svc}] at least one variant interpolates the vehicle`,
      foundWithVehicle,
      `no variant in ${svc} bucket mentioned "Toyota Camry"`,
    );
  }
}

// ─── Vehicle ABSENT — graceful fallback ────────────────────────────
// Same sweep but with NO vehicle supplied. Body must never contain
// "on your ." or stray "your vehicle" fragments tied to missing
// data. The vehicleClause helper is empty string when absent so
// nothing should leak through.
section('Vehicle absent — graceful fallback');
{
  const buckets = [
    'Tire Repair', 'Valve Stem Replacement', 'Battery Replacement',
    'Oil Change', 'Brake Service', 'Car Wash', 'Detailing',
  ];
  for (const svc of buckets) {
    for (let i = 0; i < 6; i++) {
      const body = buildReviewMessage({
        customerName: 'Serge',
        service: svc,
        locationLabel: 'Aventura, FL',
        businessName: 'Wheel Rush',
        // vehicle intentionally omitted
        seed: `noveh-${svc}`,
        variantIndex: i,
      });
      check(
        `[${svc}#${i}] no dangling "on your ." when vehicle missing`,
        !/on your \./.test(body),
        body,
      );
      check(
        `[${svc}#${i}] no "your Toyota" leakage`,
        !body.includes('Toyota'),
        body,
      );
    }
  }
}

// ─── Smart rotation — no consecutive duplicates ────────────────────
// lastUsedIdx prevents the picker from returning the same index
// twice in a row even when the seed deterministically hashes there.
section('Smart rotation — no consecutive duplicates');
{
  const opts: ReviewMessageOptions = {
    customerName: 'Serge',
    service: 'Tire Replacement',
    locationLabel: 'Aventura, FL',
    businessName: 'Wheel Rush',
    seed: 'job-abc-123',
  };
  // First call: deterministic from seed.
  const first = pickReviewVariant(opts);
  // Second call: pass lastUsedIdx=first.index — must return
  // something different.
  const second = pickReviewVariant({ ...opts, lastUsedIdx: first.index });
  check('rotation: 2nd pick != 1st pick when same seed', second.index !== first.index);
  // Third call: pass lastUsedIdx=second.index — must differ
  // from second (allowed to equal first).
  const third = pickReviewVariant({ ...opts, lastUsedIdx: second.index });
  check('rotation: 3rd pick != 2nd pick', third.index !== second.index);
  // Lower-bound: bucket must have > 1 variant for the rotation
  // to be meaningful.
  check('rotation: bucket has > 1 variant', first.variantCount > 1);
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
