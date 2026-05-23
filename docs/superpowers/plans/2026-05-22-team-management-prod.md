# Team Management Production-Grade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row role dropdown + atomic Transfer Ownership to `TeamManagement.tsx`, with owner-only gating, last-owner protection, server-side rule enforcement of the role-transition matrix, and a `canViewFinancials` gate on the Insights tab.

**Architecture:** Pure helper `src/lib/teamRoleChange.ts` owns the verdict logic; the UI consumes it for control-disable + confirm wiring. `Permissions` interface gains `canManageOwners` (owner-only). Firestore rules add a role-transition matrix on member writes. App routes the Insights tab through the existing `canViewFinancials` flag.

**Tech Stack:** TypeScript, React 18, Firestore, hand-rolled `tsx` test runner.

> Spec: `docs/superpowers/specs/2026-05-22-team-management-prod-design.md`

---

## File Structure

- **Modify `src/lib/permissions.ts`** — add `canManageOwners: boolean` (owner-only).
- **Create `src/lib/teamRoleChange.ts`** — pure helpers: `canChangeRole`, `canRemoveMember`, `isLastOwner`, `RoleChangeContext`, `RoleAction`, `RoleChangeVerdict`.
- **Create `tests/teamRoleChange.test.ts`** — logic tests covering the role-transition matrix + last-owner edge.
- **Modify `src/components/TeamManagement.tsx`** — per-row role dropdown, Transfer Ownership row, polished cards, audit confirms.
- **Modify `src/styles/app.css`** — `.team-member-row`, `.team-role-select`, `.team-transfer`, small layout polish.
- **Modify `src/App.tsx`** — guard the `'insights'` tab on `permissions.canViewFinancials`.
- **Modify `firestore.rules`** — role-transition matrix on the member-write rule.

Notes for the engineer:
- `useMembership()` returns `{ role, member, permissions }`. Use `permissions.canManageOwners` (added by Task A) at the UI layer.
- The active members live in the local `members` state populated by the `onSnapshot` listener already in `TeamManagement.tsx`.
- Atomic Transfer Ownership uses Firestore `writeBatch`. Import from `firebase/firestore`; `_db` is the Firestore instance from `@/lib/firebase`.
- `tests/*.test.ts` run via `npx tsx tests/<name>.test.ts`. `@/` resolves to `src/`.

---

## Task A: `canManageOwners` flag + `teamRoleChange.ts` pure helpers + tests

**Files:**
- Modify: `src/lib/permissions.ts`
- Create: `src/lib/teamRoleChange.ts`
- Test: `tests/teamRoleChange.test.ts`

- [ ] **Step 1: Add `canManageOwners` to the `Permissions` interface**

In `src/lib/permissions.ts`:

1. Find the `Permissions` interface (search for `export interface Permissions`). Add this line in the same group as the other team flags (near `canManageTeam`):
   ```ts
   canManageOwners: boolean;
   ```
2. Find the EMPTY_PERMISSIONS (or equivalent default) const — the zero-state object that has every flag set to `false`. Add:
   ```ts
   canManageOwners: false,
   ```
3. Find the role → permissions resolver (likely a function like `getPermissions(role)` or a per-role const). For **owner** set:
   ```ts
   canManageOwners: true,
   ```
   For **admin** and **technician** sets:
   ```ts
   canManageOwners: false,
   ```

(If the file uses `Core` / per-plan permissions in addition to per-role, also add `canManageOwners: false` to the Core / non-team-managing plan blocks — the audit pass is "every `Permissions` literal in the file gets the new field".)

- [ ] **Step 2: Write the failing test**

Create `tests/teamRoleChange.test.ts`:

