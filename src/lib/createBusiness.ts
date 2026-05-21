// ═══════════════════════════════════════════════════════════════════
//  src/lib/createBusiness.ts — Add-business creation (RULE-ORDERED)
// ═══════════════════════════════════════════════════════════════════
//
//  WRITE ORDER (each step satisfies a specific rule predicate; reorder
//  at your peril)
//   1.  /users/{uid}                                    — merge
//   2.  /businesses/{newId}/settings/main               — merge, ownerUid stamped
//   3.  /businesses/{newId}/members/{uid}               — merge, role: 'owner'
//   4.  /businesses/{newId}                             — merge, ownerUid stamped
//
//  WHY THIS ORDER
//  ──────────────
//  The deployed firestore.rules enforce three dependencies that any
//  client-driven (no Cloud Function) add-business flow must respect:
//
//   - /businesses/{businessId} root doc:
//       allow write: if isOwnerOrAdmin(businessId) || uid==businessId
//     There is NO self-create-with-ownerUid clause on the root doc.
//     For a brand-new businessId !== uid, the ONLY way to satisfy the
//     rule is to already be a member — i.e. the member doc must exist
//     first. So the root doc is written LAST.
//
//   - /businesses/{businessId}/members/{memberId} self-enroll clause:
//       uid == memberId  AND  businessOwnerUid(businessId) == uid
//     businessOwnerUid reads settings/main.ownerUid via getAfter(). For
//     a single (non-batched) write, getAfter == get, so settings/main
//     must already EXIST with ownerUid stamped for this clause to pass.
//     Therefore settings/main is written BEFORE members.
//
//   - /businesses/{businessId}/settings/{docId} create rule:
//       request.resource.data.ownerUid == request.auth.uid (+ no
//       exemption/reward fields). This is the only self-create clause
//       open to a brand-new business, so this is the FIRST write
//       inside the new business namespace.
//
//  HISTORY
//  ───────
//  Earlier versions ordered the writes root → members → settings/main
//  (mirroring Onboarding) and used writeBatch + getAfter to satisfy
//  the members rule across the batch. Both shapes produced 400s on
//  the Firestore Listen channel and an infinite Creating… spinner.
//  Root cause: the root-doc write was denied (no self-create clause)
//  and the members self-enroll predicate is an AND, not an OR, so it
//  cannot fall back to a uid==memberId branch when settings/main is
//  missing. Reordering to satisfy each rule with sequential awaited
//  setDoc — and dropping batching entirely — removes the rule
//  dependency that getAfter was trying to bridge.
//
//  KEY INVARIANTS
//   - Sequential awaited setDoc (not writeBatch).
//   - `merge: true` on EVERY write.
//   - settings/main is written FIRST inside the new business; members
//     SECOND; root doc LAST. No write depends on a later write.
//   - sanitizeMapKeys is applied to vehiclePricing because the
//     'SUV / Truck' key with a slash is a confirmed Firestore field-
//     name violation and would 400 any write that includes it.
//   - Legacy tire users (whose businessId === uid) are never touched
//     by this flow — createBusiness is only invoked for ADDITIONAL
//     businesses with a freshly generated id.
// ═══════════════════════════════════════════════════════════════════

