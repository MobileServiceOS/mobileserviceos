# Offline Mode — Implementation Plan

> Spec: `docs/superpowers/specs/2026-05-22-offline-mode-design.md`

**Goal:** An offline reassurance banner. Data persistence already
done (Firestore `persistentLocalCache`).

---

### Task 1: `OfflineBanner` component + test

**Files:** Create `src/components/OfflineBanner.tsx`,
`tests/components/OfflineBanner.test.tsx`

- [ ] `OfflineBanner({ syncStatus })`:
  - state `mode: 'hidden' | 'offline' | 'reconnected'`
  - `useEffect` on `syncStatus`:
    - `=== 'offline'` → `mode = 'offline'`
    - was offline, now not → `mode = 'reconnected'`, `setTimeout`
      ~3s → `mode = 'hidden'` (clear timer on cleanup)
  - render: `null` when hidden; amber strip when offline; green
    strip when reconnected.
- [ ] Vitest test: offline → text shown; connected (no prior
  offline) → renders null; offline→connected transition shows
  "Back online" then hides after fake-timer advance.
- [ ] `npx vitest run` → green.

### Task 2: CSS

**Files:** Modify `src/styles/app.css`

- [ ] `.offline-banner` — full-width strip, amber tint, sticky-ish
  below header, small bold text, centered. `.reconnected`
  variant in green.

### Task 3: Mount in App

**Files:** Modify `src/App.tsx`

- [ ] Render `<OfflineBanner syncStatus={syncStatus} />` directly
  below the `Header` (next to where `ActiveTimerBar` mounts).
- [ ] `npx tsc --noEmit` → clean.

### Task 4: Verify + ship

- [ ] `npm run build` clean; `npm test` (43 logic) green;
  `npm run test:ui` (component) green.
- [ ] Commit + push.
