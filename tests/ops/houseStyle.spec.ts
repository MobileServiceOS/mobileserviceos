// tests/ops/houseStyle.spec.ts — review-reply house-style rules.
import { describe, it, expect } from 'vitest';
import {
  hasEmoji,
  hasDash,
  includesRequiredPhrase,
  referencesBroward,
  referencesMiamiDade,
  validateReviewReply,
  REQUIRED_PHRASE,
} from '@/lib/ops/houseStyle';

// A fully compliant reply: no emoji, no dashes, the required phrase, and
// both counties referenced.
const GOOD =
  'Thank you so much for the kind words. We are proud to be your mobile tire repair service across ' +
  'Broward and Miami Dade, and we look forward to helping you again soon.';

describe('individual rules', () => {
  it('detects emoji', () => {
    expect(hasEmoji('great service 🛞')).toBe(true);
    expect(hasEmoji('great service')).toBe(false);
  });
  it('detects every dash variant', () => {
    expect(hasDash('top-notch')).toBe(true); // hyphen
    expect(hasDash('fast – reliable')).toBe(true); // en dash
    expect(hasDash('fast — reliable')).toBe(true); // em dash
    expect(hasDash('no dashes here')).toBe(false);
  });
  it('detects the required phrase (case-insensitive)', () => {
    expect(includesRequiredPhrase('we are a Mobile Tire Repair Service')).toBe(true);
    expect(includesRequiredPhrase('we fix tires')).toBe(false);
    expect(REQUIRED_PHRASE).toBe('mobile tire repair service');
  });
  it('detects county references, tolerating a dash in Miami-Dade', () => {
    expect(referencesBroward('serving Broward county')).toBe(true);
    expect(referencesMiamiDade('serving Miami Dade')).toBe(true);
    expect(referencesMiamiDade('serving Miami-Dade')).toBe(true); // normalized
    expect(referencesMiamiDade('serving Broward only')).toBe(false);
  });
});

describe('validateReviewReply', () => {
  it('passes a fully compliant reply', () => {
    const r = validateReviewReply(GOOD);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags every violation in a bad reply', () => {
    // emoji + em dash + missing phrase + missing Miami Dade (has Broward)
    const bad = 'Thanks 😊 — we loved serving you in Broward!';
    const r = validateReviewReply(bad);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('emoji');
    expect(r.violations).toContain('dash');
    expect(r.violations).toContain('missing-phrase');
    expect(r.violations).toContain('missing-miami-dade');
    expect(r.violations).not.toContain('missing-broward');
  });

  it('flags empty replies', () => {
    expect(validateReviewReply('   ').violations).toEqual(['empty']);
  });
});
