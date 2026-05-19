// ═══════════════════════════════════════════════════════════════════
//  src/lib/ownedBusinesses.ts — Multi-business model (STAGE 2)
// ═══════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ────────────
//  Read/write helpers for the set of businesses a single user owns,
//  plus the Pro-plan gating rule that governs how many businesses a
//  user may own.
//
//  THE MODEL
//  ─────────
//  Each business is its own businessId with its own fully-siloed
//  data under businesses/{businessId}/...  A user's FIRST business
//  keeps the historical convention businessId === uid (so existing
//  accounts need zero migration). Additional businesses get fresh
//  generated ids.
//
//  The user's `users/{uid}` doc carries an `ownedBusinesses` array
//  listing every businessId they own. The user's own uid is always
//  the first entry (their original business).
//
//  BACK-COMPAT GUARANTEE
//  ─────────────────────
//  `ownedBusinesses` is OPTIONAL and ADDITIVE. Every user who
//  existed before Stage 2 has no such field. `getOwnedBusinesses()`
//  treats an absent/empty array as "exactly one business — your own
//  uid", which is precisely today's behavior. A single-business
//  user never sees a switcher and nothing about their app changes.
//
//  GATING
//  ──────
//  Per product rule: Core plan = 1 business. Pro plan = unlimited.
//  The gate is computed from resolvePlan() — the same plan source
//  the rest of the app uses — so it stays consistent with billing.
//  During the Founder Access growth phase resolvePlan() returns
//  'pro', so founders can freely create multiple businesses; when
//  billing is later turned on, Core accounts are held to one.
// ═══════════════════════════════════════════════════════════════════

import type { Settings } from '@/types';
import { resolvePlan } from '@/lib/planAccess';

/**
 * The shape of the `users/{uid}` document this module reads/writes.
 * Declared structurally so Stage 2 does not have to introduce a new
 * exported type into src/types just for an optional field.
 */
export interface UserBusinessDoc {
  /** The user's primary/original businessId (=== their uid). */
  businessId?: string;
  /**
   * Every businessId this user owns. The user's own uid is always
   * index 0. Absent on pre-Stage-2 user docs.
   */
  ownedBusinesses?: string[];
  /** The businessId the user last had active (for switcher restore). */
  activeBusinessId?: string;
}

/**
 * Resolve the full list of businessIds a user owns.
 *
 * Rules:
 *   - No doc, or no ownedBusinesses field  -> [uid]  (one business,
 *     today's behavior — every pre-Stage-2 user).
 *   - ownedBusinesses present              -> that list, with uid
 *     guaranteed present and first (defensive — never lose the
 *     user's primary business even if the array is malformed).
 *
 * Always returns a non-empty array.
 */
export function getOwnedBusinesses(
  uid: string,
  userDoc: UserBusinessDoc | null | undefined,
): string[] {
  const list = userDoc?.ownedBusinesses;
  if (!list || list.length === 0) {
    return [uid];
  }
  // Guarantee the primary business (uid) is present and first.
  const deduped = Array.from(new Set([uid, ...list]));
  return deduped;
}

/**
 * How many businesses a plan allows.
 *   Core -> 1
 *   Pro  -> Infinity (unlimited)
 *
 * Driven by resolvePlan(), so it honors Founder Access (growth mode
 * resolves to 'pro') and, once billing is on, the real Stripe plan.
 */
export function maxBusinessesForPlan(settings: Settings | null | undefined): number {
  return resolvePlan(settings) === 'pro' ? Infinity : 1;
}

/**
 * Can this user create another business right now?
 *
 * True only when their plan's business allowance is greater than the
 * number of businesses they already own. Core users who own their
 * one business get false (and should be shown an upgrade prompt).
 */
export function canCreateAnotherBusiness(
  settings: Settings | null | undefined,
  ownedCount: number,
): boolean {
  return ownedCount < maxBusinessesForPlan(settings);
}

/**
 * Does this user own more than one business? Drives whether the
 * business switcher UI is shown at all — a single-business user
 * never sees it, so their experience is unchanged from pre-Stage-2.
 */
export function hasMultipleBusinesses(
  uid: string,
  userDoc: UserBusinessDoc | null | undefined,
): boolean {
  return getOwnedBusinesses(uid, userDoc).length > 1;
}

/**
 * Resolve which businessId should be active on app load.
 *
 * Prefers the user's last-active choice when it is still a business
 * they own; otherwise falls back to their primary business (uid).
 * Never returns a businessId the user does not own.
 */
export function resolveActiveBusinessId(
  uid: string,
  userDoc: UserBusinessDoc | null | undefined,
): string {
  const owned = getOwnedBusinesses(uid, userDoc);
  const last = userDoc?.activeBusinessId;
  if (last && owned.includes(last)) {
    return last;
  }
  return owned[0];
}