```ts
// tests/teamRoleChange.test.ts
// Run: npx tsx tests/teamRoleChange.test.ts

import {
  canChangeRole, canRemoveMember, isLastOwner,
} from '@/lib/teamRoleChange';
import type { Role } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const ctx = (
  actorRole: Role, targetCurrentRole: Role,
  over: Partial<{ isSelf: boolean; isLastOwner: boolean }> = {},
) => ({ actorRole, targetCurrentRole, isSelf: false, isLastOwner: false, ...over });

console.log('\n┌─ isLastOwner ─────────────────────────────────────');
check('one owner → true',
  isLastOwner([{ uid: 'a', role: 'owner' }, { uid: 'b', role: 'admin' }], 'a'));
check('two owners → false',
  !isLastOwner([{ uid: 'a', role: 'owner' }, { uid: 'b', role: 'owner' }], 'a'));
check('target is not an owner → false',
  !isLastOwner([{ uid: 'a', role: 'owner' }, { uid: 'b', role: 'admin' }], 'b'));
check('missing uid → false',
  !isLastOwner([{ role: 'owner' }, { uid: 'b', role: 'admin' }], 'a'));

console.log('\n┌─ canChangeRole — owner actor ─────────────────────');
check('owner → promote tech to admin',
  canChangeRole(ctx('owner', 'technician'), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('owner → promote tech to owner',
  canChangeRole(ctx('owner', 'technician'), { kind: 'changeRole', toRole: 'owner' }).allowed);
check('owner → demote admin to tech',
  canChangeRole(ctx('owner', 'admin'), { kind: 'changeRole', toRole: 'technician' }).allowed);
check('owner → demote co-owner to admin (≥2 owners)',
  canChangeRole(ctx('owner', 'owner', { isLastOwner: false }), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('owner → demote LAST owner → rejected',
  !canChangeRole(ctx('owner', 'owner', { isLastOwner: true, isSelf: true }), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('owner → no-op same role → rejected',
  !canChangeRole(ctx('owner', 'admin'), { kind: 'changeRole', toRole: 'admin' }).allowed);

console.log('\n┌─ canChangeRole — admin actor ─────────────────────');
check('admin → promote tech to admin',
  canChangeRole(ctx('admin', 'technician'), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('admin → demote admin to tech',
  canChangeRole(ctx('admin', 'admin'), { kind: 'changeRole', toRole: 'technician' }).allowed);
check('admin → promote tech to OWNER → rejected',
  !canChangeRole(ctx('admin', 'technician'), { kind: 'changeRole', toRole: 'owner' }).allowed);
check('admin → promote admin to OWNER → rejected',
  !canChangeRole(ctx('admin', 'admin'), { kind: 'changeRole', toRole: 'owner' }).allowed);
check('admin → demote owner → rejected',
  !canChangeRole(ctx('admin', 'owner'), { kind: 'changeRole', toRole: 'admin' }).allowed);

console.log('\n┌─ canChangeRole — technician actor ────────────────');
check('tech cannot change any role',
  !canChangeRole(ctx('technician', 'technician'), { kind: 'changeRole', toRole: 'admin' }).allowed);
check('tech cannot promote self',
  !canChangeRole(ctx('technician', 'technician', { isSelf: true }), { kind: 'changeRole', toRole: 'admin' }).allowed);

console.log('\n┌─ canRemoveMember ─────────────────────────────────');
check('owner removes tech',
  canRemoveMember(ctx('owner', 'technician')).allowed);
check('owner removes admin',
  canRemoveMember(ctx('owner', 'admin')).allowed);
check('owner removes co-owner (≥2 owners)',
  canRemoveMember(ctx('owner', 'owner', { isLastOwner: false })).allowed);
check('owner removes LAST owner → rejected',
  !canRemoveMember(ctx('owner', 'owner', { isLastOwner: true })).allowed);
check('admin removes tech',
  canRemoveMember(ctx('admin', 'technician')).allowed);
check('admin removes admin (non-self)',
  canRemoveMember(ctx('admin', 'admin')).allowed);
check('admin removes owner → rejected',
  !canRemoveMember(ctx('admin', 'owner')).allowed);
check('tech removes anyone → rejected',
  !canRemoveMember(ctx('technician', 'technician')).allowed);

console.log('\n┌─ verdict reason ──────────────────────────────────');
check('rejected verdict has a non-empty reason',
  (() => {
    const v = canRemoveMember(ctx('admin', 'owner'));
    return !v.allowed && typeof v.reason === 'string' && v.reason.length > 0;
  })());

console.log(`\n  ${passed} passed, ${failed} failed`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx tests/teamRoleChange.test.ts`
Expected: FAIL — module `@/lib/teamRoleChange` does not exist yet.