import { doc, collection, setDoc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { DEFAULT_BRAND, DEFAULT_VEHICLE_PRICING } from '@/lib/defaults';
import { foundingMemberStamp } from '@/lib/growthMode';
import { withTimeout, TimeoutError } from '@/lib/promiseTimeout';
import {
  type VerticalKey,
  getVerticalConfig,
  servicePricingFromVertical,
} from '@/lib/verticals';

// Per-step write budget. Real Firestore writes against a healthy
// connection complete in <1s; 8s is generous headroom that still
// surfaces a hang in observable time rather than letting the modal
// spinner sit forever. If a step times out, the throw carries the
// step label + Firestore path so the toast can show exactly what
// stalled.
const STEP_TIMEOUT_MS = 8_000;

/**
 * A createBusiness step failure enriched with the runtime context the
 * caller needs to show a useful error to the user — the step label,
 * the exact Firestore path, and the raw Firebase error code/name if
 * Firestore itself rejected (vs. the SDK hanging past the timeout).
 */
export class CreateBusinessStepError extends Error {
  step: string;
  path: string;
  code: string | null;
  timedOut: boolean;
  cause: unknown;
  constructor(
    step: string,
    path: string,
    code: string | null,
    timedOut: boolean,
    message: string,
    cause: unknown,
  ) {
    super(message);
    this.name = 'CreateBusinessStepError';
    this.step = step;
    this.path = path;
    this.code = code;
    this.timedOut = timedOut;
    this.cause = cause;
  }
}

/**
 * Run one Firestore write with full observability:
 *
 *   - `STARTING` log BEFORE the await (so a hang shows up as "started
 *     but no OK/FAILED for path X").
 *   - `OK` log AFTER the await with elapsed ms (so cumulative slow steps
 *     are diagnosable from the console alone).
 *   - `FAILED` log on any rejection (Firestore code/name/message all
 *     captured, plus `timedOut` flag from withTimeout).
 *   - Re-throw a CreateBusinessStepError carrying step + path + code so
 *     the caller surfaces the real reason in the UI.
 */
async function runStep<T>(
  step: string,
  path: string,
  op: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  // eslint-disable-next-line no-console
  console.info(`[createBusiness] ${step}: STARTING ${path}`);
  try {
    const value = await withTimeout(op(), STEP_TIMEOUT_MS, `${step} -> ${path}`);
    // eslint-disable-next-line no-console
    console.info(
      `[createBusiness] ${step}: OK ${path} (${(performance.now() - t0).toFixed(0)}ms)`,
    );
    return value;
  } catch (err) {
    const timedOut = err instanceof TimeoutError;
    const e = (err || {}) as { code?: string; name?: string; message?: string };
    // eslint-disable-next-line no-console
    console.error(`[createBusiness] ${step}: FAILED ${path}`, {
      code: e.code ?? null,
      name: e.name ?? null,
      message: e.message ?? null,
      timedOut,
      elapsedMs: Math.round(performance.now() - t0),
      raw: err,
    });
    throw new CreateBusinessStepError(
      step,
      path,
      e.code ?? null,
      timedOut,
      timedOut
        ? `${step} (${path}) timed out after ${STEP_TIMEOUT_MS}ms`
        : `${step} (${path}) failed: ${e.code || e.name || 'error'} — ${e.message || 'unknown'}`,
      err,
    );
  }
}

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
  if (hasExistingUserDoc) {
    await runStep('step 1: user doc (updateDoc arrayUnion)', `users/${uid}`, () =>
      updateDoc(doc(db, `users/${uid}`), {
        ownedBusinesses: arrayUnion(uid, newId),
      }),
    );
  } else {
    // Edge case: founder-account user doc was never created. Mirror
    // Onboarding's pattern exactly.
    await runStep('step 1: user doc (setDoc merge)', `users/${uid}`, () =>
      setDoc(doc(db, `users/${uid}`), {
        businessId: uid,
        ownedBusinesses: [uid, newId],
        role: 'owner',
        email,
        createdAt: now,
      }, { merge: true }),
    );
  }

  // ── STEP 2: settings/main — vertical-aware seed, ownerUid stamped.
  //
  //    Written FIRST inside the new business namespace because:
  //      (a) the settings create rule accepts a self-stamp:
  //            request.resource.data.ownerUid == request.auth.uid
  //          which is the only clause a brand-new business can pass
  //          without already being a member or being uid==businessId.
  //      (b) the members self-enroll clause (step 3) reads
  //          businessOwnerUid(businessId) — which resolves to
  //          settings/main.ownerUid — and must find it already set.
  //
  //    sanitizeMapKeys ensures no '/' characters reach Firestore field
  //    names. servicePricing is seeded from the vertical so a mechanic
  //    business gets mechanic services; tire business gets tire
  //    services. vehiclePricing is vertical-agnostic.
  await runStep('step 2: settings/main', `businesses/${newId}/settings/main`, () =>
    setDoc(doc(db, `businesses/${newId}/settings/main`), {
      ...DEFAULT_BRAND,
      businessName: name,
      businessType,
      email,
      ownerUid: uid,
      createdAt: now,
      servicePricing: sanitizeMapKeys(seededServicePricing),
      vehiclePricing: sanitizeMapKeys(DEFAULT_VEHICLE_PRICING),
      ...foundingMemberStamp(),
    }, { merge: true }),
  );

  // ── STEP 3: members/{uid} as owner.
  //
  //    The self-enroll clause in the members rule is:
  //      request.auth.uid == memberId
  //      AND businessOwnerUid(businessId) == request.auth.uid
  //    Both predicates must hold (they are joined by AND, not OR).
  //    Step 2 stamped settings/main.ownerUid = uid, so the second
  //    predicate now resolves — this write would have been denied
  //    if step 2 had not run first.
  await runStep('step 3: members/{uid}', `businesses/${newId}/members/${uid}`, () =>
    setDoc(doc(db, `businesses/${newId}/members/${uid}`), {
      uid,
      email,
      role: 'owner',
      addedAt: now,
    }, { merge: true }),
  );

  // ── STEP 4: businesses/{newId} — business root, ownerUid stamped.
  //
  //    LAST inside the new business namespace because the root doc's
  //    rule is:
  //      allow write: if isOwnerOrAdmin(businessId)
  //                      || request.auth.uid == businessId
  //    There is NO self-create-with-ownerUid clause on the root doc.
  //    After step 3 the member doc exists with role='owner', so
  //    isOwnerOrAdmin(newId) is now true and this write is permitted.
  //
  //    The root doc carries ownerUid/ownerEmail/createdAt for
  //    downstream readers (BrandContext recovery checks, future
  //    admin tooling).
  await runStep('step 4: business root', `businesses/${newId}`, () =>
    setDoc(doc(db, `businesses/${newId}`), {
      ownerUid: uid,
      ownerEmail: email,
      createdAt: now,
    }, { merge: true }),
  );

  // ── STEP 5: operational_settings/main — vertical service catalog.
  //
  //    Without this, AddJob's service dropdown is empty for any
  //    business created via this flow. The app reads servicePricing
  //    from operational_settings/main (not settings/main), and the
  //    on-snapshot backfill at App.tsx only fires when the doc
  //    already exists. A founder account works because Onboarding's
  //    persistSettings writes here; second+ businesses via the
  //    AddBusinessModal landed in a "no services available" dead
  //    end. Same servicePricing seed as step 2 — duplicated until
  //    the data model is consolidated so the legacy step 2 entry
  //    (which the app never reads anyway) can be removed.
  //
  //    Rule: `operational_settings` allow write if isOwnerOrAdmin OR
  //    uid==businessId. We're owner after step 3, so this passes.
  await runStep('step 5: operational_settings/main', `businesses/${newId}/operational_settings/main`, () =>
    setDoc(doc(db, `businesses/${newId}/operational_settings/main`), {
      servicePricing: sanitizeMapKeys(seededServicePricing),
      vehiclePricing: sanitizeMapKeys(DEFAULT_VEHICLE_PRICING),
      createdAt: now,
    }, { merge: true }),
  );

  console.info('[createBusiness] COMPLETE', { newId });
  return { businessId: newId };
}

// Re-export getDoc so callers that need it can import from here too.
// (Not currently used internally — kept available for parity with
// the prior file shape.)
export { getDoc };
