// src/lib/useSwipeAction.ts
// ═══════════════════════════════════════════════════════════════════
//  Right-swipe gesture hook for revealing a single confirm action.
//
//  Use case in MSOS: swipe a job card to mark it paid. The same
//  gesture appears on History and on Dashboard's Recent Completed
//  Jobs section. Extracted from HistoryJobCard so both surfaces
//  share one implementation.
//
//  Behavior:
//    - Tracks right-only horizontal motion (negative dx = no-op).
//    - Vertical motion > 12px ABORTS the gesture so it never hijacks
//      a list scroll — pointer-tracking handed back to the browser.
//    - swipeX clamped to commit threshold + 20 (overshoot allowance)
//      so the user gets a tactile "I've gone far enough" feel.
//    - Release past commit threshold → onCommit() fires + tile snaps
//      back via the eased transition.
//    - Release short of commit → tile snaps back, action does not
//      fire. Threshold is intentionally generous (100px) so casual
//      finger drags don't accidentally mark jobs paid.
//
//  Composes cleanly with useLongPress: pointer events vs touch/mouse
//  events use different React handlers, so neither hijacks the other.
//  Long-press cancels on 10px movement; this hook needs 60+ for reveal
//  and 100+ for commit, so by the time swipe is meaningful, long-press
//  has bailed.
//
//  Returns:
//    - reveal: boolean — true once the user has moved past REVEAL_PX.
//      Caller renders the colored background underlay based on this.
//    - committed: boolean — true once past COMMIT_PX (still tracking).
//      Caller uses this for the "release to confirm" label change.
//    - swipeX: number — current horizontal offset to apply via
//      transform: translateX(${swipeX}px).
//    - bind: handler bag to spread onto the swipe container.
// ═══════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react';

export interface UseSwipeActionOptions {
  /** Disable the gesture (e.g. card is already in a state where swipe
   *  is meaningless). When false, all handlers are no-ops. */
  enabled: boolean;
  /** Pixel threshold where the underlay starts revealing. Below this,
   *  swipeX returns 0. Prevents a tiny finger graze from flashing the
   *  underlay. Default 20. */
  revealPx?: number;
  /** Pixel threshold where release commits the action. Default 100. */
  commitPx?: number;
  /** Vertical pixels that disqualify the gesture as a horizontal swipe.
   *  Once exceeded, swipeX resets to 0 and the gesture is abandoned
   *  for the rest of this pointer interaction. Default 12. */
  verticalToleranceY?: number;
  /** Fires on release past commitPx. */
  onCommit: () => void;
}

export interface UseSwipeActionResult {
  /** Current horizontal offset in px. Apply via transform: translateX. */
  swipeX: number;
  /** True once swipeX has crossed revealPx in this gesture. */
  reveal: boolean;
  /** True once swipeX has crossed commitPx in this gesture. */
  committed: boolean;
  /** Spread onto the swipe container. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bind: Record<string, (e: any) => void>;
}

export function useSwipeAction({
  enabled,
  revealPx = 20,
  commitPx = 100,
  verticalToleranceY = 12,
  onCommit,
}: UseSwipeActionOptions): UseSwipeActionResult {
  const trackRef = useRef<{ startX: number; startY: number; tracking: boolean } | null>(null);
  const [swipeX, setSwipeX] = useState(0);

  const reset = () => {
    if (trackRef.current) trackRef.current.tracking = false;
    trackRef.current = null;
    setSwipeX(0);
  };

  // Disabled → empty handler bag (spread is a no-op). Cast keeps the
  // bind shape uniform; the consumer just spreads regardless.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bind: Record<string, (e: any) => void> = !enabled ? {} : {
    onPointerDown: (e: { clientX: number; clientY: number }) => {
      trackRef.current = { startX: e.clientX, startY: e.clientY, tracking: true };
    },
    onPointerMove: (e: { clientX: number; clientY: number }) => {
      const t = trackRef.current;
      if (!t || !t.tracking) return;
      const dx = e.clientX - t.startX;
      const dy = Math.abs(e.clientY - t.startY);
      // Vertical scroll dominates → abandon. Pointer-tracking falls
      // back to the browser's native scroll behavior.
      if (dy > verticalToleranceY && Math.abs(dx) < dy) {
        t.tracking = false;
        setSwipeX(0);
        return;
      }
      if (dx > 0) setSwipeX(Math.min(dx, commitPx + 20));
    },
    onPointerUp: () => {
      const t = trackRef.current;
      const committedNow = !!(t && t.tracking && swipeX >= commitPx);
      reset();
      if (committedNow) onCommit();
    },
    onPointerCancel: () => reset(),
  };

  return {
    swipeX,
    reveal: swipeX >= revealPx,
    committed: swipeX >= commitPx,
    bind,
  };
}
