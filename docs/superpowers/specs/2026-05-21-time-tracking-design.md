# Phase 2.4 — Time Tracking Design Spec

**Status:** Approved for implementation planning (2026-05-21)

**Owning phase:** Phase 2.4 — explicit clock-in / clock-out per job with `laborHours` auto-fill suggestion. Universal across all verticals.

**Predecessor work:**
- Phase 2.1 / 2.2 / 2.3 — runtime-config architecture, lifecycle foundation + UI, multi-user permissions, mechanic + detailing full slices, CRM notifications

**Successor work:** none specified — Time Tracking is a self-contained phase.

---

## 1. Goal

Give techs a one-tap way to clock in and out per job. Total time per job is preserved as a list of sessions. Operators get a "Currently working" sticky bar across the whole app and an inline timer block on `JobDetailModal`. On stop, auto-fill the `Job.laborHours` field as a suggested value the operator can accept or override.

**Out of scope this phase:** shift-level (whole-day) tracking; payroll exports; per-tech timesheet rollups; GPS-verified clock-ins; break / paid-time-off categorization; sync to external time systems (QuickBooks, Gusto, etc.); biometric clock-in.

## 2. Hard constraints

- Mobile-first; works in spotty signal (Firestore persistent cache handles offline writes)
- Tire / mechanic / detailing workflows byte-identical when no timer is running
- Additive schema (one new optional Job field)
- No firestore.rules changes — writes are `jobs/{id}` updates already gated by Sub-Project B
- No new collection; sessions live on the Job doc as a small array
- One active session per tech across the whole business (concurrency rule — see §5)
- Permission gating reuses Sub-Project B's `canEditJob`; no new permission flags
- Auto-fill `laborHours` never overwrites a non-empty value silently — operator confirms via toast action
- Every commit independently revertible

## 3. Architecture

Three pieces, all additive:

1. **`Job.timeSessions?: ReadonlyArray<TimeSession>`** on the Job doc — one entry per clock-in/out pair. Open (current) session has `endAt: undefined`. Closed sessions have both `startAt` + `endAt`.
2. **Pure helpers in `src/lib/jobTime.ts`** — `activeSession`, `totalElapsedMs`, `startSession`, `stopActiveSession`, `suggestedLaborHours`, `findActiveSessionAcrossJobs`. All return new Job objects (immutable).
3. **Two UI surfaces** —
   - `ActiveTimerBar` sticky banner mounted between `Header` and the main content of `App.tsx`. Renders only when the current user has an open session somewhere.
   - `JobTimer` block inside `JobDetailModal` showing the active timer or a "▶ START WORK" button + past sessions list.

A single React hook `useActiveTimer()` composes `useScopedJobs` + member uid + `findActiveSessionAcrossJobs` to derive the active session and expose start/stop callbacks.

## 4. Schema

Single new optional Job field + one new type:

```ts
export interface TimeSession {
  /** ISO timestamp when work began. */
  startAt: string;
  /** ISO timestamp when work ended. Open (currently-active) session
   *  has endAt undefined. */
  endAt?: string;
  /** Auth uid of whoever tapped Start (and Stop). Owner/admin clocking
   *  on behalf of a tech stamps their own uid, not the tech's — we
   *  don't forge clocks. */
  byUid: string;
  /** Optional free-text note ("paused for parts pickup", etc.). */
  note?: string;
}

export interface Job {
  // ...existing fields...
  /** Time-tracking sessions for this job. Multiple sessions allowed
   *  (tech can clock out for lunch then clock back in). Total job
   *  time = sum of (endAt − startAt) across closed sessions, plus
   *  (now − startAt) for the open session if any. The most-recent
   *  session with undefined endAt is the active one. */
  timeSessions?: ReadonlyArray<TimeSession>;
}
```

No other type changes. No firestore.rules changes.

## 5. Concurrency rule: one active session per tech

A tech can only be clocked-in to one job at a time **across the whole business**. Tapping START on Job B while Job A has an open session for the same uid:

1. Closes Job A's open session (stamps `endAt = now`)
2. Opens a new session on Job B
3. Surfaces a toast: *"Stopped Job A at 1h 23m. Started Job B."*

No modal confirm — the toast is informational + silent. Matches the "field-speed" priority from the project decision hierarchy.

The "across the whole business" qualifier means the auto-close logic scans every job visible to the current member (via `useScopedJobs`), not just the current view. This prevents the case where a tech forgets to stop on yesterday's job, opens a new one today, and ends up with two opens for their uid.

