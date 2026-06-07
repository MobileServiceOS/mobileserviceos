// tests/bandileroCommandConsole.test.ts
// Run: npx tsx tests/bandileroCommandConsole.test.ts
//
// AI command console intent router: maps queries to REAL deterministic
// service outputs. Financial answers redacted for techs; unknown query →
// guidance (never invents); NOT_CONNECTED surfaced honestly.

import { answerQuery, type ConsoleContext } from '@/lib/bandilero/commandConsole';
import { live } from '@/lib/bandilero/confidence';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const M = (n: number) => live(n, 'jobs');
function ctx(over: Partial<ConsoleContext> = {}): ConsoleContext {
  return {
    finance: {
      revenueToday: M(1500), revenueWeek: M(5000), revenueMonth: M(20000),
      profitToday: M(500), grossProfitWeek: M(3000), netProfitMonth: M(15000),
      distributableWeek: M(2500),
      revenueByService: [{ label: 'Tire Replacement', total: 12000 }],
      revenueByCity: [], revenueByCustomer: [], revenueByTechnician: [],
    } as unknown as ConsoleContext['finance'],
    customers: {
      inactive90Count: M(14), inactive90: [{ name: 'Dan' }, { name: 'Eve' }],
      bestCustomers: [{ name: 'Alice', revenue: 3000 }, { name: 'Bob', revenue: 1200 }],
      topServices: [{ value: 'Tire Replacement', count: 10 }],
      topTireSizes: [{ value: '225/65R17', count: 7 }],
      returningCustomers: M(20), returningRatePct: M(60),
      cityTrends: [{ city: 'Miami', total: 9, repeat: 6, repeatPct: 67 }],
    } as unknown as ConsoleContext['customers'],
    inventory: {
      reorderCount: M(2),
      reorderList: [{ item: { size: '235/45R18' } }, { item: { size: '225/65R17' } }],
    } as unknown as ConsoleContext['inventory'],
    alertCenter: { critical: [], warning: [{ id: 'risk-revenue-decline', title: 'Revenue trending down', detail: 'Down 18% week over week.' }], opportunity: [], total: 1 } as unknown as ConsoleContext['alertCenter'],
    connectivity: { ai: false, twilio: false, reviews: false, gbp: false, seo: false, dispatch: false },
    canViewFinancials: true,
    ...over,
  };
}

console.log('\n── deterministic answers from real outputs ──');
{
  const c = ctx();
  check("today's profit → $500", answerQuery("Show today's profit.", c).text.includes('$500'));
  check('revenue this month → $20,000', answerQuery('revenue this month', c).text.includes('$20,000'));
  check('revenue this week → $5,000', answerQuery('what was sales this week', c).text.includes('$5,000'));
  check('inactive 90 → 14 + names', (() => { const a = answerQuery('which customers are inactive 90 days?', c); return a.text.includes('14') && a.text.includes('Dan'); })());
  check('top service by revenue → Tire Replacement $12,000', (() => { const a = answerQuery('what service generated the most revenue?', c); return a.text.includes('Tire Replacement') && a.text.includes('$12,000'); })());
  check('common tire size → 225/65R17', answerQuery('what is the most common tire size', c).text.includes('225/65R17'));
  check('repeat rate → 60%', answerQuery('what is my repeat rate', c).text.includes('60%'));
  check('reorder → 2 + item', (() => { const a = answerQuery('what should I reorder', c); return a.text.includes('2') && a.text.includes('235/45R18'); })());
  check('distributable → $2,500', answerQuery('what is my payout this week', c).text.includes('$2,500'));
  check('best customers → Alice', answerQuery('who are my best customers', c).text.includes('Alice'));
  check('city repeat → Miami 67%', (() => { const a = answerQuery('which city has the best repeat customers', c); return a.text.includes('Miami') && a.text.includes('67%'); })());
  check('attention → alert summary', answerQuery('what needs my attention?', c).text.includes('warning'));
}

console.log('\n── why-decrease uses the REAL decline detail ──');
{
  check('why profit down → real decline detail', answerQuery('why did profit decrease this week?', ctx()).text.includes('Down 18%'));
  const noDecline = ctx({ alertCenter: { critical: [], warning: [], opportunity: [], total: 0 } as unknown as ConsoleContext['alertCenter'] });
  check('no decline → honest "no decline"', answerQuery('why is revenue down', noDecline).text.toLowerCase().includes('no significant'));
}

console.log('\n── honesty: redaction + unknown ──');
{
  const tech = ctx({ canViewFinancials: false });
  check('financial query as tech → restricted (not faked)', (() => { const a = answerQuery("show today's profit", tech); return a.matched && a.text.includes('owners and admins'); })());
  check('non-financial query still answers for tech', answerQuery('most common tire size', tech).text.includes('225/65R17'));
  const unknown = answerQuery('what is the weather tomorrow', ctx());
  check('unknown query → matched:false + guidance (no invention)', unknown.matched === false && unknown.text.includes('real data'));
  check('empty query → guidance', answerQuery('', ctx()).matched === false);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
