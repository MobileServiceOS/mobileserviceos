// tests/bandileroAlerts.test.ts
// Run: npx tsx tests/bandileroAlerts.test.ts
//
// Alerts fire at the right thresholds; each Action carries a real
// number + source; Top-3 Actions are ranked by dollar impact desc.
// Modeled impacts are ESTIMATED; real-dollar impacts are LIVE.

import { computeAlerts, topActions, type AlertInput } from '@/lib/bandilero/alerts';
import { live, estimated, notConnected } from '@/lib/bandilero/confidence';
import type { AgingRow } from '@/lib/insights';
import type { MissedCallMetrics } from '@/lib/bandilero/services/callIntel';
import type { InventoryAlertMetrics } from '@/lib/bandilero/services/inventory';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const aging = (over: Partial<Record<string, number>> = {}): AgingRow[] => ([
  { bucket: '0-7d',   count: over['0-7dCount'] ?? 0, total: over['0-7d'] ?? 0 },
  { bucket: '8-30d',  count: over['8-30dCount'] ?? 0, total: over['8-30d'] ?? 0 },
  { bucket: '31-60d', count: over['31-60dCount'] ?? 0, total: over['31-60d'] ?? 0 },
  { bucket: '60d+',   count: over['60d+Count'] ?? 0, total: over['60d+'] ?? 0 },
]);

const calls = (lostRev: MissedCallMetrics['lostRevenue']): MissedCallMetrics => ({
  count: live(3, 'leads'), recovered: live(1, 'leads'), unrecovered: live(2, 'leads'), lostRevenue: lostRev,
});

const inv = (over: Partial<{ critical: number; low: number; dead: number; deadValue: number }>): InventoryAlertMetrics => ({
  critical: live(over.critical ?? 0, 'inventory'),
  low: live(over.low ?? 0, 'inventory'),
  dead: live(over.dead ?? 0, 'inventory'),
  deadValue: live(over.deadValue ?? 0, 'inventory'),
});

const fullInput: AlertInput = {
  unpaidAging: aging({ '0-7d': 100, '0-7dCount': 1, '60d+': 500, '60d+Count': 1 }),
  missedCalls: calls(estimated(300, 'est. 2 unrecovered missed call(s) × avg ticket $150', 'leads')),
  unrecoveredCount: 2,
  inventory: inv({ critical: 2, dead: 1, deadValue: 320 }),
  avgTicket: 150,
};

console.log('\n── computeAlerts: all signals present ──');
{
  const actions = computeAlerts(fullInput);
  const byId = Object.fromEntries(actions.map(a => [a.id, a]));
  check('4 alerts fire', actions.length === 4, `got ${actions.length}`);
  check('unpaid impact LIVE 600 (100+500)', byId['unpaid-invoices']?.impact.value === 600, `got ${byId['unpaid-invoices']?.impact.value}`);
  check('unpaid severity high (oldest 60d+)', byId['unpaid-invoices']?.severity === 'high');
  check('missed-calls impact ESTIMATED 300', byId['missed-calls']?.impact.state === 'ESTIMATED' && byId['missed-calls']?.impact.value === 300);
  check('critical-stock impact ESTIMATED 300 (2×150)', byId['critical-stock']?.impact.state === 'ESTIMATED' && byId['critical-stock']?.impact.value === 300);
  check('dead-stock impact LIVE 320', byId['dead-stock']?.impact.state === 'LIVE' && byId['dead-stock']?.impact.value === 320);
  check('every action has a source', actions.every(a => !!a.source));
}

console.log('\n── topActions: ranked by dollar impact desc ──');
{
  const top = topActions(computeAlerts(fullInput), 3);
  check('top 3 returned', top.length === 3);
  check('#1 = unpaid (600)', top[0].id === 'unpaid-invoices', top[0].id);
  check('#2 = dead-stock (320)', top[1].id === 'dead-stock', top[1].id);
  check('#3 impact = 300', top[2].impact.value === 300, `got ${top[2].impact.value}`);
}

console.log('\n── thresholds: nothing fires at zero ──');
{
  const none = computeAlerts({
    unpaidAging: aging(),
    missedCalls: calls(notConnected('Twilio not connected', 'leads')),
    unrecoveredCount: 0,
    inventory: inv({}),
    avgTicket: 0,
  });
  check('no alerts when everything is zero/not-connected', none.length === 0, `got ${none.length}`);
}

console.log('\n── threshold boundaries ──');
{
  // Unpaid: $0 → no alert; $1 → alert.
  check('unpaid $0 → no alert', computeAlerts({ ...fullInput, unpaidAging: aging() }).some(a => a.id === 'unpaid-invoices') === false);
  check('unpaid $1 → alert', computeAlerts({ ...fullInput, unpaidAging: aging({ '0-7d': 1, '0-7dCount': 1 }) }).some(a => a.id === 'unpaid-invoices'));

  // Missed calls: NOT_CONNECTED lostRevenue → no alert even if other inputs set.
  check('missed NOT_CONNECTED → no missed alert',
    computeAlerts({ ...fullInput, missedCalls: calls(notConnected('off', 'leads')) }).some(a => a.id === 'missed-calls') === false);

  // Critical stock: count 0 → no alert; avgTicket 0 → no alert.
  check('critical 0 → no alert', computeAlerts({ ...fullInput, inventory: inv({ critical: 0 }) }).some(a => a.id === 'critical-stock') === false);
  check('avgTicket 0 → no critical alert', computeAlerts({ ...fullInput, avgTicket: 0 }).some(a => a.id === 'critical-stock') === false);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
