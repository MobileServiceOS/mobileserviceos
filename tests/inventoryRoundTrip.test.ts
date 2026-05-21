// tests/inventoryRoundTrip.test.ts
// Run: npx tsx tests/inventoryRoundTrip.test.ts
//
// Pins the deserializer contract for vertical-specific optional
// fields. A whole class of "I saved it and it came back blank" bugs
// has the same shape: a UI writes a typed-but-non-base field via
// fbSet, the field lands in Firestore, but the deserializer
// enumerates only base + known optional fields, so the next read
// silently strips it. The user's data is on disk but inaccessible.
//
// Already-hit instances of this class: paidAt + paymentMethod on
// Job (commit 4ce4360). Detailing chemicalName + dilutionRatio on
// InventoryItem (this test).

import { deserializeInventoryItem } from '@/lib/deserializers';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const base: Record<string, unknown> = {
  id: 'inv-1',
  size: '',
  qty: 5,
  cost: 12,
};

console.log('\n┌─ Detailing chemical fields round-trip ────────────');
{
  const raw = {
    ...base,
    chemicalName: 'Citrus Degreaser',
    dilutionRatio: '1:10',
    category: 'Cleaner',
  };
  const item = deserializeInventoryItem(raw);
  check('chemicalName preserved', item.chemicalName === 'Citrus Degreaser');
  check('dilutionRatio preserved', item.dilutionRatio === '1:10');
  check('category preserved', item.category === 'Cleaner');
}
{
  const item = deserializeInventoryItem({ ...base });
  check('missing chemicalName → undefined', item.chemicalName === undefined);
  check('missing dilutionRatio → undefined', item.dilutionRatio === undefined);
}
{
  const item = deserializeInventoryItem({ ...base, chemicalName: null, dilutionRatio: null });
  check('null chemicalName → undefined', item.chemicalName === undefined);
  check('null dilutionRatio → undefined', item.dilutionRatio === undefined);
}

console.log('\n┌─ Mechanic part fields round-trip ─────────────────');
{
  const raw = {
    ...base,
    partNumber: 'P-12345',
    partName: 'Brake Pad Set',
    supplier: 'AutoZone',
    unitCost: 45.99,
    retailPrice: 89.99,
    laborHoursDefault: 1.5,
    warrantyDays: 90,
    locationBin: 'Shelf-3B',
    compatibleVehicles: ['Honda Civic', 'Toyota Camry'],
  };
  const item = deserializeInventoryItem(raw);
  check('partNumber preserved', item.partNumber === 'P-12345');
  check('partName preserved', item.partName === 'Brake Pad Set');
  check('supplier preserved', item.supplier === 'AutoZone');
  check('unitCost preserved', item.unitCost === 45.99);
  check('retailPrice preserved', item.retailPrice === 89.99);
  check('laborHoursDefault preserved', item.laborHoursDefault === 1.5);
  check('warrantyDays preserved', item.warrantyDays === 90);
  check('locationBin preserved', item.locationBin === 'Shelf-3B');
  check('compatibleVehicles preserved + length 2',
    Array.isArray(item.compatibleVehicles) && item.compatibleVehicles.length === 2);
}

console.log('\n┌─ Tire fields (legacy / default) ──────────────────');
{
  const raw = {
    ...base,
    size: '225/65R17',
    brand: 'Michelin',
    model: 'Defender',
    condition: 'Used',
    notes: 'Light wear',
  };
  const item = deserializeInventoryItem(raw);
  check('size preserved', item.size === '225/65R17');
  check('brand preserved', item.brand === 'Michelin');
  check('model preserved', item.model === 'Defender');
  check('condition preserved', item.condition === 'Used');
  check('notes preserved', item.notes === 'Light wear');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
