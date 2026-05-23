// src/lib/teamRoleChange.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers for the Team Management role-change UI. The
//  Firestore rules also enforce the same matrix server-side — this
//  module is the client's view of the same invariants so the UI
//  greys out unsupported actions and explains why.
//
//  Spec: docs/superpowers/specs/2026-05-22-team-management-prod-design.md
// ═══════════════════════════════════════════════════════════════════

import type { Role } from '@/types';

export type RoleAction =
  | { kind: 'remove' }
  | { kind: 'changeRole'; toRole: Role };

export interface RoleChangeContext {
  /** Role of the user attempting the action. */
  actorRole: Role;
  /** Role of the target member doc as it currently stands. */
  targetCurrentRole: Role;
  /** True when the actor is acting on their own member doc. */
  isSelf: boolean;
  /** True when the target is the sole remaining owner. */
  isLastOwner: boolean;
}

export interface RoleChangeVerdict {
  allowed: boolean;
  /** User-facing explanation when !allowed. Empty when allowed. */
  reason?: string;
}

function deny(reason: string): RoleChangeVerdict {
  return { allowed: false, reason };
}
const ALLOW: RoleChangeVerdict = { allowed: true };

export function isLastOwner(
  members: ReadonlyArray<{ uid?: string; role: Role }>,
  targetUid: string,
): boolean {
  if (!targetUid) return false;
  let ownerCount = 0;
  let targetIsOwner = false;
  for (const m of members) {
    if (m.role === 'owner') ownerCount += 1;
    if (m.uid === targetUid && m.role === 'owner') targetIsOwner = true;
  }
  return targetIsOwner && ownerCount <= 1;
}

export function canChangeRole(
  ctx: RoleChangeContext,
  action: { kind: 'changeRole'; toRole: Role },
): RoleChangeVerdict {
  const { actorRole, targetCurrentRole, isLastOwner } = ctx;
  const { toRole } = action;

  if (toRole === targetCurrentRole) {
    return deny('No change');
  }

  // ── Technicians can do nothing. ──
  if (actorRole === 'technician') {
    return deny('Technicians cannot manage team members');
  }

  // ── Demoting the last owner is never allowed. ──
  if (targetCurrentRole === 'owner' && toRole !== 'owner' && isLastOwner) {
    return deny('Last owner — promote another member to owner first');
  }

  // ── Owner can do anything else. ──
  if (actorRole === 'owner') return ALLOW;

  // ── Admin: bounded to admin <-> technician transitions. Never
  //    touches owner docs, never promotes to owner. ──
  if (actorRole === 'admin') {
    if (targetCurrentRole === 'owner') {
      return deny('Only an owner can change an owner');
    }
    if (toRole === 'owner') {
      return deny('Only an owner can promote a member to owner');
    }
    if (toRole === 'admin' || toRole === 'technician') {
      return ALLOW;
    }
  }

  return deny('Not allowed');
}

export function canRemoveMember(ctx: RoleChangeContext): RoleChangeVerdict {
  const { actorRole, targetCurrentRole, isLastOwner } = ctx;

  if (actorRole === 'technician') {
    return deny('Technicians cannot remove members');
  }

  if (targetCurrentRole === 'owner' && isLastOwner) {
    return deny('Last owner — promote another member to owner first');
  }

  if (actorRole === 'owner') return ALLOW;

  if (actorRole === 'admin') {
    if (targetCurrentRole === 'owner') {
      return deny('Only an owner can remove an owner');
    }
    return ALLOW;
  }

  return deny('Not allowed');
}