Owner / admin clocking on a stranger's job is allowed (correcting a forgotten clock-out). `byUid` stamps their own uid in that case — we don't pretend to be the tech.

## 6. Permission gating

| Capability | Tech | Admin | Owner |
|---|:-:|:-:|:-:|
| Clock-in/out on jobs they can edit (assigned or creator) | ✓ | ✓ | ✓ |
| Clock-in/out on any other job | ✗ | ✓ | ✓ |
| Edit past `timeSessions` entries | ✗ | ✓ | ✓ |
| Delete `timeSessions` entries | ✗ | ✓ | ✓ |

Reuses `canEditJob(job, role, uid)` from Sub-Project B. No new permission flags. No firestore.rules changes — the existing `jobs/{id}` update predicate already enforces "tech can update jobs they own."

## 7. `ActiveTimerBar` UI

Mounted between `Header` and the main page content in `App.tsx`. Renders **only when** `useActiveTimer().active` is non-null. When no session is active for the current user, the bar doesn't render — zero visual cost for owners who never use the feature.

Layout:

```
┌─────────────────────────────────────────────────────────┐
│ 🟢 Working: Brake Pads & Rotors — John Doe   1h 23m   │
│                                            [STOP →]    │
└─────────────────────────────────────────────────────────┘
```

- **Tap row** → opens the job's `JobDetailModal`
- **Tap STOP** → ends the session (stamps `endAt`) + offers the auto-fill toast (§9)
- Elapsed time updates via `setInterval(1000)` driven by the `useActiveTimer` hook
- Color: green dot + neutral background; visually unobtrusive but always visible

## 8. `JobTimer` block inside `JobDetailModal`

Mounted between `StageHistory` and the existing "Mark Paid" CTA. Renders for every job (universal across verticals).

When there's an active session for the current user on this specific job:

```
┌─────────────────────────────────────────────────────────┐
│ Time on this job                                          │
│                                                            │
│ ● Currently working — 1h 23m                              │
│                                            [STOP]         │
│                                                            │
│ ─ Past sessions ─────────────────────────                 │
│   1h 47m   Alice   May 21, 10:00 AM → 11:47 AM           │
│   42m      Alice   May 21, 1:30 PM → 2:12 PM             │
│                                                            │
│ Total billed: 4h 12m                                       │
└─────────────────────────────────────────────────────────┘
```

When no session is active for this job:

```
┌─────────────────────────────────────────────────────────┐
│ Time on this job                                          │
│                                                            │
│ Past sessions: 2h 29m total                                │
│                                       [▶ START WORK]      │
└─────────────────────────────────────────────────────────┘
```

When no sessions exist at all:

```
┌─────────────────────────────────────────────────────────┐
│ Time on this job                                          │
│                                                            │
│ No time logged yet.                                        │
│                                       [▶ START WORK]      │
└─────────────────────────────────────────────────────────┘
```

**Past sessions list:** newest first, one row per closed session. Each row shows duration + actor name (resolved via the existing `useMembersDirectory`) + date range. Open sessions render with the green dot above the list.

## 9. Auto-fill `laborHours` suggestion

When the operator taps STOP and the resulting total elapsed time would update `laborHours`, surface an action toast immediately after the write commits:

```
┌──────────────────────────────────────────┐
│ Stopped at 1h 23m.                         │
│                       [Fill labor hours →] │
└──────────────────────────────────────────┘
```

Tap the action → writes `suggestedLaborHours(totalElapsedMs)` to `Job.laborHours`. **Never overwrites silently** — the operator's tap is the consent.

**Granularity:** rounds **up** to 0.25-hour (15-minute) increments. Standard service-billing convention. 1 minute → 0.25h; 14 minutes → 0.25h; 16 minutes → 0.5h; exactly 1 hour → 1.0h.

**When the toast doesn't surface:**
- The job's current `laborHours` already exceeds the rounded total (the operator already entered a longer time manually — don't second-guess them).
- The closed total elapsed is 0 ms (e.g., a near-instant tap of Start then Stop — degenerate case).

## 10. Pure helpers (`src/lib/jobTime.ts`)

