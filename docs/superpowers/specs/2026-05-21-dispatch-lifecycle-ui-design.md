# Phase 2.2 / Sub-Project C — Dispatch + Lifecycle UI Design Spec

**Status:** Approved for implementation planning (2026-05-21)

**Owning phase:** Phase 2.2 mechanic full-slice — Sub-Project C (dispatch + lifecycle UI, first writers of the lifecycle foundation).

**Predecessor sub-projects:**
- A. Mechanic Operations — tagged `phase-2.2-mechanic-ops-stable` (`fa0f25b`)
- B. Multi-User Foundation — tagged `phase-2.2-multi-user-stable` (rules deploy pending)
- Job-lifecycle foundation (Phase 2.1 epilogue) — provides 13-stage type contracts, universal stage data, pure helpers (`deriveLifecycleStage`, `legacyStatusFromStage`, `appendTransition`, `isRecommendedNext`, `getTransitionRetentionPolicy`), `resolveLifecycle()`, `useActiveLifecycle()`, per-vertical extensions for mechanic / detailing

**Successor sub-projects:**
- D. CRM Automation Hooks — consumes the `transitions[]` writes from this sub-project to drive `StageNotificationSpec` dispatch

---

## 1. Goal

Add the **first real writers** of the lifecycle foundation: a stage picker on JobDetailModal, a transition-recording helper, a timeline view, and a History-tab grouping toggle. Operators who don't touch the picker continue to use today's legacy status flow with zero behavior change.

**Out of scope this sub-project:** notification dispatch (Sub-Project D), customer-facing status page, real-time multi-device updates, AI / smart next-stage suggestions, dispatch-board kanban surface, calendar/scheduler integration, technician push notifications.

## 2. Hard constraints

- Tire / mechanic / detailing operators who don't touch the picker see zero behavior change
- Legacy `status` / `paymentStatus` / `invoiceGenerated` chips in AddJob stay as-is (simple flow)
- Mobile-first: no kanban-style horizontal scrolling
- Additive only — no schema changes (foundation already declared every field)
- No firestore.rules changes — writes are `jobs/{id}` updates which Sub-Project B's rules already gate
- Each commit independently revertible
- No new dependencies
- No new top-level nav tab
- Lifecycle remains advisory — any stage transitions to any other; `outOfFlow` is metadata only

## 3. Architecture

Three additive surfaces, all consuming the lifecycle foundation:

1. **Stage picker** — renders in `JobDetailModal`. Reads `useActiveLifecycle()` for the resolved stage set + per-vertical applicableStages / overrides. Each chip-tap calls `transitionJobStage()` then writes via existing job-write path.
2. **`transitionJobStage()` helper** — pure function added to `src/lib/jobLifecycle.ts`. Atomically constructs the next Job state: stamps `lifecycleStage` + `lifecycleSubstage`, appends to `transitions[]` (trimmed via `getTransitionRetentionPolicy`), dual-writes the legacy `status` / `paymentStatus` / `invoiceGenerated` mirror via `legacyStatusFromStage()`.
3. **Timeline view** — collapsible "History" section in `JobDetailModal`, rendering `job.transitions[]` newest-first with resolved actor names (via `useMembersDirectory`).

Plus an enhancement to the existing **History page**: a chip-toggle to group jobs by stage instead of date. Default stays date-grouped (no behavior change).

No new components beyond:
- `src/components/JobDetailModal/StagePicker.tsx`
- `src/components/JobDetailModal/StageHistory.tsx`

`JobDetailModal.tsx` is modified to mount both above its existing action buttons.

## 4. Schema

**No schema changes.** The lifecycle foundation already declared every field consumed by this sub-project:

- `Job.lifecycleStage?: JobLifecycleStage`
- `Job.lifecycleSubstage?: string`
- `Job.transitions?: ReadonlyArray<LifecycleTransition>`
- `LifecycleTransition = { toStage, toSubstage?, fromStage?, at, byUid, note?, outOfFlow? }`

The Phase 2.x deserializer fix in Sub-Project B ensures all three fields survive read cycles.

## 5. Stage picker UX

Rendered in JobDetailModal between the existing status pill and the action buttons. Layout:

```
┌─────────────────────────────────────────────────────────┐
│ Current stage: In progress                              │
│                                                          │
│ ─ Pre-service ──────────────────────────                │
│  [Lead]  [Quoted]  [Scheduled]                          │
│ ─ In-field ────────────────────────────                 │
│  [Dispatched] [En route] [On-site]                      │
│  [Working ✓] →[Parts]  [Approval]                       │
│ ─ Post-service ────────────────────────                 │
│  [Completed] [Invoiced] [Paid]                          │
│ ─ Terminal ────────────────────────────                 │
│  [Canceled]                                              │
└─────────────────────────────────────────────────────────┘
```

