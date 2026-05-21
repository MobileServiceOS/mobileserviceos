// src/lib/useBusinessMembers.ts
// ═══════════════════════════════════════════════════════════════════
//  React hook returning the active members of the current business.
//  Subscribes via Firestore onSnapshot; auto-cleans on unmount.
//  Mirrors the listener pattern in TeamManagement.tsx but exposes
//  the list as a reusable hook for AddJob's AssignmentPicker (and
//  future consumers like a dispatch board).
//
//  Returns an empty array while loading / unauthenticated / when the
//  Firestore instance isn't ready — callers can assume a safe array.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { useMembership } from '@/context/MembershipContext';
import type { MemberDoc } from '@/types';

export function useBusinessMembers(): MemberDoc[] {
  const { member } = useMembership();
  const businessId = member?.businessId;
  const [members, setMembers] = useState<MemberDoc[]>([]);

  useEffect(() => {
    const db = _db;
    if (!db || !businessId) {
      setMembers([]);
      return undefined;
    }
    const ref = collection(db, 'businesses', businessId, 'members');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const docs: MemberDoc[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as Omit<MemberDoc, 'uid'>),
        }) as MemberDoc);
        setMembers(docs);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[useBusinessMembers] snapshot error:', err);
        setMembers([]);
      },
    );
    return () => unsub();
  }, [businessId]);

  return members;
}
