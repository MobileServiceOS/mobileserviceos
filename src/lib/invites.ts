import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
  onSnapshot,
} from 'firebase/firestore';
import type { InviteDoc, InviteStatus, MemberDoc, Role } from '@/types';
import { _auth } from '@/lib/firebase';

// ─────────────────────────────────────────────────────────────────────
//  Team invites — token-based, no Cloud Functions
//
//  Schema: top-level collection at `invites/{token}` where {token} is
//  a random URL-safe identifier. The invite link is one opaque token,
//  not the invitee's email — better privacy + supports any number of
//  invites to the same email without collision.
//
//  Acceptance flow:
//
//    OWNER SIDE
//    ──────────
//      1. Owner calls createInvite({ email, businessId, role, ... })
//      2. Library generates a random token, writes invites/{token}
//         with status='pending' and expiresAt 14 days from now
//      3. Owner gets back { id, token, link } — shares the link via
//         iMessage / Mail / WhatsApp / etc. (see openInviteShareSheet)
//
//    INVITEE SIDE
//    ────────────
//      1. Invitee clicks the link → app loads with ?invite=<token>
//      2. App detects the param, fetches invites/{token}
//      3. If invite is valid, shows InviteAccept page with business
//         name + role + inviter name
//      4. Invitee signs in (Google) or signs up (email/password)
//      5. After auth, acceptInvite(token, uid, email) runs:
//         - validates email match
//         - validates not expired/revoked/already-accepted
//         - writes users/{uid} with the businessId
//         - creates businesses/{bid}/members/{uid} MemberDoc
//         - transitions invite to status='accepted'
//      6. App redirects to dashboard
//
//  Security: Firestore rules enforce the same invariants the client
//  enforces here — defense in depth. See docs/INVITES-SETUP.md.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_INVITE_TTL_DAYS = 14;

/**
 * Generate a URL-safe random token. 128 bits of entropy from
 * crypto.getRandomValues. URL-safe base64 (no `+`, `/`, `=`).
 */
function generateInviteToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  return /^.+@.+\..+$/.test(email);
}

// ─────────────────────────────────────────────────────────────────────
//  createInvite
// ─────────────────────────────────────────────────────────────────────

export interface CreateInviteOptions {
  email: string;
  businessId: string;
  role: 'admin' | 'technician';
  invitedBy?: string;
  invitedByDisplayName?: string;
  businessName?: string;
  note?: string;
  ttlDays?: number;
}

export interface CreateInviteResult {
  id: string;
  token: string;
  link: string;
}

export async function createInvite(opts: CreateInviteOptions): Promise<CreateInviteResult> {
  const email = normalizeEmail(opts.email);
  if (!isValidEmail(email)) throw new Error('Invalid email address');
  if (!opts.businessId) throw new Error('businessId is required');
  if (opts.role !== 'admin' && opts.role !== 'technician') {
    throw new Error('Role must be admin or technician');
  }

  const invitedBy = opts.invitedBy || _auth?.currentUser?.uid || '';
  if (!invitedBy) throw new Error('Must be signed in to create an invite');

  const token = generateInviteToken();
  const ttlDays = Math.max(1, Math.min(90, opts.ttlDays ?? DEFAULT_INVITE_TTL_DAYS));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const payload: InviteDoc = {
    id: token,
    token,
    email,
    businessId: opts.businessId,
    role: opts.role,
    status: 'pending',
    invitedBy,
    invitedByDisplayName: opts.invitedByDisplayName,
    businessName: opts.businessName,
    invitedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    note: opts.note,
  };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) clean[k] = v;
  }

  const db = getFirestore();
  await setDoc(doc(db, 'invites', token), clean);
  // eslint-disable-next-line no-console
  console.info('[invites] created', { token, email, role: opts.role, businessId: opts.businessId });

  return { id: token, token, link: buildInviteLink(token) };
}

// ─────────────────────────────────────────────────────────────────────
//  getInviteByToken + lazy expiry
// ─────────────────────────────────────────────────────────────────────

