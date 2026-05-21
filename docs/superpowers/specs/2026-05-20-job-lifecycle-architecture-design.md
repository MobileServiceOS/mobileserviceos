# Job Lifecycle Architecture

**Status:** Draft for review
**Date:** 2026-05-20
**Author:** Claude (under direction from MobileServiceOS owner)
**Depends on:** `phase-2.1-stable` tag (`47d58a6`)
**Blocks:** Phase 2.2 (Mechanic full slice), Phase 2.x (Dispatch board, Notifications, Technician scheduling). Any Phase 2.x system that touches "what stage is this job in?" reads this contract.

## 1. Goal

Establish the foundational types, registry, and back-compat strategy for a single shared job-lifecycle system that every business vertical inherits automatically. Phase 2.x consumers (mechanic full slice, dispatch board, notifications, technician scheduling, audit reports) all read from one source of truth so the codebase never grows per-vertical status spaghetti.

Phrased as a single sentence: **after this spec lands, adding a new vertical (HVAC, locksmith, pet grooming) gets the full 13-stage lifecycle + audit trail + visibility flags + notification hooks for free; no UI or business-logic edits required.**

## 2. Scope

### In scope
- Type contracts for `JobLifecycleStage`, `StageSpec`, `SubStageSpec`, `LifecycleExtensions`, `ResolvedLifecycle`, `LifecycleTransition`, `StageNotificationSpec`.
- A new optional `lifecycle?: LifecycleExtensions` field on `BusinessTypeConfig`.
- New optional fields on `Job`: `lifecycleStage?`, `lifecycleSubstage?`, `transitions?`.
- A `resolveLifecycle(vertical)` pure function + `useActiveLifecycle()` React hook.
- A `deriveLifecycleStage(job)` back-compat helper mirroring the existing `resolvePaymentStatus(job)` pattern.
- A `legacyStatusFromStage(stage)` inverse helper for dual-write migration.
- Universal-stage declarations (the 13) with default labels, tones, visibility flags, recommendedNext lists, categories, and notification placeholders.
- Per-vertical extensions for the three current verticals (tire, mechanic, detailing) — most cases trivial / undefined.

### Explicitly out of scope (deferred to Phase 2.x)
- **Writing `Job.lifecycleStage` from any code path.** This spec defines the types only. The first writer ships in Phase 2.2 (mechanic dispatch or wherever the first "explicit stage transition" UI lands).
- **Modifying `App.tsx::saveJob`** — current saveJob flow keeps writing legacy `status` + `paymentStatus`; new readers derive lifecycle stage. No saveJob edits.
- **Migrating existing Firestore docs** — every existing job uses derivation; no backfill script.
- **Dispatch board UI.**
- **Notification dispatcher** — the `StageNotificationSpec` interface is declared; the runtime dispatcher is Phase 2.x.
- **Transitions subcollection** (`jobs/{id}/transitions`) — when the inline-array cap of 50 starts mattering, future Phase 2.x will add the subcollection. Foundation declares inline storage only.
- **State-machine enforcement** — advisory model only. No `transitionTo()` validation function.
- **firestore.rules updates** — rules don't know about `lifecycleStage` and don't need to in this phase.

## 3. Architectural decisions

### 3.1 Advisory transition model

User decision (selected over "enforced with override" + "strict"). The lifecycle config declares `recommendedNext` as data for UI affordances ("what's next?" buttons, dispatch-board flow). No runtime rejection of unusual transitions. Every transition is recorded in `Job.transitions`; transitions outside `recommendedNext` get `outOfFlow: true` so future analytics can surface them without inferring from before/after pairs.

Rationale: mobile-service operations regularly skip stages (a walk-in job goes straight to `in_progress`, bypassing `lead | quoted | scheduled | dispatched | enroute`). A strict state machine would either reject these or require constant `--force` overrides. The advisory model matches reality and keeps the foundation small.

### 3.2 Shared universal stages + per-vertical extension hooks

User decision (selected over "all-in-vertical-config" + "single global registry with filter"). Mirrors the existing `BusinessTypeConfig` pattern: universal contract in one place, per-vertical contributions are optional and sparse.

Rationale: the 13 universal stages are stable across mobile-service verticals; verticals differ in substage detail (mechanic "parts on order" vs detailing "awaiting paint"), label wording, and which stages apply (detailing has no parts so no `waiting_parts`). Duplicating the 13 across configs would drift; filtering a single global registry is harder to reason about per-vertical.

