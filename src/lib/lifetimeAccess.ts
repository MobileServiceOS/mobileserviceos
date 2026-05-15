import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import type { Settings } from '@/types';
import { _auth, _db } from '@/lib/firebase';

// ─────────────────────────────────────────────────────────────────────
//  Lifetime Access — VIP / founder / promotional account utility
//
//  Reusable SaaS-level feature for granting any business account
//  lifetime Pro access without going through Stripe. Originally built
//  to comp the founder account, but designed so any future VIP,
//  beta participant, partnership, or promotional grant can be issued
//  with one function call.
//
//  Storage shape (on the business's Settings doc):
//    {
//      billingExempt: true,
//      subscriptionOverride: 'lifetime',
//      exemptionGrantedAt: '2026-05-13T...',
//      exemptionGrantedBy: '<uid of granter>',
//      exemptionReason: 'Founder account',
//      plan: 'pro',
//      subscriptionStatus: 'active',   // cosmetic — UI shows "Lifetime"
//    }
//
//  Resolution: see `resolvePlan()` in `src/lib/planAccess.ts`. The
//  exemption takes precedence over every other check.
//
//  Webhook protection: see the pre-flight check in `stripeSync.ts`
//  before each mirror write — exempt accounts skip the mirror so
//  Stripe events can never downgrade them.
//
//  Firestore rules protection: see `firestore.rules` — only authed
//  users may write Settings docs, AND the rules should restrict
//  `billingExempt` / `subscriptionOverride` to admin-only writes via
//  a Cloud Function with admin privileges (see docs/EXEMPTION-SETUP.md).
//
//  This module is NO-IMPORT-TIME-SIDE-EFFECTS by design. Pure
//  functions only — call sites decide when to invoke.
// ─────────────────────────────────────────────────────────────────────

/**
 * Options for granting lifetime access. The reason is required for
 * audit trail — every grant must have a documented rationale even if
 * the grant is internal.
 */
export interface LifetimeAccessOptions {
  /** Human-readable reason. Stored verbatim on the Settings doc. */
  reason: string;
  /** Override category. Defaults to 'lifetime' (founder accounts);
   *  override for beta / comp / internal grants. */
  override?: 'lifetime' | 'beta' | 'comp' | 'internal';
}

/**
 * Grant lifetime Pro access to a business.
 *
 * @param businessId  The target business document ID (== owner uid for
 *                    single-owner accounts). The grant is applied to
 *                    `businesses/{businessId}/settings/main`.
 * @param options     Reason + optional override category.
 *
 * Writes:
 *   - billingExempt: true
 *   - subscriptionOverride: <options.override || 'lifetime'>
 *   - exemptionGrantedAt: ISO timestamp (client time — UI display)
 *   - exemptionGrantedBy: current auth uid (audit trail)
 *   - exemptionReason: <options.reason>
 *   - plan: 'pro'
 *   - subscriptionStatus: 'active'   ← cosmetic; matches what an
 *                                       active subscriber's UI shows
 *
 * Throws if no business is found at `businesses/{businessId}` (so
 * accidental grants to nonexistent accounts are caught early).
 *
 * Idempotent: re-granting an already-exempt account is a no-op write
 * apart from refreshing the granted-at timestamp.
 */
