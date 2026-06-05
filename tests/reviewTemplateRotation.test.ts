// ═══════════════════════════════════════════════════════════════════
//  tests/reviewTemplateRotation.test.ts
//  Run: npx tsx tests/reviewTemplateRotation.test.ts
//
//  Tests DEFAULT_REVIEW_TEMPLATES rotation pool:
//   - Each variant uses the required placeholder set
//   - pickReviewTemplate returns a member of the pool
//   - Deterministic-RNG path returns the expected index
//   - Random-RNG path eventually covers all variants (distribution)
//   - Byte-identity between client + functions mirrors of the pool
// ═══════════════════════════════════════════════════════════════════

import {
  DEFAULT_REVIEW_TEMPLATES as TEMPLATES_CLIENT,
  pickReviewTemplate     as pickClient,
  renderTemplate         as renderClient,
} from '../src/lib/reviewTemplate';
import {
  DEFAULT_REVIEW_TEMPLATES as TEMPLATES_FN,
  pickReviewTemplate     as pickFn,
} from '../functions/src/lib/reviewTemplate';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const REQUIRED_PLACEHOLDERS = ['{firstName}', '{businessName}', '{serviceType}', '{city}', '{reviewLink}'];

console.log('\n── DEFAULT_REVIEW_TEMPLATES pool size ──');
check('pool has exactly 5 variants (client)',  TEMPLATES_CLIENT.length === 5, `got ${TEMPLATES_CLIENT.length}`);
check('pool has exactly 5 variants (functions)', TEMPLATES_FN.length === 5,   `got ${TEMPLATES_FN.length}`);

console.log('\n── byte-identity client ↔ functions ──');
for (let i = 0; i < TEMPLATES_CLIENT.length; i++) {
  check(`variant ${i+1} matches across mirrors`, TEMPLATES_CLIENT[i] === TEMPLATES_FN[i]);
}

console.log('\n── each variant contains the 5 required placeholders ──');
for (let i = 0; i < TEMPLATES_CLIENT.length; i++) {
  const t = TEMPLATES_CLIENT[i];
  for (const ph of REQUIRED_PLACEHOLDERS) {
    check(`V${i+1} contains ${ph}`, t.includes(ph), `missing in variant ${i+1}`);
  }
}

console.log('\n── pickReviewTemplate returns a pool member ──');
{
  const out = pickClient();
  check('output is one of the 5 templates', TEMPLATES_CLIENT.includes(out));
}

console.log('\n── deterministic RNG selects expected index ──');
{
  const rng0 = () => 0;        // → idx 0 → V1
  const rng04 = () => 0.4;     // floor(0.4 * 5) = 2 → V3
  const rng099 = () => 0.99;   // floor(0.99 * 5) = 4 → V5
  check('rng=0   returns V1', pickClient(rng0)   === TEMPLATES_CLIENT[0]);
  check('rng=0.4 returns V3', pickClient(rng04)  === TEMPLATES_CLIENT[2]);
  check('rng=0.99 returns V5', pickClient(rng099) === TEMPLATES_CLIENT[4]);
}

console.log('\n── deterministic RNG matches across mirrors ──');
{
  for (let r = 0; r < 1; r += 0.2) {
    const rng = () => r;
    check(`rng=${r.toFixed(1)} client == functions`, pickClient(rng) === pickFn(rng));
  }
}

console.log('\n── distribution over 5000 random calls covers all 5 ──');
{
  const counts = new Array(5).fill(0);
  for (let i = 0; i < 5000; i++) {
    const out = pickClient();
    const idx = TEMPLATES_CLIENT.indexOf(out);
    counts[idx]++;
  }
  // Each variant should appear at least 700 times (loose lower bound;
  // expected ~1000 ± noise). 700 is well below 3-sigma for a binomial
  // n=5000 p=0.2 so flake risk ≈ 0.
  for (let i = 0; i < 5; i++) {
    check(`V${i+1} appeared ≥700 times`, counts[i] >= 700, `count=${counts[i]}`);
  }
  console.log(`     distribution: [${counts.join(', ')}]  (expected ≈ 1000 each)`);
}

console.log('\n── rendered V1 substitutes all placeholders ──');
{
  const rendered = renderClient(TEMPLATES_CLIENT[0], {
    firstName:    'Maria',
    businessName: 'Wheel Rush Mobile Tire Repair',
    serviceType:  'Flat Tire Repair',
    city:         'Hollywood',
    reviewLink:   'https://g.page/r/CfMRJkXrNBO5EBM/review',
  });
  check('no unsubstituted {placeholders} remain', !/\{(firstName|businessName|serviceType|city|reviewLink)\}/.test(rendered),
    rendered.slice(0, 100) + '…');
  check('"Wheel Rush Mobile Tire Repair" present', rendered.includes('Wheel Rush Mobile Tire Repair'));
  check('"Flat Tire Repair" present',              rendered.includes('Flat Tire Repair'));
  check('"Hollywood" present',                     rendered.includes('Hollywood'));
  check('"Maria" present',                         rendered.includes('Maria'));
  check('Google review link present',              rendered.includes('https://g.page/r/CfMRJkXrNBO5EBM/review'));
}

console.log('\n── rendered V1 with empty city strips " in {city}" ──');
{
  const rendered = renderClient(TEMPLATES_CLIENT[0], {
    firstName:    'Maria',
    businessName: 'Wheel Rush',
    serviceType:  'Flat Tire Repair',
    city:         '',
    reviewLink:   'https://example.com',
  });
  check('no " in {city}" fragment remains',  !rendered.includes(' in {city}'));
  check('no literal " in " fragment near serviceType', !rendered.includes('Flat Tire Repair service in.'));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
