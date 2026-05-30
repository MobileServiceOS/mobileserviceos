// tests/tireQuoteAnalytics.test.ts
// Run: npx tsx tests/tireQuoteAnalytics.test.ts

import {
  computeQuoteAnalytics,
  filterQuotes,
} from '@/lib/tireQuoteAnalytics';
import type { TireQuote, QuoteStatus } from '@/lib/tireQuoteTypes';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

function makeQuote(overrides: Partial<TireQuote>): TireQuote {
  return {
    id: 'q-' + Math.random().toString(36).slice(2, 8),
    search: { kind: 'size', tireSize: '225/65R17' },
    serviceType: 'replacement',
    urgency: 'standard',
    quoteOptions: [],
    customerPrice: 499,
    estimatedProfit: 99,
    status: 'draft',
    source: 'admin',
    createdBy: 'owner-1',
    createdAt: '2026-05-28T12:00:00Z',
    ...overrides,
  };
}

// ─── Empty / null input ───────────────────────────────────────────
section('Empty / null input');
{
  const a = computeQuoteAnalytics([]);
  check('empty → 0 quotes', a.totalQuotes === 0);
  check('empty → 0% conversion', a.conversionRate === 0);
  check('empty → 0 accepted revenue', a.acceptedRevenue === 0);
  check('empty → status buckets all 0', Object.values(a.byStatus).every((v) => v === 0));

  const n = computeQuoteAnalytics(null);
  check('null → safely returns zero analytics', n.totalQuotes === 0);

  const u = computeQuoteAnalytics(undefined);
  check('undefined → safely returns zero analytics', u.totalQuotes === 0);
}

// ─── Basic count by status ────────────────────────────────────────
section('Status bucketing');
{
  const a = computeQuoteAnalytics([
    makeQuote({ status: 'draft' }),
    makeQuote({ status: 'draft' }),
    makeQuote({ status: 'sent' }),
    makeQuote({ status: 'accepted' }),
    makeQuote({ status: 'declined' }),
    makeQuote({ status: 'convertedToJob' }),
  ]);
  check('total 6', a.totalQuotes === 6);
  check('byStatus.draft = 2', a.byStatus.draft === 2);
  check('byStatus.sent = 1', a.byStatus.sent === 1);
  check('byStatus.accepted = 1', a.byStatus.accepted === 1);
  check('byStatus.declined = 1', a.byStatus.declined === 1);
  check('byStatus.convertedToJob = 1', a.byStatus.convertedToJob === 1);
}

// ─── Conversion rate ─────────────────────────────────────────────
section('Conversion rate — accepted + converted / total');
{
  const a = computeQuoteAnalytics([
    makeQuote({ status: 'accepted' }),
    makeQuote({ status: 'convertedToJob' }),
    makeQuote({ status: 'declined' }),
    makeQuote({ status: 'sent' }),
  ]);
  check('acceptedCount = 2 (accepted + converted)', a.acceptedCount === 2);
  check('declinedCount = 1', a.declinedCount === 1);
  check('conversion = 2/4 = 0.5', a.conversionRate === 0.5);
  check('declineRate = 1/4 = 0.25', a.declineRate === 0.25);
}

// ─── Accepted revenue + profit ───────────────────────────────────
section('Accepted revenue + profit sum');
{
  const a = computeQuoteAnalytics([
    makeQuote({ status: 'accepted', customerPrice: 499, estimatedProfit: 99 }),
    makeQuote({ status: 'convertedToJob', customerPrice: 619, estimatedProfit: 219 }),
    makeQuote({ status: 'declined', customerPrice: 999, estimatedProfit: 399 }),
    makeQuote({ status: 'draft', customerPrice: 700, estimatedProfit: 200 }),
  ]);
  check('acceptedRevenue = 499 + 619 = 1118', a.acceptedRevenue === 1118);
  check('acceptedProfit = 99 + 219 = 318', a.acceptedProfit === 318);
  check('declined quote not in revenue sum', a.acceptedRevenue !== 1118 + 999);
  check('draft quote not in revenue sum', a.acceptedRevenue !== 1118 + 700);
}

// ─── Unknown status falls to draft ───────────────────────────────
section('Unknown / malformed status → draft bucket');
{
  const a = computeQuoteAnalytics([
    makeQuote({ status: 'mysterious' as QuoteStatus }),
  ]);
  check('unknown status counted in draft', a.byStatus.draft === 1);
  check('total still 1', a.totalQuotes === 1);
}

