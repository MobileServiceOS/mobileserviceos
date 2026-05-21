// src/config/businessTypes/tire.ts
// ═══════════════════════════════════════════════════════════════════
//  Tire vertical config — verbatim port of TIRE_VERTICAL from the
//  dormant src/lib/verticals.ts. Every service id, base price, min
//  profit, job field, inventory field, and copy string is copied
//  exactly so existing tire accounts render byte-for-byte identically
//  after Phase 2.1 wires this config into the runtime.
//
//  features.* values mirror today's tire-only assumptions
//  (inventoryDeduction true, roadsideAddons true, everything else
//  false). dashboardMetrics mirrors today's Dashboard cards.
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from './types';
import type { Job, Settings } from '@/types';
import { r2 } from '@/lib/utils';

// ─── Dashboard metric helpers (pure, sync) ─────────────────────────
// These compute today's Dashboard card values. Moving them onto the
// config is a code-organization change only — every value matches
// what Dashboard.tsx renders today.

function startOfWeekIso(): string {
  // Match the existing Dashboard week boundary: America/New_York,
  // week starts Sunday. The implementation in Dashboard.tsx uses
  // the same TODAY() helper from defaults.ts; we redo it inline so
  // tire.ts has no implicit dependency on a tire-specific util.
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  return start.toISOString().slice(0, 10);
}

function isThisWeek(job: Pick<Job, 'date'>): boolean {
  if (!job.date) return false;
  return job.date >= startOfWeekIso();
}

function revenueOf(job: Pick<Job, 'revenue'>): number {
  return Number(job.revenue || 0);
}

function profitOf(job: Job, s: Settings): number {
  const revenue = revenueOf(job);
  const tireCost = Number(job.tireCost || 0);
  const materialCost = Number(job.materialCost || job.miscCost || 0);
  const miles = Number(job.miles || 0);
  const freeMiles = Number(s.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(s.costPerMile || 0.65));
  return r2(revenue - tireCost - materialCost - travelCost);
}

export const TIRE_CONFIG: BusinessTypeConfig = {
  key: 'tire',
  displayName: 'Mobile Tire & Roadside',
  shortName: 'Tire & Roadside',
  pricingModel: { kind: 'flat' },

  // ─── services: VERBATIM from src/lib/verticals.ts:233-249 ────────
  services: [
    { id: 'Flat Tire Repair',         label: 'Flat Tire Repair',         defaultBasePrice: 90,  defaultMinProfit: 90,  enabledByDefault: true },
    { id: 'Tire Replacement',         label: 'Tire Replacement',         defaultBasePrice: 120, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Tire Installation',        label: 'Tire Installation',        defaultBasePrice: 120, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Mounting & Balancing',     label: 'Mounting & Balancing',     defaultBasePrice: 100, defaultMinProfit: 80,  enabledByDefault: true },
    { id: 'Spare Tire Installation',  label: 'Spare Tire Installation',  defaultBasePrice: 95,  defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Spare Change',             label: 'Spare Change',             defaultBasePrice: 85,  defaultMinProfit: 65,  enabledByDefault: true },
    { id: 'Tire Rotation',            label: 'Tire Rotation',            defaultBasePrice: 80,  defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Wheel Lock Removal',       label: 'Wheel Lock Removal',       defaultBasePrice: 85,  defaultMinProfit: 65,  enabledByDefault: true },
    { id: 'Roadside Tire Assistance', label: 'Roadside Tire Assistance', defaultBasePrice: 100, defaultMinProfit: 70,  enabledByDefault: true },
    { id: 'Mobile Tire Service',      label: 'Mobile Tire Service',      defaultBasePrice: 150, defaultMinProfit: 110, enabledByDefault: true },
    { id: 'Jump Start',               label: 'Jump Start',               defaultBasePrice: 75,  defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Fuel Delivery',            label: 'Fuel Delivery',            defaultBasePrice: 85,  defaultMinProfit: 65,  enabledByDefault: true },
    { id: 'Lockout',                  label: 'Lockout',                  defaultBasePrice: 75,  defaultMinProfit: 60,  enabledByDefault: true },
    { id: 'Fleet Tire Service',       label: 'Fleet Tire Service',       defaultBasePrice: 200, defaultMinProfit: 160, enabledByDefault: false },
    { id: 'Heavy-Duty Tire Service',  label: 'Heavy-Duty Tire Service',  defaultBasePrice: 350, defaultMinProfit: 280, enabledByDefault: false },
  ],

  jobFields: [
    { key: 'tireSize',         label: 'Tire Size',         type: 'text',    required: false },
    { key: 'tireCondition',    label: 'Tire Condition',    type: 'select',  required: false, options: ['new', 'used', 'damaged'] },
    { key: 'wheelLockRemoved', label: 'Wheel Lock Removed', type: 'boolean', required: false },
  ],

  inventoryFields: [
    { key: 'tireSize',  label: 'Tire Size',     type: 'text' },
    { key: 'rimSize',   label: 'Rim Size (in)', type: 'number' },
    { key: 'brand',     label: 'Brand',         type: 'text' },
    { key: 'condition', label: 'Condition',     type: 'select', options: ['new', 'used', 'damaged'] },
  ],

  copy: {
    jobNounSingular: 'tire job',
    jobNounPlural: 'tire jobs',
    emptyJobsHint: 'No jobs logged yet — quote a tire repair to get started.',
    inventoryLabel: 'Tire Inventory',
  },

  defaultExpenseCategories: ['Tire Cost', 'Labor', 'Equipment', 'Vehicle', 'Insurance', 'Misc'],

  // ─── NEW in 2.1 ──────────────────────────────────────────────────

  features: {
    inventoryDeduction: true,
    photoCapture: false,
    vehicleDiagnostics: false,
    vehicleSizeMultiplier: false,
    roadsideAddons: true,
  },

  invoiceTemplateKey: 'tire',

  dashboardMetrics: [
    {
      id: 'revenue_week',
      label: 'Revenue this week',
      format: 'currency',
      compute: (jobs, _settings) =>
        r2(jobs.filter(isThisWeek).reduce((sum, j) => sum + revenueOf(j), 0)),
    },
    {
      id: 'profit_week',
      label: 'Profit this week',
      format: 'currency',
      compute: (jobs, settings) =>
        r2(jobs.filter(isThisWeek).reduce((sum, j) => sum + profitOf(j, settings), 0)),
    },
    {
      id: 'avg_ticket',
      label: 'Average ticket',
      format: 'currency',
      compute: (jobs, _settings) => {
        const completed = jobs.filter((j) => j.status === 'Completed');
        if (completed.length === 0) return 0;
        const total = completed.reduce((sum, j) => sum + revenueOf(j), 0);
        return r2(total / completed.length);
      },
    },
  ],
};
