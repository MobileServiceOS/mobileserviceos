// tests/formatDuration.test.ts
// Run: npx tsx tests/formatDuration.test.ts

import { formatDuration } from '@/lib/jobTime';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;

console.log('\n┌─ formatDuration ──────────────────────────────────');
check('0 ms → "0s"', formatDuration(0) === '0s');
check('negative → "0s"', formatDuration(-1) === '0s');
check('500 ms → "0s"', formatDuration(500) === '0s');
check('3 sec → "3s"', formatDuration(3 * SEC) === '3s');
check('59 sec → "59s"', formatDuration(59 * SEC) === '59s');
check('60 sec → "1m"', formatDuration(60 * SEC) === '1m');
check('42 min → "42m"', formatDuration(42 * MIN) === '42m');
check('59 min → "59m"', formatDuration(59 * MIN) === '59m');
check('60 min → "1h"', formatDuration(60 * MIN) === '1h');
check('1h 23m → "1h 23m"', formatDuration(HR + 23 * MIN) === '1h 23m');
check('2h exact → "2h"', formatDuration(2 * HR) === '2h');
check('5h 7m → "5h 7m"', formatDuration(5 * HR + 7 * MIN) === '5h 7m');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
