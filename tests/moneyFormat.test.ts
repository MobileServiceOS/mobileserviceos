// tests/moneyFormat.test.ts
// Run: npx tsx tests/moneyFormat.test.ts
//
// Pin sign-before-$ on negative numbers. Pre-fix utils.ts:19 emitted
// '$' + Math.round(v) — for v = -50 the output was "$-50", which at
// a glance outdoors in sunlight reads as "$50". Techs were saving
// jobs at a loss without realising. Spec: "-$50" reads as "negative
// fifty" instantly.

import { money } from '@/lib/utils';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── REGRESSION: negative numbers render -$N not $-N ──');
check('-50 → "-$50"',  money(-50)  === '-$50',  `got ${JSON.stringify(money(-50))}`);
check('-0.4 → "$0"',   money(-0.4) === '$0',    `got ${JSON.stringify(money(-0.4))}`);
check('-0.6 → "-$1"',  money(-0.6) === '-$1',   `got ${JSON.stringify(money(-0.6))}`);
check('-1000 → "-$1,000"', money(-1000) === '-$1,000', `got ${JSON.stringify(money(-1000))}`);

console.log('\n── positive path unchanged ──');
check('50 → "$50"',         money(50)   === '$50');
check('0 → "$0"',           money(0)    === '$0');
check('1000 → "$1,000"',    money(1000) === '$1,000');
check('1234567 → "$1,234,567"', money(1234567) === '$1,234,567');

console.log('\n── null/undefined/empty → "$0" ──');
check('null → "$0"',      money(null)      === '$0');
check('undefined → "$0"', money(undefined) === '$0');
check('"" → "$0"',        money('')        === '$0');

console.log('\n── string numerics work ──');
check('"-50" → "-$50"',  money('-50')  === '-$50');
check('"100.5" → "$101"', money('100.5') === '$101');

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
