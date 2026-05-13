import { useCallback, useRef } from 'react';

interface Options {
  /** Hold duration in ms before long-press fires. 450ms is the iOS default. */
  durationMs?: number;
  /** Pixel movement tolerance — if the finger moves more than this between
   *  start and end, treat it as a scroll/drag, not a long-press. */
  moveTolerancePx?: number;
}

interface UseLongPressResult {
  /** Spread onto the target element. Uses `any` event types so it composes
   *  with any host element (div, button, etc.) without React's strict
   *  HTMLAttributes complaining about signature mismatch. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bind: Record<string, (e: any) => void>;
  /** Ref the consumer checks in their onClick to suppress the post-long-press tap. */
  firedRef: { current: boolean | null };
}

/**
 * Long-press hook for mobile-first job cards.
 *
 * Fires `onLongPress` when the user holds for `durationMs` (default 450ms)
 * without moving more than `moveTolerancePx` (default 10px). Returns the
 * event-binding object and a `firedRef` so consumers can suppress the
 * normal click handler when a long-press fired.
 *
 * The `bind` shape uses an unstructured `Record<string, fn>` so it spreads
 * cleanly onto any host element. React's HTMLAttributes event types vary
 * by element (HTMLDivElement vs HTMLButtonElement), and our handler logic
 * only needs the touch/mouse positions — so we duck-type and stay loose.
 *
 * Usage:
 *   const lp = useLongPress(() => openSheet());
 *   <div onClick={(e) => { if (lp.firedRef.current) return; openJob(); }} {...lp.bind} />
 */
export function useLongPress(
  onLongPress: () => void,
  { durationMs = 450, moveTolerancePx = 10 }: Options = {},
): UseLongPressResult {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  // Set true when long-press fires; consumer's onClick checks this to skip
  // the regular tap action. Cleared 100ms later so subsequent taps work.
  const firedRef = useRef<boolean | null>(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const start = useCallback((x: number, y: number) => {
    startPosRef.current = { x, y };
    timerRef.current = window.setTimeout(() => {
      // Haptic feedback for gloved-hand roadside use.
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(20);
        }
      } catch {
        // ignore — vibrate isn't critical
      }
      firedRef.current = true;
      onLongPress();
      // Reset after enough time for the upcoming click event to check
      // and bail. Mobile click fires ~10-50ms after touchend.
      window.setTimeout(() => { firedRef.current = false; }, 100);
      clear();
    }, durationMs);
  }, [onLongPress, durationMs, clear]);

  const move = useCallback((x: number, y: number) => {
    const s = startPosRef.current;
    if (!s) return;
    if (Math.abs(x - s.x) > moveTolerancePx || Math.abs(y - s.y) > moveTolerancePx) {
      clear();
    }
  }, [clear, moveTolerancePx]);

  // Loose handler signatures — accept anything React passes. We pull only
  // what we need (clientX/Y or touches[0].clientX/Y).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bind: Record<string, (e: any) => void> = {
    onTouchStart: (e) => {
      const t = e?.touches?.[0];
      if (t) start(t.clientX, t.clientY);
    },
    onTouchEnd: () => clear(),
    onTouchMove: (e) => {
      const t = e?.touches?.[0];
      if (t) move(t.clientX, t.clientY);
    },
    onTouchCancel: () => clear(),
    onMouseDown: (e) => { if (typeof e?.clientX === 'number') start(e.clientX, e.clientY); },
    onMouseUp: () => clear(),
    onMouseMove: (e) => { if (typeof e?.clientX === 'number') move(e.clientX, e.clientY); },
    onMouseLeave: () => clear(),
    onContextMenu: (e) => {
      if (firedRef.current && typeof e?.preventDefault === 'function') {
        e.preventDefault();
      }
    },
  };

  return { bind, firedRef };
}
