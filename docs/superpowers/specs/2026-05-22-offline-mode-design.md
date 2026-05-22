# Offline Mode — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Feature:** #16 from the product roadmap — offline emergency mode.

## Audit

The data layer is already done: Firestore is initialized with
`persistentLocalCache` (IndexedDB), so offline writes/reads and
automatic re-sync on reconnect all work. App.tsx already detects
connectivity (`navigator.onLine` + `online`/`offline` events) and
drives a `SyncStatus`; the Header shows a small sync pill.

## Gap

The only offline signal is a tiny pill in the Header corner —
easy to miss. A roadside tech in a dead zone needs visible,
calm confidence that their job log is safe.

## Goal

A clear offline reassurance banner. No data-layer change.

## Design

A new `OfflineBanner` component — a strip rendered below the
Header (alongside `ActiveTimerBar`):

- **Offline** (`syncStatus === 'offline'`): a persistent amber
  strip — "⚠ Offline — your work is saved on this device and
  syncs automatically when you reconnect."
- **Reconnected** (offline → syncing/connected transition): flips
  to a green "✓ Back online — syncing your changes…" for ~3s,
  then auto-hides.
- **Otherwise**: renders `null`.

The offline→online transition is tracked with a small
`useState` + `useEffect` inside the component, keyed off the
`syncStatus` prop. The reconnect timer is cleared on unmount /
re-transition.

## Files

| File | Change |
|---|---|
| `src/components/OfflineBanner.tsx` | **new** — strip + transition logic |
| `src/App.tsx` | mount `<OfflineBanner syncStatus={syncStatus} />` below the Header |
| `src/styles/app.css` | `.offline-banner` + `.offline-banner.reconnected` styles |

## Testing

`tests/components/OfflineBanner.test.tsx` (vitest):
- `syncStatus='offline'` → reassurance text shown.
- `syncStatus='connected'` with no prior offline → renders nothing.
- offline → connected transition → "Back online" shown, then
  hidden after the timer (fake timers).

## Out of scope

- A precise "N changes queued" count — Firestore's web SDK
  exposes no pending-write count; an app-level counter would be
  fragile. The banner reassures without a number.
- Offline photo preservation — the job-photo feature (#8) was not
  selected; nothing to preserve.

## Decisions locked during brainstorming

- Offline Mode = a **reassurance banner**; the data persistence
  layer is already complete (Firestore `persistentLocalCache`).
