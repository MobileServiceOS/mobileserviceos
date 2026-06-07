// src/lib/bandilero/commandConsole.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — AI command console (DETERMINISTIC intent router).
//
//  NOT a chatbot and NOT an LLM. A keyword/pattern matcher routes a
//  natural-language query to a handler that reads ALREADY-COMPUTED
//  deterministic service outputs and returns a REAL answer (value +
//  source + confidence). It never invents or hallucinates:
//    • no intent match           → matched:false, a guidance message
//    • data source NOT_CONNECTED  → says NOT CONNECTED + why
//    • a financial answer, tech   → access-restricted message
//
//  (AI may later rephrase the answer text, but the answer itself is
//  always the deterministic service output.)
// ═══════════════════════════════════════════════════════════════════

import { money } from '@/lib/utils';
import type { FinanceIntel } from './services/financeIntel';
import type { CustomerIntel } from './services/customerIntel';
import type { InventoryIntel } from './services/inventoryIntel';
import type { AlertCenter } from './services/alertCenter';
import type { Connectivity } from './types';

export interface ConsoleContext {
  finance: FinanceIntel;
  customers: CustomerIntel;
  inventory: InventoryIntel;
  alertCenter: AlertCenter;
  connectivity: Connectivity;
  canViewFinancials: boolean;
}

export type AnswerConfidence = 'LIVE' | 'ESTIMATED' | 'NOT_CONNECTED';

export interface ConsoleAnswer {
  matched: boolean;
  text: string;
  source?: string;
  confidence?: AnswerConfidence;
}

const RESTRICTED: Omit<ConsoleAnswer, 'matched'> = {
  text: 'Financial answers are available to owners and admins.',
  source: 'Access control',
};

function has(q: string, ...terms: string[]): boolean { return terms.every((t) => q.includes(t)); }
function hasAny(q: string, ...terms: string[]): boolean { return terms.some((t) => q.includes(t)); }

interface Intent {
  id: string;
  financial?: boolean;
  test: (q: string) => boolean;
  run: (c: ConsoleContext) => Omit<ConsoleAnswer, 'matched'>;
}

const FIN = 'Finance Intelligence';
const CUST = 'Customer Intelligence';
const INV = 'Inventory Intelligence';

