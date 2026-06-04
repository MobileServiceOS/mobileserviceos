// ═══════════════════════════════════════════════════════════════════
//  tests/phone.test.ts — Canonical phone normalization tests
//  Run: npx tsx tests/phone.test.ts
//  Spec ref: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//            §"Phone Number Normalization (canonical)"
// ═══════════════════════════════════════════════════════════════════
import { normalizePhone, isValidPhone, formatPhoneForDisplay } from '@/lib/phone';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}
function eq<T>(actual: T, expected: T): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

console.log('\n┌─ normalizePhone: valid inputs ──────────────────');
check('10-digit bare', eq(normalizePhone('3058977030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
check('formatted', eq(normalizePhone('(305) 897-7030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
check('+1 prefix', eq(normalizePhone('+13058977030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
check('dotted', eq(normalizePhone('305.897.7030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));
check('dashed with 1-', eq(normalizePhone('1-305-897-7030'), { e164: '+13058977030', digits: '13058977030', formatted: '(305) 897-7030', valid: true }));

console.log('\n┌─ normalizePhone: invalid inputs (must return blank e164/digits) ──');
check('empty string', eq(normalizePhone(''), { e164: '', digits: '', formatted: '', valid: false }));
check('short code 911', eq(normalizePhone('911'), { e164: '', digits: '', formatted: '911', valid: false }));
check('9-digit too short', eq(normalizePhone('305-897-703'), { e164: '', digits: '', formatted: '305-897-703', valid: false }));
check('14-digit too long', eq(normalizePhone('13058977030555'), { e164: '', digits: '', formatted: '13058977030555', valid: false }));
check('UK intl rejected (v1 US-only)', eq(normalizePhone('+447911123456'), { e164: '', digits: '', formatted: '+447911123456', valid: false }));
check('extension stripped → garbage rejected', eq(normalizePhone('305-897-7030 x123'), { e164: '', digits: '', formatted: '305-897-7030 x123', valid: false }));
check('vanity letters rejected', eq(normalizePhone('1-800-FLOWERS'), { e164: '', digits: '', formatted: '1-800-FLOWERS', valid: false }));

console.log('\n┌─ normalizePhone: type contract ─────────────────');
let threwNull = false;
try { normalizePhone(null as unknown as string); } catch { threwNull = true; }
check('null input throws TypeError', threwNull);
let threwUndef = false;
try { normalizePhone(undefined as unknown as string); } catch { threwUndef = true; }
check('undefined input throws TypeError', threwUndef);

console.log('\n┌─ isValidPhone ──────────────────────────────────');
check('valid 10-digit', isValidPhone('3058977030') === true);
check('valid +1', isValidPhone('+13058977030') === true);
check('invalid empty', isValidPhone('') === false);
check('invalid intl', isValidPhone('+447911123456') === false);

console.log('\n┌─ formatPhoneForDisplay ─────────────────────────');
check('+13058977030 → (305) 897-7030', formatPhoneForDisplay('+13058977030') === '(305) 897-7030');
check('empty → empty', formatPhoneForDisplay('') === '');
check('invalid passthrough', formatPhoneForDisplay('foo') === 'foo');

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
