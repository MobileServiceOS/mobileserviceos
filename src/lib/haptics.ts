// ─────────────────────────────────────────────────────────────────────
//  Haptic feedback — thin abstraction over navigator.vibrate.
//
//  Per the field-service spec: lightweight tactile responses on key
//  interactions (Use This Price, Mark Paid, Toggle status, errors,
//  long-press). Browser Vibration API is what we have without
//  Capacitor; iOS Safari ignores vibrate calls but the pattern is
//  already idiomatic web haptics. When the app is later wrapped in
//  Capacitor, this module is the single swap point — the named
//  functions stay the same and only the implementation changes.
//
//  Patterns are conservative — no long sustained buzzes. Operators
//  using the app one-handed in a noisy roadside environment should
//  feel a confirmation but not a vibration that drowns out
//  in-pocket alerts.
//
//  All functions wrap in try/catch and return void. Calling them
//  on a browser without Vibration support, or with the page
//  hidden, silently no-ops.
// ─────────────────────────────────────────────────────────────────────

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate !== 'function') return;
    // Some browsers reject vibrate when the page isn't visible.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    nav.vibrate(pattern);
  } catch {
    /* ignored */
  }
}

/** Subtle tap — used for casual UI feedback (toggle on/off, chip
 *  selection, expand-card). 8ms is below most users' conscious
 *  threshold but registers as a tactile tick. */
export function hapticLight(): void { vibrate(8); }

/** Medium tap — used for confirmation actions that complete a
 *  step (Use This Price, Mark Paid, Save Note). */
export function hapticMedium(): void { vibrate(18); }

/** Stronger tap — used for high-stakes confirmation (job
 *  completed, invoice generated, signature captured). */
export function hapticHeavy(): void { vibrate(30); }

/** Two short pulses — successful save / submit pattern. */
export function hapticSuccess(): void { vibrate([18, 40, 18]); }

/** Sharp, slightly longer single pulse — error / validation
 *  failure. Distinct from success so muscle memory learns the
 *  difference without looking at the screen. */
export function hapticError(): void { vibrate([45, 60, 45]); }

/** Soft double-tap — warning (low stock, payment pending, etc.). */
export function hapticWarning(): void { vibrate([12, 30, 12]); }

/** Long-press detection start — slightly longer than hapticLight
 *  so the operator knows the hold registered. Matches the existing
 *  20ms used by useLongPress before this module. */
export function hapticLongPressStart(): void { vibrate(20); }
