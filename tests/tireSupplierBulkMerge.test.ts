// tests/tireSupplierBulkMerge.test.ts
// Run: npx tsx tests/tireSupplierBulkMerge.test.ts

import {
  mergeSupplierBulkRows,
  type MergeableSupplierRow,
} from '@/lib/tireSupplierBulkMerge';
import type { TireSupplierPrice } from '@/lib/tireQuoteTypes';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

let idCounter = 0;
const freshId = (): string => `id-${++idCounter}`;
const NOW = '2026-05-28T18:00:00Z';
const UID = 'user-1';

function makeExisting(overrides: Partial<TireSupplierPrice>): TireSupplierPrice {
  return {
    id: 'existing-1',
    supplierName: 'ATD',
    tireSize: '225/65R17',
    brand: 'Michelin',
    model: 'Defender 2',
    cost: 100,
    quantityAvailable: 5,
    condition: 'new',
    category: 'midrange',
    runFlat: false,
    evRated: false,
    xlLoad: false,
    lastUpdated: '2026-05-01T00:00:00Z',
    createdBy: 'older-user',
    ...overrides,
  };
}

function makeIncoming(overrides: Partial<MergeableSupplierRow>): MergeableSupplierRow {
  return {
    supplierName: 'ATD',
    tireSize: '225/65R17',
    brand: 'Michelin',
    model: 'Defender 2',
    cost: 110,
    quantityAvailable: 3,
    condition: 'new',
    category: 'midrange',
    runFlat: false,
    evRated: false,
    xlLoad: false,
    ...overrides,
  };
}

// ─── Empty input cases ────────────────────────────────────────────
section('Empty input cases');
{
  const r = mergeSupplierBulkRows([], [], freshId, NOW, UID);
  check('empty + empty → empty result', r.next.length === 0);
  check('addedCount = 0', r.addedCount === 0);
  check('mergedCount = 0', r.mergedCount === 0);
}

{
  const existing = [makeExisting({})];
  const r = mergeSupplierBulkRows(existing, [], freshId, NOW, UID);
  check('existing + empty incoming → existing unchanged', r.next.length === 1);
  check('existing reference preserved', r.next[0].id === 'existing-1');
}

// ─── Single new add ───────────────────────────────────────────────
section('Single new add');
{
  idCounter = 0;
  const r = mergeSupplierBulkRows([], [makeIncoming({})], freshId, NOW, UID);
  check('adds 1 row', r.next.length === 1);
  check('addedCount = 1', r.addedCount === 1);
  check('mergedCount = 0', r.mergedCount === 0);
  check('new id assigned', r.next[0].id === 'id-1');
  check('lastUpdated stamped', r.next[0].lastUpdated === NOW);
  check('createdBy stamped', r.next[0].createdBy === UID);
}

// ─── Same-batch dedup ─────────────────────────────────────────────
section('Same-batch dedup — paste same row twice in CSV');
{
  idCounter = 0;
  const incoming = [
    makeIncoming({ quantityAvailable: 4 }),
    makeIncoming({ quantityAvailable: 6 }),  // same key
  ];
  const r = mergeSupplierBulkRows([], incoming, freshId, NOW, UID);
  check('only 1 row after collapse', r.next.length === 1);
  check('quantities summed: 4 + 6 = 10', r.next[0].quantityAvailable === 10);
  check('collapsedCount = 1', r.collapsedCount === 1);
  check('addedCount = 1 (one logical add)', r.addedCount === 1);
}

// ─── Cross-batch merge against existing ──────────────────────────
section('Cross-batch merge — incoming matches existing key');
{
  idCounter = 0;
  const existing = [makeExisting({ quantityAvailable: 5, cost: 100 })];
  const incoming = [makeIncoming({ quantityAvailable: 3, cost: 110 })];
  const r = mergeSupplierBulkRows(existing, incoming, freshId, NOW, UID);
  check('still 1 row (merged)', r.next.length === 1);
  check('mergedCount = 1', r.mergedCount === 1);
  check('addedCount = 0', r.addedCount === 0);
  check('quantity bumped: 5 + 3 = 8', r.next[0].quantityAvailable === 8);
  check('cost refreshed to incoming value', r.next[0].cost === 110);
  check('lastUpdated bumped to NOW', r.next[0].lastUpdated === NOW);
  check('existing id preserved (no new id generated)', r.next[0].id === 'existing-1');
}

// ─── Mixed batch: some merge, some new ─────────────────────────────
section('Mixed batch — some merge, some new');
{
  idCounter = 0;
  const existing = [
    makeExisting({ id: 'e1', brand: 'Michelin' }),
  ];
  const incoming = [
    makeIncoming({ brand: 'Michelin' }),           // merges with e1
    makeIncoming({ brand: 'Goodyear' }),           // new (different brand)
    makeIncoming({ brand: 'Pirelli' }),            // new
  ];
  const r = mergeSupplierBulkRows(existing, incoming, freshId, NOW, UID);
  check('3 rows total', r.next.length === 3);
  check('mergedCount = 1', r.mergedCount === 1);
  check('addedCount = 2', r.addedCount === 2);
  check('e1 still present', r.next.some((p) => p.id === 'e1'));
  check('Goodyear added as new', r.next.some((p) => p.brand === 'Goodyear'));
  check('Pirelli added as new', r.next.some((p) => p.brand === 'Pirelli'));
}