### 3.3 New optional fields on `Job`, NOT a rename

`Job.status` (the legacy 3-value enum) stays untouched. New optional fields land alongside. Existing readers (Dashboard, JobDetailModal, JobSuccessPanel, mechanic metrics, History) all continue reading legacy `status` exactly as before — no migration, no editing. New readers call `deriveLifecycleStage(job)`. When Phase 2.x writers start setting `lifecycleStage` directly, they dual-write to legacy fields via `legacyStatusFromStage(stage)` so old readers stay correct.

Rationale: hard requirement from the user — "do NOT rewrite current job storage." The dual-write pattern means new writers and old readers coexist indefinitely; eventual single-write cleanup is a separate phase.

### 3.4 Inline `transitions[]` storage, cap 50

Append-only array on the Job doc. Most jobs see <10 stage transitions over their lifetime; cap at 50 is generous. When the cap is hit (rare; mostly long-running disputes), the oldest entries roll off into a future `jobs/{id}/transitions` subcollection if Phase 2.x audit-history work decides to keep them. Foundation only declares the inline shape.

Rationale: simplest storage decision that supports timeline rendering today with a clear escape valve. Subcollections require extra reads on every job-detail render; the inline cap is one-read.

### 3.5 No state-machine code in foundation

Per the advisory decision, there is no `transitionTo()` function with validation. Writers do:

```ts
const next: Partial<Job> = {
  lifecycleStage: 'enroute',
  lifecycleSubstage: undefined,
  transitions: [...(job.transitions || []), {
    toStage: 'enroute',
    fromStage: job.lifecycleStage,
    at: new Date().toISOString(),
    byUid: currentUserUid,
    outOfFlow: !isRecommendedNext(job.lifecycleStage, 'enroute'),
  }],
  ...legacyStatusFromStage('enroute'),  // dual-write
};
```

The `isRecommendedNext()` helper is a one-line lookup, not a state machine. Foundation provides it; no validation, no rejection.

## 4. File layout

```
src/config/jobs/                              NEW
├── lifecycle.ts                              Universal stages, resolver, hook, helpers
└── universal-stages.ts                       The 13-stage StageSpec[] data
                                              (split out for readability;
                                               could be folded into lifecycle.ts
                                               if preferred — call at impl time)

src/config/businessTypes/types.ts             EDIT (additive)
  - Add `lifecycle?: LifecycleExtensions` to BusinessTypeConfig

src/config/businessTypes/tire.ts              EDIT (optional)
  - Add `lifecycle: undefined` or omit (no extensions needed)

src/config/businessTypes/mechanic.ts          EDIT
  - Add `lifecycle: { substages: [{ id: 'parts_on_order', ... }] }`

src/config/businessTypes/detailing.ts         EDIT
  - Add `lifecycle: { applicableStages: [...] (omits waiting_parts) }`

src/types/index.ts                            EDIT (additive)
  - Job adds optional lifecycleStage?, lifecycleSubstage?, transitions?

src/lib/jobLifecycle.ts                       NEW
  - deriveLifecycleStage(job) -> JobLifecycleStage
  - legacyStatusFromStage(stage) -> { status, paymentStatus?, invoiceGenerated? }
  - isRecommendedNext(from, to) -> boolean
  - appendTransition(job, entry) -> Job (immutable update helper)
                                    (kept thin; not exported as a "write" function
                                     until a real writer exists)
```

Anything not in this layout is **out of scope** for this foundation.

## 5. Type contracts (full)

### 5.1 Stage enumeration

```ts
export type JobLifecycleStage =
  | 'lead'
  | 'quoted'
  | 'scheduled'
  | 'dispatched'
  | 'enroute'
  | 'onsite'
  | 'in_progress'
  | 'waiting_parts'
  | 'awaiting_approval'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'canceled';
```

### 5.2 Stage spec

```ts
export interface StageSpec {
  id: JobLifecycleStage;
  label: string;
  shortLabel?: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  technicianVisible: boolean;
  customerVisible: boolean;
  recommendedNext: ReadonlyArray<JobLifecycleStage>;
  category: 'pre_service' | 'in_field' | 'post_service' | 'terminal';
  notifications?: ReadonlyArray<StageNotificationSpec>;
}
```

### 5.3 Substage spec