export async function getInviteByToken(token: string): Promise<InviteDoc | null> {
  if (!token) {
    // eslint-disable-next-line no-console
    console.warn('[invites] getInviteByToken called with empty token');
    return null;
  }
  const db = getFirestore();
  const ref = doc(db, 'invites', token);
  // eslint-disable-next-line no-console
  console.info('[invites] fetching invite', { token, path: `invites/${token}` });
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      // eslint-disable-next-line no-console
      console.warn('[invites] doc not found at invites/' + token + ' — verify the token in the URL matches a Firestore doc ID exactly (case-sensitive)');
      return null;
    }
    const invite = snap.data() as InviteDoc;
    // eslint-disable-next-line no-console
    console.info('[invites] doc loaded', { status: invite.status, email: invite.email, businessName: invite.businessName });

    // Lazy expiry — if past expiresAt and still pending, transition.
    if (invite.status === 'pending' && isExpired(invite)) {
      try {
        await updateDoc(ref, { status: 'expired' as InviteStatus });
        invite.status = 'expired';
      } catch (err) {
        // Rules may block un-authed users from this update — that's
        // fine, UI treats it as expired based on expiresAt anyway.
        // eslint-disable-next-line no-console
        console.info('[invites] could not flip to expired (non-fatal):', err);
      }
    }
    return invite;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[invites] getInviteByToken THREW:', {
      code: (err as { code?: string }).code,
      message: (err as Error).message,
      name: (err as Error).name,
      token,
    });
    // Rethrow so InviteAccept can show the actual error message to
    // the user instead of the generic "invite unavailable" — much
    // better for debugging permission / network issues.
    throw err;
  }
}

function isExpired(invite: InviteDoc): boolean {
  if (!invite.expiresAt) return false;
  try {
    return new Date(invite.expiresAt).getTime() < Date.now();
  } catch {
    return false;
  }
}