- [ ] **Step 4: Write `src/lib/teamRoleChange.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx tests/teamRoleChange.test.ts`
Expected: PASS — `24 passed, 0 failed`.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit` — expect clean. Then:

```bash
git add src/lib/permissions.ts src/lib/teamRoleChange.ts tests/teamRoleChange.test.ts
git commit -m "feat(team): canManageOwners + teamRoleChange pure helpers"
```

---

## Task B: TeamManagement UI — role dropdown, Transfer Ownership, polish

**Files:**
- Modify: `src/components/TeamManagement.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: CSS polish**

In `src/styles/app.css`, add a new block near the bottom (or alongside other component blocks). Find a sensible insertion point — e.g. after the last `.team-*` rule if any, or at end of file before any media queries:

```css

/* ── Team Management — production-grade cards ───────────────── */
.team-member-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border2);
}
.team-member-row:first-child { border-top: none; }
.team-member-row.self {
  background: rgba(244,180,0,.04);
}
.team-member-row-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.team-member-row-info {
  flex: 1; min-width: 0;
}
.team-member-row-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--t1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.team-member-row-name .self-tag {
  margin-left: 6px;
  font-size: 10px;
  color: var(--t3);
  font-weight: 600;
}
.team-member-row-email {
  font-size: 10px;
  color: var(--t3);
  margin-top: 2px;
}
.team-member-row-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.team-role-select {
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  color: var(--t1);
  font-size: 12px;
  min-height: 36px;
}
.team-role-select:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.team-transfer {
  margin: 0 0 12px 0;
  padding: 10px 12px;
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.team-transfer-title {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--t3);
  margin-bottom: 6px;
}
.team-transfer-row {
  display: flex; gap: 8px; align-items: center;
}
.team-transfer-row select {
  flex: 1;
}
.team-transfer-row .btn { min-height: 36px; }
.team-warning {
  font-size: 11px;
  color: var(--amber);
  margin-top: 4px;
}
```

- [ ] **Step 2: Imports in `TeamManagement.tsx`**

Add to the existing imports:

```ts
import { writeBatch } from 'firebase/firestore';
import { canChangeRole, canRemoveMember, isLastOwner } from '@/lib/teamRoleChange';
```

(`writeBatch` is the new firestore import; the others are new lib imports.)

- [ ] **Step 3: Rewrite the active-members list rendering**

Find the existing `members.map((m, idx) => (` block in `TeamManagement.tsx` (the one that renders each member row inside the active-members box). Replace it entirely with the new card-style layout. The actor info is available via `_auth.currentUser.uid`.

