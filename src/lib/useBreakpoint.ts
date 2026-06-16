import { useEffect, useState } from 'react';

// ───────────────────────────────────────────────────────────────────
//  useBreakpoint — mobile-first viewport class.
//
//  The responsive layout is CSS-driven (media queries in app.css); this
//  hook exposes the SAME breakpoints to JS so components can adapt when
//  CSS alone can't, and so the app root can stamp a `data-bp` attribute.
//  Mobile is the default/fallback (SSR, no matchMedia) — desktop never
//  wins by accident.
// ───────────────────────────────────────────────────────────────────

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

// Must match the breakpoints in app.css (.page scale-up).
export const BP_QUERIES = {
  tablet: '(min-width: 768px)',
  desktop: '(min-width: 1200px)',
} as const;

/** Pure resolver — given a matcher, returns the active breakpoint.
 *  Desktop wins over tablet wins over mobile. Exported for tests. */
export function resolveBreakpoint(matches: (query: string) => boolean): Breakpoint {
  if (matches(BP_QUERIES.desktop)) return 'desktop';
  if (matches(BP_QUERIES.tablet)) return 'tablet';
  return 'mobile';
}

function currentBreakpoint(): Breakpoint {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'mobile';
  return resolveBreakpoint((q) => window.matchMedia(q).matches);
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(currentBreakpoint);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mqls = [window.matchMedia(BP_QUERIES.tablet), window.matchMedia(BP_QUERIES.desktop)];
    const onChange = () => setBp(currentBreakpoint());
    mqls.forEach((m) => m.addEventListener('change', onChange));
    onChange(); // sync in case it changed between first render and effect
    return () => mqls.forEach((m) => m.removeEventListener('change', onChange));
  }, []);

  return bp;
}
