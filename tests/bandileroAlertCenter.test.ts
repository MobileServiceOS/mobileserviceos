// tests/bandileroAlertCenter.test.ts
// Run: npx tsx tests/bandileroAlertCenter.test.ts
//
// Alert Center categorization: Critical (high-severity threats),
// Warning (medium), Opportunity (pricing + win-back). Real alerts only.

import { buildAlertCenter, categorizeAlert } from '@/lib/bandilero/services/alertCenter';
import { live, estimated } from '@/lib/bandilero/confidence';
import type { Action, ActionSeverity } from '@/lib/bandilero/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const action = (id: string, sev: ActionSeverity, impact: number): Action =>
  ({ id, title: id, detail: '', severity: sev, impact: impact >= 0 ? live(impact, 'jobs') : estimated(1, 'x', 'jobs'), source: 'jobs' });

console.log('\n── categorizeAlert ──');
{
  check('out-of-stock high → critical', categorizeAlert(action('critical-stock', 'high', 300)) === 'critical');
  check('unpaid high → critical', categorizeAlert(action('unpaid-invoices', 'high', 600)) === 'critical');
  check('missed-calls medium → warning', categorizeAlert(action('missed-calls', 'medium', 200)) === 'warning');
  check('dead-stock low → warning', categorizeAlert(action('dead-stock', 'low', 320)) === 'warning');
  check('pricing → opportunity (any severity)', categorizeAlert(action('pricing-Tire-225', 'low', 120)) === 'opportunity');
  check('churn → opportunity', categorizeAlert(action('risk-churn', 'medium', 500)) === 'opportunity');
}

console.log('\n── buildAlertCenter ──');
{
  const recs = [
    action('critical-stock', 'high', 300),
    action('unpaid-invoices', 'high', 600),
    action('missed-calls', 'medium', 200),
    action('pricing-Tire-225', 'low', 120),
    action('risk-churn', 'medium', 500),
    action('dead-stock', 'low', 320),
  ];
  const c = buildAlertCenter(recs);
  check('total = 6', c.total === 6);
  check('critical = 2 (out-of-stock + unpaid)', c.critical.length === 2);
  check('critical sorted by impact (unpaid 600 first)', c.critical[0].id === 'unpaid-invoices');
  check('warning = 2 (missed-calls + dead-stock)', c.warning.length === 2);
  check('opportunity = 2 (pricing + churn)', c.opportunity.length === 2);
  check('opportunity sorted (churn 500 before pricing 120)', c.opportunity[0].id === 'risk-churn');
}

console.log('\n── empty ──');
{
  const c = buildAlertCenter([]);
  check('all empty + total 0', c.total === 0 && c.critical.length === 0 && c.warning.length === 0 && c.opportunity.length === 0);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
