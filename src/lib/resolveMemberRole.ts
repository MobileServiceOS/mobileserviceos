import type { Role } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  resolveMemberRole — pure helper for coercing the role field on a
//  Firestore member doc into the typed Role union, with a SAFE default.
//
//  Hotfix (2026-05-31, audit P1): a partial member doc (e.g. one
//  written by a legacy migration that didn't populate `role`, or a
//  half-written admin SDK update) used to default to 'owner' at the
//  use site in MembershipContext.tsx. That meant any member doc with
//  a missing/null role silently granted full owner privileges —
//  including team management, financials, and billing. The safe
//  default is the least-privilege role: 'technician'.
//
//  This file is intentionally tiny so it can be unit-tested
//  independently of the React context that consumes it.
// ─────────────────────────────────────────────────────────────────────

const VALID_ROLES: ReadonlyArray<Role> = ['owner', 'admin', 'technician'];

export function resolveMemberRole(raw: unknown): Role {
  if (typeof raw !== 'string') return 'technician';
  if ((VALID_ROLES as ReadonlyArray<string>).includes(raw)) {
    return raw as Role;
  }
  return 'technician';
}
