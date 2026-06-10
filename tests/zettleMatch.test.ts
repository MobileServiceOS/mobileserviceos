// ═══════════════════════════════════════════════════════════════════
//  tests/zettleMatch.test.ts
//  Run: npx tsx tests/zettleMatch.test.ts   (also runs via `npm test`)
//
//  Pure-logic tests for scoreZettleMatch() — the PayPal Zettle
//  payment→job matcher. Confirms the conservative confidence rules:
//  only unambiguous matches go 'high' (auto-apply); ambiguity → 'low'
//  (owner review); no amount match → 'none'.
// ═══════════════════════════════════════════════════════════════════

import { scoreZettleMatch } from '../functions/src/lib/zettleMatch';
import type { MatchJobCandidate } from '../functions/src/lib/zettleMatch';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const T = Date.parse('2026-06-10T15:00:00Z'); // payment time
function job(over: Partial<MatchJobCandidate> = {}): MatchJobCandidate {
  return { id: 'job-1', amountCents: 15000, completedAtMs: T, ...over };
}

console.log('\n── exact single amount → HIGH ──');
{
  const out = scoreZettleMatch({ amountCents: 15000, timestampMs: T }, [job()]);
  check('jobId is job-1', out.jobId === 'job-1', JSON.stringify(out));
  check('confidence high', out.confidence === 'high');
}

console.log('\n── no amount match → NONE ──');
{
  const out = scoreZettleMatch({ amountCents: 9999, timestampMs: T }, [job()]);
  check('jobId null', out.jobId === null);
  check('confidence none', out.confidence === 'none', out.confidence);
  check('no candidates', out.candidateJobIds.length === 0);
}

console.log('\n── two same-amount jobs in window, phone disambiguates → HIGH ──');
{
  const out = scoreZettleMatch(
    { amountCents: 15000, timestampMs: T, customerPhone: '+1 (305) 555-1234' },
    [
      job({ id: 'a', customerPhone: '3055551234' }),
      job({ id: 'b', customerPhone: '7865550000' }),
    ],
  );
  check('picks phone match a', out.jobId === 'a', JSON.stringify(out));
  check('confidence high', out.confidence === 'high');
  check('both listed as candidates', out.candidateJobIds.length === 2);
}

console.log('\n── two same-amount jobs in window, no disambiguator → LOW ──');
{
  const out = scoreZettleMatch({ amountCents: 15000, timestampMs: T }, [
    job({ id: 'a' }),
    job({ id: 'b' }),
  ]);
  check('jobId null', out.jobId === null, JSON.stringify(out));
  check('confidence low', out.confidence === 'low');
  check('two candidates for review', out.candidateJobIds.length === 2);
}

console.log('\n── two same-amount in window, name breaks tie → HIGH ──');
{
  const out = scoreZettleMatch(
    { amountCents: 15000, timestampMs: T, customerName: 'John  Smith' },
    [
      job({ id: 'a', customerName: 'john smith' }),
      job({ id: 'b', customerName: 'Jane Doe' }),
    ],
  );
  check('picks name match a', out.jobId === 'a', JSON.stringify(out));
  check('confidence high', out.confidence === 'high');
}

console.log('\n── single exact-amount job OUTSIDE window → HIGH (only candidate) ──');
{
  const farMs = T - 1000 * 60 * 60 * 24; // 24h earlier (default window 240min)
  const out = scoreZettleMatch({ amountCents: 15000, timestampMs: T }, [
    job({ id: 'lonely', completedAtMs: farMs }),
  ]);
  check('jobId lonely', out.jobId === 'lonely', JSON.stringify(out));
  check('confidence high', out.confidence === 'high');
}

console.log('\n── several same-amount, none in window, no tie-break → LOW ──');
{
  const farMs = T - 1000 * 60 * 60 * 24;
  const out = scoreZettleMatch({ amountCents: 15000, timestampMs: T }, [
    job({ id: 'a', completedAtMs: farMs }),
    job({ id: 'b', completedAtMs: farMs - 5000 }),
  ]);
  check('jobId null', out.jobId === null, JSON.stringify(out));
  check('confidence low', out.confidence === 'low');
}

console.log('\n── respects custom window: in-window single → HIGH ──');
{
  const out = scoreZettleMatch(
    { amountCents: 15000, timestampMs: T },
    [job({ id: 'x', completedAtMs: T + 1000 * 60 * 90 })], // 90 min later
    { windowMinutes: 120 },
  );
  check('jobId x', out.jobId === 'x' && out.confidence === 'high', JSON.stringify(out));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} zettleMatch: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
