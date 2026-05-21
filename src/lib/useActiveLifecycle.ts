// src/lib/useActiveLifecycle.ts
// ═══════════════════════════════════════════════════════════════════
//  React hook returning the resolved job lifecycle for the active
//  business. Parallel to useActiveVertical() — same shape, same
//  memoization pattern. UI consumers call this; the active business
//  type is resolved via useActiveVertical() under the hood.
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { resolveLifecycle } from '@/config/jobs';
import type { ResolvedLifecycle } from '@/config/jobs';

/**
 * Resolves the active business's effective lifecycle (universal
 * stages + per-vertical extensions). Memoized on the vertical
 * reference so re-renders that don't change the active business
 * don't recompute the merger.
 */
export function useActiveLifecycle(): ResolvedLifecycle {
  const vertical = useActiveVertical();
  return useMemo(() => resolveLifecycle(vertical), [vertical]);
}
