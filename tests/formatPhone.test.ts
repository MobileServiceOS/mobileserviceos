// ═══════════════════════════════════════════════════════════════════
//  tests/formatPhone.test.ts — Phone number formatting tests
// ═══════════════════════════════════════════════════════════════════
//  Run: npx tsx tests/formatPhone.test.ts
//
//  Verifies digitsOnly + formatPhone + formatPhonePartial across the
//  realistic inputs an operator types into the AddJob customer phone
//  field on a phone keypad in the field — including partial entries,
//  pasted strings from other apps, and country-code variants.
// ═══════════════════════════════════════════════════════════════════

import { digitsOnly, formatPhone, formatPhonePartial } from '@/lib/formatPhone';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}
function eq<T>(actual: T, expected: T): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

console.log('\n┌─ digitsOnly ────────────────────────────────────');
check('empty string → empty', digitsOnly('') === '');
check('null → empty', digitsOnly(null) === '');
check('undefined → empty', digitsOnly(undefined) === '');
check('strips all non-digits', digitsOnly('(555) 123-4567') === '5551234567');
check('keeps leading 1', digitsOnly('+1 555 123 4567') === '15551234567');
check('handles letters mixed in', digitsOnly('call 555 abc 123') === '555123');

console.log('\n┌─ formatPhone (canonical) ────────────────────────');
check('empty → empty', formatPhone('') === '');
check('null → empty', formatPhone(null) === '');
check('10 digits → (NNN) NNN-NNNN', formatPhone('5551234567') === '(555) 123-4567');
check('already-formatted 10 digits → same canonical', formatPhone('(555) 123-4567') === '(555) 123-4567');
check('11 digits starting with 1 → +1 (NNN) NNN-NNNN', formatPhone('15551234567') === '+1 (555) 123-4567');
check('11 digits with + and country code → +1 form', formatPhone('+1 (555) 123-4567') === '+1 (555) 123-4567');
check('dashes-only input → reformats', formatPhone('555-123-4567') === '(555) 123-4567');
check('spaces-only input → reformats', formatPhone('555 123 4567') === '(555) 123-4567');
check('9 digits (incomplete) → digits-only (no formatting)', formatPhone('555123456') === '555123456');
check('11 digits NOT starting with 1 → digits-only', formatPhone('25551234567') === '25551234567');
check('12 digits → digits-only', formatPhone('123456789012') === '123456789012');

console.log('\n┌─ formatPhonePartial (progressive) ──────────────');
check('empty → empty', formatPhonePartial('') === '');
check('1 digit → "5"', formatPhonePartial('5') === '5');
check('3 digits → "555" (no parens yet)', formatPhonePartial('555') === '555');
check('4 digits → "(555) 1"', formatPhonePartial('5551') === '(555) 1');
check('6 digits → "(555) 123"', formatPhonePartial('555123') === '(555) 123');
check('7 digits → "(555) 123-4"', formatPhonePartial('5551234') === '(555) 123-4');
check('10 digits → full canonical', formatPhonePartial('5551234567') === '(555) 123-4567');
check('11 digits starting 1 → +1 form', formatPhonePartial('15551234567') === '+1 (555) 123-4567');
check('clips at 11 digits', formatPhonePartial('15551234567890') === '+1 (555) 123-4567');
check('progressive ignores non-digits as user types', formatPhonePartial('(555) 12') === '(555) 12');
check('progressive: pasting full formatted number', formatPhonePartial('(555) 123-4567') === '(555) 123-4567');

console.log('\n┌─ realistic operator scenarios ──────────────────');
check(
  'tech types digit-by-digit',
  eq(
    ['5', '55', '555', '5551', '55512', '555123', '5551234', '55512345', '555123456', '5551234567'].map(formatPhonePartial),
    ['5', '55', '555', '(555) 1', '(555) 12', '(555) 123', '(555) 123-4', '(555) 123-45', '(555) 123-456', '(555) 123-4567'],
  ),
);
check(
  'pasted contact card with weird chars',
  formatPhone('  +1.555.123.4567  ') === '+1 (555) 123-4567',
);
check(
  'idempotent: format(format(x)) === format(x)',
  formatPhone(formatPhone('5551234567')) === formatPhone('5551234567'),
);

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
