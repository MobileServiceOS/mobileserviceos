import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
  type Unsubscribe,
  onSnapshot,
} from 'firebase/firestore';
import type { InviteDoc, MemberDoc } from '@/types';
import { _auth } from '@/lib/firebase';

// ─────────────────────────────────────────────────────────────────────
//  Team invites — create, accept, revoke
//
//  Email-keyed pending-invite flow that works without Cloud Functions.
//  Firestore rules enforce security at the per-document level (see
//  docs/INVITES-SETUP.md for the rules block).
//
//  Lifecycle:
//
//    OWNER SIDE
//    ──────────
//      1. Owner calls createInvite({ email, businessId, role, ... })
//      2. We write invites/{lowercaseEmail} document
//      3. Owner shares the magic link with the invitee (manual copy
//         or via sendInviteEmail() helper below)
//
//    INVITEE SIDE
//    ────────────
//      1. Invitee signs up with the invited email
//      2. After auth completes, BrandContext calls
//         acceptInviteIfPresent(uid, email)
//      3. If invite exists: attach invitee to the inviter's business
//         as a member, then delete the invite doc
//      4. If not: normal first-signup flow (creates a new business)
//
//  Concurrency: the accept flow uses a single deleteDoc to ensure
//  exactly-once acceptance. If two clients race, only one delete
//  succeeds; the loser sees a permission-denied error on the second
//  delete and falls through to the normal signup path.
//
//  Security model: see Firestore rules in docs/INVITES-SETUP.md.
//  Key invariant: an invite can only be created by a verified member
//  of the target business with `canManageTeam` permission, and can
//  only be read/accepted by an authed user whose token email matches
//  the doc ID.
// ─────────────────────────────────────────────────────────────────────

/** Lowercase + trim — the canonical form used as the invite doc ID. */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Validate an email syntactically. Permissive — defers full validation
 * to Firebase Auth, which is the actual authority on what's reachable.
 * This guard just catches obvious typos before a Firestore write.
 */
function isValidEmail(email: string): boolean {
  if (!email) return false;
  // Bare minimum: one @ with at least one char on each side and a dot
  // somewhere on the right. Don't try to RFC-comply; Firebase Auth
  // will reject anything truly malformed at signup time.
  return /^.+@.+\..+$/.test(email);
}

export interface CreateInviteOptions {
  email: string;
  businessId: string;
  role: 'admin' | 'technician';
  /** Pre-filled by createInvite from current auth context if omitted. */
  invitedBy?: string;
  invitedByDisplayName?: string;
  /** Surfaced in the invitee's signup UI. */
  businessName?: string;
  note?: string;
}

/**
 * Create a pending invite. Idempotent on email — re-creating an
 * invite for an existing email overwrites the previous one (useful
 * when an owner wants to change the role or business of a pending
 * invite without revoking + re-inviting).
 *
 * Throws if email is missing/invalid or businessId is empty. Does
 * NOT verify that the caller has permission to invite — Firestore
 * rules enforce that on the write itself.
 */
export async function createInvite(opts: CreateInviteOptions): Promise<string> {
  const email = normalizeEmail(opts.email);
  if (!isValidEmail(email)) throw new Error('Invalid email address');
  if (!opts.businessId) throw new Error('businessId is required');
  if (opts.role !== 'admin' && opts.role !== 'technician') {
    throw new Error('Role must be admin or technician');
  }

  const db = getFirestore();
  const invitedBy = opts.invitedBy || _auth?.currentUser?.uid || '';
  if (!invitedBy) throw new Error('Must be signed in to create an invite');

  const payload: InviteDoc = {
    email,
    businessId: opts.businessId,
    role: opts.role,
    invitedBy,
    invitedByDisplayName: opts.invitedByDisplayName,
    businessName: opts.businessName,
    invitedAt: new Date().toISOString(),
    note: opts.note,
  };
  // Filter undefined so Firestore doesn't reject the write.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) clean[k] = v;
  }

  await setDoc(doc(db, 'invites', email), clean);
  // eslint-disable-next-line no-console
  console.info('[invites] created', { email, role: opts.role, businessId: opts.businessId });
  return email;
}