```ts
import type { Job, TimeSession } from '@/types';

/** Returns the open session (endAt undefined) if any. When multiple
 *  open sessions exist (defensive — shouldn't happen but the
 *  concurrency rule isn't enforced at the schema layer), returns the
 *  most recently started one. */
export function activeSession(
  job: Pick<Job, 'timeSessions'>,
): TimeSession | undefined;

/** Total elapsed milliseconds across all sessions on this job.
 *  Closed sessions count (endAt − startAt). Open session counts
 *  (now − startAt). Empty / undefined sessions array → 0. */
export function totalElapsedMs(
  job: Pick<Job, 'timeSessions'>,
  now?: Date,
): number;

/** Returns a new Job with a new open session appended. Does NOT
 *  close any existing open session — caller is responsible for the
 *  concurrency rule. */
export function startSession(job: Job, byUid: string, now?: Date): Job;

/** Returns a new Job with the most-recent open session's endAt
 *  stamped. If no open session exists, returns the job unchanged. */
export function stopActiveSession(job: Job, now?: Date): Job;

/** Rounds elapsed milliseconds UP to 0.25-hour increments. Returns
 *  a number suitable for the laborHours field. */
export function suggestedLaborHours(totalMs: number): number;

/** Scans the supplied job list for the first open session whose
 *  byUid matches the given uid. Used by useActiveTimer to derive
 *  the "currently working" state for the ActiveTimerBar. Returns
 *  null when no open session exists for this uid. */
export function findActiveSessionAcrossJobs(
  jobs: ReadonlyArray<Job>,
  uid: string,
): { job: Job; session: TimeSession } | null;

/** Human-readable duration string ("1h 23m", "42m", "3s"). Used by
 *  the timer surfaces. */
export function formatDuration(ms: number): string;
```

All pure. No I/O. Existing `useScopedJobs` provides the filtered job list to scan.

## 11. `useActiveTimer()` React hook

```ts
export interface UseActiveTimerResult {
  active: {
    job: Job;
    session: TimeSession;
    elapsedSeconds: number;
  } | null;
  startTimer: (job: Job) => Promise<void>;
  stopTimer: (job: Job) => Promise<void>;
}

export function useActiveTimer(): UseActiveTimerResult;
```

Behavior:

- Composes `useScopedJobs()` + `useMembership()` to derive the scope + current uid
- Calls `findActiveSessionAcrossJobs(scopedJobs, uid)` to find the active session
- When `active` is non-null, runs a `setInterval(1000)` to update `elapsedSeconds` for re-render
- `startTimer(job)`:
  1. If there's an existing active session on a *different* job for this uid, closes it first (writes the updated job back)
  2. Surfaces "Stopped Job X at Yh Zm. Started Job Y." toast
  3. Calls `startSession(targetJob, uid)` and writes the result
- `stopTimer(job)`:
  1. Calls `stopActiveSession(job)` and writes the result
  2. Surfaces the auto-fill action toast (§9) when applicable

Writes use the existing `fbSetFast(jobsCol, job.id, updatedJob)` path. No new Firestore collections or listeners.

## 12. Offline behavior

The local clock is the source of truth for timestamps. Firestore's persistent cache queues writes when offline; the snapshot listener reconciles when back online. Edge cases:

