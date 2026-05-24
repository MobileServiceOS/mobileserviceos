import { collection, doc, onSnapshot, setDoc, query, where } from 'firebase/firestore';
import { _auth, _db } from '@/lib/firebase';
import type {
  NotificationDoc, NotificationCategory, NotificationPrefs,
} from '@/types';
import { NOTIFICATION_CATEGORY_BY_KIND } from '@/types';
import { uid as makeId } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────
//  Notification storage layer. Pure timestamp helpers live in
//  notificationTime.ts so they're tsx-testable without booting
//  Firebase.
//
//  Write side
//  ──────────
//  createNotification() generates the id + createdAt + readBy={} and
//  writes to businesses/{bid}/notifications/{id}. Caller provides
//  the kind, title, optional body / targetUid / routeTo / meta.
//
//  Read side
//  ─────────
//  subscribeToMyNotifications() listens to every notification doc in
//  the business and filters client-side to those visible to the
//  current user (no targetUid OR targetUid === me). Returns a
//  callback with the sorted (newest first) list.
//
//  Read-state
//  ──────────
//  Each notification carries readBy: Record<uid, isoTimestamp>. The
//  current user is "unread" if their uid isn't in the map. markRead
//  writes a merge with { readBy: { [uid]: now } } so we don't
//  clobber other users' state.
//
//  Preferences
//  ───────────
//  notificationPrefs/{uid} holds per-category opt-out flags. A
//  missing category defaults to ON (notifications generated). On the
//  CREATE side, callers can call userHasOptedOut(prefs, kind) to
//  skip writing a doc the user wouldn't see anyway.
// ─────────────────────────────────────────────────────────────────────

export { isUnreadFor, notificationsUnreadCount, notificationRelative } from '@/lib/notificationTime';

/**
 * Write a notification doc. Caller supplies the minimum fields;
 * helper fills in id / createdAt / readBy.
 *
 * No-ops (returns null) when there's no businessId or Firestore
 * isn't ready — caller can fire-and-forget without guarding.
 */
export async function createNotification(
  businessId: string | null,
  input: Omit<NotificationDoc, 'id' | 'createdAt' | 'readBy'>,
): Promise<string | null> {
  const db = _db;
  if (!db || !businessId) return null;
  const id = makeId();
  const payload: NotificationDoc = {
    id,
    createdAt: new Date().toISOString(),
    readBy: {},
    ...input,
  };
  try {
    await setDoc(doc(db, 'businesses', businessId, 'notifications', id), payload);
    return id;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] create failed (non-fatal):', err);
    return null;
  }
}

/**
 * Mark a notification as read for the CURRENT user. Idempotent.
 */
export async function markNotificationRead(
  businessId: string | null,
  notifId: string,
): Promise<void> {
  const db = _db;
  const uid = _auth?.currentUser?.uid;
  if (!db || !businessId || !uid) return;
  try {
    await setDoc(
      doc(db, 'businesses', businessId, 'notifications', notifId),
      { readBy: { [uid]: new Date().toISOString() } },
      { merge: true },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] markRead failed (non-fatal):', err);
  }
}

/**
 * Subscribe to notifications visible to the current user. Returns an
 * unsubscribe function. Filters client-side rather than via Firestore
 * `where` so business-wide messages (no targetUid) and user-targeted
 * messages flow through the same listener.
 *
 * Cap: hold the most recent 100 notifications in memory; older ones
 * stay on disk but the UI doesn't need to render them.
 */
export function subscribeToMyNotifications(
  businessId: string | null,
  onChange: (notifications: NotificationDoc[]) => void,
): () => void {
  const db = _db;
  const myUid = _auth?.currentUser?.uid;
  if (!db || !businessId || !myUid) {
    onChange([]);
    return () => {};
  }
  const col = collection(db, 'businesses', businessId, 'notifications');
  return onSnapshot(
    col,
    (snap) => {
      const out: NotificationDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as Partial<NotificationDoc>;
        if (!data.kind || !data.title || !data.createdAt) return;
        // Skip notifications targeted at a different user.
        if (data.targetUid && data.targetUid !== myUid) return;
        out.push({
          id: d.id,
          kind: data.kind,
          title: data.title,
          body: data.body,
          createdAt: data.createdAt,
          targetUid: data.targetUid,
          readBy: data.readBy || {},
          routeTo: data.routeTo,
          meta: data.meta,
        });
      });
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onChange(out.slice(0, 100));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[notifications] subscribe error:', err);
      onChange([]);
    },
  );
}

/**
 * Subscribe to the current user's notification preferences.
 * Defaults to "every category on" when no prefs doc exists.
 */
export function subscribeToMyNotificationPrefs(
  businessId: string | null,
  onChange: (prefs: NotificationPrefs) => void,
): () => void {
  const db = _db;
  const myUid = _auth?.currentUser?.uid;
  if (!db || !businessId || !myUid) {
    onChange({ uid: '', byCategory: {} });
    return () => {};
  }
  const ref = doc(db, 'businesses', businessId, 'notificationPrefs', myUid);
  return onSnapshot(
    ref,
    (snap) => {
      const data = snap.exists() ? (snap.data() as Partial<NotificationPrefs>) : null;
      onChange({
        uid: myUid,
        byCategory: (data?.byCategory || {}) as Partial<Record<NotificationCategory, boolean>>,
        updatedAt: data?.updatedAt,
      });
    },
    () => onChange({ uid: myUid, byCategory: {} }),
  );
}

/**
 * Update one category's preference for the CURRENT user.
 */
export async function setMyNotificationPref(
  businessId: string | null,
  category: NotificationCategory,
  enabled: boolean,
): Promise<void> {
  const db = _db;
  const myUid = _auth?.currentUser?.uid;
  if (!db || !businessId || !myUid) return;
  try {
    await setDoc(
      doc(db, 'businesses', businessId, 'notificationPrefs', myUid),
      {
        uid: myUid,
        byCategory: { [category]: enabled },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] pref save failed (non-fatal):', err);
  }
}

/**
 * Caller-side gate. Returns true when the user has opted OUT of the
 * category the notification kind belongs to. createNotification callers
 * use this to skip the write when nobody's going to see it anyway.
 *
 * Defaults to "opted in" (returns false) for missing prefs.
 */
export function userHasOptedOut(prefs: NotificationPrefs | null, kind: NotificationDoc['kind']): boolean {
  if (!prefs) return false;
  const cat = NOTIFICATION_CATEGORY_BY_KIND[kind];
  return prefs.byCategory[cat] === false;
}

// Unused — exported to silence the import-only branch when callers
// only use the pure helpers via re-export above. Kept for the
// where()-based queries that may land in a future optimization.
export const _NOOP_QUERY = () => query;
