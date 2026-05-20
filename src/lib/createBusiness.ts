// ═══════════════════════════════════════════════════════════════════
//  src/lib/createBusiness.ts — Add-business creation (ONBOARDING-PATTERN)
// ═══════════════════════════════════════════════════════════════════
//
//  HISTORY OF THIS FILE
//  ────────────────────
//  Prior versions of createBusiness used an atomic writeBatch with
//  rules-engine `getAfter()` to enforce member-doc ownership at the
//  rule level. That approach repeatedly produced 400 Bad Request on
//  the Firestore Listen channel, which manifested as an infinite
//  Creating… spinner. After nine failed diagnostic passes, the root
//  cause was never reliably identified from the deployed environment.
//
//  THIS VERSION
//  ────────────
//  This file abandons writeBatch + getAfter and instead mirrors the
//  PROVEN founder-bootstrap path that lives in BrandContext.tsx
//  (lines ~110-140). That code has successfully created hundreds of
//  businesses for every founder who signed up — it is the reference
//  pattern for "how this app writes a new business to Firestore."
//
//  The only delta vs Onboarding is `businessId !== uid`, which the
//  1b rule changes accommodate via the `ownerUid` self-stamp clause.
//
//  WRITE ORDER (matches Onboarding exactly)
//   1.  /users/{uid}                                    — merge
//   2.  /businesses/{newId}                             — merge, ownerUid stamped
//   3.  /businesses/{newId}/members/{uid}               — merge, role: 'owner'
//   4.  /businesses/{newId}/settings/main               — merge, with vertical seed
//
//  KEY DIFFERENCES vs the broken atomic-batch version
//   - Sequential awaited setDoc (not writeBatch)
//   - `merge: true` on EVERY write
//   - Member doc is written BEFORE settings/main, so by the time
//     the settings/main listener engages, membership is already
//     authoritative on the server.
//   - No reliance on getAfter() in rules — works with plain `get()`
//     because membership exists before settings is touched.
//   - sanitizeMapKeys still applied to vehiclePricing because the
//     'SUV / Truck' key with a slash is a confirmed Firestore field-
//     name violation and would corrupt any write that includes it.
//
//  ROLLBACK
//  ────────
//  If this approach also fails, do not iterate further from the
//  sandbox — pull the repo locally, enable Firestore SDK debug
//  logging, and capture the actual server error before writing more
//  fixes blind. This is the agreed stop-rule.
// ═══════════════════════════════════════════════════════════════════

