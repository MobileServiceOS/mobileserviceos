# Phase 2.2 / Sub-Project B — Multi-User Foundation Design Spec

**Status:** Approved for implementation planning (2026-05-21)

**Owning phase:** Phase 2.2 mechanic full-slice — Sub-Project B (technician role, permissions, assigned-tech relationship).

**Predecessor sub-projects:**
- A. Mechanic Operations — tagged `phase-2.2-mechanic-ops-stable` (commit `fa0f25b`). Provides the mechanic flow this sub-project layers permissions on top of.
- Job-lifecycle foundation — provides `transitions[]` shape for future audit, though this sub-project doesn't write to it.

**Successor sub-projects:**
- C. Dispatch + Lifecycle UI — needs `assignedToUid` to render per-tech columns and the lifecycle writers to fire stage transitions.
- D. CRM Automation Hooks — uses `assignedToUid` to dispatch tech-audience notifications via the `StageNotificationSpec` model.

---

## 1. Goal

Complete the multi-user infrastructure that's been partially in the codebase since Phase 1: an owner can invite a technician, assign them jobs, restrict their view to their own work, and trust that the technician can't see other techs' financials or accidentally damage the catalog. Owner/admin behavior is byte-identical to today.

**Out of scope this sub-project:** dispatch board (Sub-Project C), notifications (Sub-Project D), per-tech commission splits, per-tech KPI dashboards, customer-facing technician profiles, real-time job-status updates between devices, technician onboarding wizard, two-factor for technician accounts.

## 2. Hard constraints

- Owner / admin workflows byte-identical to today
- Additive migrations only (no required-field changes)
- `useScopedJobs` is a pass-through for owner/admin — zero perf impact
- Firestore rules changes are additive predicates (existing reads/writes that pass today still pass)
- Mobile-first surface; no per-screen role-switch toggles
- No new dependencies
- No notification dispatch (Sub-Project D)
- No dispatch board screen (Sub-Project C)
- Existing tire and mechanic accounts stay fully functional with no migration

## 3. Architecture

Membership infrastructure already exists from Phase 1:

- `Role = 'owner' | 'admin' | 'technician'` in `src/types/index.ts`
- `MemberDoc` shape with `uid / businessId / role / status`
- `MembershipContext` resolves `{ member, role, permissions, loading }`
- `Permissions` interface declares ~20 capability flags (canViewFinancials, canViewProfit, canEditJobs, canDeleteJobs, canManageInventory, canManageExpenses, canManageTeam, etc.)
- `TeamManagement.tsx` covers invite + pending + active members + remove
- `firestore.rules` checks membership doc existence

Sub-Project B completes this with three additions:

1. **`assignedToUid` field on Job** — additive, optional
2. **`useScopedJobs()` hook** — single read-side filter applied to Dashboard, History, Customers, and any future tech-facing list
3. **firestore.rules role-based write predicates** — restrict tech writes to jobs they own; restrict catalog mutations to owner/admin

No new components from scratch — `TeamManagement.tsx` keeps its existing role; the new work is the assignment picker + view-filter wiring.

## 4. Schema

Single additive field on Job:

```ts
export interface Job {
  // ...existing fields...

  /** The technician this job is assigned to. Set by owner/admin via
   *  the AddJob assignment picker. Undefined = unassigned (legacy
   *  jobs from before Sub-Project B, or owner/admin self-jobs that
   *  never went through the picker). */
  assignedToUid?: string;
}
```

`createdByUid?: string` already exists. No schema changes to `MemberDoc`, `Settings`, `InventoryItem`, or any other type.

## 5. Technician permission matrix

