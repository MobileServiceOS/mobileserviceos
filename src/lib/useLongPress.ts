import { useCallback, useRef } from 'react';

interface Options {
  /** Hold duration in ms before long-press fires. 450ms is the iOS default. */
  durationMs?: number;
  /** Pixel movement tolerance — if the finger moves more than this between
   *  start and end, treat it as a scroll/drag, not a long-press. */
  moveTolerancePx?: number;
}

interface PressBindings {
  onTouchStart: (e: { touches?: { clientX: number; clientY: number }[] }) => void;
  onTouchEnd: () => void;
  onTouchMove: (e: { touches?: { clientX: number; clientY: number }[] }) => void;
  onTouchCancel: () => void;
  onMouseDown: (e: { clientX: number; clientY: number }) => void;
  onMouseUp: () => void;
  onMouseMove: (e: { clientX: number; clientY: number }) => void;
  onMouseLeave: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
}

interface UseLongPressResult {
  bind: PressBindings;
  /** Ref the consumer can check in their onClick to suppress the click-after-long-press. */
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
 * Why this and not a library:
 *   - Zero deps.
 *   - Works on touch + mouse + suppresses the browser context menu.
 *   - Movement tolerance prevents the "I was just scrolling" false fires.
 *   - Haptic vibration for gloved-hand confirmation.
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
  const firedRef = useRef(false);

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

  const bind: PressBindings = {
    onTouchStart: (e) => {
      const t = e.touches?.[0];
      if (t) start(t.clientX, t.clientY);
    },
    onTouchEnd: () => clear(),
    onTouchMove: (e) => {
      const t = e.touches?.[0];
      if (t) move(t.clientX, t.clientY);
    },
    onTouchCancel: () => clear(),
    onMouseDown: (e) => start(e.clientX, e.clientY),
    onMouseUp: () => clear(),
    onMouseMove: (e) => move(e.clientX, e.clientY),
    onMouseLeave: () => clear(),
    onContextMenu: (e) => {
      if (firedRef.current) e.preventDefault();
    },
  };

  return { bind, firedRef };
}