```ts
export interface SubStageSpec {
  id: string;
  parentStage: JobLifecycleStage;
  label: string;
  technicianVisible: boolean;
  customerVisible: boolean;
}
```

### 5.4 Vertical extensions

```ts
export interface LifecycleExtensions {
  applicableStages?: ReadonlyArray<JobLifecycleStage>;
  stageOverrides?: Partial<Record<JobLifecycleStage, Partial<StageSpec>>>;
  substages?: ReadonlyArray<SubStageSpec>;
}
```

### 5.5 Resolved (post-merge) shape

```ts
export interface ResolvedLifecycle {
  stages: ReadonlyArray<StageSpec>;
  substagesByParent: ReadonlyMap<JobLifecycleStage, ReadonlyArray<SubStageSpec>>;
  stageById: ReadonlyMap<JobLifecycleStage, StageSpec>;
}
```

### 5.6 Transition record

```ts
export interface LifecycleTransition {
  toStage: JobLifecycleStage;
  toSubstage?: string;
  fromStage?: JobLifecycleStage;
  at: string;          // ISO timestamp
  byUid: string;       // auth uid of actor
  note?: string;
  outOfFlow?: boolean; // true if toStage was NOT in fromStage's recommendedNext
}
```

### 5.7 Notification spec

```ts
export interface StageNotificationSpec {
  audience: 'customer' | 'technician' | 'owner';
  channel: 'sms' | 'email' | 'push' | 'in_app';
  templateId: string;
  fireMode: 'every_entry' | 'first_entry';
}
```

### 5.8 Job extensions

```ts
// in src/types/index.ts, additive to existing Job interface
export interface Job {
  // … existing fields untouched …
  lifecycleStage?: JobLifecycleStage;
  lifecycleSubstage?: string;
  transitions?: ReadonlyArray<LifecycleTransition>;
}
```

### 5.9 BusinessTypeConfig extension

```ts
// in src/config/businessTypes/types.ts, additive
export interface BusinessTypeConfig {
  // … existing fields untouched …
  lifecycle?: LifecycleExtensions;
}
```

## 6. The 13 universal stages — declared content

Concrete content for the universal stage data. Vertical overrides can change any field via `stageOverrides`.

| id | label | shortLabel | tone | techVisible | custVisible | category | recommendedNext |
|---|---|---|---|---|---|---|---|
| `lead` | Lead | — | neutral | false | false | pre_service | `quoted`, `scheduled`, `canceled` |
| `quoted` | Quoted | — | info | false | true | pre_service | `scheduled`, `canceled` |
| `scheduled` | Scheduled | — | info | true | true | pre_service | `dispatched`, `canceled` |
| `dispatched` | Dispatched | — | info | true | false | in_field | `enroute`, `canceled` |
| `enroute` | En route | En route | info | true | true | in_field | `onsite`, `canceled` |
| `onsite` | On-site | On-site | info | true | true | in_field | `in_progress`, `canceled` |
| `in_progress` | In progress | Working | warning | true | true | in_field | `waiting_parts`, `awaiting_approval`, `completed`, `canceled` |
| `waiting_parts` | Waiting on parts | Parts | warning | true | true | in_field | `in_progress`, `canceled` |
| `awaiting_approval` | Awaiting approval | Approval | warning | true | true | in_field | `in_progress`, `canceled` |
| `completed` | Completed | Done | success | true | true | post_service | `invoiced`, `paid` |
| `invoiced` | Invoiced | — | success | false | true | post_service | `paid` |
| `paid` | Paid | — | success | false | true | terminal | (empty) |
| `canceled` | Canceled | — | danger | true | true | terminal | (empty) |

Notification placeholders proposed for tire / shared:
- `enroute` → customer SMS, template `tech_on_the_way`, every_entry.
- `paid` → customer SMS, template `thank_you_review_request`, first_entry.

These declarations sit on the universal config; verticals can override per-stage via `stageOverrides`. Phase 2.x notification dispatcher reads them; foundation just declares the shape.

## 7. Per-vertical extension content (initial)

### 7.1 Tire (`TIRE_CONFIG.lifecycle`)

Undefined / omitted. Universal-only is the right default — every universal stage applies (a tire shop can have lead → quoted → scheduled flows even on roadside calls, and the `outOfFlow` flag captures actual walk-in patterns). No substages today.

### 7.2 Mechanic (`MECHANIC_CONFIG.lifecycle`)