| Capability | Tech | Admin | Owner |
|---|:-:|:-:|:-:|
| **Jobs** | | | |
| View jobs where `assignedToUid === me` OR `createdByUid === me` | ✓ | all | all |
| Create job (auto-stamps `createdByUid` + `assignedToUid = self`) | ✓ | ✓ | ✓ |
| Edit job where `me === assigned or creator` | ✓ | ✓ | ✓ |
| Edit any other job | ✗ | ✓ | ✓ |
| Delete job | ✗ | ✓ | ✓ |
| Assign / re-assign to a tech | ✗ | ✓ | ✓ |
| **Inventory** | | | |
| Read full catalog (required to pick parts on AddJob) | ✓ | ✓ | ✓ |
| Deduct on save (via existing tire / mechanic save paths) | ✓ | ✓ | ✓ |
| Add / edit / delete inventory items | ✗ | ✓ | ✓ |
| **Customers** | | | |
| See customer name / phone / address on visible jobs | ✓ | ✓ | ✓ |
| Browse all customers / open customer detail page | ✗ | ✓ | ✓ |
| **$ visibility** | | | |
| Job total / customer-charged revenue (must collect payment) | ✓ | ✓ | ✓ |
| Cost basis / profit / margin on individual jobs | ✗ | ✓ | ✓ |
| Dashboard KPI cards (weekly revenue, parts margin, etc.) | ✗ | ✓ | ✓ |
| Expenses / Payouts pages | ✗ | ✓ | ✓ |
| **Settings** | | | |
| Business settings / branding / pricing | ✗ | ✓ | ✓ |
| Team / invites | ✗ | ✓ | ✓ |
| Personal profile (name / email) | ✓ | ✓ | ✓ |

Most flags already exist in `Permissions`. The work is wiring them through the UI components that don't currently consult them.

## 6. Assignment UI

Inline picker on AddJob, between Customer block and Job Details:

```
┌──────────────────────────────────────────────┐
│ Assigned to                                    │
│  [ Me (Auto)  ▾ ]                              │
└──────────────────────────────────────────────┘
```

- Visibility gate: `role === 'owner' || role === 'admin'` AND business has ≥1 active technician member
- Dropdown options (in order):
  1. "Me" — current owner / admin (selects their own uid)
  2. "Unassigned" — clears `assignedToUid`
  3. Each active technician (sorted by name)
- Default value on new job: `Me` for owner / admin
- Technicians do not see this picker — every job they create is auto-assigned to themselves via `createdByUid = assignedToUid = me` in `saveJob`
- Editing a job: picker shows current assignee; owner/admin can change

No dedicated "dispatch board" screen this sub-project. Re-assignment is per-job via this picker only.

## 7. View filtering

New hook `useScopedJobs()` in `src/lib/useScopedJobs.ts`:

```ts
export function useScopedJobs(jobs: ReadonlyArray<Job>): Job[] {
  const { role, member } = useMembership();
  if (role !== 'technician') return [...jobs]; // pass-through
  const myUid = member?.uid;
  if (!myUid) return []; // defensive: no uid resolves to empty
  return jobs.filter(
    (j) => j.assignedToUid === myUid || j.createdByUid === myUid,
  );
}
```

Consumers (updated to call `useScopedJobs(jobs)` instead of reading `jobs` directly):

- `Dashboard.tsx` — KPI cards + recent-activity list
- `History.tsx` — full job list view
- `Customers.tsx` — derives customer list from job set; scoping flows through
- Any future tech-facing list

Owner / admin path is a pass-through clone (`[...jobs]`) — no behavior change for them.

Dashboard additionally checks `permissions.canViewFinancials` and `permissions.canViewProfit` to hide the financial KPI cards (revenue, parts margin, target profit) for technicians. The activity list (recent jobs, in-progress count) remains visible.

