// src/lib/verticals.ts
// ═══════════════════════════════════════════════════════════════════
//  DEPRECATED RE-EXPORT SHIM
//  ────────────────────────
//  As of Phase 2.1, the vertical configs live under
//  `src/config/businessTypes/`. This module re-exports the new
//  symbols under the old names so every existing
//  `import { … } from '@/lib/verticals'` keeps compiling with zero
//  edits. New code SHOULD import from
//  `@/config/businessTypes/registry` directly.
//
//  KEEP this shim for one full release cycle. Remove only after the
//  call-site rename pass (tracked separately, not a Phase 2.1 task).
// ═══════════════════════════════════════════════════════════════════

import {
  BUSINESS_TYPE_REGISTRY,
  getBusinessTypeConfig,
} from '@/config/businessTypes/registry';
import type {
  BusinessTypeConfig,
  BusinessTypeKey,
  BusinessTypeService,
  BusinessTypeJobField,
  BusinessTypeInventoryField,
  BusinessTypeCopy,
  PricingModel,
  FlatPricingModel,
} from '@/config/businessTypes/types';

// ─── Back-compat type aliases ──────────────────────────────────────
// Old names map to new ones. Every existing call site keeps working
// without an edit.

/** @deprecated use BusinessTypeKey from '@/config/businessTypes/registry' */
export type VerticalKey = BusinessTypeKey;

/** @deprecated use BusinessTypeConfig from '@/config/businessTypes/registry' */
export type VerticalConfig = BusinessTypeConfig;

/** @deprecated use BusinessTypeService from '@/config/businessTypes/registry' */
export type VerticalService = BusinessTypeService;

/** @deprecated use BusinessTypeJobField from '@/config/businessTypes/registry' */
export type VerticalJobField = BusinessTypeJobField;

/** @deprecated use BusinessTypeInventoryField from '@/config/businessTypes/registry' */
export type VerticalInventoryField = BusinessTypeInventoryField;

/** @deprecated use BusinessTypeCopy from '@/config/businessTypes/registry' */
export type VerticalCopy = BusinessTypeCopy;

/** @deprecated use PricingModel from '@/config/businessTypes/registry' */
export type { PricingModel, FlatPricingModel };

// ─── Back-compat constants / functions ─────────────────────────────

/** @deprecated import { TIRE_CONFIG } from '@/config/businessTypes/tire' */
export { TIRE_CONFIG as TIRE_VERTICAL } from '@/config/businessTypes/tire';


/** @deprecated import { BUSINESS_TYPE_REGISTRY } from '@/config/businessTypes/registry' */
export const VERTICAL_REGISTRY: Partial<Record<BusinessTypeKey, BusinessTypeConfig>> =
  BUSINESS_TYPE_REGISTRY;

/** @deprecated use DEFAULT_BUSINESS_TYPE_KEY from '@/config/businessTypes/registry' */
export const DEFAULT_VERTICAL_KEY: BusinessTypeKey = 'tire';

/** @deprecated use getBusinessTypeConfig from '@/config/businessTypes/registry' */
export function getVerticalConfig(
  key: BusinessTypeKey | null | undefined,
): BusinessTypeConfig {
  return getBusinessTypeConfig(key);
}

// ─── servicePricingFromVertical: preserved for createBusiness.ts ───
// Already used by Phase 1 (createBusiness step 2). Kept here so the
// import path stays stable. Future move target: a new shape-conversion
// module under @/config/businessTypes/ — not in 2.1.

/** Build a servicePricing map from a vertical's service catalog. */
export function servicePricingFromVertical(
  config: BusinessTypeConfig,
): Record<string, { enabled: boolean; basePrice: number; minProfit: number }> {
  const out: Record<string, { enabled: boolean; basePrice: number; minProfit: number }> = {};
  for (const svc of config.services) {
    out[svc.id] = {
      enabled: svc.enabledByDefault,
      basePrice: svc.defaultBasePrice,
      minProfit: svc.defaultMinProfit,
    };
  }
  return out;
}
