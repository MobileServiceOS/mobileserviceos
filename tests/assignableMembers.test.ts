// tests/assignableMembers.test.ts
// Run: npx tsx tests/assignableMembers.test.ts

import { assignableMembers, UNASSIGNED } from '@/lib/jobPermissions';
import type { MemberDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const mem = (over: Partial<MemberDoc>): MemberDoc => ({
  uid: 'm', email: 'm@example.com', businessId: 'b', role: 'technician',
  status: 'active', ...over,
} as MemberDoc);

console.log('\n┌─ assignableMembers ───────────────────────────────');
{
  const opts = assignableMembers([], 'owner-uid');
  check('empty members + owner uid → 2 options (Me + Unassigned)', opts.length === 2);
  check('first option is Me with current uid',
    opts[0].uid === 'owner-uid' && opts[0].isSelf === true);
  check('first option label is "Me"', opts[0].label === 'Me');
  check('second option is Unassigned (uid === UNASSIGNED constant)',
    opts[1].uid === UNASSIGNED && opts[1].label === 'Unassigned');
}
{
  const members = [
    mem({ uid: 'tech1', displayName: 'Bob' }),
    mem({ uid: 'tech2', displayName: 'Alice' }),
  ];
  const opts = assignableMembers(members, 'owner-uid');
  check('2 techs + owner uid → 4 options', opts.length === 4);
  check('techs sorted alphabetically (Alice before Bob)',
    opts[2].label === 'Alice' && opts[3].label === 'Bob');
  check('first tech option uid set correctly',
    opts[2].uid === 'tech2');
}
{
  const members = [
    mem({ uid: 'tech1', displayName: 'Bob', status: 'pending' }),
    mem({ uid: 'tech2', displayName: 'Alice' }),
    mem({ uid: 'tech3', displayName: 'Carol', status: 'disabled' }),
  ];
  const opts = assignableMembers(members, 'owner-uid');
  check('non-active members filtered out',
    opts.length === 3 && opts[2].label === 'Alice');
}
{
  const members = [
    mem({ uid: 'admin1', displayName: 'Adam', role: 'admin' }),
    mem({ uid: 'tech1', displayName: 'Bob' }),
    mem({ uid: 'owner1', displayName: 'O', role: 'owner' }),
  ];
  const opts = assignableMembers(members, 'owner-uid');
  check('non-technician roles excluded',
    opts.length === 3 && opts[2].label === 'Bob');
}
{
  const members = [
    mem({ uid: 'me', displayName: 'Me Tech' }),
    mem({ uid: 'tech1', displayName: 'Bob' }),
  ];
  const opts = assignableMembers(members, 'me');
  check('current uid excluded from tech list (appears only as Me)',
    opts.length === 3 && !opts.slice(2).some((o) => o.uid === 'me'));
}
{
  // Member with no displayName falls back to email
  const members = [mem({ uid: 't1', email: 'tech@example.com', displayName: undefined })];
  const opts = assignableMembers(members, 'owner-uid');
  check('falls back to email when displayName missing',
    opts[2].label === 'tech@example.com');
}
{
  // Member with no uid (pending invite) filtered out
  const members = [mem({ uid: undefined, displayName: 'Pending', status: 'active' })];
  const opts = assignableMembers(members, 'owner-uid');
  check('members without uid filtered out',
    opts.length === 2);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