**Chip states:**
- Active (current stage): `chip active` class (filled)
- Recommended next (per `isRecommendedNext`): `→` prefix on the chip label, no other visual change
- Disabled-for-role (per `canTransitionToStage`): grayed visual + non-interactive
- Default: standard `chip` styling

**Filtering:**
- Stages filtered to the vertical's `applicableStages` (detailing won't show `waiting_parts`)
- Stage labels apply `vertical.stageOverrides` ("Awaiting customer walk-around" for detailing)
- Chip order follows the canonical `UNIVERSAL_STAGES` declaration order, grouped by `category`

**Out-of-flow taps allowed.** Any role-permitted stage chip is tappable regardless of `recommendedNext`. The transition writer stamps `outOfFlow: true` on the resulting entry; the History section surfaces a `⚠ skip` badge. **No confirmation modal** (decision: silent, matching the field-speed priority).

## 6. Substage entry

For stages with vertical-defined substages (e.g. mechanic's `waiting_parts` → `mechanic.parts_on_order` / `mechanic.parts_back_order` / etc.), tapping the parent stage opens an inline secondary chip row:

```
[Parts] just tapped →
  Substage: [Parts on order]  [Parts back-order]  [Skip]
```

- Tap a substage → transition completes with both `lifecycleStage` + `lifecycleSubstage` populated
- Tap "Skip" → transition completes with `lifecycleSubstage = undefined`
- Substages filter by parent: only those whose `parentStage` matches the just-tapped stage appear

Substage row disappears after the choice is made (or after timeout if the user navigates away — handled by component-level state, not persisted).

## 7. `transitionJobStage()` helper

Added to `src/lib/jobLifecycle.ts`:

```ts
export interface TransitionContext {
  job: Job;
  toStage: JobLifecycleStage;
  toSubstage?: string;
  byUid: string;
  note?: string;
  resolved: ResolvedLifecycle;
  settings: Settings;
  invoicingEnabled?: boolean;
  paymentTrackingEnabled?: boolean;
}

export function transitionJobStage(ctx: TransitionContext): Job {
  const fromStage = ctx.job.lifecycleStage ?? deriveLifecycleStage(ctx.job);
  const outOfFlow = !isRecommendedNext(fromStage, ctx.toStage, ctx.resolved);

  const entry: LifecycleTransition = {
    toStage: ctx.toStage,
    toSubstage: ctx.toSubstage,
    fromStage,
    at: new Date().toISOString(),
    byUid: ctx.byUid,
    note: ctx.note,
    outOfFlow: outOfFlow || undefined,
  };

  const retention = getTransitionRetentionPolicy(ctx.settings);
  const withTransition = appendTransition(ctx.job, entry, retention);

  const legacy = legacyStatusFromStage(ctx.toStage, {
    invoicingEnabled: ctx.invoicingEnabled,
    paymentTrackingEnabled: ctx.paymentTrackingEnabled,
    job: {
      invoiceGenerated: ctx.job.invoiceGenerated,
      paymentStatus: ctx.job.paymentStatus,
    },
  });

  return {
    ...withTransition,
    lifecycleStage: ctx.toStage,
    lifecycleSubstage: ctx.toSubstage,
    status: legacy.status,
    ...(legacy.paymentStatus !== undefined ? { paymentStatus: legacy.paymentStatus } : {}),
    ...(legacy.invoiceGenerated !== undefined ? { invoiceGenerated: legacy.invoiceGenerated } : {}),
    lastEditedAt: new Date().toISOString(),
  };
}
```

Caller (StagePicker tap handler) does the write via the existing `fbSetFast` job-write path:

```ts
const next = transitionJobStage({ ... });
await fbSetFast(jobsCol, next.id, next);
```

Single Firestore write — atomic for free.

## 8. Technician permissions for stage transitions

New helper in `src/lib/jobPermissions.ts`:

```ts
export function canTransitionToStage(
  role: Role | null | undefined,
  stage: JobLifecycleStage,
): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (role !== 'technician') return false;
  // Tech can transition in-field + completed + paid (collects payment on-site)
  return [
    'dispatched', 'enroute', 'onsite',
    'in_progress', 'waiting_parts', 'awaiting_approval',
    'completed', 'paid',
  ].includes(stage);
}
```

Matrix:

| Stage category | Owner / Admin | Technician |
|---|:-:|:-:|
| Pre-service (lead / quoted / scheduled) | ✓ | ✗ |
| In-field (dispatched / enroute / onsite / in_progress / waiting_parts / awaiting_approval) | ✓ | ✓ |
| Post-service: completed | ✓ | ✓ |
| Post-service: invoiced | ✓ | ✗ |
| Terminal: paid | ✓ | ✓ |
| Terminal: canceled | ✓ | ✗ |

The picker grays chips the role can't transition to. Non-interactive (clicking does nothing). No error toast (silent UX).

## 9. Timeline view

Rendered below the stage picker in JobDetailModal:

```
┌─────────────────────────────────────────────────────────┐
│ ▾ History (4 transitions)                                │
│ ─────────────────────────────────────────                │
│ ● Paid               by Owner   May 21, 2:47 PM         │
│ ● Completed          by Alice   May 21, 1:30 PM         │
│ ● Working            by Alice   May 21, 11:15 AM ⚠ skip │
│   from Scheduled                                         │
│ ● Scheduled          by Owner   May 20, 4:00 PM         │
└─────────────────────────────────────────────────────────┘
```

**Per-row content:**
- Stage label (resolved via `resolved.stageById.get(toStage).label`)
- Actor name (resolved via `useMembersDirectory` from `byUid`; falls back to "Unknown" if uid not found)
- Human-readable date (relative + absolute hybrid: "May 21, 2:47 PM")
- "from X" annotation when `fromStage` differs (helps audit the lineage)
- `⚠ skip` badge when `outOfFlow === true`

**Empty state:** "No stage history yet — transitions are recorded as you advance the job."

**Sort order:** newest first (entries are appended chronologically by `transitionJobStage`; reverse-render at display time).

**No pagination** — `transitions[]` is capped at 50 entries by the retention policy. Render the full list.

## 10. History tab "Group by stage" toggle

In `History.tsx`, add a chip-toggle near the top:

```
[Date ▾]  [Stage ▾]
```

Default: Date (current behavior, no change).

In Stage mode:
- Jobs grouped by `deriveLifecycleStage(job)` (so legacy jobs render under their derived stage)
- Section ordering: pre-service / in-field / post-service / terminal (canonical category order)
- Empty stages hidden
- Sections collapsible (same idiom as MechanicInventoryView's category groups)
- Same `useScopedJobs` filter applies — techs see only their scoped jobs across stages

Pure helper extracted to `src/lib/jobPermissions.ts` (or new `src/lib/jobGrouping.ts` if it grows):

```ts
export function groupJobsByStage(
  jobs: ReadonlyArray<Job>,
  resolved: ResolvedLifecycle,
): Array<{ stage: StageSpec; jobs: Job[] }> {
  const buckets = new Map<JobLifecycleStage, Job[]>();
  for (const j of jobs) {
    const stage = deriveLifecycleStage(j);
    if (!resolved.stageById.has(stage)) continue; // filtered by vertical
    (buckets.get(stage) ?? buckets.set(stage, []).get(stage)!).push(j);
  }
  return resolved.stages
    .filter((s) => buckets.has(s.id))
    .map((s) => ({ stage: s, jobs: buckets.get(s.id)! }));
}
```

## 11. Coexistence with legacy status

Legacy `JOB_STATUSES` chip in AddJob (`Completed` / `Pending` / `Cancelled`) and `PAYMENT_STATUSES` chip stay as-is. They're the **simple-mode flow** for operators who don't need granular stages.

**Legacy write path (current behavior — unchanged):**
- Tap a legacy status chip → `setJob({...job, status})` → save writes `status`
- `lifecycleStage` is **not stamped** on legacy writes
- `transitions[]` is **not appended** on legacy writes
- Next read of the job: `deriveLifecycleStage(job)` computes the stage from `status` + `paymentStatus` + `invoiceGenerated`

**New stage picker write path (Sub-Project C):**
- Tap a stage chip → `transitionJobStage()` runs
- Stamps `lifecycleStage`, appends `transitions[]`, dual-writes legacy `status` / `paymentStatus` / `invoiceGenerated`
- Both surfaces (legacy pill + new picker) reflect the result consistently after save

Operators choose: stay simple (legacy chips) or opt into the richer flow (stage picker). No forced migration. **Eventually** legacy chips will be deprecated (Phase 3+), but not this sub-project.

## 12. Backward compatibility

- Tire workflows byte-identical to today. Owner who never opens JobDetailModal's stage picker sees no change.
- Existing jobs without `lifecycleStage` render their derived stage via the foundation's `deriveLifecycleStage` fallback. No backfill script.
- Existing jobs without `transitions[]` show the empty-state in the History section. No backfill script.
- Each implementation commit independently revertible; rollback at any task leaves the prior surface functional.

## 13. Performance

- Stage picker renders ≤ 13 chips (fewer per vertical). Trivial DOM.
- Timeline reads `job.transitions[]` capped at 50 entries. Trivial.
- History stage grouping: `useScopedJobs` filter (O(n)) + O(n) bucket build. Sub-millisecond at any realistic scale.
- No new Firestore listeners. No new collections. No new composite indexes.

## 14. Testing

Four new pure-helper test files in `tests/`:

| File | Coverage |
|---|---|
| `tests/transitionJobStage.test.ts` | `transitionJobStage()` correctness — stamps stage, appends entry, dual-writes legacy fields per the LegacyMirrorContext rules, sets `outOfFlow` when `isRecommendedNext` says false, preserves prior `invoiceGenerated` / `paymentStatus` on `completed`-stage writes |
| `tests/canTransitionToStage.test.ts` | Role-based gate — owner/admin all stages true; tech true for in-field + completed + paid only; tech false for pre-service + invoiced + canceled; null/undefined role always false |
| `tests/historyEntries.test.ts` | `historyEntries(job, resolved, resolveName)` pure helper returning sorted entries with computed actor labels — testable independently of React; verifies newest-first order, fallback to "Unknown" on missing uid, badge generation for `outOfFlow` |
| `tests/groupJobsByStage.test.ts` | `groupJobsByStage(jobs, resolved)` — returns canonical-order buckets, skips empty stages, applies `deriveLifecycleStage` to legacy jobs, filters stages not in the vertical's applicableStages |

All `npx tsx`-runnable. ~50 assertions total.

## 15. Pre-tag production smoke checklist

**Owner regression (must be identical to phase-2.2-multi-user-stable):**
- [ ] Dashboard, History, AddJob, Inventory, Settings render unchanged
- [ ] Existing JOB_STATUSES chips in AddJob still work — tap "Completed" → save → verify status persists
- [ ] Mechanic AddJob unchanged
- [ ] Mechanic invoice still renders itemized parts

**New stage surface (owner):**
- [ ] Open any job → JobDetailModal shows stage picker with current stage highlighted via `deriveLifecycleStage` (even for legacy jobs)
- [ ] Tap an adjacent stage → transition records; modal re-renders with new stage
- [ ] Tap a far-away stage → transition records with `outOfFlow: true`; History row shows `⚠ skip` badge
- [ ] Substage picker appears when tapping `waiting_parts` on a mechanic job; selection persists
- [ ] History section renders all transitions newest-first with correct actor labels
- [ ] History tab "Group by stage" toggle works; sections collapse / expand

**Technician account:**
- [ ] Stage picker grays out pre-service + invoiced + canceled chips
- [ ] Tap in-field stages, completed, paid → transition works
- [ ] Tap a grayed stage → silent no-op (no console error)

**Cross-cutting:**
- [ ] No console errors
- [ ] Bundle-size delta ≤ +6 kB gzipped on the index chunk

## 16. Rollback path

Each commit is revertible independently. Layered structure:

1. `transitionJobStage()` + `canTransitionToStage()` + tests — pure helpers, no consumer impact if reverted
2. `groupJobsByStage()` + test — pure helper
3. `StagePicker` + `StageHistory` components — no consumer until mounted in JobDetailModal
4. JobDetailModal mounts new components — feature visible; revert restores prior modal
5. History tab grouping toggle — additive UI; revert restores date-only view

`transitions[]` writes are append-only and capped at 50 entries; even if a buggy writer ships, the data is recoverable from the most-recent entries.

## 17. Performance posture

Same as Sub-Project B: in-memory operations on the loaded job list. No new listeners, no new collections, no perf-sensitive paths introduced.

## 18. Open items for the implementation plan

The `writing-plans` skill must capture:

1. **Exact JobDetailModal insertion point** for StagePicker + StageHistory — between the status pill and the action buttons.
2. **`useMembersDirectory` integration** — confirm the existing hook handles unknown-uid → "Unknown" fallback (or add it). Used by StageHistory for actor labels.
3. **History tab toggle persistence** — keep the date/stage choice in `useState` only (resets on remount). No localStorage.
4. **Substage row component placement** — inline below the StagePicker after a stage with substages is tapped. Component-level state, no global store.
5. **Granular commit decomposition** — pure helpers + tests first, then UI components, then JobDetailModal mount, then History toggle.