// ─── Different supplier same tire ─────────────────────────────────
section('Different supplier — same tire kept separate');
{
  idCounter = 0;
  const existing = [makeExisting({ supplierName: 'ATD' })];
  const incoming = [makeIncoming({ supplierName: 'U.S. AutoForce' })];
  const r = mergeSupplierBulkRows(existing, incoming, freshId, NOW, UID);
  check('2 rows (different suppliers)', r.next.length === 2);
  check('addedCount = 1', r.addedCount === 1);
  check('mergedCount = 0', r.mergedCount === 0);
  check('both suppliers present',
    r.next.some((p) => p.supplierName === 'ATD') &&
    r.next.some((p) => p.supplierName === 'U.S. AutoForce'));
}

// ─── Different condition same tire ────────────────────────────────
section('Different condition — new vs used kept separate');
{
  idCounter = 0;
  const existing = [makeExisting({ condition: 'new', brand: 'Michelin' })];
  const incoming = [makeIncoming({ condition: 'used', brand: 'Michelin', treadDepth: 7 })];
  const r = mergeSupplierBulkRows(existing, incoming, freshId, NOW, UID);
  check('2 rows (new vs used)', r.next.length === 2);
  check('used row has treadDepth', r.next.find((p) => p.condition === 'used')?.treadDepth === 7);
}

// ─── Tire-size canonicalization ───────────────────────────────────
section('Tire size variations — 225/65R17 / 225/65-17 / 225-65-17 collapse');
{
  idCounter = 0;
  const incoming = [
    makeIncoming({ tireSize: '225/65R17', quantityAvailable: 1 }),
    makeIncoming({ tireSize: '225/65-17', quantityAvailable: 2 }),  // same physical
    makeIncoming({ tireSize: '225-65-17', quantityAvailable: 3 }),  // same physical
  ];
  const r = mergeSupplierBulkRows([], incoming, freshId, NOW, UID);
  check('all 3 variants collapse to 1 row', r.next.length === 1);
  check('quantities summed: 1+2+3 = 6', r.next[0].quantityAvailable === 6);
  check('canonical display form used', r.next[0].tireSize === '225/65R17');
}

// ─── Case-insensitive brand/model/supplier match ─────────────────
section('Case-insensitive match for supplier/brand/model');
{
  idCounter = 0;
  const existing = [makeExisting({
    supplierName: 'ATD', brand: 'Michelin', model: 'Defender 2',
  })];
  const incoming = [makeIncoming({
    supplierName: 'atd', brand: 'MICHELIN', model: 'defender 2',
  })];
  const r = mergeSupplierBulkRows(existing, incoming, freshId, NOW, UID);
  check('case differences still merge', r.next.length === 1);
  check('mergedCount = 1', r.mergedCount === 1);
}

// ─── Optional fields preserved/updated ────────────────────────────
section('Optional fields preserved or updated on merge');
{
  idCounter = 0;
  const existing = [makeExisting({
    runFlat: false, evRated: false, xlLoad: true, speedRating: 'H',
    notes: 'old notes',
  })];
  // Build incoming WITHOUT spreading defaults so xlLoad genuinely
  // arrives as undefined (the "operator's CSV omits the column"
  // scenario). makeIncoming sets xlLoad:false by default which would
  // explicitly overwrite — not what we're testing here.
  const incoming: MergeableSupplierRow[] = [{
    supplierName: 'ATD',
    tireSize: '225/65R17',
    brand: 'Michelin',
    model: 'Defender 2',
    cost: 110,
    quantityAvailable: 3,
    condition: 'new',
    category: 'midrange',
    runFlat: true,
    evRated: true,
    // xlLoad genuinely omitted — should preserve existing true
    notes: 'updated notes',
  }];
  const r = mergeSupplierBulkRows(existing, incoming, freshId, NOW, UID);
  check('runFlat updated to true', r.next[0].runFlat === true);
  check('evRated updated to true', r.next[0].evRated === true);
  check('xlLoad preserved (was true, incoming undefined)', r.next[0].xlLoad === true);
  check('speedRating preserved', r.next[0].speedRating === 'H');
  check('notes updated', r.next[0].notes === 'updated notes');
}

// ─── Caller array not mutated ─────────────────────────────────────
section('Caller arrays not mutated');
{
  idCounter = 0;
  const existing: TireSupplierPrice[] = [makeExisting({})];
  const existingSnapshot = JSON.stringify(existing);
  const incoming: MergeableSupplierRow[] = [makeIncoming({ quantityAvailable: 99 })];
  const incomingSnapshot = JSON.stringify(incoming);

  mergeSupplierBulkRows(existing, incoming, freshId, NOW, UID);

  check('original existing[] unchanged', JSON.stringify(existing) === existingSnapshot);
  check('original incoming[] unchanged', JSON.stringify(incoming) === incomingSnapshot);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
