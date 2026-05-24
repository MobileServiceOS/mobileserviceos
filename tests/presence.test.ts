// tests/presence.test.ts
// Run: npx tsx tests/presence.test.ts
//
// Pure-logic coverage for the presence helpers. setMyPresence /
// subscribeToPresence touch Firestore and are out of scope here;
// the testable surface is the timestamp + staleness math.

import { presenceRelative, isPresenceStale } from '@/lib/presenceTime';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); }
};

const NOW = Date.parse('2026-05-22T12:00:00Z');

// ─── presenceRelative ──────────────────────────────────────────────
console.log('\n┌─ presenceRelative ────────────────────────────────');
check('undefined → "—"',
  presenceRelative(undefined, NOW) === '—');
check('empty string → "—"',
  presenceRelative('', NOW) === '—');
check('malformed → "—"',
  presenceRelative('not-a-date', NOW) === '—');
check('just now (10s ago)',
  presenceRelative('2026-05-22T11:59:50Z', NOW) === 'just now');
check('5 min ago',
  presenceRelative('2026-05-22T11:55:00Z', NOW) === '5 min ago');
check('1 min ago',
  presenceRelative('2026-05-22T11:59:00Z', NOW) === '1 min ago');
check('2 hr ago',
  presenceRelative('2026-05-22T10:00:00Z', NOW) === '2 hr ago');
check('3d ago',
  presenceRelative('2026-05-19T12:00:00Z', NOW) === '3d ago');
check('30d+ ago cap',
  presenceRelative('2025-01-01T12:00:00Z', NOW) === '30d+ ago');

// ─── isPresenceStale ───────────────────────────────────────────────
console.log('\n┌─ isPresenceStale ─────────────────────────────────');
check('undefined → stale',
  isPresenceStale(undefined, NOW) === true);
check('just-now → fresh',
  isPresenceStale('2026-05-22T11:59:30Z', NOW) === false);
check('29 min ago → fresh (under default 30m threshold)',
  isPresenceStale('2026-05-22T11:31:00Z', NOW) === false);
check('31 min ago → stale',
  isPresenceStale('2026-05-22T11:29:00Z', NOW) === true);
check('custom threshold 5m: 6 min ago → stale',
  isPresenceStale('2026-05-22T11:54:00Z', NOW, 5 * 60_000) === true);
check('custom threshold 5m: 4 min ago → fresh',
  isPresenceStale('2026-05-22T11:56:00Z', NOW, 5 * 60_000) === false);
check('malformed → stale',
  isPresenceStale('not-a-date', NOW) === true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
