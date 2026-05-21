// tests/mechanicInvoiceLineItems.test.ts
// Run: npx tsx tests/mechanicInvoiceLineItems.test.ts

import { buildMechanicLineItems } from '@/lib/mechanicJob';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ buildMechanicLineItems ────────────────────────────');

// Labor-only
{
  const lines = buildMechanicLineItems(
    { laborHours: 3, parts: [], partsCost: 0, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('labor-only: 1 line', lines.length === 1);
  check('labor-only: amount = 3 × 95 = 285', lines[0].amount === 285);
  check('labor-only: group is labor', lines[0].group === 'labor');
  check('labor-only: detail shows rate', lines[0].detail === '3 hrs × $95/hr');
}

// Parts itemized
{
  const lines = buildMechanicLineItems(
    {
      laborHours: 0,
      parts: [
        { name: 'Brake pad set', qty: 1, unitPrice: 45, unitCost: 28, source: 'inventory', inventoryItemId: 'i1' },
        { name: 'Brake fluid',   qty: 2, unitPrice: 12, unitCost: 7,  source: 'inventory', inventoryItemId: 'i2', warrantyDays: 90 },
      ],
      partsCost: 69,
      diagnosticFee: 0,
      miles: 0,
    },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('parts-only itemized: 2 lines', lines.length === 2);
  check('parts line 1 label', lines[0].label === 'Brake pad set');
  check('parts line 1 amount', lines[0].amount === 45);
  check('parts line 2 amount', lines[1].amount === 24);
  check('parts line 2 detail (no warranty here)', lines[0].detail === '1 × $45.00');
  check('warranty annotation present on line 2', lines[1].detail?.includes('90d warranty') === true);
}

// Legacy mechanic doc (parts undefined, partsCost set)
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: undefined, partsCost: 75, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('legacy mechanic doc (no parts[]): 1 aggregate parts line', lines.length === 1);
  check('legacy aggregate label = "Parts"', lines[0].label === 'Parts');
  check('legacy aggregate amount = partsCost', lines[0].amount === 75);
  check('legacy aggregate has no detail', lines[0].detail === undefined);
}

// Legacy mechanic doc with empty parts[] AND partsCost 0
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [], partsCost: 0, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('empty parts[] + 0 partsCost: no parts line', lines.length === 0);
}

// Diagnostic fee
{
  const lines = buildMechanicLineItems(
    { laborHours: 2, parts: [], partsCost: 0, diagnosticFee: 89, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('diagnostic fee line emitted',
    lines.find((l) => l.group === 'fees')?.amount === 89);
  check('diagnostic fee suppressed when 0',
    buildMechanicLineItems(
      { laborHours: 1, parts: [], partsCost: 0, diagnosticFee: 0, miles: 0 },
      { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
    ).find((l) => l.group === 'fees') === undefined);
}

// Travel
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [], partsCost: 0, diagnosticFee: 0, miles: 12 },
    { laborRate: 95, freeMilesIncluded: 5, costPerMile: 0.65 },
  );
  const travel = lines.find((l) => l.group === 'travel');
  check('travel: chargeable 7 mi × 0.65 = 4.55', travel?.amount === 4.55);
  check('travel detail includes chargeable miles', travel?.detail === '7 mi @ $0.65/mi');
}
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [], partsCost: 0, diagnosticFee: 0, miles: 3 },
    { laborRate: 95, freeMilesIncluded: 5, costPerMile: 0.65 },
  );
  check('travel suppressed when miles below freeMiles',
    lines.find((l) => l.group === 'travel') === undefined);
}

// All-zero
{
  const lines = buildMechanicLineItems(
    { laborHours: 0, parts: [], partsCost: 0, diagnosticFee: 0, miles: 0 },
    { laborRate: 95, freeMilesIncluded: 0, costPerMile: 0.65 },
  );
  check('all-zero job emits no lines', lines.length === 0);
}

// Full mixed invoice
{
  const lines = buildMechanicLineItems(
    {
      laborHours: 3,
      parts: [
        { name: 'Brake pad set', qty: 1, unitPrice: 45, unitCost: 28, source: 'inventory', inventoryItemId: 'i1' },
      ],
      partsCost: 45,
      diagnosticFee: 89,
      miles: 12,
    },
    { laborRate: 95, freeMilesIncluded: 5, costPerMile: 0.65 },
  );
  check('full mixed: 4 lines (labor + 1 part + diag + travel)', lines.length === 4);
  check('full mixed: line order labor→parts→fees→travel',
    lines[0].group === 'labor' && lines[1].group === 'parts' && lines[2].group === 'fees' && lines[3].group === 'travel');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
