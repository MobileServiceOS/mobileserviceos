# Multi-User Foundation Implementation Plan (Phase 2.2 / Sub-Project B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the technician-role multi-user infrastructure described in [docs/superpowers/specs/2026-05-21-multi-user-foundation-design.md](../specs/2026-05-21-multi-user-foundation-design.md). Adds `Job.assignedToUid`, a view-scoping hook, an assignment picker, nav gating for techs, and firestore.rules role predicates.

**Architecture:** Strictly additive widening on top of Sub-Project A. The membership infrastructure (`Role`, `MemberDoc`, `MembershipContext`, `Permissions`, `TeamManagement.tsx`, firestore.rules `isOwnerOrAdmin` helper) already exists from Phase 1. This sub-project plugs in the three missing pieces (`assignedToUid` field, `useScopedJobs` hook, role-based job-write rules) and fixes one permission flag (`canViewRevenue` for techs).

**Tech Stack:** TypeScript strict mode, React 18, Firestore security rules. No new dependencies.

**Commit cadence:** one focused commit per task; never squash. Each task ends with `npm run build` + (where applicable) `npx tsx tests/<file>.test.ts`. **Task 9 (firestore.rules deploy) pauses for explicit user confirmation before pushing — security boundary change.**

---

## File Structure

**Files to create:**

| File | Responsibility |
|---|---|
| `src/lib/jobPermissions.ts` | Pure helpers: `scopeJobsByRole`, `canEditJob`, `canDeleteJob`, `assignableMembers` |
| `src/lib/useScopedJobs.ts` | React hook wrapping `scopeJobsByRole` with `useMembership` |
| `src/components/addJob/AssignmentPicker.tsx` | Owner/admin-only inline picker on AddJob |
| `tests/scopedJobs.test.ts` | `scopeJobsByRole` coverage |
| `tests/jobEditPermission.test.ts` | `canEditJob` coverage |
| `tests/jobDeletePermission.test.ts` | `canDeleteJob` coverage |
| `tests/assignableMembers.test.ts` | `assignableMembers` coverage |
| `tests/technicianPermissions.test.ts` | Verify `canViewRevenue: true` and other tech permissions resolve correctly |

**Files to modify:**

| File | Change |
|---|---|
| `src/types/index.ts` | Add `Job.assignedToUid?: string` |
| `src/lib/deserializers.ts` | Deserialize `assignedToUid` |
| `src/lib/permissions.ts` | Set `canViewRevenue: true` for `TECHNICIAN_PERMISSIONS` |
| `src/pages/AddJob.tsx` | Mount `AssignmentPicker` for owner/admin |
| `src/pages/Dashboard.tsx` | Wrap jobs in `useScopedJobs`; gate financial KPI cards on `canViewFinancials` |
| `src/pages/History.tsx` | Wrap jobs in `useScopedJobs` |
| `src/pages/Customers.tsx` | Wrap jobs in `useScopedJobs`; hide "All Customers" surface for techs |
| `src/components/Header.tsx` | Hide tabs `expenses`, `payouts` for techs |
| `src/components/MoreSheet.tsx` | Hide tabs `expenses`, `payouts`, restrict Settings entry |
| `src/App.tsx` | `saveJob` stamps `assignedToUid` from draft (or `currentUid` when tech-created); `deleteJob` guard already exists via `canDeleteJob` |
| `firestore.rules` | Tighten `jobs/{id}` write predicate to role-based |

---

## Task 1: Add `Job.assignedToUid` schema

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/deserializers.ts`

- [ ] **Step 1: Add the field to the `Job` interface**

In `src/types/index.ts`, append to the `Job` interface (after the existing mechanic parts fields from Sub-Project A, before the closing `}`):

```ts
  /** The technician this job is assigned to. Set by owner/admin via
   *  the AddJob assignment picker. Undefined = unassigned (legacy
   *  jobs or owner/admin jobs that bypassed the picker). */
  assignedToUid?: string;
```

- [ ] **Step 2: Deserialize the field**

In `src/lib/deserializers.ts`, find `deserializeJob` and add the field handler in the same idiom as `createdByUid`:

```ts
    assignedToUid: raw.assignedToUid == null ? undefined : asString(raw.assignedToUid),
