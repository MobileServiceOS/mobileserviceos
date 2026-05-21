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
import { r2 } from '@/lib/utils';

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

  // ─── services: VERBATIM from src/lib/verticals.ts:322-354 ────────
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
    { id: 'Emergency Service',            label: 'Emergency Service',            defaultBasePrice: 75,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Same-Day Service',             label: 'Same-Day Service',             defaultBasePrice: 50,  defaultMinProfit: 48,  enabledByDefault: true },
    { id: 'After Hours',                  label: 'After Hours',                  defaultBasePrice: 65,  defaultMinProfit: 62,  enabledByDefault: true },
    { id: 'Highway Call',                 label: 'Highway Call',                 defaultBasePrice: 80,  defaultMinProfit: 75,  enabledByDefault: true },
    { id: 'Parts Pickup',                 label: 'Parts Pickup',                 defaultBasePrice: 45,  defaultMinProfit: 40,  enabledByDefault: true },
    { id: 'Travel Fee',                   label: 'Travel Fee',                   defaultBasePrice: 40,  defaultMinProfit: 38,  enabledByDefault: true },
    { id: 'Fleet Service',                label: 'Fleet Service',                defaultBasePrice: 250, defaultMinProfit: 180, enabledByDefault: false },
  ],

  jobFields: [
    { key: 'laborHours',       label: 'Labor Hours',          type: 'number', required: false },
    { key: 'partsCost',        label: 'Parts Cost',           type: 'number', required: false },
    { key: 'diagnosticCode',   label: 'Diagnostic Code',      type: 'text',   required: false },
    { key: 'vehicleMakeModel', label: 'Vehicle Make / Model', type: 'text',   required: false },
    { key: 'mileage',          label: 'Vehicle Mileage',      type: 'number', required: false },
  ],

  inventoryFields: [
    { key: 'partNumber', label: 'Part Number', type: 'text' },
    { key: 'partName',   label: 'Part Name',   type: 'text' },
    { key: 'supplier',   label: 'Supplier',    type: 'text' },
    { key: 'unitCost',   label: 'Unit Cost',   type: 'number' },
    { key: 'quantity',   label: 'Quantity',    type: 'number' },
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

  dashboardMetrics: [
    {
      id: 'revenue_week',
      label: 'Revenue this week',
      format: 'currency',
      compute: (jobs, _s) =>
        r2(jobs.filter(isThisWeek).reduce((sum, j) => sum + revenueOf(j), 0)),
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
      id: 'avg_ticket',
      label: 'Average ticket',
      format: 'currency',
      compute: (jobs, _s) => {
        const completed = jobs.filter((j) => j.status === 'Completed');
        if (completed.length === 0) return 0;
        return r2(completed.reduce((sum, j) => sum + revenueOf(j), 0) / completed.length);
      },
    },
  ],
};
