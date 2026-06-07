// tests/bandileroModuleStatus.test.ts
// Run: npx tsx tests/bandileroModuleStatus.test.ts
//
// Module Data-Confidence: CONNECTED / PARTIAL / NOT_CONNECTED, derived
// deterministically from real counts + connectivity (never fabricated).

import { statusFromCount, statusFromFlag, statusPartial } from '@/lib/bandilero/moduleStatus';

let passed = 0, failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}`); }
}

console.log('\n── statusFromCount ──');
check('0 rows → NOT_CONNECTED', statusFromCount(0) === 'NOT_CONNECTED');
check('>0 rows → CONNECTED', statusFromCount(5) === 'CONNECTED');

console.log('\n── statusFromFlag ──');
check('true → CONNECTED', statusFromFlag(true) === 'CONNECTED');
check('false → NOT_CONNECTED', statusFromFlag(false) === 'NOT_CONNECTED');

console.log('\n── statusPartial ──');
check('none → NOT_CONNECTED', statusPartial(0, 0) === 'NOT_CONNECTED');
check('total>0 but 0 with data → NOT_CONNECTED', statusPartial(3, 0) === 'NOT_CONNECTED');
check('some but not all → PARTIAL', statusPartial(3, 2) === 'PARTIAL');
check('all → CONNECTED', statusPartial(3, 3) === 'CONNECTED');

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
