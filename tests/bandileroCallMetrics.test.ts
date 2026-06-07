// tests/bandileroCallMetrics.test.ts
// Run: npx tsx tests/bandileroCallMetrics.test.ts
//
// Bandilero call-volume reader over the daily callMetrics rollups.
// Twilio off → NOT_CONNECTED (never a fake 0%); window filtering;
// answer-rate/talk-time NOT_CONNECTED until there's real inbound volume.

import { callVolumeMetrics, type CallMetricsDay } from '@/lib/bandilero/services/callMetrics';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const day = (o: Partial<CallMetricsDay>): CallMetricsDay =>
  ({ date: TODAY, total: 0, inbound: 0, answered: 0, missed: 0, answerRatePct: 0, avgAnsweredDurationSec: 0, ...o });

console.log('\n── Twilio OFF → all NOT_CONNECTED (not 0%) ──');
{
  const m = callVolumeMetrics([day({ inbound: 10, answered: 8 })], { twilio: false }, TODAY, 7);
  check('inboundVolume NOT_CONNECTED', m.inboundVolume.state === 'NOT_CONNECTED' && m.inboundVolume.value === null);
  check('answerRate NOT_CONNECTED', m.answerRate.state === 'NOT_CONNECTED');
  check('avgTalkTime NOT_CONNECTED', m.avgTalkTimeMin.state === 'NOT_CONNECTED');
}

console.log('\n── Twilio ON, calls present → LIVE ──');
{
  const days = [
    day({ date: '2026-06-06', inbound: 4, answered: 3, missed: 1, avgAnsweredDurationSec: 120 }),
    day({ date: '2026-06-07', inbound: 6, answered: 3, missed: 3, avgAnsweredDurationSec: 240 }),
    day({ date: '2026-05-20', inbound: 99, answered: 99, avgAnsweredDurationSec: 600 }), // outside 7d window
  ];
  const m = callVolumeMetrics(days, { twilio: true }, TODAY, 7);
  // window: inbound 10, answered 6 → rate 60%
  check('inboundVolume LIVE = 10', m.inboundVolume.state === 'LIVE' && m.inboundVolume.value === 10, `got ${m.inboundVolume.value}`);
  check('answerRate LIVE = 60', m.answerRate.value === 60, `got ${m.answerRate.value}`);
  // talk time: (120*3 + 240*3) / 6 = (360+720)/6 = 180s → 3 min
  check('avgTalkTimeMin LIVE = 3', m.avgTalkTimeMin.value === 3, `got ${m.avgTalkTimeMin.value}`);
  check('missed LIVE = 4', m.missed.value === 4, `got ${m.missed.value}`);
  check('out-of-window day excluded', m.inboundVolume.value === 10);
}

console.log('\n── Twilio ON, no inbound → volume LIVE 0, rate NOT_CONNECTED ──');
{
  const m = callVolumeMetrics([], { twilio: true }, TODAY, 7);
  check('inboundVolume LIVE 0 (real fact when connected)', m.inboundVolume.state === 'LIVE' && m.inboundVolume.value === 0);
  check('answerRate NOT_CONNECTED (cannot compute from 0 inbound)', m.answerRate.state === 'NOT_CONNECTED');
  check('avgTalkTime NOT_CONNECTED', m.avgTalkTimeMin.state === 'NOT_CONNECTED');
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
