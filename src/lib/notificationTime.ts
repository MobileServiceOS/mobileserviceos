import type { NotificationDoc } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  Pure notification helpers — no Firebase imports. Re-exported from
//  src/lib/notifications.ts so consumers can keep a single import
//  surface; tested in tests/notifications.test.ts.
// ─────────────────────────────────────────────────────────────────────

/**
 * Has the given user marked this notification as read? Pure check
 * against the `readBy` map; missing entry = unread.
 */
export function isUnreadFor(notification: NotificationDoc, uid: string | null | undefined): boolean {
  if (!uid) return false;
  const map = notification.readBy || {};
  return !map[uid];
}

/**
 * Count unread notifications for a user across a list. Drives the
 * header badge.
 */
export function notificationsUnreadCount(
  notifications: ReadonlyArray<NotificationDoc>,
  uid: string | null | undefined,
): number {
  if (!uid) return 0;
  let n = 0;
  for (const x of notifications) if (isUnreadFor(x, uid)) n++;
  return n;
}

/**
 * Short relative timestamp for the notification list ("2m", "5h",
 * "3d", "6w"). Compact on purpose — every row needs to show this
 * without breaking the layout. Returns "" for missing / unparseable.
 */
export function notificationRelative(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const delta = Math.max(0, now - t);
  const sec = Math.floor(delta / 1000);
  if (sec < 60)            return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60)            return `${min}m`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)            return `${hr}h`;
  const d   = Math.floor(hr / 24);
  if (d   < 7)             return `${d}d`;
  const w   = Math.floor(d / 7);
  if (w   < 52)            return `${w}w`;
  const y   = Math.floor(w / 52);
  return `${y}y`;
}
