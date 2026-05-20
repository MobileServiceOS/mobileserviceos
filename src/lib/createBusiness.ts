// ═══════════════════════════════════════════════════════════════════
//  src/lib/createBusiness.ts — Atomic business creation (DIAGNOSTIC)
// ═══════════════════════════════════════════════════════════════════
//
//  This version isolates EXACTLY which Firestore step is hanging.
//  Instead of one batch (which hides which write fails), each write
//  is its own timeout-wrapped call. The first one that times out
//  surfaces its step name directly in the error message — no more
//  generic "timed out, check connection."
//
//  Once we know which write is hanging, the underlying cause is
//  fixable; right now it could be any of: rules denying a write,
//  network failure on a specific path, or an offline-cache state
//  that won't reach the server. Each step now reports independently.
// ═══════════════════════════════════════════════════════════════════

import { doc, collection, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { DEFAULT_BRAND, DEFAULT_VEHICLE_PRICING } from '@/lib/defaults';
import { foundingMemberStamp } from '@/lib/growthMode';
import {
  type VerticalKey,
  getVerticalConfig,
  servicePricingFromVertical,
} from '@/lib/verticals';
import { withTimeout } from '@/lib/promiseTimeout';

const STEP_TIMEOUT_MS = 8_000;

export interface CreateBusinessInput {
  uid: string;
  email: string;
  businessName: string;
  businessType: VerticalKey;
  /**
   * Does users/{uid} already exist? The caller (BusinessSwitcher
   * context) already has this information loaded; passing it in
   * avoids a fresh getDoc that can hang under Firestore offline
   * persistence + stale auth token. If unsure, pass true — the
   * write path uses { merge: true } so it is safe either way.
   */
  hasExistingUserDoc: boolean;
}

export interface CreateBusinessResult {
  businessId: string;
}

/**
 * Run an async step with a timeout. On failure, logs the full error
 * (stringified) and throws an Error whose message includes the step
 * name so it shows up directly in the UI toast.
 */
async function runStep<T>(stepName: string, p: Promise<T>): Promise<T> {
  console.info(`[createBusiness] ▶ ${stepName}`);
  try {
    const result = await withTimeout(p, STEP_TIMEOUT_MS, stepName);
    console.info(`[createBusiness] ✓ ${stepName}`);
    return result;
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    // Stringify safely — Firestore errors have non-enumerable fields
    // so JSON.stringify(e) returns "{}". Spread known fields manually.
    const detail = {
      name: err.name,
      code: err.code,
      message: err.message,
      string: String(e),
    };
    console.error(`[createBusiness] ✗ ${stepName} FAILED`, detail);
    if (err.name === 'TimeoutError') {
      throw new Error(`Timed out at: ${stepName}`);
    }
    if (err.code === 'permission-denied') {
      throw new Error(`Permission denied at: ${stepName}`);
    }
    throw new Error(`Failed at ${stepName}: ${err.code || err.message || 'unknown'}`);
  }
}

export async function createBusiness(
  input: CreateBusinessInput,
): Promise<CreateBusinessResult> {
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');

  const { uid, email, businessName, businessType, hasExistingUserDoc } = input;
  const name = businessName.trim();
  if (!name) throw new Error('Business name is required');

  const newId = doc(collection(db, 'businesses')).id;
  const now = new Date().toISOString();
  const vertical = getVerticalConfig(businessType);
  const seededServicePricing = servicePricingFromVertical(vertical);

  console.info('[createBusiness] START_CREATE_BUSINESS', {
    uid, newId, businessType, businessName: name, hasExistingUserDoc,
  });

  // NOTE: we no longer read users/{uid} here. The caller passes
  // hasExistingUserDoc from already-loaded context state. This
  // eliminates a getDoc that was timing out under Firestore offline
  // persistence — likely caused by stale auth token or cache state
  // conflicting with the BrandContext realtime listener that is
  // already subscribed to the same doc.

  // ── STEP 1: settings/main with ownerUid stamp.
  //    1b rule requires ownerUid == auth.uid. This is the doc the
  //    members-write rule reads via getAfter() in step 2.
  await runStep(
    'BUSINESS_DOC_CREATED (settings/main)',
    setDoc(doc(db, `businesses/${newId}/settings/main`), {
      ...DEFAULT_BRAND,
      businessName: name,
      businessType,
      email,
      ownerUid: uid,
      createdAt: now,
      servicePricing: seededServicePricing,
      vehiclePricing: DEFAULT_VEHICLE_PRICING,
      ...foundingMemberStamp(),
    }),
  );

  // ── STEP 2: members/{uid} as owner.
  //    Permitted because step 1 wrote ownerUid; rule reads it with
  //    getAfter() so even cached writes are visible to the rule.
  await runStep(
    'OWNER_MEMBER_DOC_CREATED',
    setDoc(doc(db, `businesses/${newId}/members/${uid}`), {
      uid,
      email,
      role: 'owner',
      addedAt: now,
    }),
  );

  // ── STEP 3: business root doc.
  await runStep(
    'BUSINESS_ROOT_DOC_CREATED',
    setDoc(doc(db, `businesses/${newId}`), {
      ownerUid: uid,
      ownerEmail: email,
      createdAt: now,
    }, { merge: true }),
  );

  // ── STEP 4: append to users/{uid}.ownedBusinesses.
  if (hasExistingUserDoc) {
    await runStep(
      'OWNED_BUSINESSES_UPDATED',
      updateDoc(doc(db, `users/${uid}`), {
        ownedBusinesses: arrayUnion(uid, newId),
      }),
    );
  } else {
    await runStep(
      'OWNED_BUSINESSES_INITIALIZED',
      setDoc(
        doc(db, `users/${uid}`),
        { businessId: uid, ownedBusinesses: [uid, newId] },
        { merge: true },
      ),
    );
  }

  console.info('[createBusiness] ALL STEPS COMPLETE', { newId });
  return { businessId: newId };
}
