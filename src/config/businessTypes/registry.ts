// src/config/businessTypes/registry.ts
// ═══════════════════════════════════════════════════════════════════
//  Business-type registry — strongly-typed lookup by key. No dynamic
//  plugin loading (per Phase 2.1 architectural directive: "Favor
//  strongly typed registries over dynamic runtime injection").
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig, BusinessTypeKey } from './types';
import { TIRE_CONFIG } from './tire';
import { MECHANIC_CONFIG } from './mechanic';
import { DETAILING_CONFIG } from './detailing';

export const BUSINESS_TYPE_REGISTRY: Readonly<Record<BusinessTypeKey, BusinessTypeConfig>> = {
  tire: TIRE_CONFIG,
  mechanic: MECHANIC_CONFIG,
  detailing: DETAILING_CONFIG,
};

/**
 * Resolve a BusinessTypeConfig for the given key. Unknown / null /
 * undefined keys safely degrade to TIRE_CONFIG — every existing
 * tire business (whose settings doc has no `businessType` field)
 * resolves correctly through this path.
 */
export function getBusinessTypeConfig(
  key: BusinessTypeKey | null | undefined,
): BusinessTypeConfig {
  if (key && BUSINESS_TYPE_REGISTRY[key]) {
    return BUSINESS_TYPE_REGISTRY[key];
  }
  return TIRE_CONFIG;
}

/**
 * Top-level feature lookup. UI gates that depend on a feature call
 * this rather than checking `config.features.<x>` directly so we
 * have one chokepoint for cross-cutting toggles.
 */
export function hasFeature(
  key: BusinessTypeKey | null | undefined,
  feature: keyof BusinessTypeConfig['features'],
): boolean {
  return getBusinessTypeConfig(key).features[feature];
}

// Re-export types so callers can `import { … } from '@/config/businessTypes/registry'`
// and get everything they need without importing types.ts separately.
export type {
  BusinessTypeConfig,
  BusinessTypeKey,
  BusinessTypeService,
  BusinessTypeJobField,
  BusinessTypeInventoryField,
  BusinessTypeCopy,
  BusinessTypeFeatures,
  DashboardMetricSpec,
  PricingModel,
  FlatPricingModel,
  LaborPartsPricingModel,
  PackageMultiplierPricingModel,
} from './types';

export { DEFAULT_BUSINESS_TYPE_KEY } from './types';
