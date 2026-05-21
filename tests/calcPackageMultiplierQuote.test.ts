// tests/calcPackageMultiplierQuote.test.ts
// Run: npx tsx tests/calcPackageMultiplierQuote.test.ts

import { calcPackageMultiplierQuote } from '@/config/businessTypes/pricing/packageMult';
import type { QuoteForm, Settings } from '@/types';
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
    'Full Detail':      { basePrice: 220, minProfit: 130, enabled: true },
    'Express Wash':     { basePrice: 40,  minProfit: 25,  enabled: true },
    'Pet Hair Removal': { basePrice: 30,  minProfit: 25,  enabled: true },
  },
} as Settings;

const baseForm = (over: Partial<QuoteForm> = {}): QuoteForm => ({
  service: 'Full Detail',
  vehicleType: 'Car',
  miles: '',
  tireCost: '',
  materialCost: '',
  qty: 1,
  revenue: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  ...over,
} as QuoteForm);

console.log('\n┌─ calcPackageMultiplierQuote ──────────────────────');

{
  const q = calcPackageMultiplierQuote(baseForm({ vehicleSize: 'Sedan' }), settings, model);
  check('Sedan suggested = 350', q.suggested === 350);
  check('Sedan premium = ceil(350 × 1.25 / 5) × 5 = 440', q.premium === 440);
}
{
  const q = calcPackageMultiplierQuote(baseForm({ vehicleSize: 'SUV' }), settings, model);
  check('SUV suggested = 405', q.suggested === 405);
}
{
  const q = calcPackageMultiplierQuote(
    baseForm({ vehicleSize: 'XL SUV', detailingAddons: ['Pet Hair Removal'] }),
    settings, model,
  );
  check('XL SUV + Pet Hair = 490', q.suggested === 490);
}
{
  const q = calcPackageMultiplierQuote(baseForm({ vehicleSize: undefined }), settings, model);
  check('missing vehicleSize → defaults to Sedan/1.0', q.suggested === 350);
}
{
  const q = calcPackageMultiplierQuote(
    baseForm({ service: 'Unknown Service', vehicleSize: 'Sedan' }),
    settings, model,
  );
  check('unknown service → uses default 100 + 50 = 150', q.suggested === 150);
}
{
  const q = calcPackageMultiplierQuote(
    baseForm({ service: 'Express Wash', vehicleSize: 'Sedan', miles: 10 }),
    settings, model,
  );
  // packageCost 40 + travel 3.25 + target 25 = 68.25 → ceil to 70
  check('Express Wash + travel 10mi = 70', q.suggested === 70);
}
{
  const q = calcPackageMultiplierQuote(
    baseForm({ vehicleSize: 'SUV', detailingAddons: ['Pet Hair Removal'] }),
    settings, model,
  );
  check('directCosts = 275 + 30 + 0 = 305', q.directCosts === 305);
  check('targetProfit echoed', q.targetProfit === 130);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