```ts
{
  substages: [
    { id: 'parts_on_order',  parentStage: 'waiting_parts', label: 'Parts on order',  technicianVisible: true, customerVisible: true },
    { id: 'parts_back_order', parentStage: 'waiting_parts', label: 'Parts back-order', technicianVisible: true, customerVisible: true },
    { id: 'diagnosis_pending', parentStage: 'in_progress', label: 'Diagnosing',       technicianVisible: true, customerVisible: false },
  ],
}
```

### 7.3 Detailing (`DETAILING_CONFIG.lifecycle`)

```ts
{
  applicableStages: [
    'lead', 'quoted', 'scheduled', 'dispatched', 'enroute', 'onsite',
    'in_progress', 'awaiting_approval', 'completed', 'invoiced', 'paid', 'canceled',
    // waiting_parts omitted — detailing has no parts.
  ],
  stageOverrides: {
    awaiting_approval: { label: 'Awaiting customer walk-around', shortLabel: 'Walk-around' },
  },
}
```

## 8. Back-compat strategy

### 8.1 Derivation function (read-side compatibility)

```ts
export function deriveLifecycleStage(job: Job): JobLifecycleStage {
  if (job.lifecycleStage) return job.lifecycleStage;          // explicit win
  if (job.status === 'Cancelled') return 'canceled';
  if (job.status === 'Pending')   return 'in_progress';
  // job.status === 'Completed'
  if (job.paymentStatus === 'Paid')      return 'paid';
  if (job.invoiceGenerated)              return 'invoiced';
  return 'completed';
}
```

Every existing job — Wheel Rush's entire history, every other tire account, mechanic accounts that didn't yet trigger any explicit stage write — resolves to a sensible lifecycle stage at read time.

### 8.2 Inverse function (write-side dual-stamp)

```ts
export function legacyStatusFromStage(stage: JobLifecycleStage): {
  status: JobStatus;
  paymentStatus?: PaymentStatus;
  invoiceGenerated?: boolean;
} {
  switch (stage) {
    case 'canceled':
      return { status: 'Cancelled' };
    case 'paid':
      return { status: 'Completed', paymentStatus: 'Paid', invoiceGenerated: true };
    case 'invoiced':
      return { status: 'Completed', paymentStatus: 'Pending Payment', invoiceGenerated: true };
    case 'completed':
      return { status: 'Completed' };
    case 'lead':
    case 'quoted':
    case 'scheduled':
    case 'dispatched':
    case 'enroute':
    case 'onsite':
    case 'in_progress':
    case 'waiting_parts':
    case 'awaiting_approval':
      return { status: 'Pending' };
  }
}
```

Phase 2.x writers stamp **both** `lifecycleStage` and the legacy fields. Old readers (Dashboard `j.status === 'Completed'` checks, JobDetailModal pill, JobSuccessPanel branches, `resolvePaymentStatus()`) keep working unchanged.

### 8.3 Phased reader migration

