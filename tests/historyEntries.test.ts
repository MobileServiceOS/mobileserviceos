// tests/historyEntries.test.ts
// Run: npx tsx tests/historyEntries.test.ts

import { historyEntries } from '@/lib/jobLifecycle';
import { resolveLifecycle } from '@/config/jobs';
import type { Job } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';
import type { LifecycleTransition } from '@/config/jobs/lifecycle';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const stubVertical: BusinessTypeConfig = {
  key: 'tire', displayName: 'stub', shortName: 'stub',
  pricingModel: { kind: 'flat' },
  services: [], jobFields: [], inventoryFields: [],
  copy: { jobNounSingular: 'job', jobNounPlural: 'jobs', emptyJobsHint: '', inventoryLabel: '' },
  defaultExpenseCategories: [],
  features: { inventoryDeduction: false, photoCapture: false, vehicleDiagnostics: false, vehicleSizeMultiplier: false, roadsideAddons: false },
  invoiceTemplateKey: 'tire', dashboardMetrics: [],
};
const resolved = resolveLifecycle(stubVertical);
const directory: Record<string, string> = { 'u1': 'Alice', 'u2': 'Owner' };
const resolveName = (uid: string | undefined | null): string | null =>
  uid ? directory[uid] ?? null : null;

const t = (over: Partial<LifecycleTransition> = {}): LifecycleTransition => ({
  toStage: 'dispatched', at: '2026-05-21T10:00:00Z', byUid: 'u1', ...over,
});

console.log('\n┌─ historyEntries ──────────────────────────────────');

check('undefined transitions → empty array',
  historyEntries({} as Pick<Job, 'transitions'>, resolved, resolveName).length === 0);
check('empty transitions → empty array',
  historyEntries({ transitions: [] }, resolved, resolveName).length === 0);

{
  const rows = historyEntries(
    { transitions: [t({ toStage: 'dispatched', byUid: 'u2' })] },
    resolved, resolveName,
  );
  check('single entry: 1 row', rows.length === 1);
  check('stage label resolved', rows[0].stageLabel === 'Dispatched');
  check('actor resolved', rows[0].actorLabel === 'Owner');
  check('outOfFlow false by default', rows[0].outOfFlow === false);
}

{
  const rows = historyEntries({
    transitions: [
      t({ at: '2026-05-21T08:00:00Z', toStage: 'scheduled' }),
      t({ at: '2026-05-21T09:00:00Z', toStage: 'dispatched' }),
      t({ at: '2026-05-21T10:00:00Z', toStage: 'enroute' }),
    ],
  }, resolved, resolveName);
  check('3 entries returned', rows.length === 3);
  check('newest-first ordering (enroute first)', rows[0].stageLabel === 'En route');
  check('newest-first ordering (scheduled last)', rows[2].stageLabel === 'Scheduled');
}

{
  const rows = historyEntries({
    transitions: [t({ toStage: 'in_progress', fromStage: 'onsite' })],
  }, resolved, resolveName);
  check('fromStage label resolved', rows[0].fromStageLabel === 'On-site');
}

{
  const rows = historyEntries({
    transitions: [t({ byUid: 'ghost' })],
  }, resolved, resolveName);
  check('unknown uid falls back to "Unknown"', rows[0].actorLabel === 'Unknown');
}

{
  const rows = historyEntries({
    transitions: [t({ outOfFlow: true })],
  }, resolved, resolveName);
  check('outOfFlow true carries through', rows[0].outOfFlow === true);
}

{
  const rows = historyEntries({
    transitions: [t({ note: 'customer paused' })],
  }, resolved, resolveName);
  check('note carries through', rows[0].note === 'customer paused');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
