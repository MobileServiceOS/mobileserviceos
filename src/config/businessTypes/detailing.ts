// src/config/businessTypes/detailing.ts
// ═══════════════════════════════════════════════════════════════════
//  Detailing vertical config — full slice as of Phase 2.3.
//
//  Service catalog: 8 packages + 7 add-ons (add-ons distinguished via
//  the `isAddOn: true` flag on BusinessTypeService). The AddJob UI
//  segregates packages (single-select Service chip-grid) from add-ons
//  (multi-select), driven entirely by `isAddOn`.
//
//  Pricing model: package_multiplier. Package basePrice gets
//  multiplied by vehicleSizeMultiplier; add-ons are flat-priced
//  (NO multiplier — intentional, e.g. ceramic spray costs the same
//  regardless of vehicle size).
//
//  Dashboard metrics: details_this_week, revenue_week, avg_ticket,
//  repeat_customer_pct (by customer phone), addons_pct (attach rate).
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from './types';
import type { Job } from '@/types';
import { r2 } from '@/lib/round';

// ─── Dashboard metric helpers (pure, sync) ─────────────────────────
function startOfWeekIso(): string {
  // Match mechanic.ts: America/New_York-style Sunday-start week
  // computed in local time. Same boundary as mechanic.
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  return start.toISOString().slice(0, 10);
}

