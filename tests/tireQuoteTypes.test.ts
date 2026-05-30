// tests/tireQuoteTypes.test.ts
// Run: npx tsx tests/tireQuoteTypes.test.ts
//
// Exhaustiveness check on the QuoteSearchInput tagged union. Phase 1
// implements `kind: 'size'` only, but every other variant is typed
// now so future search methods (VIN, photo OCR, plate, vehicle, brand)
// can land without a schema migration.
//
// The pattern: a helper function that switches on `kind` and the
// TypeScript `never` type ensures any new variant added to the
// union forces a compile error (and a runtime test failure) until
// every branch is handled.

import {
  ALL_QUOTE_SEARCH_KINDS,
  DEFAULT_SUPPLIER_NAMES,
  DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS,
  type QuoteSearchInput,
  type QuoteSearchKind,
} from '@/lib/tireQuoteTypes';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

// ─── Tagged union — every variant is constructible ────────────────
section('QuoteSearchInput — every variant typechecks');

const examples: QuoteSearchInput[] = [
  { kind: 'size', tireSize: '225/65R17' },
  { kind: 'size', tireSize: '225/65R17', brand: 'Michelin' },
  { kind: 'size', tireSize: '225/65R17', brand: 'Michelin', model: 'Pilot Sport 4S' },
  { kind: 'brandModel', brand: 'Michelin', model: 'Pilot Sport 4S' },
  { kind: 'vin', vin: '1HGBH41JXMN109186' },
  { kind: 'photo', storageRef: 'gs://bucket/photos/abc.jpg' },
  { kind: 'vehicle', year: 2020, make: 'Toyota', vehicleModel: 'Camry' },
  { kind: 'plate', plate: 'ABC1234', state: 'FL' },
];

check('all 8 variant shapes type-check + construct', examples.length === 8);

// ─── Exhaustiveness via never-narrowing ───────────────────────────
section('Switch exhaustiveness — every kind handled');

function describeSearch(input: QuoteSearchInput): string {
  switch (input.kind) {
    case 'size':
      return `size ${input.tireSize}`;
    case 'brandModel':
      return `${input.brand} ${input.model}`;
    case 'vin':
      return `VIN ${input.vin}`;
    case 'photo':
      return `photo at ${input.storageRef}`;
    case 'vehicle':
      return `${input.year} ${input.make} ${input.vehicleModel}`;
    case 'plate':
      return `plate ${input.plate}, ${input.state}`;
    default: {
      // The `_exhaustive: never` trick. If a future variant is added
      // to QuoteSearchInput, TypeScript will fail to compile this
      // line (the new variant won't be assignable to `never`), and
      // CI will block the merge. Runtime check is the belt-and-
      // suspenders fallback.
      const _exhaustive: never = input;
      return `UNHANDLED VARIANT: ${JSON.stringify(_exhaustive)}`;
    }
  }
}

check('size variant returns "size ..."',
  describeSearch({ kind: 'size', tireSize: '225/65R17' }) === 'size 225/65R17');
check('brandModel variant',
  describeSearch({ kind: 'brandModel', brand: 'Michelin', model: 'Defender' }) === 'Michelin Defender');
check('vin variant',
  describeSearch({ kind: 'vin', vin: '1HGBH41JXMN109186' }) === 'VIN 1HGBH41JXMN109186');
check('photo variant',
  describeSearch({ kind: 'photo', storageRef: 'gs://x' }) === 'photo at gs://x');
check('vehicle variant',
  describeSearch({ kind: 'vehicle', year: 2020, make: 'Toyota', vehicleModel: 'Camry' }) === '2020 Toyota Camry');
check('plate variant',
  describeSearch({ kind: 'plate', plate: 'ABC1234', state: 'FL' }) === 'plate ABC1234, FL');

// ─── ALL_QUOTE_SEARCH_KINDS stays in sync with the union ──────────
section('ALL_QUOTE_SEARCH_KINDS catalog');

const expectedKinds: QuoteSearchKind[] = ['size', 'brandModel', 'vin', 'photo', 'vehicle', 'plate'];
const expectedSet = new Set<QuoteSearchKind>(expectedKinds);
const actualSet = new Set<QuoteSearchKind>(ALL_QUOTE_SEARCH_KINDS);

check('catalog length matches union variant count',
  ALL_QUOTE_SEARCH_KINDS.length === expectedKinds.length);

for (const k of expectedKinds) {
  check(`catalog contains '${k}'`, actualSet.has(k));
}
for (const k of ALL_QUOTE_SEARCH_KINDS) {
  check(`catalog '${k}' is in the expected set`, expectedSet.has(k));
}

// ─── Default suppliers + settings ─────────────────────────────────
section('DEFAULT_SUPPLIER_NAMES');

check('contains ATD', DEFAULT_SUPPLIER_NAMES.includes('ATD'));
check('contains Advance Tire', DEFAULT_SUPPLIER_NAMES.includes('Advance Tire'));
check('contains U.S. AutoForce', DEFAULT_SUPPLIER_NAMES.includes('U.S. AutoForce'));
check('contains Used Inventory', DEFAULT_SUPPLIER_NAMES.includes('Used Inventory'));
check('contains Manual Entry', DEFAULT_SUPPLIER_NAMES.includes('Manual Entry'));
check('exactly 5 defaults', DEFAULT_SUPPLIER_NAMES.length === 5);

section('DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS');

const s = DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS;
check('roundPriceTo = 9 (psychological default)', s.roundPriceTo === 9);
check('taxRate = 0.07 (Florida default)', s.taxRate === 0.07);
check('cashPriceEnabled = false (off by default)', s.cashPriceEnabled === false);
check('showTaxIncludedPrice = false (off by default)', s.showTaxIncludedPrice === false);
check('defaultProfitTargetUsed < defaultProfitTargetNew < defaultProfitTargetPremium',
  s.defaultProfitTargetUsed < s.defaultProfitTargetNew &&
  s.defaultProfitTargetNew < s.defaultProfitTargetPremium);
check('minimumProfit > 0', s.minimumProfit > 0);
check('emergencyFee > sameDayFee (emergency costs more)', s.emergencyFee > s.sameDayFee);
check('afterHoursFee > emergencyFee (after-hours costs even more)', s.afterHoursFee > s.emergencyFee);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
