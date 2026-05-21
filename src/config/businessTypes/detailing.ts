// src/config/businessTypes/detailing.ts
// ═══════════════════════════════════════════════════════════════════
//  Detailing vertical config — SKELETON for Phase 2.1.
//
//  Phase 2.1 ships the registry slot + pricing-model declaration so
//  the union type stays exhaustive and a "Add Business → Detailing"
//  attempt (if exposed to the UI later) can resolve a valid config.
//
//  Service catalog, job fields, inventory fields, real
//  vehicleSizeMultipliers, and a populated dashboardMetrics array
//  are deferred to Phase 2.3 (Detailing full slice). Until then this
//  config renders an empty service picker and an empty dashboard —
//  acceptable because the AddBusinessModal does NOT currently expose
//  Detailing as a selectable business type. The slot exists for
//  forward compatibility.
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from './types';

export const DETAILING_CONFIG: BusinessTypeConfig = {
  key: 'detailing',
  displayName: 'Mobile Car Wash & Detailing',
  shortName: 'Detailing',

  pricingModel: {
    kind: 'package_multiplier',
    vehicleSizeMultipliers: {
      Sedan: 1.0,
      SUV: 1.25,
      Truck: 1.3,
      'XL SUV': 1.5,
      Van: 1.4,
    },
  },

  services: [],
  jobFields: [],
  inventoryFields: [],

  copy: {
    jobNounSingular: 'detail',
    jobNounPlural: 'details',
    emptyJobsHint: 'No jobs logged yet — quote a detail to get started.',
    inventoryLabel: 'Detailing Supplies',
  },

  defaultExpenseCategories: ['Chemicals', 'Supplies', 'Equipment', 'Vehicle', 'Insurance', 'Misc'],

  features: {
    inventoryDeduction: false,
    photoCapture: true,
    vehicleDiagnostics: false,
    vehicleSizeMultiplier: true,
    roadsideAddons: false,
  },

  invoiceTemplateKey: 'detailing',

  dashboardMetrics: [],
};