// Ordered specific → general; first match wins.
const INTENTS: Intent[] = [
  {
    id: 'why-profit-down', financial: true,
    test: (q) => hasAny(q, 'why') && hasAny(q, 'decrease', 'down', 'drop', 'declin', 'lower', 'fall') && hasAny(q, 'profit', 'revenue', 'sales'),
    run: (c) => {
      const decline = c.alertCenter.critical.concat(c.alertCenter.warning).find((a) => a.id === 'risk-revenue-decline');
      if (decline) return { text: decline.detail, source: FIN, confidence: 'LIVE' };
      return { text: 'No significant week-over-week revenue decline is detected right now.', source: FIN, confidence: 'LIVE' };
    },
  },
  {
    id: 'profit-today', financial: true,
    test: (q) => has(q, 'profit') && hasAny(q, 'today'),
    run: (c) => ({ text: `Profit today is ${money(c.finance.profitToday.value ?? 0)}.`, source: FIN, confidence: 'LIVE' }),
  },
  {
    id: 'profit-week', financial: true,
    test: (q) => has(q, 'profit') && hasAny(q, 'week'),
    run: (c) => ({ text: `Gross profit this week is ${money(c.finance.grossProfitWeek.value ?? 0)}.`, source: FIN, confidence: 'LIVE' }),
  },
  {
    id: 'profit-month', financial: true,
    test: (q) => has(q, 'profit') && hasAny(q, 'month'),
    run: (c) => ({ text: `Net profit this month is ${money(c.finance.netProfitMonth.value ?? 0)}.`, source: FIN, confidence: 'LIVE' }),
  },
  {
    id: 'top-service-revenue', financial: true,
    test: (q) => has(q, 'service') && hasAny(q, 'revenue', 'money', 'earn', 'generat'),
    run: (c) => {
      const top = c.finance.revenueByService[0];
      if (!top) return { text: 'No completed jobs this month yet to rank services by revenue.', source: FIN, confidence: 'NOT_CONNECTED' };
      return { text: `"${top.label}" generated the most revenue this month: ${money(top.total)}.`, source: FIN, confidence: 'LIVE' };
    },
  },
  {
    id: 'revenue-month', financial: true,
    test: (q) => hasAny(q, 'revenue', 'sales') && hasAny(q, 'month'),
    run: (c) => ({ text: `Revenue this month is ${money(c.finance.revenueMonth.value ?? 0)}.`, source: FIN, confidence: 'LIVE' }),
  },
  {
    id: 'revenue-week', financial: true,
    test: (q) => hasAny(q, 'revenue', 'sales') && hasAny(q, 'week'),
    run: (c) => ({ text: `Revenue this week is ${money(c.finance.revenueWeek.value ?? 0)}.`, source: FIN, confidence: 'LIVE' }),
  },
  {
    id: 'revenue-today', financial: true,
    test: (q) => hasAny(q, 'revenue', 'sales') && hasAny(q, 'today'),
    run: (c) => ({ text: `Revenue today is ${money(c.finance.revenueToday.value ?? 0)}.`, source: FIN, confidence: 'LIVE' }),
  },
  {
    id: 'inactive-customers',
    test: (q) => hasAny(q, 'inactive', 'lapsed', 'haven', 'hasn', 'not used', "didn't", 'gone', 'away') || (has(q, 'customer') && hasAny(q, '90', '60', '30', 'recent', 'while')),
    run: (c) => {
      const n = c.customers.inactive90Count.value ?? 0;
      if (n === 0) return { text: 'No customers are inactive 90+ days — everyone has visited recently.', source: CUST, confidence: 'LIVE' };
      const names = c.customers.inactive90.slice(0, 3).map((r) => r.name).join(', ');
      return { text: `${n} customer(s) haven't used you in 90+ days${names ? ` — e.g. ${names}` : ''}.`, source: CUST, confidence: 'LIVE' };
    },
  },
  {
    id: 'city-repeat',
    test: (q) => hasAny(q, 'city', 'cities', 'area', 'town') && hasAny(q, 'repeat', 'best', 'loyal', 'customer'),
    run: (c) => {
      const top = c.customers.cityTrends[0];
      if (!top) return { text: 'Not enough city data to rank repeat rates yet.', source: CUST, confidence: 'NOT_CONNECTED' };
      return { text: `${top.city} has your highest repeat rate (${top.repeatPct}% of ${top.total} customers).`, source: CUST, confidence: 'LIVE' };
    },
  },
  {
    id: 'best-customers', financial: true,
    test: (q) => (hasAny(q, 'best', 'top', 'biggest', 'most') && has(q, 'customer')) || has(q, 'lifetime value') || has(q, 'clv'),
    run: (c) => {
      const top = c.customers.bestCustomers.slice(0, 3);
      if (top.length === 0) return { text: 'No customer revenue recorded yet.', source: CUST, confidence: 'NOT_CONNECTED' };
      return { text: `Top customers by lifetime value: ${top.map((r) => `${r.name} (${money(r.revenue)})`).join(', ')}.`, source: CUST, confidence: 'LIVE' };
    },
  },
  {
    id: 'common-service',
    test: (q) => has(q, 'service') && hasAny(q, 'common', 'popular', 'most', 'top', 'frequent'),
    run: (c) => {
      const top = c.customers.topServices[0];
      if (!top) return { text: 'Not enough completed jobs to rank services yet.', source: CUST, confidence: 'NOT_CONNECTED' };
      return { text: `Your most common service is "${top.value}" (${top.count} jobs).`, source: CUST, confidence: 'LIVE' };
    },
  },
  {
    id: 'common-tire',
    test: (q) => has(q, 'tire') || (has(q, 'size') && hasAny(q, 'common', 'popular', 'most', 'top')),
    run: (c) => {
      const top = c.customers.topTireSizes[0];
      if (!top) return { text: 'Not enough tire jobs to rank sizes yet.', source: CUST, confidence: 'NOT_CONNECTED' };
      return { text: `Your most common tire size is ${top.value} (${top.count} jobs).`, source: CUST, confidence: 'LIVE' };
    },
  },
  {
    id: 'repeat-rate',
    test: (q) => hasAny(q, 'repeat', 'returning', 'loyal', 'retention'),
    run: (c) => ({ text: `${c.customers.returningCustomers.value ?? 0} repeat customers — a ${c.customers.returningRatePct.value ?? 0}% repeat rate.`, source: CUST, confidence: 'LIVE' }),
  },
  {
    id: 'reorder',
    test: (q) => hasAny(q, 'reorder', 'restock', 'order more', 'low stock', 'out of stock', 'inventory') && !has(q, 'revenue'),
    run: (c) => {
      const n = c.inventory.reorderCount.value ?? 0;
      if (n === 0) return { text: 'Nothing needs reordering right now — no in-demand items are low.', source: INV, confidence: 'LIVE' };
      const items = c.inventory.reorderList.slice(0, 3).map((s) => s.item.size || s.item.partName || 'item').join(', ');
      return { text: `${n} in-demand item(s) are low and worth reordering${items ? `: ${items}` : ''}.`, source: INV, confidence: 'LIVE' };
    },
  },
  {
    id: 'distributable', financial: true,
    test: (q) => hasAny(q, 'distributable', 'payout', 'take home', 'take-home', 'split', 'owe me'),
    run: (c) => ({ text: `This week's distributable is ${money(c.finance.distributableWeek.value ?? 0)}.`, source: FIN, confidence: 'LIVE' }),
  },
  {
    id: 'alerts',
    test: (q) => hasAny(q, 'alert', 'attention', 'urgent', 'critical', 'wrong', 'problem', 'issue', 'need to know'),
    run: (c) => {
      const a = c.alertCenter;
      if (a.total === 0) return { text: 'All clear — no alerts above threshold right now.', source: 'Alert Center', confidence: 'LIVE' };
      return { text: `${a.critical.length} critical, ${a.warning.length} warning, ${a.opportunity.length} opportunity alert(s). Top: ${(a.critical[0] || a.warning[0] || a.opportunity[0]).title}.`, source: 'Alert Center', confidence: 'LIVE' };
    },
  },
];

const GUIDANCE = 'I answer from your real data — try: "show today\'s profit", "which customers are inactive 90 days?", "what service made the most revenue?", or "what needs my attention?"';

export function answerQuery(query: string, ctx: ConsoleContext): ConsoleAnswer {
  const q = (query || '').toLowerCase().trim();
  if (!q) return { matched: false, text: GUIDANCE };

  for (const intent of INTENTS) {
    if (!intent.test(q)) continue;
    if (intent.financial && !ctx.canViewFinancials) return { matched: true, ...RESTRICTED };
    return { matched: true, ...intent.run(ctx) };
  }
  return { matched: false, text: GUIDANCE };
}

/** Example queries surfaced as tappable chips. */
export const EXAMPLE_QUERIES = [
  "Show today's profit",
  'Which customers are inactive 90 days?',
  'What service made the most revenue?',
  'What needs my attention?',
];