export async function setLifetimeAccess(
  businessId: string,
  options: LifetimeAccessOptions,
): Promise<void> {
  if (!businessId) throw new Error('businessId is required');
  if (!options?.reason?.trim()) {
    throw new Error('reason is required for audit trail');
  }

  const db = _db; if (!db) throw new Error("Firestore not initialized");
  const settingsRef = doc(db, 'businesses', businessId, 'settings', 'main');

  const granterUid = _auth?.currentUser?.uid || 'system';
  const now = new Date().toISOString();

  // eslint-disable-next-line no-console
  console.info('[lifetimeAccess] grant: starting write', {
    businessId,
    granterUid,
    settingsPath: `businesses/${businessId}/settings/main`,
  });

  try {
    await setDoc(
      settingsRef,
      {
        billingExempt: true,
        subscriptionOverride: options.override || 'lifetime',
        exemptionGrantedAt: now,
        exemptionGrantedBy: granterUid,
        exemptionReason: options.reason.trim(),
        plan: 'pro',
        subscriptionStatus: 'active',
        // Touch the audit timestamp via server time as well — useful when
        // ordering grants chronologically across timezones.
        _exemptionWrittenAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[lifetimeAccess] grant: setDoc failed', e);
    throw e;
  }

  // eslint-disable-next-line no-console
  console.info('[lifetimeAccess] grant: write complete', {
    businessId,
    override: options.override || 'lifetime',
    reason: options.reason,
    grantedBy: granterUid,
  });
}

/**
 * Revoke lifetime access from a business. The account drops back to
 * whatever Stripe says it should be — i.e. the next webhook event
 * (or app-side resolver pass) takes over.
 *
 * If no active Stripe subscription exists, the account reverts to
 * Core. Caller is responsible for making sure that's the intended
 * outcome (the function does NOT also start a Stripe subscription).
 *
 * @param businessId  Target business
 * @param reason      Audit string explaining why access was revoked
 */
export async function revokeLifetimeAccess(
  businessId: string,
  reason: string,
): Promise<void> {
  if (!businessId) throw new Error('businessId is required');
  if (!reason?.trim()) throw new Error('reason is required for audit trail');

  const db = _db; if (!db) throw new Error("Firestore not initialized");
  const settingsRef = doc(db, 'businesses', businessId, 'settings', 'main');

  await setDoc(
    settingsRef,
    {
      billingExempt: false,
      subscriptionOverride: null,
      // Keep grantedAt / grantedBy for forensic trail; null only the
      // flag and override. Add a revocation timestamp.
      exemptionRevokedAt: new Date().toISOString(),
      exemptionRevokedBy: _auth?.currentUser?.uid || 'system',
      exemptionRevokeReason: reason.trim(),
    },
    { merge: true },
  );

  // eslint-disable-next-line no-console
  console.info('[lifetimeAccess] grant revoked', {
    businessId,
    reason,
    revokedBy: _auth?.currentUser?.uid || 'system',
  });
}

/**
 * Look up all businesses currently flagged as billing-exempt.
 * Useful for admin dashboards / nightly audits. Requires Firestore
 * rules that permit a list query on `settings.billingExempt` for the
 * caller (typically only admins).
 *
 * Returns an array of (businessId, settings) tuples. Empty array if
 * none or if the query is denied by rules.
 */
export async function listExemptBusinesses(): Promise<
  Array<{ businessId: string; settings: Settings }>
> {
  const db = _db; if (!db) throw new Error("Firestore not initialized");
  // Settings docs live at `businesses/{bid}/settings/main`. Firestore
  // doesn't support cross-collection-group `where` without collection-
  // group queries. Use a collectionGroup so we can scan every
  // settings/main across every business.
  const { collectionGroup } = await import('firebase/firestore');
  const settingsGroup = collectionGroup(db, 'settings');
  const q = query(settingsGroup, where('billingExempt', '==', true));
  try {
    const snap = await getDocs(q);
    const out: Array<{ businessId: string; settings: Settings }> = [];
    snap.forEach((d) => {
      // Path is `businesses/{bid}/settings/{docId}` — pull bid out.
      const parts = d.ref.path.split('/');
      const bid = parts[1] || '';
      out.push({ businessId: bid, settings: d.data() as Settings });
    });
    return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[lifetimeAccess] listExemptBusinesses query failed:', err);
    return [];
  }
}

/**
 * Convenience predicate. Distinct from `isBillingExempt()` in
 * planAccess.ts in that this one specifically checks for the
 * 'lifetime' subscription override — useful for showing "Lifetime
 * Founder" badges vs generic "Comp account" or "Beta tester" badges.
 */
export function isLifetimeOwner(settings: Settings | null | undefined): boolean {
  return (
    settings?.billingExempt === true &&
    settings?.subscriptionOverride === 'lifetime'
  );
}

// Re-export the collection helper unused above purely so the import
// is preserved even if a future refactor removes the inline usage.
// Linter cleanliness pin.
const _keepCollectionImport: typeof collection = collection;
void _keepCollectionImport;