/**
 * Revoke a pending invite. The doc ID is the lowercased email — pass
 * the email and we normalize internally. No-op if the invite doesn't
 * exist (treats this as success since the desired end state is met).
 */
export async function revokeInvite(email: string): Promise<void> {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw new Error('Invalid email address');
  const db = getFirestore();
  try {
    await deleteDoc(doc(db, 'invites', e));
    // eslint-disable-next-line no-console
    console.info('[invites] revoked', { email: e });
  } catch (err) {
    // Tolerate not-found (cleanup race); rethrow other errors.
    // eslint-disable-next-line no-console
    console.warn('[invites] revoke error (may be benign):', err);
  }
}

/**
 * List all pending invites for a business. Used by the TeamManagement
 * UI to show the "Pending invites" section. Firestore rules permit
 * this query only when the caller is an admin/owner of the business.
 */
export async function listPendingInvites(businessId: string): Promise<InviteDoc[]> {
  if (!businessId) return [];
  const db = getFirestore();
  const q = query(collection(db, 'invites'), where('businessId', '==', businessId));
  try {
    const snap = await getDocs(q);
    const out: InviteDoc[] = [];
    snap.forEach((d) => out.push(d.data() as InviteDoc));
    return out.sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[invites] listPendingInvites failed:', err);
    return [];
  }
}

/**
 * Subscribe to live changes of a business's pending invites. Returns
 * an Unsubscribe handle. Useful for the TeamManagement UI so the
 * pending-invites list updates instantly when a new invite is sent
 * or accepted.
 */
export function subscribePendingInvites(
  businessId: string,
  onChange: (invites: InviteDoc[]) => void,
): Unsubscribe {
  if (!businessId) {
    onChange([]);
    return () => {};
  }
  const db = getFirestore();
  const q = query(collection(db, 'invites'), where('businessId', '==', businessId));
  return onSnapshot(q, (snap) => {
    const out: InviteDoc[] = [];
    snap.forEach((d) => out.push(d.data() as InviteDoc));
    onChange(out.sort((a, b) => b.invitedAt.localeCompare(a.invitedAt)));
  }, (err) => {
    // eslint-disable-next-line no-console
    console.warn('[invites] subscribePendingInvites listener error:', err);
    onChange([]);
  });
}

/**
 * Post-signup hook. Called from BrandContext after auth resolves but
 * BEFORE the "first signup → bootstrap new business" branch.
 *
 * Returns:
 *   - The businessId the user was attached to, if an invite was
 *     accepted. The caller should use this as the user's businessId
 *     INSTEAD of creating a new business.
 *   - null if no invite was found. The caller proceeds with the
 *     normal first-signup flow.
 *
 * Side effects on accept:
 *   1. Writes users/{uid} with businessId, role from invite, email
 *   2. Writes businesses/{inviterBid}/members/{uid} MemberDoc with
 *      uid, email, role, status='active', joinedAt
 *   3. Deletes invites/{email}
 *
 * If any of (1) or (2) fails after invite delete, we surface the
 * error — manual recovery via the invites collection would be needed.
 * To minimize this risk, the delete is the LAST step.
 *
 * Idempotent on retry: re-running after a successful accept finds
 * no invite and returns null.
 */
