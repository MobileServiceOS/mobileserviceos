// src/lib/visibleNotifications.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure role-based filter for the notifications collection. Owner /
//  admin see everything; tech sees notifications targeted at them
//  (audience: technician + toUid === me) OR notifications they
//  triggered (byUid === me).
// ═══════════════════════════════════════════════════════════════════

import type { NotificationDoc, Role } from '@/types';

export function visibleNotifications(
  notifs: ReadonlyArray<NotificationDoc>,
  role: Role | null | undefined,
  uid: string | null | undefined,
): NotificationDoc[] {
  if (role === 'owner' || role === 'admin') {
    return notifs.slice();
  }
  if (role === 'technician' && uid) {
    return notifs.filter((n) =>
      (n.audience === 'technician' && n.toUid === uid) ||
      n.byUid === uid,
    );
  }
  return [];
}
