# Time Tracking Implementation Plan (Phase 2.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship explicit clock-in/clock-out per job described in [docs/superpowers/specs/2026-05-21-time-tracking-design.md](../specs/2026-05-21-time-tracking-design.md) — `Job.timeSessions[]` array, persistent active-timer banner, JobDetailModal inline timer + history, auto-fill `laborHours` suggestion via action toast.

**Architecture:** Strictly additive on top of all prior phases. One new optional Job field (`timeSessions`), 7 pure helpers, 1 hook, 2 components, 2 mount sites. No new collection, no firestore.rules changes, no new dependencies. Concurrency rule (one active session per tech across all visible jobs) enforced client-side in the hook's startTimer.

**Tech Stack:** TypeScript strict mode, React 18, Firestore (existing `fbSetFast` writes). No new deps. Tests via `npx tsx`.

**Commit cadence:** one focused commit per task; never squash. `npm run build` + relevant `npx tsx tests/<file>.test.ts` after every task.

---

## File Structure

**Files to create:**

| File | Responsibility |
|---|---|
| `src/lib/jobTime.ts` | 7 pure helpers (activeSession, totalElapsedMs, startSession, stopActiveSession, suggestedLaborHours, findActiveSessionAcrossJobs, formatDuration) |
| `src/lib/useActiveTimer.ts` | React hook composing useScopedJobs + useMembership; exposes start/stop with auto-close concurrency rule |
| `src/components/JobDetailModal/JobTimer.tsx` | Inline timer block + past-sessions list inside JobDetailModal |
| `src/components/ActiveTimerBar.tsx` | Sticky top banner mounted in App.tsx; visible only when active session |
| `tests/activeSession.test.ts` | activeSession helper |
| `tests/totalElapsedMs.test.ts` | totalElapsedMs helper |
| `tests/startStopSession.test.ts` | startSession + stopActiveSession |
| `tests/findActiveSessionAcrossJobs.test.ts` | findActiveSessionAcrossJobs |
| `tests/suggestedLaborHours.test.ts` | suggestedLaborHours rounding |
| `tests/formatDuration.test.ts` | formatDuration string output |

**Files to modify:**

| File | Change |
|---|---|
| `src/types/index.ts` | Add `TimeSession` interface + `Job.timeSessions?: ReadonlyArray<TimeSession>` |
| `src/lib/deserializers.ts` | Deserialize `timeSessions` array |
| `src/components/JobDetailModal.tsx` | Mount `JobTimer` between StageHistory and the existing "Mark Paid" CTA |
| `src/App.tsx` | Mount `ActiveTimerBar` between Header and main content |

---

## Task 1: Schema widening + deserializer

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/deserializers.ts`

- [ ] **Step 1: Add `TimeSession` interface + widen `Job`**

Open `src/types/index.ts`. Near the existing `JobPartLine` interface (or near the lifecycle-foundation types — anywhere job-adjacent), add:

```ts
export interface TimeSession {
  /** ISO timestamp when work began. */
  startAt: string;
  /** ISO timestamp when work ended. Open session has endAt undefined. */
  endAt?: string;
  /** Auth uid of whoever clocked. Owner/admin clocking on behalf
   *  of a tech stamps their own uid, not the tech's. */
  byUid: string;
  /** Optional free-text note ("paused for parts pickup", etc.). */
  note?: string;
}
```

Find the `Job` interface. Append the new optional field at the end (after the Sub-Project C `transitions?` field):

```ts
  // ─── Time tracking (Phase 2.4) ───────────────────────────────────
  /** Clock-in/out sessions for this job. Most-recent session with
   *  endAt undefined is the active one. Total time = sum of (endAt -
   *  startAt) for closed sessions + (now - startAt) for the open
   *  session if any. */
  timeSessions?: ReadonlyArray<TimeSession>;
```

- [ ] **Step 2: Deserialize `timeSessions`**

In `src/lib/deserializers.ts`, find `deserializeJob`. Add the field handler — pick a sensible adjacent slot (e.g., next to `transitions`):

```ts
    timeSessions: Array.isArray(raw.timeSessions)
      ? (raw.timeSessions as unknown[]).map((raw_session) => {
          const sess = raw_session as Record<string, unknown>;
          return {
            startAt: asString(sess.startAt),
            endAt: sess.endAt == null ? undefined : asString(sess.endAt),
            byUid: asString(sess.byUid),
            note: sess.note == null ? undefined : asString(sess.note),
          };
        })
      : undefined,
```

Confirm the `TimeSession` import (the cast above doesn't need it because we hand-construct each entry).

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: TS clean.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/deserializers.ts
git commit -m "feat(types): Phase 2.4 TimeSession + Job.timeSessions"
```

---

## Task 2: Pure helpers + 6 test files