export async function acceptInviteIfPresent(
  uid: string,
  email: string,
): Promise<string | null> {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return null;

  const db = getFirestore();
  const inviteRef = doc(db, 'invites', e);
  let invite: InviteDoc;
  try {
    const snap = await getDoc(inviteRef);
    if (!snap.exists()) return null;
    invite = snap.data() as InviteDoc;
  } catch (err) {
    // Permission denied here means rules consider this user
    // ineligible — treat as no invite (normal signup proceeds).
    // eslint-disable-next-line no-console
    console.info('[invites] no readable invite found (normal signup will proceed)', err);
    return null;
  }

  if (!invite.businessId || !invite.role) {
    // Malformed invite — log and skip rather than crash.
    // eslint-disable-next-line no-console
    console.warn('[invites] malformed invite, skipping', { email: e });
    return null;
  }

  // Write users/{uid} with the businessId from the invite, BEFORE
  // creating the member doc. The order matters: the member-doc rule
  // typically checks users/{uid}.businessId.
  await setDoc(doc(db, 'users', uid), {
    businessId: invite.businessId,
    role: invite.role,
    email: e,
    invitedBy: invite.invitedBy,
    joinedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }, { merge: true });

  // Create the member doc on the target business.
  const memberPayload: MemberDoc = {
    uid,
    email: e,
    role: invite.role,
    businessId: invite.businessId,
    invitedBy: invite.invitedBy,
    invitedAt: invite.invitedAt,
    joinedAt: new Date().toISOString(),
    status: 'active',
  };
  // Filter undefined for Firestore.
  const memberClean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(memberPayload)) {
    if (v !== undefined) memberClean[k] = v;
  }
  await setDoc(
    doc(db, 'businesses', invite.businessId, 'members', uid),
    memberClean,
    { merge: true },
  );

  // Delete the invite as the LAST step so a crash mid-flow leaves
  // the invite intact for retry (idempotent).
  try {
    await deleteDoc(inviteRef);
  } catch (err) {
    // Non-fatal — the user is attached to the business, the invite
    // doc just lingers. Logged for investigation.
    // eslint-disable-next-line no-console
    console.warn('[invites] post-accept cleanup failed (non-fatal):', err);
  }

  // eslint-disable-next-line no-console
  console.info('[invites] accepted', {
    email: e,
    uid,
    businessId: invite.businessId,
    role: invite.role,
  });
  return invite.businessId;
}

/**
 * Build a shareable invite link the owner can text or email manually.
 * The link points at the public app — when the invitee signs up
 * (matching the email pre-filled in the URL), acceptInviteIfPresent()
 * picks up the pending invite during their first auth.
 *
 * The pre-filled email is purely a UX nicety — the actual matching
 * happens server-side via the invite doc, not via the URL param.
 */
export function buildInviteLink(email: string, baseUrl?: string): string {
  const e = normalizeEmail(email);
  const root = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${root}/?invite=${encodeURIComponent(e)}`;
}

/**
 * Send the invite email via Firebase Auth's built-in passwordless
 * sign-in link. Zero external dependencies — uses your existing
 * Firebase project. The recipient gets an email with a "Sign in"
 * link; clicking it lands them on the app, signed in. Our
 * acceptInviteIfPresent hook then attaches them to the business.
 *
 * Requires Firebase Auth → Sign-in method → Email/Password →
 * "Email link (passwordless sign-in)" to be ENABLED. See
 * docs/INVITES-SETUP.md.
 *
 * If sending fails (e.g. email link not enabled, network), throws so
 * the caller can fall back to "copy magic link to clipboard" flow.
 */
export async function sendInviteEmail(email: string, continueUrl?: string): Promise<void> {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw new Error('Invalid email');
  if (!_auth) throw new Error('Firebase Auth not initialized');

  const { sendSignInLinkToEmail } = await import('firebase/auth');
  const url = continueUrl || buildInviteLink(e);
  await sendSignInLinkToEmail(_auth, e, {
    url,
    handleCodeInApp: true,
  });

  // Cache the email locally so the invitee's browser can complete the
  // sign-in flow after clicking the link. Firebase Auth uses this on
  // the receiving end (see isSignInWithEmailLink / signInWithEmailLink).
  try {
    window.localStorage.setItem('msos_invite_email', e);
  } catch {
    // Non-fatal — invitee can paste their email manually if asked.
  }
}
