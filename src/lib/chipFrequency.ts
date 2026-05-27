// src/lib/chipFrequency.ts
// ═══════════════════════════════════════════════════════════════════
//  Chip frequency ranking — sort an option list by how often each
//  value has actually been used across the operator's job history.
//
//  Why: AddJob's chip grids (service / vehicle / lead source / etc.)
//  render every configured option in their declaration order. For an
//  operator who runs 90% flat-tire repairs, the "Flat Tire Repair"
//  chip might sit at position 3 or 4. Resorting by historical
//  frequency puts the chip the tech is about to tap at position 1.
//
//  Behavior:
//  - Options that appear in jobs sort first, by descending usage count.
//  - Options never used keep their original (config-declared) order
//    after the used-options block — so a stable, predictable tail.
//  - Empty / missing values on a job are ignored.
//  - Pure function: no React, no globals, no side effects.
//    Callers memoize at the page level on [options, jobs].
//
//  Not in scope:
//    - "More" expander UI (progressive disclosure for >N options).
//      This helper just resorts; UI rendering is the caller's job.
//    - Cross-vertical option mixing — the caller passes the already-
//      filtered option list for the active vertical.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';

/**
 * Sort `options` so the values used most often in `jobs[field]`
 * appear first. Never-used options retain their original order at
 * the tail.
 *
 * Returns a NEW array (does not mutate `options`).
 */
export function rankByUsage<T extends string>(
  options: ReadonlyArray<T>,
  jobs: ReadonlyArray<Job>,
  field: keyof Job,
): T[] {
  if (options.length === 0) return [];
  // Count occurrences. Restricted to known options so a free-text
  // job.source like "Door tag" doesn't bias unrelated lists.
  const allowed = new Set<string>(options);
  const counts = new Map<T, number>();
  for (const j of jobs) {
    const raw = (j as unknown as Record<string, unknown>)[field as string];
    if (typeof raw !== 'string' || !raw) continue;
    if (!allowed.has(raw)) continue;
    counts.set(raw as T, (counts.get(raw as T) || 0) + 1);
  }

  // Stable partition: used options sorted by count desc, then the
  // never-used tail in original declaration order. Array.sort with a
  // stable comparator preserves the original index for equal-count
  // ties, so we don't get jumpy chip orderings between renders when
  // two options have the same usage count.
  const indexed = options.map((opt, i) => ({ opt, i, count: counts.get(opt) || 0 }));
  indexed.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.i - b.i;
  });
  return indexed.map((x) => x.opt);
}
