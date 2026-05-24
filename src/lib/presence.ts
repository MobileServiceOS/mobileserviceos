import { doc, onSnapshot, setDoc, collection } from 'firebase/firestore';
import { _auth, _db } from '@/lib/firebase';
import type { PresenceDoc, TechStatus } from '@/types';
// Pure helpers live in presenceTime.ts (no Firebase deps) so they
// can be unit-tested in isolation via tsx. Re-exported here so
// existing callers can keep importing from a single module.
export { presenceRelative, isPresenceStale } from '@/lib/presenceTime';

// ─────────────────────────────────────────────────────────────────────
//  Presence — technician work-status reads + writes.
//
//  Storage path: businesses/{bid}/presence/{uid}
//  Schema:       PresenceDoc (status + optional note + updatedAt)
//
//  Self-managed: every user can write only their own doc (enforced
//  by firestore.rules clause on the presence collection). All
//  members can read so the dispatch board can render every tech's
//  current status.
//
//  Stale-presence semantics: a missing doc is treated as "offline"
//  by the dispatch UI. An old updatedAt timestamp drives the
//  "5 min ago" hint so the dispatcher can spot a tech who forgot
//  to update their status.
// ─────────────────────────────────────────────────────────────────────

/**
 * Set the current user's presence. No-ops if there's no signed-in
 * user OR no Firestore handle (e.g. during initial app boot).
 */
export async function setMyPresence(
  businessId: string,
  status: TechStatus,
  note?: string,
): Promise<void> {
  const uid = _auth?.currentUser?.uid;
  const db = _db;
  if (!uid || !db || !businessId) return;
  const ref = doc(db, 'businesses', businessId, 'presence', uid);
  const payload: PresenceDoc = {
    uid,
    status,
    updatedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  await setDoc(ref, payload, { merge: true });
}

/**
 * Subscribe to ALL presence docs in a business. Returns an
 * unsubscribe function. The callback receives a Map<uid, PresenceDoc>
 * so consumers can look up a tech's status by uid without filtering.
 *
 * No-ops (returns a noop unsub) when businessId is missing or
 * Firestore isn't initialized — keeps the consumer code branchless.
 */
export function subscribeToPresence(
  businessId: string | null,
  onChange: (presence: Map<string, PresenceDoc>) => void,
): () => void {
  const db = _db;
  if (!businessId || !db) {
    onChange(new Map());
    return () => {};
  }
  const col = collection(db, 'businesses', businessId, 'presence');
  return onSnapshot(
    col,
    (snap) => {
      const m = new Map<string, PresenceDoc>();
      snap.forEach((d) => {
        const data = d.data() as Partial<PresenceDoc>;
        if (typeof data.status === 'string' && typeof data.updatedAt === 'string') {
          m.set(d.id, {
            uid: d.id,
            status: data.status as TechStatus,
            updatedAt: data.updatedAt,
            ...(data.note ? { note: data.note } : {}),
          });
        }
      });
      onChange(m);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[presence] subscribe error (non-fatal):', err);
      onChange(new Map());
    },
  );
}