**Files:**
- Create: `src/lib/jobTime.ts`
- Create: `tests/activeSession.test.ts`
- Create: `tests/totalElapsedMs.test.ts`
- Create: `tests/startStopSession.test.ts`
- Create: `tests/findActiveSessionAcrossJobs.test.ts`
- Create: `tests/suggestedLaborHours.test.ts`
- Create: `tests/formatDuration.test.ts`

- [ ] **Step 1: Write the helpers**

```ts
// src/lib/jobTime.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers for the per-job time-tracking system. Every function
//  is pure (no I/O, no globals). The React hook + UI components in
//  this phase consume these helpers via useActiveTimer.
//
//  Granularity: laborHours auto-fill rounds UP to 0.25-hour
//  increments (15-minute service-billing convention). See
//  suggestedLaborHours().
// ═══════════════════════════════════════════════════════════════════

import type { Job, TimeSession } from '@/types';

/**
 * Return the open session (endAt undefined) on a job, or undefined
 * when none exists. When multiple open sessions exist (defensive —
 * shouldn't happen given the concurrency rule, but the schema
 * doesn't enforce it), returns the most recently started one.
 */
export function activeSession(
  job: Pick<Job, 'timeSessions'>,
): TimeSession | undefined {
  const sessions = job.timeSessions ?? [];
  let latest: TimeSession | undefined;
  for (const s of sessions) {
    if (s.endAt === undefined || s.endAt === null) {
      if (!latest || s.startAt > latest.startAt) {
        latest = s;
      }
    }
  }
  return latest;
}

/**
 * Total elapsed milliseconds across all sessions on this job. Closed
 * sessions contribute (endAt - startAt). The open session (if any)
 * contributes (now - startAt). Empty / undefined sessions → 0.
 */
export function totalElapsedMs(
  job: Pick<Job, 'timeSessions'>,
  now: Date = new Date(),
): number {
  const sessions = job.timeSessions ?? [];
  let total = 0;
  for (const s of sessions) {
    const start = new Date(s.startAt).getTime();
    if (!Number.isFinite(start)) continue;
    const end = s.endAt ? new Date(s.endAt).getTime() : now.getTime();
    if (!Number.isFinite(end)) continue;
    const delta = end - start;
    if (delta > 0) total += delta;
  }
  return total;
}

/**
 * Append a new open session to a job. Returns a NEW job — input is
 * not mutated. Does NOT close any existing open session — caller is
 * responsible for enforcing the concurrency rule.
 */
export function startSession(
  job: Job,
  byUid: string,
  now: Date = new Date(),
): Job {
  const session: TimeSession = {
    startAt: now.toISOString(),
    byUid,
  };
  const existing = job.timeSessions ?? [];
  return { ...job, timeSessions: [...existing, session] };
}

/**
 * Stamp endAt on the most recent open session (if any). Returns a
 * NEW job — input is not mutated. When no open session exists,
 * returns the same job reference unchanged.
 */
export function stopActiveSession(
  job: Job,
  now: Date = new Date(),
): Job {
  const sessions = job.timeSessions ?? [];
  if (sessions.length === 0) return job;
  // Find the most-recent open session by index.
  let openIdx = -1;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].endAt === undefined || sessions[i].endAt === null) {
      if (openIdx === -1 || sessions[i].startAt > sessions[openIdx].startAt) {
        openIdx = i;
      }
    }
  }
  if (openIdx === -1) return job;
  const updated = sessions.slice();
  updated[openIdx] = { ...sessions[openIdx], endAt: now.toISOString() };
  return { ...job, timeSessions: updated };
}

/**
 * Round elapsed milliseconds UP to 0.25-hour increments. Standard
 * service-billing granularity. 0 ms → 0; 1 ms → 0.25; 15 min → 0.25;
 * 16 min → 0.5; exactly 1 hour → 1.0; 1 hour 1 min → 1.25.
 */
export function suggestedLaborHours(totalMs: number): number {
  if (totalMs <= 0) return 0;
  const hours = totalMs / 3_600_000;
  return Math.ceil(hours * 4) / 4;
}

/**
 * Scan a list of jobs for the first open session whose byUid matches
 * the given uid. Returns null when no match. Closed sessions are
 * ignored. Used by useActiveTimer to derive the "currently working"
 * state across the whole business.
 */
export function findActiveSessionAcrossJobs(
  jobs: ReadonlyArray<Job>,
  uid: string | null | undefined,
): { job: Job; session: TimeSession } | null {
  if (!uid) return null;
  for (const job of jobs) {
    const sessions = job.timeSessions ?? [];
    for (const s of sessions) {
      if (s.byUid === uid && (s.endAt === undefined || s.endAt === null)) {
        return { job, session: s };
      }
    }
  }
  return null;
}

/**
 * Human-readable duration string. "1h 23m" / "42m" / "3s" / "0s".
 * Used by ActiveTimerBar + JobTimer.
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
```