// ─── filterQuotes — empty filters ────────────────────────────────
section('filterQuotes — no filters returns full list');
{
  const quotes = [
    makeQuote({ id: 'q1' }),
    makeQuote({ id: 'q2', status: 'sent' }),
  ];
  const result = filterQuotes(quotes, {});
  check('all quotes pass', result.length === 2);
}

// ─── filterQuotes — by status ────────────────────────────────────
section('filterQuotes — by status');
{
  const quotes = [
    makeQuote({ id: 'a', status: 'accepted' }),
    makeQuote({ id: 'b', status: 'declined' }),
    makeQuote({ id: 'c', status: 'accepted' }),
  ];
  const accepted = filterQuotes(quotes, { status: 'accepted' });
  check('2 accepted quotes', accepted.length === 2);
  check('both are accepted', accepted.every((q) => q.status === 'accepted'));
}

// ─── filterQuotes — by customer search ───────────────────────────
section('filterQuotes — search across customer name + phone + city');
{
  const quotes = [
    makeQuote({ id: 'a', customerName: 'Serge', customerPhone: '305-555-1234' }),
    makeQuote({ id: 'b', customerName: 'Alice', customerPhone: '786-555-9999' }),
    makeQuote({ id: 'c', customerName: 'Bob', customerCity: 'Aventura' }),
  ];
  check('match on name "serge"', filterQuotes(quotes, { search: 'serge' }).length === 1);
  check('match on partial phone "305"', filterQuotes(quotes, { search: '305' }).length === 1);
  check('match on city "aventura"', filterQuotes(quotes, { search: 'aventura' }).length === 1);
  check('match case-insensitive ALICE', filterQuotes(quotes, { search: 'ALICE' }).length === 1);
  check('no match → empty', filterQuotes(quotes, { search: 'nobody' }).length === 0);
}

// ─── filterQuotes — by tire size ─────────────────────────────────
section('filterQuotes — by tire size (size-kind search only)');
{
  const quotes = [
    makeQuote({ id: 'a', search: { kind: 'size', tireSize: '225/65R17' } }),
    makeQuote({ id: 'b', search: { kind: 'size', tireSize: '245/40R18' } }),
    makeQuote({ id: 'c', search: { kind: 'brandModel', brand: 'Michelin', model: 'Defender' } }),
  ];
  check('exact size match', filterQuotes(quotes, { tireSize: '225/65R17' }).length === 1);
  check('different size 245', filterQuotes(quotes, { tireSize: '245/40R18' }).length === 1);
  check('non-existent size → 0', filterQuotes(quotes, { tireSize: '999/99R99' }).length === 0);
}

// ─── filterQuotes — by createdBy ─────────────────────────────────
section('filterQuotes — by createdBy uid');
{
  const quotes = [
    makeQuote({ id: 'a', createdBy: 'tech-1' }),
    makeQuote({ id: 'b', createdBy: 'tech-2' }),
    makeQuote({ id: 'c', createdBy: 'tech-1' }),
  ];
  const t1 = filterQuotes(quotes, { createdBy: 'tech-1' });
  check('2 quotes by tech-1', t1.length === 2);
}

// ─── filterQuotes — by serviceType ───────────────────────────────
section('filterQuotes — by serviceType');
{
  const quotes = [
    makeQuote({ id: 'a', serviceType: 'used_tire' }),
    makeQuote({ id: 'b', serviceType: 'new_tire' }),
    makeQuote({ id: 'c', serviceType: 'used_tire' }),
  ];
  const used = filterQuotes(quotes, { serviceType: 'used_tire' });
  check('2 used_tire quotes', used.length === 2);
}

// ─── filterQuotes — combined filters AND together ────────────────
section('filterQuotes — combined filters AND');
{
  const quotes = [
    makeQuote({ id: 'a', customerName: 'Serge', status: 'accepted', serviceType: 'new_tire' }),
    makeQuote({ id: 'b', customerName: 'Serge', status: 'declined', serviceType: 'new_tire' }),
    makeQuote({ id: 'c', customerName: 'Alice', status: 'accepted', serviceType: 'new_tire' }),
  ];
  const result = filterQuotes(quotes, {
    search: 'serge',
    status: 'accepted',
    serviceType: 'new_tire',
  });
  check('only a matches', result.length === 1 && result[0].id === 'a');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
