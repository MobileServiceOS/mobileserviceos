// tests/normalizeHex.test.ts
// Run: npx tsx tests/normalizeHex.test.ts
//
// Pins the contract for the single source of truth for brand-color
// hex normalization. The "can't change color" report on Wheel Rush
// was caused by a stricter applyBrandColors path silently rejecting
// bare-hex values that a permissive picker accepted. These tests
// codify that any reasonable input gets canonicalized to #rrggbb so
// every downstream consumer (Header, invoice PDF, CSS vars) sees
// the same shape.

import { normalizeHex, isValidHex } from '@/lib/utils';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ normalizeHex ────────────────────────────────────');

// Already canonical
check('canonical 6-char with # passes through (lowercased)',
  normalizeHex('#C8A44A', '#000000') === '#c8a44a');
check('canonical lowercase pass-through',
  normalizeHex('#c8a44a', '#000000') === '#c8a44a');

// Bare hex (the actual production bug)
check('bare 6-char hex gets # prepended',
  normalizeHex('c8a44a', '#000000') === '#c8a44a');
check('bare uppercase 6-char hex lowercased + prefixed',
  normalizeHex('C8A44A', '#000000') === '#c8a44a');

// 3-char shorthand
check('3-char hex expands to 6-char',
  normalizeHex('#fa3', '#000000') === '#ffaa33');
check('bare 3-char hex expands + prefixes',
  normalizeHex('fa3', '#000000') === '#ffaa33');
check('mixed-case 3-char lowercased',
  normalizeHex('#FA3', '#000000') === '#ffaa33');

// Whitespace tolerance
check('trims leading whitespace',
  normalizeHex('  #c8a44a', '#000000') === '#c8a44a');
check('trims trailing whitespace',
  normalizeHex('#c8a44a  ', '#000000') === '#c8a44a');

// Invalid → fallback
check('empty string → fallback',
  normalizeHex('', '#deadbe') === '#deadbe');
check('null → fallback',
  normalizeHex(null, '#deadbe') === '#deadbe');
check('undefined → fallback',
  normalizeHex(undefined, '#deadbe') === '#deadbe');
check('non-hex word → fallback',
  normalizeHex('burgundy', '#deadbe') === '#deadbe');
check('partial hex (5 chars) → fallback',
  normalizeHex('#c8a44', '#deadbe') === '#deadbe');
check('hex with extra chars → fallback',
  normalizeHex('#c8a44az', '#deadbe') === '#deadbe');
check('rgb() string → fallback',
  normalizeHex('rgb(200,164,74)', '#deadbe') === '#deadbe');
check('# only → fallback',
  normalizeHex('#', '#deadbe') === '#deadbe');

console.log('\n┌─ isValidHex ──────────────────────────────────────');

// isValidHex must accept everything normalizeHex emits.
check('isValidHex accepts canonical 6-char',
  isValidHex('#c8a44a'));
check('isValidHex accepts 3-char with #',
  isValidHex('#fa3'));
check('isValidHex rejects bare 6-char (no #)',
  !isValidHex('c8a44a'));
check('isValidHex rejects empty',
  !isValidHex(''));

// Round-trip invariant: anything normalizeHex returns must pass
// isValidHex. This is the contract that fixes the Wheel Rush bug.
console.log('\n┌─ Round-trip invariant ────────────────────────────');
const samples = ['c8a44a', '#c8a44a', '#fa3', 'fa3', 'CCC', 'burgundy', '', '#c8a44'];
let invariantHeld = true;
for (const sample of samples) {
  const normalized = normalizeHex(sample, '#000000');
  if (!isValidHex(normalized)) {
    invariantHeld = false;
    console.log(`  ✗ normalizeHex('${sample}') = '${normalized}' fails isValidHex`);
  }
}
check('every normalizeHex output passes isValidHex', invariantHeld);

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
