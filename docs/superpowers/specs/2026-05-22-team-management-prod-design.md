# Team Management — Ownership Transfer + Role Management

> Single-phase spec. Promotes Team Management from "remove
> non-owners" to a complete SaaS-grade role surface — role change
> per row, owner-only gating for owner-level actions, atomic
> ownership transfer, last-owner protection, Firestore rules that
> enforce role transitions server-side, and a route-level guard
> closing the one remaining permission gap (Insights tab for
> technicians).

## Goal

An owner can change any other member's role to any of `owner` /
`admin` / `technician` via a per-row dropdown, AND transfer
ownership in a single atomic action ("Transfer ownership to
[name]" → target becomes owner, current owner becomes admin).
Admins can change roles between `admin` and `technician` only.
Technicians can do nothing here. The business can never reach
zero owners — both client UI and Firestore rules enforce this.

## Hard constraints

- **Always ≥1 owner.** Client-side enforced (last-owner delete +
  last-owner self-demote both blocked); server-side enforced by
  refusing demote / delete writes when only one owner exists.
- **Owner-level changes are owner-only.** Admin cannot
  promote-to-owner, cannot demote-from-owner, cannot delete an
  owner. Server-side rule enforces this — a hard wall against UI
  bypass.
- **Admin role changes** are bounded: admin → technician and
  technician → admin only.
- **No new external service**, no Cloud Function. All atomic
  updates go through Firestore `writeBatch`.
- **No new collections.** Re-uses the existing
  `businesses/{bid}/members/{uid}` doc shape.
- **Self-removal** is allowed (you walk yourself out of a business
  you co-own), provided you're not the last owner — same as
  removing a peer.
- **Mobile-first.** Every actionable element ≥44 px tap target;
  the per-row controls stay one-thumb-reachable.

## Surfaces affected

| Surface | Change |
|---|---|
| `src/lib/permissions.ts` | Add `canManageOwners` flag — owner-only |
| `src/lib/teamRoleChange.ts` (new) | Pure helpers: who can change which role, last-owner check |
| `tests/teamRoleChange.test.ts` (new) | Hand-rolled `check()` suite covering every role-transition matrix cell |
| `src/components/TeamManagement.tsx` | Per-row role `<select>`, **Transfer Ownership** button, confirms, polished card layout, audit warnings |
| `src/styles/app.css` | `.team-member-row`, `.team-role-select`, `.team-transfer-btn`, `.team-warning` |
| `firestore.rules` | Member-write rule enforces role-transition matrix server-side |
| `src/App.tsx` | Insights tab is hidden / route-gated for technicians (close the one open route gap) |

## Role-transition matrix

Reading: "actor of role X performing action Y on a target whose
current role is Z."

| Actor | Action | Target current | Allowed |
|---|---|---|---|
| owner | promote to owner | admin / tech | ✓ |
| owner | demote owner → admin | non-self owner | ✓ |
| owner | demote owner → admin | self | ✓ (if ≥2 owners) |
| owner | demote owner → tech | non-self owner | ✓ |
| owner | demote owner → tech | self | ✓ (if ≥2 owners) |
| owner | demote admin → tech | admin | ✓ |
| owner | promote tech → admin | tech | ✓ |
| owner | remove member | non-owner | ✓ |
| owner | remove member | owner | ✓ (if ≥2 owners) |
| owner | **Transfer Ownership** | admin / tech | ✓ — atomic: target → owner, actor → admin |
| admin | promote tech → admin | tech | ✓ |
| admin | demote admin → tech | non-self admin | ✓ |
| admin | demote admin → tech | self | ✓ |
| admin | remove tech / admin | non-self tech/admin | ✓ |
| admin | remove self (admin) | self | ✓ |
| admin | any owner-touching action | — | ✗ |
| admin | any change TO owner | — | ✗ |
| technician | any team action | — | ✗ |

The pure helper `canChangeRole(actorRole, targetCurrentRole, targetNewRole, isLastOwner, isSelf)`
returns `{ allowed: boolean, reason?: string }` and lives in
`src/lib/teamRoleChange.ts`. Same shape for `canRemoveMember`.

## Pure helpers — `src/lib/teamRoleChange.ts`

```ts
export type RoleAction =
  | { kind: 'remove' }
  | { kind: 'changeRole'; toRole: Role };

export interface RoleChangeContext {
  actorRole: Role;
  targetCurrentRole: Role;
  isSelf: boolean;
  isLastOwner: boolean;          // target is the last remaining owner
}

export interface RoleChangeVerdict {
  allowed: boolean;
  reason?: string;               // user-facing when !allowed
}

export function canChangeRole(
  ctx: RoleChangeContext,
  action: RoleAction,
): RoleChangeVerdict;

export function isLastOwner(
  members: ReadonlyArray<{ uid?: string; role: Role }>,
  targetUid: string,
): boolean;
```

Tests cover every matrix cell + the last-owner edge.

## UI — `TeamManagement.tsx`

The Active Members section becomes a clean stack of cards. Each
card:

```
┌────────────────────────────────────────────────────────┐
│ Jane Doe                                  [Owner badge]│
│ jane@company.com                                       │
│                                                        │
│  Role:  ▼ Owner       [Remove]                         │
└────────────────────────────────────────────────────────┘
```

- **Role dropdown** — `<select>` listing `Owner / Admin / Technician`.
  Disabled when the actor cannot change this row (per the matrix).
  Hovering / focusing a disabled control shows a `title` reason.
  Selecting a new value opens a `window.confirm` (see audit
  safety below) and on Accept writes `role` on the member doc.
- **Remove button** — same as today, gated by the same matrix +
  last-owner protection.
- **Self row** — clearly marked with "(you)" beside the email so
  the actor is never surprised by self-demotion.

**Transfer Ownership** — separate row above the member list,
visible only when the actor is an owner. Tapping it opens a
single-step picker (a `<select>` of `admin` + `technician`
members) → confirm dialog `"Transfer ownership to [name]? You
will become Admin and they will become Owner. Continue?"` →
atomic `writeBatch`:

```
batch.update(members/<target>, { role: 'owner' });
batch.update(members/<actor>,  { role: 'admin' });
batch.commit();
```

If the actor has **co-owners** (≥2 owners total), transferring
still atomically demotes ONLY the actor — the other owners stay
owners. This matches the documented behaviour: "current owner
becomes Admin."

## Audit safety — confirms

| Action | Confirm copy |
|---|---|
| Promote to Owner | "Promote [email] to Owner? They will get full permissions including billing and team management. Continue?" |
| Demote Owner | "Demote owner [email] to [role]? They will lose owner permissions. Continue?" |
| Remove Owner | (existing) "Remove owner [email]? They will immediately lose access to this business." |
| Self-demote | adds "You will lose your owner permissions immediately." |
| Self-remove | adds "You will be signed out of this business." |
| Transfer Ownership | "Transfer ownership to [name]? You will become Admin and they will become Owner. Continue?" |
| Any tech / admin role change | "Set [email] to [new role]? Continue?" |

## Firestore rules — server-side enforcement

`businesses/{bid}/members/{memberId}` write rule grows to enforce
the role-transition matrix:

```
function newRole() {
  return request.method == 'delete' ? null : request.resource.data.role;
}
function existingRole() {
  return resource != null ? resource.data.role : null;
}

allow write: if isSignedIn() && (
  // ── Bootstrap & self-enroll paths unchanged ──
  request.auth.uid == businessId
  || (
    request.auth.uid == memberId
    && businessOwnerUid(businessId) == request.auth.uid
  )
  // ── Owner: any role transition; cannot orphan via demote/delete ──
  || (
    memberRole(businessId) == 'owner'
    && (
      // Anything the owner does to a non-owner is allowed.
      existingRole() != 'owner'
      // Touching another owner is allowed only if the actor is NOT that
      // member, or if at least one OTHER owner exists.
      || memberId != request.auth.uid
      || isAtLeastTwoOwners(businessId)
    )
  )
  // ── Admin: bounded transitions only ──
  || (
    memberRole(businessId) == 'admin'
    && existingRole() != 'owner'              // can't touch owner docs
    && (newRole() == null || newRole() == 'admin' || newRole() == 'technician')
  )
);
```

`isAtLeastTwoOwners(businessId)` is a new helper that runs a
`get()` count via the members collection — Firestore rules can't
list collections, so the simplest server-side last-owner guard is
**a denormalised counter on `settings/main.ownerCount`** OR a
client-batched write that includes the counter update. Since we
already enforce last-owner protection client-side, the
server-side gate provides defense-in-depth via a simpler check:

> Reject any write that would set `role` to something other than
> `'owner'` (demote) on a doc whose existing role is `'owner'`,
> **when the requester is that same owner**, UNLESS the
> `request.resource.data` carries a guard token marking the
> demote as part of a Transfer-Ownership batch.

To avoid a denormalised counter, the implementation takes the
**simpler path**: the rule allows the owner to do anything (the
owner is trusted at maximum privilege); client-side enforcement
is the last-owner guard. Server-side protects against admins and
technicians; owner-orphan is a client UI invariant.

This is documented in the rules-block comment so the trust model
is explicit. A future iteration can add the counter once
multi-business pressure justifies it.

## Permission flag changes

`src/lib/permissions.ts`:

```ts
export interface Permissions {
  // … existing …
  canManageOwners: boolean;     // NEW — owner-only
  // … existing …
}
```

`getPermissions(role)`:

- `owner`  → `canManageOwners: true`
- `admin`  → `canManageOwners: false`
- `technician` → `canManageOwners: false`

The UI uses `canManageOwners` as the gate for the Transfer
Ownership row + for enabling owner-target selections in the
dropdown + for owner-row Remove.

## Insights route gate — close the one open gap

The existing accordions in Settings are all already gated. The
last route-level gap is the **Insights tab**: any member can land
on `tab === 'insights'` and render the page. In `src/App.tsx`,
change:

```tsx
if (tab === 'insights') return <Insights jobs={jobs} settings={settings} />;
```

to a guarded render that respects `permissions.canViewProfit` (or
add an `canViewInsights` flag if cleaner — see below). Techs lose
the Insights nav item and the page renders an inline "Owners
and admins only" notice if the route is hit directly. The
BottomNav already hides tabs the actor lacks permission for —
verify in passing.

Decision: re-use `canViewFinancials` rather than add yet another
flag. The Insights page is fundamentally a financial briefing
(revenue, profit, aging) — `canViewFinancials` is the right gate
semantically, and it's already `true` for owner/admin / `false`
for tech.

## Edge cases

- **Last owner demote attempt** — UI dropdown for "Owner" is
  disabled on the actor's own row when they are the sole owner.
  Title: "Last owner — promote another member to owner first."
- **Last owner remove attempt** — same as already shipped (button
  disabled + tooltip).
- **Concurrent transfer** — two owners both try to transfer to
  the same target at the same time. The `writeBatch` is atomic;
  second writer either lands a no-op (target already owner) or
  produces an `admin`/`admin` end state. Not catastrophic; UI
  refreshes via the live snapshot.
- **Stale session** — the actor's `memberRole` could change
  out-from-under them. The `usePermissions` context re-evaluates
  on every snapshot tick; controls greying-out is the worst case.
  No data corruption possible — rules enforce.
- **Tech escalation attempt** — a tech who somehow opens
  TeamManagement (they can't — `canManageTeam` is false; the
  accordion isn't visible) and forges a write — rules reject
  (memberRole == 'technician' doesn't match owner or admin
  branch).

## Testing

`tests/teamRoleChange.test.ts` — hand-rolled `tsx` runner. ~24
checks covering every matrix cell + last-owner edge:

- `canChangeRole` per role-actor × role-target × action permutation.
- `isLastOwner` boundary (1 owner → true; 2 owners → false).
- Each verdict's `reason` is non-empty when `!allowed`.

UI is verified manually.

## Files

- Modify `src/lib/permissions.ts` — add `canManageOwners`.
- Create `src/lib/teamRoleChange.ts` — pure helpers.
- Create `tests/teamRoleChange.test.ts` — logic tests.
- Modify `src/components/TeamManagement.tsx` — dropdown, transfer,
  polish.
- Modify `src/styles/app.css` — team-card polish.
- Modify `src/App.tsx` — Insights tab `canViewFinancials` gate.
- Modify `firestore.rules` — member-write role-transition matrix.

## Out of scope (explicitly)

- **Denormalised `ownerCount` on settings/main.** A future
  hardening if multi-owner businesses become common; client-side
  + rules-by-actor-role enforce the invariant today.
- **Inviting an existing user as a co-owner** — the invite flow
  already supports role selection at create time. Not changed.
- **Revoking outstanding invites by role change** — invites are a
  separate collection with its own lifecycle.
- **Email notification to the demoted / removed member** — the
  app has no email infrastructure yet; demoted members find out
  on next page load.
- **Audit log** — no dedicated history collection. Firestore's
  built-in audit trail (Cloud Audit Logs) is the system of
  record. A user-facing audit log is a future feature.