function isThisWeek(job: Pick<Job, 'date'>): boolean {
  if (!job.date) return false;
  return job.date >= startOfWeekIso();
}

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
    defaultMinServiceCharge: 40,
  },

  services: [
    // ─── Packages (single-select on AddJob) ──────────────────────
    { id: 'Express Wash',          label: 'Express Wash',          defaultBasePrice: 40,  defaultMinProfit: 25,  enabledByDefault: true },
    { id: 'Full Wash & Wax',       label: 'Full Wash & Wax',       defaultBasePrice: 90,  defaultMinProfit: 55,  enabledByDefault: true },
    { id: 'Interior Detail',       label: 'Interior Detail',       defaultBasePrice: 120, defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Exterior Detail',       label: 'Exterior Detail',       defaultBasePrice: 130, defaultMinProfit: 75,  enabledByDefault: true },
    { id: 'Full Detail',           label: 'Full Detail',           defaultBasePrice: 220, defaultMinProfit: 130, enabledByDefault: true },
    { id: 'Premium Detail',        label: 'Premium Detail',        defaultBasePrice: 320, defaultMinProfit: 180, enabledByDefault: true },
    { id: 'Headlight Restoration', label: 'Headlight Restoration', defaultBasePrice: 80,  defaultMinProfit: 50,  enabledByDefault: true },
    { id: 'Engine Bay Detail',     label: 'Engine Bay Detail',     defaultBasePrice: 90,  defaultMinProfit: 60,  enabledByDefault: true },

    // ─── Add-ons (multi-select on AddJob; isAddOn segregates them) ─
    { id: 'Pet Hair Removal',      label: 'Pet Hair Removal',      defaultBasePrice: 30, defaultMinProfit: 25, enabledByDefault: true, isAddOn: true },
    { id: 'Odor Treatment',        label: 'Odor Treatment',        defaultBasePrice: 50, defaultMinProfit: 40, enabledByDefault: true, isAddOn: true },
    { id: 'Headliner Cleaning',    label: 'Headliner Cleaning',    defaultBasePrice: 40, defaultMinProfit: 30, enabledByDefault: true, isAddOn: true },
    { id: 'Stain Treatment',       label: 'Stain Treatment',       defaultBasePrice: 35, defaultMinProfit: 28, enabledByDefault: true, isAddOn: true },
    { id: 'Ceramic Spray Coating', label: 'Ceramic Spray Coating', defaultBasePrice: 60, defaultMinProfit: 45, enabledByDefault: true, isAddOn: true },
    { id: 'Tire Shine',            label: 'Tire Shine',            defaultBasePrice: 15, defaultMinProfit: 12, enabledByDefault: true, isAddOn: true },
    { id: 'Glass Treatment',       label: 'Glass Treatment',       defaultBasePrice: 25, defaultMinProfit: 20, enabledByDefault: true, isAddOn: true },
  ],
  jobFields: [],

  // Detailing inventory schema — covers the chemical / supply
  // categories operators actually stock. Phase 2.3 ships
  // catalog-only (no per-job consumption); per-package product
  // lists + dilution-ratio math are deferred to a future phase.
  inventoryFields: [
    { key: 'chemicalName',  label: 'Item Name',       type: 'text' },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      options: ['Chemicals', 'Towels', 'Pads', 'Sprayers', 'Brushes', 'Bottles', 'Other'],
    },
    { key: 'dilutionRatio', label: 'Dilution Ratio',  type: 'text' },
    { key: 'supplier',      label: 'Supplier',        type: 'text' },
    { key: 'unitCost',      label: 'Unit Cost',       type: 'number' },
  ],

  copy: {
    jobNounSingular: 'detail',
    jobNounPlural: 'details',
    emptyJobsHint: 'No jobs logged yet — quote a detail to get started.',
    inventoryLabel: 'Detailing Supplies',
    packageLabel: 'Package',
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

  dashboardMetrics: [
    {
      id: 'details_this_week',
      label: 'Details this week',
      format: 'number',
      compute: (jobs, _s) => jobs.filter(isThisWeek).length,
    },
    {
      id: 'revenue_week',
      label: 'Revenue (week)',
      format: 'currency',
      compute: (jobs, _s) => r2(
        jobs.filter(isThisWeek).reduce((sum, j) => sum + Number(j.revenue || 0), 0),
      ),
    },
    {
      id: 'avg_ticket',
      label: 'Avg ticket',
      format: 'currency',
      compute: (jobs, _s) => {
        const completed = jobs.filter(isThisWeek).filter((j) => j.status === 'Completed');
        if (completed.length === 0) return 0;
        return r2(
          completed.reduce((sum, j) => sum + Number(j.revenue || 0), 0) / completed.length,
        );
      },
    },
    {
      id: 'repeat_customer_pct',
      label: 'Repeat customers',
      format: 'percent',
      compute: (jobs, _s) => {
        const weekJobs = jobs.filter(isThisWeek);
        if (weekJobs.length === 0) return 0;
        const earlierPhones = new Set(
          jobs
            .filter((j) => !isThisWeek(j) && j.status === 'Completed' && j.customerPhone)
            .map((j) => j.customerPhone),
        );
        const repeats = weekJobs.filter(
          (j) => j.customerPhone && earlierPhones.has(j.customerPhone),
        ).length;
        return repeats / weekJobs.length;
      },
    },
    {
      id: 'addons_pct',
      label: 'Add-on attach rate',
      format: 'percent',
      compute: (jobs, _s) => {
        const completedThisWeek = jobs
          .filter(isThisWeek)
          .filter((j) => j.status === 'Completed');
        if (completedThisWeek.length === 0) return 0;
        const withAddOns = completedThisWeek.filter((j) => {
          const a = (j as Job & { detailingAddons?: ReadonlyArray<string> }).detailingAddons;
          return Array.isArray(a) && a.length > 0;
        }).length;
        return withAddOns / completedThisWeek.length;
      },
    },
  ],

  // Mobile car wash / detailing: highway intentionally omitted —
  // no one washes a car on the highway. Emergency/late-night/weekend
  // are all plausible (rush detail before resale, evening fleet job,
  // Saturday morning premium rate).
  conditions: [
    { key: 'emergency', label: '🚨 Emergency' },
    { key: 'lateNight', label: '🌙 Late Night' },
    { key: 'weekend',   label: '📅 Weekend' },
  ],
};
