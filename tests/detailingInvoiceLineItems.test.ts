// tests/detailingInvoiceLineItems.test.ts
// Run: npx tsx tests/detailingInvoiceLineItems.test.ts

import { DETAILING_INVOICE_TEMPLATE } from '@/config/businessTypes/invoice/detailing';
import type { Job } from '@/types';
import type { PricingBreakdownTagged } from '@/config/businessTypes/pricing';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Full Detail', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 325, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

const mkBreakdown = (over: Partial<{
  packageCost: number;
  addOnIds: ReadonlyArray<string>;
  addOnPrices: ReadonlyArray<number>;
  travelCost: number;
  travelChargeable: number;
  vehicleSize: string;
  vehicleSizeMultiplier: number;
}> = {}): PricingBreakdownTagged => ({
  model: 'package_multiplier',
  revenue: 325,
  vehicleSize: 'SUV',
  vehicleSizeMultiplier: 1.25,
  packageCost: 275,
  addOnsCost: 45,
  addOnIds: ['Pet Hair Removal', 'Tire Shine'],
  addOnPrices: [30, 15],
  travelCost: 5.20,
  travelMiles: 8,
  travelChargeable: 8,
  freeMilesIncluded: 0,
  directCost: 325.20,
  profit: 0,
  profitMargin: 0,
  quantity: 1,
  belowMinServiceCharge: false,
  minServiceCharge: 40,
  ...over,
} as PricingBreakdownTagged);

console.log('\n┌─ DETAILING_INVOICE_TEMPLATE.buildLineItems ───────');

// Full mix: package + 2 add-ons + travel
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(baseJob(), mkBreakdown(), 'Full Detail');
  check('full mix: 4 lines', lines.length === 4);
  check('first line is package with SUV 1.25× annotation',
    lines[0].description.includes('Full Detail') && lines[0].description.includes('1.25'));
  check('package amount = 275', lines[0].amount === 275);
  check('second line: Pet Hair Removal $30',
    lines[1].description === 'Pet Hair Removal' && lines[1].amount === 30);
  check('third line: Tire Shine $15',
    lines[2].description === 'Tire Shine' && lines[2].amount === 15);
  check('fourth line: Travel with mi count',
    lines[3].description.includes('8 mi') && lines[3].amount === 5.2);
}

// No add-ons
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ addOnIds: [], addOnPrices: [] }),
    'Full Detail',
  );
  check('empty add-ons: 2 lines (package + travel)', lines.length === 2);
}

// No travel
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ travelCost: 0, travelChargeable: 0 }),
    'Full Detail',
  );
  const hasTravel = lines.some((l) => l.description.toLowerCase().includes('travel'));
  check('zero travel: no travel line', !hasTravel);
}

// Sedan (1.0×) — no multiplier suffix
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ vehicleSize: 'Sedan', vehicleSizeMultiplier: 1, packageCost: 220 }),
    'Full Detail',
  );
  check('Sedan: description has "Sedan" but NO multiplier suffix',
    lines[0].description.includes('Sedan') && !lines[0].description.includes('×'));
}

// XL SUV (1.5×)
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({ vehicleSize: 'XL SUV', vehicleSizeMultiplier: 1.5, packageCost: 330 }),
    'Full Detail',
  );
  check('XL SUV: description shows 1.5×',
    lines[0].description.includes('XL SUV') && lines[0].description.includes('1.5'));
}

// Zero-priced add-on skipped (graceful)
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob(),
    mkBreakdown({
      addOnIds: ['Pet Hair Removal', 'Unknown'],
      addOnPrices: [30, 0],
    }),
    'Full Detail',
  );
  // packageCost 275 + 1 add-on (30) + travel = 3 lines (unknown 0-priced skipped)
  check('zero-priced add-on skipped', lines.length === 3);
}

// Zero packageCost AND no add-ons AND no travel → empty
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob({ service: 'Unknown' }),
    mkBreakdown({ packageCost: 0, addOnIds: [], addOnPrices: [], travelCost: 0 }),
    'Unknown',
  );
  check('all-zero breakdown: 0 lines', lines.length === 0);
}

// Legacy fallback: non-package_multiplier breakdown
{
  const lines = DETAILING_INVOICE_TEMPLATE.buildLineItems(
    baseJob({ revenue: 200 }),
    { model: 'flat' } as PricingBreakdownTagged,
    'Legacy Detail',
  );
  check('legacy fallback: 1 line at job.revenue',
    lines.length === 1 && lines[0].amount === 200);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
