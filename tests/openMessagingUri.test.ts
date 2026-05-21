// tests/openMessagingUri.test.ts
// Run: npx tsx tests/openMessagingUri.test.ts

import { buildSmsUri, buildMailtoUri } from '@/lib/openMessagingUri';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ buildSmsUri ─────────────────────────────────────');
check('basic SMS URI',
  buildSmsUri('5551234567', 'Hi there') === 'sms:5551234567?&body=Hi%20there');
check('strips formatting from phone',
  buildSmsUri('(555) 123-4567', 'X') === 'sms:5551234567?&body=X');
check('preserves leading +',
  buildSmsUri('+15551234567', 'X') === 'sms:+15551234567?&body=X');
check('encodes special chars in body',
  buildSmsUri('555', 'hi & bye') === 'sms:555?&body=hi%20%26%20bye');
check('encodes newlines',
  buildSmsUri('555', 'line1\nline2') === 'sms:555?&body=line1%0Aline2');
check('empty phone produces sms: with empty number',
  buildSmsUri('', 'X') === 'sms:?&body=X');

console.log('\n┌─ buildMailtoUri ──────────────────────────────────');
check('basic mailto URI',
  buildMailtoUri('j@d.com', 'Hi', 'Body text') === 'mailto:j@d.com?subject=Hi&body=Body%20text');
check('trims email whitespace',
  buildMailtoUri('  j@d.com  ', 'S', 'B') === 'mailto:j@d.com?subject=S&body=B');
check('encodes subject + body separately',
  buildMailtoUri('j@d.com', 'Hi & you', 'a=1&b=2') === 'mailto:j@d.com?subject=Hi%20%26%20you&body=a%3D1%26b%3D2');
check('multi-line email body',
  buildMailtoUri('j@d.com', 'S', 'L1\nL2') === 'mailto:j@d.com?subject=S&body=L1%0AL2');
check('empty email allowed',
  buildMailtoUri('', 'S', 'B') === 'mailto:?subject=S&body=B');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
