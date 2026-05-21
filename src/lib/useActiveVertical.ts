// ═══════════════════════════════════════════════════════════════════
//  src/lib/useActiveVertical.ts — Vertical read layer (STAGE 3b-1)
// ═══════════════════════════════════════════════════════════════════
//
//  WHAT THIS IS
//  ────────────
//  The single entry point the UI uses to ask "what vertical is the
//  business I'm currently in, and what is its config?". It bridges
//  BrandContext (which holds the active business's settings/main
//  doc as `brand`) to the VerticalConfig defined in verticals.ts.
//
//  STAGE 3b-1 SCOPE — DORMANT
//  ──────────────────────────
//  This file is PURELY ADDITIVE and currently DORMANT. Nothing in
//  the live render path imports it yet. Stage 3b-2 will be the first
//  consumer (the job service catalog). Shipping it alone changes no
//  behavior — the tire app cannot be affected because nothing reads
//  this hook. Removing the file is the 3b-1 rollback.
//
//  BACK-COMPAT
//  ───────────
//  resolveVerticalKey() (verticalContext.ts) treats an absent or
//  unknown businessType as 'tire'. Every business that existed
//  before the multi-vertical work has no businessType, so all of
//  them resolve to the tire vertical with zero migration. A tire
//  business and a brand-new pre-3a business behave identically.
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { useBrand } from '@/context/BrandContext';
import { type VerticalKey, type VerticalConfig } from '@/lib/verticals';
// Pure resolvers live in verticalContext.ts so non-React code (tests,
// off-context helpers) can import them without dragging the React /
// Firebase tree. We re-export here for back-compat with prior import
// sites that read `verticalFromBusinessType` and `verticalFromSettings`
// from this module.
export {
  verticalFromBusinessType,
  verticalFromSettings,
} from '@/lib/verticalContext';
import { verticalFromBusinessType } from '@/lib/verticalContext';

/**
 * React hook: the VerticalConfig for the business currently active
 * in BrandContext.
 *
 * This is the primary entry point for Stage 3b-2 onwards. The UI
 * reads `services`, `jobFields`, `inventoryFields`, `copy`,
 * `pricingModel`, and `defaultExpenseCategories` from the returned
 * config instead of hardcoding tire assumptions.
 *
 * Memoized on the resolved businessType so it only recomputes when
 * the active business actually changes.
 */
export function useActiveVertical(): VerticalConfig {
  const { brand } = useBrand();
  // `brand` is the active business's settings/main doc; businessType
  // lives on it. Switching businesses replaces `brand`, so this
  // re-resolves automatically.
  const businessType = brand?.businessType;
  return useMemo(
    () => verticalFromBusinessType(businessType),
    [businessType],
  );
}

/**
 * React hook: just the active VerticalKey ('tire' | 'mechanic' |
 * 'carwash'). Convenience for call sites that only need to branch
 * on the vertical, not read the whole config.
 */
export function useActiveVerticalKey(): VerticalKey {
  return useActiveVertical().key;
}
