// tests/visibleNotifications.test.ts
// Run: npx tsx tests/visibleNotifications.test.ts

import { visibleNotifications } from '@/lib/visibleNotifications';
import type { NotificationDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const n = (over: Partial<NotificationDoc>): NotificationDoc => ({
  id: 'n', createdAt: '2026-05-21T10:00:00Z', jobId: 'j',
  audience: 'owner', channel: 'in_app', templateId: 'tech_assigned',
  body: 'b', byUid: 'owner', toStage: 'dispatched',
  ...over,
} as NotificationDoc);

const notifs: NotificationDoc[] = [
  n({ id: 'a', audience: 'owner', byUid: 'owner' }),
  n({ id: 'b', audience: 'technician', toUid: 'tech1', byUid: 'owner' }),
  n({ id: 'c', audience: 'technician', toUid: 'tech2', byUid: 'owner' }),
  n({ id: 'd', audience: 'customer', toPhone: '555', byUid: 'tech1', channel: 'sms' }),
];

console.log('\n┌─ visibleNotifications ────────────────────────────');
check('owner sees all 4', visibleNotifications(notifs, 'owner', 'owner').length === 4);
check('admin sees all 4', visibleNotifications(notifs, 'admin', 'admin').length === 4);
check('tech1 sees own technician notif + own-triggered customer notif',
  visibleNotifications(notifs, 'technician', 'tech1').length === 2);
check('tech1 does not see tech2 notification',
  !visibleNotifications(notifs, 'technician', 'tech1').some((x) => x.id === 'c'));
check('tech2 sees only own technician notif',
  visibleNotifications(notifs, 'technician', 'tech2').length === 1);
check('tech with no jobs sees empty',
  visibleNotifications(notifs, 'technician', 'unknown').length === 0);
check('null role → empty',
  visibleNotifications(notifs, null, 'tech1').length === 0);
check('undefined role → empty',
  visibleNotifications(notifs, undefined, 'tech1').length === 0);
check('tech with null uid → empty',
  visibleNotifications(notifs, 'technician', null).length === 0);
check('owner returns new array (not same reference)',
  visibleNotifications(notifs, 'owner', 'owner') !== notifs);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