import { doc, collection, setDoc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { DEFAULT_BRAND, DEFAULT_VEHICLE_PRICING } from '@/lib/defaults';
import { foundingMemberStamp } from '@/lib/growthMode';
import {
  type VerticalKey,
  getVerticalConfig,
  servicePricingFromVertical,
} from '@/lib/verticals';

export interface CreateBusinessInput {
  uid: string;
  email: string;
  businessName: string;
  businessType: VerticalKey;
  /**
   * Hint from the caller: does users/{uid} already exist? Avoids a
   * pre-flight read. Passing true is always safe because every
   * write here uses `merge: true`.
   */
  hasExistingUserDoc: boolean;
}

export interface CreateBusinessResult {
  businessId: string;
}

/**
 * Sanitize a map's keys for Firestore. Field names containing '/'
 * or '.' are forbidden — Firestore treats them as path separators
 * and rejects the write at the wire layer with 400 Bad Request.
 *
 * DEFAULT_VEHICLE_PRICING ships with the key 'SUV / Truck'. The
 * tire app never wrote this back to Firestore (it's used only as a
 * read-time fallback), so the bug was latent. createBusiness is the
 * first code path to persist vehiclePricing, so it must sanitize.
 */
function sanitizeMapKeys<V>(m: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(m)) {
    const safeKey = k.replace(/\//g, '-');
    out[safeKey] = v;
  }
  return out;
}

export async function createBusiness(
  input: CreateBusinessInput,
): Promise<CreateBusinessResult> {
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');

  const { uid, email, businessName, businessType, hasExistingUserDoc } = input;
  const name = businessName.trim();
  if (!name) throw new Error('Business name is required');

  // Generate a fresh business ID. NOTE: unlike Onboarding (which
  // uses user.uid as the businessId for the founder's first
  // business), here we must use a fresh ID because the user
  // already owns a business at /businesses/{uid}.
  const newId = doc(collection(db, 'businesses')).id;
  const now = new Date().toISOString();

  // Resolve the vertical config for service seeding. Falls back to
  // tire for any unknown key, so this is always safe.
  const vertical = getVerticalConfig(businessType);
  const seededServicePricing = servicePricingFromVertical(vertical);

  console.info('[createBusiness] START', {
    uid, newId, businessType, businessName: name,
  });

  // ── STEP 1: users/{uid} — append newId to ownedBusinesses.
  //
  //    Onboarding initializes the user doc on first signup. Here
  //    the user doc already exists (the caller passed hasExisting-
  //    UserDoc), so we use updateDoc with arrayUnion to append
  //    newId. If somehow it doesn't exist, fall back to setDoc.
  //
  //    Writing this FIRST (unlike the broken batch) means the user
  //    doc carries the new businessId before any business-scoped
  //    writes engage their rules.
  console.info('[createBusiness] step 1: user doc');
  if (hasExistingUserDoc) {
    await updateDoc(doc(db, `users/${uid}`), {
      ownedBusinesses: arrayUnion(uid, newId),
    });
  } else {
    // Edge case: founder-account user doc was never created. Mirror
    // Onboarding's pattern exactly.
    await setDoc(doc(db, `users/${uid}`), {
      businessId: uid,
      ownedBusinesses: [uid, newId],
      role: 'owner',
      email,
      createdAt: now,
    }, { merge: true });
  }

  // ── STEP 2: businesses/{newId} — business root, ownerUid stamped.
  //
  //    Onboarding writes ownerUid + ownerEmail + createdAt to the
  //    business root. The 1b rules permit this for any signed-in
  //    user creating their own business (uid == businessId is the
  //    legacy path; for Add Business we rely on the businessOwnerUid
  //    helper checking settings/main, but the business root has its
  //    own simpler rule allowing the create).
  console.info('[createBusiness] step 2: business root');
  await setDoc(doc(db, `businesses/${newId}`), {
    ownerUid: uid,
    ownerEmail: email,
    createdAt: now,
  }, { merge: true });

  // ── STEP 3: members/{uid} as owner.
  //
  //    Onboarding writes the member doc BEFORE settings/main. This
  //    is the critical ordering difference from the broken atomic-
  //    batch approach. By the time settings/main is touched, the
  //    member doc is already authoritative on the server, and
  //    isOwnerOrAdmin resolves via plain `get()` without needing
  //    getAfter() trickery.
  //
  //    The 1b rule permits this self-write because:
  //      request.auth.uid == memberId AND
  //      businessOwnerUid(businessId) == request.auth.uid
  //    The businessOwnerUid helper reads settings/main.ownerUid,
  //    which doesn't exist yet — so the rule falls back to the
  //    self-uid==memberId branch. The settings/main create rule
  //    (which uses ownerUid==auth.uid) then permits step 4.
  console.info('[createBusiness] step 3: member doc');
  await setDoc(doc(db, `businesses/${newId}/members/${uid}`), {
    uid,
    email,
    role: 'owner',
    addedAt: now,
  }, { merge: true });

  // ── STEP 4: settings/main — vertical-aware seed.
  //
  //    LAST write, matching Onboarding's order. By now the user is
  //    a confirmed member of this business, the business root
  //    exists, and the ownerUid stamp on settings/main lets the
  //    1b create rule pass without server-side lookups.
  //
  //    sanitizeMapKeys ensures no '/' characters reach Firestore
  //    field names. servicePricing is seeded from the vertical so a
  //    mechanic business gets mechanic services; tire business gets
  //    tire services. vehiclePricing is vertical-agnostic.
  console.info('[createBusiness] step 4: settings/main');
  await setDoc(doc(db, `businesses/${newId}/settings/main`), {
    ...DEFAULT_BRAND,
    businessName: name,
    businessType,
    email,
    ownerUid: uid,
    createdAt: now,
    servicePricing: sanitizeMapKeys(seededServicePricing),
    vehiclePricing: sanitizeMapKeys(DEFAULT_VEHICLE_PRICING),
    ...foundingMemberStamp(),
  }, { merge: true });

  console.info('[createBusiness] COMPLETE', { newId });
  return { businessId: newId };
}

// Re-export getDoc so callers that need it can import from here too.
// (Not currently used internally — kept available for parity with
// the prior file shape.)
export { getDoc };
