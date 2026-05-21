// tests/activeSession.test.ts
// Run: npx tsx tests/activeSession.test.ts

import { activeSession } from '@/lib/jobTime';
import type { Job, TimeSession } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const s = (over: Partial<TimeSession>): TimeSession => ({
  startAt: '2026-05-21T10:00:00Z', byUid: 'u', ...over,
});

console.log('\n┌─ activeSession ───────────────────────────────────');
check('undefined timeSessions → undefined',
  activeSession({ timeSessions: undefined } as Pick<Job, 'timeSessions'>) === undefined);
check('empty → undefined',
  activeSession({ timeSessions: [] }) === undefined);
check('all closed → undefined',
  activeSession({ timeSessions: [s({ endAt: '2026-05-21T11:00:00Z' })] }) === undefined);
{
  const open = s({ startAt: '2026-05-21T12:00:00Z' });
  check('one open → returns it',
    activeSession({ timeSessions: [open] }) === open);
}
{
  const closed = s({ endAt: '2026-05-21T11:00:00Z' });
  const open = s({ startAt: '2026-05-21T12:00:00Z' });
  check('mixed: returns the open',
    activeSession({ timeSessions: [closed, open] }) === open);
}
{
  const early = s({ startAt: '2026-05-21T08:00:00Z' });
  const late = s({ startAt: '2026-05-21T14:00:00Z' });
  check('two open: returns the latest-started',
    activeSession({ timeSessions: [early, late] }) === late);
}
check('endAt explicitly null → treated as open',
  activeSession({ timeSessions: [s({ endAt: null as unknown as undefined })] })?.byUid === 'u');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
