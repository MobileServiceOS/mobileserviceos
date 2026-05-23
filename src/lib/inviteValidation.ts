import type { InviteDoc } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  Pure invite-validation helper. Lives in its own module (no Firebase
//  imports) so it can be unit-tested cleanly via tsx without booting
//  the Firebase SDK.
//
//  Two surfaces consume this:
//
//    1. src/pages/InviteAccept.tsx — initial load. Calls with the
//       invite alone (authEmail / authUid undefined) to check
//       existence / status / expiry before the user signs in.
//
//    2. src/lib/invites.ts — acceptInvite(). Calls with authEmail +
//       authUid populated to enforce email-match plus idempotent
//       same-user replay.
//
//  Both surfaces share the same reason strings so the user sees
//  identical wording at every step. Reasons are short, calm, and
//  actionable — never expose Firebase error codes / stack traces.
// ─────────────────────────────────────────────────────────────────────

export type InviteValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface ValidateInviteOptions {
  /** Override for the current time in ms — testing only. Defaults to Date.now(). */
  now?: number;
  /** The signed-in user's verified email. When provided, enforces the
   *  email-match guard. Leave undefined during the preview render
   *  (before sign-in) — existence / status / expiry are still checked. */
  authEmail?: string;
  /** The signed-in user's uid. When provided, an invite with
   *  status='accepted' AND acceptedByUid==authUid is treated as a
   *  successful idempotent replay (returns ok). */
  authUid?: string;
}

export function validateInvite(
  invite: InviteDoc | null,
  options: ValidateInviteOptions = {},
): InviteValidationResult {
  const now = options.now ?? Date.now();
  if (!invite) {
    return {
      ok: false,
      reason: 'This invite link is invalid or no longer exists.',
    };
  }
  if (invite.status === 'accepted') {
    if (options.authUid && invite.acceptedByUid === options.authUid) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: 'This invite has already been accepted. Sign in with the account you created.',
    };
  }
  if (invite.status === 'revoked') {
    return { ok: false, reason: 'This invite was revoked by the team owner.' };
  }
  if (invite.status === 'expired') {
    return { ok: false, reason: 'This invite has expired — ask the team owner for a new one.' };
  }
  if (invite.expiresAt) {
    const expiry = Date.parse(invite.expiresAt);
    if (!Number.isNaN(expiry) && expiry < now) {
      return { ok: false, reason: 'This invite has expired — ask the team owner for a new one.' };
    }
  }
  if (options.authEmail) {
    const e = options.authEmail.trim().toLowerCase();
    if (e && invite.email !== e) {
      return {
        ok: false,
        reason: `This invite was sent to ${invite.email}. You signed in as ${e}. Sign out and use the matching account, or ask for a new invite.`,
      };
    }
  }
  return { ok: true };
}
