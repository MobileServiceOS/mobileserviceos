// tests/inventoryNotesParser.test.ts
// Run: npx tsx tests/inventoryNotesParser.test.ts

import {
  parseInventoryNotes,
  extractTireSize,
  extractCost,
  extractCondition,
  extractQuantity,
} from '@/lib/inventoryNotesParser';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ extractTireSize ─────────────────────────────');
check('225/65R17 → 225/65R17',   extractTireSize('225/65R17') === '225/65R17');
check('225/65-17 → 225/65R17',   extractTireSize('225/65-17') === '225/65R17');
check('225-65-17 → 225/65R17',   extractTireSize('225-65-17') === '225/65R17');
check('225 65 17 → 225/65R17',   extractTireSize('225 65 17') === '225/65R17');
check('225/65 R 17 → 225/65R17', extractTireSize('225/65 R 17') === '225/65R17');
check('lowercase r works',       extractTireSize('225/65r17') === '225/65R17');
check('inside sentence',         extractTireSize('Got 5 of 245/40R18 yesterday') === '245/40R18');
check('no size → empty',         extractTireSize('Bring more tires from Discount') === '');
check('only partial digits',     extractTireSize('22/65R17') === '');
check('225/65/17 (no R) → 225/65R17',  extractTireSize('225/65/17') === '225/65R17');
check('215/55/17 (user request)',      extractTireSize('215/55/17') === '215/55R17');
check('225-65/17 mixed seps',          extractTireSize('225-65/17') === '225/65R17');
check('225/65/17 inside line',         extractTireSize('Stock 225/65/17 4 @75') === '225/65R17');

console.log('\n┌─ extractCost ────────────────────────────────');
check('$80',                    extractCost('225/65R17 5 $80') === 80);
check('$ 80 with space',        extractCost('225/65R17 5 $ 80') === 80);
check('$80.50',                 extractCost('$80.50') === 80.5);
check('@$80',                   extractCost('225/65R17 5 @$80') === 80);
check('@80',                    extractCost('225/65R17 5 @80') === 80);
check('no cost → 0',            extractCost('225/65R17 5') === 0);

console.log('\n┌─ extractCondition ────────────────────────────');
check('used → Used',             extractCondition('225/65R17 USED 5') === 'Used');
check('Used capitalized',        extractCondition('225/65R17 Used 5') === 'Used');
check('blem → Used',             extractCondition('225/65R17 blem 5') === 'Used');
check('blemished → Used',        extractCondition('225/65R17 blemished 5') === 'Used');
check('new → New',               extractCondition('225/65R17 new 5') === 'New');
check('default → New',           extractCondition('225/65R17 5') === 'New');

console.log('\n┌─ extractQuantity ────────────────────────────');
check('standalone "5"',          extractQuantity('225/65R17 5') === 5);
check('x5',                      extractQuantity('225/65R17 x5') === 5);
check('5x',                      extractQuantity('5x 225/65R17') === 5);
check('qty 2',                   extractQuantity('225/65R17 qty 2 $80') === 2);
check('qty: 2',                  extractQuantity('225/65R17 qty: 2') === 2);
check('5 pcs',                   extractQuantity('225/65R17 5 pcs') === 5);
check('5 each',                  extractQuantity('225/65R17 5 each') === 5);
check('with cost not confused',  extractQuantity('225/65R17 2 $80') === 2);
check('with used not confused',  extractQuantity('225/65R17 used 3') === 3);
check('no qty → 0',              extractQuantity('225/65R17') === 0);

console.log('\n┌─ parseInventoryNotes (full lines) ────────────');
{
  const out = parseInventoryNotes('225/65R17 5');
  check('simplest line', out.length === 1
    && out[0].tireSize === '225/65R17'
    && out[0].quantity === 5
    && out[0].condition === 'New'
    && out[0].cost === 0
    && !out[0]._error);
}
{
  const out = parseInventoryNotes('245/40R18 used 2 @$95');
  check('used + qty + cost', out.length === 1
    && out[0].tireSize === '245/40R18'
    && out[0].quantity === 2
    && out[0].condition === 'Used'
    && out[0].cost === 95);
}
{
  const out = parseInventoryNotes(`
    225/65R17 5
    245/40R18 used 2 $80
    275/35R20 1
  `);
  check('three-line block parses all', out.length === 3
    && out[0].tireSize === '225/65R17' && out[0].quantity === 5
    && out[1].tireSize === '245/40R18' && out[1].condition === 'Used'
    && out[2].tireSize === '275/35R20' && out[2].quantity === 1);
}
{
  const out = parseInventoryNotes('Bring more tires from Discount');
  check('line without size → _error', out.length === 1
    && out[0]._error === 'No tire size found');
}
{
  const out = parseInventoryNotes('225/65R17');
  check('line with size but no qty → defaults to 1 (no error)',
    out.length === 1
    && out[0].tireSize === '225/65R17'
    && out[0].quantity === 1
    && !out[0]._error);
}
{
  const out = parseInventoryNotes(`
    Inventory:
    -----------
    225/65R17 5
    `);
  check('skips header + separator', out.length === 1
    && out[0].tireSize === '225/65R17');
}
{
  const out = parseInventoryNotes(`
    5x 225/65R17 used
    qty 2 of 245/40R18 new $80
    `);
  check('qty-first ordering works', out.length === 2
    && out[0].quantity === 5 && out[0].condition === 'Used'
    && out[1].quantity === 2 && out[1].cost === 80);
}
{
  const out = parseInventoryNotes('');
  check('empty input → empty array', out.length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
