// tests/bandileroCommandCore.test.ts
// Run: npx tsx tests/bandileroCommandCore.test.ts
//
// AI Core model: node alert counts map from REAL alert ids, core state
// from real critical/total counts, node descriptors carry module health.
// Nothing fabricated.

import { nodeForAlert, alertCountsByNode, coreStateFrom, buildCoreNodes, type NodeKey } from '@/lib/bandilero/commandCore';
import { live } from '@/lib/bandilero/confidence';
import type { Action, ActionSeverity } from '@/lib/bandilero/types';
import type { ModuleStatus } from '@/lib/bandilero/moduleStatus';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}
const action = (id: string, sev: ActionSeverity = 'medium'): Action =>
  ({ id, title: id, detail: '', severity: sev, impact: live(1, 'jobs'), source: 'jobs' });

console.log('\n── nodeForAlert mapping ──');
{
  check('pricing-* → pricing', nodeForAlert('pricing-Tire-225') === 'pricing');
  check('risk-churn → customers', nodeForAlert('risk-churn') === 'customers');
  check('unpaid → revenue', nodeForAlert('unpaid-invoices') === 'revenue');
  check('revenue-decline → revenue', nodeForAlert('risk-revenue-decline') === 'revenue');
  check('critical-stock → inventory', nodeForAlert('critical-stock') === 'inventory');
  check('dead-stock → inventory', nodeForAlert('dead-stock') === 'inventory');
  check('missed-calls → growth', nodeForAlert('missed-calls') === 'growth');
  check('unknown → null', nodeForAlert('whatever') === null);
}

console.log('\n── alertCountsByNode ──');
{
  const counts = alertCountsByNode([action('unpaid-invoices'), action('critical-stock'), action('dead-stock'), action('pricing-x'), action('risk-churn')]);
  check('revenue 1', counts.revenue === 1);
  check('inventory 2', counts.inventory === 2);
  check('pricing 1', counts.pricing === 1);
  check('customers 1', counts.customers === 1);
  check('dispatch 0', counts.dispatch === 0);
}

console.log('\n── coreStateFrom ──');
{
  check('critical>0 → alert', coreStateFrom(1, 3) === 'alert');
  check('no critical, some total → analyzing', coreStateFrom(0, 2) === 'analyzing');
  check('nothing → healthy', coreStateFrom(0, 0) === 'healthy');
}

console.log('\n── buildCoreNodes ──');
{
  const st: Record<NodeKey, ModuleStatus> = {
    revenue: 'CONNECTED', customers: 'CONNECTED', pricing: 'CONNECTED', inventory: 'CONNECTED',
    dispatch: 'PARTIAL', reputation: 'NOT_CONNECTED', seo: 'NOT_CONNECTED', growth: 'CONNECTED',
  };
  const nodes = buildCoreNodes(st, [action('critical-stock'), action('critical-stock')]);
  check('8 nodes', nodes.length === 8);
  check('inventory node has 2 alerts + CONNECTED', (() => { const n = nodes.find((x) => x.key === 'inventory')!; return n.alerts === 2 && n.status === 'CONNECTED'; })());
  check('dispatch node PARTIAL, 0 alerts', (() => { const n = nodes.find((x) => x.key === 'dispatch')!; return n.status === 'PARTIAL' && n.alerts === 0; })());
  check('seo node NOT_CONNECTED', nodes.find((x) => x.key === 'seo')!.status === 'NOT_CONNECTED');
  check('every node has label + icon + targetId', nodes.every((n) => !!n.label && !!n.icon && n.targetId.startsWith('bnd-mod-')));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