```

Place it adjacent to `createdByUid` if that field is already deserialized; otherwise append before the closing return.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: TS clean, no consumer changes required.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/deserializers.ts
git commit -m "feat(types): Job.assignedToUid additive field"
```

---

## Task 2: Fix technician permission resolver (`canViewRevenue: true`)

**Files:**
- Modify: `src/lib/permissions.ts`
- Create: `tests/technicianPermissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/technicianPermissions.test.ts
import { getRolePermissions, getPermissions } from '@/lib/permissions';
import type { MemberDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ technician role permissions ─────────────────────');
{
  const p = getRolePermissions('technician');
  check('canCreateJobs', p.canCreateJobs === true);
  check('canEditJobs', p.canEditJobs === true);
  check('canDeleteJobs', p.canDeleteJobs === false);
  check('canViewRevenue (must collect payment)', p.canViewRevenue === true);
  check('canViewProfit (hidden)', p.canViewProfit === false);
  check('canViewFinancials (hidden)', p.canViewFinancials === false);
  check('canManageInventory', p.canManageInventory === false);
  check('canManageExpenses', p.canManageExpenses === false);
  check('canEditBusinessSettings', p.canEditBusinessSettings === false);
  check('canManageTeam', p.canManageTeam === false);
  check('canGenerateInvoices', p.canGenerateInvoices === true);
}
console.log('\n┌─ owner role permissions (regression) ─────────────');
{
  const p = getRolePermissions('owner');
  check('owner: canViewProfit', p.canViewProfit === true);
  check('owner: canDeleteJobs', p.canDeleteJobs === true);
  check('owner: canManageBilling', p.canManageBilling === true);
}
console.log('\n┌─ admin role permissions (regression) ─────────────');
{
  const p = getRolePermissions('admin');
  check('admin: canViewProfit', p.canViewProfit === true);
  check('admin: canDeleteJobs', p.canDeleteJobs === true);
  check('admin: canManageBilling (false)', p.canManageBilling === false);
}
console.log('\n┌─ getPermissions integration ──────────────────────');
{
  const m: MemberDoc = { uid: 'u1', businessId: 'b1', role: 'technician', status: 'active' } as MemberDoc;
  const p = getPermissions(m, { plan: 'pro' });
  check('tech with pro plan: canViewRevenue still true', p.canViewRevenue === true);
  check('tech with pro plan: canViewAdvancedReports still false', p.canViewAdvancedReports === false);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test (expect failures)**

```bash
npx tsx tests/technicianPermissions.test.ts
```
Expected: at least the `canViewRevenue (must collect payment)` assertion fails because today's `TECHNICIAN_PERMISSIONS` doesn't override it from `ALL_FALSE`.

- [ ] **Step 3: Update the technician resolver**

In `src/lib/permissions.ts`, update `TECHNICIAN_PERMISSIONS`:

```ts
const TECHNICIAN_PERMISSIONS: Permissions = {
  ...ALL_FALSE,
  canUsePricingEngine: true,
  canCreateJobs: true,
  canEditJobs: true,        // own jobs only — enforced in rules + UI
  canViewRevenue: true,     // tech must see customer-charged amount to collect payment
  canGenerateInvoices: true,
  canSendReviews: true,
};
```

- [ ] **Step 4: Run test again**

```bash
npx tsx tests/technicianPermissions.test.ts
```
Expected: all assertions pass.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions.ts tests/technicianPermissions.test.ts
git commit -m "feat(permissions): technicians can view per-job revenue (must collect payment)"
```

---

## Task 3: Pure helpers — `src/lib/jobPermissions.ts`

**Files:**
- Create: `src/lib/jobPermissions.ts`

- [ ] **Step 1: Write the helpers**

