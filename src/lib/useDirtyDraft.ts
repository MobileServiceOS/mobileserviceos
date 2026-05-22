// src/lib/useDirtyDraft.ts
// ═══════════════════════════════════════════════════════════════════
//  Dirty-aware local-draft sync hook.
//
//  Settings forms hold a local editable copy of upstream parent
//  state (Brand from BrandContext, Settings from App). The parent
//  re-emits on every Firestore snapshot — including the optimistic
//  update after our own save and any background write (subscription
//  mirror, services-backfill). Without a dirty guard, every emit
//  resets the local draft and wipes in-progress edits — the
//  production "I edit and it goes right back" bug on Wheel Rush
//  (fixed in commit 07d5125).
//
//  This hook encapsulates the correct pattern so the four existing
//  settings forms — and any future form — can use it without
//  re-implementing (and risking re-introducing) the bug:
//
//    const { draft, set, dirty, markClean, replace } =
//      useDirtyDraft(upstreamValue);
//
//    <input value={draft.fieldName}
//           onChange={(e) => set('fieldName', e.target.value)} />
//
//    if (dirty) {
//      <button onClick={async () => {
//        await persist(draft);
//        markClean();
//      }}>Save</button>
//    }
//
//  Re-sync happens automatically when the upstream value changes
//  AND the form is clean. While dirty, the user's edits are
//  preserved across snapshot churn until they either save
//  (markClean) or call replace() to explicitly discard.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';

export interface DirtyDraftAPI<T> {
  /** The current local draft. Render fields from this. */
  draft: T;
  /** True when the user has made unsaved edits since the last sync /
   *  markClean call. Use to gate the Save button visibility. */
  dirty: boolean;
  /** Update a single field, marking the draft dirty. */
  set: <K extends keyof T>(k: K, v: T[K]) => void;
  /** Update multiple fields at once via a patch object. Sets dirty. */
  patch: (p: Partial<T>) => void;
  /** Replace the entire draft. Marks dirty by default; pass `false`
   *  for the second arg to replace without marking (rare — used
   *  e.g. after an auto-save where the draft already matches
   *  upstream). */
  replace: (next: T, markDirty?: boolean) => void;
  /** Clear the dirty flag — call after a successful save so the
   *  next upstream snapshot is allowed to flow through. */
  markClean: () => void;
}

/**
 * Content equality for the re-sync bailout. The draft shapes this
 * hook holds (Brand, Settings, pricing maps) are plain JSON-safe
 * data, so a stringify compare is correct and cheap. A key-order
 * difference at worst causes one extra (harmless) re-sync, never a
 * loop — after that sync `cur` and `upstream` are the same ref.
 */
function sameContent<T>(a: T, b: T): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function useDirtyDraft<T>(upstream: T): DirtyDraftAPI<T> {
  const [draft, setDraft] = useState<T>(upstream);
  const [dirty, setDirty] = useState(false);

  // Re-sync from upstream ONLY when there are no unsaved edits.
  // dirty=true preserves the user's in-progress changes across
  // parent re-emits.
  //
  // The functional setDraft + content check is what makes this
  // loop-proof: if a caller passes a fresh upstream object on every
  // render (a common React mistake — an inline object literal) but
  // the CONTENT is unchanged, returning `cur` lets React bail the
  // re-render. Without it, new-ref-every-render + a clean form
  // would re-sync → re-render → re-sync forever. The app's real
  // callers pass stable references, but the hook shouldn't depend
  // on every future caller getting that right.
  useEffect(() => {
    if (dirty) return;
    setDraft((cur) => (sameContent(cur, upstream) ? cur : upstream));
  }, [upstream, dirty]);

  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  }, []);

  const patch = useCallback((p: Partial<T>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  }, []);

  const replace = useCallback((next: T, markDirty = true) => {
    setDraft(next);
    setDirty(markDirty);
  }, []);

  const markClean = useCallback(() => setDirty(false), []);

  return { draft, dirty, set, patch, replace, markClean };
}