- [ ] **Step 2: Write `tests/activeSession.test.ts`**

```ts
// tests/activeSession.test.ts
// Run: npx tsx tests/activeSession.test.ts

import { activeSession } from '@/lib/jobTime';
import type { Job, TimeSession } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const s = (over: Partial<TimeSession>): TimeSession => ({
  startAt: '2026-05-21T10:00:00Z', byUid: 'u', ...over,
});

console.log('\n┌─ activeSession ───────────────────────────────────');
check('undefined timeSessions → undefined',
  activeSession({ timeSessions: undefined } as Pick<Job, 'timeSessions'>) === undefined);
check('empty → undefined',
  activeSession({ timeSessions: [] }) === undefined);
check('all closed → undefined',
  activeSession({ timeSessions: [s({ endAt: '2026-05-21T11:00:00Z' })] }) === undefined);
{
  const open = s({ startAt: '2026-05-21T12:00:00Z' });
  check('one open → returns it',
    activeSession({ timeSessions: [open] }) === open);
}
{
  const closed = s({ endAt: '2026-05-21T11:00:00Z' });
  const open = s({ startAt: '2026-05-21T12:00:00Z' });
  check('mixed: returns the open',
    activeSession({ timeSessions: [closed, open] }) === open);
}
{
  const early = s({ startAt: '2026-05-21T08:00:00Z' });
  const late = s({ startAt: '2026-05-21T14:00:00Z' });
  check('two open: returns the latest-started',
    activeSession({ timeSessions: [early, late] }) === late);
}
check('endAt explicitly null → treated as open',
  activeSession({ timeSessions: [s({ endAt: null as unknown as undefined })] })?.byUid === 'u');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Write `tests/totalElapsedMs.test.ts`**

```ts
// tests/totalElapsedMs.test.ts
// Run: npx tsx tests/totalElapsedMs.test.ts

import { totalElapsedMs } from '@/lib/jobTime';
import type { Job, TimeSession } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const s = (start: string, end?: string): TimeSession => ({
  startAt: start, byUid: 'u', endAt: end,
});

console.log('\n┌─ totalElapsedMs ──────────────────────────────────');
check('empty → 0',
  totalElapsedMs({ timeSessions: [] }) === 0);
