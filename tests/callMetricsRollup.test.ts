// tests/callMetricsRollup.test.ts
// Run: npx tsx tests/callMetricsRollup.test.ts
//
// Pure daily call-metrics rollup: inbound/answered/missed counts,
// answer rate, avg answered talk time, status breakdown.

import { _computeCallMetrics } from '../functions/src/onCallWriteRollup';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const DATE = '2026-06-07';

console.log('\n── computeCallMetrics ──');
{
  const calls = [
    { direction: 'inbound', status: 'completed', answered: true, durationSec: 60 },
    { direction: 'inbound', status: 'completed', answered: true, durationSec: 120 },
    { direction: 'inbound', status: 'no-answer', answered: false, durationSec: 0 },
    { direction: 'outbound', status: 'completed', answered: true, durationSec: 30 }, // not inbound
  ];
  const m = _computeCallMetrics(calls, DATE);
  check('date carried', m.date === DATE);
  check('total = 4 (all calls)', m.total === 4);
  check('inbound = 3', m.inbound === 3, `got ${m.inbound}`);
  check('answered = 2 (inbound-scoped; outbound excluded)', m.answered === 2, `got ${m.answered}`);
  check('missed = 1', m.missed === 1, `got ${m.missed}`);
  check('answerRatePct = 67 (2 / 3)', m.answerRatePct === 67, `got ${m.answerRatePct}`);
  check('avgAnsweredDurationSec = 90 ((60+120)/2, inbound only)', m.avgAnsweredDurationSec === 90, `got ${m.avgAnsweredDurationSec}`);
  check('byStatus.completed = 3 (status counts all calls)', m.byStatus.completed === 3);
  check('byStatus["no-answer"] = 1', m.byStatus['no-answer'] === 1);
}

console.log('\n── missed = inbound − inbound-answered ──');
{
  // 3 inbound, 2 of them answered → missed 1.
  const calls = [
    { direction: 'inbound', answered: true, durationSec: 10, status: 'completed' },
    { direction: 'inbound', answered: true, durationSec: 10, status: 'completed' },
    { direction: 'inbound', answered: false, durationSec: 0, status: 'busy' },
  ];
  const m = _computeCallMetrics(calls, DATE);
  check('inbound = 3', m.inbound === 3);
  check('answered = 2', m.answered === 2);
  check('missed = 1', m.missed === 1, `got ${m.missed}`);
}

console.log('\n── empty day ──');
{
  const m = _computeCallMetrics([], DATE);
  check('total 0', m.total === 0);
  check('answerRatePct 0 (no inbound)', m.answerRatePct === 0);
  check('avgAnsweredDurationSec 0', m.avgAnsweredDurationSec === 0);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