**Permission flag resolution for the technician role** (codified in `MembershipContext`'s permission resolver):

| Flag | Tech value | Rationale |
|---|:-:|---|
| `canViewFinancials` | false | Tech doesn't see business-wide financial totals |
| `canViewRevenue` | **true** | Tech must see customer-charged amount on their own jobs to collect payment |
| `canViewProfit` | false | Margin / cost basis hidden from tech |
| `canViewAdvancedReports` | false | Reports page hidden from tech |

The Dashboard's KPI rendering branches on `canViewFinancials` (controls the financial cards block as a whole). Per-job revenue displays use `canViewRevenue`. Cost basis / margin displays use `canViewProfit`.

## 8. Firestore rules tightening

Current rules check membership doc existence. Sub-Project B adds role-based write predicates.

```
function userRole(businessId) {
  return get(/databases/$(database)/documents/businesses/$(businessId)/members/$(request.auth.uid)).data.role;
}

function isOwnerOrAdmin(businessId) {
  let r = userRole(businessId);
  return r == 'owner' || r == 'admin'
    || request.auth.uid == businessId; // legacy convention-owner
}

// jobs/{id}
allow create: if isMember(businessId) && (
  isOwnerOrAdmin(businessId) ||
  // Tech can create as long as they're the creator + assignee
  (request.resource.data.createdByUid == request.auth.uid &&
   request.resource.data.assignedToUid == request.auth.uid)
);
allow update: if isMember(businessId) && (
  isOwnerOrAdmin(businessId) ||
  (resource.data.assignedToUid == request.auth.uid ||
   resource.data.createdByUid == request.auth.uid)
);
allow delete: if isOwnerOrAdmin(businessId);

// inventory/{id}
// Note: techs MUST be able to write inventory docs at job-save time
// because the existing tire + mechanic deduction paths issue
// inventory.update() to decrement qty. Catalog management (add /
// edit fields beyond qty / delete) is gated at the UI layer via the
// `canManageInventory` permission flag; the rules permit any member
// to write so the deduction flow remains atomic with the job write.
allow read: if isMember(businessId);
allow create: if isOwnerOrAdmin(businessId);
allow update: if isMember(businessId);
allow delete: if isOwnerOrAdmin(businessId);

// settings/main
allow write: if isOwnerOrAdmin(businessId);
allow read: if isMember(businessId);

// expenses, payouts, customers (collection-level browse)
allow read: if isOwnerOrAdmin(businessId);
allow write: if isOwnerOrAdmin(businessId);
```

**Read scoping note**: `jobs/{id}` reads stay membership-gated at the rules layer. The technician view filter (`useScopedJobs`) is a **client-side scoping** of the read result set — the tech can technically `get()` a sibling tech's job by ID if they knew it, but no UI surface exposes the IDs, and the financial fields would render hidden via `canViewProfit === false` regardless. Strict server-side per-job-read scoping requires either denormalized assignee indexes or a Cloud Function read API; deferred per the local-first / no-Blaze constraint. This is the same trust boundary today's `createdByUid` filter operates under.

## 9. Backward compatibility & migration

- **Existing owner-only accounts**: their `MemberDoc` has `role: 'owner'` (or unset, falling back to owner via the existing bootstrap heuristic in `MembershipContext`). `useScopedJobs` returns the full list for owner/admin — zero behavior change.
- **Existing jobs without `assignedToUid`**: filter on `assignedToUid === myUid` is false for these, but the OR clause on `createdByUid === myUid` catches any job the tech created. Pre-existing jobs without either field stay visible to owner/admin only — no orphan job problem for the owner.
- **No backfill script** — additive widening + organic write-on-touch upgrade. Same pattern as Sub-Project A.
- **firestore.rules**: the new predicates are *additions* to existing predicates; any read or write that passes today (owner / admin) keeps passing. The new restrictions only apply to technician-role writes — and no production technician exists yet at the time of this deploy.

## 10. UI changes summary

| Component | Change |
|---|---|
| `src/pages/AddJob.tsx` | Add the assignment picker block. Technician path skips picker, auto-assigns to self in `saveJob`. |
| `src/pages/Dashboard.tsx` | Wrap `jobs` reads in `useScopedJobs`; gate KPI financial cards on `canViewProfit` / `canViewRevenue` / `canViewFinancials`. |
| `src/pages/History.tsx` | Wrap `jobs` reads in `useScopedJobs`. |
| `src/pages/Customers.tsx` | Wrap `jobs` reads in `useScopedJobs` so the derived customer list scopes naturally. Hide top-level "All Customers" surface for technicians. |
| `src/pages/Payouts.tsx`, `Expenses.tsx`, `Settings.tsx` | Already gate by `canManageExpenses` / `canViewFinancials` / etc. — audit and confirm; fix any unguarded routes. |
| `src/App.tsx` | `saveJob` stamps `assignedToUid` from the new picker (or `currentUid` for tech-created jobs). Tab nav hides Expenses / Payouts for technicians. |
| `src/components/Header.tsx` / nav | Hide tabs the tech can't reach (Payouts, Expenses, Customers list, Settings non-personal). |

No new files except `src/lib/useScopedJobs.ts` and the test files in §11.

## 11. Testing

Five pure-helper test files in `tests/`:

| File | Coverage |
|---|---|
| `tests/scopedJobs.test.ts` | `scopeJobsByRole(jobs, role, uid)` — owner sees all; admin sees all; tech sees union of assigned ∪ created; tech with no jobs sees empty; null role → empty (defensive) |
| `tests/jobWritePermission.test.ts` | `canEditJob(job, role, uid)` — true when owner/admin; true for tech when me === assignee or creator; false otherwise |
| `tests/jobDeletePermission.test.ts` | `canDeleteJob(role)` — only owner/admin; tech always false |
| `tests/assignableMembers.test.ts` | `assignableMembers(members)` — returns active technicians sorted by name + special "Me" + "Unassigned" entries |
| `tests/financialVisibility.test.ts` | Verifies `canViewFinancials` / `canViewRevenue` / `canViewProfit` resolve correctly for each role; verifies Dashboard would hide cards based on those flags |

All runnable via `npx tsx tests/<file>.test.ts`. Target ~30 assertions per file, ~150 total.

**No firestore rules emulator tests** — repo has no emulator setup; manual smoke against deployed rules is the validation path. The rules predicates are simple enough (membership + role lookup) that manual review + the production smoke covers the risk.

## 12. Pre-tag production smoke checklist

**Owner regression (must be identical to phase-2.2-mechanic-ops-stable):**
- [ ] Owner sees every job on Dashboard / History / Customers
- [ ] Owner Dashboard renders all financial KPI cards
- [ ] Owner can create / edit / delete any job
- [ ] Owner can edit inventory / settings / pricing / branding
- [ ] Existing TeamManagement.tsx invite flow still works

**Technician account flow:**
- [ ] Invite a tech via TeamManagement; tech accepts via invite link
- [ ] Tech logs in: sees only jobs they were assigned or created
- [ ] Tech Dashboard hides financial KPI cards; activity list visible
- [ ] Tech can create a new job (auto-assigns to self); appears in their list
- [ ] Tech can edit own jobs; cannot edit a job assigned to a different uid
- [ ] Tech has no Delete button on job rows
- [ ] Tech has no Expenses / Payouts tabs in nav
- [ ] Tech Settings shows only profile; no business / pricing / team sections
- [ ] Tech sees inventory list but no add/edit/delete actions
- [ ] Tech can pick parts from inventory on AddJob (deduction still works on save)

**Cross-cutting:**
- [ ] No console errors on any of the above
- [ ] Firestore rules reject a manually-crafted tech write that violates the assigned/creator predicate (test via browser devtools)
- [ ] Bundle-size delta ≤ +5kB gzipped on the index chunk

## 13. Rollback path

Each commit in the implementation plan is independently revertible:

- Adding `assignedToUid` to the Job type — purely additive; safe to revert anytime
- `useScopedJobs` hook addition — safe to revert; owner/admin behavior was a pass-through
- AddJob picker addition — safe to revert; existing AddJob still works
- firestore.rules update — `git revert` restores prior rules; existing owner/admin writes still pass under either ruleset (the new predicates only ADD allowance paths for technicians)
- Tab nav gating in App.tsx — safe to revert

`partsInventoryDeductions[]` and `inventoryDeductions[]` rollback paths from Sub-Project A still apply for any inventory-touching deploy.

## 14. Performance posture

- `useScopedJobs` adds one `Array.filter` per render of a job-consuming page. For accounts with < 10,000 jobs this is sub-millisecond; no perf risk.
- firestore.rules `get()` calls for role resolution cost one extra Firestore read per write. Per Firebase docs the `get()` results are cached within a single rule evaluation, so writes still cost 1 doc read. Free-tier impact: negligible.
- No new listeners, no new collections, no new indexes required.

## 15. Open items for the implementation plan

The `writing-plans` skill must capture:

1. **Exact insertion point** for the assignment picker in `AddJob.tsx` — between the Customer block and Job Details.
2. **Tab nav gating** — `Header.tsx` and `MoreSheet.tsx` both render nav. Both need conditional rendering on role.
3. **`scopeJobsByRole` helper** — extract from `useScopedJobs` so tests can exercise it independently.
4. **`assignableMembers` helper** — pure function over `MemberDoc[]` + current user uid; testable.
5. **`canEditJob` / `canDeleteJob` helpers** — already implied by the permissions model; centralize in `src/lib/jobPermissions.ts`.
6. **Granular commit decomposition** — schema first, helpers + tests, hook, AddJob picker, view-filter wiring, rules, nav gating, smoke.
