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
//  WRITE ORDER — MATCHES THE 1b FIRESTORE RULES
//  ────────────────────────────────────────────
//  The Stage 2b-2 rules require a precise order. createBusiness()
//  writes in dependency order so each write is permitted by the
//  rule that the PREVIOUS write satisfied:
//
//    1. businesses/{newId}/settings/main  — stamped with
//       `ownerUid == creator uid`. The settings-create rule allows
//       this because request.resource.data.ownerUid == auth.uid.
//
//    2. businesses/{newId}/members/{uid}  — role 'owner'. The
//       members-write rule allows this because step 1 set
//       settings/main.ownerUid to the creator, and the rule's
//       self-enroll clause checks businessOwnerUid(businessId)
//       == auth.uid.
//
//    3. businesses/{newId} (root doc)     — ownerUid + metadata,
//       mirroring the first-business bootstrap shape.
//
//    4. users/{uid}.ownedBusinesses       — append newId. Done
//       LAST and on its own: if any earlier step fails, the user's
//       account is never mutated, so the worst failure case is an
//       orphaned business doc that nothing references (harmless and
//       invisible). ownedBusinesses drives the switcher UI only —
//       it is never trusted for security.
//
//  NO CLOUD FUNCTIONS: every write here is a normal client write,
//  permitted by the 1b rules. No Admin SDK, no Blaze plan.
// ═══════════════════════════════════════════════════════════════════

import { doc, collection, setDoc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
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
 * check (canCreateAnotherBusiness) BEFORE calling this — this
 * module does the writes, not the entitlement decision.
 *
 * On success the new businessId is appended to the user's
 * ownedBusinesses array; the caller can then switch to it.
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

  // ── Step 1: settings/main — MUST be first, MUST stamp ownerUid.
  // The 1b settings-create rule permits this because
  // request.resource.data.ownerUid === request.auth.uid. The
  // members-write rule (step 2) then reads this ownerUid.
  try {
    await setDoc(doc(db, `businesses/${newId}/settings/main`), {
      ...DEFAULT_BRAND,
      businessName: name,
      businessType,
      email,
      ownerUid: uid,
      createdAt: now,
      // New businesses created during the Founding Member growth
      // phase are stamped consistently with first-signup businesses.
      ...foundingMemberStamp(),
    });
  } catch (e) {
    console.error('[createBusiness] step 1 (settings) failed:', e);
    throw new Error('Could not create the business. Please try again.');
  }

  // ── Step 2: members/{uid} as owner. Permitted by the 1b
  // members-write self-enroll clause now that step 1 set ownerUid.
  try {
    await setDoc(doc(db, `businesses/${newId}/members/${uid}`), {
      uid,
      email,
      role: 'owner',
      addedAt: now,
    });
  } catch (e) {
    console.error('[createBusiness] step 2 (member doc) failed:', e);
    // Step 1 left an orphaned settings doc — harmless, nothing
    // references it (ownedBusinesses is not yet updated).
    throw new Error('Could not finish creating the business. Please try again.');
  }

  // ── Step 3: business root doc — ownerUid + metadata, mirroring
  // the first-business bootstrap shape so downstream code that
  // reads the root doc behaves identically for every business.
  try {
    await setDoc(doc(db, `businesses/${newId}`), {
      ownerUid: uid,
      ownerEmail: email,
      createdAt: now,
    }, { merge: true });
  } catch (e) {
    console.error('[createBusiness] step 3 (root doc) failed:', e);
    throw new Error('Could not finish creating the business. Please try again.');
  }

  // ── Step 4: append to ownedBusinesses — LAST. Until this
  // succeeds the user's account is unchanged, so a failure in any
  // earlier step leaves no broken state on the user record.
  try {
    const userRef = doc(db, `users/${uid}`);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      // arrayUnion is idempotent — safe even if a retry runs.
      await updateDoc(userRef, { ownedBusinesses: arrayUnion(uid, newId) });
    } else {
      // Defensive: user doc somehow missing — create it with both
      // the primary (uid) and the new business.
      await setDoc(userRef, {
        businessId: uid,
        ownedBusinesses: [uid, newId],
      }, { merge: true });
    }
  } catch (e) {
    console.error('[createBusiness] step 4 (ownedBusinesses) failed:', e);
    throw new Error(
      'The business was created but could not be linked to your account. ' +
      'Please refresh — if it does not appear, contact support.',
    );
  }

  console.info('[createBusiness] created business', newId, 'for', uid);
  return { businessId: newId };
}
