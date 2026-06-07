// tests/bandileroReputation.test.ts
// Run: npx tsx tests/bandileroReputation.test.ts
//
// Reputation scaffold: every metric NOT_CONNECTED today (no GBP/GSC) —
// never a fabricated rating; draft-for-approval auto-reply mode; connect
// path present. Plus config resolver (defaults when absent, clamped).

import { reputationStatus } from '@/lib/bandilero/services/reputation';
import { resolveConfig, DEFAULT_CONFIG } from '@/lib/bandilero/config';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── reputationStatus (no GBP/GSC) ──');
{
  const r = reputationStatus({ gbp: false, seo: false });
  const m = r.metrics;
  check('reviewScore NOT_CONNECTED (no fake rating)', m.reviewScore.state === 'NOT_CONNECTED' && m.reviewScore.value === null);
  check('reviewCount NOT_CONNECTED', m.reviewCount.state === 'NOT_CONNECTED' && m.reviewCount.value === null);
  check('searchImpressions NOT_CONNECTED', m.searchImpressions.state === 'NOT_CONNECTED' && m.searchImpressions.value === null);
  check('gbpViews NOT_CONNECTED', m.gbpViews.state === 'NOT_CONNECTED' && m.gbpViews.value === null);
  check('auto-reply mode is draft_for_approval (never auto-send)', r.autoReplyMode === 'draft_for_approval');
  check('GBP connect steps present', r.connectStepsGbp.length > 0);
  check('GSC connect steps present', r.connectStepsGsc.length > 0);
}

console.log('\n── resolveConfig ──');
{
  check('absent → defaults', JSON.stringify(resolveConfig()) === JSON.stringify(DEFAULT_CONFIG));
  check('null → defaults', resolveConfig(null).windowDays === DEFAULT_CONFIG.windowDays);
  check('valid value used', resolveConfig({ windowDays: 14 }).windowDays === 14);
  check('over-max clamped (500 → 90)', resolveConfig({ windowDays: 500 }).windowDays === 90);
  check('under-min clamped (0 → 1)', resolveConfig({ windowDays: 0 }).windowDays === 1);
  check('invalid type → default', resolveConfig({ windowDays: 'x' as unknown as number }).windowDays === DEFAULT_CONFIG.windowDays);
  check('revenueDeclinePct passthrough', resolveConfig({ revenueDeclinePct: 25 }).revenueDeclinePct === 25);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
