# Start-from-Quote Workflow — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** #12 from the product roadmap — start-from-quote workflow.

## Goal

Tighten the quote → job → invoice → payment flow into one
continuous path. Quotes stay ephemeral (no new data) — this is
pure UX seam-smoothing.

## Three flow tighteners

### 1. Live success panel

`JobSuccessPanel` currently receives a frozen `savedJob` snapshot.
Tapping **Mark Paid** on the panel writes to Firestore but the
panel keeps showing "Pending Payment" + the button (the snapshot
never updates). Fix: `App.tsx` passes the **live** job — looked up
from the `jobs` array by id (`jobs.find(j => j.id === savedJob.id)
?? savedJob`). The jobs listener updates the array on every write,
so Mark Paid / invoice actions reflect on the panel immediately.

### 2. "Log Another Job" on the success panel

Continuous-flow win: after saving, the common next action is the
next job. Today that's Back to Dashboard → Log New Job (2 taps + a
detour). Add a wide "Log Another Job" button that calls the
existing `startNewJob` (reset draft + clear edit context + go to
the add tab) — one tap.

### 3. "From your quote" banner in AddJob

When the form was seeded via Quick Quote → Start Job
(`prefilledFromQuote` — already tracked + passed to AddJob), show a
small dismissable-free banner: "Prefilled from your quote — adjust
as needed." Closes the quote→job seam with a trust cue.

## Files

| File | Change |
|---|---|
| `src/App.tsx` | pass the live job to `JobSuccessPanel`; pass `onNewJob={startNewJob}` |
| `src/components/JobSuccessPanel.tsx` | new `onNewJob` prop + "Log Another Job" button |
| `src/pages/AddJob.tsx` | from-quote banner gated on `prefilledFromQuote` |

## Testing

Flow/UI wiring — no new pure logic. Verified by build + the
existing 43 logic + 18 component suites. The `startNewJob` reset
path is already exercised in App.

## Out of scope

- Persistent quote records — brainstorming chose ephemeral.
- The "dispatch" step — Dispatcher Board (#1) was not selected.

## Decisions locked during brainstorming

- "One continuous workflow" = **tighten the existing flow**, keep
  quotes ephemeral, no new data.
