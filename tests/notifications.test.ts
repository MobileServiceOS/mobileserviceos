// tests/notifications.test.ts
// Run: npx tsx tests/notifications.test.ts
//
// Pure-logic coverage for the notification helpers — readBy state,
// unread count, relative timestamp formatter. Firestore-bound
// helpers (subscribe/create/markRead) are exercised in the UI layer.

import {
  isUnreadFor,
  notificationsUnreadCount,
  notificationRelative,
} from '@/lib/notificationTime';
import type { NotificationDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); }
};

const NOW = Date.parse('2026-05-22T12:00:00Z');

const mkNotif = (over: Partial<NotificationDoc> = {}): NotificationDoc => ({
  id: 'n1',
  kind: 'job_assigned',
  title: 'New job assigned',
  createdAt: '2026-05-22T11:30:00Z',
  readBy: {},
  ...over,
});

// ─── isUnreadFor ────────────────────────────────────────────────────
console.log('\n┌─ isUnreadFor ─────────────────────────────────────');
check('no uid → false (avoid false-positive badges for unauthed)',
  isUnreadFor(mkNotif(), null) === false);
check('uid absent from readBy → unread',
  isUnreadFor(mkNotif({ readBy: {} }), 'tech1') === true);
check('uid present in readBy → read',
  isUnreadFor(mkNotif({ readBy: { tech1: '2026-05-22T11:45:00Z' } }), 'tech1') === false);
check('different uid present → still unread for me',
  isUnreadFor(mkNotif({ readBy: { other: '2026-05-22T11:45:00Z' } }), 'tech1') === true);
check('readBy undefined → unread',
  isUnreadFor(mkNotif({ readBy: undefined }), 'tech1') === true);

// ─── notificationsUnreadCount ──────────────────────────────────────
console.log('\n┌─ notificationsUnreadCount ────────────────────────');
const list: NotificationDoc[] = [
  mkNotif({ id: 'a', readBy: {} }),
  mkNotif({ id: 'b', readBy: { tech1: '2026-05-22T11:55:00Z' } }),
  mkNotif({ id: 'c', readBy: { other: '2026-05-22T11:55:00Z' } }),
];
check('3 notifs, 1 read for tech1 → unread count = 2',
  notificationsUnreadCount(list, 'tech1') === 2);
check('different user (other) → unread count = 2',
  notificationsUnreadCount(list, 'other') === 2);
check('no uid → 0',
  notificationsUnreadCount(list, null) === 0);
check('empty list → 0',
  notificationsUnreadCount([], 'tech1') === 0);

// ─── notificationRelative ───────────────────────────────────────────
console.log('\n┌─ notificationRelative ────────────────────────────');
check('undefined → ""',
  notificationRelative(undefined, NOW) === '');
check('malformed → ""',
  notificationRelative('not-a-date', NOW) === '');
check('30s ago → "now"',
  notificationRelative('2026-05-22T11:59:30Z', NOW) === 'now');
check('5m',
  notificationRelative('2026-05-22T11:55:00Z', NOW) === '5m');
check('1h',
  notificationRelative('2026-05-22T11:00:00Z', NOW) === '1h');
check('23h',
  notificationRelative('2026-05-21T13:00:00Z', NOW) === '23h');
check('1d',
  notificationRelative('2026-05-21T12:00:00Z', NOW) === '1d');
check('6d',
  notificationRelative('2026-05-16T12:00:00Z', NOW) === '6d');
check('1w',
  notificationRelative('2026-05-15T12:00:00Z', NOW) === '1w');
check('5w',
  notificationRelative('2026-04-17T12:00:00Z', NOW) === '5w');
check('compact: weeks cap at 51 before flipping to years',
  /^(5[01]w|1y)$/.test(notificationRelative('2025-05-22T12:00:00Z', NOW)));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
