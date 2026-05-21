// src/config/businessTypes/mechanic.ts
// ═══════════════════════════════════════════════════════════════════
//  Mechanic vertical config — verbatim port of MECHANIC_VERTICAL
//  from the dormant src/lib/verticals.ts. Service catalog and field
//  schemas come over unchanged. New in 2.1: features flags,
//  invoiceTemplateKey, and dashboardMetrics tailored to mechanic work
//  (revenue, average ticket, labor hours billed this week).
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from './types';
import type { Job, Settings } from '@/types';
import { r2 } from '@/lib/round';

function isThisWeek(job: Pick<Job, 'date'>): boolean {
  if (!job.date) return false;
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day)
    .toISOString().slice(0, 10);
  return job.date >= start;
}

function revenueOf(job: Pick<Job, 'revenue'>): number {
  return Number(job.revenue || 0);
}

export const MECHANIC_CONFIG: BusinessTypeConfig = {
  key: 'mechanic',
  displayName: 'Mobile Mechanic',
  shortName: 'Mechanic',

  pricingModel: {
    kind: 'labor_parts',
    defaultLaborRate: 110,
    defaultPartsMarkupPct: 25,
    defaultDiagnosticFee: 90,
    defaultMinServiceCharge: 95,
  },

  // ─── services: actual mechanic services only ─────────────────────
  // The Phase 2.1 seed list mixed services with condition surcharges
  // (Emergency Service, Same-Day Service, After Hours, Highway Call,
  // Travel Fee). Those overlap with the AddJob "Conditions" multi-
  // select chips (job.emergency / lateNight / highway / weekend) and
  // forced the operator to pick one or the other when both apply
  // (e.g. "highway battery replacement"). They are kept out of the
  // service catalog here — the Conditions chips on AddJob cover the
  // same intent and stack correctly with whatever real service the
  // tech is doing. Travel Fee is also dropped because the engine
  // already adds travel cost from miles × costPerMile.
  //
  // Operators with existing mechanic jobs whose `service` field was
  // one of the removed values still render correctly (job.service is
  // a free string; only the chip-grid highlight is config-driven).
  services: [
    { id: 'Diagnostics',                  label: 'Diagnostics',                  defaultBasePrice: 90,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Check Engine Light Diagnosis', label: 'Check Engine Light Diagnosis', defaultBasePrice: 100, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Oil Change',                   label: 'Oil Change',                   defaultBasePrice: 90,  defaultMinProfit: 45,  enabledByDefault: true },
    { id: 'Battery Replacement',          label: 'Battery Replacement',          defaultBasePrice: 120, defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Brake Pads & Rotors',          label: 'Brake Pads & Rotors',          defaultBasePrice: 280, defaultMinProfit: 130, enabledByDefault: true },
    { id: 'Alternator Replacement',       label: 'Alternator Replacement',       defaultBasePrice: 320, defaultMinProfit: 140, enabledByDefault: true },
    { id: 'Starter Replacement',          label: 'Starter Replacement',          defaultBasePrice: 300, defaultMinProfit: 135, enabledByDefault: true },
    { id: 'Spark Plug Replacement',       label: 'Spark Plug Replacement',       defaultBasePrice: 160, defaultMinProfit: 85,  enabledByDefault: true },
    { id: 'Belt Replacement',             label: 'Belt Replacement',             defaultBasePrice: 150, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Serpentine Belt',              label: 'Serpentine Belt',              defaultBasePrice: 150, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Hose Replacement',             label: 'Hose Replacement',             defaultBasePrice: 130, defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Radiator Replacement',         label: 'Radiator Replacement',         defaultBasePrice: 360, defaultMinProfit: 150, enabledByDefault: true },
    { id: 'Thermostat Replacement',       label: 'Thermostat Replacement',       defaultBasePrice: 180, defaultMinProfit: 90,  enabledByDefault: true },
    { id: 'Suspension Work',              label: 'Suspension Work',              defaultBasePrice: 350, defaultMinProfit: 150, enabledByDefault: true },
    { id: 'Pre-Purchase Inspection',      label: 'Pre-Purchase Inspection',      defaultBasePrice: 130, defaultMinProfit: 100, enabledByDefault: true },
    { id: 'Mobile Tune-Up',               label: 'Mobile Tune-Up',               defaultBasePrice: 200, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Fluid Services',               label: 'Fluid Services',               defaultBasePrice: 110, defaultMinProfit: 55,  enabledByDefault: true },
    { id: 'Fuel Pump Replacement',        label: 'Fuel Pump Replacement',        defaultBasePrice: 400, defaultMinProfit: 170, enabledByDefault: true },
    { id: 'Ignition Coil Replacement',    label: 'Ignition Coil Replacement',    defaultBasePrice: 190, defaultMinProfit: 95,  enabledByDefault: true },
    { id: 'General Repair',               label: 'General Repair',               defaultBasePrice: 120, defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Parts Pickup',                 label: 'Parts Pickup',                 defaultBasePrice: 45,  defaultMinProfit: 40,  enabledByDefault: true },
    { id: 'Fleet Service',                label: 'Fleet Service',                defaultBasePrice: 250, defaultMinProfit: 180, enabledByDefault: false },
  ],

  jobFields: [
    { key: 'laborHours',       label: 'Labor Hours',          type: 'number', required: false },
    { key: 'diagnosticCode',   label: 'Diagnostic Code',      type: 'text',   required: false },
    { key: 'diagnosticFee',    label: 'Diagnostic Fee ($)',   type: 'number', required: false },
    { key: 'vehicleMakeModel', label: 'Vehicle Make / Model', type: 'text',   required: false },
    { key: 'mileage',          label: 'Vehicle Mileage',      type: 'number', required: false },
  ],

  inventoryFields: [
    { key: 'partName',          label: 'Part Name',           type: 'text' },
    { key: 'partNumber',        label: 'Part Number',         type: 'text' },
    { key: 'brand',             label: 'Brand',               type: 'text' },
    { key: 'supplier',          label: 'Supplier',            type: 'text' },
    { key: 'category',          label: 'Category',            type: 'select', options: [
      'Engine', 'Brakes', 'Suspension', 'Electrical', 'Cooling System',
      'Tires/Wheels', 'Fluids', 'Filters', 'Diagnostics', 'HVAC',
    ] },
    { key: 'subcategory',       label: 'Subcategory',         type: 'text' },
    { key: 'qty',               label: 'Quantity',            type: 'number' },
    { key: 'unitCost',          label: 'Unit Cost ($)',       type: 'number' },
    { key: 'retailPrice',       label: 'Retail Price ($)',    type: 'number' },
    { key: 'condition',         label: 'Condition',           type: 'select', options: ['New', 'Used', 'Refurbished', 'Remanufactured'] },
    { key: 'laborHoursDefault', label: 'Default Labor Hours', type: 'number' },
    { key: 'warrantyDays',      label: 'Warranty Days',       type: 'number' },
    { key: 'locationBin',       label: 'Location / Bin',      type: 'text' },
    { key: 'compatibleVehicles',label: 'Compatible Vehicles', type: 'text' },
    { key: 'notes',             label: 'Notes',               type: 'text' },
  ],

  copy: {
    jobNounSingular: 'repair job',
    jobNounPlural: 'repair jobs',
    emptyJobsHint: 'No jobs logged yet — quote a repair to get started.',
    inventoryLabel: 'Parts Inventory',
  },

  defaultExpenseCategories: ['Parts', 'Labor', 'Tools & Equipment', 'Vehicle', 'Insurance', 'Misc'],

  features: {
    inventoryDeduction: false,
    photoCapture: false,
    vehicleDiagnostics: true,
    vehicleSizeMultiplier: false,
    roadsideAddons: false,
  },

  invoiceTemplateKey: 'mechanic',

  // Mechanic-specific dashboard KPIs. Each metric is a pure
  // (jobs, settings) → number computation; the Dashboard renders one
  // card per spec via vertical.dashboardMetrics.map(...).
  //
  // Engine constants (labor rate, markup pct) are read inline rather
  // than via the pricingModel block to avoid a self-reference in the
  // config object literal. They mirror MECHANIC_CONFIG.pricingModel
  // exactly; the duplication is intentional and small.
  dashboardMetrics: [
    {
      id: 'labor_revenue_week',
      label: 'Labor revenue (week)',
      format: 'currency',
      compute: (jobs, s) => {
        const rate = Number(s.laborRate || 95);
        return r2(jobs.filter(isThisWeek).reduce(
          (sum, j) => sum + Number((j as Job & { laborHours?: number }).laborHours || 0) * rate,
          0,
        ));
      },
    },
    {
      id: 'parts_revenue_week',
      label: 'Parts revenue (week)',
      format: 'currency',
      compute: (jobs, _s) => {
        // Phase 2.2: `partsCost` is the customer-charged total (derived
        // from parts[] on new writes; legacy flat number on old jobs).
        // No additional markup applied here — invoice already reflects
        // retail prices.
        return r2(jobs.filter(isThisWeek).reduce(
          (sum, j) => sum + Number((j as Job & { partsCost?: number }).partsCost || 0),
          0,
        ));
      },
    },
    {
      id: 'avg_repair_order',
      label: 'Avg repair order',
      format: 'currency',
      compute: (jobs, _s) => {
        const completed = jobs.filter((j) => j.status === 'Completed');
        if (completed.length === 0) return 0;
        return r2(completed.reduce((sum, j) => sum + revenueOf(j), 0) / completed.length);
      },
    },
    {
      id: 'diagnostics_count_week',
      label: 'Diagnostics this week',
      format: 'number',
      compute: (jobs, _s) =>
        jobs.filter(isThisWeek).filter((j) => /diagnostic|check engine/i.test(j.service || '')).length,
    },
    {
      id: 'labor_hours_week',
      label: 'Labor hours billed (week)',
      format: 'number',
      compute: (jobs, _s) =>
        r2(jobs.filter(isThisWeek).reduce(
          (sum, j) => sum + Number((j as Job & { laborHours?: number }).laborHours || 0),
          0,
        )),
    },
    {
      id: 'parts_margin_pct',
      label: 'Parts margin',
      format: 'percent',
      compute: (jobs, _s) => {
        // Phase 2.2: read per-job partsMarginSnapshot (populated when
        // every part line has unitCost > 0). Jobs without a snapshot
        // are excluded — legacy or partially-cost-stamped jobs would
        // skew the number. Returns 0 when no eligible jobs in window.
        let totalMargin = 0;
        let totalRevenue = 0;
        for (const j of jobs.filter(isThisWeek)) {
          const snap = (j as Job).partsMarginSnapshot;
          if (snap && snap.revenue > 0) {
            totalMargin  += snap.margin;
            totalRevenue += snap.revenue;
          }
        }
        if (totalRevenue <= 0) return 0;
        return totalMargin / totalRevenue;
      },
    },
  ],

  lifecycle: {
    substages: [
      { id: 'mechanic.parts_on_order',    parentStage: 'waiting_parts', label: 'Parts on order',    technicianVisible: true, customerVisible: true },
      { id: 'mechanic.parts_back_order',  parentStage: 'waiting_parts', label: 'Parts back-order',  technicianVisible: true, customerVisible: true },
      { id: 'mechanic.diagnosis_pending', parentStage: 'in_progress',   label: 'Diagnosing',        technicianVisible: true, customerVisible: false },
    ],
  },

  // Mobile mechanic: all 4 conditions apply. Highway is a real case
  // (highway battery replacement, roadside diagnostic, etc.).
  conditions: [
    { key: 'emergency', label: '🚨 Emergency' },
    { key: 'lateNight', label: '🌙 Late Night' },
    { key: 'highway',   label: '🛣 Highway' },
    { key: 'weekend',   label: '📅 Weekend' },
  ],
};
