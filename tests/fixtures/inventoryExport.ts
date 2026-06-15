// tests/fixtures/inventoryExport.ts
// ═══════════════════════════════════════════════════════════════════
//  Acceptance fixture for the inventory demand/duplicate fix.
//
//  These records encode the exact scenarios + expected values called out
//  in the bug spec against the production export (291 jobs, 127 inventory
//  records). The raw export isn't committed to the repo, so this fixture
//  reproduces every named case so the engine's behavior is pinned by an
//  assertable suite:
//    • on-hand per size aggregated across duplicate entries
//    • exactly 18 sizes carry duplicate entries
//    • reorder priority ranked by JOBS/90d (not unit count)
//    • out-of-stock-but-in-demand sizes surface in reorder
//    • set-buy sizes rank by jobs, not inflated units
//    • dead stock (in stock, zero jobs) excluded from demand
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, Job } from '@/types';

/** "Now" for the 90-day window — matches the fixture job dates below. */
export const NOW = new Date('2026-06-15T12:00:00Z');

let _seq = 0;
const inv = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'inv' + ++_seq,
  size: '',
  qty: 0,
  cost: 0,
  condition: 'New',
  reorderPoint: 1,
  ...over,
});

const job = (tireSize: string, qty: number, date: string, revenue = qty * 100): Job =>
  ({
    id: 'job' + ++_seq,
    status: 'Completed',
    date,
    tireSize,
    qty,
    revenue,
    tireCost: 0, materialCost: 0, miles: 0, note: '',
    emergency: false, lateNight: false, highway: false, weekend: false,
    tireSource: 'in_stock',
  }) as Job;

// ─── 18 sizes WITH duplicate entries ──────────────────────────────────
// The three named acceptance sizes carry specific on-hand totals and use
// mixed formatting / New+Used / blank-brand to prove normalization +
// condition-agnostic aggregation. The remaining 15 are filler dup sizes.

const namedDuplicates: InventoryItem[] = [
  // 235/40R18 → two entries 1 + 1 = 2 (formatting variants must group).
  inv({ size: '235/40R18', qty: 1, cost: 90, brand: 'Michelin' }),
  inv({ size: '235/40/18', qty: 1, cost: 90, brand: '' }),

  // 225/55R18 → on-hand 4 (2 + 2); must NOT read as out of stock.
  inv({ size: '225/55R18', qty: 2, cost: 95 }),
  inv({ size: '225/55R18', qty: 2, cost: 95, condition: 'Used' }),

  // 205/55R16 → 0 (Used) + 2 (New) = 2; Used + blank brand still aggregate.
  inv({ size: '205/55R16', qty: 0, cost: 40, condition: 'Used', brand: '' }),
  inv({ size: '205/55/16', qty: 2, cost: 70, condition: 'New', reorderPoint: 2 }),
];

// 15 more sizes, each with two entries (no demand → they land in dead stock,
// which keeps them clear of the named reorder/fast-mover assertions).
const FILLER_DUP_SIZES = [
  '215/60R16', '225/45R17', '215/55R17', '245/45R18', '255/35R19',
  '195/65R15', '215/65R16', '235/60R18', '275/40R20', '225/65R17',
  '245/40R19', '205/60R16', '215/45R17', '235/65R17', '255/45R20',
];
const fillerDuplicates: InventoryItem[] = FILLER_DUP_SIZES.flatMap((size) => [
  inv({ size, qty: 3, cost: 80 }),
  inv({ size, qty: 1, cost: 80 }),
]);

// ─── Singleton entries (exactly one row each — NOT duplicates) ────────
const singletons: InventoryItem[] = [
  // In demand + low/out → reorder candidates.
  inv({ size: '235/45R18', qty: 1, cost: 110, reorderPoint: 1 }), // 8 jobs, at threshold
  inv({ size: '205/65R16', qty: 0, cost: 65, reorderPoint: 1 }),  // 6 jobs, OUT of stock
  // Set-buy sizes — high units, low job counts.
  inv({ size: '255/50R19', qty: 0, cost: 130, reorderPoint: 1 }), // 2 jobs / 5 units
  inv({ size: '275/50R21', qty: 0, cost: 160, reorderPoint: 1 }), // 1 job  / 4 units
  inv({ size: '235/55R18', qty: 0, cost: 100, reorderPoint: 1 }), // 2 jobs / 5 units
  // Pure dead stock — in stock, zero demand.
  inv({ size: '185/65R14', qty: 5, cost: 55, reorderPoint: 1 }),
];

export const inventoryRecords: InventoryItem[] = [
  ...namedDuplicates,
  ...fillerDuplicates,
  ...singletons,
];

// ─── Jobs (90-day window) ─────────────────────────────────────────────
// Job counts are the demand signal. Set-buy sizes deliberately move many
// UNITS across few JOBS so unit-ranking and job-ranking diverge.
export const jobs: Job[] = [
  // 235/45R18 — 8 distinct jobs (top reorder priority by jobs).
  ...Array.from({ length: 8 }, (_, k) => job('235/45R18', 1, `2026-05-${10 + k}`)),
  // 205/55R16 — 7 jobs (one uses the slash-variant size string).
  ...Array.from({ length: 6 }, (_, k) => job('205/55R16', 1, `2026-05-${10 + k}`)),
  job('205/55/16', 1, '2026-05-20'),
  // 205/65R16 — 6 jobs, out of stock → must surface in reorder.
  ...Array.from({ length: 6 }, (_, k) => job('205/65R16', 1, `2026-05-${10 + k}`)),

  // Set-buys: many units, few jobs.
  job('255/50R19', 4, '2026-05-21'), job('255/50R19', 1, '2026-05-22'), // 2 jobs, 5 units
  job('275/50R21', 4, '2026-05-23'),                                    // 1 job,  4 units
  job('235/55R18', 4, '2026-05-24'), job('235/55R18', 1, '2026-05-25'), // 2 jobs, 5 units

  // Out-of-window / non-Completed noise that must NOT count.
  job('235/45R18', 1, '2025-01-01'),                       // older than 90d
  { ...job('205/65R16', 1, '2026-05-26'), status: 'Pending' } as Job, // not Completed
];

// ─── Expected values asserted by the acceptance spec ──────────────────
export const EXPECTED = {
  duplicateSizes: 18,
  onHand: {
    '235/40R18': 2,
    '225/55R18': 4,
    '205/55R16': 2,
  },
  // Reorder Now top order, ranked by jobs/90d.
  reorderTop: ['235/45R18', '205/55R16', '205/65R16'],
  jobs90d: {
    '235/45R18': 8,
    '205/55R16': 7,
    '205/65R16': 6,
    '255/50R19': 2,
    '275/50R21': 1,
    '235/55R18': 2,
  },
} as const;