Replace the block from the opening `<div style={{ background: 'var(--s2)', border: …`  through its closing `</div>` (the `</div>` immediately before the `)}` that closes the `members.length === 0 ? … : (...)` ternary's `(` branch) with the new structure. The new content:

```tsx
        <div style={{
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          {members.map((m) => {
            const actorUid = _auth?.currentUser?.uid;
            const isSelf = !!actorUid && m.uid === actorUid;
            const actorRole = (() => {
              if (!actorUid) return 'technician' as const;
              const me = members.find((x) => x.uid === actorUid);
              return (me?.role ?? 'technician') as Role;
            })();
            const lastOwner = m.uid ? isLastOwner(members, m.uid) : false;

            // Build the dropdown options + per-option allow verdict
            // so the UI can disable forbidden transitions.
            const roleOptions: Role[] = ['owner', 'admin', 'technician'];
            const optionVerdict = (toRole: Role) => canChangeRole({
              actorRole, targetCurrentRole: m.role, isSelf, isLastOwner: lastOwner,
            }, { kind: 'changeRole', toRole });
            const anyChangeAllowed = roleOptions.some((r) => r !== m.role && optionVerdict(r).allowed);
            const removeVerdict = canRemoveMember({
              actorRole, targetCurrentRole: m.role, isSelf, isLastOwner: lastOwner,
            });

            return (
              <div key={m.uid || m.email} className={'team-member-row' + (isSelf ? ' self' : '')}>
                <div className="team-member-row-head">
                  <div className="team-member-row-info">
                    <div className="team-member-row-name">
                      {m.displayName || m.email}
                      {isSelf && <span className="self-tag">(you)</span>}
                    </div>
                    <div className="team-member-row-email">{m.email}</div>
                  </div>
                  <RoleBadge role={m.role} />
                </div>
                <div className="team-member-row-controls">
                  <select
                    className="team-role-select"
                    aria-label={`Role for ${m.email}`}
                    value={m.role}
                    disabled={!anyChangeAllowed}
                    onChange={(e) => changeRole(m, e.target.value as Role)}
                  >
                    {roleOptions.map((r) => {
                      const v = r === m.role ? { allowed: true } : optionVerdict(r);
                      const label = r.charAt(0).toUpperCase() + r.slice(1);
                      return (
                        <option key={r} value={r} disabled={!v.allowed}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    className="btn sm danger"
                    onClick={() => remove(m)}
                    disabled={!removeVerdict.allowed}
                    title={removeVerdict.allowed ? undefined : removeVerdict.reason}
                    style={{ flexShrink: 0 }}
                  >
                    Remove
                  </button>
                </div>
                {!anyChangeAllowed && actorRole !== 'technician' && (
                  <div className="team-warning" title={lastOwner ? 'Last owner — promote another member to owner first' : undefined}>
                    {lastOwner ? '⚠ Last owner — no role change possible' : '⚠ No allowed role change'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
```

(`Role` type — extend the existing `import type { … Role } from '@/types';` line to include `Role` if not already there.)

- [ ] **Step 4: Add the `changeRole` handler**

Immediately above the existing `remove = async (member) => {…}` function inside `TeamManagement`, add:

```tsx
  const changeRole = async (member: MemberDoc, toRole: Role) => {
    if (!member.uid) {
      addToast('Member uid missing — cannot change role', 'warn');
      return;
    }
    const actorUid = _auth?.currentUser?.uid || '';
    const me = members.find((x) => x.uid === actorUid);
    const actorRole = (me?.role ?? 'technician') as Role;
    const verdict = canChangeRole({
      actorRole,
      targetCurrentRole: member.role,
      isSelf: member.uid === actorUid,
      isLastOwner: isLastOwner(members, member.uid),
    }, { kind: 'changeRole', toRole });
    if (!verdict.allowed) {
      addToast(verdict.reason || 'Role change not allowed', 'warn');
      return;
    }

    const isSelf = member.uid === actorUid;
    const wasOwner = member.role === 'owner';
    const becomesOwner = toRole === 'owner';
    let msg: string;
    if (becomesOwner) {
      msg = `Promote ${member.email} to Owner? They will get full permissions including billing and team management. Continue?`;
    } else if (wasOwner) {
      msg = `Demote owner ${member.email} to ${toRole}? They will lose owner permissions. Continue?`;
      if (isSelf) msg += '\n\nYou will lose your owner permissions immediately.';
    } else {
      msg = `Set ${member.email} to ${toRole}? Continue?`;
    }
    if (!window.confirm(msg)) return;

    try {
      const db = _db; if (!db) throw new Error('Firestore not initialized');
      await deleteDoc; // (keep tree-shake happy — no-op reference)
      // Single-doc role write; the existing onSnapshot listener
      // picks up the change live.
      const ref = doc(db, 'businesses', businessId, 'members', member.uid);
      await import('firebase/firestore').then(({ setDoc }) =>
        setDoc(ref, { ...member, role: toRole }, { merge: true }),
      );
      addToast(`${member.email} → ${toRole}`, 'info');
    } catch (e) {
      addToast((e as Error).message || 'Role change failed', 'error');
    }
  };
```

Notes:
- The dynamic `import('firebase/firestore').then(({ setDoc }) => …)` avoids needing a static import diff if `setDoc` isn't already imported — but if it IS already imported, replace with a plain `setDoc(ref, …)` call and drop the dynamic import. Look at the existing imports first.
- The `await deleteDoc;` line above is a no-op reference to keep ESLint quiet about the existing `deleteDoc` import while not actually calling it. If `setDoc` is already imported and the line is unnecessary, remove it.

Cleaner alternative (if `setDoc` isn't yet imported): extend the existing top-of-file imports:

```ts
import { collection, onSnapshot, deleteDoc, doc, setDoc, writeBatch, type Unsubscribe } from 'firebase/firestore';
```

…then the handler body becomes:

```tsx
    try {
      const db = _db; if (!db) throw new Error('Firestore not initialized');
      const ref = doc(db, 'businesses', businessId, 'members', member.uid);
      await setDoc(ref, { ...member, role: toRole }, { merge: true });
      addToast(`${member.email} → ${toRole}`, 'info');
    } catch (e) {
      addToast((e as Error).message || 'Role change failed', 'error');
    }
```

Prefer this clean form. The `setDoc` import lives next to `deleteDoc`.

- [ ] **Step 5: Add the Transfer Ownership row above the active-members list**

In `TeamManagement.tsx`, find the rendered "Active members ({members.length})" header (the `<div>` with `fontWeight: 800; textTransform: 'uppercase'`). Immediately **before** it, render the transfer block (owner-only):

```tsx
      {permissions.canManageOwners && members.filter((m) => m.role !== 'owner').length > 0 && (
        <TransferOwnership members={members} businessId={businessId} />
      )}
```

Then, at the top of the file (before the existing `TeamManagement` export), define the sub-component:

```tsx
function TransferOwnership({
  members, businessId,
}: {
  members: MemberDoc[];
  businessId: string;
}) {
  const [target, setTarget] = useState('');
  const candidates = members.filter((m) => m.role !== 'owner' && m.uid);

  const onTransfer = async (): Promise<void> => {
    if (!target) return;
    const actorUid = _auth?.currentUser?.uid;
    if (!actorUid) {
      addToast('Sign-in required', 'warn');
      return;
    }
    const targetMember = members.find((m) => m.uid === target);
    if (!targetMember) {
      addToast('Target member not found', 'warn');
      return;
    }
    const name = targetMember.displayName || targetMember.email;
    const ok = window.confirm(
      `Transfer ownership to ${name}? You will become Admin and they will become Owner. Continue?`,
    );
    if (!ok) return;

    try {
      const db = _db; if (!db) throw new Error('Firestore not initialized');
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'businesses', businessId, 'members', target),
        { ...targetMember, role: 'owner' as Role },
        { merge: true },
      );
      const actorMember = members.find((m) => m.uid === actorUid);
      if (actorMember) {
        batch.set(
          doc(db, 'businesses', businessId, 'members', actorUid),
          { ...actorMember, role: 'admin' as Role },
          { merge: true },
        );
      }
      await batch.commit();
      addToast(`Ownership transferred to ${name}`, 'info');
      setTarget('');
    } catch (e) {
      addToast((e as Error).message || 'Transfer failed', 'error');
    }
  };

  return (
    <div className="team-transfer">
      <div className="team-transfer-title">Transfer ownership</div>
      <div className="team-transfer-row">
        <select
          className="team-role-select"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Pick a member…</option>
          {candidates.map((m) => (
            <option key={m.uid} value={m.uid}>
              {(m.displayName || m.email)} · {m.role}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn sm primary"
          disabled={!target}
          onClick={onTransfer}
        >
          Transfer
        </button>
      </div>
      <div className="team-warning">
        You will become Admin and the selected member will become Owner.
      </div>
    </div>
  );
}
```

(The `permissions.canManageOwners` reference assumes `permissions` is already in scope inside `TeamManagement` — it is, since `const permissions = usePermissions();` runs at the top of the component. If for some reason it's `useMembership().permissions` instead, adjust accordingly.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/TeamManagement.tsx src/styles/app.css
git commit -m "feat(team): role dropdown + Transfer Ownership + polished cards"
```

---

## Task C: Firestore rules + Insights tab gate

**Files:**
- Modify: `firestore.rules`
- Modify: `src/App.tsx`

- [ ] **Step 1: Tighten the `members/{memberId}` write rule**

In `firestore.rules`, find the `match /members/{memberId} { … allow write: …}` block. Replace its `allow write:` line with:

```
        allow write: if isSignedIn() && (
          // ── Bootstrap & self-enroll paths (unchanged) ──
          request.auth.uid == businessId
          || (
            request.auth.uid == memberId
            && businessOwnerUid(businessId) == request.auth.uid
          )
          // ── Owner: any role transition. Last-owner protection is
          //    enforced client-side (a future hardening adds a
          //    denormalised ownerCount). ──
          || (
            memberDocExists(businessId)
            && memberRole(businessId) == 'owner'
          )
          // ── Admin: bounded transitions only. Cannot touch owner
          //    docs, cannot promote to owner. ──
          || (
            memberDocExists(businessId)
            && memberRole(businessId) == 'admin'
            && (resource == null || resource.data.role != 'owner')
            && (
              request.method == 'delete'
              || request.resource.data.role == 'admin'
              || request.resource.data.role == 'technician'
            )
          )
        );
```

Update the rule's preceding comment block to document the matrix:

```
        // WRITE paths (owner-only role transitions are enforced
        // server-side; last-owner protection is client-side):
        //
        //  1. Convention-owner (uid == businessId) — pre-multi-business
        //     bootstrap path. Unchanged.
        //
        //  2. Self-enroll into a business YOU created (memberId == uid
        //     and you are settings.ownerUid). Unchanged.
        //
        //  3. Owner of THIS business — any role transition on any
        //     member doc (including their own demote / removal). The
        //     UI prevents the last-owner from demoting / removing
        //     themselves. A future server-side counter can add
        //     defense-in-depth.
        //
        //  4. Admin of THIS business — bounded transitions. They can
        //     write member docs only when:
        //       • The existing doc (if any) is NOT an owner, AND
        //       • The incoming role is NOT 'owner' (admin can't
        //         promote to owner).
        //     This rejects every owner-touching admin write.
```

- [ ] **Step 2: Gate the Insights tab in `src/App.tsx`**

Find the line:

```tsx
    if (tab === 'insights') return <Insights jobs={jobs} settings={settings} />;
```

Replace with:

```tsx
    if (tab === 'insights') {
      if (!permissions.canViewFinancials) {
        return (
          <div className="page page-enter">
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Insights</div>
            <div style={{
              padding: 14,
              background: 'var(--s2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--t3)',
              lineHeight: 1.5,
            }}>
              Insights are available to owners and admins. Ask the
              business owner if you need access.
            </div>
          </div>
        );
      }
      return <Insights jobs={jobs} settings={settings} />;
    }
```

`permissions` is already in scope at this point in `App.tsx` (the `tab` switch is inside the rendering body where `usePermissions()` was called earlier). If `permissions` isn't actually in scope, derive it from `useMembership()` (already used) or import `usePermissions` from `@/context/MembershipContext` and call it at the top of the routing function.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules src/App.tsx
git commit -m "feat(team): firestore role-transition matrix + Insights canViewFinancials gate"
```

---

## Task D: Verify + ship

- [ ] **Step 1: Logic tests**

Run: `npm test`
Expected: every suite `0 failed`, including `teamRoleChange` (`24 passed`).

- [ ] **Step 2: Component tests**

Run: `npm run test:ui`
Expected: `Test Files  5 passed`, `Tests  35 passed`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Manual UI verification**

On the deployed app → Settings → Team Management (signed in as the owner):

- Each member card shows a role dropdown. Selecting a new role
  opens the matching confirm; on accept the role updates live.
- A **Transfer ownership** row sits above the member list with a
  dropdown of admin / technician members + a **Transfer** button.
  Picking a target and confirming swaps roles atomically (you →
  admin, target → owner).
- Sole-owner safeguards: if you are the only owner, the dropdown
  on your own row disables Owner→Admin/Tech, and the Remove
  button is disabled with the "Last owner — promote another
  member to owner first" tooltip.
- Sign in as **admin** — Transfer Ownership row is hidden, owner
  rows are read-only (no role-change permitted, Remove disabled).
- Sign in as **technician** — Team accordion is hidden (existing
  behaviour via `canManageTeam`); if forced via dev tools, the
  permission-denied notice shows.

On any tab → Insights:
- Owner / admin → page renders normally.
- Technician → "Insights are available to owners and admins"
  inline notice (no charts leak).

- [ ] **Step 5: Push**

```bash
git push
```

Note: the Firestore rules change in this commit is committed to
git but does **not** auto-deploy. Existing client guards keep the
app functional; the rules become the server-side enforcement once
`firebase deploy --only firestore:rules` runs (see the roadmap
memory's "KNOWN GAP — firestore.rules not deployed" entry).

---

## Notes

- Each task leaves the build green.
- Owner-self-demote / self-remove safety is enforced exclusively
  client-side. A future hardening can add a denormalised
  `ownerCount` on `settings/main` for server-side defense in
  depth; out of scope here.
