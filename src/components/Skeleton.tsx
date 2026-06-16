import type { CSSProperties } from 'react';

// ───────────────────────────────────────────────────────────────────
//  Skeleton placeholders — shown while a screen or its data loads, so a
//  slow chunk/subscription reads as "loading" instead of a blank black
//  screen that looks broken. Pure presentational; respects
//  prefers-reduced-motion via the .skeleton CSS class (shimmer off).
// ───────────────────────────────────────────────────────────────────

export function Skeleton({ height = 16, width = '100%', radius = 8, style }: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className="skeleton" aria-hidden="true" style={{ height, width, borderRadius: radius, ...style }} />;
}

/** A card-shaped block of skeleton lines. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-pad" aria-hidden="true" style={{ marginBottom: 12 }}>
      <Skeleton height={14} width="40%" style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '70%' : '100%'} style={{ marginTop: 8 }} />
      ))}
    </div>
  );
}

/** Full-page loading placeholder — used as the lazy-route Suspense
 *  fallback (Insights / Jobs / etc.) so navigating to a not-yet-loaded
 *  screen shows structure, not a black void. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="page" role="status" aria-label="Loading">
      <Skeleton height={22} width="45%" style={{ marginBottom: 16 }} />
      {Array.from({ length: cards }).map((_, i) => <SkeletonCard key={i} />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
