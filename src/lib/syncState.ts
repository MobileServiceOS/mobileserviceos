// ─────────────────────────────────────────────────────────────────────
//  Sync-state tracker — a tiny pub/sub that surfaces:
//
//    pendingWrites:  count of in-flight Firestore writes (incremented
//                    by fbSetFast at request time, decremented on
//                    resolve OR error). Useful for "3 changes
//                    queued" UI when offline.
//
//    lastSyncedAt:   ISO timestamp set whenever a write resolves
//                    SUCCESSFULLY (i.e. server-acked). Drives the
//                    "Last synced 5 min ago" tooltip.
//
//    failedWrites:  count of writes that errored out permanently.
//                    Surfaces a "X writes failed — retry?" prompt.
//
//  Pure module — no React, no Firestore. fbSetFast in firebase.ts
//  imports the increment / decrement / fail helpers and calls them
//  around its existing setDoc call. The UI consumes via the
//  useSyncState hook (see useSyncState.ts).
// ─────────────────────────────────────────────────────────────────────

export interface SyncState {
  pendingWrites: number;
  lastSyncedAt: string | null;
  failedWrites: number;
}

const state: SyncState = {
  pendingWrites: 0,
  lastSyncedAt: null,
  failedWrites: 0,
};

const listeners = new Set<(s: SyncState) => void>();

function emit() {
  // Shallow copy so consumers compare by reference for memo / re-render.
  const snap = { ...state };
  for (const fn of listeners) fn(snap);
}

export function subscribeSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => { listeners.delete(fn); };
}

export function getSyncState(): SyncState {
  return { ...state };
}

export function noteWriteIssued(): void {
  state.pendingWrites += 1;
  emit();
}

export function noteWriteAcked(): void {
  state.pendingWrites = Math.max(0, state.pendingWrites - 1);
  state.lastSyncedAt = new Date().toISOString();
  // Successful write clears the "failed" badge — operator's prior
  // failure was either transient or the retry succeeded.
  if (state.failedWrites > 0) state.failedWrites = 0;
  emit();
}

export function noteWriteFailed(): void {
  state.pendingWrites = Math.max(0, state.pendingWrites - 1);
  state.failedWrites += 1;
  emit();
}

/** Test seam — only used by tests; production code uses the
 *  increment / decrement helpers exclusively. */
export function _resetSyncStateForTests(): void {
  state.pendingWrites = 0;
  state.lastSyncedAt = null;
  state.failedWrites = 0;
  emit();
}
