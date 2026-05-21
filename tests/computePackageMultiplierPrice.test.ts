// tests/computePackageMultiplierPrice.test.ts
// Run: npx tsx tests/computePackageMultiplierPrice.test.ts

import { computePackageMultiplierPrice } from '@/config/businessTypes/pricing/packageMult';
import type { Job, Settings } from '@/types';
import type { PackageMultiplierPricingModel } from '@/config/businessTypes/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const model: PackageMultiplierPricingModel = {
  kind: 'package_multiplier',
  vehicleSizeMultipliers: { Sedan: 1.0, SUV: 1.25, Truck: 1.3, 'XL SUV': 1.5, Van: 1.4 },
  defaultMinServiceCharge: 40,
};

const settings: Settings = {
  costPerMile: 0.65,
  freeMilesIncluded: 5,
  servicePricing: {
    'Full Detail':       { basePrice: 220, minProfit: 130, enabled: true },
    'Pet Hair Removal':  { basePrice: 30,  minProfit: 25,  enabled: true },
    'Tire Shine':        { basePrice: 15,  minProfit: 12,  enabled: true },
  },
} as Settings;

const baseJob = (over: Partial<Job> & { vehicleSize?: string; detailingAddons?: ReadonlyArray<string> } = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Full Detail', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

console.log('\n┌─ computePackageMultiplierPrice ───────────────────');

{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: 'Sedan' }), settings, model);
  check('Sedan: packageCost = 220 × 1.0 = 220', b.packageCost === 220);
  check('Sedan: multiplier 1.0', b.vehicleSizeMultiplier === 1.0);
  check('Sedan: vehicleSize echoed', b.vehicleSize === 'Sedan');
}
{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: 'SUV' }), settings, model);
  check('SUV: packageCost = 220 × 1.25 = 275', b.packageCost === 275);
  check('SUV: multiplier 1.25', b.vehicleSizeMultiplier === 1.25);
}
{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: 'XL SUV' }), settings, model);
  check('XL SUV: packageCost = 220 × 1.5 = 330', b.packageCost === 330);
}
{
  const b = computePackageMultiplierPrice(baseJob({ vehicleSize: undefined }), settings, model);
  check('missing vehicleSize → Sedan default', b.vehicleSize === 'Sedan');
  check('missing vehicleSize → multiplier 1.0', b.vehicleSizeMultiplier === 1.0);
}
{
  const b = computePackageMultiplierPrice(
    baseJob({ vehicleSize: 'XL SUV', detailingAddons: ['Pet Hair Removal', 'Tire Shine'] }),
    settings, model,
  );
  check('add-ons flat-priced (no multiplier): 30 + 15 = 45',
    b.addOnsCost === 45);
}
{
  const b = computePackageMultiplierPrice(
    baseJob({ detailingAddons: ['Pet Hair Removal', 'Unknown Service'] }),
    settings, model,
  );
  check('unknown add-on id contributes 0', b.addOnsCost === 30);
}
{
  const b = computePackageMultiplierPrice(baseJob({ detailingAddons: [] }), settings, model);
  check('empty detailingAddons → addOnsCost 0', b.addOnsCost === 0);
}
{
  const b = computePackageMultiplierPrice(baseJob({ detailingAddons: undefined }), settings, model);
  check('undefined detailingAddons → addOnsCost 0', b.addOnsCost === 0);
}
{
  const b = computePackageMultiplierPrice(baseJob({ service: 'Unknown Package' }), settings, model);
  check('missing service → packageCost 0', b.packageCost === 0);
}
{
  const b = computePackageMultiplierPrice(baseJob({ miles: 12 }), settings, model);
  check('travel: chargeable 7 mi × 0.65 = 4.55', b.travelCost === 4.55);
  check('travel: chargeable miles 7', b.travelChargeable === 7);
}
{
  const b = computePackageMultiplierPrice(baseJob({ miles: 3 }), settings, model);
  check('travel suppressed below freeMiles', b.travelCost === 0);
}
{
  const b = computePackageMultiplierPrice(
    baseJob({ vehicleSize: 'SUV', detailingAddons: ['Pet Hair Removal'], miles: 12 }),
    settings, model,
  );
  check('directCost = 275 + 30 + 4.55 = 309.55',
    b.directCost === 309.55);
}
{
  const b = computePackageMultiplierPrice(baseJob({ revenue: 25 }), settings, model);
  check('revenue 25 < min 40 → belowMinServiceCharge true',
    b.belowMinServiceCharge === true);
}
{
  const b = computePackageMultiplierPrice(baseJob({ revenue: 0 }), settings, model);
  check('revenue 0 → belowMinServiceCharge false (no quote yet)',
    b.belowMinServiceCharge === false);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
