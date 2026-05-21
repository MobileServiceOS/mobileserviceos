// tests/serviceCategories.test.ts
// Run: npx tsx tests/serviceCategories.test.ts
//
// Pins the service category + popular metadata that drives the
// AddJob grouped service picker. The picker switches from flat
// chip-grid to grouped (Popular row + collapsible categories) when
// a vertical's services declare categories — so:
//   - mechanic MUST have categories on every service (grouped)
//   - tire MUST NOT (keeps the flat short-list chip-grid)
// and the Popular row must match the product spec.

import { getBusinessTypeConfig } from '@/config/businessTypes/registry';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const mech = getBusinessTypeConfig('mechanic');
const tire = getBusinessTypeConfig('tire');
const detail = getBusinessTypeConfig('detailing');

console.log('\n┌─ Mechanic — every service categorized ────────────');
{
  const uncategorized = mech.services.filter((s) => !s.category);
  check('every mechanic service has a category',
    uncategorized.length === 0);
  if (uncategorized.length > 0) {
    console.log('    missing:', uncategorized.map((s) => s.id).join(', '));
  }
}

console.log('\n┌─ Mechanic — Popular row matches spec ─────────────');
{
  const popular = mech.services.filter((s) => s.popular).map((s) => s.id);
  // Product spec — the compact Popular row.
  const expected = [
    'Diagnostics',
    'Check Engine Light Diagnosis',
    'Oil Change',
    'Battery Replacement',
    'Brake Pads & Rotors',
    'General Repair',
  ];
  check('exactly 6 popular services', popular.length === 6);
  for (const id of expected) {
    check(`'${id}' is flagged popular`, popular.includes(id));
  }
}

console.log('\n┌─ Mechanic — category coverage ────────────────────');
{
  const cats = new Set(mech.services.map((s) => s.category));
  const expectedCats = [
    'Diagnostics', 'Battery & Electrical', 'Brakes', 'Engine & Tune-Up',
    'Cooling System', 'Belts & Hoses', 'Suspension', 'Fluids & Maintenance',
    'General / Other',
  ];
  for (const c of expectedCats) {
    check(`category '${c}' present`, cats.has(c));
  }
  check('no unexpected categories',
    [...cats].every((c) => c && expectedCats.includes(c)));
}

console.log('\n┌─ Mechanic — popular services are also enabled ────');
{
  // A popular service hidden by enabledByDefault:false would never
  // appear in the picker — defeats the point.
  const popularDisabled = mech.services.filter((s) => s.popular && !s.enabledByDefault);
  check('every popular service is enabledByDefault', popularDisabled.length === 0);
}

console.log('\n┌─ Tire — stays flat (no categories) ───────────────');
{
  const categorized = tire.services.filter((s) => s.category);
  check('no tire service declares a category (flat chip-grid)',
    categorized.length === 0);
  const popularTire = tire.services.filter((s) => s.popular);
  check('no tire service flagged popular', popularTire.length === 0);
}

console.log('\n┌─ Detailing — stays flat (no categories) ──────────');
{
  const categorized = detail.services.filter((s) => s.category);
  check('no detailing service declares a category', categorized.length === 0);
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