| Phase | Behavior |
|---|---|
| **Foundation (this spec)** | Types defined. `deriveLifecycleStage()` available. No call site changes. |
| **Phase 2.x first writer** | The first feature that explicitly transitions stages (likely mechanic dispatch or Phase 2.2's mechanic-job-detail richer state) writes `lifecycleStage` + appends to `transitions[]` + dual-writes legacy fields. |
| **Phase 2.x readers opt in** | Components that need rich stage info (dispatch board, technician card, timeline view) call `deriveLifecycleStage()`. They don't read legacy `status` directly. |
| **Eventual cleanup phase (no scheduled phase)** | When every UI reader has migrated and analytics has aged out of the legacy fields, drop them from the Job type. Not on any current roadmap. |

## 9. Visibility flags architecture

Two boolean flags per stage:
- `technicianVisible` — whether the stage label/pill appears on a technician's job card and on their dashboard. Owner / admin always see every stage.
- `customerVisible` — whether the stage label appears in customer-facing surfaces (invoice line items, SMS templates that reference the stage, customer-facing status pages in a future iteration).

These are READ-ONLY flags consumed by UI gates. Examples:

```tsx
// Technician's job card pill (someday)
{stageSpec.technicianVisible && (
  <span className={`pill ${stageSpec.tone}`}>{stageSpec.shortLabel ?? stageSpec.label}</span>
)}

// Customer invoice template
{stageSpec.customerVisible && job.transitions?.some(t => t.toStage === 'paid') && (
  <p>Paid {fmtDate(paidTimestamp)}</p>
)}

// SMS notification dispatcher (Phase 2.x)
const recipients = stageSpec.notifications?.filter(n => {
  if (n.audience === 'technician') return stageSpec.technicianVisible;
  if (n.audience === 'customer')   return stageSpec.customerVisible;
  return true;  // owner always
});
```

Override pattern: a vertical that wants to hide the `dispatched` stage from technicians (e.g. detailing where the operator is the technician) sets:
```ts
stageOverrides: { dispatched: { technicianVisible: false } }
```

## 10. Notification hooks (declared now, dispatched later)

Foundation declares `StageNotificationSpec[]` per stage. Phase 2.x notification dispatcher reads these declaratively. The dispatcher itself is out of scope for this spec.

Concrete contract for Phase 2.x dispatcher:
1. Receive a "job transition committed" event (some pub/sub or just a function call from the writer).
2. Resolve the active vertical's lifecycle.
3. Look up `stageSpec.notifications` for `transition.toStage`.
4. For each notification spec:
   - Check `audience` + `channel` + `templateId`.
   - If `fireMode === 'first_entry'`, check `job.transitions` for prior entries with same toStage; skip if found.
   - Dispatch via the channel's adapter (SMS via Twilio/etc., email via SendGrid/etc., push via FCM, in_app via Firestore notif doc).

Per-vertical override example (mechanic adds an in-app technician notification on `awaiting_approval`):
```ts
stageOverrides: {
  awaiting_approval: {
    notifications: [
      { audience: 'technician', channel: 'in_app', templateId: 'mechanic_approval_pending', fireMode: 'every_entry' },
    ],
  },
}
```

## 11. Resolver semantics

```ts
export function resolveLifecycle(vertical: BusinessTypeConfig): ResolvedLifecycle;
```

Pure function. Memoized via `useActiveLifecycle()` per business-type-key (resolves once per business switch).

Merge rules:
1. Start with universal `STAGES` (the 13 with full default settings).
2. If `vertical.lifecycle?.applicableStages` is defined, filter to only those.
3. For each surviving stage, if `vertical.lifecycle?.stageOverrides?.[stageId]` exists, deep-merge the override on top of the universal spec.
4. `substages` from `vertical.lifecycle?.substages` are bucketed by `parentStage`. If a substage's parent isn't in the resolved stages (vertical config error), log a console warning and skip the substage. No crash.
5. Build `stageById` Map for O(1) lookup; build `substagesByParent` Map keyed by parent.

```ts
export function useActiveLifecycle(): ResolvedLifecycle {
  const vertical = useActiveVertical();
  return useMemo(() => resolveLifecycle(vertical), [vertical]);
}
```

## 12. Schema impact

**No Firestore schema migration.** Three optional fields added to existing Job docs:
- `lifecycleStage?` — string union.
- `lifecycleSubstage?` — string (vertical-specific id).
- `transitions?` — array of LifecycleTransition objects.

Existing tire job docs omit all three. Reads use `deriveLifecycleStage()` to compute the legacy-equivalent.

**No `firestore.rules` changes.** Rules continue to read `status` / `paymentStatus` for any rule-level checks (none today reference job fields by name beyond ownership). New optional fields land via the same write paths.

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Advisory model allows code paths to write any stage to any other; bugs could move paid jobs back to scheduled. | `transitions[]` records every move with `outOfFlow` flag. Future audit dashboards surface unusual patterns. Per the user, strict enforcement was rejected as too rigid for mobile-service reality. |
| Inline `transitions[]` array on Job grows unbounded over the lifetime of long-running jobs. | Documented cap at 50 entries; rotation policy when reached is a Phase 2.x decision (subcollection vs truncation). |
| `deriveLifecycleStage()` collapses post-service stages (`completed | invoiced | paid`) deterministically from legacy fields, but the inverse is lossy — `legacyStatusFromStage('completed')` doesn't know about `invoiceGenerated`, just sets `status: 'Completed'`. A dual-write writer that re-stamps a `completed` job after invoicing must remember to keep `invoiceGenerated: true`. | Writers use `legacyStatusFromStage(stage)` as a STARTING patch and explicitly preserve any prior flags they don't want cleared. Documented in the helper's JSDoc. |
| A vertical's `applicableStages` could omit a stage the existing data already uses (e.g. detailing with `waiting_parts` jobs from a legacy import). | Resolver does not strip stages from data — it only filters the picker UI. A job with an absent stage still renders via the universal stage data (resolver returns universal `stageById` lookup as fallback). |
| Two writers race on `transitions[]` append. | Firestore `arrayUnion` is conflict-safe but only de-dupes by deep-equality; two simultaneous "stage changed to enroute" appends would create two entries. Foundation doesn't solve this; first writer (Phase 2.x) decides between `arrayUnion` semantics and a transaction. Documented as an implementation concern for the writer. |
| Notification specs declared on the universal config but no dispatcher exists yet. | The `notifications?` field is OPTIONAL at every level; absence = no notifications. Verticals can populate ahead of the dispatcher, and the foundation lints clean even if every stage's `notifications` array is undefined. |
| Adding a 13th universal stage later breaks the discriminated union. | All consumers narrow via `StageSpec` lookup (`stageById.get(stageId)`) rather than switching on the union directly where possible. The few `switch` statements (only `legacyStatusFromStage`) need explicit case adds. |
| TypeScript can't enforce that a substage's `parentStage` is in the vertical's `applicableStages`. | Resolver runtime check logs a warning + skips the orphan substage. Documented invariant in the SubStageSpec JSDoc. |

## 14. Validation plan

For the foundation commit (when implementation lands):
1. `npm run build` clean.
2. Add a small smoke test or runtime self-check: `resolveLifecycle(TIRE_CONFIG).stages.length === 13` and the same for MECHANIC / DETAILING (mechanic 13, detailing 12 — `waiting_parts` omitted).
3. `deriveLifecycleStage()` round-trips: for every existing legacy `(status, paymentStatus, invoiceGenerated)` triple, the derived stage maps back via `legacyStatusFromStage()` to a compatible legacy triple. Inline assertion block in the helper file.
4. Tire smoke test on a real Wheel Rush job: existing `j.status === 'Completed'` still fires; `deriveLifecycleStage(j)` returns one of `completed | invoiced | paid`.

For Phase 2.x writers when they land:
5. First writer's commit demonstrates: explicit stage write + transition append + legacy dual-write + tire reader (Dashboard) still shows the correct legacy pill.

## 15. Out-of-scope follow-ups

These are the natural sub-projects that USE this foundation. Each gets its own spec → plan → implementation cycle.

- **Phase 2.2 — Mechanic full slice.** May or may not be the first stage writer; if it adds a "dispatch this job" or "mark on-site" button to mechanic-job-detail, it stamps `lifecycleStage` via the dual-write helper.
- **Phase 2.x — Dispatch board.** First major reader. Renders all jobs grouped by `lifecycleStage`. Drag-and-drop calls a writer that stamps + dual-writes.
- **Phase 2.x — Notification dispatcher.** Subscribes to "transition committed" events (or polls/queries) and dispatches per the declared `StageNotificationSpec[]`.
- **Phase 2.x — Technician scheduling.** Uses `category: 'pre_service' | 'in_field'` to filter jobs assigned to a tech for their day's route.
- **Phase 2.x — Customer status page.** Reads stages with `customerVisible: true` to render a job-progress page.
- **Phase 2.x — Audit reports.** Reads `transitions[]` to surface "average time in each stage", "out-of-flow transition frequency", etc.

## 16. Open questions for review

None blocking — every architectural call has been made and noted above. Flag any of these you want to revisit before implementation:

1. **Should `transitions[]` cap default to 50 or higher?** Spec proposes 50.
2. **Should `substages` be required to be vertical-namespaced** (e.g. `mechanic_parts_on_order`) or allowed to be flat (`parts_on_order`)? Spec proposes flat strings; namespace collisions are a non-issue today.
3. **Should `legacyStatusFromStage('invoiced')` write `paymentStatus: 'Pending Payment'`** unconditionally, or leave `paymentStatus` undefined and let the writer set it? Spec proposes 'Pending Payment' as a sensible default; writers can override.
4. **Should `notifications` declarations on UNIVERSAL stages (vs `stageOverrides`) be allowed at all?** Spec proposes yes — there's a "tier-1 baseline" of customer notifications (tech-on-the-way, payment-received) that every vertical wants. Vertical overrides can add more or suppress universal ones.

---

**Reviewer:** please respond with approval or change requests. Once approved, the next step is `superpowers:writing-plans` to produce the implementation plan from this spec.
