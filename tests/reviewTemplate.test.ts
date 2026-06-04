// ═══════════════════════════════════════════════════════════════════
//  tests/reviewTemplate.test.ts
//  Run: npx tsx tests/reviewTemplate.test.ts
//
//  Tests renderTemplate() — 7-placeholder substitution with
//  smart-empty stripping. Imports BOTH the client mirror and the
//  functions mirror to enforce byte-identity (modulo header path).
// ═══════════════════════════════════════════════════════════════════

import { renderTemplate as renderClient } from '../src/lib/reviewTemplate';
import { renderTemplate as renderFn }     from '../functions/src/lib/reviewTemplate';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const DEFAULT =
  'Hi {firstName}, thanks for choosing {businessName} for your {serviceType} in {city}. ' +
  'We’d appreciate a quick Google review: {reviewLink}';

console.log('\n── renderTemplate — all placeholders populated ──');
{
  const out = renderClient(DEFAULT, {
    firstName: 'Maria', lastName: 'Lopez',
    businessName: 'Wheel Rush', serviceType: 'Tire Replacement',
    city: 'Hollywood', vehicle: 'Honda Civic',
    reviewLink: 'https://g.page/r/xxx',
  });
  check('produces the full sentence',
    out === 'Hi Maria, thanks for choosing Wheel Rush for your Tire Replacement in Hollywood. ' +
            'We’d appreciate a quick Google review: https://g.page/r/xxx',
    out);
}

console.log('\n── smart-empty stripping — city absent ──');
{
  const out = renderClient(DEFAULT, {
    firstName: 'Maria', businessName: 'Wheel Rush',
    serviceType: 'Tire Replacement', reviewLink: 'https://g.page/r/xxx',
  });
  // The " in {city}" connective is stripped entirely; no "in undefined".
  check('strips " in {city}" when city empty',
    out === 'Hi Maria, thanks for choosing Wheel Rush for your Tire Replacement. ' +
            'We’d appreciate a quick Google review: https://g.page/r/xxx',
    out);
  check('never contains the word undefined', !/undefined/.test(out), out);
}

console.log('\n── smart-empty stripping — vehicle absent ──');
{
  const template = 'Hi {firstName}, thanks for choosing {businessName} for your {vehicle} {serviceType} in {city}.';
  const out = renderClient(template, {
    firstName: 'Maria', businessName: 'Wheel Rush',
    serviceType: 'tune-up', city: 'Hollywood',
  });
  check('strips " for your {vehicle}" when vehicle empty',
    out === 'Hi Maria, thanks for choosing Wheel Rush tune-up in Hollywood.',
    out);
}

console.log('\n── smart-empty stripping — lastName absent ──');
{
  const template = 'Hi {firstName} {lastName}, thanks.';
  const out = renderClient(template, { firstName: 'Maria' });
  check('strips " {lastName}" when lastName empty',
    out === 'Hi Maria, thanks.', out);
}

console.log('\n── lastName populated — both names render ──');
{
  const template = 'Hi {firstName} {lastName}, thanks.';
  const out = renderClient(template, { firstName: 'Maria', lastName: 'Lopez' });
  check('renders firstName + lastName when both present',
    out === 'Hi Maria Lopez, thanks.', out);
}

console.log('\n── unknown placeholders left literal ──');
{
  const out = renderClient('Hello {firstName}, your {bogus} is ready.', { firstName: 'X' });
  check('unknown {bogus} stays as literal text',
    out === 'Hello X, your {bogus} is ready.', out);
}

console.log('\n── pure function — same input, same output ──');
{
  const vars = { firstName: 'A', businessName: 'B', serviceType: 'C', city: 'D', reviewLink: 'E' };
  const a = renderClient(DEFAULT, vars);
  const b = renderClient(DEFAULT, vars);
  check('determinism', a === b);
}

console.log('\n── functions mirror is byte-identical ──');
{
  const vars = { firstName: 'A', businessName: 'B', serviceType: 'C', city: 'D', reviewLink: 'E' };
  check('client + functions copies produce identical output',
    renderClient(DEFAULT, vars) === renderFn(DEFAULT, vars));
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
