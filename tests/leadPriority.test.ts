// ═══════════════════════════════════════════════════════════════════
//  tests/leadPriority.test.ts
//  Run: npx tsx tests/leadPriority.test.ts
//
//  Pure helper test for computeLeadPriority(). Covers every cell in
//  the badge mapping table (VIP, Fleet, High Value, Repeat Customer,
//  New Lead) plus the test-lead override (id starts with 'lead-test-'
//  → score -1) plus null-customer fallback.
// ═══════════════════════════════════════════════════════════════════

import { computeLeadPriority } from '../src/lib/leadPriority';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

function lead(over: Record<string, unknown> = {}) {
  return { id: 'lead-3055551234-2026-06-04', wasNewCustomer: false, ...over };
}

console.log('\n── VIP alone (Platinum, individual, jobCount≥1) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Platinum', kind: 'individual', jobCount: 5 },
    lead(),
  );
  check('score is 100', out.score === 100, `got ${out.score}`);
  check('exactly 1 badge', out.badges.length === 1);
  check('badge is VIP', out.badges[0].key === 'vip' && out.badges[0].label === 'VIP');
}

console.log('\n── VIP + Fleet (Platinum fleet) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Platinum', kind: 'fleet', jobCount: 12 },
    lead(),
  );
  check('score is 180', out.score === 180, `got ${out.score}`);
  check('2 badges', out.badges.length === 2);
  check('contains VIP', out.badges.some(b => b.key === 'vip'));
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
}

console.log('\n── High Value alone (Gold, individual) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Gold', kind: 'individual', jobCount: 3 },
    lead(),
  );
  check('score is 60', out.score === 60, `got ${out.score}`);
  check('badge is High Value', out.badges[0].key === 'high_value');
}

console.log('\n── High Value + Fleet (Gold fleet) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Gold', kind: 'fleet', jobCount: 6 },
    lead(),
  );
  check('score is 140', out.score === 140, `got ${out.score}`);
  check('contains High Value', out.badges.some(b => b.key === 'high_value'));
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
}

console.log('\n── Repeat Customer alone (Standard with history) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'individual', jobCount: 3 },
    lead(),
  );
  check('score is 40', out.score === 40, `got ${out.score}`);
  check('badge is Repeat Customer', out.badges[0].key === 'repeat_customer');
}

console.log('\n── Repeat Customer + Fleet (Standard fleet with history) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'fleet', jobCount: 4 },
    lead(),
  );
  check('score is 120', out.score === 120, `got ${out.score}`);
  check('contains Repeat Customer', out.badges.some(b => b.key === 'repeat_customer'));
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
}

console.log('\n── New Lead alone (wasNewCustomer=true) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'individual', jobCount: 0 },
    lead({ wasNewCustomer: true }),
  );
  check('score is 20', out.score === 20, `got ${out.score}`);
  check('badge is New Lead', out.badges[0].key === 'new_customer');
}

console.log('\n── New Lead alone (jobCount===0, wasNewCustomer=false) ──');
{
  // Edge case: Customer existed (via backfill) but had 0 jobs.
  // Should also flag as New Lead.
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'individual', jobCount: 0 },
    lead({ wasNewCustomer: false }),
  );
  check('score is 20', out.score === 20);
  check('badge is New Lead', out.badges[0].key === 'new_customer');
}

console.log('\n── Fleet + New Lead (unknown fleet caller, first call) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Standard', kind: 'fleet', jobCount: 0 },
    lead({ wasNewCustomer: true }),
  );
  check('score is 100 (80 + 20)', out.score === 100, `got ${out.score}`);
  check('contains Fleet', out.badges.some(b => b.key === 'fleet'));
  check('contains New Lead', out.badges.some(b => b.key === 'new_customer'));
}

console.log('\n── Test lead override (id starts with lead-test-) ──');
{
  const out = computeLeadPriority(
    { vipTier: 'Platinum', kind: 'fleet', jobCount: 99 },     // even a Platinum fleet
    { id: 'lead-test-uid-1717480000000', wasNewCustomer: false },
  );
  check('score is -1 (test override)', out.score === -1, `got ${out.score}`);
  check('no badges on test leads', out.badges.length === 0);
}

console.log('\n── Null customer fallback (defensive) ──');
{
  const out = computeLeadPriority(null, lead({ wasNewCustomer: true }));
  check('score is 20 (new lead fallback)', out.score === 20, `got ${out.score}`);
  check('badge is New Lead', out.badges[0]?.key === 'new_customer');
}

console.log('\n── Undefined customer fallback ──');
{
  const out = computeLeadPriority(undefined, lead({ wasNewCustomer: false }));
  // Customer absent + wasNewCustomer false → still treated as New Lead
  check('score is 20', out.score === 20);
  check('badge is New Lead', out.badges[0]?.key === 'new_customer');
}

console.log('\n── Score-DESC sort produces the expected ordering ──');
{
  // Build the 9 reference rows from the spec and confirm they sort
  // into the documented priority order.
  type Row = { label: string; score: number };
  const rows: Row[] = [
    { label: 'VIP + Fleet',         score: computeLeadPriority({ vipTier: 'Platinum', kind: 'fleet',      jobCount: 9 }, lead()).score },
    { label: 'High Value + Fleet',   score: computeLeadPriority({ vipTier: 'Gold',     kind: 'fleet',      jobCount: 4 }, lead()).score },
    { label: 'Repeat + Fleet',       score: computeLeadPriority({ vipTier: 'Standard', kind: 'fleet',      jobCount: 4 }, lead()).score },
    { label: 'VIP alone',            score: computeLeadPriority({ vipTier: 'Platinum', kind: 'individual', jobCount: 5 }, lead()).score },
    { label: 'Fleet + New',          score: computeLeadPriority({ vipTier: 'Standard', kind: 'fleet',      jobCount: 0 }, lead({ wasNewCustomer: true })).score },
    { label: 'High Value alone',     score: computeLeadPriority({ vipTier: 'Gold',     kind: 'individual', jobCount: 3 }, lead()).score },
    { label: 'Repeat alone',         score: computeLeadPriority({ vipTier: 'Standard', kind: 'individual', jobCount: 3 }, lead()).score },
    { label: 'New Lead alone',       score: computeLeadPriority({ vipTier: 'Standard', kind: 'individual', jobCount: 0 }, lead({ wasNewCustomer: true })).score },
  ];
  const sorted = [...rows].sort((a, b) => b.score - a.score).map(r => r.label);
  const expected = [
    'VIP + Fleet',
    'High Value + Fleet',
    'Repeat + Fleet',
    'VIP alone',
    'Fleet + New',           // ties with VIP alone at 100; order between ties is implementation-defined
    'High Value alone',
    'Repeat alone',
    'New Lead alone',
  ];
  // Normalize: VIP alone (100) and Fleet + New (100) may swap positions
  // since both are 100 — drop their relative ordering from the assertion.
  const sortedFiltered  = sorted .filter(l => l !== 'VIP alone' && l !== 'Fleet + New');
  const expectedFiltered = expected.filter(l => l !== 'VIP alone' && l !== 'Fleet + New');
  check('sorted order matches the documented natural ordering',
    JSON.stringify(sortedFiltered) === JSON.stringify(expectedFiltered),
    `got ${JSON.stringify(sorted)}`);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