export function isInviteAcceptable(invite: InviteDoc | null): boolean {
  if (!invite) return false;
  if (invite.status !== 'pending') return false;
  if (isExpired(invite)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────
//  acceptInvite
// ─────────────────────────────────────────────────────────────────────

export async function acceptInvite(
  token: string,
  uid: string,
  email: string,
): Promise<string> {
  if (!token) throw new Error('Invite link missing');
  if (!uid) throw new Error('Must be signed in to accept invite');

  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw new Error('Email address is invalid');

  const invite = await getInviteByToken(token);
  if (!invite) throw new Error("Invite not found — it may have been revoked");
  if (invite.status === 'accepted') {
    if (invite.acceptedByUid === uid) return invite.businessId;
    throw new Error('This invite has already been used');
  }
  if (invite.status === 'revoked') throw new Error('This invite was revoked');
  if (invite.status === 'expired' || isExpired(invite)) {
    throw new Error('This invite has expired — ask for a new one');
  }
  if (invite.email !== e) {
    // eslint-disable-next-line no-console
    console.warn('[invites] email mismatch on accept', { authEmail: e, inviteEmail: invite.email });
    throw new Error("This invite was sent to a different email address");
  }

  const db = getFirestore();
  const now = new Date().toISOString();

  // Write users/{uid} first.
  await setDoc(doc(db, 'users', uid), {
    businessId: invite.businessId,
    role: invite.role,
    email: e,
    invitedBy: invite.invitedBy,
    joinedAt: now,
    createdAt: now,
  }, { merge: true });

  // Write the member doc.
  const memberPayload: MemberDoc = {
    uid,
    email: e,
    role: invite.role as Role,
    status: 'active',
    assignedBusinessId: invite.businessId,
    invitedBy: invite.invitedBy,
    invitedAt: invite.invitedAt,
    joinedAt: now,
  };
  const memberClean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(memberPayload)) {
    if (v !== undefined) memberClean[k] = v;
  }
  await setDoc(
    doc(db, 'businesses', invite.businessId, 'members', uid),
    memberClean,
    { merge: true },
  );

  // Mark invite accepted last — idempotent retry on crash.
  try {
    await updateDoc(doc(db, 'invites', token), {
      status: 'accepted' as InviteStatus,
      acceptedAt: now,
      acceptedByUid: uid,
    });
  } catch (err) {
    // Non-fatal — user is attached, invite just doesn't show accepted.
    // eslint-disable-next-line no-console
    console.warn('[invites] could not mark accepted (non-fatal):', err);
  }

  // eslint-disable-next-line no-console
  console.info('[invites] accepted', { token, uid, businessId: invite.businessId, role: invite.role });
  return invite.businessId;
}

// ─────────────────────────────────────────────────────────────────────
//  Legacy compatibility — acceptInviteIfPresent
//
//  Older BrandContext code calls acceptInviteIfPresent(uid, email)
//  during the bootstrap flow as a fallback for users who signed up
//  WITHOUT going through the InviteAccept page first (e.g. they
//  used Google sign-in from the AuthScreen without clicking the
//  invite link). We look up any pending invite for that email and
//  accept it if found.
//
//  Returns the businessId on accept, null otherwise.
// ─────────────────────────────────────────────────────────────────────

export async function acceptInviteIfPresent(uid: string, email: string): Promise<string | null> {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return null;

  const db = getFirestore();
  const q = query(
    collection(db, 'invites'),
    where('email', '==', e),
    where('status', '==', 'pending'),
  );

  let invite: InviteDoc | null = null;
  try {
    const snap = await getDocs(q);
    if (snap.empty) return null;
    // Pick the most recent pending invite if multiple.
    let latest: InviteDoc | null = null;
    snap.forEach((d) => {
      const data = d.data() as InviteDoc;
      if (isExpired(data)) return; // skip already-expired
      if (!latest || data.invitedAt > latest.invitedAt) latest = data;
    });
    invite = latest;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.info('[invites] no readable invites for email (normal signup proceeds)', err);
    return null;
  }

  if (!invite) return null;

  try {
    return await acceptInvite((invite as InviteDoc).token, uid, e);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[invites] auto-accept after signup failed (non-fatal):', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  revokeInvite
// ─────────────────────────────────────────────────────────────────────

export async function revokeInvite(idOrEmail: string): Promise<void> {
  if (!idOrEmail) throw new Error('Invite ID required');
  const db = getFirestore();

  const looksLikeEmail = idOrEmail.includes('@');
  let token: string | null = null;

  if (looksLikeEmail) {
    const e = normalizeEmail(idOrEmail);
    const q = query(
      collection(db, 'invites'),
      where('email', '==', e),
      where('status', '==', 'pending'),
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    let latest: { id: string; invitedAt: string } | null = null;
    snap.forEach((d) => {
      const data = d.data() as InviteDoc;
      if (!latest || data.invitedAt > latest.invitedAt) {
        latest = { id: d.id, invitedAt: data.invitedAt };
      }
    });
    if (!latest) return;
    token = (latest as { id: string }).id;
  } else {
    token = idOrEmail;
  }

  if (!token) return;

  try {
    await updateDoc(doc(db, 'invites', token), {
      status: 'revoked' as InviteStatus,
      revokedAt: serverTimestamp(),
    });
    // eslint-disable-next-line no-console
    console.info('[invites] revoked', { token });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[invites] revoke error:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  list + subscribe
// ─────────────────────────────────────────────────────────────────────

export async function listPendingInvites(businessId: string): Promise<InviteDoc[]> {
  if (!businessId) return [];
  const db = getFirestore();
  const q = query(
    collection(db, 'invites'),
    where('businessId', '==', businessId),
    where('status', '==', 'pending'),
  );
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

export function subscribePendingInvites(
  businessId: string,
  onChange: (invites: InviteDoc[]) => void,
): Unsubscribe {
  if (!businessId) {
    onChange([]);
    return () => {};
  }
  const db = getFirestore();
  const q = query(
    collection(db, 'invites'),
    where('businessId', '==', businessId),
    where('status', '==', 'pending'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const out: InviteDoc[] = [];
      snap.forEach((d) => out.push(d.data() as InviteDoc));
      onChange(out.sort((a, b) => b.invitedAt.localeCompare(a.invitedAt)));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[invites] subscribePendingInvites listener error:', err);
      onChange([]);
    },
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Share helpers
// ─────────────────────────────────────────────────────────────────────

export function buildInviteLink(token: string, baseUrl?: string): string {
  const root = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${root}/?invite=${encodeURIComponent(token)}`;
}

export function buildShareMessage(invite: {
  businessName?: string;
  role: 'admin' | 'technician';
  link: string;
  inviterName?: string;
}): { subject: string; body: string } {
  const business = invite.businessName || 'our team';
  const roleLabel = invite.role === 'admin' ? 'admin' : 'technician';
  const from = invite.inviterName ? ` from ${invite.inviterName}` : '';

  const subject = `You're invited to join ${business}`;
  const body = [
    `You've been invited${from} to join ${business} as a ${roleLabel}.`,
    '',
    'Tap the link below to accept and set up your account:',
    invite.link,
    '',
    "If you're new, you'll create an account on the next screen — takes about 30 seconds.",
  ].join('\n');

  return { subject, body };
}

/**
 * Open the native share sheet (iOS/Android) with the pre-formatted
 * invite message. Falls back to clipboard copy on desktop or when
 * navigator.share is unavailable.
 *
 * Returns true if share was completed or text copied; false if both
 * paths failed.
 */
export async function openInviteShareSheet(invite: {
  businessName?: string;
  role: 'admin' | 'technician';
  link: string;
  inviterName?: string;
  email: string;
}): Promise<boolean> {
  const msg = buildShareMessage(invite);

  type ShareCapableNavigator = Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  };
  const nav = typeof navigator !== 'undefined' ? (navigator as ShareCapableNavigator) : null;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({
        title: msg.subject,
        text: msg.body,
        url: invite.link,
      });
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.info('[invites] share sheet dismissed or failed, falling back to clipboard', err);
    }
  }

  try {
    const full = `${msg.subject}\n\n${msg.body}`;
    await navigator.clipboard.writeText(full);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(invite.link);
      return true;
    } catch {
      return false;
    }
  }
}
