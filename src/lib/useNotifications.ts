// src/lib/useNotifications.ts
// ═══════════════════════════════════════════════════════════════════
//  Live subscription to businesses/{id}/notifications. Returns the
//  filtered list (per visibleNotifications) + helpers to mark-read,
//  mark-all-read, and stamp sentAt for tap-to-send. Returns empty
//  state when Firestore isn't initialized or the user has no
//  business yet.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { useMembership } from '@/context/MembershipContext';
import { deserializeNotification } from '@/lib/deserializers';
import { visibleNotifications } from '@/lib/visibleNotifications';
import type { NotificationDoc } from '@/types';

export interface UseNotificationsResult {
  notifications: NotificationDoc[];
  unreadCount: number;
  pendingCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  markSent: (id: string) => Promise<void>;
}

export function useNotifications(): UseNotificationsResult {
  const { member, role } = useMembership();
  const businessId = member?.businessId;
  const uid = member?.uid;
  const [all, setAll] = useState<NotificationDoc[]>([]);

  useEffect(() => {
    const db = _db;
    if (!db || !businessId) { setAll([]); return undefined; }
    const ref = collection(db, 'businesses', businessId, 'notifications');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const docs = snap.docs.map((d) =>
          deserializeNotification({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }),
        );
        docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setAll(docs);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[useNotifications] snapshot error:', err);
        setAll([]);
      },
    );
    return () => unsub();
  }, [businessId]);

  const notifications = useMemo(
    () => visibleNotifications(all, role, uid),
    [all, role, uid],
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications],
  );
  const pendingCount = useMemo(
    () => notifications.filter((n) =>
      (n.channel === 'sms' || n.channel === 'email') && !n.sentAt,
    ).length,
    [notifications],
  );

  const markRead = useCallback(async (id: string): Promise<void> => {
    if (!_db || !businessId) return;
    const ref = doc(_db, 'businesses', businessId, 'notifications', id);
    await updateDoc(ref, { readAt: new Date().toISOString() });
  }, [businessId]);

  const markAllRead = useCallback(async (): Promise<void> => {
    if (!_db || !businessId) return;
    const now = new Date().toISOString();
    const batch = writeBatch(_db);
    for (const n of notifications) {
      if (!n.readAt) {
        const ref = doc(_db, 'businesses', businessId, 'notifications', n.id);
        batch.update(ref, { readAt: now });
      }
    }
    await batch.commit();
  }, [businessId, notifications]);

  const markSent = useCallback(async (id: string): Promise<void> => {
    if (!_db || !businessId) return;
    const ref = doc(_db, 'businesses', businessId, 'notifications', id);
    await updateDoc(ref, { sentAt: new Date().toISOString() });
  }, [businessId]);

  return { notifications, unreadCount, pendingCount, markRead, markAllRead, markSent };
}
