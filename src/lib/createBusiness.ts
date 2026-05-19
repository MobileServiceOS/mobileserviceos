// ═══════════════════════════════════════════════════════════════════
//  src/lib/createBusiness.ts — Add-another-business flow (STAGE 2b-3)
// ═══════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ────────────
//  Creates an additional business for a user who already has one.
//  A Pro-plan user may create unlimited businesses; the gating is
//  enforced by the caller (BusinessSwitcher) via
//  canCreateAnotherBusiness(). This module does the Firestore writes.
//
//  WHY AN ATOMIC writeBatch (Fix A)
//  ────────────────────────────────
//  The app uses Firestore offline persistence (persistentLocalCache).
//  With it, `await setDoc()` resolves when the write reaches the
//  LOCAL cache — not when the server commits. An earlier version
//  did four sequential awaited setDoc() calls; the 1b members-write
//  rule does a server-side read of settings/main.ownerUid, and that
//  read could run before the settings write reached the server —
//  denying the member write and HANGING the promise under offline
//  persistence ("Creating…" loop).
//
//  The fix: all four writes go in ONE writeBatch. A batch is a
//  single atomic server commit. Paired with the rules using
//  getAfter()/existsAfter() (post-commit state), the members-write
//  rule can see the settings/main doc created in the SAME batch.
//  No ordering race, no partial writes — all four succeed or none
//  do, so an orphaned business can never occur.
//
//  WRITE SET — all in one batch:
//    1. businesses/{newId}/settings/main  — stamped ownerUid == uid
//    2. businesses/{newId}/members/{uid}  — role 'owner'
//    3. businesses/{newId}               — root doc, ownerUid + meta
//    4. users/{uid}                      — ownedBusinesses appended
//
//  NO CLOUD FUNCTIONS: every write is a normal client write,
//  permitted by the 1b rules. No Admin SDK, no Blaze plan.
// ═══════════════════════════════════════════════════════════════════

import { doc, collection, getDoc, writeBatch, arrayUnion } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { DEFAULT_BRAND } from '@/lib/defaults';
import { foundingMemberStamp } from '@/lib/growthMode';
import type { VerticalKey } from '@/lib/verticals';

export interface CreateBusinessInput {
  /** uid of the creating user — becomes the new business's owner. */
  uid: string;
  /** Email of the creating user, recorded on the new business. */
  email: string;
  /** Name for the new business. */
  businessName: string;
  /**
   * Which vertical the new business is. Stage 2b-3 only offers
   * 'tire'; 'mechanic' and 'carwash' become selectable in Stages
   * 3 and 4. The value is persisted as settings.businessType.
   */
  businessType: VerticalKey;
}

export interface CreateBusinessResult {
  /** The newly created businessId. */
  businessId: string;
}

/**
 * Create an additional business owned by `uid`.
 *
 * Throws on failure. The caller is responsible for the Pro-gating
 * check (canCreateAnotherBusiness) BEFORE calling this.
 *
 * All Firestore writes are committed in a single atomic batch — on
 * success every doc exists; on failure none do.
 */
export async function createBusiness(
  input: CreateBusinessInput,
): Promise<CreateBusinessResult> {
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');

  const { uid, email, businessName, businessType } = input;
  const name = businessName.trim();
  if (!name) throw new Error('Business name is required');

  // Fresh auto-generated id for the new business. Distinct from uid
  // (uid is the user's FIRST business id); this is an additional one.
  const newId = doc(collection(db, 'businesses')).id;
  const now = new Date().toISOString();

  // Read the user doc first (a read, not part of the batch) so the
  // batch can either append to an existing ownedBusinesses array or
  // initialize it. Batches are write-only, so this read is separate.
  let userDocExists = false;
  try {
    const snap = await getDoc(doc(db, `users/${uid}`));
    userDocExists = snap.exists();
  } catch (e) {
    console.error('[createBusiness] could not read user doc:', e);
    throw new Error('Could not create the business. Please try again.');
  }

  // ── Build the atomic batch — all four writes commit together.
  const batch = writeBatch(db);

  // 1. settings/main — stamped ownerUid. The 1b settings-create rule
  //    permits this because request.resource.data.ownerUid == uid.
  batch.set(doc(db, `businesses/${newId}/settings/main`), {
    ...DEFAULT_BRAND,
    businessName: name,
    businessType,
    email,
    ownerUid: uid,
    createdAt: now,
    // New businesses created during the Founding Member growth phase
    // are stamped consistently with first-signup businesses.
    ...foundingMemberStamp(),
  });

  // 2. members/{uid} as owner. The 1b members-write self-enroll
  //    clause uses getAfter() to read the settings/main.ownerUid
  //    written in THIS SAME batch — so this write is permitted.
  batch.set(doc(db, `businesses/${newId}/members/${uid}`), {
    uid,
    email,
    role: 'owner',
    addedAt: now,
  });

  // 3. business root doc — ownerUid + metadata, mirroring the
  //    first-business bootstrap shape.
  batch.set(doc(db, `businesses/${newId}`), {
    ownerUid: uid,
    ownerEmail: email,
    createdAt: now,
  }, { merge: true });

  // 4. users/{uid}.ownedBusinesses — append the new business.
  //    arrayUnion is idempotent and includes uid so the primary
  //    business is always present.
  if (userDocExists) {
    batch.set(
      doc(db, `users/${uid}`),
      { ownedBusinesses: arrayUnion(uid, newId) },
      { merge: true },
    );
  } else {
    // Defensive: user doc somehow missing — initialize it.
    batch.set(
      doc(db, `users/${uid}`),
      { businessId: uid, ownedBusinesses: [uid, newId] },
      { merge: true },
    );
  }

  // ── Commit. One atomic server round-trip. Rules evaluate every
  //    write with getAfter() seeing the batch's post-commit state.
  try {
    await batch.commit();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error('[createBusiness] batch commit failed:', {
      code: err.code, message: err.message, raw: e,
    });
    if (err.code === 'permission-denied') {
      throw new Error('Could not create the business — permission denied. Please try again.');
    }
    throw new Error('Could not create the business. Please try again.');
  }

  console.info('[createBusiness] created business', newId, 'for', uid);
  return { businessId: newId };
}