check('undefined → 0',
  totalElapsedMs({ timeSessions: undefined } as Pick<Job, 'timeSessions'>) === 0);
{
  // 10:00 → 11:00 = 1 hour = 3,600,000 ms
  const ms = totalElapsedMs({
    timeSessions: [s('2026-05-21T10:00:00Z', '2026-05-21T11:00:00Z')],
  });
  check('1 closed session of 1 hour = 3,600,000 ms', ms === 3_600_000);
}
{
  // 10:00 → 11:00 (1h) + 13:00 → 14:30 (1.5h) = 2.5h = 9,000,000 ms
  const ms = totalElapsedMs({
    timeSessions: [
      s('2026-05-21T10:00:00Z', '2026-05-21T11:00:00Z'),
      s('2026-05-21T13:00:00Z', '2026-05-21T14:30:00Z'),
    ],
  });
  check('2 closed sessions: 1h + 1.5h = 9,000,000 ms', ms === 9_000_000);
}
{
  // 1 closed (1h) + 1 open from 14:00, now = 14:30 → 30m
  const now = new Date('2026-05-21T14:30:00Z');
  const ms = totalElapsedMs({
    timeSessions: [
      s('2026-05-21T10:00:00Z', '2026-05-21T11:00:00Z'),
      s('2026-05-21T14:00:00Z'),
    ],
  }, now);
  check('closed + open: 1h + 30m = 5,400,000 ms', ms === 5_400_000);
}
{
  // Single open session, now after start
  const now = new Date('2026-05-21T10:42:00Z');
  const ms = totalElapsedMs({
    timeSessions: [s('2026-05-21T10:00:00Z')],
  }, now);
  check('single open session: 42m = 2,520,000 ms', ms === 2_520_000);
}
{
  // Bad timestamps ignored
  const ms = totalElapsedMs({
    timeSessions: [{ startAt: 'not-a-date', byUid: 'u', endAt: '2026-05-21T11:00:00Z' }],
  });
  check('invalid startAt → contributes 0', ms === 0);
}
{
  // Negative delta (endAt before startAt) ignored
  const ms = totalElapsedMs({
    timeSessions: [s('2026-05-21T11:00:00Z', '2026-05-21T10:00:00Z')],
  });
  check('negative delta ignored', ms === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: Write `tests/startStopSession.test.ts`**

```ts
// tests/startStopSession.test.ts
// Run: npx tsx tests/startStopSession.test.ts

import { startSession, stopActiveSession } from '@/lib/jobTime';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

console.log('\n┌─ startSession ────────────────────────────────────');
{
  const now = new Date('2026-05-21T10:00:00Z');
  const next = startSession(baseJob(), 'tech1', now);
  check('first session: timeSessions has 1 entry', next.timeSessions?.length === 1);
  check('entry has startAt now', next.timeSessions?.[0].startAt === '2026-05-21T10:00:00.000Z');
  check('entry has byUid', next.timeSessions?.[0].byUid === 'tech1');
  check('entry endAt undefined (open)', next.timeSessions?.[0].endAt === undefined);
}
{
  const job = baseJob({
    timeSessions: [{ startAt: '2026-05-21T08:00:00Z', endAt: '2026-05-21T09:00:00Z', byUid: 'tech1' }],
  });
  const now = new Date('2026-05-21T10:00:00Z');
  const next = startSession(job, 'tech1', now);
  check('appends to existing: 2 entries', next.timeSessions?.length === 2);
  check('first entry preserved', next.timeSessions?.[0].endAt === '2026-05-21T09:00:00Z');
  check('input not mutated', job.timeSessions?.length === 1);
}

console.log('\n┌─ stopActiveSession ───────────────────────────────');
{
  const job = baseJob();
  const next = stopActiveSession(job);
  check('no sessions → returns same job', next === job);
}
{
  const job = baseJob({
    timeSessions: [{ startAt: '2026-05-21T08:00:00Z', endAt: '2026-05-21T09:00:00Z', byUid: 'tech1' }],
  });
  const next = stopActiveSession(job);
  check('no open sessions → returns same job', next === job);
}
{
  const job = baseJob({
    timeSessions: [{ startAt: '2026-05-21T08:00:00Z', byUid: 'tech1' }],
  });
  const now = new Date('2026-05-21T09:30:00Z');
  const next = stopActiveSession(job, now);
  check('open session: endAt stamped',
    next.timeSessions?.[0].endAt === '2026-05-21T09:30:00.000Z');
  check('input not mutated',
    job.timeSessions?.[0].endAt === undefined);
}
{
  const job = baseJob({
    timeSessions: [
      { startAt: '2026-05-21T08:00:00Z', endAt: '2026-05-21T09:00:00Z', byUid: 'tech1' },
      { startAt: '2026-05-21T10:00:00Z', byUid: 'tech1' },
    ],
  });
  const now = new Date('2026-05-21T11:00:00Z');
  const next = stopActiveSession(job, now);
  check('mixed: only the open session is stamped',
    next.timeSessions?.[0].endAt === '2026-05-21T09:00:00Z' &&
    next.timeSessions?.[1].endAt === '2026-05-21T11:00:00.000Z');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 5: Write `tests/findActiveSessionAcrossJobs.test.ts`**

```ts
// tests/findActiveSessionAcrossJobs.test.ts
// Run: npx tsx tests/findActiveSessionAcrossJobs.test.ts

import { findActiveSessionAcrossJobs } from '@/lib/jobTime';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const j = (id: string, sessions?: { byUid: string; endAt?: string }[]): Job => ({
  id, date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  timeSessions: sessions?.map((x, i) => ({
    startAt: `2026-05-21T${10 + i}:00:00Z`,
    byUid: x.byUid,
    endAt: x.endAt,
  })),
} as Job);

console.log('\n┌─ findActiveSessionAcrossJobs ─────────────────────');
check('empty jobs list → null',
  findActiveSessionAcrossJobs([], 'tech1') === null);
check('null uid → null',
  findActiveSessionAcrossJobs([j('a', [{ byUid: 'tech1' }])], null) === null);
check('undefined uid → null',
  findActiveSessionAcrossJobs([j('a', [{ byUid: 'tech1' }])], undefined) === null);
{
  const jobs = [j('a', [{ byUid: 'tech1' }])];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('1 open session for uid → found',
    r !== null && r.job.id === 'a' && r.session.byUid === 'tech1');
}
{
  const jobs = [
    j('a', [{ byUid: 'tech1', endAt: '2026-05-21T11:00:00Z' }]),
    j('b', [{ byUid: 'tech1' }]),
  ];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('closed on a + open on b → finds b',
    r !== null && r.job.id === 'b');
}
{
  const jobs = [j('a', [{ byUid: 'tech2' }])];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('open session for different uid → null', r === null);
}
{
  const jobs = [j('a', [{ byUid: 'tech1', endAt: '2026-05-21T11:00:00Z' }])];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('only closed sessions for uid → null', r === null);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 6: Write `tests/suggestedLaborHours.test.ts`**

```ts
// tests/suggestedLaborHours.test.ts
// Run: npx tsx tests/suggestedLaborHours.test.ts

import { suggestedLaborHours } from '@/lib/jobTime';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const MIN = 60_000;

console.log('\n┌─ suggestedLaborHours ─────────────────────────────');
check('0 ms → 0', suggestedLaborHours(0) === 0);
check('negative → 0', suggestedLaborHours(-1) === 0);
check('1 ms → 0.25 (rounded up)', suggestedLaborHours(1) === 0.25);
check('14 min → 0.25', suggestedLaborHours(14 * MIN) === 0.25);
check('15 min → 0.25 (exact)', suggestedLaborHours(15 * MIN) === 0.25);
check('16 min → 0.5', suggestedLaborHours(16 * MIN) === 0.5);
check('29 min → 0.5', suggestedLaborHours(29 * MIN) === 0.5);
check('30 min → 0.5 (exact)', suggestedLaborHours(30 * MIN) === 0.5);
check('31 min → 0.75', suggestedLaborHours(31 * MIN) === 0.75);
check('45 min → 0.75 (exact)', suggestedLaborHours(45 * MIN) === 0.75);
check('59 min → 1.0', suggestedLaborHours(59 * MIN) === 1);
check('60 min (1h) → 1.0 (exact)', suggestedLaborHours(60 * MIN) === 1);
check('1h 1m → 1.25', suggestedLaborHours(61 * MIN) === 1.25);
check('2h 17m → 2.5', suggestedLaborHours((2 * 60 + 17) * MIN) === 2.5);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 7: Write `tests/formatDuration.test.ts`**

```ts
// tests/formatDuration.test.ts
// Run: npx tsx tests/formatDuration.test.ts

import { formatDuration } from '@/lib/jobTime';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;

console.log('\n┌─ formatDuration ──────────────────────────────────');
check('0 ms → "0s"', formatDuration(0) === '0s');
check('negative → "0s"', formatDuration(-1) === '0s');
check('500 ms → "0s"', formatDuration(500) === '0s');
check('3 sec → "3s"', formatDuration(3 * SEC) === '3s');
check('59 sec → "59s"', formatDuration(59 * SEC) === '59s');
check('60 sec → "1m"', formatDuration(60 * SEC) === '1m');
check('42 min → "42m"', formatDuration(42 * MIN) === '42m');
check('59 min → "59m"', formatDuration(59 * MIN) === '59m');
check('60 min → "1h"', formatDuration(60 * MIN) === '1h');
check('1h 23m → "1h 23m"', formatDuration(HR + 23 * MIN) === '1h 23m');
check('2h exact → "2h"', formatDuration(2 * HR) === '2h');
check('5h 7m → "5h 7m"', formatDuration(5 * HR + 7 * MIN) === '5h 7m');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 8: Run all six tests + verify build**

```bash
npx tsx tests/activeSession.test.ts
npx tsx tests/totalElapsedMs.test.ts
npx tsx tests/startStopSession.test.ts
npx tsx tests/findActiveSessionAcrossJobs.test.ts
npx tsx tests/suggestedLaborHours.test.ts
npx tsx tests/formatDuration.test.ts
npm run build
```
Expected: each file prints `N passed, 0 failed`; build clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/jobTime.ts tests/activeSession.test.ts tests/totalElapsedMs.test.ts tests/startStopSession.test.ts tests/findActiveSessionAcrossJobs.test.ts tests/suggestedLaborHours.test.ts tests/formatDuration.test.ts
git commit -m "feat(time-tracking): pure helpers + 6 test files (~70 assertions)"
```

---

## Task 3: `useActiveTimer()` React hook

**Files:**
- Create: `src/lib/useActiveTimer.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/lib/useActiveTimer.ts
// ═══════════════════════════════════════════════════════════════════
//  React hook returning the current member's active timer (if any)
//  + start/stop callbacks. The concurrency rule (one active session
//  per tech across the whole business) is enforced here: starting on
//  Job B when Job A has an open session for this uid auto-closes
//  Job A first.
//
//  The hook subscribes to useScopedJobs (Phase 2.2 Sub-Project B) so
//  it sees only jobs the current member is allowed to see — which
//  is exactly the scope that matters for finding their own active
//  session.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc } from 'firebase/firestore';
import { _db, _auth, scopedCol, fbSetFast } from '@/lib/firebase';
import { useMembership } from '@/context/MembershipContext';
import { useScopedJobs } from '@/lib/useScopedJobs';
import { addToast, addActionToast } from '@/lib/toast';
import { humanizeFirestoreError } from '@/lib/firebaseErrors';
import {
  startSession,
  stopActiveSession,
  findActiveSessionAcrossJobs,
  totalElapsedMs,
  suggestedLaborHours,
  formatDuration,
} from '@/lib/jobTime';
import type { Job, TimeSession } from '@/types';

export interface UseActiveTimerResult {
  active: {
    job: Job;
    session: TimeSession;
    elapsedSeconds: number;
  } | null;
  startTimer: (job: Job) => Promise<void>;
  stopTimer: (job: Job) => Promise<void>;
}

export function useActiveTimer(jobsOverride?: ReadonlyArray<Job>): UseActiveTimerResult {
  const scopedJobs = useScopedJobs(jobsOverride ?? []);
  // When jobsOverride is undefined, fall back to an empty list — the
  // hook is mounted by both ActiveTimerBar (which doesn't have jobs
  // in scope) and components that pass jobs. For the bar use case
  // we need a separate flow; see App.tsx integration in Task 7.
  const jobs = jobsOverride ?? scopedJobs;

  const { member } = useMembership();
  const uid = member?.uid;
  const businessId = member?.businessId;

  const active = useMemo(
    () => findActiveSessionAcrossJobs(jobs, uid),
    [jobs, uid],
  );

  // Tick every second when there's an active session so elapsedSeconds
  // updates for re-render.
  const [tickCount, setTickCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setTickCount((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [active]);

  const elapsedSeconds = useMemo(() => {
    if (!active) return 0;
    const start = new Date(active.session.startAt).getTime();
    if (!Number.isFinite(start)) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 1000));
  }, [active, tickCount]);

  // Guard against double-writes during async snapshot reconciliation.
  const writingRef = useRef(false);

  const writeJob = useCallback(async (j: Job): Promise<void> => {
    if (!businessId) return;
    const col = scopedCol(businessId, 'jobs');
    if (!col) return;
    await fbSetFast(col, j.id, j);
  }, [businessId]);

  const stopTimer = useCallback(async (job: Job): Promise<void> => {
    if (!uid || writingRef.current) return;
    writingRef.current = true;
    try {
      const stopped = stopActiveSession(job);
      if (stopped === job) return; // no-op
      await writeJob(stopped);

      // Offer the auto-fill action.
      const totalMs = totalElapsedMs(stopped);
      const suggested = suggestedLaborHours(totalMs);
      const existing = Number(job.laborHours || 0);
      if (suggested > existing) {
        addActionToast(
          `Stopped at ${formatDuration(totalMs)}.`,
          {
            label: 'Fill labor hours',
            onTap: () => {
              const withHours: Job = { ...stopped, laborHours: suggested };
              void writeJob(withHours);
            },
          },
          'success',
        );
      } else {
        addToast(`Stopped at ${formatDuration(totalMs)}.`, 'success');
      }
    } catch (e) {
      console.error('[useActiveTimer.stopTimer]', e);
      addToast(`Stop failed: ${humanizeFirestoreError(e)}`, 'error');
    } finally {
      writingRef.current = false;
    }
  }, [uid, writeJob]);

  const startTimer = useCallback(async (job: Job): Promise<void> => {
    if (!uid || writingRef.current) return;
    writingRef.current = true;
    try {
      // Concurrency rule: if a different job has my open session,
      // close it first. Same-job re-start is a no-op (the job already
      // has my session open).
      if (active && active.job.id !== job.id) {
        const totalMs = totalElapsedMs(active.job);
        const stoppedPrev = stopActiveSession(active.job);
        await writeJob(stoppedPrev);
        addToast(
          `Stopped ${active.job.service} at ${formatDuration(totalMs)}. Started ${job.service}.`,
          'info',
        );
      } else if (active && active.job.id === job.id) {
        // Already running on this job — silent no-op.
        return;
      }

      const started = startSession(job, uid);
      await writeJob(started);
    } catch (e) {
      console.error('[useActiveTimer.startTimer]', e);
      addToast(`Start failed: ${humanizeFirestoreError(e)}`, 'error');
    } finally {
      writingRef.current = false;
    }
  }, [uid, active, writeJob]);

  return {
    active: active
      ? { job: active.job, session: active.session, elapsedSeconds }
      : null,
    startTimer,
    stopTimer,
  };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/useActiveTimer.ts
git commit -m "feat(time-tracking): useActiveTimer hook (start/stop + concurrency rule + auto-fill toast)"
```

---

## Task 4: `JobTimer` component

**Files:**
- Create: `src/components/JobDetailModal/JobTimer.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/JobDetailModal/JobTimer.tsx
// ═══════════════════════════════════════════════════════════════════
//  Inline time-tracking block for JobDetailModal. Shows the active
//  session (if any), a START / STOP button gated by canEditJob, and
//  a list of past sessions with actor labels + durations.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState, useEffect } from 'react';
import type { Job, TimeSession, Role } from '@/types';
import { activeSession, totalElapsedMs, formatDuration } from '@/lib/jobTime';
import { canEditJob } from '@/lib/jobPermissions';
import { useActiveTimer } from '@/lib/useActiveTimer';

interface Props {
  job: Job;
  role: Role | null;
  uid: string | null;
  resolveName: (uid: string | undefined | null) => string | null;
}

function formatRange(startIso: string, endIso?: string): string {
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  if (!endIso) return `${fmt(startIso)} → now`;
  return `${fmt(startIso)} → ${fmt(endIso)}`;
}

export function JobTimer({ job, role, uid, resolveName }: Props) {
  const { startTimer, stopTimer } = useActiveTimer([job]);
  const open = activeSession(job);
  const isOpenForMe = !!(open && uid && open.byUid === uid);
  const canEdit = canEditJob(job, role, uid);

  // Tick once per second when this job has an open session so the
  // "currently working" line refreshes.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [open]);

  const totalMs = useMemo(() => totalElapsedMs(job), [job, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const closedSessions = useMemo(
    () => (job.timeSessions ?? []).filter(
      (s: TimeSession) => s.endAt !== undefined && s.endAt !== null,
    ),
    [job.timeSessions],
  );

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <div className="form-group-title">Time on this job</div>

      {open ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', marginBottom: 8,
          background: 'rgba(34,197,94,.08)',
          border: '1px solid rgba(34,197,94,.30)',
          borderRadius: 8,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
              ● Currently working
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)' }}>
              {formatDuration(totalMs)}
            </div>
          </div>
          {canEdit && isOpenForMe && (
            <button
              type="button"
              className="btn primary"
              onClick={() => { void stopTimer(job); }}
            >STOP</button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', marginBottom: 8,
        }}>
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>
            {totalMs > 0
              ? `Past sessions: ${formatDuration(totalMs)} total`
              : 'No time logged yet.'}
          </div>
          {canEdit && (
            <button
              type="button"
              className="btn primary"
              onClick={() => { void startTimer(job); }}
            >▶ START WORK</button>
          )}
        </div>
      )}

      {closedSessions.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Past sessions
          </div>
          {closedSessions.slice().reverse().map((s, i) => {
            const start = new Date(s.startAt).getTime();
            const end = s.endAt ? new Date(s.endAt).getTime() : Date.now();
            const ms = Math.max(0, end - start);
            const name = resolveName(s.byUid) || 'Unknown';
            return (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '6px 0',
                  borderTop: i === 0 ? 0 : '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 64 }}>{formatDuration(ms)}</span>
                <span style={{ flex: 1, color: 'var(--t2)' }}>
                  {name} · {formatRange(s.startAt, s.endAt)}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6, textAlign: 'right' }}>
            Total billed: {formatDuration(totalMs)}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/JobDetailModal/JobTimer.tsx
git commit -m "feat(time-tracking): JobTimer component (active + past sessions + START/STOP)"
```

---

## Task 5: `ActiveTimerBar` component

**Files:**
- Create: `src/components/ActiveTimerBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/ActiveTimerBar.tsx
// ═══════════════════════════════════════════════════════════════════
//  Sticky top banner that appears when the current member has an
//  active session somewhere. Mounted in App.tsx between Header and
//  the main content. Renders null when no session is active, so
//  it has zero visual cost for operators who never use the feature.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';
import { useActiveTimer } from '@/lib/useActiveTimer';
import { formatDuration } from '@/lib/jobTime';

interface Props {
  jobs: ReadonlyArray<Job>;
  onJobTap: (job: Job) => void;
}

export function ActiveTimerBar({ jobs, onJobTap }: Props) {
  const { active, stopTimer } = useActiveTimer(jobs);
  if (!active) return null;

  return (
    <div
      role="region"
      aria-label="Active timer"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '8px 14px',
        background: 'rgba(34,197,94,.12)',
        borderBottom: '1px solid rgba(34,197,94,.35)',
        position: 'sticky', top: 0, zIndex: 50,
      }}
    >
      <button
        type="button"
        onClick={() => onJobTap(active.job)}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          background: 'transparent', border: 0, padding: 0,
          color: 'var(--t1)', cursor: 'pointer', textAlign: 'left',
          minWidth: 0,
        }}
      >
        <span style={{ color: 'var(--green)', fontSize: 12 }}>●</span>
        <span style={{
          flex: 1, minWidth: 0, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
          fontSize: 13, fontWeight: 600,
        }}>
          Working: {active.job.service}
          {active.job.customerName ? ` — ${active.job.customerName}` : ''}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>
          {formatDuration(active.elapsedSeconds * 1000)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => { void stopTimer(active.job); }}
        className="btn sm primary"
        style={{ flexShrink: 0 }}
      >STOP</button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ActiveTimerBar.tsx
git commit -m "feat(time-tracking): ActiveTimerBar sticky banner component"
```

---

## Task 6: Mount `JobTimer` in JobDetailModal

**Files:**
- Modify: `src/components/JobDetailModal.tsx`

- [ ] **Step 1: Add the import + uid resolution**

In `src/components/JobDetailModal.tsx`, add the import next to the existing component imports:

```ts
import { JobTimer } from '@/components/JobDetailModal/JobTimer';
```

The component already has access to `role` (via `useMembership`) and `resolveName` (via `useMembersDirectory`) from Sub-Project C. Add the uid resolution next to those (or reuse if already present):

```ts
const { member } = useMembership();  // if not already destructured
const myUid = member?.uid || null;
```

- [ ] **Step 2: Mount `JobTimer` between StageHistory and Mark Paid CTA**

Find the existing block where `StageHistory` renders (search for `<StageHistory`). Immediately after the closing `</StageHistory>` (or in the same `<>...</>` fragment), add:

```tsx
<JobTimer
  job={job}
  role={role}
  uid={myUid}
  resolveName={resolveName}
/>
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/JobDetailModal.tsx
git commit -m "feat(time-tracking): mount JobTimer in JobDetailModal"
```

---

## Task 7: Mount `ActiveTimerBar` in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

In `src/App.tsx`, near the existing component imports:

```ts
import { ActiveTimerBar } from '@/components/ActiveTimerBar';
```

- [ ] **Step 2: Mount the bar between Header and main content**

Find the existing `<Header />` JSX (search for `<Header`). Immediately after the Header, before the `<main className="main-content">` or its equivalent, insert:

```tsx
<ActiveTimerBar
  jobs={jobs}
  onJobTap={(j) => setDetailJob(j)}
/>
```

The `jobs` state is already in scope (App.tsx holds it). The `setDetailJob` callback opens the JobDetailModal — already used elsewhere in App.tsx for navigation from notifications.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(time-tracking): mount ActiveTimerBar between Header and main content"
```

---

## Task 8: Final smoke + push + tag

- [ ] **Step 1: Re-run every test file**

```bash
for t in tests/*.test.ts; do
  result=$(npx tsx "$t" 2>&1 | grep -E "^\s+[0-9]+ passed" | tail -1)
  echo "$t → $result"
done
```
Expected: every file prints `N passed, 0 failed`.

- [ ] **Step 2: Final build**

```bash
npm run build
```
Expected: TS clean, Vite emit, no circular-dep warnings.

- [ ] **Step 3: Confirm commit log**

```bash
git log --oneline origin/main..HEAD
```
Expected: ~8 commits, focused, granular.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Run §16 spec smoke checklist on production**

After deploy lands:

**Owner regression:**
- All existing flows unchanged when no timer running
- ActiveTimerBar not visible when no active session

**New surface:**
- Open a job → JobTimer block shows "No time logged yet" + [▶ START WORK]
- Tap START → ActiveTimerBar appears at the top with elapsed time ticking each second
- Navigate to another page → bar persists
- Tap the bar → opens the active job's JobDetailModal
- Tap STOP → bar disappears; toast offers "Fill labor hours" action
- Tap "Fill labor hours" → `laborHours` field auto-fills with rounded total
- Tap START on Job A, then START on Job B → Job A auto-stops; toast says "Stopped Job A at Xh Ym. Started Job B."
- Past sessions list renders (newest first) with correct actor labels

**Permission:**
- Tech sees timer block + buttons on jobs assigned/created by them
- Tech does NOT see START/STOP on a stranger's job; past sessions still visible

**Offline:**
- DevTools offline → tap START → timer ticks normally
- Back online → write syncs; no duplicate sessions

**Cross-cutting:**
- No console errors
- Bundle delta ≤ +5 kB gzipped

- [ ] **Step 6: Tag stable**

```bash
git tag phase-2.4-time-tracking-stable $(git rev-parse HEAD)
git push origin phase-2.4-time-tracking-stable
```

---

## Phase summary

After all 8 tasks land:

| Surface | Result |
|---|---|
| Types | `TimeSession` interface; `Job.timeSessions?: ReadonlyArray<TimeSession>` |
| Helpers | 7 pure helpers in `jobTime.ts` (active/total/start/stop/find/suggest/format) |
| Tests | 6 new files; ~70 new assertions |
| Hook | `useActiveTimer()` composing useScopedJobs + concurrency rule + auto-fill toast |
| Components | `JobTimer` (inline block) + `ActiveTimerBar` (sticky banner) |
| Mounts | JobDetailModal renders JobTimer; App.tsx renders ActiveTimerBar |
| Backward compat | Tire / mechanic / detailing byte-identical when no timer running |
| Schema | One additive Job field |
| firestore.rules | No changes |
