import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import type { MemberDoc } from '@/types';

/**
 * One-shot member directory hook.
 *
 * Loads ALL members of the business once (via direct getDocs, no listener)
 * and exposes a `resolveName(uid)` function. Used to show "by Mike" on
 * history cards without doing a Firestore lookup per card.
 *
 * Why not subscribe? Member list changes infrequently compared to job
 * activity. One read per session is plenty.
 *
 * Why not depend on a `listMembers` helper? Different batches of this
 * codebase have shipped that helper in different forms; self-fetching
 * here keeps the hook resilient regardless of what's exported from
 * firebase.ts.
 *
 * Falls back gracefully on every error path — if the read fails (permission
 * denied, offline, etc.), resolveName returns null and consumers render
 * without the "by X" suffix.
 */
export function useMembersDirectory(businessId: string | null) {
  const [members, setMembers] = useState<MemberDoc[]>([]);

  useEffect(() => {
    if (!businessId || !_db) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(_db!, `businesses/${businessId}/members`));
        if (cancelled) return;
        const list: MemberDoc[] = [];
        snap.forEach((d: { id: string; data(): unknown }) => {
          const data = (d.data() || {}) as Partial<MemberDoc>;
          list.push({
            uid: data.uid || d.id,
            email: data.email || '',
            displayName: data.displayName,
            role: data.role || 'owner',
            status: data.status || 'active',
            assignedBusinessId: data.assignedBusinessId || businessId,
            invitedBy: data.invitedBy,
            invitedAt: data.invitedAt,
            joinedAt: data.joinedAt,
            permissions: data.permissions,
          });
        });
        setMembers(list);
      } catch (e) {
        // Non-fatal — UI just won't show "by X" labels. Could be perm denied
        // (technician role) or offline; either way we degrade gracefully.
        console.warn('[members] directory load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  /** Returns a display name for the given uid, or null if unknown. */
  const resolveName = (uid: string | undefined | null): string | null => {
    if (!uid) return null;
    const m = members.find((x) => x.uid === uid);
    if (!m) return null;
    return m.displayName || (m.email ? m.email.split('@')[0] : null) || null;
  };

  return { members, resolveName };
}