```ts
// src/lib/jobPermissions.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers for the multi-user job-scoping + assignment system.
//  See docs/superpowers/specs/2026-05-21-multi-user-foundation-design.md
//  Every function is pure: no I/O, no globals, no React.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Role, MemberDoc } from '@/types';

/**
 * Scope the job list to what the given role + uid is allowed to see.
 * Owner / admin: pass-through (full list).
 * Technician: union of jobs they're assigned to OR created.
 * No role / null uid: empty (defensive).
 */
export function scopeJobsByRole(
  jobs: ReadonlyArray<Job>,
  role: Role | null | undefined,
  uid: string | null | undefined,
): Job[] {
  if (role === 'owner' || role === 'admin') return [...jobs];
  if (role === 'technician' && uid) {
    return jobs.filter(
      (j) => j.assignedToUid === uid || j.createdByUid === uid,
    );
  }
  return [];
}

/**
 * Can the given role + uid edit this job?
 * Owner / admin: always.
 * Technician: only when they're the assignee or creator.
 */
export function canEditJob(
  job: Pick<Job, 'assignedToUid' | 'createdByUid'>,
  role: Role | null | undefined,
  uid: string | null | undefined,
): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (role !== 'technician' || !uid) return false;
  return job.assignedToUid === uid || job.createdByUid === uid;
}

/**
 * Can the given role delete jobs? Delete is owner/admin only —
 * techs never delete, regardless of ownership of the job.
 */
export function canDeleteJob(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Special assignee option representing "no one." Use as the
 *  `Job.assignedToUid` value when the picker is left on Unassigned. */
export const UNASSIGNED = '' as const;

export interface AssigneeOption {
  uid: string; // empty string for UNASSIGNED
  label: string;
  isSelf?: boolean;
}

/**
 * Build the picker options for the assignment dropdown. Returns:
 *   - "Me" first (current uid)
 *   - "Unassigned" second
 *   - Each active technician (sorted alphabetically by name)
 *
 * Members with status !== 'active' are filtered out. The current
 * user is excluded from the technician list because they appear as
 * "Me" instead.
 */
export function assignableMembers(
  members: ReadonlyArray<MemberDoc>,
  currentUid: string,
): AssigneeOption[] {
  const techs = members
    .filter((m) => m.status === 'active' && m.role === 'technician' && m.uid !== currentUid)
    .sort((a, b) =>
      String(a.displayName || a.email || a.uid)
        .localeCompare(String(b.displayName || b.email || b.uid)),
    )
    .map<AssigneeOption>((m) => ({
      uid: m.uid,
      label: m.displayName || m.email || m.uid,
    }));

  return [
    { uid: currentUid, label: 'Me', isSelf: true },
    { uid: UNASSIGNED, label: 'Unassigned' },
    ...techs,
  ];
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobPermissions.ts
git commit -m "feat(perms): pure helpers (scopeJobsByRole / canEditJob / canDeleteJob / assignableMembers)"
```

---

## Task 4: Helper tests

**Files:**
- Create: `tests/scopedJobs.test.ts`
- Create: `tests/jobEditPermission.test.ts`
- Create: `tests/jobDeletePermission.test.ts`
- Create: `tests/assignableMembers.test.ts`

- [ ] **Step 1: Write `tests/scopedJobs.test.ts`**

```ts
// tests/scopedJobs.test.ts
import { scopeJobsByRole } from '@/lib/jobPermissions';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const j = (over: Partial<Job> = {}): Job => ({
  id: over.id ?? 'j', date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

const jobs: Job[] = [
  j({ id: 'a', assignedToUid: 'tech1', createdByUid: 'owner' }),
  j({ id: 'b', assignedToUid: 'tech2', createdByUid: 'owner' }),
  j({ id: 'c', assignedToUid: undefined, createdByUid: 'tech1' }),
  j({ id: 'd', assignedToUid: 'tech1', createdByUid: 'tech1' }),
  j({ id: 'e', assignedToUid: undefined, createdByUid: 'owner' }),
];

console.log('\n┌─ scopeJobsByRole ─────────────────────────────────');
check('owner sees all 5', scopeJobsByRole(jobs, 'owner', 'owner').length === 5);
check('admin sees all 5', scopeJobsByRole(jobs, 'admin', 'admin').length === 5);
check('tech1 sees a + c + d (3 jobs)',
  scopeJobsByRole(jobs, 'technician', 'tech1').length === 3);
check('tech2 sees b only',
  scopeJobsByRole(jobs, 'technician', 'tech2').length === 1);
check('tech with no jobs sees empty',
  scopeJobsByRole(jobs, 'technician', 'tech-nobody').length === 0);
check('null role → empty',
  scopeJobsByRole(jobs, null, 'tech1').length === 0);
check('tech with null uid → empty',
  scopeJobsByRole(jobs, 'technician', null).length === 0);
check('owner returns a NEW array (not same reference)',
  scopeJobsByRole(jobs, 'owner', 'owner') !== jobs);
check('owner clone preserves order',
  scopeJobsByRole(jobs, 'owner', 'owner')[0].id === 'a');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Write `tests/jobEditPermission.test.ts`**

```ts
// tests/jobEditPermission.test.ts
import { canEditJob } from '@/lib/jobPermissions';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ canEditJob ──────────────────────────────────────');
check('owner edits any job',
  canEditJob({ assignedToUid: 'x', createdByUid: 'y' }, 'owner', 'me') === true);
