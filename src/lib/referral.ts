import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import type { Settings, ReferralDoc } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  Referral system — client-side helpers
//
//  This module handles the CLIENT side of the referral flow:
//    1. Generating referral codes (collision-checked against Firestore)
//    2. Validating an incoming `?ref=CODE` URL param
//    3. Persisting the captured code through auth/onboarding via
//       localStorage (so it survives the OAuth round-trip)
//    4. Writing the initial `referrals/{id}` doc on first business
//       create
//    5. Reading owner-facing referral stats for the dashboard
//
//  IT DOES NOT handle:
//    • Reward application — that's a Cloud Function in functions/
//      that listens for Stripe webhook events via the extension's
//      Firestore mirror and applies a Stripe Customer Balance credit
//    • Fraud evaluation — also a Cloud Function (server-side only)
//    • Status transitions past `pending`/`trialing` — server-side
//
//  Firestore rules (firestore.rules):
//    • referrals/{id} — server-write only; client can read own
//    • businesses/{id}/settings/main — referralCode / referredBy /
//      referralCreditsMonths / totalSuccessfulReferrals are all
//      protected from client modification after initial create
// ─────────────────────────────────────────────────────────────────────

const REFERRAL_CODE_STORAGE_KEY = 'msos_pending_ref_code';

// Code alphabet: uppercase letters + digits, omitting ambiguous chars
// (0/O, 1/I/L, 5/S). Yields 30 distinct glyphs — ~30^7 ≈ 22B combos.
// Plenty for a small SaaS, easy to read aloud on a call.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ234678';
const CODE_LENGTH = 7;

/**
 * Generate a random 7-character referral code from the safe alphabet.
 * Does NOT check for collision — caller should retry on collision.
 */
function randomCode(): string {
  let out = '';
  const arr = new Uint8Array(CODE_LENGTH);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
    }
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  }
  return out;
}

/**
 * Check if a code is already in use by any business.
 * Returns the businessId of the holder or null if free.
 *
 * Uses a collection-group query on the `settings` subcollection where
 * `referralCode == X`. Requires a Firestore composite index (configured
 * in firestore.indexes.json or auto-suggested via console error link).
 */
async function findBusinessIdByCode(code: string): Promise<string | null> {
  const db = _db;
  if (!db) return null;
  try {
    // Top-level lookup via referralCodes/{code} index doc instead of
    // a collection-group scan. We maintain a side-index that maps
    // code → businessId so lookups are O(1) and don't require a
    // composite Firestore index. The index doc is server-written
    // (Cloud Function or initial client create), client-readable.
    const ref = doc(db, 'referralCodes', code);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as { businessId?: string };
      return data.businessId || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a unique referral code, retrying on collision up to 8 times.
 * After 8 collisions (probability ~10⁻⁵² with 22B combos and a few
 * hundred businesses) something is fundamentally wrong with the RNG;
 * bail rather than infinite-loop.
 */
export async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode();
    const existing = await findBusinessIdByCode(code);
    if (!existing) return code;
  }
  throw new Error('Could not generate unique referral code after 8 attempts');
}

/**
 * Ensure the given business has a referral code. If `settings.referralCode`
 * is already set, returns it unchanged. Otherwise generates a unique code,
 * writes it to the side-index doc + the settings doc, and returns the new
 * code.
 *
 * Idempotent: safe to call multiple times. Used both during onboarding
 * and lazily from the Referral dashboard if a legacy account is missing
 * its code.
 */
export async function ensureReferralCode(
  businessId: string,
  settings: Settings,
): Promise<string> {
  if (settings.referralCode) return settings.referralCode;
  const db = _db;
  if (!db) throw new Error('Firestore not initialized');

  const code = await generateUniqueCode();

  // Write the side-index FIRST. If this succeeds and the settings write
  // fails, the index has an orphan — no harm done; next call will
  // generate a different code and retry. Reverse order risks two
  // businesses claiming the same code if a race occurs.
  const indexRef = doc(db, 'referralCodes', code);
  await setDoc(indexRef, {
    businessId,
    createdAt: serverTimestamp(),
  });

  // Now write to the settings doc.
  const settingsRef = doc(db, 'businesses', businessId, 'settings', 'main');
  await setDoc(settingsRef, { referralCode: code }, { merge: true });

  return code;
}

/**
 * Build the public-facing referral signup link for a given code.
 * Used in the dashboard to populate the copy-able link and QR code.
 */
export function buildReferralLink(code: string): string {
  const base =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin.replace('app.', '')
      : 'https://mobileserviceos.app';
  // If hostname starts with 'app.', strip it so we point at the
  // marketing site's /signup path. Marketing site captures the
  // ?ref= param and forwards to the app's auth screen.
  const root = base.startsWith('http') ? base : `https://${base}`;
  return `${root}/signup?ref=${encodeURIComponent(code)}`;
}

/**
 * Read the `?ref=CODE` URL parameter from the current page, if present.
 * Returns null if absent or empty.
 */