- **Tech offline, taps START**: timestamp stamped locally; write queues. UI shows the timer running (driven by local state + `setInterval`, no network needed).
- **Tech offline for hours, taps STOP**: `endAt` stamped locally; both writes flush together when back online.
- **Two devices clocked the same tech simultaneously**: last-write-wins (matches Sub-Project B's concurrency model). The local user sees their own write reflected immediately; the other device's listener picks up the change on reconnect.

No special offline UX surface beyond what Firestore already provides.

## 13. Backward compatibility

- Existing jobs without `timeSessions`: hooks treat as empty array. UI shows "No time logged yet" until the operator clicks START.
- Existing `laborHours` field: untouched. Auto-fill only suggests via toast; never overwrites silently.
- Tire / mechanic / detailing all use the same timer surface (universal, vertical-agnostic).
- No firestore.rules changes.
- Every commit independently revertible.

## 14. UI changes summary

| File | Change |
|---|---|
| `src/types/index.ts` | Add `TimeSession` interface + `Job.timeSessions?: ReadonlyArray<TimeSession>` |
| `src/lib/deserializers.ts` | Deserialize `timeSessions` array |
| `src/lib/jobTime.ts` (new) | Pure helpers (7 functions) |
| `src/lib/useActiveTimer.ts` (new) | React hook |
| `src/components/ActiveTimerBar.tsx` (new) | Sticky top banner |
| `src/components/JobDetailModal/JobTimer.tsx` (new) | Inline timer block + history |
| `src/components/JobDetailModal.tsx` | Mount `JobTimer` between StageHistory and Mark Paid CTA |
| `src/App.tsx` | Mount `ActiveTimerBar` between Header and main content |

5 new files + 3 modified. No firestore.rules / no new collections / no new permission flags.

## 15. Testing

Five pure-helper test files:

| File | Coverage |
|---|---|
| `tests/activeSession.test.ts` | Returns the open session; undefined when none or all closed; latest open when multiple (defensive) |
| `tests/totalElapsedMs.test.ts` | Sums closed sessions; includes active session up to `now`; empty → 0; multiple closed + one open |
| `tests/startStopSession.test.ts` | startSession appends new open entry; stopActiveSession stamps endAt on most-recent open; stop with no open → no-op (returns same job) |
| `tests/findActiveSessionAcrossJobs.test.ts` | Finds the right job for the uid; returns null when no active; ignores other uids' opens; ignores closed sessions |
| `tests/suggestedLaborHours.test.ts` | Rounds up to 0.25; 0 ms → 0; <15 min → 0.25; exactly 1h → 1.0; 1h 1min → 1.25 |

Plus a 6th for the formatter:

| `tests/formatDuration.test.ts` | "1h 23m" / "42m" / "3s" / "0s" handling |

~60 assertions. `npx tsx`-runnable.

## 16. Pre-tag production smoke checklist

**Owner regression:**
- [ ] All existing flows unchanged when no timer running (Dashboard / AddJob / Inventory / Settings / Invoice)
- [ ] ActiveTimerBar not visible when no active session
- [ ] No console errors before any timer action

**New surface:**
- [ ] Open a job → JobTimer block shows "No time logged yet" + [▶ START WORK]
- [ ] Tap START → ActiveTimerBar appears at the top with elapsed time ticking each second
- [ ] Navigate to another page (History / Inventory / etc.) → bar persists at the top
- [ ] Tap the bar → opens the active job's JobDetailModal
- [ ] Tap STOP → bar disappears; toast offers "Fill labor hours" action
- [ ] Tap "Fill labor hours" → `Job.laborHours` updates with rounded total (visible on next save / edit)
- [ ] Decline the toast → `laborHours` stays as-is, sessions persist on the job
- [ ] Tap START on Job A, then START on Job B → Job A auto-stops; toast says "Stopped Job A at Xh Ym. Started Job B."
- [ ] Past sessions list renders in JobTimer block (newest first) with correct actor labels
- [ ] Total time display matches the sum of session durations

**Permission:**
- [ ] Owner sees timer block on every job
- [ ] Tech sees timer block + buttons on jobs assigned/created by them
- [ ] Tech does NOT see the START/STOP buttons on a stranger's job (block still shows past sessions for read)

**Offline:**
- [ ] Toggle DevTools offline → tap START → timer ticks normally; ActiveTimerBar shows
- [ ] Toggle back online → write syncs; no duplicate sessions

**Cross-cutting:**
- [ ] No console errors
- [ ] Bundle delta ≤ +5 kB gzipped

## 17. Rollback path

Each implementation commit is revertible independently:

1. Schema widening — purely additive, no consumers if reverted
2. Pure helpers + tests — additive
3. `useActiveTimer` hook — additive
4. `JobTimer` component — no consumer until mounted
5. `ActiveTimerBar` component — no consumer until mounted
6. JobDetailModal mounts `JobTimer` — additive UI
7. App.tsx mounts `ActiveTimerBar` — additive UI

Reverting step 6 or 7 leaves the data intact; the timer just becomes invisible.

## 18. Performance posture

- `findActiveSessionAcrossJobs` is O(jobs × sessions). At realistic scale (≤500 jobs × ≤20 sessions each = 10k iterations) this runs in sub-millisecond on every snapshot update.
- `setInterval(1000)` only runs when there's an active session — zero perf cost when no session active.
- No new Firestore listeners.
- `timeSessions` array on a Job doc adds ~50 bytes per session. At 20 sessions per job, ~1 KB extra per Job doc. Negligible against existing Firestore tier limits.

## 19. Open items for the implementation plan

The `writing-plans` skill must capture:

1. **`useActiveTimer` race conditions** — when the snapshot listener fires *during* a startTimer call, the hook should not double-write. The implementation guards with a "writing" flag during the async write.
2. **Members-directory lookup for `JobTimer` actor labels** — reuses existing `useMembersDirectory` hook from Phase 2.2.
3. **`ActiveTimerBar` insertion site** — between `<Header>` and `<main className="main-content">` in `App.tsx`.
4. **Toast action wiring** — uses the existing `addActionToast` from Phase 2.2 Sub-Project D (Tasks 8). One-tap "Fill labor hours" action.
5. **No firestore.rules changes.**
6. **Granularity decision documented in code comment** — 0.25-hour increments per the design.