check('admin edits any job',
  canEditJob({ assignedToUid: 'x', createdByUid: 'y' }, 'admin', 'me') === true);
check('tech edits job they are assigned to',
  canEditJob({ assignedToUid: 'me', createdByUid: 'someone' }, 'technician', 'me') === true);
check('tech edits job they created',
  canEditJob({ assignedToUid: 'someone', createdByUid: 'me' }, 'technician', 'me') === true);
check('tech cannot edit a stranger\'s job',
  canEditJob({ assignedToUid: 'them', createdByUid: 'them' }, 'technician', 'me') === false);
check('tech without uid cannot edit',
  canEditJob({ assignedToUid: 'me', createdByUid: 'me' }, 'technician', null) === false);
check('null role cannot edit',
  canEditJob({ assignedToUid: 'me', createdByUid: 'me' }, null, 'me') === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Write `tests/jobDeletePermission.test.ts`**

```ts
// tests/jobDeletePermission.test.ts
import { canDeleteJob } from '@/lib/jobPermissions';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ canDeleteJob ────────────────────────────────────');
check('owner can delete', canDeleteJob('owner') === true);
check('admin can delete', canDeleteJob('admin') === true);
check('technician cannot delete', canDeleteJob('technician') === false);
check('null role cannot delete', canDeleteJob(null) === false);
check('undefined role cannot delete', canDeleteJob(undefined) === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: Write `tests/assignableMembers.test.ts`**

```ts
// tests/assignableMembers.test.ts
import { assignableMembers, UNASSIGNED } from '@/lib/jobPermissions';
import type { MemberDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const mem = (over: Partial<MemberDoc>): MemberDoc => ({
  uid: 'm', businessId: 'b', role: 'technician', status: 'active',
  ...over,
} as MemberDoc);

console.log('\n┌─ assignableMembers ───────────────────────────────');
{
  const opts = assignableMembers([], 'owner');
  check('empty members + owner uid → 2 options (Me + Unassigned)', opts.length === 2);
  check('first option is Me with current uid', opts[0].uid === 'owner' && opts[0].isSelf === true);
  check('second option is Unassigned', opts[1].uid === UNASSIGNED);
}
{
  const members = [
    mem({ uid: 'tech1', displayName: 'Bob' }),
    mem({ uid: 'tech2', displayName: 'Alice' }),
  ];
  const opts = assignableMembers(members, 'owner');
  check('2 techs + owner uid → 4 options', opts.length === 4);
  check('techs sorted alphabetically (Alice before Bob)',
    opts[2].label === 'Alice' && opts[3].label === 'Bob');
}
{
  const members = [
    mem({ uid: 'tech1', displayName: 'Bob', status: 'pending' }),
    mem({ uid: 'tech2', displayName: 'Alice' }),
    mem({ uid: 'tech3', displayName: 'Carol', status: 'disabled' }),
  ];
  const opts = assignableMembers(members, 'owner');
  check('non-active members filtered out',
    opts.length === 3 && opts[2].label === 'Alice');
}
{
  const members = [
    mem({ uid: 'admin1', displayName: 'Adam', role: 'admin' }),
    mem({ uid: 'tech1', displayName: 'Bob' }),
  ];
  const opts = assignableMembers(members, 'owner');
  check('non-technician roles excluded',
    opts.length === 3 && opts[2].label === 'Bob');
}
{
  const members = [mem({ uid: 'me', displayName: 'Me' }), mem({ uid: 'tech1', displayName: 'Bob' })];
  const opts = assignableMembers(members, 'me');
  check('current uid excluded from tech list (appears as Me)',
    opts.length === 3 && !opts.slice(2).some((o) => o.uid === 'me'));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 5: Run all four tests**

```bash
npx tsx tests/scopedJobs.test.ts
npx tsx tests/jobEditPermission.test.ts
npx tsx tests/jobDeletePermission.test.ts
npx tsx tests/assignableMembers.test.ts
```
Expected: each prints `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add tests/scopedJobs.test.ts tests/jobEditPermission.test.ts tests/jobDeletePermission.test.ts tests/assignableMembers.test.ts
git commit -m "test(perms): coverage for scopeJobsByRole / canEditJob / canDeleteJob / assignableMembers"
```

---

## Task 5: `useScopedJobs` hook

**Files:**
- Create: `src/lib/useScopedJobs.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/lib/useScopedJobs.ts
// ═══════════════════════════════════════════════════════════════════
//  React hook returning the job list filtered to what the current
//  member is allowed to see. Pass-through for owner/admin. For
//  technicians, applies the assigned-OR-created filter.
//  Memoized on jobs ref + role + member.uid so re-renders don't
//  re-filter when nothing relevant changed.
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { Job } from '@/types';
import { useMembership } from '@/context/MembershipContext';
import { scopeJobsByRole } from '@/lib/jobPermissions';

export function useScopedJobs(jobs: ReadonlyArray<Job>): Job[] {
  const { role, member } = useMembership();
  return useMemo(
    () => scopeJobsByRole(jobs, role, member?.uid),
    [jobs, role, member?.uid],
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/useScopedJobs.ts
git commit -m "feat(perms): useScopedJobs hook"
```

---

## Task 6: `AssignmentPicker` component + AddJob mount + saveJob stamp

**Files:**
- Create: `src/components/addJob/AssignmentPicker.tsx`
- Modify: `src/pages/AddJob.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the picker component**

```tsx
// src/components/addJob/AssignmentPicker.tsx
// ═══════════════════════════════════════════════════════════════════
//  Inline assignment picker for AddJob. Visible only to owner/admin
//  AND only when the business has ≥1 active technician member. Tech
//  accounts never see this component — every job they create is
//  auto-assigned to themselves in saveJob.
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { MemberDoc } from '@/types';
import { assignableMembers, UNASSIGNED } from '@/lib/jobPermissions';

interface Props {
  value: string | undefined;
  onChange: (uid: string | undefined) => void;
  members: ReadonlyArray<MemberDoc>;
  currentUid: string;
}

export function AssignmentPicker({ value, onChange, members, currentUid }: Props) {
  const options = useMemo(
    () => assignableMembers(members, currentUid),
    [members, currentUid],
  );
  const hasTechs = options.length > 2; // Me + Unassigned + at least one tech
  if (!hasTechs) return null;

  const selected = value === undefined || value === null ? UNASSIGNED : value;

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Assigned to</div>
      <div className="chip-grid">
        {options.map((opt) => (
          <button
            key={opt.uid || '__unassigned'}
            type="button"
            className={'chip' + (selected === opt.uid ? ' active' : '')}
            onClick={() => onChange(opt.uid === UNASSIGNED ? undefined : opt.uid)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the picker in `AddJob.tsx`**

Open `src/pages/AddJob.tsx`. Add the imports:

```ts
import { AssignmentPicker } from '@/components/addJob/AssignmentPicker';
import { useMembership } from '@/context/MembershipContext';
```

The `AddJob` function receives `inventory` from props but does not currently receive `members`. Add `members` to the Props interface:

```ts
interface Props {
  // ... existing props ...
  members: MemberDoc[];
}
```

And import the `MemberDoc` type at the top:
```ts
import type { Job, Settings, InventoryItem, TireSource, MemberDoc } from '@/types';
```

Inside the component, grab the current uid + role:

```ts
const { role, member } = useMembership();
const currentUid = member?.uid || '';
const canAssign = role === 'owner' || role === 'admin';
```

Insert the picker right after the existing Customer block. Search for `<div className="form-group card-anim">` containing `Customer` title, find its closing `</div>`, then add immediately after:

```tsx
{canAssign && (
  <AssignmentPicker
    value={job.assignedToUid}
    onChange={(uid) => setJob({ ...job, assignedToUid: uid })}
    members={members}
    currentUid={currentUid}
  />
)}
```

- [ ] **Step 3: Pass `members` from App.tsx to AddJob**

Open `src/App.tsx`. Find where AddJob is rendered (search for `<AddJob `). The component subscribes to members elsewhere — locate where `members` is held in state. Run:

```bash
grep -n "members\|MemberDoc\[\]" src/App.tsx | head -20
```

Pass the existing `members` state through to AddJob:

```tsx
<AddJob
  // ... existing props ...
  members={members}
/>
```

If the existing `members` state isn't held in App.tsx, fall back to passing an empty array (the picker simply doesn't render):

```tsx
<AddJob
  // ...
  members={[]}
/>
```

(See implementation note: if no members state exists in App.tsx, that's a follow-up; the picker safely no-ops on empty input.)

- [ ] **Step 4: Stamp `assignedToUid` in saveJob**

In `src/App.tsx`, locate `saveJob`. The current implementation already stamps `createdByUid: j.createdByUid || currentUid`. Add a sibling `assignedToUid` stamp in the `finalJob` construction:

```ts
const finalJob: Job = {
  ...j,
  // ... existing assignments including createdByUid, createdAt ...
  // For technicians or any draft without an explicit assignee, default
  // to self. Owner/admin can override via the picker.
  assignedToUid: j.assignedToUid !== undefined ? j.assignedToUid : currentUid,
  // ... rest of fields including the mechanic mirrors ...
};
```

Place this immediately after `createdByUid:` for adjacency.

- [ ] **Step 5: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/addJob/AssignmentPicker.tsx src/pages/AddJob.tsx src/App.tsx
git commit -m "feat(addjob): AssignmentPicker + saveJob stamps assignedToUid"
```

---

## Task 7: View-filter wiring (Dashboard / History / Customers)

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/History.tsx`
- Modify: `src/pages/Customers.tsx`

- [ ] **Step 1: Wire `useScopedJobs` in `Dashboard.tsx`**

At the top of Dashboard.tsx imports:
```ts
import { useScopedJobs } from '@/lib/useScopedJobs';
import { usePermissions } from '@/context/MembershipContext';
```

Inside the component, near the top (after existing hook calls):

```ts
const scopedJobs = useScopedJobs(jobs);
const perms = usePermissions();
```

Then **replace every reference to the unscoped `jobs` prop with `scopedJobs`** for the data-display reads. Run:

```bash
grep -n "\bjobs\b" src/pages/Dashboard.tsx
```

For each line referencing `jobs` as input to a computation or render, change to `scopedJobs`. Do NOT change references that are passing the prop on to a child or that are component-prop names.

Gate the financial KPI block with `perms.canViewFinancials`. Find the KPI grid (search for `kpi-grid`) and wrap it:

```tsx
{perms.canViewFinancials && (
  <div className="kpi-grid">
    {/* existing KPI cards */}
  </div>
)}
```

- [ ] **Step 2: Wire `useScopedJobs` in `History.tsx`**

Same pattern: import the hook, derive `const scopedJobs = useScopedJobs(jobs);`, then substitute `scopedJobs` for `jobs` everywhere the list is consumed.

- [ ] **Step 3: Wire `useScopedJobs` in `Customers.tsx`**

Same pattern. Customers list is derived from jobs, so scoping the input naturally scopes the output.

Additionally, the "All Customers" header / count text should reflect that the list is filtered. Replace `Total: N customers` style headers with the scoped count.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/History.tsx src/pages/Customers.tsx
git commit -m "feat(perms): scope Dashboard/History/Customers via useScopedJobs; gate financial KPIs"
```

---

## Task 8: Nav gating (Header + MoreSheet)

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/components/MoreSheet.tsx`

- [ ] **Step 1: Gate tabs in `Header.tsx`**

The Header renders the top tab nav. Identify the array of tabs (search for `tabs = [` or `TAB_IDS`). For each tab that should be hidden from technicians (`expenses`, `payouts`, `customers`-as-browse), gate visibility on `usePermissions()`.

```ts
import { usePermissions } from '@/context/MembershipContext';

// inside the component:
const perms = usePermissions();
const tabs = ALL_TABS.filter((t) => {
  if (t.id === 'expenses' && !perms.canManageExpenses) return false;
  if (t.id === 'payouts'  && !perms.canViewFinancials) return false;
  return true;
});
```

Adapt the exact filter to match the existing `ALL_TABS` shape in Header.tsx (the field name may be `key` rather than `id`).

- [ ] **Step 2: Gate items in `MoreSheet.tsx`**

`MoreSheet.tsx` renders the bottom-sheet "More" menu. Same idiom: import `usePermissions`, filter the menu items array on the role-relevant permission flags.

```ts
import { usePermissions } from '@/context/MembershipContext';

// inside the component:
const perms = usePermissions();
const items = ALL_ITEMS.filter((it) => {
  if (it.id === 'expenses' && !perms.canManageExpenses) return false;
  if (it.id === 'payouts'  && !perms.canViewFinancials) return false;
  if (it.id === 'customers' && !perms.canViewFinancials) return false;
  return true;
});
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.tsx src/components/MoreSheet.tsx
git commit -m "feat(nav): hide expenses/payouts/customers tabs from technicians"
```

---

## Task 9: firestore.rules tightening (REQUIRES USER CONFIRMATION BEFORE PUSH)

**Files:**
- Modify: `firestore.rules`

> **STOP CRITERION ALERT.** Security boundary change. The implementation steps below ONLY modify the local file. The push + deploy step at the end of this task pauses for explicit user confirmation. Do NOT push without it.

- [ ] **Step 1: Read the existing `jobs` and `inventory` rule blocks**

```bash
grep -n "match /jobs\|match /inventory\|isMemberOfBusiness\|isOwnerOrAdmin" firestore.rules | head -20
```

Confirm `isMemberOfBusiness` and `isOwnerOrAdmin` helpers exist.

- [ ] **Step 2: Tighten the `jobs/{docId}` rule**

Find the `match /jobs/{docId}` block. Replace the existing `allow write: if isMemberOfBusiness(businessId);` (or equivalent) with:

```
match /jobs/{docId} {
  allow read: if isMemberOfBusiness(businessId);

  // Owner/admin: full write. Technician: create only if they're the
  // creator + assignee; update only if they're the assignee or creator;
  // never delete.
  allow create: if isMemberOfBusiness(businessId) && (
    isOwnerOrAdmin(businessId) ||
    request.auth.uid == businessId || // legacy convention-owner
    (request.resource.data.createdByUid == request.auth.uid &&
     request.resource.data.assignedToUid == request.auth.uid)
  );

  allow update: if isMemberOfBusiness(businessId) && (
    isOwnerOrAdmin(businessId) ||
    request.auth.uid == businessId ||
    resource.data.assignedToUid == request.auth.uid ||
    resource.data.createdByUid == request.auth.uid
  );

  allow delete: if isOwnerOrAdmin(businessId) ||
                   request.auth.uid == businessId;
}
```

- [ ] **Step 3: Confirm `inventory/{docId}` stays open for member writes**

Per spec §8: inventory writes must remain open for any member because the existing tire + mechanic deduction paths issue `inventory.update()` to decrement `qty` during job save. Confirm the rule reads:

```
match /inventory/{docId} {
  allow read: if isMemberOfBusiness(businessId);
  allow create: if isOwnerOrAdmin(businessId) ||
                   request.auth.uid == businessId;
  allow update: if isMemberOfBusiness(businessId); // deduction flow needs this
  allow delete: if isOwnerOrAdmin(businessId) ||
                   request.auth.uid == businessId;
}
```

If the existing rule has `allow write` (covering all of create/update/delete), split it into the three separate clauses above.

- [ ] **Step 4: Confirm other restricted collections**

`settings/main`, `expenses/{id}`, `payouts/{id}`, `customers/{id}` (where they exist) should already gate writes on `isOwnerOrAdmin` per the existing rules. Confirm via:

```bash
grep -n "match /settings\|match /expenses\|match /payouts" firestore.rules
```

If any of these still permit broad `isMemberOfBusiness` writes, tighten to `isOwnerOrAdmin`.

- [ ] **Step 5: Local syntax sanity check**

Firebase rules don't have a local "lint" without the emulator, but you can spot-check by searching for unbalanced braces:

```bash
grep -c '^[[:space:]]*}' firestore.rules
```
Should be a reasonable count (≥ 30 for this file). Make sure your edits don't leave orphan opening braces.

- [ ] **Step 6: Commit the local change (DO NOT PUSH YET)**

```bash
git add firestore.rules
git commit -m "feat(rules): role-based write gating for jobs (techs limited to own jobs)"
```

- [ ] **Step 7: PAUSE — surface the diff to the user**

Run:
```bash
git show HEAD --stat firestore.rules
git diff HEAD~1 HEAD -- firestore.rules
```

Present the full diff to the user. Wait for explicit "approved" or "push" before proceeding. Do NOT push autonomously even in execution mode — this is the stop-criterion case for rules / security changes.

- [ ] **Step 8: After user approval, push and deploy**

```bash
git push origin main
```

The Firebase Pages deploy picks up `firestore.rules` and applies it to the production project. Allow up to 60 seconds for propagation.

---

## Task 10: Final smoke + push + tag

- [ ] **Step 1: Re-run every test file**

```bash
npx tsx tests/jobLifecycle.test.ts
npx tsx tests/mechanicJobDerivation.test.ts
npx tsx tests/mechanicDeductionDiff.test.ts
npx tsx tests/mechanicDeductionRollback.test.ts
npx tsx tests/softStockWarning.test.ts
npx tsx tests/mechanicInvoiceLineItems.test.ts
npx tsx tests/technicianPermissions.test.ts
npx tsx tests/scopedJobs.test.ts
npx tsx tests/jobEditPermission.test.ts
npx tsx tests/jobDeletePermission.test.ts
npx tsx tests/assignableMembers.test.ts
```
Expected: every file prints `N passed, 0 failed`.

- [ ] **Step 2: Final clean build**

```bash
npm run build
```
Expected: TS clean, Vite emit, no circular-dep warnings.

- [ ] **Step 3: Confirm commit log is granular**

```bash
git log --oneline origin/main..HEAD
```
Expected: ~8-10 commits, each focused on one task.

- [ ] **Step 4: Run the §12 spec smoke checklist on production**

After Task 9 deploy lands, hand-execute the spec's pre-tag smoke checklist:

- 5 owner regression items
- 10 technician account flow items
- 3 cross-cutting items

- [ ] **Step 5: Tag stable**

```bash
git tag phase-2.2-multi-user-stable $(git rev-parse HEAD)
git push origin phase-2.2-multi-user-stable
```

---

## Phase summary

After all 10 tasks land:

| Surface | Result |
|---|---|
| Types | `Job.assignedToUid?` added |
| Permissions resolver | Tech gets `canViewRevenue: true`; everything else unchanged |
| Pure helpers | `scopeJobsByRole`, `canEditJob`, `canDeleteJob`, `assignableMembers` (one module: `src/lib/jobPermissions.ts`) |
| Tests | 5 new files (~50 assertions); existing test suites still pass |
| Hook | `useScopedJobs` |
| UI | `AssignmentPicker` on AddJob (owner/admin only); Dashboard/History/Customers filtered for techs; financial KPIs hidden from techs; Header/MoreSheet hide privileged tabs |
| Save | `saveJob` stamps `assignedToUid` (defaults to self for tech; explicit for owner/admin) |
| Rules | Jobs writes gated by role + ownership; inventory writes stay open for the deduction flow |
| Backward compat | Owner / admin behavior byte-identical; existing jobs without `assignedToUid` visible to owner/admin only; no migration required |
