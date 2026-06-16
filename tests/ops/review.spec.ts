// tests/ops/review.spec.ts — Loop 2 gather + prompt + parse.
import { describe, it, expect } from 'vitest';
import { gatherReviewContext, buildReviewPrompt, parseReviewResult } from '@/lib/ops/loops/review';
import { validateReviewReply } from '@/lib/ops/houseStyle';

describe('gatherReviewContext', () => {
  it('fixes the counties + required phrase and trims the review', () => {
    const ctx = gatherReviewContext({ text: '  Great fast service! ', reviewerName: ' Sam ', rating: 5 }, 'Acme Tire');
    expect(ctx.businessName).toBe('Acme Tire');
    expect(ctx.requiredPhrase).toBe('mobile tire repair service');
    expect(ctx.counties).toEqual(['Broward', 'Miami Dade']);
    expect(ctx.review.text).toBe('Great fast service!');
    expect(ctx.review.reviewerName).toBe('Sam');
    expect(ctx.review.rating).toBe(5);
  });
});

describe('buildReviewPrompt', () => {
  it('bakes in every house-style rule and asks for JSON-only output', () => {
    const ctx = gatherReviewContext({ text: 'Fast and friendly' }, 'Acme Tire');
    const { system, user } = buildReviewPrompt(ctx);
    expect(system).toContain('JSON');
    expect(system).toContain('NO emoji');
    expect(system).toContain('NO dashes');
    expect(system).toContain('mobile tire repair service');
    expect(system).toContain('Broward');
    expect(system).toContain('Miami Dade');
    expect(user).toContain('Fast and friendly');
  });
});

describe('parseReviewResult', () => {
  it('parses a valid draft (with fences)', () => {
    const r = parseReviewResult('```json\n{"reply":"Thank you so much."}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reply).toBe('Thank you so much.');
  });
  it('fails when reply is missing or output is malformed', () => {
    expect(parseReviewResult('{"notReply":"x"}').ok).toBe(false);
    expect(parseReviewResult('no json').ok).toBe(false);
  });
  it('a compliant parsed draft passes the house-style validator', () => {
    const reply =
      'Thank you for the kind review. We are proud to be your mobile tire repair service across ' +
      'Broward and Miami Dade, and we are glad we could help.';
    const r = parseReviewResult(JSON.stringify({ reply }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateReviewReply(r.value.reply).ok).toBe(true);
  });
});
