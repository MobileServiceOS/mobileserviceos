# Start-from-Quote Workflow — Implementation Plan

> Spec: `docs/superpowers/specs/2026-05-22-quote-workflow-design.md`

**Goal:** Three flow tighteners — live success panel, "Log Another
Job", from-quote banner. No new data.

---

### Task 1: "Log Another Job" on JobSuccessPanel

**Files:** Modify `src/components/JobSuccessPanel.tsx`

- [ ] Add `onNewJob: () => void` to `Props`.
- [ ] Add a wide action button "Log Another Job" (➕) above
  "Back to Dashboard", calling `onNewJob`.
- [ ] `npx tsc --noEmit` — will error until App passes the prop
  (Task 2); that's expected mid-task.

### Task 2: App — live job + onNewJob wiring

**Files:** Modify `src/App.tsx`

- [ ] In the `tab === 'success'` branch, compute the live job:
  `const liveSavedJob = jobs.find((j) => j.id === savedJob.id) ?? savedJob;`
  and pass `job={liveSavedJob}`.
- [ ] Pass `onNewJob={startNewJob}` to `JobSuccessPanel`.
- [ ] `npx tsc --noEmit` → clean.

### Task 3: From-quote banner in AddJob

**Files:** Modify `src/pages/AddJob.tsx`

- [ ] When `prefilledFromQuote` is true, render a small banner near
  the top of the form: "Prefilled from your quote — adjust as
  needed." Use the existing `.info-banner` style or an inline
  amber-tint box.
- [ ] `npm run build` → clean.

### Task 4: Verify + ship

- [ ] `npm run build` clean; `npm test` (43 logic) green;
  `npm run test:ui` (18 component) green.
- [ ] Commit + push.
