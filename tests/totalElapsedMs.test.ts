// tests/totalElapsedMs.test.ts
// Run: npx tsx tests/totalElapsedMs.test.ts

import { totalElapsedMs } from '@/lib/jobTime';
import type { Job, TimeSession } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const s = (start: string, end?: string): TimeSession => ({
  startAt: start, byUid: 'u', endAt: end,
});

console.log('\n┌─ totalElapsedMs ──────────────────────────────────');
check('empty → 0',
  totalElapsedMs({ timeSessions: [] }) === 0);
check('undefined → 0',
  totalElapsedMs({ timeSessions: undefined } as Pick<Job, 'timeSessions'>) === 0);
{
  const ms = totalElapsedMs({
    timeSessions: [s('2026-05-21T10:00:00Z', '2026-05-21T11:00:00Z')],
  });
  check('1 closed session of 1 hour = 3,600,000 ms', ms === 3_600_000);
}
{
  const ms = totalElapsedMs({
    timeSessions: [
      s('2026-05-21T10:00:00Z', '2026-05-21T11:00:00Z'),
      s('2026-05-21T13:00:00Z', '2026-05-21T14:30:00Z'),
    ],
  });
  check('2 closed sessions: 1h + 1.5h = 9,000,000 ms', ms === 9_000_000);
}
{
  const now = new Date('2026-05-21T14:30:00Z');
  const ms = totalElapsedMs({
    timeSessions: [
      s('2026-05-21T10:00:00Z', '2026-05-21T11:00:00Z'),
      s('2026-05-21T14:00:00Z'),
    ],
  }, now);
  check('closed + open: 1h + 30m = 5,400,000 ms', ms === 5_400_000);
}
{
  const now = new Date('2026-05-21T10:42:00Z');
  const ms = totalElapsedMs({
    timeSessions: [s('2026-05-21T10:00:00Z')],
  }, now);
  check('single open session: 42m = 2,520,000 ms', ms === 2_520_000);
}
{
  const ms = totalElapsedMs({
    timeSessions: [{ startAt: 'not-a-date', byUid: 'u', endAt: '2026-05-21T11:00:00Z' }],
  });
  check('invalid startAt → contributes 0', ms === 0);
}
{
  const ms = totalElapsedMs({
    timeSessions: [s('2026-05-21T11:00:00Z', '2026-05-21T10:00:00Z')],
  });
  check('negative delta ignored', ms === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
