// tests/chipFrequency.test.ts
// Run: npx tsx tests/chipFrequency.test.ts

import { rankByUsage } from '@/lib/chipFrequency';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const job = (over: Partial<Job>): Job => ({
  id: 'j', date: '2026-05-27', service: '', vehicleType: '',
  ...over,
} as Job);

console.log('\n┌─ rankByUsage ─────────────────────────────────');
{
  const opts = ['Repair', 'Install', 'Rotate'] as const;
  const out = rankByUsage(opts, [], 'service');
  check('empty jobs → original order preserved',
    out[0] === 'Repair' && out[1] === 'Install' && out[2] === 'Rotate');
}
{
  const opts = ['Repair', 'Install', 'Rotate'] as const;
  const jobs = [
    job({ service: 'Install' }),
    job({ service: 'Install' }),
    job({ service: 'Repair' }),
  ];
  const out = rankByUsage(opts, jobs, 'service');
  check('most-used sorts first', out[0] === 'Install' && out[1] === 'Repair' && out[2] === 'Rotate');
}
{
  const opts = ['A', 'B', 'C'] as const;
  const jobs = [job({ service: 'A' }), job({ service: 'C' })];
  const out = rankByUsage(opts, jobs, 'service');
  check('equal-count ties: original order preserved',
    out[0] === 'A' && out[1] === 'C' && out[2] === 'B');
}
{
  const opts = ['Repair', 'Install'] as const;
  const jobs = [
    job({ service: 'Install' }),
    job({ service: 'Unknown Service' }), // not in opts — should be ignored
  ];
  const out = rankByUsage(opts, jobs, 'service');
  check('values not in options list are ignored',
    out[0] === 'Install' && out[1] === 'Repair');
}
{
  const opts = ['x'] as const;
  const out = rankByUsage(opts, [job({ service: undefined as unknown as string })], 'service');
  check('missing field value does not error', out[0] === 'x');
}
{
  const out = rankByUsage([] as const, [job({})], 'service');
  check('empty options → empty result', out.length === 0);
}
{
  // returns a NEW array — does not mutate input
  const opts = ['B', 'A'] as const;
  const orig = [...opts];
  rankByUsage(opts, [], 'service');
  check('does not mutate input options',
    opts[0] === orig[0] && opts[1] === orig[1]);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