export function readRefParamFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('ref');
    if (!code) return null;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return null;
    // Sanity-check format: only allow chars from our safe alphabet
    // so a malicious URL can't inject weird Unicode into our DB.
    if (!/^[A-Z0-9]{4,12}$/.test(trimmed)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Persist a referral code to localStorage so it survives an
 * auth-redirect (Google / Apple OAuth flows that bounce off the
 * provider's domain and come back). Cleared after the referral doc
 * has been created.
 */
export function persistPendingRefCode(code: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code);
  } catch {
    /* localStorage unavailable — fail silently. */
  }
}

/**
 * Retrieve the pending referral code from localStorage.
 * Returns null if none stored or storage unavailable.
 */
export function readPendingRefCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear the pending referral code from localStorage. Called after the
 * referral doc has been successfully created during onboarding.
 */
export function clearPendingRefCode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Capture step: called once on page load (from main.tsx or App.tsx).
 * If the URL contains `?ref=CODE`, stash it in localStorage so it
 * survives the auth flow. Idempotent — safe to call many times.
 */
export function captureRefCodeFromUrl(): void {
  const code = readRefParamFromUrl();
  if (code) persistPendingRefCode(code);
}

/**
 * Resolve a stored referral code to a referrer businessId.
 * Returns null if the code is unknown OR is the same business (self-
 * referral, which we silently drop).
 */
export async function resolveRefCode(
  code: string,
  selfBusinessId: string | null,
): Promise<string | null> {
  if (!code) return null;
  const referrerBusinessId = await findBusinessIdByCode(code);
  if (!referrerBusinessId) return null;
  if (referrerBusinessId === selfBusinessId) {
    // Self-referral attempt — drop it silently. Caller should not
    // create a referral doc; the new business simply has no referrer.
    return null;
  }
  return referrerBusinessId;
}

/**
 * Create the initial `referrals/{id}` document for a new business
 * that signed up via a referral code. Called by Onboarding after the
 * settings doc has been written with `referredBy` set.
 *
 * The doc starts in `pending` state. Cloud Function transitions it to
 * `trialing` → `converted` → `rewarded` as Stripe events arrive.
 *
 * Idempotent — checks for existing referral doc by referredBusinessId
 * before creating a duplicate.
 */
export async function createReferralDoc(opts: {
  referrerBusinessId: string;
  referredBusinessId: string;
  referredUid: string;
  referredEmail: string;
  referralCode: string;
}): Promise<string | null> {
  const db = _db;
  if (!db) return null;

  // Idempotency check: if a referral doc already exists for this
  // referredBusinessId, return its id. Prevents duplicate refs if
  // onboarding is run twice somehow.
  try {
    const existingQuery = query(
      collection(db, 'referrals'),
      where('referredBusinessId', '==', opts.referredBusinessId),
    );
    const existingSnap = await getDocs(existingQuery);
    if (!existingSnap.empty) {
      return existingSnap.docs[0].id;
    }
  } catch {
    // Permission denied or offline — continue to attempt create.
    // If create fails too, caller logs and continues.
  }

  // Generate a referral doc id. Stripe-style: short random string.
  const refId = `ref_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const refRef = doc(db, 'referrals', refId);

  const referralData: Omit<ReferralDoc, 'id'> = {
    referrerBusinessId: opts.referrerBusinessId,
    referredBusinessId: opts.referredBusinessId,
    referredUid: opts.referredUid,
    referredEmail: opts.referredEmail.toLowerCase().trim(),
    referralCode: opts.referralCode,
    status: 'pending',
    createdAt: new Date().toISOString(),
    fraudFlags: [],
  };

  try {
    await setDoc(refRef, referralData);
    return refId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[referral] createReferralDoc failed:', err);
    return null;
  }
}

/**
 * Read all referrals where this business is the REFERRER.
 * Used by the owner dashboard to show "people you've referred".
 * Sorted client-side by createdAt desc.
 */
export async function getMyReferrals(businessId: string): Promise<ReferralDoc[]> {
  const db = _db;
  if (!db) return [];
  try {
    const q = query(
      collection(db, 'referrals'),
      where('referrerBusinessId', '==', businessId),
    );
    const snap = await getDocs(q);
    const list: ReferralDoc[] = [];
    snap.forEach((d) => {
      list.push({ ...(d.data() as Omit<ReferralDoc, 'id'>), id: d.id });
    });
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return list;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[referral] getMyReferrals failed:', err);
    return [];
  }
}

/**
 * Compute owner-facing stats from a list of referrals.
 * Pure function — no Firestore reads.
 */
export function summarizeReferrals(refs: ReferralDoc[]): {
  total: number;
  pending: number;
  trialing: number;
  converted: number;
  rewarded: number;
  canceled: number;
  fraudulent: number;
} {
  const s = { total: refs.length, pending: 0, trialing: 0, converted: 0, rewarded: 0, canceled: 0, fraudulent: 0 };
  for (const r of refs) {
    if (r.status in s) (s as Record<string, number>)[r.status]++;
  }
  return s;
}

export const REFERRAL_REWARD_DESCRIPTION =
  '1 free month — applied automatically when your referral completes their first paid month.';
